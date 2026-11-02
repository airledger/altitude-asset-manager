-- Rebuild stage 5, part 1: asset numbers on units, and completing a job in one step.

-- ---------- asset numbers ----------
-- Each business numbers its units 1, 2, 3… in the order they're added. Numbers are never reused, so a
-- deleted unit leaves a gap; the count of units is still how many assets the business has.
create table public.asset_counters (
  org_id uuid primary key references public.orgs on delete cascade,
  last_no int not null default 0
);
alter table public.asset_counters enable row level security;
revoke all on public.asset_counters from anon, authenticated;

alter table public.units add column asset_no int;

with numbered as (
  select id, row_number() over (partition by org_id order by created_at, id) as n from public.units
)
update public.units u set asset_no = numbered.n from numbered where numbered.id = u.id;

insert into public.asset_counters (org_id, last_no)
  select org_id, max(asset_no) from public.units group by org_id;

alter table public.units alter column asset_no set not null;
alter table public.units add constraint units_asset_no_unique unique (org_id, asset_no);

-- Gives a new unit the business's next number, and keeps it fixed afterwards.
create or replace function public.assign_asset_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.asset_no := old.asset_no;
    return new;
  end if;
  insert into public.asset_counters as c (org_id, last_no) values (new.org_id, 1)
    on conflict (org_id) do update set last_no = c.last_no + 1
    returning last_no into new.asset_no;
  return new;
end $$;
create trigger assign_asset_no before insert or update of asset_no on public.units
  for each row execute function public.assign_asset_no();

-- ---------- completing a job ----------
-- Saves everything an engineer records on completion in one transaction. Runs as the caller, so the
-- tables' own rules apply. Re-saving a completed job ("Edit record") replaces what was recorded, and
-- the job only moves to "waiting to be invoiced" the first time.
--
-- p: {date, engineer, type, duration_hrs, completion_notes, photo_file_ids[],
--     unit_checks: [{unit_id, checks[], off_coil, on_coil, amps, pressure, notes}],
--     leak_check: {performed, method, result, added_kg, recovered_kg, notes} | null,
--     commissioning: {pressure_bar, pressure_mins, pressure_held, vacuum_microns, decay_held, pipe_m,
--                     added_kg, customer_name, handover} | null,
--     parts_used: [{material_id, name, sku, supplier, qty, raw_qty, extra}]}
create or replace function public.complete_job(p_job uuid, p jsonb) returns void
language plpgsql set search_path = public as $$
declare
  j public.jobs;
  was_done boolean;
  install boolean;
  rec_kind text;
  note text := btrim(coalesce(p->>'completion_notes', ''));
  photos uuid[] := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'photo_file_ids') x), '{}');
  rec uuid;
begin
  select * into j from public.jobs where id = p_job and deleted_at is null for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if j.status = 'cancelled' then raise exception 'This job is cancelled. Re-open it first.'; end if;
  was_done := j.status = 'completed';

  update public.jobs set
    status = 'completed',
    completed_at = coalesce(completed_at, now()),
    date = coalesce((p->>'date')::date, date, current_date),
    engineer = coalesce(p->>'engineer', engineer),
    type = coalesce(p->>'type', type),
    duration_hrs = case when p ? 'duration_hrs' then (p->>'duration_hrs')::numeric else duration_hrs end,
    completion_notes = note,
    billing = case when was_done then billing else 'pending' end
  where id = p_job
  returning * into j;
  install := j.type in ('Installation', 'Commissioning');

  delete from public.job_unit_checks where job_id = p_job;
  insert into public.job_unit_checks (job_id, unit_id, org_id, checks, off_coil, on_coil, amps, pressure, notes)
    select p_job, (c->>'unit_id')::uuid, j.org_id,
      coalesce((select array_agg(x) from jsonb_array_elements_text(c->'checks') x), '{}'),
      (c->>'off_coil')::numeric, (c->>'on_coil')::numeric, (c->>'amps')::numeric, (c->>'pressure')::numeric,
      coalesce(c->>'notes', '')
    from jsonb_array_elements(coalesce(p->'unit_checks', '[]')) c;

  delete from public.job_leak_checks where job_id = p_job;
  if jsonb_typeof(p->'leak_check') = 'object' then
    insert into public.job_leak_checks (job_id, org_id, performed, method, result, added_kg, recovered_kg, notes)
      values (p_job, j.org_id, coalesce((p->'leak_check'->>'performed')::boolean, false),
        coalesce(p->'leak_check'->>'method', ''), nullif(p->'leak_check'->>'result', ''),
        (p->'leak_check'->>'added_kg')::numeric, (p->'leak_check'->>'recovered_kg')::numeric,
        coalesce(p->'leak_check'->>'notes', ''));
  end if;

  delete from public.job_commissioning where job_id = p_job;
  if jsonb_typeof(p->'commissioning') = 'object' then
    insert into public.job_commissioning (job_id, org_id, pressure_bar, pressure_mins, pressure_held,
        vacuum_microns, decay_held, pipe_m, added_kg, customer_name, handover)
      values (p_job, j.org_id, (p->'commissioning'->>'pressure_bar')::numeric,
        (p->'commissioning'->>'pressure_mins')::numeric, (p->'commissioning'->>'pressure_held')::boolean,
        (p->'commissioning'->>'vacuum_microns')::numeric, (p->'commissioning'->>'decay_held')::boolean,
        (p->'commissioning'->>'pipe_m')::numeric, (p->'commissioning'->>'added_kg')::numeric,
        coalesce(p->'commissioning'->>'customer_name', ''),
        coalesce((p->'commissioning'->>'handover')::boolean, false));
    -- An install sets the system's install date, extra charge and who commissioned it.
    update public.systems set
      install_date = j.date,
      added_charge_kg = coalesce((p->'commissioning'->>'added_kg')::numeric, added_charge_kg),
      commissioned_by = coalesce(nullif(j.engineer, ''), commissioned_by)
    where id = j.system_id;
  end if;

  delete from public.job_parts where job_id = p_job and list = 'used';
  insert into public.job_parts (org_id, job_id, list, material_id, name, sku, supplier, qty, raw_qty, extra, position)
    select j.org_id, p_job, 'used', nullif(x->>'material_id', '')::uuid, x->>'name', coalesce(x->>'sku', ''),
      coalesce(x->>'supplier', ''), (x->>'qty')::numeric, (x->>'raw_qty')::numeric,
      coalesce((x->>'extra')::boolean, false), (n - 1)::int
    from jsonb_array_elements(coalesce(p->'parts_used', '[]')) with ordinality as t(x, n)
    where coalesce((x->>'qty')::numeric, 0) > 0;

  -- The engineer's report and photos go on the install's history as a site record for this job.
  rec_kind := case when install then 'Install / commissioning report' else 'Service report' end;
  select id into rec from public.site_records where job_id = p_job and kind in
    ('Service report', 'Install / commissioning report') order by created_at limit 1;
  if note = '' and cardinality(photos) = 0 then
    delete from public.site_records where id = rec;
  elsif rec is null then
    insert into public.site_records (org_id, system_id, job_id, kind, date, author, text, photo_file_ids)
      values (j.org_id, j.system_id, p_job, rec_kind, j.date, j.engineer, note, photos);
  else
    update public.site_records set kind = rec_kind, date = j.date, author = j.engineer, text = note,
      photo_file_ids = photos where id = rec;
  end if;
end $$;
revoke execute on function public.complete_job(uuid, jsonb) from public, anon;
grant execute on function public.complete_job(uuid, jsonb) to authenticated;

-- Marks a job's parts as ordered and freezes its list (spec F11).
create or replace function public.mark_parts_ordered(p_job uuid, p_parts jsonb) returns void
language plpgsql set search_path = public as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs where id = p_job and deleted_at is null for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  delete from public.job_parts where job_id = p_job and list = 'ordered';
  insert into public.job_parts (org_id, job_id, list, material_id, name, sku, supplier, qty, raw_qty, extra, position)
    select j.org_id, p_job, 'ordered', nullif(x->>'material_id', '')::uuid, x->>'name', coalesce(x->>'sku', ''),
      coalesce(x->>'supplier', ''), (x->>'qty')::numeric, (x->>'raw_qty')::numeric,
      coalesce((x->>'extra')::boolean, false), (n - 1)::int
    from jsonb_array_elements(coalesce(p_parts, '[]')) with ordinality as t(x, n);
  update public.jobs set materials_ordered = true where id = p_job;
end $$;
revoke execute on function public.mark_parts_ordered(uuid, jsonb) from public, anon;
grant execute on function public.mark_parts_ordered(uuid, jsonb) to authenticated;

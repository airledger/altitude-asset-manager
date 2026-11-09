-- Refrigerant log (part 2). The business's cylinders (new gas and recovery), and every kilo charged into or
-- recovered from a system on a completed job, tied to the cylinder it came from or went into. The log itself is
-- a view over the job records, so editing a job's record changes the log with it.

create table public.cylinders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  code text not null default '',
  refrigerant text not null check (btrim(refrigerant) <> ''),
  kind text not null check (kind in ('new', 'recovery')),
  size_kg numeric not null check (size_kg > 0 and size_kg <= 1000),
  supplier text not null default '',
  holder text not null default '',
  received_on date not null default current_date,
  status text not null default 'in_use' check (status in ('in_use', 'empty', 'returned')),
  returned_on date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users on delete set null,
  unique (id, org_id)
);
create index on public.cylinders (org_id, status);
-- Engineers carry the cylinders, so everyone in the business can add and update them; only owners delete.
select public.apply_tenant_rules('cylinders', 'members');
create trigger audit after insert or update or delete on public.cylinders for each row execute function public.audit();

-- Which cylinder the gas came from or went into. Same business enforced by the foreign key.
alter table public.job_leak_checks
  add column added_cylinder uuid,
  add column recovered_cylinder uuid,
  add foreign key (added_cylinder, org_id) references public.cylinders (id, org_id) on delete set null (added_cylinder),
  add foreign key (recovered_cylinder, org_id) references public.cylinders (id, org_id) on delete set null (recovered_cylinder);
alter table public.job_commissioning
  add column added_cylinder uuid,
  add foreign key (added_cylinder, org_id) references public.cylinders (id, org_id) on delete set null (added_cylinder);

-- ---------- the log ----------
-- One row per kilo amount charged or recovered on a completed job. Runs as the caller, so row-level security
-- on jobs, systems and clients applies.
create view public.refrigerant_log with (security_invoker = true) as
  select j.org_id, j.id as job_id, j.date, j.engineer, j.type as job_type, s.id as system_id,
    s.name as system_name, s.site_postcode, c.name as client_name, s.refrigerant, x.kind, x.kg, x.cylinder_id
  from public.jobs j
  join public.systems s on s.id = j.system_id
  join public.clients c on c.id = s.client_id
  cross join lateral (
    select 'added'::text as kind, lc.added_kg as kg, lc.added_cylinder as cylinder_id
      from public.job_leak_checks lc where lc.job_id = j.id and lc.added_kg > 0
    union all
    select 'recovered', lc.recovered_kg, lc.recovered_cylinder
      from public.job_leak_checks lc where lc.job_id = j.id and lc.recovered_kg > 0
    union all
    select 'added', cm.added_kg, cm.added_cylinder
      from public.job_commissioning cm where cm.job_id = j.id and cm.added_kg > 0
  ) x
  where j.status = 'completed' and j.deleted_at is null;

-- Each cylinder with what's gone out of it (new gas) or into it (recovery).
create view public.cylinder_levels with (security_invoker = true) as
  select y.*,
    coalesce((select sum(l.kg) from public.refrigerant_log l where l.cylinder_id = y.id and l.kind = 'added'), 0)
      as used_kg,
    coalesce((select sum(l.kg) from public.refrigerant_log l where l.cylinder_id = y.id and l.kind = 'recovered'), 0)
      as recovered_kg
  from public.cylinders y;

revoke all on public.refrigerant_log, public.cylinder_levels from anon;
grant select on public.refrigerant_log, public.cylinder_levels to authenticated;

-- ---------- completing a job: now with cylinders ----------
-- As before (20261102090000), plus leak_check.added_cylinder / recovered_cylinder and
-- commissioning.added_cylinder (cylinder ids, or null).
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
    insert into public.job_leak_checks (job_id, org_id, performed, method, result, added_kg, recovered_kg, notes,
        added_cylinder, recovered_cylinder)
      values (p_job, j.org_id, coalesce((p->'leak_check'->>'performed')::boolean, false),
        coalesce(p->'leak_check'->>'method', ''), nullif(p->'leak_check'->>'result', ''),
        (p->'leak_check'->>'added_kg')::numeric, (p->'leak_check'->>'recovered_kg')::numeric,
        coalesce(p->'leak_check'->>'notes', ''),
        nullif(p->'leak_check'->>'added_cylinder', '')::uuid, nullif(p->'leak_check'->>'recovered_cylinder', '')::uuid);
  end if;

  delete from public.job_commissioning where job_id = p_job;
  if jsonb_typeof(p->'commissioning') = 'object' then
    insert into public.job_commissioning (job_id, org_id, pressure_bar, pressure_mins, pressure_held,
        vacuum_microns, decay_held, pipe_m, added_kg, customer_name, handover, added_cylinder)
      values (p_job, j.org_id, (p->'commissioning'->>'pressure_bar')::numeric,
        (p->'commissioning'->>'pressure_mins')::numeric, (p->'commissioning'->>'pressure_held')::boolean,
        (p->'commissioning'->>'vacuum_microns')::numeric, (p->'commissioning'->>'decay_held')::boolean,
        (p->'commissioning'->>'pipe_m')::numeric, (p->'commissioning'->>'added_kg')::numeric,
        coalesce(p->'commissioning'->>'customer_name', ''),
        coalesce((p->'commissioning'->>'handover')::boolean, false),
        nullif(p->'commissioning'->>'added_cylinder', '')::uuid);
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

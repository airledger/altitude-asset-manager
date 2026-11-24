-- Import (part 2): owners bring their clients, installs, units and last service dates across from a spreadsheet.
-- The app matches the columns and checks every row; import_rows adds them in batches, matching clients and
-- installs that already exist, and every row it adds is tagged with the import so the whole import can be undone.

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  file_name text not null default '',
  clients int not null default 0,
  systems int not null default 0,
  units int not null default 0,
  jobs int not null default 0,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  unique (id, org_id)
);
create index on public.imports (org_id, created_at desc);
alter table public.imports enable row level security;
revoke all on public.imports from anon;
-- Owners see the business's imports; only import_rows and undo_import change them.
revoke insert, update, delete on public.imports from authenticated;
create policy "read" on public.imports for select to authenticated using (public.is_owner(org_id));

alter table public.clients add column import_id uuid references public.imports on delete set null;
alter table public.systems add column import_id uuid references public.imports on delete set null;
alter table public.units add column import_id uuid references public.imports on delete set null;
alter table public.jobs add column import_id uuid references public.imports on delete set null;

create or replace function public.start_import(p_org uuid, p_file text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.is_owner(p_org) then raise exception 'Only an owner can import' using errcode = '42501'; end if;
  insert into public.imports (org_id, file_name) values (p_org, left(coalesce(p_file, ''), 200)) returning id into v;
  return v;
end $$;
revoke all on function public.start_import(uuid, text) from public, anon;
grant execute on function public.start_import(uuid, text) to authenticated;

-- Rows are already checked by the app; this still guards every value. Each row:
--   { client: {name, contact_name, email, phone, billing_address, postcode, ref},
--     system: {name, site_address, site_postcode, install_date, refrigerant, factory_charge_kg,
--              service_interval_months, ref},
--     unit: {role, indoor_type, manufacturer, model, serial, capacity_kw, location} or null,
--     last_service: 'YYYY-MM-DD' or null }
-- Clients match on their reference, or else their name; installs on their reference, or else their name and postcode.
create or replace function public.import_rows(p_org uuid, p_import uuid, p_file text, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  imp uuid := p_import;
  r jsonb;
  c jsonb; s jsonb; u jsonb;
  v_client uuid; v_system uuid; v_code text; v_date date; v_role text; v_type text;
  n_clients int := 0; n_systems int := 0; n_units int := 0; n_jobs int := 0;
  t text;
  txt constant int := 500;
begin
  if not public.is_owner(p_org) then
    raise exception 'Only an owner can import' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Send up to 1,000 rows at a time';
  end if;
  if imp is null then
    imp := public.start_import(p_org, p_file);
  elsif not exists (select 1 from public.imports where id = imp and org_id = p_org and undone_at is null) then
    raise exception 'That import has been undone';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    c := coalesce(r -> 'client', '{}'::jsonb);
    s := coalesce(r -> 'system', '{}'::jsonb);
    u := r -> 'unit';
    t := btrim(coalesce(c ->> 'name', ''));
    if t = '' then raise exception 'Every row needs a client name'; end if;

    -- The client: by their reference, else by name.
    v_client := null;
    if btrim(coalesce(c ->> 'ref', '')) <> '' then
      select id into v_client from public.clients
        where org_id = p_org and legacy_id = left(btrim(c ->> 'ref'), 100) and deleted_at is null;
    end if;
    if v_client is null then
      select id into v_client from public.clients
        where org_id = p_org and lower(btrim(name)) = lower(t) and deleted_at is null
        order by created_at limit 1;
    end if;
    if v_client is null then
      insert into public.clients (org_id, name, contact_name, email, phone, billing_address, postcode, legacy_id, import_id)
      values (p_org, left(t, 200), left(btrim(coalesce(c ->> 'contact_name', '')), 200),
        left(lower(btrim(coalesce(c ->> 'email', ''))), 200), left(btrim(coalesce(c ->> 'phone', '')), 40),
        left(btrim(coalesce(c ->> 'billing_address', '')), txt), upper(left(btrim(coalesce(c ->> 'postcode', '')), 12)),
        nullif(left(btrim(coalesce(c ->> 'ref', '')), 100), ''), imp)
      returning id into v_client;
      n_clients := n_clients + 1;
    end if;

    -- The install: by its reference, else by name and postcode under this client.
    t := btrim(coalesce(nullif(btrim(s ->> 'name'), ''), nullif(btrim(s ->> 'site_address'), ''), 'Air conditioning'));
    v_system := null;
    if btrim(coalesce(s ->> 'ref', '')) <> '' then
      select id into v_system from public.systems
        where org_id = p_org and legacy_id = left(btrim(s ->> 'ref'), 100) and deleted_at is null;
    end if;
    if v_system is null then
      select id into v_system from public.systems
        where org_id = p_org and client_id = v_client and deleted_at is null and lower(btrim(name)) = lower(left(t, 200))
          and upper(replace(site_postcode, ' ', '')) = upper(replace(coalesce(s ->> 'site_postcode', ''), ' ', ''))
        order by created_at limit 1;
    end if;
    if v_system is null then
      insert into public.systems (org_id, client_id, name, site_address, site_postcode, install_date, refrigerant,
        factory_charge_kg, service_interval_months, legacy_id, import_id)
      values (p_org, v_client, left(t, 200), left(btrim(coalesce(s ->> 'site_address', '')), txt),
        upper(left(btrim(coalesce(s ->> 'site_postcode', '')), 12)),
        nullif(s ->> 'install_date', '')::date, left(btrim(coalesce(s ->> 'refrigerant', '')), 20),
        nullif(s ->> 'factory_charge_kg', '')::numeric,
        nullif(s ->> 'service_interval_months', '')::int,
        nullif(left(btrim(coalesce(s ->> 'ref', '')), 100), ''), imp)
      returning id into v_system;
      n_systems := n_systems + 1;
    end if;

    -- The unit, if the row describes one. Each gets a new asset label code.
    if u is not null and jsonb_typeof(u) = 'object' then
      v_role := case when lower(coalesce(u ->> 'role', '')) = 'outdoor' then 'outdoor' else 'indoor' end;
      v_type := case when v_role = 'indoor' and u ->> 'indoor_type' in
        ('Wall mounted', 'Cassette', 'Ducted', 'Floor console', 'Ceiling suspended', 'Other') then u ->> 'indoor_type' end;
      select code into v_code from public.reserve_stickers(p_org, 1) code;
      insert into public.units (org_id, system_id, sticker_code, role, indoor_type, manufacturer, model, serial,
        capacity_kw, location, import_id)
      values (p_org, v_system, v_code, v_role, v_type, left(btrim(coalesce(u ->> 'manufacturer', '')), 100),
        left(btrim(coalesce(u ->> 'model', '')), 100), left(btrim(coalesce(u ->> 'serial', '')), 100),
        nullif(u ->> 'capacity_kw', '')::numeric, left(btrim(coalesce(u ->> 'location', '')), 200), imp);
      n_units := n_units + 1;
    end if;

    -- The last service, as a completed job, so reminders know when the next one is due.
    v_date := nullif(r ->> 'last_service', '')::date;
    if v_date is not null and v_date <= current_date and not exists (
      select 1 from public.jobs where system_id = v_system and date = v_date and status = 'completed'
        and type in ('Annual service', 'Service + repair') and deleted_at is null
    ) then
      insert into public.jobs (org_id, system_id, type, status, date, completed_at, completion_notes, import_id)
      values (p_org, v_system, 'Annual service', 'completed', v_date, v_date + time '12:00',
        'Imported from the business''s old records', imp);
      n_jobs := n_jobs + 1;
    end if;
  end loop;

  -- Counts go through a definer function, as the app can't change imports itself.
  perform public.count_import(imp, n_clients, n_systems, n_units, n_jobs);
  return jsonb_build_object('import', imp, 'clients', n_clients, 'systems', n_systems, 'units', n_units, 'jobs', n_jobs);
end $$;
revoke all on function public.import_rows(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.import_rows(uuid, uuid, text, jsonb) to authenticated;

create or replace function public.count_import(p_import uuid, p_clients int, p_systems int, p_units int, p_jobs int)
returns void language sql security definer set search_path = public as $$
  update public.imports set clients = clients + p_clients, systems = systems + p_systems,
    units = units + p_units, jobs = jobs + p_jobs
  where id = p_import and public.is_owner(org_id);
$$;
revoke all on function public.count_import(uuid, int, int, int, int) from public, anon;
grant execute on function public.count_import(uuid, int, int, int, int) to authenticated;

-- Takes out everything an import added. Records changed or used since (a job booked on an imported install,
-- an invoice for an imported client) stop the undo, so nothing anyone has worked on is lost.
create or replace function public.undo_import(p_import uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.imports where id = p_import and undone_at is null;
  if v_org is null or not public.is_owner(v_org) then
    raise exception 'Import not found' using errcode = '42501';
  end if;
  if exists (select 1 from public.jobs j join public.systems s on s.id = j.system_id
             where s.import_id = p_import and coalesce(j.import_id, '00000000-0000-0000-0000-000000000000') <> p_import)
     or exists (select 1 from public.units u join public.systems s on s.id = u.system_id
             where s.import_id = p_import and coalesce(u.import_id, '00000000-0000-0000-0000-000000000000') <> p_import)
     or exists (select 1 from public.systems s join public.clients c on c.id = s.client_id
             where c.import_id = p_import and coalesce(s.import_id, '00000000-0000-0000-0000-000000000000') <> p_import)
  then
    raise exception 'Jobs or units have been added to imported installs since, so this import can''t be undone. Delete them first.'
      using errcode = '23503';
  end if;
  begin
    delete from public.jobs where import_id = p_import;
    delete from public.units where import_id = p_import;
    delete from public.systems where import_id = p_import;
    delete from public.clients where import_id = p_import;
  exception when foreign_key_violation then
    raise exception 'Some imported records have been used since (for example on an invoice or contract), so this import can''t be undone.'
      using errcode = '23503';
  end;
  update public.imports set undone_at = now() where id = p_import;
end $$;
revoke all on function public.undo_import(uuid) from public, anon;
grant execute on function public.undo_import(uuid) to authenticated;

-- Rebuild stage 2: typed tables for every record in specs/02-domain-model.md, with row-level security
-- from specs/04-tenancy-roles-security.md. The live app keeps using public.docs; these tables sit beside it
-- until the data is migrated at cut-over (specs/REBUILD-PLAN.md, "Data migration").
--
-- Rules every table follows:
-- * org_id on every row, and child rows point at their parent with (id, org_id) foreign keys, so a row can
--   never be linked to another business's record.
-- * legacy_id keeps the old docs id for the migration.
-- * Engineers ("member") read and write the day-to-day records; deleting clients, systems, jobs and
--   materials, and everything to do with prices, invoices and settings, is owners only.
-- * Prices live only in owner-only tables, so they're never sent to an engineer's device.

create extension if not exists pgcrypto with schema extensions;

-- ---------- helpers ----------
create or replace function public.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.members where org_id = p_org and user_id = auth.uid())
$$;

-- Engineers may hide (soft delete) a record only if they could delete it.
create or replace function public.guard_soft_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  -- auth.uid() is null for the server itself (service role, migrations), which may.
  if new.deleted_at is distinct from old.deleted_at and auth.uid() is not null and not public.is_owner(new.org_id) then
    raise exception 'Only the business owner can delete this' using errcode = '42501';
  end if;
  return new;
end $$;

-- Rows can't move between businesses.
create or replace function public.guard_org_id() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'Records can''t move to another business' using errcode = '42501';
  end if;
  return new;
end $$;

-- Adds the standard triggers and policies to a table.
--   access 'members': members read, add and edit; delete_by says who deletes ('owners' or 'members').
--   access 'owners':  only owners can see or touch it.
--   access 'members-read': members read, owners write (settings, the materials catalogue).
create or replace function public.apply_tenant_rules(p_table text, p_access text, p_delete_by text default 'owners')
returns void language plpgsql set search_path = public as $$
declare
  t regclass := ('public.' || p_table)::regclass;
  has_updated boolean := exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = 'updated_at');
  has_deleted boolean := exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = 'deleted_at');
  writer text := case when p_access = 'members' then 'public.is_member(org_id)' else 'public.is_owner(org_id)' end;
  reader text := case when p_access = 'owners' then 'public.is_owner(org_id)' else 'public.is_member(org_id)' end;
  deleter text := case when p_access = 'members' and p_delete_by = 'members' then 'public.is_member(org_id)' else 'public.is_owner(org_id)' end;
begin
  execute format('alter table %s enable row level security', t);
  execute format('revoke all on %s from anon', t);
  if has_updated then
    execute format('create trigger touch before update on %s for each row execute function public.touch_updated_at()', t);
  end if;
  if has_deleted then
    execute format('create trigger guard_soft_delete before update on %s for each row execute function public.guard_soft_delete()', t);
  end if;
  execute format('create trigger guard_org_id before update on %s for each row execute function public.guard_org_id()', t);
  execute format('create policy "read" on %s for select to authenticated using (%s)', t, reader);
  execute format('create policy "add" on %s for insert to authenticated with check (%s)', t, writer);
  execute format('create policy "edit" on %s for update to authenticated using (%s) with check (%s)', t, writer, writer);
  execute format('create policy "delete" on %s for delete to authenticated using (%s)', t, deleter);
end $$;

-- ---------- business settings (one row per business; no Altitude defaults) ----------
create table public.org_settings (
  org_id uuid primary key references public.orgs on delete cascade,
  trading_as text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  website text not null default '',
  company_no text not null default '',
  vat_no text not null default '',
  default_engineer text not null default '',
  fgas_cert text not null default '',
  app_url text not null default '',
  report_email text not null default '',
  auto_email_reports boolean not null default false,
  default_interval_months int not null default 12 check (default_interval_months between 1 and 120),
  reminder_lead_days int not null default 30 check (reminder_lead_days between 0 and 365),
  chase_after_days int not null default 14 check (chase_after_days between 0 and 365),
  warranty_years int not null default 5 check (warranty_years between 0 and 50),
  email_subject text not null default '',
  email_body text not null default '',
  sms_body text not null default '',
  accounts_app text not null default 'xero' check (accounts_app in ('xero', 'quickbooks', 'sage')),
  vat_registered boolean not null default false,
  payment_days int not null default 14 check (payment_days between 0 and 365),
  xero_account_code text not null default '200',
  xero_tax_type text not null default '20% (VAT on Income)',
  xero_tracking_name text not null default '',
  xero_tracking_option text not null default '',
  qb_item text not null default 'Services',
  qb_tax_code text not null default '20.0% S',
  sage_nominal text not null default '4000',
  sage_tax_code text not null default 'T1',
  sage_no_vat_code text not null default 'T9',
  updated_at timestamptz not null default now()
);
select public.apply_tenant_rules('org_settings', 'members-read');

-- ---------- clients ----------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  legacy_id text,
  name text not null check (btrim(name) <> ''),
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  preferred_contact text not null default 'Email' check (preferred_contact in ('Email', 'Phone', 'Text message', 'WhatsApp')),
  billing_address text not null default '',
  postcode text not null default '',
  on_service_plan boolean not null default false,
  reminders_opt_in boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users on delete set null,
  deleted_at timestamptz,
  unique (id, org_id),
  unique (org_id, legacy_id)
);
select public.apply_tenant_rules('clients', 'members');

-- ---------- systems (installs) ----------
create table public.systems (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  legacy_id text,
  client_id uuid not null,
  name text not null check (btrim(name) <> ''),
  site_address text not null default '',
  site_postcode text not null default '',
  install_date date,
  commissioned_by text not null default '',
  service_interval_months int check (service_interval_months between 1 and 120),
  warranty_years int check (warranty_years between 0 and 50),
  refrigerant text not null default '',
  gwp numeric check (gwp >= 0),
  factory_charge_kg numeric check (factory_charge_kg >= 0),
  added_charge_kg numeric check (added_charge_kg >= 0),
  hermetic boolean not null default false,
  leak_detection boolean not null default false,
  access_notes text not null default '',
  notes text not null default '',
  inactive boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users on delete set null,
  deleted_at timestamptz,
  unique (id, org_id),
  unique (org_id, legacy_id),
  foreign key (client_id, org_id) references public.clients (id, org_id)
);
create index on public.systems (org_id, client_id);
select public.apply_tenant_rules('systems', 'members');

create table public.contact_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  system_id uuid not null,
  date date not null,
  method text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users on delete set null,
  foreign key (system_id, org_id) references public.systems (id, org_id) on delete cascade
);
create index on public.contact_logs (system_id, date);
select public.apply_tenant_rules('contact_logs', 'members', 'members');

-- ---------- units and stickers ----------
-- Sticker codes are unique across all businesses, so a scan never opens another business's unit.
create table public.sticker_reservations (
  code text primary key check (code ~ '^AC-[A-Z0-9]{5}$'),
  org_id uuid not null references public.orgs on delete cascade,
  reserved_at timestamptz not null default now(),
  reserved_by uuid default auth.uid() references auth.users on delete set null
);
select public.apply_tenant_rules('sticker_reservations', 'members');

create table public.units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  sticker_code text not null unique check (sticker_code ~ '^AC-[A-Z0-9]{5}$'),
  system_id uuid not null,
  role text not null check (role in ('outdoor', 'indoor')),
  indoor_type text check (indoor_type in ('Wall mounted', 'Cassette', 'Ducted', 'Floor console', 'Ceiling suspended', 'Other')),
  manufacturer text not null default '',
  model text not null default '',
  serial text not null default '',
  capacity_kw numeric check (capacity_kw >= 0),
  location text not null default '',
  filter_type text check (filter_type in ('Washable', 'Replaceable', 'None')),
  controller text check (controller in ('Wireless remote', 'Wired controller', 'Wi-Fi / app', 'None')),
  condensate_pump boolean not null default false,
  from_sticker boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users on delete set null,
  unique (id, org_id),
  foreign key (system_id, org_id) references public.systems (id, org_id),
  -- Indoor-only details are cleared for outdoor units.
  check (role = 'indoor' or (indoor_type is null and filter_type is null and controller is null and not condensate_pump))
);
create index on public.units (org_id, system_id);
select public.apply_tenant_rules('units', 'members', 'members');

-- A sticker another business reserved can't be used here.
create or replace function public.check_sticker_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from public.sticker_reservations where code = new.sticker_code and org_id <> new.org_id) then
    raise exception 'Sticker % belongs to another business', new.sticker_code using errcode = '23505';
  end if;
  return new;
end $$;
create trigger check_sticker_owner before insert or update of sticker_code on public.units
  for each row execute function public.check_sticker_owner();

-- Reserves n new sticker codes for printing (1–210, ten A4 sheets). Members can print stickers.
create or replace function public.reserve_stickers(p_org uuid, p_count int) returns setof text
language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  made int := 0;
begin
  if not public.is_member(p_org) then raise exception 'Not a member of this business' using errcode = '42501'; end if;
  if p_count is null or p_count < 1 or p_count > 210 then raise exception 'Choose between 1 and 210 stickers'; end if;
  while made < p_count loop
    select 'AC-' || string_agg(substr(alphabet, 1 + (get_byte(b, i) % 32), 1), '' order by i)
      into code from (select gen_random_bytes(5) b) r, generate_series(0, 4) i;
    if not exists(select 1 from public.units where sticker_code = code) then
      insert into public.sticker_reservations (code, org_id) values (code, p_org) on conflict do nothing;
      if found then made := made + 1; return next code; end if;
    end if;
  end loop;
end $$;

-- ---------- materials (no prices) ----------
create table public.materials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  legacy_id text,
  name text not null check (btrim(name) <> ''),
  supplier text not null default '',
  sku text not null default '',
  applies_to text not null default 'visit'
    check (applies_to in ('visit', 'indoor', 'outdoor', 'wall', 'cassette', 'ducted', 'console', 'pump', 'filter', 'remote')),
  qty_per numeric not null default 1 check (qty_per > 0),
  needed_when text not null default 'service' check (needed_when in ('service', 'leak', 'any', 'pick')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users on delete set null,
  deleted_at timestamptz,
  unique (id, org_id),
  unique (org_id, legacy_id)
);
select public.apply_tenant_rules('materials', 'members-read');

-- ---------- files (photos, signatures, report PDFs) ----------
create table public.files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  bucket text not null check (bucket in ('photos', 'reports')),
  path text not null,
  kind text not null check (kind in ('photo', 'signature', 'report_pdf')),
  content_type text not null default '',
  size_bytes bigint check (size_bytes >= 0),
  sha256 text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users on delete set null,
  unique (id, org_id),
  unique (bucket, path),
  -- Files live in the business's own folder.
  check (split_part(path, '/', 1) = org_id::text)
);
select public.apply_tenant_rules('files', 'members');

-- ---------- jobs ----------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  legacy_id text,
  system_id uuid not null,
  type text not null check (type in ('Annual service', 'Service + repair', 'Leak check', 'Repair / breakdown',
    'Installation', 'Commissioning', 'Survey')),
  status text not null default 'booked' check (status in ('booked', 'completed', 'cancelled')),
  date date,
  time time,
  duration_hrs numeric check (duration_hrs >= 0),
  engineer text not null default '',
  notes text not null default '',
  materials_ordered boolean not null default false,
  completed_at timestamptz,
  completion_notes text not null default '',
  -- How a completed job was billed: waiting, covered by the plan, plan plus extras, or charged.
  billing text not null default 'none' check (billing in ('none', 'pending', 'plan', 'plan-extras', 'charged')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users on delete set null,
  deleted_at timestamptz,
  unique (id, org_id),
  unique (org_id, legacy_id),
  foreign key (system_id, org_id) references public.systems (id, org_id),
  check (status <> 'completed' or completed_at is not null)
);
create index on public.jobs (org_id, date);
create index on public.jobs (system_id, status);
select public.apply_tenant_rules('jobs', 'members');

create table public.job_unit_checks (
  job_id uuid not null,
  unit_id uuid not null,
  org_id uuid not null references public.orgs on delete cascade,
  checks text[] not null default '{}',
  off_coil numeric,
  on_coil numeric,
  amps numeric,
  pressure numeric,
  notes text not null default '',
  primary key (job_id, unit_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade,
  foreign key (unit_id, org_id) references public.units (id, org_id) on delete cascade
);
select public.apply_tenant_rules('job_unit_checks', 'members', 'members');

create table public.job_leak_checks (
  job_id uuid primary key,
  org_id uuid not null references public.orgs on delete cascade,
  performed boolean not null default false,
  method text not null default '',
  result text check (result in ('pass', 'fail')),
  added_kg numeric check (added_kg >= 0),
  recovered_kg numeric check (recovered_kg >= 0),
  notes text not null default '',
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade
);
select public.apply_tenant_rules('job_leak_checks', 'members', 'members');

create table public.job_commissioning (
  job_id uuid primary key,
  org_id uuid not null references public.orgs on delete cascade,
  pressure_bar numeric,
  pressure_mins numeric,
  pressure_held boolean,
  vacuum_microns numeric,
  decay_held boolean,
  pipe_m numeric,
  added_kg numeric check (added_kg >= 0),
  customer_name text not null default '',
  handover boolean not null default false,
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade
);
select public.apply_tenant_rules('job_commissioning', 'members', 'members');

-- Parts on a job: 'ordered' is the list frozen when parts were ordered, 'used' what the engineer used.
create table public.job_parts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  job_id uuid not null,
  list text not null check (list in ('ordered', 'used')),
  material_id uuid,
  name text not null,
  sku text not null default '',
  supplier text not null default '',
  qty numeric not null check (qty >= 0),
  raw_qty numeric,
  extra boolean not null default false,
  position int not null default 0,
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade,
  foreign key (material_id, org_id) references public.materials (id, org_id)
);
create index on public.job_parts (job_id, list);
select public.apply_tenant_rules('job_parts', 'members', 'members');

create table public.job_signoffs (
  job_id uuid primary key,
  org_id uuid not null references public.orgs on delete cascade,
  engineer_name text not null,
  engineer_cert text not null default '',
  engineer_signature_file_id uuid not null,
  customer_name text not null default '',
  client_email text not null default '',
  customer_absent boolean not null default false,
  absent_note text not null default '',
  customer_signature_file_id uuid,
  signed_at timestamptz not null default now(),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade,
  foreign key (engineer_signature_file_id, org_id) references public.files (id, org_id),
  foreign key (customer_signature_file_id, org_id) references public.files (id, org_id),
  -- The customer signs, or there's a reason they couldn't.
  check (customer_signature_file_id is not null or (customer_absent and btrim(absent_note) <> ''))
);
select public.apply_tenant_rules('job_signoffs', 'members', 'members');

-- ---------- site records ----------
create table public.site_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  legacy_id text,
  system_id uuid not null,
  unit_id uuid,
  job_id uuid,
  kind text not null check (kind in ('Service report', 'Install / commissioning report', 'Site note',
    'Defect / remedial', 'Customer request', 'Photos')),
  date date not null default current_date,
  author text not null default '',
  text text not null default '',
  photo_file_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users on delete set null,
  unique (org_id, legacy_id),
  foreign key (system_id, org_id) references public.systems (id, org_id) on delete cascade,
  foreign key (unit_id, org_id) references public.units (id, org_id) on delete set null (unit_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete set null (job_id),
  check (btrim(text) <> '' or cardinality(photo_file_ids) > 0)
);
create index on public.site_records (system_id, date);
select public.apply_tenant_rules('site_records', 'members', 'members');

-- ---------- service reports (write-once) ----------
create table public.service_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  job_id uuid not null,
  ref text not null check (ref ~ '^(SR|CR)-[0-9]{6}-[A-Z0-9]{4}$'),
  rev int not null check (rev >= 1),
  hash text not null,
  pdf_file_id uuid not null,
  issued_at timestamptz not null default now(),
  issued_by uuid default auth.uid() references auth.users on delete set null,
  unique (id, org_id),
  unique (job_id, rev),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade,
  foreign key (pdf_file_id, org_id) references public.files (id, org_id)
);
select public.apply_tenant_rules('service_reports', 'members');
-- Issued reports can't be changed or removed by anyone in the app; a re-issue is a new revision.
drop policy "edit" on public.service_reports;
drop policy "delete" on public.service_reports;

create table public.report_sends (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  report_id uuid not null,
  via text not null check (via in ('email', 'share', 'download', 'mail-app')),
  sent_to text not null default '',
  sent_at timestamptz not null default now(),
  sent_by uuid default auth.uid() references auth.users on delete set null,
  foreign key (report_id, org_id) references public.service_reports (id, org_id) on delete cascade
);
select public.apply_tenant_rules('report_sends', 'members');
drop policy "edit" on public.report_sends;
drop policy "delete" on public.report_sends;

-- ==================== owner only: prices and invoices ====================
create table public.price_list (
  org_id uuid primary key references public.orgs on delete cascade,
  labour_first numeric check (labour_first >= 0),
  labour_additional numeric check (labour_additional >= 0),
  labour_hourly numeric check (labour_hourly >= 0),
  leak_check_charge numeric check (leak_check_charge >= 0),
  refrigerant_per_kg numeric check (refrigerant_per_kg >= 0),
  callout_charge numeric check (callout_charge >= 0),
  updated_at timestamptz not null default now()
);
select public.apply_tenant_rules('price_list', 'owners');

create table public.material_prices (
  material_id uuid primary key,
  org_id uuid not null references public.orgs on delete cascade,
  cost numeric check (cost >= 0),
  sell numeric check (sell >= 0),
  chargeable boolean not null default false,
  updated_at timestamptz not null default now(),
  foreign key (material_id, org_id) references public.materials (id, org_id) on delete cascade
);
select public.apply_tenant_rules('material_prices', 'owners');

-- How a client pays: plan price and billing, and their names in the accounts software.
create table public.client_billing (
  client_id uuid primary key,
  org_id uuid not null references public.orgs on delete cascade,
  plan_price numeric check (plan_price >= 0),
  plan_billing text check (plan_billing in ('separate', 'visit')),
  accounts_name text not null default '',
  sage_ref text not null default '',
  updated_at timestamptz not null default now(),
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete cascade
);
select public.apply_tenant_rules('client_billing', 'owners');

create table public.job_quotes (
  job_id uuid primary key,
  org_id uuid not null references public.orgs on delete cascade,
  quote numeric not null check (quote >= 0),
  updated_at timestamptz not null default now(),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade
);
select public.apply_tenant_rules('job_quotes', 'owners');

create table public.invoice_counters (
  org_id uuid primary key references public.orgs on delete cascade,
  prefix text not null default '',
  next_number int not null default 1001 check (next_number >= 1),
  updated_at timestamptz not null default now()
);
select public.apply_tenant_rules('invoice_counters', 'owners');

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  legacy_id text,
  number text not null,
  client_id uuid not null,
  job_id uuid,
  date date not null,
  due_date date,
  reference text not null default '',
  vat_rate numeric not null default 0 check (vat_rate in (0, 0.2)),
  status text not null default 'draft' check (status in ('draft', 'exported')),
  exported_at timestamptz,
  auto boolean not null default false,
  -- For automatic sync to Xero, QuickBooks and Sage later (specs/05-integrations.md).
  external_system text check (external_system in ('xero', 'quickbooks', 'sage')),
  external_id text,
  sync_status text check (sync_status in ('pending', 'synced', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users on delete set null,
  unique (id, org_id),
  unique (org_id, number),
  unique (org_id, legacy_id),
  -- One invoice per job.
  unique (job_id),
  foreign key (client_id, org_id) references public.clients (id, org_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete set null (job_id)
);
select public.apply_tenant_rules('invoices', 'owners');

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  invoice_id uuid not null,
  position int not null default 0,
  description text not null check (btrim(description) <> ''),
  qty numeric not null,
  unit_price numeric not null,
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade
);
create index on public.invoice_lines (invoice_id, position);
select public.apply_tenant_rules('invoice_lines', 'owners');

-- Creates an invoice with the business's next number. Owners only. Numbers are taken under a row lock so two
-- devices can't get the same one, and a job only ever gets one invoice: calling again returns the first.
create or replace function public.create_invoice(
  p_org uuid, p_client uuid, p_job uuid, p_date date, p_due_date date, p_reference text,
  p_vat boolean, p_lines jsonb, p_auto boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  inv uuid;
  num text;
begin
  if not public.is_owner(p_org) then raise exception 'Only business owners can create invoices' using errcode = '42501'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'An invoice needs at least one line'; end if;
  if p_job is not null then
    select id into inv from public.invoices where job_id = p_job;
    if found then return inv; end if;
    -- Lock the job so two owners' devices drafting it at once can't both get past the check above.
    perform 1 from public.jobs where id = p_job and org_id = p_org for update;
    if not found then raise exception 'Job not found'; end if;
    select id into inv from public.invoices where job_id = p_job;
    if found then return inv; end if;
  end if;

  insert into public.invoice_counters (org_id) values (p_org) on conflict (org_id) do nothing;
  update public.invoice_counters set next_number = next_number + 1
    where org_id = p_org returning prefix || (next_number - 1) into num;

  insert into public.invoices (org_id, number, client_id, job_id, date, due_date, reference, vat_rate, auto)
    values (p_org, num, p_client, p_job, p_date, p_due_date, coalesce(p_reference, ''), case when p_vat then 0.2 else 0 end, p_auto)
    returning id into inv;
  insert into public.invoice_lines (org_id, invoice_id, position, description, qty, unit_price)
    select p_org, inv, (l.ord - 1)::int, l.v ->> 'desc', (l.v ->> 'qty')::numeric, (l.v ->> 'unit')::numeric
    from jsonb_array_elements(p_lines) with ordinality as l(v, ord);
  if p_job is not null then
    update public.jobs set billing = case when exists(select 1 from public.clients c where c.id = p_client and c.on_service_plan)
      then 'plan-extras' else 'charged' end where id = p_job;
  end if;
  return inv;
end $$;

-- ---------- audit log of sensitive actions (owners read; written only by triggers) ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs on delete cascade,
  actor uuid default auth.uid(),
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}',
  at timestamptz not null default now()
);
create index on public.audit_log (org_id, at desc);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon;
create policy "owners read" on public.audit_log for select to authenticated using (public.is_owner(org_id));

create or replace function public.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  row_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  row_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r jsonb := coalesce(row_new, row_old);
  what text := lower(tg_op);
begin
  if tg_table_name = 'invoices' and tg_op = 'UPDATE' then
    if row_new ->> 'status' is distinct from row_old ->> 'status' then what := 'status ' || (row_new ->> 'status');
    else return null; end if;
  end if;
  -- Nothing to log when the whole business is being deleted.
  if not exists(select 1 from public.orgs where id = (r ->> 'org_id')::uuid) then return null; end if;
  insert into public.audit_log (org_id, action, entity, entity_id, detail)
    values ((r ->> 'org_id')::uuid, what, tg_table_name,
            coalesce(r ->> 'id', r ->> 'material_id', r ->> 'client_id', r ->> 'user_id', r ->> 'org_id'),
            jsonb_strip_nulls(jsonb_build_object('before', row_old, 'after', row_new)));
  return null;
end $$;

create trigger audit after insert or update or delete on public.price_list for each row execute function public.audit();
create trigger audit after insert or update or delete on public.material_prices for each row execute function public.audit();
create trigger audit after insert or update or delete on public.client_billing for each row execute function public.audit();
create trigger audit after update or delete on public.invoices for each row execute function public.audit();
create trigger audit after delete on public.members for each row execute function public.audit();

-- New businesses get a settings row and an invoice counter.
create or replace function public.init_org_rows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.org_settings (org_id) values (new.id) on conflict do nothing;
  insert into public.invoice_counters (org_id) values (new.id) on conflict do nothing;
  return null;
end $$;
create trigger init_org_rows after insert on public.orgs for each row execute function public.init_org_rows();
insert into public.org_settings (org_id) select id from public.orgs on conflict do nothing;
insert into public.invoice_counters (org_id) select id from public.orgs on conflict do nothing;

-- ---------- function permissions ----------
revoke all on function public.apply_tenant_rules(text, text, text), public.audit(), public.init_org_rows(),
  public.check_sticker_owner(), public.guard_soft_delete(), public.guard_org_id() from public, anon, authenticated;
revoke all on function public.reserve_stickers(uuid, int),
  public.create_invoice(uuid, uuid, uuid, date, date, text, boolean, jsonb, boolean) from public, anon;
grant execute on function public.reserve_stickers(uuid, int),
  public.create_invoice(uuid, uuid, uuid, date, date, text, boolean, jsonb, boolean), public.is_member(uuid) to authenticated;

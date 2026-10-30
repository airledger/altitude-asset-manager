-- Copies the made-up beta records (demo-data.sql) from public.docs into the new typed tables, so the rebuilt
-- app has the same test clients, installs, units, materials, jobs and prices to show. Run after demo-data.sql.
-- Safe to re-run: it replaces the demo rows. Only touches rows whose old id starts "demo-" or "AC-DMZ".
\set ON_ERROR_STOP on
begin;

create temp table demo_org as select id from public.orgs order by created_at limit 1;
create temp table d as
  select col, id, data from public.docs
  where org_id = (select id from demo_org) and (id like 'demo-%' or id like 'AC-DMZ%');

-- Clear the previous copy (children first; prices and invoices go with their parents).
delete from public.jobs where org_id = (select id from demo_org) and legacy_id like 'demo-%';
delete from public.units where org_id = (select id from demo_org) and sticker_code like 'AC-DMZ%';
delete from public.systems where org_id = (select id from demo_org) and legacy_id like 'demo-%';
delete from public.clients where org_id = (select id from demo_org) and legacy_id like 'demo-%';
delete from public.materials where org_id = (select id from demo_org) and legacy_id like 'demo-%';

create function pg_temp.num(v jsonb) returns numeric language sql immutable as
  $$ select case when jsonb_typeof(v) = 'number' then v::text::numeric
                 when jsonb_typeof(v) = 'string' and v #>> '{}' ~ '^\s*-?[0-9]*\.?[0-9]+\s*$' then (v #>> '{}')::numeric end $$;
create function pg_temp.txt(v jsonb) returns text language sql immutable as $$ select coalesce(v #>> '{}', '') $$;

insert into public.clients (org_id, legacy_id, name, contact_name, phone, email, preferred_contact, billing_address,
  postcode, on_service_plan, reminders_opt_in)
select (select id from demo_org), id, data ->> 'name', pg_temp.txt(data -> 'contactName'), pg_temp.txt(data -> 'phone'),
  pg_temp.txt(data -> 'email'), coalesce(nullif(data ->> 'preferredContact', ''), 'Email'),
  pg_temp.txt(data -> 'billingAddress'), pg_temp.txt(data -> 'postcode'),
  data ->> 'servicePlan' = 'Annual service plan', coalesce((data ->> 'remindersOptIn')::boolean, true)
from d where col = 'clients';

insert into public.client_billing (org_id, client_id, plan_billing)
select c.org_id, c.id, data ->> 'planBilling'
from d join public.clients c on c.legacy_id = d.id and c.org_id = (select id from demo_org)
where d.col = 'clients' and data ->> 'planBilling' in ('separate', 'visit');

insert into public.systems (org_id, legacy_id, client_id, name, site_address, site_postcode, install_date,
  service_interval_months, refrigerant, factory_charge_kg, added_charge_kg, hermetic, leak_detection, access_notes)
select (select id from demo_org), d.id, c.id, data ->> 'name', pg_temp.txt(data -> 'siteAddress'),
  pg_temp.txt(data -> 'sitePostcode'), nullif(data ->> 'installDate', '')::date,
  pg_temp.num(data -> 'serviceIntervalMonths')::int, pg_temp.txt(data -> 'refrigerant'),
  pg_temp.num(data -> 'factoryChargeKg'), pg_temp.num(data -> 'addedChargeKg'),
  coalesce((data ->> 'hermetic')::boolean, false), coalesce((data ->> 'leakDetection')::boolean, false),
  pg_temp.txt(data -> 'accessNotes')
from d join public.clients c on c.legacy_id = d.data ->> 'clientId' and c.org_id = (select id from demo_org)
where d.col = 'systems';

insert into public.contact_logs (org_id, system_id, date, method, note)
select s.org_id, s.id, (e ->> 'date')::date, pg_temp.txt(e -> 'method'), pg_temp.txt(e -> 'note')
from d join public.systems s on s.legacy_id = d.id and s.org_id = (select id from demo_org),
  jsonb_array_elements(coalesce(d.data -> 'contactLog', '[]')) e
where d.col = 'systems';

insert into public.units (org_id, sticker_code, system_id, role, indoor_type, manufacturer, model, serial, location,
  filter_type, controller, condensate_pump)
select (select id from demo_org), d.id, s.id, data ->> 'role',
  case when data ->> 'role' = 'indoor' then nullif(data ->> 'indoorType', '') end,
  pg_temp.txt(data -> 'manufacturer'), pg_temp.txt(data -> 'model'), pg_temp.txt(data -> 'serial'),
  pg_temp.txt(data -> 'location'),
  case when data ->> 'role' = 'indoor' then nullif(data ->> 'filterType', '') end,
  case when data ->> 'role' = 'indoor' then nullif(data ->> 'controller', '') end,
  data ->> 'role' = 'indoor' and coalesce((data ->> 'condensatePump')::boolean, false)
from d join public.systems s on s.legacy_id = d.data ->> 'systemId' and s.org_id = (select id from demo_org)
where d.col = 'units';

insert into public.materials (org_id, legacy_id, name, supplier, sku, applies_to, qty_per, needed_when, active)
select (select id from demo_org), id, data ->> 'name', pg_temp.txt(data -> 'supplier'), pg_temp.txt(data -> 'sku'),
  coalesce(nullif(data ->> 'appliesTo', ''), 'visit'), coalesce(pg_temp.num(data -> 'qtyPer'), 1),
  coalesce(nullif(data ->> 'when', ''), 'service'), coalesce((data ->> 'active')::boolean, true)
from d where col = 'materials';

insert into public.jobs (org_id, legacy_id, system_id, type, status, date, time, duration_hrs, engineer, notes,
  completed_at, completion_notes, billing)
select (select id from demo_org), d.id, s.id, data ->> 'type', data ->> 'status', nullif(data ->> 'date', '')::date,
  nullif(data ->> 'time', '')::time, pg_temp.num(data -> 'durationHrs'), pg_temp.txt(data -> 'engineer'),
  pg_temp.txt(data -> 'notes'),
  case when data ->> 'status' = 'completed' then coalesce(nullif(data ->> 'completedAt', '')::timestamptz, now()) end,
  pg_temp.txt(data -> 'completionNotes'), coalesce(nullif(data ->> 'billing', ''), 'none')
from d join public.systems s on s.legacy_id = d.data ->> 'systemId' and s.org_id = (select id from demo_org)
where d.col = 'jobs';

insert into public.job_leak_checks (org_id, job_id, performed, method, result, added_kg, recovered_kg)
select j.org_id, j.id, coalesce((lc ->> 'performed')::boolean, false), pg_temp.txt(lc -> 'method'),
  nullif(lc ->> 'result', ''), pg_temp.num(lc -> 'addedKg'), pg_temp.num(lc -> 'recoveredKg')
from d join public.jobs j on j.legacy_id = d.id and j.org_id = (select id from demo_org),
  lateral (select d.data -> 'leakCheck' lc) x
where d.col = 'jobs' and jsonb_typeof(lc) = 'object';

-- Made-up prices, so owners see invoices priced on beta. Engineers never see these.
insert into public.price_list (org_id, labour_first, labour_additional, labour_hourly, leak_check_charge,
  refrigerant_per_kg, callout_charge)
values ((select id from demo_org), 95, 45, 60, 40, 60, 75)
on conflict (org_id) do nothing;
insert into public.material_prices (org_id, material_id, cost, sell, chargeable)
select m.org_id, m.id, p.cost, p.sell, p.chargeable
from public.materials m join (values ('demo-m1', 6.5, 9, false), ('demo-m2', 4, 6, false), ('demo-m3', 8, 14, true),
  ('demo-m4', 3, 5, true), ('demo-m5', 7.5, 18, true)) as p(legacy_id, cost, sell, chargeable) using (legacy_id)
where m.org_id = (select id from demo_org);
update public.client_billing set plan_price = 180
where client_id = (select id from public.clients where org_id = (select id from demo_org) and legacy_id = 'demo-c4');

commit;
select 'clients' t, count(*) from public.clients where legacy_id like 'demo-%'
union all select 'systems', count(*) from public.systems where legacy_id like 'demo-%'
union all select 'units', count(*) from public.units where sticker_code like 'AC-DMZ%'
union all select 'materials', count(*) from public.materials where legacy_id like 'demo-%'
union all select 'jobs', count(*) from public.jobs where legacy_id like 'demo-%'
union all select 'contact_logs', count(*) from public.contact_logs c join public.systems s on s.id = c.system_id
  where s.legacy_id like 'demo-%';

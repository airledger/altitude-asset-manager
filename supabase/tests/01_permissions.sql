-- Permission tests for specs/04-tenancy-roles-security.md. Run with `supabase test db`.
-- Two businesses: A (owner Olivia, engineer Ed) and B (owner Bea).
begin;
create extension if not exists pgtap with schema extensions;
select plan(85);

-- ---------- set-up, as the database owner ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'olivia@a.test'),
  ('00000000-0000-0000-0000-00000000000e', 'ed@a.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@b.test');
insert into public.orgs (id, name) values
  ('a0000000-0000-0000-0000-000000000000', 'Business A'),
  ('b0000000-0000-0000-0000-000000000000', 'Business B');
insert into public.members (org_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000e', 'member'),
  ('b0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000b', 'owner');

-- One of everything in each business.
create function pg_temp.seed(o uuid, n int) returns void language plpgsql as $$
declare c uuid := gen_random_uuid(); s uuid := gen_random_uuid(); u uuid := gen_random_uuid();
        j uuid := gen_random_uuid(); m uuid := gen_random_uuid(); f uuid := gen_random_uuid(); r uuid := gen_random_uuid();
        i uuid := gen_random_uuid();
begin
  insert into public.clients (id, org_id, name, on_service_plan) values (c, o, 'Client ' || n, true);
  insert into public.systems (id, org_id, client_id, name) values (s, o, c, 'System ' || n);
  insert into public.contact_logs (org_id, system_id, date) values (o, s, current_date);
  insert into public.units (id, org_id, system_id, sticker_code, role) values (u, o, s, 'AC-TEST' || n, 'outdoor');
  insert into public.materials (id, org_id, name) values (m, o, 'Coil cleaner');
  insert into public.jobs (id, org_id, system_id, type) values (j, o, s, 'Annual service');
  insert into public.job_unit_checks (org_id, job_id, unit_id) values (o, j, u);
  insert into public.job_leak_checks (org_id, job_id) values (o, j);
  insert into public.job_commissioning (org_id, job_id) values (o, j);
  insert into public.job_parts (org_id, job_id, list, material_id, name, qty) values (o, j, 'used', m, 'Coil cleaner', 1);
  insert into public.files (id, org_id, bucket, path, kind) values (f, o, 'reports', o || '/report.pdf', 'report_pdf');
  insert into public.job_signoffs (org_id, job_id, engineer_name, engineer_signature_file_id, customer_absent, absent_note)
    values (o, j, 'Ed', f, true, 'Out');
  insert into public.site_records (org_id, system_id, kind, text) values (o, s, 'Site note', 'Note');
  insert into public.service_reports (id, org_id, job_id, ref, rev, hash, pdf_file_id) values (r, o, j, 'SR-261030-ABCD', 1, 'h', f);
  insert into public.report_sends (org_id, report_id, via) values (o, r, 'email');
  insert into public.sticker_reservations (code, org_id) values ('AC-RES0' || n, o);
  update public.price_list set labour_first = 95 where org_id = o;
  insert into public.price_list (org_id, labour_first) values (o, 95) on conflict do nothing;
  insert into public.material_prices (org_id, material_id, sell, chargeable) values (o, m, 4.5, true);
  insert into public.client_billing (org_id, client_id, plan_price) values (o, c, 120);
  insert into public.job_quotes (org_id, job_id, quote) values (o, j, 2500);
  insert into public.invoices (id, org_id, number, client_id, job_id, date) values (i, o, 'SEED-' || n, c, j, current_date);
  insert into public.invoice_lines (org_id, invoice_id, description, qty, unit_price) values (o, i, 'Service', 1, 95);
  insert into public.audit_log (org_id, action, entity) values (o, 'seed', 'test');
end $$;
select pg_temp.seed('a0000000-0000-0000-0000-000000000000', 1);
select pg_temp.seed('b0000000-0000-0000-0000-000000000000', 2);

-- Rows of a table the current user can see, in one business.
create function pg_temp.visible(t text, o uuid) returns bigint language plpgsql as $$
declare n bigint;
begin execute format('select count(*) from public.%I where org_id = $1', t) into n using o; return n; end $$;
-- Rows an update or delete changed (0 when row-level security hides them).
create function pg_temp.affected(q text) returns bigint language plpgsql as $$
declare n bigint;
begin execute q; get diagnostics n = row_count; return n; end $$;
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ---------- business settings rows are made for new businesses ----------
select is((select count(*) from public.org_settings where org_id = 'a0000000-0000-0000-0000-000000000000'), 1::bigint,
  'a new business gets a settings row');
select is((select next_number from public.invoice_counters where org_id = 'a0000000-0000-0000-0000-000000000000'), 1001,
  'a new business''s invoices start at 1001');

-- ---------- engineer (Ed, business A) ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;

select is(pg_temp.visible(t, 'a0000000-0000-0000-0000-000000000000'), 1::bigint, 'engineer reads own business: ' || t)
from unnest(array['org_settings', 'clients', 'systems', 'contact_logs', 'units', 'materials', 'jobs', 'job_unit_checks',
  'job_leak_checks', 'job_commissioning', 'job_parts', 'job_signoffs', 'files', 'site_records', 'service_reports',
  'report_sends', 'sticker_reservations']) t;

select is(pg_temp.visible(t, 'b0000000-0000-0000-0000-000000000000'), 0::bigint, 'engineer can''t read business B: ' || t)
from unnest(array['org_settings', 'clients', 'systems', 'units', 'jobs', 'job_parts', 'files', 'site_records',
  'service_reports', 'sticker_reservations']) t;

select is(pg_temp.visible(t, 'a0000000-0000-0000-0000-000000000000'), 0::bigint, 'engineer can''t read prices: ' || t)
from unnest(array['price_list', 'material_prices', 'client_billing', 'job_quotes', 'invoice_counters', 'invoices',
  'invoice_lines', 'audit_log']) t;

select throws_ok($$insert into public.price_list (org_id, labour_first) values ('a0000000-0000-0000-0000-000000000000', 1)
  on conflict (org_id) do update set labour_first = 1$$, '42501', null, 'engineer can''t set prices');
select throws_ok($$insert into public.job_quotes (org_id, job_id, quote)
  select org_id, id, 1 from public.jobs limit 1$$, '42501', null, 'engineer can''t add a quote');
select throws_ok($$insert into public.materials (org_id, name) values ('a0000000-0000-0000-0000-000000000000', 'X')$$,
  '42501', null, 'engineer can''t add to the materials catalogue');
select is(pg_temp.affected($q$update public.org_settings set phone = 'x'$q$), 0::bigint,
  'engineer can''t change business settings');
select throws_ok($$select public.create_invoice('a0000000-0000-0000-0000-000000000000',
  (select id from public.clients limit 1), null, current_date, null, '', true, '[{"desc":"x","qty":1,"unit":1}]')$$,
  '42501', null, 'engineer can''t create invoices');

select lives_ok($$insert into public.clients (org_id, name) values ('a0000000-0000-0000-0000-000000000000', 'New client')$$,
  'engineer adds a client');
select is(pg_temp.affected($q$update public.jobs set notes = 'Bring ladder'$q$), 1::bigint,
  'engineer edits a job');
select is(pg_temp.affected($q$delete from public.clients where name = 'New client'$q$), 0::bigint,
  'engineer can''t delete a client');
select is(pg_temp.affected($q$delete from public.jobs$q$), 0::bigint,
  'engineer can''t delete a job');
select throws_ok($$update public.jobs set deleted_at = now()$$, '42501', null, 'engineer can''t hide (soft delete) a job');
select is(pg_temp.affected($q$delete from public.contact_logs$q$), 1::bigint,
  'engineer deletes a contact log entry');

select throws_ok($$insert into public.clients (org_id, name) values ('b0000000-0000-0000-0000-000000000000', 'Sneaky')$$,
  '42501', null, 'engineer can''t add records to business B');
select is(pg_temp.affected($q$update public.clients set name = 'Hacked' where org_id = 'b0000000-0000-0000-0000-000000000000'
 $q$), 0::bigint, 'engineer can''t edit business B');
select throws_ok($$update public.clients set org_id = 'b0000000-0000-0000-0000-000000000000'$$, '42501', null,
  'engineer can''t move a client to business B');

select is(pg_temp.affected($q$update public.service_reports set hash = 'changed'$q$), 0::bigint,
  'issued reports can''t be changed');
select is(pg_temp.affected($q$delete from public.service_reports$q$), 0::bigint,
  'issued reports can''t be deleted');

select is((select count(*) from public.reserve_stickers('a0000000-0000-0000-0000-000000000000', 21)), 21::bigint,
  'engineer reserves a sheet of 21 stickers');
select ok((select bool_and(code ~ '^AC-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$') from public.sticker_reservations
  where reserved_by = auth.uid()),
  'sticker codes use the unambiguous alphabet');
select throws_ok($$select public.reserve_stickers('b0000000-0000-0000-0000-000000000000', 1)$$, '42501', null,
  'engineer can''t reserve stickers for business B');
select throws_ok($$select public.reserve_stickers('a0000000-0000-0000-0000-000000000000', 500)$$, 'P0001', null,
  'at most 210 stickers at a time');
reset role;

-- ---------- data that can't be linked across businesses ----------
select throws_ok($$insert into public.systems (org_id, client_id, name) values ('a0000000-0000-0000-0000-000000000000',
  (select id from public.clients where org_id = 'b0000000-0000-0000-0000-000000000000'), 'Cross')$$,
  '23503', null, 'a system can''t belong to another business''s client');
select throws_ok($$insert into public.units (org_id, system_id, sticker_code, role) values ('b0000000-0000-0000-0000-000000000000',
  (select id from public.systems where org_id = 'b0000000-0000-0000-0000-000000000000'), 'AC-RES01', 'indoor')$$,
  '23505', null, 'a sticker reserved by business A can''t be used by business B');
select throws_ok($$insert into public.units (org_id, system_id, sticker_code, role) values ('b0000000-0000-0000-0000-000000000000',
  (select id from public.systems where org_id = 'b0000000-0000-0000-0000-000000000000'), 'AC-TEST1', 'indoor')$$,
  '23505', null, 'sticker codes are unique across businesses');
select throws_ok($$insert into public.units (org_id, system_id, sticker_code, role, indoor_type)
  values ('a0000000-0000-0000-0000-000000000000', (select id from public.systems where org_id = 'a0000000-0000-0000-0000-000000000000'),
  'AC-OUT99', 'outdoor', 'Cassette')$$, '23514', null, 'outdoor units have no indoor details');
select throws_ok($$insert into public.files (org_id, bucket, path, kind) values ('a0000000-0000-0000-0000-000000000000',
  'photos', 'b0000000-0000-0000-0000-000000000000/x.jpg', 'photo')$$, '23514', null, 'files live in their business''s folder');
select throws_ok($$update public.job_signoffs set customer_absent = true, absent_note = ''$$, '23514', null,
  'an absent customer needs a reason');

-- ---------- owner (Olivia, business A) ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select is(pg_temp.visible(t, 'a0000000-0000-0000-0000-000000000000'), 1::bigint, 'owner reads prices: ' || t)
from unnest(array['price_list', 'material_prices', 'client_billing', 'job_quotes', 'invoice_counters', 'invoices']) t;
select is(pg_temp.visible('invoices', 'b0000000-0000-0000-0000-000000000000'), 0::bigint, 'owner can''t read business B''s invoices');

create temp table inv as select public.create_invoice('a0000000-0000-0000-0000-000000000000',
  (select id from public.clients where name = 'Client 1'), (select id from public.jobs), current_date, current_date + 14,
  'Annual service', true, '[{"desc":"Service","qty":1,"unit":95},{"desc":"Filter","qty":2,"unit":4.5}]', true) id;
select isnt((select id from inv), null, 'owner creates an invoice');
select is((select number from public.invoices where id = (select id from inv)), 'SEED-1',
  'a job only gets one invoice: the existing one comes back');
create temp table more as select public.create_invoice('a0000000-0000-0000-0000-000000000000',
  (select id from public.clients where name = 'Client 1'), null, current_date, null, '', false,
  '[{"desc":"Extra","qty":1,"unit":10}]') id;
insert into more select public.create_invoice('a0000000-0000-0000-0000-000000000000',
  (select id from public.clients where name = 'Client 1'), null, current_date, null, '', false,
  '[{"desc":"Extra","qty":1,"unit":10}]');
select is((select array_agg(i.number order by i.number) from more join public.invoices i using (id)), array['1001', '1002'],
  'invoices take the next numbers in turn');
select throws_ok($$select public.create_invoice('a0000000-0000-0000-0000-000000000000',
  (select id from public.clients where name = 'Client 1'), null, current_date, null, '', false, '[]')$$,
  'P0001', null, 'an invoice needs lines');

select is(pg_temp.affected($q$update public.price_list set labour_first = 99$q$), 1::bigint,
  'owner changes the price list');
select is((select count(*) from public.audit_log where entity = 'price_list' and action = 'update'), 1::bigint,
  'price changes are logged');
select is(pg_temp.affected($q$update public.org_settings set phone = '0113'$q$), 1::bigint,
  'owner changes business settings');
select is(pg_temp.affected($q$update public.service_reports set hash = 'changed'$q$), 0::bigint,
  'not even owners can change an issued report');
select lives_ok($$update public.jobs set deleted_at = now()$$, 'owner hides a job');
reset role;

-- ---------- signed out ----------
set local role anon;
select throws_ok($$select count(*) from public.clients$$, '42501', null, 'signed out: can''t read clients');
select throws_ok($$select count(*) from public.price_list$$, '42501', null, 'signed out: can''t read prices');
select throws_ok($$select public.reserve_stickers('a0000000-0000-0000-0000-000000000000', 1)$$, '42501', null,
  'signed out: can''t reserve stickers');
select lives_ok($$select * from public.org_public('nobody')$$, 'signed out: branded sign-in lookup works');
reset role;

-- ---------- deleting a business removes everything ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
select lives_ok($$select public.delete_business('b0000000-0000-0000-0000-000000000000')$$, 'owner deletes business B');
reset role;
select is((select count(*) from public.clients where org_id = 'b0000000-0000-0000-0000-000000000000')
  + (select count(*) from public.jobs where org_id = 'b0000000-0000-0000-0000-000000000000')
  + (select count(*) from public.invoices where org_id = 'b0000000-0000-0000-0000-000000000000')
  + (select count(*) from public.units where org_id = 'b0000000-0000-0000-0000-000000000000'), 0::bigint,
  'business B''s records are gone');

select * from finish();
rollback;

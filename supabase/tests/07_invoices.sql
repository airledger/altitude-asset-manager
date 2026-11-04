-- Invoices: owners edit them in one go; only owners decide how a job is billed.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'olivia@a.test'),
  ('00000000-0000-0000-0000-00000000000e', 'ed@a.test');
insert into public.orgs (id, name) values ('a0000000-0000-0000-0000-000000000000', 'Business A');
insert into public.members (org_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000e', 'member');
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated;
insert into public.clients (id, org_id, name) values
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'Harbour Dental');
insert into public.systems (id, org_id, client_id, name) values
  ('50000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a', 'Surgery');
insert into public.jobs (id, org_id, system_id, type, status, date, completed_at, billing) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Annual service', 'completed', '2026-11-03', now(), 'pending'),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Annual service', 'booked', '2026-11-10', null, 'none');

-- ---------- engineers ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
update public.jobs set billing = 'plan' where id = '10000000-0000-0000-0000-000000000001';
reset role;
select is((select billing from public.jobs where id = '10000000-0000-0000-0000-000000000001'), 'pending',
  'an engineer can''t mark a job as covered by a plan');
set local role authenticated;
update public.jobs set billing = 'pending' where id = '10000000-0000-0000-0000-000000000002';
reset role;
select is((select billing from public.jobs where id = '10000000-0000-0000-0000-000000000002'), 'pending',
  'but completing a job still marks it waiting to be invoiced');

-- ---------- owners ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select set_config('t.inv', public.create_invoice('a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a',
  '10000000-0000-0000-0000-000000000001', '2026-11-03', '2026-11-17', 'Annual service', true,
  '[{"desc":"Service","qty":1,"unit":95}]'::jsonb, true)::text, true);
select is((select number from public.invoices), '1001', 'the first invoice is 1001');
select is(public.create_invoice('a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a',
  '10000000-0000-0000-0000-000000000001', '2026-11-03', null, '', false, '[{"desc":"Again","qty":1,"unit":1}]'::jsonb, true)::text,
  current_setting('t.inv'), 'drafting the same job again returns the same invoice');
select public.save_invoice(current_setting('t.inv')::uuid, '2026-11-04', '2026-11-18', 'Ref 2', false,
  '[{"desc":"Service","qty":1,"unit":95},{"desc":"Coil cleaner","qty":2,"unit":12.5}]'::jsonb);
select is((select string_agg(description || ' ' || qty || ' ' || unit_price, ', ' order by position) from public.invoice_lines),
  'Service 1 95, Coil cleaner 2 12.5', 'saving replaces the lines in order');
select is((select vat_rate || ' ' || reference || ' ' || date from public.invoices), '0 Ref 2 2026-11-04',
  'and the details');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select throws_ok(format($$select public.save_invoice(%L, null, null, '', false, '[{"desc":"x","qty":1,"unit":0}]')$$,
  current_setting('t.inv')), '42501', null, 'an engineer can''t change an invoice');
reset role;

select * from finish();
rollback;

-- Review requests: asked once per customer in the set months, only when the business has a link and it's on,
-- only for completed jobs, and never for customers who opted out of reminders.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000e', 'ed@a.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@b.test');
insert into public.orgs (id, name) values
  ('a0000000-0000-0000-0000-000000000000', 'Business A'),
  ('b0000000-0000-0000-0000-000000000000', 'Business B');
insert into public.members (org_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000e', 'member'),
  ('b0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000b', 'owner');
insert into public.org_settings (org_id) values ('a0000000-0000-0000-0000-000000000000')
  on conflict (org_id) do nothing;
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated;
insert into public.clients (id, org_id, name, contact_name, reminders_opt_in) values
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'Harbour Dental', 'Pat', true),
  ('c0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-000000000000', 'No Thanks Ltd', '', false);
insert into public.systems (id, org_id, client_id, name) values
  ('50000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a', 'Surgery'),
  ('50000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000c', 'Office');
insert into public.jobs (id, org_id, system_id, type, status, date, completed_at) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Annual service', 'completed', current_date, now()),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Repair / breakdown', 'completed', current_date, now()),
  ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000c', 'Annual service', 'completed', current_date, now()),
  ('10000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Annual service', 'booked', current_date, null);

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select is((select count(*)::int from public.claim_review_request('10000000-0000-0000-0000-000000000001', 'pat@x.test')), 0,
  'no review link set: nobody is asked');
reset role;
update public.org_settings set review_link = 'https://g.page/r/abc/review' where org_id = 'a0000000-0000-0000-0000-000000000000';
select throws_ok($$ update public.org_settings set review_link = 'javascript:alert(1)' $$, '23514', null,
  'the link must be a web address');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select is((select link || ' ' || business || ' ' || contact
           from public.claim_review_request('10000000-0000-0000-0000-000000000001', 'Pat@X.test')),
  'https://g.page/r/abc/review Business A Pat', 'the first report to a customer asks for a review');
select is((select count(*)::int from public.claim_review_request('10000000-0000-0000-0000-000000000002', 'pat@x.test')), 0,
  'the same customer isn''t asked again within the months set');
select is((select count(*)::int from public.claim_review_request('10000000-0000-0000-0000-000000000003', 'x@x.test')), 0,
  'customers who opted out of reminders aren''t asked');
select is((select count(*)::int from public.claim_review_request('10000000-0000-0000-0000-000000000004', 'pat@x.test')), 0,
  'only completed jobs');
select is((select email from public.review_requests), 'pat@x.test', 'the request is logged for the business');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
select is((select count(*)::int from public.claim_review_request('10000000-0000-0000-0000-000000000002', 'pat@x.test')), 0,
  'another business can''t trigger it');
reset role;

select * from finish();
rollback;

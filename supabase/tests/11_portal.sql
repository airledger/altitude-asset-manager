-- Customer portal: a customer sees only their own client's records, through the portal functions; they can ask
-- for a visit, answer a booked one, and book a free slot only when the business allows it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'olivia@a.test'),
  ('00000000-0000-0000-0000-00000000000e', 'ed@a.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'pat@harbour.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'sam@other.test');
insert into public.orgs (id, name) values ('a0000000-0000-0000-0000-000000000000', 'Business A');
insert into public.members (org_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000e', 'member');
create function pg_temp.as_user(u uuid, email text default '') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'email', email)::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated;
insert into public.clients (id, org_id, name) values
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'Harbour Dental'),
  ('c0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000000', 'Other Client');
insert into public.systems (id, org_id, client_id, name) values
  ('50000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a', 'Surgery'),
  ('50000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000b', 'Elsewhere');
insert into public.jobs (id, org_id, system_id, type, status, date, time, notes) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a',
   'Annual service', 'booked', current_date + 7, '09:30', 'Gate code 1234'),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000b',
   'Annual service', 'booked', current_date + 7, '10:00', '');

-- ---------- inviting ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select throws_ok($$select public.create_portal_invite('c0000000-0000-0000-0000-00000000000a', 'pat@harbour.test')$$,
  '42501', null, 'engineers can''t invite customers');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select set_config('t.code', public.create_portal_invite('c0000000-0000-0000-0000-00000000000a', 'Pat@Harbour.test'), true);
reset role;
set local role anon;
select is((select client_name from public.portal_invite_info(current_setting('t.code'))), 'Harbour Dental',
  'the sign-up screen can say who the invite is from');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2', 'sam@other.test');
set local role authenticated;
select throws_ok(format('select public.accept_portal_invite(%L)', current_setting('t.code')), 'P0001',
  'This portal link was sent to a different email address', 'only the person it was sent to can use it');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', 'pat@harbour.test');
set local role authenticated;
select is(public.accept_portal_invite(current_setting('t.code')), 'c0000000-0000-0000-0000-00000000000a'::uuid,
  'the customer joins their portal');
select is((select client_name from public.my_portals()), 'Harbour Dental', 'and it''s listed for them');

-- ---------- what they see ----------
select is((select count(*)::int from public.jobs), 0, 'no direct access to the business''s jobs');
select is((select count(*)::int from public.clients), 0, 'or clients');
select is(jsonb_array_length(public.portal_overview('c0000000-0000-0000-0000-00000000000a') -> 'visits'), 1,
  'their own visit is in the portal');
select is(public.portal_overview('c0000000-0000-0000-0000-00000000000a')::text like '%Gate code%', false,
  'without the job notes');
select throws_ok($$select public.portal_overview('c0000000-0000-0000-0000-00000000000b')$$, '42501', null,
  'another client''s portal is closed to them');

-- ---------- answering a visit ----------
select public.portal_respond('10000000-0000-0000-0000-000000000001', 'change', 'Mornings are bad, afternoons please');
select throws_ok($$select public.portal_respond('10000000-0000-0000-0000-000000000002', 'accepted')$$, '42501', null,
  'they can''t answer someone else''s visit');
reset role;
select is((select customer_response || ': ' || customer_note from public.jobs where id = '10000000-0000-0000-0000-000000000001'),
  'change: Mornings are bad, afternoons please', 'the business sees they asked for another time');
update public.jobs set time = '14:00' where id = '10000000-0000-0000-0000-000000000001';
select is((select customer_response from public.jobs where id = '10000000-0000-0000-0000-000000000001'), null,
  'moving the visit asks them again');

-- ---------- requests and self-booking ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', 'pat@harbour.test');
set local role authenticated;
select is((select count(*)::int from public.portal_slots('c0000000-0000-0000-0000-00000000000a')), 0,
  'no slots to pick while self-booking is off');
select is(public.portal_request('c0000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a',
  'Repair', 'Dripping inside', 'Any weekday')->>'job', null, 'a request waits for the business to book it');
reset role;
select is((select status || ' ' || message from public.service_requests), 'requested Dripping inside',
  'the business sees the request');
update public.org_settings set portal_self_booking = true, portal_slots_per_half = 1
  where org_id = 'a0000000-0000-0000-0000-000000000000';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', 'pat@harbour.test');
set local role authenticated;
select set_config('t.slot', (select day::text from public.portal_slots('c0000000-0000-0000-0000-00000000000a')
  where part = 'am' limit 1), true);
select isnt(public.portal_request('c0000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a',
  'Service', '', '', current_setting('t.slot')::date, 'am')->>'job', null, 'with self-booking on, a free slot books straight away');
select throws_ok(format($$select public.portal_request('c0000000-0000-0000-0000-00000000000a',
  '50000000-0000-0000-0000-00000000000a', 'Service', '', '', %L::date, 'am')$$, current_setting('t.slot')), 'P0001',
  'Sorry, that time has just gone. Pick another.', 'and that slot is then full');
reset role;

select * from finish();
rollback;

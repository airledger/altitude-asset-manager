-- Timesheets: engineers record their own set off, arrived and finished times on a job; owners correct them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated;
insert into public.clients (id, org_id, name) values
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'Harbour Dental');
insert into public.systems (id, org_id, client_id, name) values
  ('50000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a', 'Surgery');
insert into public.jobs (id, org_id, system_id, type, status, date) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Annual service', 'booked', current_date);

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select public.clock('10000000-0000-0000-0000-000000000001', 'travel', now() - interval '2 hours', 'Ed');
select public.clock('10000000-0000-0000-0000-000000000001', 'arrived', now() - interval '90 minutes', 'Ed');
select public.clock('10000000-0000-0000-0000-000000000001', 'left', now() - interval '10 minutes', 'Ed');
select is((select round(extract(epoch from arrived_at - travel_at) / 60)::int || ' ' ||
                  round(extract(epoch from left_at - arrived_at) / 60)::int || ' ' || name || ' ' || user_id
           from public.job_times),
  '30 80 Ed 00000000-0000-0000-0000-00000000000e', 'an engineer records travel and time on site for themselves');
select public.clock('10000000-0000-0000-0000-000000000001', 'arrived', now() - interval '60 minutes', '');
select is((select (left_at is null)::text || ' ' || name from public.job_times), 'true Ed',
  'tapping Arrived again starts over from there');
select throws_ok($$ select public.clock('10000000-0000-0000-0000-000000000001', 'left', now() + interval '1 hour', 'Ed') $$,
  '23514', null, 'a time in the future is turned away');
select throws_ok($$ select public.clock('10000000-0000-0000-0000-000000000001', 'left', now() - interval '8 days', 'Ed') $$,
  '23514', null, 'and so is one more than a week ago');
update public.job_times set left_at = now();
select is((select count(*)::int from public.job_times where left_at is not null), 0, 'engineers can''t edit times directly');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
update public.job_times set left_at = arrived_at + interval '2 hours';
select is((select round(extract(epoch from left_at - arrived_at) / 60)::int from public.job_times), 120,
  'owners correct times');
select throws_ok($$ update public.job_times set left_at = arrived_at - interval '1 hour' $$,
  '23514', null, 'finishing can''t be before arriving');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
select is((select count(*)::int from public.job_times), 0, 'another business doesn''t see them');
select throws_ok($$ select public.clock('10000000-0000-0000-0000-000000000001', 'travel', now(), 'Bea') $$,
  '42501', null, 'or clock on to its jobs');
reset role;

select * from finish();
rollback;

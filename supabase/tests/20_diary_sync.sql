-- Calendars: a person's calendar address is private to them, only known calendar services are allowed, the
-- business sees busy times but can't write them, and leaving the business removes them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000e', 'ed@a.test'),
  ('00000000-0000-0000-0000-00000000000f', 'olivia@a.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@b.test');
insert into public.orgs (id, name) values
  ('a0000000-0000-0000-0000-000000000000', 'Business A'),
  ('b0000000-0000-0000-0000-000000000000', 'Business B');
insert into public.members (org_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000e', 'member'),
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000f', 'owner'),
  ('b0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000b', 'owner');
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select lives_ok($$ insert into public.diary_links (org_id, url) values ('a0000000-0000-0000-0000-000000000000',
  'https://calendar.google.com/calendar/ical/ed%40a.test/private-abc/basic.ics') $$, 'an engineer connects their calendar');
select throws_ok($$ update public.diary_links set url = 'https://169.254.169.254/latest' $$, '23514', null,
  'only known calendar services');
select throws_ok($$ update public.diary_links set synced_at = now() $$, '42501', null,
  'only the sync records when it ran');
select throws_ok($$ insert into public.busy_blocks (org_id, user_id, starts_at, ends_at)
  values ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000e', now(), now() + interval '1 hour') $$,
  '42501', null, 'busy times can''t be written from the app');
reset role;

insert into public.busy_blocks (org_id, user_id, starts_at, ends_at)
  values ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000e', now(), now() + interval '1 hour');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
set local role authenticated;
select is((select count(*)::int from public.diary_links), 0, 'the owner can''t read someone else''s calendar address');
select is((select count(*)::int from public.diary_status('a0000000-0000-0000-0000-000000000000')), 1,
  'but can see that they have one connected');
select is((select count(*)::int from public.busy_blocks), 1, 'and sees when they''re busy');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
select is((select count(*)::int from public.busy_blocks), 0, 'another business sees nothing');
reset role;

delete from public.members where user_id = '00000000-0000-0000-0000-00000000000e';
select is((select count(*)::int from public.diary_links) + (select count(*)::int from public.busy_blocks), 0,
  'leaving the business removes their calendar');

select * from finish();
rollback;

-- Engineers, invites that name them, booking jobs to them, and calendar links.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'olivia@a.test'),
  ('00000000-0000-0000-0000-00000000000e', 'ed@a.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@b.test');
insert into public.orgs (id, name) values
  ('a0000000-0000-0000-0000-000000000000', 'Business A'),
  ('b0000000-0000-0000-0000-000000000000', 'Business B');
insert into public.members (org_id, user_id, email, role) values
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a', 'olivia@a.test', 'owner'),
  ('b0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000b', 'bea@b.test', 'owner');
create function pg_temp.as_user(u uuid, email text default null) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'email', email)::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated;

select is((select name || '|' || email from public.people where user_id = '00000000-0000-0000-0000-00000000000a'),
  'Olivia|olivia@a.test', 'everyone in a team gets an engineer row');

-- The owner adds Ed before he has an account, and invites him.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
insert into public.people (id, org_id, name, email, phone, fgas_cert) values
  ('e1000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', 'Ed Jones', 'Ed@A.test', '07700 900123', 'REF123');
select lives_ok($$select public.invite_person('e1000000-0000-0000-0000-000000000000')$$, 'the owner invites someone they added');
select is((select count(*) from public.invites where person_id = 'e1000000-0000-0000-0000-000000000000'), 1::bigint,
  'one invite per person');
select public.invite_person('e1000000-0000-0000-0000-000000000000');
select is((select count(*) from public.invites where person_id = 'e1000000-0000-0000-0000-000000000000'), 1::bigint,
  'a new invite replaces the old one');
reset role;

select is((select email || '|' || name from public.invite_info(
    (select code from public.invites where person_id = 'e1000000-0000-0000-0000-000000000000'))),
  'ed@a.test|Ed Jones', 'the invite fills in their name and email');

-- Ed joins.
select set_config('t.code', (select code from public.invites where person_id = 'e1000000-0000-0000-0000-000000000000'), true);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e', 'ed@a.test');
set local role authenticated;
select public.join_business(current_setting('t.code'));
select is((select user_id::text || '|' || fgas_cert from public.people where id = 'e1000000-0000-0000-0000-000000000000'),
  '00000000-0000-0000-0000-00000000000e|REF123', 'joining links Ed to the row the owner made');
select is((select count(*) from public.people where org_id = 'a0000000-0000-0000-0000-000000000000'), 2::bigint,
  'and doesn''t make a second one');
update public.people set phone = '07700 900999', active = false where id = 'e1000000-0000-0000-0000-000000000000';
select is((select phone || '|' || active from public.people where id = 'e1000000-0000-0000-0000-000000000000'),
  '07700 900999|true', 'Ed can change his phone but not switch himself off');
update public.people set phone = 'x' where user_id = '00000000-0000-0000-0000-00000000000a';
select is((select phone from public.people where user_id = '00000000-0000-0000-0000-00000000000a'), '',
  'or change someone else''s details');
select throws_ok($$select public.invite_person('e1000000-0000-0000-0000-000000000000')$$, 'P0001', null,
  'engineers can''t invite people');

-- Jobs and calendar links.
reset role;
insert into public.clients (id, org_id, name) values
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'Harbour, Dental');
insert into public.systems (id, org_id, client_id, name, site_address, access_notes) values
  ('50000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a',
   'Surgery', '12 High St', 'Key at reception');
insert into public.jobs (id, org_id, system_id, type, date, time, duration_hrs, engineer, engineer_id, status) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a',
   'Annual service', '2026-07-01', '09:30', 1.5, 'Ed Jones', 'e1000000-0000-0000-0000-000000000000', 'booked'),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a',
   'Repair / breakdown', current_date + 3, null, null, 'Olivia', null, 'cancelled');

set local role authenticated;
select throws_ok($$select public.calendar_link('a0000000-0000-0000-0000-000000000000')$$, 'P0001', null,
  'engineers can''t get the whole business''s calendar');
select throws_ok($$select public.calendar_link('a0000000-0000-0000-0000-000000000000',
    (select id from public.people where user_id = '00000000-0000-0000-0000-00000000000a'))$$, 'P0001', null,
  'or someone else''s');
select isnt(public.calendar_link('a0000000-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000000'), null,
  'Ed gets his own');
select is(public.calendar_link('a0000000-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000000'),
  public.calendar_link('a0000000-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000000'), 'and the same one next time');
select throws_ok($$select * from public.calendar_feeds$$, '42501', null, 'links can''t be listed');
reset role;

update public.jobs set date = current_date + 1 where id = '10000000-0000-0000-0000-000000000001';
select set_config('t.token', (select token::text from public.calendar_feeds where person_id = 'e1000000-0000-0000-0000-000000000000'), true);
set local role anon;
select is((select string_agg(l, '|') from regexp_split_to_table(public.calendar_ics(current_setting('t.token')::uuid), E'\r\n') l
  where l ~ '^(SUMMARY|LOCATION|STATUS|X-WR-CALNAME)'),
  'X-WR-CALNAME:Air Ledger · Ed Jones · Business A|SUMMARY:Annual service · Harbour\, Dental|LOCATION:12 High St|STATUS:CONFIRMED',
  'Ed''s calendar has only his jobs, escaped');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select set_config('t.all', public.calendar_link('a0000000-0000-0000-0000-000000000000', null)::text, true);
select ok(public.calendar_ics(current_setting('t.all')::uuid) like '%STATUS:CANCELLED%',
  'the business calendar has everyone''s, cancelled ones marked');
select is(public.calendar_ics('99999999-0000-0000-0000-000000000000'), null, 'a wrong link gets nothing');
select * from finish();
rollback;

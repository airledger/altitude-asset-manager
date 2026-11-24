-- Import: owners only; clients and installs that already exist are matched, not doubled; units get label codes;
-- last service dates become completed jobs; and undo takes it all back out unless something was added since.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000e', 'ed@a.test'),
  ('00000000-0000-0000-0000-00000000000f', 'olivia@a.test');
insert into public.orgs (id, name) values ('a0000000-0000-0000-0000-000000000000', 'Business A');
insert into public.members (org_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000e', 'member'),
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000f', 'owner');
insert into public.clients (id, org_id, name) values
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'Harbour Dental');
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated;

create temp table rows_in as select $j$[
  {"client": {"name": "harbour dental "}, "system": {"name": "Surgery", "site_postcode": "bh1 1aa", "refrigerant": "R32"},
   "unit": {"role": "outdoor", "manufacturer": "Daikin", "model": "RXM25R"}, "last_service": "2026-03-01"},
  {"client": {"name": "Harbour Dental"}, "system": {"name": "Surgery", "site_postcode": "BH1 1AA"},
   "unit": {"role": "indoor", "indoor_type": "Cassette", "manufacturer": "Daikin", "model": "FCAG35B"}, "last_service": "2026-03-01"},
  {"client": {"name": "Cliff Hotel", "email": "BOOKINGS@cliff.test", "ref": "C-17"}, "system": {"name": "", "site_address": "1 Cliff Rd"},
   "unit": null, "last_service": null}
]$j$::jsonb as j;
grant select on rows_in to authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select throws_ok($$ select public.import_rows('a0000000-0000-0000-0000-000000000000', null, 'x.csv', (select j from rows_in)) $$,
  '42501', null, 'engineers can''t import');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
set local role authenticated;
create temp table result as
  select public.import_rows('a0000000-0000-0000-0000-000000000000', null, 'old system.csv', (select j from rows_in)) r;
select is((select r - 'import' from result), '{"clients": 1, "systems": 2, "units": 2, "jobs": 1}'::jsonb,
  'adds what''s new: one client, two installs, two units, one last service');
select is((select count(*)::int from public.clients), 2, 'the existing client is matched by name, not doubled');
select is((select count(*)::int from public.units where sticker_code ~ '^AC-[A-Z0-9]{5}$'), 2, 'units get asset label codes');
select is((select email || ' ' || legacy_id from public.clients where name = 'Cliff Hotel'), 'bookings@cliff.test C-17',
  'emails are tidied and their reference kept');
select is((select name from public.systems where site_address = '1 Cliff Rd'), '1 Cliff Rd', 'an install with no name is named after its address');
select is((select status || ' ' || date from public.jobs), 'completed 2026-03-01', 'the last service is a completed job');
select is((select clients || ' ' || units from public.imports), '1 2', 'the import keeps its counts');

-- Importing the same file again adds no duplicate clients or installs.
select is((select public.import_rows('a0000000-0000-0000-0000-000000000000', null, 'again.csv',
  (select jsonb_build_array(j -> 2) from rows_in)) - 'import'), '{"clients": 0, "systems": 0, "units": 0, "jobs": 0}'::jsonb,
  'a second import matches by reference and name');

-- A job booked on an imported install since stops the undo.
insert into public.jobs (org_id, system_id, type) select 'a0000000-0000-0000-0000-000000000000', id, 'Repair / breakdown'
  from public.systems where name = 'Surgery';
select throws_ok($$ select public.undo_import((select (r ->> 'import')::uuid from result)) $$, '23503', null,
  'undo stops if a job was booked on an imported install since');
delete from public.jobs where type = 'Repair / breakdown';
select lives_ok($$ select public.undo_import((select (r ->> 'import')::uuid from result)) $$, 'then undo works');
select is((select count(*)::int from public.clients) || ' ' || (select count(*)::int from public.systems) || ' '
  || (select count(*)::int from public.units) || ' ' || (select count(*)::int from public.jobs), '1 0 0 0',
  'undo leaves only what was there before');
reset role;

select * from finish();
rollback;

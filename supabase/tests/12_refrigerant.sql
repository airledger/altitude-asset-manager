-- Refrigerant log: cylinders, gas charged and recovered on completed jobs, and cylinder levels.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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
insert into public.systems (id, org_id, client_id, name, refrigerant) values
  ('50000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a', 'Surgery', 'R32');
insert into public.jobs (id, org_id, system_id, type, status, date) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Repair / breakdown', 'booked', '2026-11-09'),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Installation', 'booked', '2026-11-10'),
  ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Annual service', 'booked', '2026-11-11');
insert into public.cylinders (id, org_id, code, refrigerant, kind, size_kg) values
  ('d0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000000', 'B1', 'R32', 'new', 9);

-- ---------- cylinders ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
insert into public.cylinders (id, org_id, code, refrigerant, kind, size_kg, holder) values
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', 'BOC 1234', 'R32', 'new', 9, 'Ed'),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', 'REC 7', 'R32', 'recovery', 12, 'Ed');
select is((select count(*)::int from public.cylinders), 2, 'engineers add cylinders, and only see their own business''s');

-- ---------- completing jobs ----------
select public.complete_job('10000000-0000-0000-0000-000000000001', jsonb_build_object(
  'engineer', 'Ed', 'type', 'Repair / breakdown',
  'leak_check', jsonb_build_object('performed', true, 'method', 'Direct', 'result', 'fail',
    'added_kg', 1.2, 'recovered_kg', 0.8,
    'added_cylinder', 'd0000000-0000-0000-0000-000000000001', 'recovered_cylinder', 'd0000000-0000-0000-0000-000000000002')));
select public.complete_job('10000000-0000-0000-0000-000000000002', jsonb_build_object(
  'engineer', 'Ed', 'type', 'Installation',
  'commissioning', jsonb_build_object('added_kg', 0.5, 'added_cylinder', 'd0000000-0000-0000-0000-000000000001')));
select is((select string_agg(kind || ' ' || kg || ' ' || refrigerant || ' ' || client_name, '; ' order by date, kind)
  from public.refrigerant_log), 'added 1.2 R32 Harbour Dental; recovered 0.8 R32 Harbour Dental; added 0.5 R32 Harbour Dental',
  'the log has gas added and recovered on leak checks and commissioning');
select is((select used_kg || '/' || recovered_kg from public.cylinder_levels where code = 'BOC 1234'), '1.7/0',
  'a new-gas cylinder shows what''s been charged from it');
select is((select used_kg || '/' || recovered_kg from public.cylinder_levels where code = 'REC 7'), '0/0.8',
  'a recovery cylinder shows what''s gone into it');

-- Editing the record changes the log.
select public.complete_job('10000000-0000-0000-0000-000000000001', jsonb_build_object(
  'leak_check', jsonb_build_object('performed', true, 'added_kg', 2, 'added_cylinder', 'd0000000-0000-0000-0000-000000000001')));
select is((select used_kg::text from public.cylinder_levels where code = 'BOC 1234'), '2.5',
  're-saving a job record updates the cylinder');
select is((select count(*)::int from public.refrigerant_log where kind = 'recovered'), 0,
  'and removes gas no longer recorded');

-- A cylinder from another business can't be used.
select throws_ok($$select public.complete_job('10000000-0000-0000-0000-000000000003', jsonb_build_object(
  'leak_check', jsonb_build_object('performed', true, 'added_kg', 1, 'added_cylinder', 'd0000000-0000-0000-0000-00000000000b')))$$,
  '23503', null, 'a cylinder from another business is refused');

-- Gas recorded with no cylinder still goes in the log.
select public.complete_job('10000000-0000-0000-0000-000000000003', jsonb_build_object(
  'leak_check', jsonb_build_object('performed', true, 'added_kg', 0.3)));
select is((select count(*)::int from public.refrigerant_log where cylinder_id is null), 1,
  'gas with no cylinder picked is still logged');

-- A cancelled job drops out of the log.
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.jobs set deleted_at = now() where id = '10000000-0000-0000-0000-000000000003';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select is((select count(*)::int from public.refrigerant_log), 2, 'a deleted job drops out of the log');

-- Engineers mark a cylinder empty or returned, but only owners delete one.
update public.cylinders set status = 'returned', returned_on = '2026-11-12' where code = 'REC 7';
select is((select status from public.cylinders where code = 'REC 7'), 'returned', 'engineers mark a cylinder returned');
delete from public.cylinders where code = 'REC 7';
select is((select count(*)::int from public.cylinders), 2, 'engineers can''t delete a cylinder');
reset role;

-- Deleting the business takes its cylinders and job records with it.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select lives_ok($$select public.delete_business('a0000000-0000-0000-0000-000000000000')$$,
  'a business with cylinders used on jobs can be deleted');

select * from finish();
rollback;

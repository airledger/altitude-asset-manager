-- Asset numbers, and completing a job.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'Harbour Dental'),
  ('c0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000000', 'Other client');
insert into public.systems (id, org_id, client_id, name) values
  ('50000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a', 'Surgery'),
  ('50000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000b', 'Shop');

-- ---------- asset numbers ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
insert into public.units (id, org_id, sticker_code, system_id, role) values
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', 'AC-AAAA1', '50000000-0000-0000-0000-00000000000a', 'indoor'),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', 'AC-AAAA2', '50000000-0000-0000-0000-00000000000a', 'outdoor');
select is((select string_agg(asset_no::text, ',' order by sticker_code) from public.units), '1,2',
  'units are numbered 1, 2 in the order they''re added');
update public.units set asset_no = 99 where id = 'e0000000-0000-0000-0000-000000000002';
select is((select asset_no from public.units where id = 'e0000000-0000-0000-0000-000000000002'), 2,
  'an asset number can''t be changed');
delete from public.units where id = 'e0000000-0000-0000-0000-000000000002';
insert into public.units (org_id, sticker_code, system_id, role) values
  ('a0000000-0000-0000-0000-000000000000', 'AC-AAAA3', '50000000-0000-0000-0000-00000000000a', 'indoor');
select is((select asset_no from public.units where sticker_code = 'AC-AAAA3'), 3, 'numbers are never reused');
select throws_ok($$select * from public.asset_counters$$, '42501', null, 'the counter is hidden');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
insert into public.units (org_id, sticker_code, system_id, role) values
  ('b0000000-0000-0000-0000-000000000000', 'AC-BBBB1', '50000000-0000-0000-0000-00000000000b', 'indoor');
select is((select asset_no from public.units where sticker_code = 'AC-BBBB1'), 1, 'each business starts at 1');
reset role;

-- ---------- completing a job ----------
insert into public.materials (id, org_id, name) values
  ('a1000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', 'Coil cleaner');
insert into public.jobs (id, org_id, system_id, type, date) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Annual service', '2026-11-02'),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Installation', '2026-11-03');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select public.complete_job('10000000-0000-0000-0000-000000000001', $${
  "date": "2026-11-02", "engineer": "Ed", "type": "Annual service", "duration_hrs": 1.5,
  "completion_notes": "All good. Drain cleared.",
  "unit_checks": [{"unit_id": "e0000000-0000-0000-0000-000000000001", "checks": ["filters", "drain"], "off_coil": 12.5}],
  "leak_check": {"performed": true, "method": "Electronic detector", "result": "pass", "added_kg": 0},
  "parts_used": [{"material_id": "a1000000-0000-0000-0000-000000000000", "name": "Coil cleaner", "qty": 1},
                 {"name": "Fuse", "qty": 2, "extra": true}, {"name": "Unused", "qty": 0}]
}$$::jsonb);
select is((select status || ' ' || billing from public.jobs where id = '10000000-0000-0000-0000-000000000001'),
  'completed pending', 'an engineer completes a job and it waits to be invoiced');
select is((select checks::text || ' ' || off_coil from public.job_unit_checks), '{filters,drain} 12.5', 'unit checks are saved');
select is((select string_agg(name || ':' || extra, ',' order by position) from public.job_parts where list = 'used'),
  'Coil cleaner:false,Fuse:true', 'parts used are saved, blank quantities dropped');
select is((select kind || '|' || author || '|' || text from public.site_records),
  'Service report|Ed|All good. Drain cleared.',
  'the engineer''s report goes on the install''s history');

reset role;
update public.jobs set billing = 'charged' where id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
select public.complete_job('10000000-0000-0000-0000-000000000001', $${
  "completion_notes": "All good.", "unit_checks": [], "parts_used": [{"name": "Fuse", "qty": 1}]
}$$::jsonb);
select is((select billing || '|' || completion_notes from public.jobs where id = '10000000-0000-0000-0000-000000000001'),
  'charged|All good.', 'editing the record doesn''t invoice it again');
select is((select count(*) from public.job_parts where list = 'used'), 1::bigint, 'editing replaces the parts used');
select is((select count(*) from public.site_records), 1::bigint, 'editing updates the same site record');

select public.complete_job('10000000-0000-0000-0000-000000000002', $${
  "engineer": "Ed", "commissioning": {"pressure_bar": 40, "pressure_held": true, "added_kg": 0.4, "handover": true}
}$$::jsonb);
select is((select install_date || '|' || added_charge_kg || '|' || commissioned_by from public.systems
    where id = '50000000-0000-0000-0000-00000000000a'), '2026-11-03|0.4|Ed', 'an install sets the system''s install date and charge');

update public.jobs set status = 'cancelled' where id = '10000000-0000-0000-0000-000000000001';
select throws_ok($$select public.complete_job('10000000-0000-0000-0000-000000000001', '{}')$$,
  'P0001', null, 'a cancelled job can''t be completed');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
select throws_ok($$select public.complete_job('10000000-0000-0000-0000-000000000002', '{}')$$,
  'P0002', null, 'another business can''t complete the job');
select throws_ok($$select public.mark_parts_ordered('10000000-0000-0000-0000-000000000002', '[]')$$,
  'P0002', null, 'or mark its parts ordered');
reset role;

select * from finish();
rollback;

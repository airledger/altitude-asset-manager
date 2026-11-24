-- Subcontractors: they join through their invite as 'sub', see only the jobs booked to them (and the clients,
-- installs, units and files at those jobs), never the team, other clients or prices; they accept or decline,
-- send their charge for owners to approve, and keep their own insurance on file.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000e', 'ed@a.test'),
  ('00000000-0000-0000-0000-00000000000f', 'olivia@a.test'),
  ('00000000-0000-0000-0000-000000000005', 'sam@subs.test');
insert into public.orgs (id, name) values ('a0000000-0000-0000-0000-000000000000', 'Business A');
insert into public.members (org_id, user_id, role, email) values
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000e', 'member', 'ed@a.test'),
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000f', 'owner', 'olivia@a.test');
insert into public.clients (id, org_id, name) values
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'Harbour Dental'),
  ('c0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000000', 'Other client');
insert into public.systems (id, org_id, client_id, name) values
  ('50000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a', 'Surgery'),
  ('50000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000b', 'Elsewhere');
insert into public.units (org_id, system_id, sticker_code, role)
  select 'a0000000-0000-0000-0000-000000000000', s, c, 'indoor' from (values
    ('50000000-0000-0000-0000-00000000000a'::uuid, 'AC-SUB01'), ('50000000-0000-0000-0000-00000000000b'::uuid, 'AC-SUB02')) v(s, c);
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'email',
    (select email from auth.users where id = u))::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated;

-- The owner adds Sam as a subcontractor and invites them.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
set local role authenticated;
insert into public.people (id, org_id, name, email, sub, company) values
  ('9e000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000000', 'Sam', 'sam@subs.test', true, 'Sam Cooling Ltd');
create temp table code as select public.invite_person('9e000000-0000-0000-0000-000000000005') c;
insert into public.jobs (id, org_id, system_id, type, engineer_id) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Annual service', '9e000000-0000-0000-0000-000000000005'),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000b', 'Annual service', null);
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
set local role authenticated;
select lives_ok($$ select public.join_business((select c from code)) $$, 'Sam joins through their invite');
reset role;
select is((select role from public.members where user_id = '00000000-0000-0000-0000-000000000005'), 'sub',
  'as a subcontractor');

select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
set local role authenticated;
select is((select count(*)::int from public.jobs), 1, 'they see only the job sent to them');
select is((select name from public.clients), 'Harbour Dental', 'and only that job''s client');
select is((select count(*)::int from public.systems), 1, 'and install');
select is((select sticker_code from public.units), 'AC-SUB01', 'and units');
select is((select count(*)::int from public.people), 1, 'they don''t see the rest of the team');
select is((select count(*)::int from public.members), 1, 'or its members');
select throws_ok($$ insert into public.clients (org_id, name) values ('a0000000-0000-0000-0000-000000000000', 'Mine') $$,
  '42501', null, 'they can''t add clients');
select throws_ok($$ insert into public.jobs (org_id, system_id, type, engineer_id) values
  ('a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Annual service', '9e000000-0000-0000-0000-000000000005') $$,
  '42501', null, 'or book jobs');
update public.jobs set notes = 'hacked' where id = '10000000-0000-0000-0000-000000000002';
select throws_ok($$ select public.sub_reply('10000000-0000-0000-0000-000000000001', false, '') $$,
  null, 'Say why you can''t do it', 'declining needs a reason');
select lives_ok($$ select public.sub_reply('10000000-0000-0000-0000-000000000001', true) $$, 'they accept the job');
select throws_ok($$ select public.sub_reply('10000000-0000-0000-0000-000000000002', true) $$,
  '42501', null, 'but can''t answer for a job that isn''t theirs');
select throws_ok($$ select public.clock('10000000-0000-0000-0000-000000000002', 'travel', now(), 'Sam') $$,
  '42501', null, 'or clock on to one');
select throws_ok($$ insert into public.sub_charges (org_id, job_id, person_id, amount) values
  ('a0000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000005', 180) $$,
  '42501', null, 'a charge waits until the job is completed');
update public.jobs set status = 'completed', completed_at = now() where id = '10000000-0000-0000-0000-000000000001';
select lives_ok($$ insert into public.sub_charges (org_id, job_id, person_id, amount, their_ref) values
  ('a0000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000005', 180, 'INV-7') $$,
  'then they send their charge');
select lives_ok($$ insert into public.files (id, org_id, bucket, path, kind) values
  ('f1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', 'photos', 'a0000000-0000-0000-0000-000000000000/docs/ins.pdf', 'document');
  insert into public.documents (org_id, person_id, kind, name, file_id, expires_on) values
  ('a0000000-0000-0000-0000-000000000000', '9e000000-0000-0000-0000-000000000005', 'insurance', 'Public liability', 'f1000000-0000-0000-0000-000000000001', '2027-03-31') $$,
  'and keep their insurance on file');
select is((select count(*)::int from public.invoices) + (select count(*)::int from public.price_list), 0, 'no prices or invoices');
reset role;
select is((select notes from public.jobs where id = '10000000-0000-0000-0000-000000000002'), '',
  'a job that isn''t theirs can''t be changed');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select is((select count(*)::int from public.jobs), 2, 'engineers still see every job');
select is((select count(*)::int from public.documents), 0, 'but not a subcontractor''s papers');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
set local role authenticated;
select is((select count(*)::int from public.documents where kind = 'insurance'), 1, 'owners see the insurance');
insert into public.files (id, org_id, bucket, path, kind) values
  ('f1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', 'photos', 'a0000000-0000-0000-0000-000000000000/x.jpg', 'photo');
insert into public.site_records (org_id, system_id, kind, photo_file_ids) values
  ('a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000b', 'Photos', '{f1000000-0000-0000-0000-000000000002}');
update public.sub_charges set status = 'approved';
select is((select decided_by from public.sub_charges), '00000000-0000-0000-0000-00000000000f'::uuid,
  'and approve the charge, which records who');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
set local role authenticated;
select is((select count(*)::int from public.files), 1, 'a subcontractor sees their own files, not photos from other sites');
select is((select count(*)::int from public.site_records), 0, 'or other sites'' notes');
reset role;
update public.jobs set engineer_id = null, status = 'booked' where id = '10000000-0000-0000-0000-000000000001';
select is((select sub_reply from public.jobs where id = '10000000-0000-0000-0000-000000000001'), '',
  'sent to someone else, the job asks again');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
set local role authenticated;
update public.people set sub = false where id = '9e000000-0000-0000-0000-000000000005';
reset role;
select is((select role from public.members where user_id = '00000000-0000-0000-0000-000000000005'), 'member',
  'switching them to an engineer changes what they see');

select * from finish();
rollback;

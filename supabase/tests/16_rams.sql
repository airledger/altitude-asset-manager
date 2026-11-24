-- Risk assessments: uploaded against an install or a job, signed on site by the person themselves, and the
-- sign-off can't be changed.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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
  ('50000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a', 'Surgery'),
  ('50000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a', 'Loft');
insert into public.jobs (id, org_id, system_id, type, status, date) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Installation', 'booked', '2026-11-16'),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000c', 'Annual service', 'booked', '2026-11-17');
insert into public.files (id, org_id, bucket, path, kind) values
  ('f1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', 'photos', 'a0000000-0000-0000-0000-000000000000/docs/1-rams.pdf', 'document'),
  ('f1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', 'photos', 'a0000000-0000-0000-0000-000000000000/docs/2-rams.pdf', 'document'),
  ('f1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000000', 'photos', 'a0000000-0000-0000-0000-000000000000/docs/3-cert.pdf', 'document');
insert into public.documents (id, org_id, system_id, job_id, kind, name, file_id) values
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', null, 'rams', 'Site RAMS', 'f1000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'rams', 'Roof work RAMS', 'f1000000-0000-0000-0000-000000000002'),
  ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', null, 'warranty', 'Warranty', 'f1000000-0000-0000-0000-000000000003');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
insert into public.document_signoffs (org_id, document_id, job_id, user_id, name, signed_at) values
  ('a0000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000000a', 'Ed', '2020-01-01');
select is((select user_id::text || ' ' || (signed_at > now() - interval '1 minute')::text from public.document_signoffs),
  '00000000-0000-0000-0000-00000000000e true', 'the engineer signs as themselves, now');
insert into public.document_signoffs (org_id, document_id, job_id, name, signed_at) values
  ('a0000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Ed',
   date_trunc('second', now()) - interval '2 hours');
select is((select count(*)::int from public.document_signoffs), 2, 'and signs the job''s own RAMS too');
select is((select signed_at from public.document_signoffs where document_id = 'd0000000-0000-0000-0000-000000000002'),
  date_trunc('second', now()) - interval '2 hours', 'signed with no signal, it keeps the time they signed');
select throws_ok($$ insert into public.document_signoffs (org_id, document_id, job_id, name) values
  ('a0000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Ed') $$,
  '23514', null, 'another job''s RAMS can''t be signed for this job');
select throws_ok($$ insert into public.document_signoffs (org_id, document_id, job_id, name) values
  ('a0000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Ed') $$,
  '23514', null, 'only risk assessments are signed');
select throws_ok($$ insert into public.document_signoffs (org_id, document_id, job_id, name) values
  ('a0000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Ed') $$,
  '23505', null, 'once per person per job');
select throws_ok($$ update public.document_signoffs set name = 'Someone else' $$,
  '42501', null, 'a sign-off can''t be changed');
delete from public.document_signoffs;
select is((select count(*)::int from public.document_signoffs), 2, 'engineers can''t delete sign-offs');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
select is((select count(*)::int from public.document_signoffs), 0, 'another business doesn''t see them');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select lives_ok($$ select public.delete_business('a0000000-0000-0000-0000-000000000000') $$, 'the business can still be deleted');
reset role;

select * from finish();
rollback;

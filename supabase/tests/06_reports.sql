-- Service reports: issued once, revisions in order, never changed.
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
  ('50000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a', 'Surgery');
insert into public.jobs (id, org_id, system_id, type, status, date, completed_at) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Annual service', 'completed', '2026-11-03', now()),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Annual service', 'booked', '2026-11-10', null);
insert into public.files (id, org_id, bucket, path, kind) values
  ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', 'photos', 'a0000000-0000-0000-0000-000000000000/sig.png', 'signature'),
  ('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', 'photos', 'a0000000-0000-0000-0000-000000000000/reports/SR-1.pdf', 'report_pdf'),
  ('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000000', 'photos', 'a0000000-0000-0000-0000-000000000000/reports/SR-2.pdf', 'report_pdf'),
  ('f0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000000', 'photos', 'a0000000-0000-0000-0000-000000000000/loose.pdf', 'report_pdf');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;

select throws_ok($$insert into public.service_reports (org_id, job_id, ref, rev, hash, pdf_file_id) values
  ('a0000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'SR-261103-ABCD', 1, 'h',
   'f0000000-0000-0000-0000-000000000002')$$, '23514', null, 'a report needs the job signed off first');

insert into public.job_signoffs (job_id, org_id, engineer_name, engineer_signature_file_id, customer_absent, absent_note) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', 'Ed Jones',
   'f0000000-0000-0000-0000-000000000001', true, 'Site closed');

select throws_ok($$insert into public.service_reports (org_id, job_id, ref, rev, hash, pdf_file_id) values
  ('a0000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'SR-261103-ABCD', 1, 'h',
   'f0000000-0000-0000-0000-000000000004')$$, '23514', null, 'the PDF has to be in the reports folder');
select throws_ok($$insert into public.service_reports (org_id, job_id, ref, rev, hash, pdf_file_id) values
  ('a0000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'SR-261103-ABCD', 2, 'h',
   'f0000000-0000-0000-0000-000000000002')$$, '23514', null, 'the first report is revision 1');
select lives_ok($$insert into public.service_reports (org_id, job_id, ref, rev, hash, pdf_file_id) values
  ('a0000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'SR-261103-ABCD', 1, 'h',
   'f0000000-0000-0000-0000-000000000002')$$, 'an engineer issues the report for a signed-off, completed job');
select throws_ok($$insert into public.service_reports (org_id, job_id, ref, rev, hash, pdf_file_id) values
  ('a0000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'SR-261103-WXYZ', 2, 'h2',
   'f0000000-0000-0000-0000-000000000003')$$, '23514', null, 'a revision keeps the reference');
select lives_ok($$insert into public.service_reports (org_id, job_id, ref, rev, hash, pdf_file_id) values
  ('a0000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'SR-261103-ABCD', 2, 'h2',
   'f0000000-0000-0000-0000-000000000003')$$, 'then revision 2');

update public.service_reports set hash = 'changed';
delete from public.service_reports;
select is((select string_agg(hash, ',' order by rev) from public.service_reports), 'h,h2',
  'issued reports can''t be changed or deleted');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select throws_ok($$delete from public.files where id = 'f0000000-0000-0000-0000-000000000002'$$, '42501', null,
  'nor can their PDF file, even by the owner');
insert into public.report_sends (org_id, report_id, via, sent_to)
  select org_id, id, 'email', 'pat@harbour.test' from public.service_reports where rev = 2;
select is((select count(*)::int from public.report_sends), 1, 'sends are logged');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.service_reports), 0, 'another business can''t see them');
reset role;

select * from finish();
rollback;

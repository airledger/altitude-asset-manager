-- Forms: owners set them up, engineers fill them in, other businesses see nothing, and a filled-in form
-- outlives its template.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

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
insert into public.clients (id, org_id, name) values ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'Harbour Dental');
insert into public.systems (id, org_id, client_id, name) values
  ('50000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a', 'Surgery');
insert into public.jobs (id, org_id, system_id, type) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a', 'Annual service');
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
set local role authenticated;
select lives_ok($$ insert into public.form_templates (id, org_id, name, job_types, fields) values
  ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', 'Service checklist', '{Annual service}',
   '[{"id": "f1", "kind": "check", "label": "Filters cleaned"}]') $$, 'an owner sets up a form');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select throws_ok($$ insert into public.form_templates (org_id, name) values ('a0000000-0000-0000-0000-000000000000', 'Mine') $$,
  '42501', null, 'engineers can''t set up forms');
select is((select count(*)::int from public.form_templates), 1, 'but they can use them');
select lives_ok($$ insert into public.job_forms (org_id, job_id, template_id, name, fields, answers, completed_at, completed_by)
  select org_id, '10000000-0000-0000-0000-000000000001', id, name, fields, '{"f1": "pass"}', now(), 'Ed'
  from public.form_templates $$, 'an engineer fills one in on the job');
select is((select updated_by from public.job_forms), '00000000-0000-0000-0000-00000000000e'::uuid, 'and it records who');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
select is((select count(*)::int from public.job_forms) + (select count(*)::int from public.form_templates), 0,
  'another business sees nothing');
reset role;

delete from public.form_templates;
select is((select answers ->> 'f1' from public.job_forms where template_id is null), 'pass',
  'a filled-in form stays when its template is deleted');

select * from finish();
rollback;

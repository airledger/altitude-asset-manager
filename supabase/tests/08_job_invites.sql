-- Invites are written only by the server function: app users can't read who was invited or forge entries.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
select ok(to_regclass('public.job_invites') is not null, 'job_invites exists');
set local role authenticated;
select throws_ok($$select * from public.job_invites$$, '42501', null, 'app users cannot read invites');
select throws_ok(
  $$insert into public.job_invites (job_id, org_id, email) values (gen_random_uuid(), gen_random_uuid(), 'x@y.z')$$,
  '42501', null, 'app users cannot write invites');
select * from finish();
rollback;

-- Accounts sync: the sign-in tokens are out of reach of every signed-in user; owners see only the status.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'olivia@a.test'),
  ('00000000-0000-0000-0000-00000000000e', 'ed@a.test');
insert into public.orgs (id, name) values ('a0000000-0000-0000-0000-000000000000', 'Business A');
insert into public.members (org_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000e', 'member');
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated;
insert into public.accounts_connections (org_id, system, tenant_id, tenant_name, tokens, expires_at, connected_by)
  values ('a0000000-0000-0000-0000-000000000000', 'xero', 't1', 'Altitude Ltd', 'secret', now(),
          '00000000-0000-0000-0000-00000000000a');
select is((select detail ->> 'company' from public.audit_log where entity = 'accounts_connections'), 'Altitude Ltd',
  'connecting is logged');
select is((select count(*)::int from public.audit_log where detail::text like '%secret%'), 0, 'without the tokens');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select throws_ok($$select tokens from public.accounts_connections$$, '42501', null, 'an owner can''t read the tokens');
select is((select tenant_name from public.accounts_connection('a0000000-0000-0000-0000-000000000000')), 'Altitude Ltd',
  'but sees which company is connected');
select throws_ok($$select * from public.accounts_oauth_states$$, '42501', null, 'or the connect states');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select is((select count(*)::int from public.accounts_connection('a0000000-0000-0000-0000-000000000000')), 0,
  'engineers don''t see the connection');
reset role;

select * from finish();
rollback;

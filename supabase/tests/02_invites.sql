-- Invites: expiry, revoking, joining and making an owner (specs/04-tenancy-roles-security.md).
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'olivia@a.test'),
  ('00000000-0000-0000-0000-00000000000e', 'ed@a.test');
insert into public.orgs (id, name) values ('a0000000-0000-0000-0000-000000000000', 'Business A');
insert into public.members (org_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a', 'owner');
insert into public.invites (code, org_id, expires_at) values
  ('OLDCODE', 'a0000000-0000-0000-0000-000000000000', now() - interval '1 day'),
  ('GONE', 'a0000000-0000-0000-0000-000000000000', default),
  ('WRONGMAIL', 'a0000000-0000-0000-0000-000000000000', default);
update public.invites set email = 'someone@else.test' where code = 'WRONGMAIL';

create function pg_temp.as_user(u uuid, e text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'email', e)::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select ok((select expires_at between now() + interval '13 days' and now() + interval '15 days'
  from public.invites where code = 'GONE'), 'new invites last 14 days');
select is((select count(*) from public.invite_info('OLDCODE')), 0::bigint, 'an expired invite shows as not valid');

-- Olivia invites Ed, then revokes another invite.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'olivia@a.test');
set local role authenticated;
create temp table code on commit drop as
  select public.create_invite('a0000000-0000-0000-0000-000000000000', 'ED@a.test') c;
select is((select count(*) from public.invites where code = 'GONE'), 1::bigint, 'owner sees her invites');
delete from public.invites where code = 'GONE';
select is((select count(*) from public.invites where code = 'GONE'), 0::bigint, 'owner revokes an invite');
reset role;

select is((select joins from public.invite_info((select c from code))), true, 'a fresh invite says it joins a business');

-- Ed joins.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e', 'ed@a.test');
set local role authenticated;
select throws_ok($$select public.join_business('OLDCODE')$$, 'P0001',
  'That invite code isn''t valid, has expired or has already been used', 'an expired invite can''t be used');
select throws_ok($$select public.join_business('WRONGMAIL')$$, 'P0001',
  'This invite was sent to a different email address', 'an invite for someone else can''t be used');
select lives_ok(format('select public.join_business(%L)', (select c from code)), 'Ed joins with his invite');
select throws_ok($$select public.make_owner('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000e')$$,
  'P0001', null, 'an engineer can''t make himself an owner');
reset role;
select is((select role from public.members where user_id = '00000000-0000-0000-0000-00000000000e'), 'member',
  'Ed joined as an engineer');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'olivia@a.test');
set local role authenticated;
select public.make_owner('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000e');
reset role;
select is((select role from public.members where user_id = '00000000-0000-0000-0000-00000000000e'), 'owner',
  'the owner makes Ed an owner');

select * from finish();
rollback;

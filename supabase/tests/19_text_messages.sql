-- Text messages: the sender name must be a valid one, and each business only sees its own text log.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000e', 'ed@a.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@b.test');
insert into public.orgs (id, name) values
  ('a0000000-0000-0000-0000-000000000000', 'Business A'),
  ('b0000000-0000-0000-0000-000000000000', 'Business B');
insert into public.members (org_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000e', 'member'),
  ('b0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000b', 'owner');
insert into public.org_settings (org_id) values ('a0000000-0000-0000-0000-000000000000')
  on conflict (org_id) do nothing;
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated;

select lives_ok($$ update public.org_settings set sms_sender = 'Altitude' $$, 'a sender name can be set');
select throws_ok($$ update public.org_settings set sms_sender = 'Too long a name' $$, '23514', null,
  'sender names are at most 11 characters');
select throws_ok($$ update public.org_settings set sms_sender = '1Altitude' $$, '23514', null,
  'sender names start with a letter');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
insert into public.sms_log (org_id, kind, sent_to, body)
  values ('a0000000-0000-0000-0000-000000000000', 'on_the_way', '+447700900123', 'On my way');
select is((select sent_by from public.sms_log), '00000000-0000-0000-0000-00000000000e'::uuid,
  'a text is logged as the person who sent it');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
select is((select count(*)::int from public.sms_log), 0, 'another business can''t see the texts');
reset role;

select * from finish();
rollback;

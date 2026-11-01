-- Sticker reservations: big orders are owner-only, and codes never repeat.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

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

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select is((select count(*) from public.reserve_stickers('a0000000-0000-0000-0000-000000000000', 21)), 21::bigint,
  'an engineer prints a sheet of 21');
select throws_ok($$select public.reserve_stickers('a0000000-0000-0000-0000-000000000000', 500)$$, '42501', null,
  'an engineer can''t order 500');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select is((select count(*) from public.reserve_stickers('a0000000-0000-0000-0000-000000000000', 1000)), 1000::bigint,
  'an owner orders 1,000 from a printer');
reset role;
select is((select count(distinct code) from public.sticker_reservations), 1021::bigint, 'every code is different');

select * from finish();
rollback;

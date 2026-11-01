-- Sticker reservations: big orders are owner-only, and codes never repeat.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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


-- Batches: owners order, everyone in the business can see them.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select throws_ok($$select public.create_sticker_batch('a0000000-0000-0000-0000-000000000000', 10, '{}'::jsonb)$$,
  '42501', null, 'an engineer can''t order a batch');
update public.org_settings set sticker_design = '{"shape":"circle"}' where org_id = 'a0000000-0000-0000-0000-000000000000';
reset role;
select is((select sticker_design from public.org_settings where org_id = 'a0000000-0000-0000-0000-000000000000'),
  '{}'::jsonb, 'an engineer can''t change the sticker design');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
update public.org_settings set sticker_design = '{"shape":"circle"}' where org_id = 'a0000000-0000-0000-0000-000000000000';
create temp table b as select public.create_sticker_batch('a0000000-0000-0000-0000-000000000000', 50,
  '{"shape":"circle"}'::jsonb, 'Van stock') id;
reset role;
select is((select sticker_design ->> 'shape' from public.org_settings
  where org_id = 'a0000000-0000-0000-0000-000000000000'), 'circle', 'an owner saves the sticker design');
select is((select count(*) from public.sticker_reservations where batch_id = (select id from b)), 50::bigint,
  'the batch has its 50 codes');
select is((select quantity from public.sticker_batches where id = (select id from b)), 50,
  'the batch records how many');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select is((select count(*) from public.sticker_reservations where batch_id = (select id from b)), 50::bigint,
  'an engineer can see the batch''s codes');
reset role;

select * from finish();
rollback;

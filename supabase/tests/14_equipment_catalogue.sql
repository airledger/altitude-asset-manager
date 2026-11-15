-- Equipment catalogue: everyone sees Air Ledger's list, each business sees only its own additions, and models
-- typed in on units are learned with their install's refrigerant and charge.
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
insert into public.systems (id, org_id, client_id, name, refrigerant) values
  ('50000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a', 'Surgery', 'R32');

-- ---------- Air Ledger's list ----------
select ok((select count(distinct manufacturer) from public.equipment_models where org_id is null) >= 20,
  'the shared list has the main manufacturers');
select is((select model from public.equipment_models where org_id is null and range = 'Perfera'
  and role = 'indoor' and capacity_kw = 2.5), 'FTXM25R', 'ranges with a fixed code pattern have their models');
select is((select count(*)::int from public.equipment_models where org_id is null and charge_kg is not null), 0,
  'no factory charge is guessed in the shared list');

-- ---------- learning ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
insert into public.units (org_id, sticker_code, system_id, role, manufacturer, model, capacity_kw) values
  ('a0000000-0000-0000-0000-000000000000', 'AC-AAAA1', '50000000-0000-0000-0000-00000000000a', 'outdoor', 'Daikin', 'RXM35R', 3.5),
  ('a0000000-0000-0000-0000-000000000000', 'AC-AAAA2', '50000000-0000-0000-0000-00000000000a', 'indoor', 'Acme', 'X1 wall', null),
  ('a0000000-0000-0000-0000-000000000000', 'AC-AAAA3', '50000000-0000-0000-0000-00000000000a', 'indoor', 'Acme', '', null);
select is((select string_agg(manufacturer || ' ' || model || ' ' || role || ' ' || refrigerant, '; ' order by model)
  from public.equipment_models where org_id is not null),
  'Daikin RXM35R outdoor R32; Acme X1 wall indoor R32', 'models typed on units go in the business''s catalogue');
reset role;
update public.systems set factory_charge_kg = 0.85 where id = '50000000-0000-0000-0000-00000000000a';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select is((select charge_kg from public.equipment_models where org_id is not null and model = 'RXM35R'), 0.85::numeric,
  'setting the install''s factory charge remembers it for the outdoor model');
select is((select charge_kg from public.equipment_models where org_id is not null and model = 'X1 wall'), null,
  'indoor models don''t carry a charge');
update public.units set capacity_kw = 2.5 where sticker_code = 'AC-AAAA2';
select is((select count(*)::int from public.equipment_models where org_id is not null and model = 'X1 wall'), 1,
  'saving the same model again updates it, not a copy');

-- Engineers can't change Air Ledger's list, or delete from their own.
update public.equipment_models set model = 'hacked' where org_id is null and range = 'Perfera';
select is((select count(*)::int from public.equipment_models where model = 'hacked'), 0, 'the shared list can''t be changed');
delete from public.equipment_models where org_id is not null;
select is((select count(*)::int from public.equipment_models where org_id is not null), 2, 'engineers can''t delete models');
reset role;

-- ---------- another business ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
select is((select count(*)::int from public.equipment_models where org_id is not null), 0,
  'another business doesn''t see these models');
reset role;

select * from finish();
rollback;

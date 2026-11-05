-- Planned maintenance contracts: everyone sees the cover, only owners see the price; visits book themselves,
-- bills are drafted once per period, and the client's service plan follows the contract.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

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
insert into public.clients (id, org_id, name) values
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'Harbour Dental');
insert into public.systems (id, org_id, client_id, name) values
  ('50000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a', 'Surgery'),
  ('50000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a', 'Office');

-- ---------- an owner sets one up ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
insert into public.contracts (id, org_id, client_id, start_date, end_date, visits_per_year)
  values ('d0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000',
          'c0000000-0000-0000-0000-00000000000a', current_date - 40, current_date - 40 + interval '1 year', 2);
insert into public.contract_prices (contract_id, org_id, price, billing)
  values ('d0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 1200, 'monthly');
insert into public.contract_systems (contract_id, system_id, org_id) values
  ('d0000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000'),
  ('d0000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000000');
select is(public.book_contract_visits('d0000000-0000-0000-0000-00000000000a'), 2,
  'the visit still to come is booked for each install (the one 40 days ago is skipped)');
select is(public.book_contract_visits('d0000000-0000-0000-0000-00000000000a'), 0, 'booking again adds nothing');
select is((select count(*)::int from public.jobs where contract_id = 'd0000000-0000-0000-0000-00000000000a'
  and date = (current_date - 40 + interval '6 months')::date and status = 'booked' and engineer_id is null), 2,
  'six months after the start, ready to assign');
reset role;
select is((select on_service_plan from public.clients), true, 'the client is now on a service plan');
select is((select plan_billing from public.client_billing), 'separate', 'billed separately from the visits');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select is(public.bill_due_contracts('a0000000-0000-0000-0000-000000000000'), 2,
  'two monthly bills have come round (the start and a month on)');
select is(public.bill_due_contracts('a0000000-0000-0000-0000-000000000000'), 0, 'and they are never billed twice');
select is((select sum(l.unit_price)::numeric from public.invoice_lines l), 200::numeric, '£100 each');
update public.contract_prices set billing = 'visit', price = 90;
reset role;
select is((select plan_price || ' ' || plan_billing from public.client_billing), '90 visit',
  'switching to per visit prices each visit at the contract price');

-- ---------- engineers ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select is((select count(*)::int from public.contracts), 1, 'an engineer can see the site is on contract');
select is((select count(*)::int from public.contract_prices), 0, 'but not what it costs');
select throws_ok($$select public.book_contract_visits('d0000000-0000-0000-0000-00000000000a')$$, '42501', null,
  'or book its visits');
reset role;

-- ---------- renewing and ending ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select is(public.renew_contract('d0000000-0000-0000-0000-00000000000a'),
  (current_date - 40 + interval '2 years')::date, 'renewing moves it on a year');
update public.contracts set status = 'cancelled';
reset role;
select is((select on_service_plan from public.clients), false, 'cancelling takes the client off the plan');

select * from finish();
rollback;

-- Paid plans: a new business starts a 14-day trial, its plan's limits are kept, an ended trial can't add new
-- work, owners choose their plan, and only Air Ledger sees and changes every business's plan.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000f', 'olivia@a.test'),
  ('00000000-0000-0000-0000-00000000000e', 'ed@a.test'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@airledger.test');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000ad');
update public.platform set require_invite = false;
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'email',
    (select email from auth.users where id = u))::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
set local role authenticated;
create temp table biz as select public.create_business('Cool Co', null) id;
reset role;

select is((select status || ' ' || plan || ' ' || (trial_ends - current_date)::text from public.org_plans
  where org_id = (select id from biz)), 'trial complete 14', 'a new business starts a 14-day trial of Complete');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
set local role authenticated;
select is((select count(*)::int from public.org_plans), 1, 'the owner sees their plan');
select throws_ok($$ select public.choose_plan((select id from biz), 'starter', 'monthly', 0, 'Cool Co Ltd', 'not-an-email') $$,
  null, 'Enter the email address invoices go to', 'invoices need an email address');
select lives_ok($$ select public.choose_plan((select id from biz), 'starter', 'monthly', 0, 'Cool Co Ltd', 'Accounts@Cool.test') $$,
  'the owner chooses Starter');
select is((select plan || ' ' || status || ' ' || billing_email from public.org_plans), 'starter trial accounts@cool.test',
  'the trial carries on with Starter''s limits');
insert into public.people (org_id, name, email) values ((select id from biz), 'Eng 1', 'e1@cool.test');
select throws_like($$ insert into public.people (org_id, name, email) values ((select id from biz), 'Eng 2', 'e2@cool.test') $$,
  'Your Starter plan includes 2 engineers%', 'Starter has room for 2 engineers, owners included');
select lives_ok($$ insert into public.people (org_id, name, email, sub) values ((select id from biz), 'Sub', 's@x.test', true) $$,
  'subcontractors don''t count');
select throws_like($$ select public.choose_plan((select id from biz), 'starter', 'monthly', 0, '', 'a@cool.test');
  update public.people set sub = false where name = 'Sub' $$,
  'Your Starter plan includes 2 engineers%', 'nor can one be switched to an engineer past the limit');
select lives_ok($$ select public.choose_plan((select id from biz), 'starter', 'monthly', 1, '', 'a@cool.test');
  insert into public.people (org_id, name, email) values ((select id from biz), 'Eng 2', 'e2@cool.test') $$,
  'an extra engineer makes room');
insert into public.clients (id, org_id, name) values ('c0000000-0000-0000-0000-0000000000cc', (select id from biz), 'Client');
insert into public.systems (id, org_id, client_id, name) values
  ('50000000-0000-0000-0000-0000000000cc', (select id from biz), 'c0000000-0000-0000-0000-0000000000cc', 'Site');
reset role;
update public.plans set assets = 1 where code = 'starter';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
set local role authenticated;
insert into public.units (org_id, system_id, sticker_code, role) values
  ((select id from biz), '50000000-0000-0000-0000-0000000000cc', 'AC-PLN01', 'indoor');
select throws_like($$ insert into public.units (org_id, system_id, sticker_code, role) values
  ((select id from biz), '50000000-0000-0000-0000-0000000000cc', 'AC-PLN02', 'indoor') $$,
  'Your Starter plan includes 1 assets%', 'the asset limit is kept');
select is((select count(*)::int from public.platform_businesses()), 0, 'owners don''t see other businesses');
select throws_ok($$ select public.platform_set_plan((select id from biz), '{"status": "free"}') $$,
  '42501', null, 'or change their own status');
reset role;

-- The trial ends with nothing paid.
update public.org_plans set trial_ends = current_date - 1 where org_id = (select id from biz);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
set local role authenticated;
select throws_ok($$ insert into public.jobs (org_id, system_id, type) values
  ((select id from biz), '50000000-0000-0000-0000-0000000000cc', 'Annual service') $$,
  '42501', null, 'after the trial, nothing new can be added');
select is((select count(*)::int from public.clients), 1, 'but everything can still be seen');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
set local role authenticated;
select is((select status || ' ' || plan || ' ' || amount::text from public.platform_businesses() where name = 'Cool Co'),
  'trial starter 38.00', 'Air Ledger sees every business and what to bill (Starter plus one engineer)');
select lives_ok($$ select public.platform_set_plan((select id from biz), '{"status": "active", "dd_status": "active", "dd_ref": "ADF-1"}') $$,
  'and marks it paying once the Direct Debit is set up');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
set local role authenticated;
select lives_ok($$ insert into public.jobs (org_id, system_id, type) values
  ((select id from biz), '50000000-0000-0000-0000-0000000000cc', 'Annual service') $$,
  'then work can be added again');
reset role;

select * from finish();
rollback;

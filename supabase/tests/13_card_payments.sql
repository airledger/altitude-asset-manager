-- Card payments: the pay link shows only what's needed to pay, payments are recorded once, and only the
-- payments function can record them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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
insert into public.invoices (id, org_id, number, client_id, date, vat_rate, pay_token) values
  ('b1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', '1001',
   'c0000000-0000-0000-0000-00000000000a', '2026-11-10', 0.2, 'f0000000-0000-0000-0000-000000000001');
insert into public.invoice_lines (org_id, invoice_id, description, qty, unit_price) values
  ('a0000000-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000001', 'Service', 1, 95),
  ('a0000000-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000001', 'Gas', 0.333, 60);

-- ---------- totals ----------
select is(public.invoice_gross('b1000000-0000-0000-0000-000000000001'), 137.98::numeric,
  'the invoice total matches the app''s sum (lines to the penny, then VAT)');
select isnt((select pay_token from public.invoices where number = '1001'), null, 'every invoice has a pay link');

-- ---------- before Stripe is connected ----------
select is((select can_pay from public.invoice_for_payment('f0000000-0000-0000-0000-000000000001')), false,
  'no card payments until the business connects Stripe');
select is((select count(*)::int from public.invoice_for_payment(gen_random_uuid())), 0,
  'a made-up pay link finds nothing');

insert into public.payment_accounts (org_id, stripe_account, charges_enabled, details_submitted)
  values ('a0000000-0000-0000-0000-000000000000', 'acct_test', true, true);
select is((select row(business, client, due, stripe_account, can_pay)::text
  from public.invoice_for_payment('f0000000-0000-0000-0000-000000000001')),
  '("Business A","Harbour Dental",137.98,acct_test,t)', 'the pay link shows who it''s from and what''s owed');

-- ---------- who can see and do what ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select is((select count(*)::int from public.payment_status('a0000000-0000-0000-0000-000000000000')), 0,
  'engineers don''t see the payment set-up');
select throws_ok($$select * from public.invoice_for_payment('f0000000-0000-0000-0000-000000000001')$$, '42501', null,
  'signed-in users can''t look invoices up by pay link');
select throws_ok($$select public.record_card_payment('b1000000-0000-0000-0000-000000000001', 'cs_fake', 137.98, 'gbp')$$,
  '42501', null, 'nobody signed in can record a payment');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select is((select row(connected, charges_enabled)::text from public.payment_status('a0000000-0000-0000-0000-000000000000')),
  '(t,t)', 'owners see that card payments are on');
reset role;

-- ---------- Stripe says it's paid ----------
select is(public.record_card_payment('b1000000-0000-0000-0000-000000000001', 'cs_1', 100, 'GBP'), true, 'a part payment is recorded');
select is(public.record_card_payment('b1000000-0000-0000-0000-000000000001', 'cs_1', 100, 'GBP'), false,
  'the same payment sent twice is only counted once');
select public.record_card_payment('b1000000-0000-0000-0000-000000000001', 'cs_2', 37.98, 'gbp');
select is((select amount_paid || ' ' || (paid_at is not null) from public.invoices where number = '1001'), '137.98 true',
  'paying the rest marks the invoice paid');

select * from finish();
rollback;

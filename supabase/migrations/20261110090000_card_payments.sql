-- Card payments (part 2). Each business connects its own Stripe account (Stripe Connect), so customers pay the
-- business directly and Air Ledger never holds the money. Every invoice gets a private pay link; paying it opens
-- Stripe's checkout (card, Apple Pay, Google Pay) for what's still owed, and Stripe tells the payments function
-- when it's paid, which records it here and marks the invoice paid.
--
-- payment_accounts   one per business: its Stripe account and whether it can take payments yet. Service key only;
--                    owners read it through payment_status().
-- card_payments      each payment received. Written only by the payments function; owners read.
-- invoices           gain pay_token, the secret part of the pay link.

create table public.payment_accounts (
  org_id uuid primary key references public.orgs on delete cascade,
  stripe_account text not null unique,
  charges_enabled boolean not null default false,
  details_submitted boolean not null default false,
  connected_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.payment_accounts enable row level security;
revoke all on public.payment_accounts from anon, authenticated;

create table public.card_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  invoice_id uuid not null,
  stripe_session text not null unique,
  amount numeric not null check (amount > 0),
  currency text not null default 'gbp',
  paid_at timestamptz not null default now(),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade
);
create index on public.card_payments (org_id, invoice_id);
alter table public.card_payments enable row level security;
revoke all on public.card_payments from anon;
revoke insert, update, delete on public.card_payments from authenticated;
create policy "owners read" on public.card_payments for select to authenticated using (public.is_owner(org_id));

alter table public.invoices add column pay_token uuid not null default gen_random_uuid();
alter table public.invoices add constraint invoices_pay_token_unique unique (pay_token);

-- What an invoice comes to, the same sum as the app's (packages/domain invoiceTotals): each line to the penny,
-- then VAT on the total.
create or replace function public.invoice_gross(p_invoice uuid) returns numeric
language sql stable set search_path = public as $$
  select round(n.net + case when i.vat_rate > 0 then round(n.net * i.vat_rate, 2) else 0 end, 2)
  from public.invoices i
  cross join lateral (
    select coalesce(sum(round(l.qty * l.unit_price, 2)), 0) as net
    from public.invoice_lines l where l.invoice_id = i.id
  ) n
  where i.id = p_invoice
$$;
revoke all on function public.invoice_gross(uuid) from public, anon;
grant execute on function public.invoice_gross(uuid) to authenticated;

-- The Prices and accounts page: is card payment set up? Owners only, and never more than this.
create or replace function public.payment_status(p_org uuid)
returns table (connected boolean, charges_enabled boolean, details_submitted boolean)
language sql stable security definer set search_path = public as $$
  select true, a.charges_enabled, a.details_submitted
  from public.payment_accounts a
  where a.org_id = p_org and public.is_owner(p_org)
$$;
revoke all on function public.payment_status(uuid) from public, anon;
grant execute on function public.payment_status(uuid) to authenticated;

-- For the pay page, from the pay link alone (the payments function, with the service key): who it's from, what
-- it's for and what's still owed. Nothing else about the business or client.
create or replace function public.invoice_for_payment(p_token uuid)
returns table (invoice_id uuid, org_id uuid, number text, business text, client text, gross numeric,
  paid numeric, due numeric, stripe_account text, can_pay boolean)
language sql stable security definer set search_path = public as $$
  select i.id, i.org_id, i.number, coalesce(nullif(s.trading_as, ''), o.name), c.name,
    public.invoice_gross(i.id), i.amount_paid,
    greatest(public.invoice_gross(i.id) - i.amount_paid, 0),
    a.stripe_account, coalesce(a.charges_enabled, false)
  from public.invoices i
  join public.orgs o on o.id = i.org_id
  join public.clients c on c.id = i.client_id
  left join public.org_settings s on s.org_id = i.org_id
  left join public.payment_accounts a on a.org_id = i.org_id
  where i.pay_token = p_token
$$;
revoke all on function public.invoice_for_payment(uuid) from public, anon, authenticated;
grant execute on function public.invoice_for_payment(uuid) to service_role;

-- Stripe says a checkout was paid: record it once (Stripe can send the same event more than once) and add it to
-- what's been paid on the invoice. Returns false when it was already recorded.
create or replace function public.record_card_payment(p_invoice uuid, p_session text, p_amount numeric,
  p_currency text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  insert into public.card_payments (org_id, invoice_id, stripe_session, amount, currency)
    values (v_org, p_invoice, p_session, p_amount, lower(p_currency))
    on conflict (stripe_session) do nothing;
  if not found then return false; end if;
  update public.invoices set
    amount_paid = amount_paid + p_amount,
    paid_at = case when amount_paid + p_amount >= public.invoice_gross(id) then current_date else paid_at end
  where id = p_invoice;
  return true;
end $$;
revoke all on function public.record_card_payment(uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.record_card_payment(uuid, text, numeric, text) to service_role;

-- Connecting and disconnecting Stripe go in the audit log.
create or replace function public.audit_payment_account() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.payment_accounts := coalesce(new, old);
begin
  if not exists(select 1 from public.orgs where id = r.org_id) then return null; end if;
  if tg_op = 'UPDATE' and new.charges_enabled = old.charges_enabled then return null; end if;
  insert into public.audit_log (org_id, actor, action, entity, entity_id, detail)
    values (r.org_id, coalesce(auth.uid(), r.connected_by),
            case tg_op when 'DELETE' then 'disconnect' when 'INSERT' then 'connect' else 'update' end,
            'payment_accounts', r.org_id::text, jsonb_build_object('charges_enabled', r.charges_enabled));
  return null;
end $$;
revoke all on function public.audit_payment_account() from public, anon, authenticated;
create trigger audit after insert or update or delete on public.payment_accounts
  for each row execute function public.audit_payment_account();

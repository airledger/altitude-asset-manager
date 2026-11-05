-- Planned maintenance contracts (part 2, first feature; Lewis 2 Nov: "visits a year, which installs, start and
-- renewal date, contract price (owner only), billed monthly, yearly or per visit; visits booked ahead
-- automatically and on the engineers' diaries; renews with a reminder").
--
-- contracts            what's covered and when: everyone in the business can read it (engineers see a site is
--                      on contract), only owners change it.
-- contract_prices      the price and how it's billed: owners only, like every other price.
-- contract_systems     the installs a contract covers.
-- contract_bills       one row per billing period already invoiced, so a period is never billed twice.
-- jobs.contract_id     visits booked by the contract.
--
-- The existing invoice rules already know "covered by a service plan" (clients.on_service_plan and
-- client_billing.plan_price / plan_billing), so a trigger keeps those in step with the client's contracts and
-- invoicing needs no second set of rules.

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  client_id uuid not null,
  name text not null default 'Planned maintenance',
  start_date date not null,
  end_date date not null,
  visits_per_year int not null default 1 check (visits_per_year in (1, 2, 3, 4, 6, 12)),
  visit_type text not null default 'Annual service' check (visit_type in ('Annual service', 'Leak check')),
  auto_renew boolean not null default true,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete cascade,
  check (end_date > start_date)
);
create index if not exists contracts_client on public.contracts (client_id);
create index if not exists contracts_renewal on public.contracts (org_id, status, end_date);
select public.apply_tenant_rules('contracts', 'members-read');

create table if not exists public.contract_prices (
  contract_id uuid primary key,
  org_id uuid not null references public.orgs on delete cascade,
  price numeric not null default 0 check (price >= 0),
  -- 'visit': price is per visit, invoiced with each completed visit; otherwise price is the yearly price split into bills.
  billing text not null default 'yearly' check (billing in ('monthly', 'quarterly', 'yearly', 'visit')),
  next_bill_date date,
  updated_at timestamptz not null default now(),
  foreign key (contract_id, org_id) references public.contracts (id, org_id) on delete cascade
);
select public.apply_tenant_rules('contract_prices', 'owners');

create table if not exists public.contract_systems (
  contract_id uuid not null,
  system_id uuid not null,
  org_id uuid not null references public.orgs on delete cascade,
  primary key (contract_id, system_id),
  foreign key (contract_id, org_id) references public.contracts (id, org_id) on delete cascade,
  foreign key (system_id, org_id) references public.systems (id, org_id) on delete cascade
);
select public.apply_tenant_rules('contract_systems', 'members-read');

create table if not exists public.contract_bills (
  contract_id uuid not null,
  period_start date not null,
  org_id uuid not null references public.orgs on delete cascade,
  invoice_id uuid references public.invoices on delete set null,
  created_at timestamptz not null default now(),
  primary key (contract_id, period_start),
  foreign key (contract_id, org_id) references public.contracts (id, org_id) on delete cascade
);
select public.apply_tenant_rules('contract_bills', 'owners');

alter table public.jobs add column if not exists contract_id uuid;
do $$ begin
  alter table public.jobs add constraint jobs_contract_fk foreign key (contract_id, org_id)
    references public.contracts (id, org_id) on delete set null (contract_id);
exception when duplicate_object then null; end $$;
create index if not exists jobs_contract on public.jobs (contract_id, system_id, date);

-- ---------- keep the client's "service plan" flags in step with their contracts ----------
create or replace function public.sync_client_plan(p_client uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c record;
begin
  select k.org_id, k.id, p.price, p.billing, k.visits_per_year into c
  from public.contracts k left join public.contract_prices p on p.contract_id = k.id
  where k.client_id = p_client and k.status = 'active' and k.end_date >= current_date
  order by k.end_date desc limit 1;
  update public.clients set on_service_plan = (c.id is not null) where id = p_client and c.id is not null;
  if c.id is null then
    -- No live contract: leave a hand-ticked plan alone only if the client never had a contract.
    update public.clients set on_service_plan = false
      where id = p_client and exists (select 1 from public.contracts where client_id = p_client);
    return;
  end if;
  insert into public.client_billing (client_id, org_id, plan_price, plan_billing)
    values (p_client, c.org_id, case when c.billing = 'visit' then c.price end,
            case when c.billing = 'visit' then 'visit' else 'separate' end)
  on conflict (client_id) do update set plan_price = excluded.plan_price, plan_billing = excluded.plan_billing;
end $$;
revoke all on function public.sync_client_plan(uuid) from public, anon, authenticated;

create or replace function public.contract_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  if tg_table_name = 'contracts' then
    cid := coalesce(new.client_id, old.client_id);
  else
    select client_id into cid from public.contracts where id = coalesce(new.contract_id, old.contract_id);
  end if;
  if cid is not null then perform public.sync_client_plan(cid); end if;
  return null;
end $$;
drop trigger if exists contract_changed on public.contracts;
create trigger contract_changed after insert or update or delete on public.contracts
  for each row execute function public.contract_changed();
drop trigger if exists contract_changed on public.contract_prices;
create trigger contract_changed after insert or update or delete on public.contract_prices
  for each row execute function public.contract_changed();

-- ---------- booking the year's visits ----------
-- Spreads the visits evenly through the contract year (e.g. 2 a year: the start date and 6 months on) for each
-- install covered, and books any that aren't already booked. Safe to run again: it only fills gaps.
-- Visits go in as booked jobs with no engineer, ready for the office to assign.
create or replace function public.book_contract_visits(p_contract uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  k public.contracts;
  n int := 0;
  step int;
  v int;
  d date;
  s record;
begin
  select * into k from public.contracts where id = p_contract;
  if not found or not public.is_owner(k.org_id) then
    raise exception 'Only business owners can book contract visits' using errcode = '42501';
  end if;
  if k.status <> 'active' then return 0; end if;
  step := 12 / k.visits_per_year;
  for s in select cs.system_id from public.contract_systems cs
           join public.systems y on y.id = cs.system_id and not y.inactive and y.deleted_at is null
           where cs.contract_id = p_contract loop
    for v in 0 .. k.visits_per_year - 1 loop
      d := (k.start_date + make_interval(months => v * step))::date;
      continue when d >= k.end_date or d < current_date;
      -- Already booked for this visit (anything for this install within half a step counts).
      continue when exists (
        select 1 from public.jobs j
        where j.contract_id = p_contract and j.system_id = s.system_id and j.deleted_at is null
          and j.date between d - (step * 15) and d + (step * 15 - 1));
      insert into public.jobs (org_id, system_id, type, status, date, duration_hrs, contract_id, notes)
        values (k.org_id, s.system_id, k.visit_type, 'booked', d, 1, p_contract, k.name || ' visit');
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- Renewing moves the contract on a year (same length), books the new year's visits, and bills from the new start.
create or replace function public.renew_contract(p_contract uuid) returns date
language plpgsql security definer set search_path = public as $$
declare
  k public.contracts;
  len interval;
begin
  select * into k from public.contracts where id = p_contract for update;
  if not found or not public.is_owner(k.org_id) then
    raise exception 'Only business owners can renew contracts' using errcode = '42501';
  end if;
  len := make_interval(months => ((extract(year from age(k.end_date, k.start_date)) * 12
    + extract(month from age(k.end_date, k.start_date)))::int));
  if len = interval '0' then len := interval '1 year'; end if;
  update public.contracts set start_date = k.end_date, end_date = (k.end_date + len)::date, status = 'active'
    where id = p_contract;
  update public.contract_prices set next_bill_date = greatest(coalesce(next_bill_date, k.end_date), k.end_date)
    where contract_id = p_contract and billing <> 'visit';
  perform public.book_contract_visits(p_contract);
  return (k.end_date + len)::date;
end $$;

-- ---------- billing ----------
-- Drafts an invoice for each billing period that has come round and isn't billed yet (monthly, quarterly or
-- yearly; per-visit contracts are invoiced with each completed visit instead). Returns how many it made.
create or replace function public.bill_contract(p_contract uuid, p_vat boolean, p_payment_days int default 14)
returns int
language plpgsql security definer set search_path = public as $$
declare
  k public.contracts;
  p public.contract_prices;
  months int;
  per numeric;
  d date;
  inv uuid;
  n int := 0;
  what text;
begin
  select * into k from public.contracts where id = p_contract;
  if not found or not public.is_owner(k.org_id) then
    raise exception 'Only business owners can bill contracts' using errcode = '42501';
  end if;
  select * into p from public.contract_prices where contract_id = p_contract for update;
  if not found or p.billing = 'visit' or p.price <= 0 or k.status <> 'active' then return 0; end if;
  months := case p.billing when 'monthly' then 1 when 'quarterly' then 3 else 12 end;
  per := round(p.price * months / 12.0, 2);
  d := coalesce(p.next_bill_date, k.start_date);
  while d <= current_date and d < k.end_date and n < 24 loop
    if not exists (select 1 from public.contract_bills where contract_id = p_contract and period_start = d) then
      what := k.name || ' – ' || case p.billing
        when 'monthly' then to_char(d, 'FMMonth YYYY')
        when 'quarterly' then to_char(d, 'FMDD Mon YYYY') || ' to ' || to_char((d + make_interval(months => 3))::date - 1, 'FMDD Mon YYYY')
        else to_char(d, 'FMDD Mon YYYY') || ' to ' || to_char((d + make_interval(months => 12))::date - 1, 'FMDD Mon YYYY') end;
      inv := public.create_invoice(k.org_id, k.client_id, null, d, d + p_payment_days, k.name, p_vat,
        jsonb_build_array(jsonb_build_object('desc', what, 'qty', 1, 'unit', per)), true);
      insert into public.contract_bills (contract_id, period_start, org_id, invoice_id) values (p_contract, d, k.org_id, inv);
      n := n + 1;
    end if;
    d := (d + make_interval(months => months))::date;
  end loop;
  update public.contract_prices set next_bill_date = d where contract_id = p_contract;
  return n;
end $$;

-- Run when an owner opens Invoices: renews contracts set to renew by themselves once their end date has passed,
-- then drafts every bill that has come round, using the business's VAT and payment terms. Returns bills made.
create or replace function public.bill_due_contracts(p_org uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  vat boolean;
  days int;
  k record;
  i int;
  n int := 0;
begin
  if not public.is_owner(p_org) then
    raise exception 'Only business owners can bill contracts' using errcode = '42501';
  end if;
  select coalesce(s.vat_registered, false), coalesce(s.payment_days, 14) into vat, days
    from public.org_settings s where s.org_id = p_org;
  for k in select id from public.contracts
           where org_id = p_org and status = 'active' and auto_renew and end_date <= current_date loop
    for i in 1 .. 5 loop
      exit when (select end_date from public.contracts where id = k.id) > current_date;
      perform public.renew_contract(k.id);
    end loop;
  end loop;
  for k in select c.id from public.contracts c join public.contract_prices p on p.contract_id = c.id
           where c.org_id = p_org and c.status = 'active' and p.billing <> 'visit' and p.price > 0
             and coalesce(p.next_bill_date, c.start_date) <= current_date
             and coalesce(p.next_bill_date, c.start_date) < c.end_date loop
    n := n + public.bill_contract(k.id, coalesce(vat, false), coalesce(days, 14));
  end loop;
  return n;
end $$;

revoke execute on function public.book_contract_visits(uuid), public.renew_contract(uuid),
  public.bill_contract(uuid, boolean, int), public.bill_due_contracts(uuid) from public, anon;
grant execute on function public.book_contract_visits(uuid), public.renew_contract(uuid),
  public.bill_contract(uuid, boolean, int), public.bill_due_contracts(uuid) to authenticated;

create trigger audit after insert or update or delete on public.contract_prices for each row execute function public.audit();

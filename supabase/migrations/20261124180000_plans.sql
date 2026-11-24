-- Paid plans (part 2). Every business is on a plan, starting with a 14-day free trial of everything. The
-- database keeps each plan's limits (engineers and assets), and once a trial has ended with no plan paid for,
-- or a business is cancelled, it can still open and export everything but can't add clients, installs, units
-- or jobs. Air Ledger Ltd (the platform admins) sees every business's plan, who to bill each month and their
-- Direct Debit, which is collected through Adfin from Air Ledger Ltd's own accounts.

-- ---------- the plans ----------
create table public.plans (
  code text primary key check (code ~ '^[a-z][a-z0-9-]{1,30}$'),
  name text not null check (btrim(name) <> ''),
  monthly numeric(8, 2) not null check (monthly >= 0),
  yearly numeric(8, 2) not null check (yearly >= 0),
  engineers int not null check (engineers > 0),
  -- null: unlimited.
  assets int check (assets > 0),
  extra_engineer numeric(8, 2) not null default 0 check (extra_engineer >= 0),
  blurb text not null default '',
  sort int not null default 0,
  active boolean not null default true
);
-- The working plan agreed on 2 Nov 2026; yearly is two months free.
insert into public.plans (code, name, monthly, yearly, engineers, assets, extra_engineer, blurb, sort) values
  ('starter', 'Starter', 30, 300, 2, 250, 8, 'For a small team getting started', 1),
  ('pro', 'Pro', 50, 500, 5, 1000, 8, 'For a growing business', 2),
  ('complete', 'Complete', 75, 750, 10, null, 8, 'Everything, with unlimited assets', 3);
alter table public.plans enable row level security;
revoke all on public.plans from anon;
grant select on public.plans to anon;
create policy "anyone reads plans" on public.plans for select to anon, authenticated using (true);
create policy "admins change plans" on public.plans for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Where businesses set up their Direct Debit (Adfin's sign-up page), and whether Air Ledger Ltd charges VAT.
alter table public.platform
  add column dd_setup_url text not null default '' check (dd_setup_url = '' or dd_setup_url ~ '^https://'),
  add column vat_registered boolean not null default false,
  add column trial_days int not null default 14 check (trial_days between 0 and 90);

-- ---------- each business's plan ----------
create table public.org_plans (
  org_id uuid primary key references public.orgs on delete cascade,
  plan text not null default 'complete' references public.plans on update cascade,
  billing text not null default 'monthly' check (billing in ('monthly', 'yearly')),
  -- trial: free until trial_ends; active: paying; past_due: a payment failed; cancelled; free: never charged.
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'cancelled', 'free')),
  trial_ends date not null default (current_date + 14),
  extra_engineers int not null default 0 check (extra_engineers between 0 and 500),
  -- Who the invoices go to.
  billing_name text not null default '' check (length(billing_name) <= 200),
  billing_email text not null default '' check (length(billing_email) <= 200),
  chosen_at timestamptz,
  -- Direct Debit with Adfin: none yet, the owner says they've set it up, it's confirmed, it failed, or ended.
  dd_status text not null default 'none' check (dd_status in ('none', 'requested', 'active', 'failed', 'cancelled')),
  dd_ref text not null default '' check (length(dd_ref) <= 100),
  -- Yearly plans: paid up to this date.
  paid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.org_plans enable row level security;
revoke all on public.org_plans from anon, authenticated;
grant select on public.org_plans to authenticated;
create policy "team reads its plan" on public.org_plans for select to authenticated
  using (public.is_member(org_id) and not public.is_sub(org_id));
create trigger touch before update on public.org_plans for each row execute function public.touch_updated_at();

-- New businesses start a trial. Businesses that already exist (before paid plans) are left free.
create or replace function public.start_trial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.org_plans (org_id, trial_ends)
    values (new.id, current_date + coalesce((select trial_days from public.platform), 14))
    on conflict do nothing;
  return new;
end $$;
create trigger start_trial after insert on public.orgs for each row execute function public.start_trial();
insert into public.org_plans (org_id, status) select id, 'free' from public.orgs on conflict do nothing;

-- ---------- what a business can do ----------
-- Adding new work needs a live plan: free, paying, a payment being chased, or a trial that hasn't ended.
create or replace function public.org_can_add(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status in ('free', 'active', 'past_due') or (status = 'trial' and trial_ends >= current_date)
                   from public.org_plans where org_id = p_org), true)
$$;

-- The plan's limits (null assets: unlimited). A trial has the limits of the plan picked, Complete until then.
create or replace function public.org_limits(p_org uuid, out engineers int, out assets int)
language sql stable security definer set search_path = public as $$
  select case when o.status = 'free' then null else p.engineers + o.extra_engineers end,
         case when o.status = 'free' then null else p.assets end
  from public.org_plans o join public.plans p on p.code = o.plan where o.org_id = p_org
$$;
revoke all on function public.org_can_add(uuid), public.org_limits(uuid) from public, anon;
grant execute on function public.org_can_add(uuid), public.org_limits(uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['clients', 'systems', 'units', 'jobs'] loop
    execute format('create policy "live plan" on public.%I as restrictive for insert to authenticated '
      'with check (public.org_can_add(org_id))', t);
  end loop;
end $$;

-- Assets (units) and engineers (active people, not subcontractors) within the plan.
create or replace function public.check_plan_limits() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lim record;
  n int;
  plan_name text;
begin
  select * into lim from public.org_limits(new.org_id);
  select p.name into plan_name from public.org_plans o join public.plans p on p.code = o.plan where o.org_id = new.org_id;
  if tg_table_name = 'units' then
    if lim.assets is null then return new; end if;
    select count(*) into n from public.units where org_id = new.org_id;
    if n >= lim.assets then
      raise exception 'Your % plan includes % assets. Move to a bigger plan in Business → Plan and billing to add more.',
        plan_name, lim.assets using errcode = 'P0001';
    end if;
  else
    if lim.engineers is null or not new.active or new.sub then return new; end if;
    if tg_op = 'UPDATE' and old.active and not old.sub then return new; end if;
    select count(*) into n from public.people where org_id = new.org_id and active and not sub and id <> new.id;
    if n >= lim.engineers then
      raise exception 'Your % plan includes % engineers (owners count too). Add engineers or move plan in Business → Plan and billing.',
        plan_name, lim.engineers using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger plan_limits before insert on public.units for each row
  when (current_user = 'authenticated') execute function public.check_plan_limits();
create trigger plan_limits before insert or update of active, sub on public.people for each row
  when (current_user = 'authenticated') execute function public.check_plan_limits();

-- ---------- owners: choosing a plan ----------
-- An owner picks the plan, how often they pay, how many extra engineers and who the invoices go to. A trial
-- carries on until it ends; billing starts then.
create or replace function public.choose_plan(p_org uuid, p_plan text, p_billing text, p_extra int,
  p_name text, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  used int;
  lim int;
begin
  if not public.is_owner(p_org) then raise exception 'Only an owner can change the plan' using errcode = '42501'; end if;
  if not exists(select 1 from public.plans where code = p_plan and active) then raise exception 'That plan isn''t available'; end if;
  if p_billing not in ('monthly', 'yearly') then raise exception 'Choose monthly or yearly'; end if;
  if coalesce(p_extra, 0) < 0 or p_extra > 500 then raise exception 'Choose 0 to 500 extra engineers'; end if;
  if btrim(coalesce(p_email, '')) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter the email address invoices go to'; end if;
  select engineers + coalesce(p_extra, 0) into lim from public.plans where code = p_plan;
  select count(*) into used from public.people where org_id = p_org and active and not sub;
  if used > lim then
    raise exception 'You have % engineers, and that plan has room for %. Add extra engineers or remove some first.', used, lim;
  end if;
  if (select assets from public.plans where code = p_plan) < (select count(*) from public.units where org_id = p_org) then
    raise exception 'You have more assets than that plan includes. Choose a bigger plan.';
  end if;
  update public.org_plans set plan = p_plan, billing = p_billing, extra_engineers = coalesce(p_extra, 0),
    billing_name = left(btrim(coalesce(p_name, '')), 200), billing_email = lower(btrim(p_email)), chosen_at = now(),
    status = case when status = 'cancelled' then 'trial' else status end,
    trial_ends = case when status = 'cancelled' then current_date else trial_ends end
  where org_id = p_org;
end $$;

-- An owner says they've set up the Direct Debit on Adfin's page; Air Ledger confirms it.
create or replace function public.dd_requested(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner(p_org) then raise exception 'Only an owner can do this' using errcode = '42501'; end if;
  update public.org_plans set dd_status = 'requested' where org_id = p_org and dd_status in ('none', 'failed', 'cancelled');
end $$;

-- An owner cancels: the plan stops at the end of the trial, or now if paying.
create or replace function public.cancel_plan(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner(p_org) then raise exception 'Only an owner can cancel' using errcode = '42501'; end if;
  update public.org_plans set status = 'cancelled' where org_id = p_org and status <> 'free';
end $$;
revoke all on function public.choose_plan(uuid, text, text, int, text, text), public.dd_requested(uuid),
  public.cancel_plan(uuid) from public, anon;
grant execute on function public.choose_plan(uuid, text, text, int, text, text), public.dd_requested(uuid),
  public.cancel_plan(uuid) to authenticated;

-- ---------- Air Ledger Ltd: every business ----------
create or replace function public.platform_businesses()
returns table (org_id uuid, name text, created_at timestamptz, owner_email text, plan text, plan_name text,
  billing text, status text, trial_ends date, extra_engineers int, billing_name text, billing_email text,
  chosen_at timestamptz, dd_status text, dd_ref text, paid_until date, engineers int, subcontractors int,
  assets int, amount numeric)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.created_at,
    (select m.email from public.members m where m.org_id = o.id and m.role = 'owner' order by m.created_at limit 1),
    op.plan, p.name, op.billing, op.status, op.trial_ends, op.extra_engineers, op.billing_name, op.billing_email,
    op.chosen_at, op.dd_status, op.dd_ref, op.paid_until,
    (select count(*)::int from public.people x where x.org_id = o.id and x.active and not x.sub),
    (select count(*)::int from public.people x where x.org_id = o.id and x.active and x.sub),
    (select count(*)::int from public.units u where u.org_id = o.id),
    case when op.billing = 'yearly' then p.yearly + op.extra_engineers * p.extra_engineer * 12
         else p.monthly + op.extra_engineers * p.extra_engineer end
  from public.orgs o join public.org_plans op on op.org_id = o.id join public.plans p on p.code = op.plan
  where public.is_platform_admin()
  order by o.created_at desc
$$;

-- Air Ledger Ltd changes a business's plan, status, trial or Direct Debit.
create or replace function public.platform_set_plan(p_org uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only Air Ledger can do this' using errcode = '42501'; end if;
  update public.org_plans set
    plan = coalesce(p->>'plan', plan),
    billing = coalesce(p->>'billing', billing),
    status = coalesce(p->>'status', status),
    trial_ends = coalesce((p->>'trial_ends')::date, trial_ends),
    extra_engineers = coalesce((p->>'extra_engineers')::int, extra_engineers),
    dd_status = coalesce(p->>'dd_status', dd_status),
    dd_ref = coalesce(p->>'dd_ref', dd_ref),
    paid_until = case when p ? 'paid_until' then nullif(p->>'paid_until', '')::date else paid_until end
  where org_id = p_org;
  if not found then raise exception 'Business not found'; end if;
end $$;
revoke all on function public.platform_businesses(), public.platform_set_plan(uuid, jsonb) from public, anon;
grant execute on function public.platform_businesses(), public.platform_set_plan(uuid, jsonb) to authenticated;

create trigger audit after insert or update or delete on public.org_plans
  for each row execute function public.audit();

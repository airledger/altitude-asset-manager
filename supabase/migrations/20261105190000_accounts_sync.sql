-- Live accounts sync (part 2): a business connects Xero or QuickBooks once, then invoices and customers are
-- sent across from the Invoices page and payments come back by themselves. Sage 50 is desktop software
-- with no online connection, so it stays on CSV export.
--
-- accounts_connections   one per business: which system, which company, and the sign-in tokens (encrypted by the
--                        accounts function before they're stored). Service key only; owners read the status
--                        through accounts_connection().
-- accounts_oauth_states  the one-time state sent to Xero/Intuit while connecting. Service key only.
-- client_billing         gains the customer's id in the accounts system.
-- invoices               gains when it was sent, any error, and what's been paid.

create table if not exists public.accounts_connections (
  org_id uuid primary key references public.orgs on delete cascade,
  system text not null check (system in ('xero', 'quickbooks')),
  tenant_id text not null,
  tenant_name text not null default '',
  tokens text not null,
  expires_at timestamptz not null,
  connected_by uuid references auth.users on delete set null,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error text not null default ''
);
alter table public.accounts_connections enable row level security;
revoke all on public.accounts_connections from anon, authenticated;

create table if not exists public.accounts_oauth_states (
  state text primary key,
  org_id uuid not null references public.orgs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  system text not null check (system in ('xero', 'quickbooks')),
  return_to text not null default '',
  created_at timestamptz not null default now()
);
alter table public.accounts_oauth_states enable row level security;
revoke all on public.accounts_oauth_states from anon, authenticated;

alter table public.client_billing add column if not exists external_system text
  check (external_system in ('xero', 'quickbooks'));
alter table public.client_billing add column if not exists external_id text;

alter table public.invoices add column if not exists synced_at timestamptz;
alter table public.invoices add column if not exists sync_error text not null default '';
alter table public.invoices add column if not exists amount_paid numeric not null default 0;
alter table public.invoices add column if not exists paid_at date;

-- What the Prices and accounts page shows: never the tokens.
create or replace function public.accounts_connection(p_org uuid)
returns table (system text, tenant_name text, connected_at timestamptz, last_sync_at timestamptz, last_error text)
language sql stable security definer set search_path = public as $$
  select c.system, c.tenant_name, c.connected_at, c.last_sync_at, c.last_error
  from public.accounts_connections c
  where c.org_id = p_org and public.is_owner(p_org)
$$;
revoke all on function public.accounts_connection(uuid) from public, anon;
grant execute on function public.accounts_connection(uuid) to authenticated;

-- Connecting and disconnecting go in the audit log, without the tokens.
create or replace function public.audit_accounts_connection() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.accounts_connections := coalesce(new, old);
begin
  if not exists(select 1 from public.orgs where id = r.org_id) then return null; end if;
  if tg_op = 'UPDATE' and new.tenant_id is not distinct from old.tenant_id and new.system = old.system then
    return null;
  end if;
  insert into public.audit_log (org_id, actor, action, entity, entity_id, detail)
    values (r.org_id, coalesce(auth.uid(), r.connected_by),
            case tg_op when 'DELETE' then 'disconnect' else 'connect' end, 'accounts_connections', r.org_id::text,
            jsonb_build_object('system', r.system, 'company', r.tenant_name));
  return null;
end $$;
revoke all on function public.audit_accounts_connection() from public, anon, authenticated;
drop trigger if exists audit on public.accounts_connections;
create trigger audit after insert or update or delete on public.accounts_connections
  for each row execute function public.audit_accounts_connection();

-- Air Ledger: keep prices and invoices to business owners.
-- Run ONCE in Supabase, after supabase-multi-business.sql: SQL Editor → New query → paste → Run. Safe to re-run.
-- Engineers (team members who aren't owners) can still read and write clients, assets, jobs, materials and reports,
-- but can't read or change anything in the "pricing" or "invoices" collections.
-- The app moves existing prices into "pricing" the next time an owner opens it.

begin;

create or replace function public.can_use_doc(p_org uuid, p_col text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_org in (select public.my_org_ids())
     and (p_col not in ('pricing','invoices') or public.is_owner(p_org))
$$;

drop policy if exists "members read their business" on public.docs;
drop policy if exists "members write their business" on public.docs;
create policy "members read their business" on public.docs for select to authenticated
  using (public.can_use_doc(org_id, col));
create policy "members write their business" on public.docs for all to authenticated
  using (public.can_use_doc(org_id, col)) with check (public.can_use_doc(org_id, col));

commit;

-- Pricing and invoices (rebuild stage 7, spec F12).
-- Invoices are drafted by an owner's device from completed jobs waiting to be invoiced (billing 'pending'),
-- through create_invoice, which numbers them under a lock and gives a job one invoice at most.

-- ---------- only owners decide how a job is billed ----------
-- Completing a job marks it 'pending' (anyone can, through complete_job); anything else is an owner's call,
-- so an engineer can't mark a job as covered by a plan to keep it off an invoice.
create or replace function public.guard_job_billing() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.billing is distinct from old.billing
     and current_user in ('authenticated', 'anon')
     and not public.is_owner(new.org_id)
     and not (old.billing = 'none' and new.billing = 'pending') then
    new.billing := old.billing;
  end if;
  return new;
end $$;
drop trigger if exists guard_job_billing on public.jobs;
create trigger guard_job_billing before update on public.jobs
  for each row execute function public.guard_job_billing();

-- ---------- editing an invoice in one go ----------
-- Replaces the details and lines together, so a dropped connection can't leave half the lines saved.
create or replace function public.save_invoice(
  p_invoice uuid, p_date date, p_due_date date, p_reference text, p_vat boolean, p_lines jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if not found or not public.is_owner(inv.org_id) then
    raise exception 'Only business owners can change invoices' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'An invoice needs at least one line';
  end if;
  update public.invoices set
    date = coalesce(p_date, date),
    due_date = p_due_date,
    reference = coalesce(p_reference, ''),
    vat_rate = case when p_vat then 0.2 else 0 end
  where id = p_invoice;
  delete from public.invoice_lines where invoice_id = p_invoice;
  insert into public.invoice_lines (org_id, invoice_id, position, description, qty, unit_price)
    select inv.org_id, p_invoice, (l.ord - 1)::int, l.v ->> 'desc', (l.v ->> 'qty')::numeric, (l.v ->> 'unit')::numeric
    from jsonb_array_elements(p_lines) with ordinality as l(v, ord);
end $$;
revoke execute on function public.save_invoice(uuid, date, date, text, boolean, jsonb) from public, anon;
grant execute on function public.save_invoice(uuid, date, date, text, boolean, jsonb) to authenticated;

create index if not exists invoices_org_status on public.invoices (org_id, status, date desc);
create index if not exists jobs_pending_billing on public.jobs (org_id) where billing = 'pending';

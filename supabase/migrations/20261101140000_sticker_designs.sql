-- Sticker designer and sticker batches (spec 03, F7; REBUILD-PLAN "design and order stickers").
-- Each business saves one sticker design. Ordering stickers creates a batch: Air Ledger reserves that many codes
-- for the business and keeps the design used, so the print-ready PDF can be downloaded again later.

alter table public.org_settings
  add column sticker_design jsonb not null default '{}'::jsonb
    check (jsonb_typeof(sticker_design) = 'object' and pg_column_size(sticker_design) < 16384);

create table public.sticker_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  quantity int not null check (quantity between 1 and 5000),
  design jsonb not null default '{}'::jsonb check (jsonb_typeof(design) = 'object'),
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users on delete set null
);
create index sticker_batches_org on public.sticker_batches (org_id, created_at desc);
-- Members see their business's batches; only create_sticker_batch() adds them.
select public.apply_tenant_rules('sticker_batches', 'owners');
drop policy "read" on public.sticker_batches;
create policy "read" on public.sticker_batches for select to authenticated using (public.is_member(org_id));
drop policy "add" on public.sticker_batches;
drop policy "edit" on public.sticker_batches;

alter table public.sticker_reservations
  add column batch_id uuid references public.sticker_batches on delete set null;
create index sticker_reservations_batch on public.sticker_reservations (batch_id) where batch_id is not null;

-- Owner only: reserves p_count new codes for the business as one batch, with the design they'll be printed in.
create or replace function public.create_sticker_batch(p_org uuid, p_count int, p_design jsonb, p_note text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  b uuid;
  codes text[];
begin
  if not public.is_owner(p_org) then
    raise exception 'Only an owner can order stickers' using errcode = '42501';
  end if;
  if p_count is null or p_count < 1 or p_count > 5000 then raise exception 'Choose between 1 and 5,000 stickers'; end if;
  insert into public.sticker_batches (org_id, quantity, design, note)
    values (p_org, p_count, coalesce(p_design, '{}'::jsonb), left(coalesce(p_note, ''), 200))
    returning id into b;
  -- Reserve first, then tag: the update needs to see the rows reserve_stickers() just inserted.
  select array_agg(c) into codes from public.reserve_stickers(p_org, p_count) c;
  update public.sticker_reservations set batch_id = b where code = any(codes);
  return b;
end $$;

revoke all on function public.create_sticker_batch(uuid, int, jsonb, text) from public, anon;
grant execute on function public.create_sticker_batch(uuid, int, jsonb, text) to authenticated;

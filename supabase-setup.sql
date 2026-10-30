-- Run once in Supabase: SQL Editor → New query → paste → Run.

-- All app records (clients, systems, units, jobs, materials, invoices, reports, settings)
create table if not exists public.docs (
  col text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
alter table public.docs replica identity full;
alter table public.docs enable row level security;

drop policy if exists "signed-in users can read" on public.docs;
drop policy if exists "signed-in users can write" on public.docs;
create policy "signed-in users can read" on public.docs for select to authenticated using (true);
create policy "signed-in users can write" on public.docs for all to authenticated using (true) with check (true);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs for each row execute function public.touch_updated_at();

-- Live sync between phone and laptop
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- Private bucket for job photos
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
on conflict (id) do nothing;
drop policy if exists "signed-in users manage photos" on storage.objects;
create policy "signed-in users manage photos" on storage.objects for all to authenticated
  using (bucket_id = 'photos') with check (bucket_id = 'photos');

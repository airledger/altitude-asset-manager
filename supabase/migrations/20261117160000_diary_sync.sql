-- Two-way calendar (part 1): each person can connect their own Google, Outlook or iCloud calendar by its private
-- calendar address. The calendar-sync function reads it and saves the times they're busy, which show on the
-- Schedule next to their jobs and can be turned into a job. (Jobs already go out to calendars by link and invite.)

-- A person's own calendar address is private to them: nobody else in the business can read it.
create table public.diary_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  -- Only calendar services we know, so the sync never fetches anything else.
  url text not null check (
    length(url) <= 1000 and url ~ ('^https://(calendar\.google\.com|outlook\.office365\.com|outlook\.live\.com'
      || '|outlook\.office\.com|p[0-9]+-caldav\.icloud\.com|p[0-9]+-calendars\.icloud\.com)/')),
  -- Off: the team just sees "Busy". On: they see what each entry is called.
  show_titles boolean not null default false,
  synced_at timestamptz,
  error text not null default '',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
alter table public.diary_links enable row level security;
revoke all on public.diary_links from anon;
create policy "own" on public.diary_links for all to authenticated
  using (user_id = auth.uid() and public.is_member(org_id))
  with check (user_id = auth.uid() and public.is_member(org_id));
-- Only the sync records when it last ran.
revoke insert, update on public.diary_links from authenticated;
grant insert (org_id, user_id, url, show_titles), update (url, show_titles) on public.diary_links to authenticated;

-- Times people are busy, from their calendar. Written only by the sync; the whole business can see them.
create table public.busy_blocks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  title text not null default 'Busy',
  check (ends_at > starts_at)
);
create index on public.busy_blocks (org_id, starts_at);
alter table public.busy_blocks enable row level security;
revoke all on public.busy_blocks from anon;
revoke insert, update, delete on public.busy_blocks from authenticated;
create policy "read" on public.busy_blocks for select to authenticated using (public.is_member(org_id));

-- Who in the business has a calendar connected and whether it's working, without the private address.
create or replace function public.diary_status(p_org uuid)
returns table (user_id uuid, synced_at timestamptz, error text)
language sql stable security definer set search_path = public as $$
  select f.user_id, f.synced_at, f.error from public.diary_links f
  where f.org_id = p_org and public.is_member(p_org)
$$;
revoke all on function public.diary_status(uuid) from public, anon;
grant execute on function public.diary_status(uuid) to authenticated;

-- A person who leaves the business takes their calendar with them.
create or replace function public.drop_diary_on_leave() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.diary_links where org_id = old.org_id and user_id = old.user_id;
  delete from public.busy_blocks where org_id = old.org_id and user_id = old.user_id;
  return old;
end $$;
revoke all on function public.drop_diary_on_leave() from public, anon, authenticated;
create trigger drop_diary after delete on public.members
  for each row execute function public.drop_diary_on_leave();

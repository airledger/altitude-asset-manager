-- Waiting list for the airledger.co.uk marketing site.
-- Visitors can add themselves through join_waitlist(); nobody can read the
-- table through the API (no select policy), only from the Supabase dashboard.

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (length(name) between 1 and 120),
  business text not null check (length(business) between 1 and 160),
  email text not null check (email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' and length(email) <= 254),
  engineers text check (length(engineers) <= 10),
  current_system text check (length(current_system) <= 200),
  source text check (length(source) <= 500)
);

create unique index if not exists waitlist_email_key on public.waitlist (lower(email));

alter table public.waitlist enable row level security;
revoke all on public.waitlist from anon, authenticated;

create or replace function public.join_waitlist(
  p_name text, p_business text, p_email text,
  p_engineers text default null, p_current_system text default null, p_source text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.waitlist (name, business, email, engineers, current_system, source)
  values (trim(p_name), trim(p_business), lower(trim(p_email)),
          nullif(trim(p_engineers), ''), nullif(trim(p_current_system), ''), nullif(left(trim(p_source), 500), ''))
  on conflict (lower(email)) do nothing;
end;
$$;

revoke all on function public.join_waitlist(text, text, text, text, text, text) from public;
grant execute on function public.join_waitlist(text, text, text, text, text, text) to anon, authenticated;

-- Rebuild stage 5, part 2: engineers, booking jobs to an engineer, and calendar links.

-- ---------- engineers ("people") ----------
-- Everyone who can be booked on a job. An owner can add someone before they have an account; when that
-- person joins through their invite, their account is linked to the same row. Removing someone from the
-- team keeps their row (marked inactive) so old jobs still show who did them.
create table public.people (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  user_id uuid references auth.users on delete set null,
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  fgas_cert text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, user_id)
);
create unique index people_org_email on public.people (org_id, lower(email)) where email <> '' and active;
select public.apply_tenant_rules('people', 'members-read');
-- People can keep their own phone number and F-gas certificate up to date.
create policy "edit own details" on public.people for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Only owners change who's active, whose account a row belongs to, or the email the invite goes to.
create or replace function public.guard_people() returns trigger
language plpgsql set search_path = public as $$
begin
  if not public.is_owner(new.org_id) and (new.user_id is distinct from old.user_id
      or new.active is distinct from old.active or new.email is distinct from old.email) then
    new.user_id := old.user_id; new.active := old.active; new.email := old.email;
  end if;
  return new;
end $$;
create trigger guard_people before update on public.people for each row
  when (current_user = 'authenticated') execute function public.guard_people();

-- Everyone already in a team gets a row. Their name starts as the first part of their email address.
insert into public.people (org_id, user_id, name, email)
  select m.org_id, m.user_id, initcap(split_part(coalesce(m.email, ''), '@', 1)), lower(coalesce(m.email, ''))
  from public.members m
  on conflict do nothing;

-- When someone joins a team, link them to the row the owner made for them (by email), or make one.
-- When they're removed, their row stays but is marked inactive.
create or replace function public.sync_people() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if tg_op = 'DELETE' then
    update public.people set active = false, user_id = null where org_id = old.org_id and user_id = old.user_id;
    return old;
  end if;
  v_email := lower(coalesce(new.email, ''));
  if exists(select 1 from public.people where org_id = new.org_id and user_id = new.user_id) then return new; end if;
  update public.people set user_id = new.user_id, active = true
    where id = (select id from public.people where org_id = new.org_id and user_id is null and v_email <> ''
                and lower(email) = v_email order by active desc, created_at limit 1);
  if not found then
    insert into public.people (org_id, user_id, name, email)
      values (new.org_id, new.user_id, initcap(split_part(v_email, '@', 1)), v_email);
  end if;
  return new;
end $$;
create trigger sync_people after insert or delete on public.members for each row execute function public.sync_people();

-- ---------- jobs are booked to an engineer ----------
-- engineer (text) stays as the name printed on reports; engineer_id says whose diary the job is in.
alter table public.jobs add column engineer_id uuid;
alter table public.jobs add constraint jobs_engineer_fk foreign key (engineer_id, org_id)
  references public.people (id, org_id) on delete set null (engineer_id);
create index jobs_engineer on public.jobs (engineer_id, date);
update public.jobs j set engineer_id = p.id from public.people p
  where p.org_id = j.org_id and j.engineer <> '' and lower(p.name) = lower(j.engineer);

-- ---------- invites name the person ----------
alter table public.invites add column person_id uuid references public.people on delete cascade;

-- Owner: an invite for someone they've added. The invite is locked to that person's email.
create or replace function public.invite_person(p_person uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_p public.people; v_code text;
begin
  select * into v_p from public.people where id = p_person;
  if not found or not public.is_owner(v_p.org_id) then raise exception 'Only the business owner can invite people'; end if;
  if v_p.user_id is not null then raise exception '% has already joined', v_p.name; end if;
  if v_p.email = '' then raise exception 'Add %''s email address first', v_p.name; end if;
  -- One live invite per person: a new one replaces any that wasn't used.
  delete from public.invites where person_id = p_person and used_by is null;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.invites (code, org_id, email, created_by, person_id)
    values (v_code, v_p.org_id, lower(v_p.email), auth.uid(), p_person);
  return v_code;
end $$;
revoke all on function public.invite_person(uuid) from public, anon;
grant execute on function public.invite_person(uuid) to authenticated;

-- Public: what an invite is for, plus the name and email the owner entered so sign-up is filled in.
drop function public.invite_info(text);
create function public.invite_info(p_code text)
  returns table (valid boolean, joins boolean, org_name text, email text, name text)
language sql stable security definer set search_path = public as $$
  select true, i.org_id is not null, o.name, coalesce(i.email, ''), coalesce(p.name, '')
  from public.invites i left join public.orgs o on o.id = i.org_id left join public.people p on p.id = i.person_id
  where i.code = upper(trim(p_code)) and i.used_by is null and i.expires_at > now()
$$;
grant execute on function public.invite_info(text) to anon, authenticated;

-- ---------- calendar links ----------
-- A private link per person (or one for the whole business) that Apple Calendar, Google Calendar and
-- Outlook subscribe to. Anyone with the link sees those jobs, so it can be replaced with a new one.
create table public.calendar_feeds (
  token uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  person_id uuid references public.people on delete cascade,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create unique index calendar_feeds_one on public.calendar_feeds (org_id, coalesce(person_id, '00000000-0000-0000-0000-000000000000'));
alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from anon, authenticated;

-- The link's token for a person's diary (p_person) or every job (null, owners only). p_new replaces it.
-- Engineers can only get their own.
create or replace function public.calendar_link(p_org uuid, p_person uuid default null, p_new boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_token uuid;
begin
  if not public.is_member(p_org) then raise exception 'Not your business' using errcode = 'P0002'; end if;
  if not public.is_owner(p_org) and (p_person is null or not exists(
      select 1 from public.people where id = p_person and org_id = p_org and user_id = auth.uid())) then
    raise exception 'You can only get your own calendar link';
  end if;
  if p_person is not null and not exists(select 1 from public.people where id = p_person and org_id = p_org) then
    raise exception 'Not your business' using errcode = 'P0002';
  end if;
  if p_new then
    delete from public.calendar_feeds where org_id = p_org and person_id is not distinct from p_person;
  end if;
  select token into v_token from public.calendar_feeds where org_id = p_org and person_id is not distinct from p_person;
  if v_token is null then
    insert into public.calendar_feeds (org_id, person_id) values (p_org, p_person) returning token into v_token;
  end if;
  return v_token;
end $$;
revoke all on function public.calendar_link(uuid, uuid, boolean) from public, anon;
grant execute on function public.calendar_link(uuid, uuid, boolean) to authenticated;

-- Text escaping for calendar files (RFC 5545).
create or replace function public.ics_text(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(t, ''), '\', '\\'), ';', '\;'), ',', '\,'), E'\r', ''), E'\n', '\n')
$$;

-- Public, by token: the calendar file. Jobs from 60 days ago onwards; cancelled jobs are sent as
-- cancelled so they disappear from the diary. p_base is the app's address, for a link back to each job.
create or replace function public.calendar_ics(p_token uuid, p_base text default 'https://app.airledger.co.uk')
returns text language plpgsql stable security definer set search_path = public as $$
declare
  f public.calendar_feeds;
  who text;
  ics text;
  nl constant text := E'\r\n';
  r record;
  starts timestamptz;
begin
  select * into f from public.calendar_feeds where token = p_token;
  if not found then return null; end if;
  if f.person_id is not null then
    select name into who from public.people where id = f.person_id and active;
    if not found then return null; end if;
  end if;
  select coalesce(who || ' · ', '') || o.name into who from public.orgs o where o.id = f.org_id;

  ics := 'BEGIN:VCALENDAR' || nl || 'VERSION:2.0' || nl || 'PRODID:-//Air Ledger//Jobs//EN' || nl ||
    'CALSCALE:GREGORIAN' || nl || 'METHOD:PUBLISH' || nl ||
    'X-WR-CALNAME:' || public.ics_text('Air Ledger · ' || who) || nl ||
    'X-WR-TIMEZONE:Europe/London' || nl || 'REFRESH-INTERVAL;VALUE=DURATION:PT1H' || nl ||
    'X-PUBLISHED-TTL:PT1H' || nl;

  for r in
    select j.id, j.type, j.status, j.date, j.time, coalesce(j.duration_hrs, 1) as hrs, j.engineer, j.notes,
      j.updated_at, s.name as system_name, s.site_address, s.site_postcode, s.access_notes, c.name as client_name
    from public.jobs j
      join public.systems s on s.id = j.system_id
      left join public.clients c on c.id = s.client_id
    where j.org_id = f.org_id and j.deleted_at is null and j.date is not null
      and j.date >= current_date - 60
      and (f.person_id is null or j.engineer_id = f.person_id)
    order by j.date, j.time
  loop
    ics := ics || 'BEGIN:VEVENT' || nl || 'UID:' || r.id || '@airledger.co.uk' || nl ||
      'DTSTAMP:' || to_char(r.updated_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || nl ||
      'LAST-MODIFIED:' || to_char(r.updated_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || nl;
    if r.time is null then
      ics := ics || 'DTSTART;VALUE=DATE:' || to_char(r.date, 'YYYYMMDD') || nl ||
        'DTEND;VALUE=DATE:' || to_char(r.date + 1, 'YYYYMMDD') || nl;
    else
      starts := (r.date + r.time) at time zone 'Europe/London';
      ics := ics || 'DTSTART:' || to_char(starts at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || nl ||
        'DTEND:' || to_char((starts + make_interval(mins => greatest(round(r.hrs * 60)::int, 15))) at time zone 'UTC',
          'YYYYMMDD"T"HH24MISS"Z"') || nl;
    end if;
    ics := ics ||
      'SUMMARY:' || public.ics_text(case when r.status = 'completed' then '✓ ' else '' end || r.type ||
        coalesce(' · ' || r.client_name, '')) || nl ||
      'LOCATION:' || public.ics_text(concat_ws(', ', nullif(r.site_address, ''), nullif(r.site_postcode, ''))) || nl ||
      'DESCRIPTION:' || public.ics_text(concat_ws(E'\n',
        r.system_name,
        nullif('Engineer: ' || r.engineer, 'Engineer: '),
        nullif('Access: ' || r.access_notes, 'Access: '),
        nullif(r.notes, ''),
        p_base || '/#/job/' || r.id)) || nl ||
      'URL:' || p_base || '/#/job/' || r.id || nl ||
      'STATUS:' || case r.status when 'cancelled' then 'CANCELLED' else 'CONFIRMED' end || nl ||
      'END:VEVENT' || nl;
  end loop;
  return ics || 'END:VCALENDAR' || nl;
end $$;
revoke all on function public.calendar_ics(uuid, text) from public;
grant execute on function public.calendar_ics(uuid, text) to anon, authenticated;

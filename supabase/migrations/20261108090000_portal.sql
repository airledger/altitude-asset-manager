-- Customer portal (part 2). A business invites a client's contact to the portal; they sign in with their own
-- email and see only that client's sites, units, visits, service reports and contracts (never prices, notes
-- or anyone else's records). They can ask for a visit, from the portal or by scanning a unit's label, and
-- accept a booked visit or ask for another time. If the business turns it on, they can pick a free morning or
-- afternoon from the diary and it's booked straight away.
--
-- Customers never read the business's tables directly: everything they see comes through the portal_*
-- functions below, which check portal_users first.

create table if not exists public.portal_users (
  client_id uuid not null,
  user_id uuid not null references auth.users on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  email text not null default '',
  created_at timestamptz not null default now(),
  primary key (client_id, user_id),
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete cascade
);
create index if not exists portal_users_user on public.portal_users (user_id);
select public.apply_tenant_rules('portal_users', 'owners');
-- Engineers can see a client has portal access; only owners add or remove it.
drop policy if exists "read" on public.portal_users;
create policy "read" on public.portal_users for select to authenticated
  using (public.is_member(org_id) or user_id = auth.uid());

create table if not exists public.portal_invites (
  code text primary key,
  org_id uuid not null references public.orgs on delete cascade,
  client_id uuid not null,
  email text not null default '',
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  used_by uuid references auth.users on delete set null,
  used_at timestamptz,
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete cascade
);
select public.apply_tenant_rules('portal_invites', 'owners');

create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  client_id uuid not null,
  system_id uuid,
  kind text not null default 'Repair' check (kind in ('Service', 'Repair', 'Other')),
  message text not null default '',
  preferred text not null default '',
  status text not null default 'requested' check (status in ('requested', 'booked', 'declined', 'withdrawn')),
  job_id uuid,
  reply text not null default '',
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete cascade,
  foreign key (system_id, org_id) references public.systems (id, org_id) on delete set null (system_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete set null (job_id)
);
create index if not exists service_requests_open on public.service_requests (org_id, status, created_at);
select public.apply_tenant_rules('service_requests', 'members');

-- The customer's answer to a booked visit. Moving the visit clears it, so they're asked again.
alter table public.jobs add column if not exists customer_response text
  check (customer_response in ('accepted', 'change'));
alter table public.jobs add column if not exists customer_note text not null default '';
alter table public.jobs add column if not exists customer_responded_at timestamptz;

create or replace function public.reset_customer_response() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.date, new.time) is distinct from (old.date, old.time) and new.customer_response = old.customer_response
     and old.customer_response is not null then
    new.customer_response := null;
    new.customer_note := '';
    new.customer_responded_at := null;
  end if;
  return new;
end $$;
drop trigger if exists reset_customer_response on public.jobs;
create trigger reset_customer_response before update on public.jobs
  for each row execute function public.reset_customer_response();

-- Self-booking: off unless the business turns it on, and how many visits fit in a morning or afternoon.
alter table public.org_settings add column if not exists portal_self_booking boolean not null default false;
alter table public.org_settings add column if not exists portal_slots_per_half int not null default 2
  check (portal_slots_per_half between 1 and 20);

-- What's been emailed to customers about each visit, so an unchanged save sends nothing. Service key only.
create table if not exists public.portal_notices (
  job_id uuid primary key references public.jobs on delete cascade,
  fingerprint text not null,
  sent_at timestamptz not null default now()
);
alter table public.portal_notices enable row level security;
revoke all on public.portal_notices from anon, authenticated;

-- ---------- helpers ----------
create or replace function public.is_portal_user(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.portal_users where client_id = p_client and user_id = auth.uid())
$$;

-- ---------- inviting ----------
create or replace function public.create_portal_invite(p_client uuid, p_email text default '') returns text
language plpgsql security definer set search_path = public as $$
declare
  c public.clients;
  v_code text;
begin
  select * into c from public.clients where id = p_client;
  if not found or not public.is_owner(c.org_id) then
    raise exception 'Only business owners can invite customers' using errcode = '42501';
  end if;
  v_code := 'P' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 9));
  insert into public.portal_invites (code, org_id, client_id, email)
    values (v_code, c.org_id, c.id, lower(trim(coalesce(p_email, ''))));
  return v_code;
end $$;

-- Public (before sign-in): who the invite is from, to show on the sign-up screen.
create or replace function public.portal_invite_info(p_code text)
returns table (valid boolean, org_name text, client_name text, email text)
language sql stable security definer set search_path = public as $$
  select true, o.name, c.name, i.email
  from public.portal_invites i join public.orgs o on o.id = i.org_id join public.clients c on c.id = i.client_id
  where i.code = upper(trim(p_code)) and i.used_by is null and i.expires_at > now()
$$;

create or replace function public.accept_portal_invite(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v public.portal_invites;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into v from public.portal_invites
    where code = upper(trim(p_code)) and used_by is null and expires_at > now() for update;
  if not found then raise exception 'That portal link has expired or has already been used. Ask for a new one.'; end if;
  if v.email <> '' and v.email <> lower(auth.jwt() ->> 'email') then
    raise exception 'This portal link was sent to a different email address';
  end if;
  insert into public.portal_users (client_id, user_id, org_id, email)
    values (v.client_id, auth.uid(), v.org_id, lower(coalesce(auth.jwt() ->> 'email', '')))
  on conflict do nothing;
  update public.portal_invites set used_by = auth.uid(), used_at = now() where code = v.code;
  return v.client_id;
end $$;

-- The portals the signed-in person can open.
create or replace function public.my_portals()
returns table (client_id uuid, client_name text, org_id uuid, org_name text, logo_url text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, o.id, o.name, o.logo_url
  from public.portal_users p join public.clients c on c.id = p.client_id join public.orgs o on o.id = p.org_id
  where p.user_id = auth.uid()
  order by o.name, c.name
$$;

-- ---------- what the customer sees ----------
create or replace function public.portal_overview(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.clients;
  out jsonb;
begin
  if not public.is_portal_user(p_client) then raise exception 'Not found' using errcode = '42501'; end if;
  select * into c from public.clients where id = p_client;
  select jsonb_build_object(
    'business', (select jsonb_build_object('name', o.name, 'logo_url', o.logo_url,
        'phone', coalesce(s.phone, ''), 'email', coalesce(nullif(s.email, ''), ''),
        'self_booking', coalesce(s.portal_self_booking, false))
      from public.orgs o left join public.org_settings s on s.org_id = o.id where o.id = c.org_id),
    'client', jsonb_build_object('id', c.id, 'name', c.name),
    'sites', coalesce((select jsonb_agg(jsonb_build_object(
        'id', y.id, 'name', y.name, 'address', y.site_address, 'postcode', y.site_postcode,
        'refrigerant', y.refrigerant,
        'units', coalesce((select jsonb_agg(jsonb_build_object(
            'asset_no', u.asset_no, 'sticker_code', u.sticker_code, 'role', u.role, 'indoor_type', u.indoor_type,
            'manufacturer', u.manufacturer, 'model', u.model, 'location', u.location) order by u.role desc, u.asset_no)
          from public.units u where u.system_id = y.id), '[]'::jsonb)) order by y.name)
      from public.systems y where y.client_id = c.id and y.deleted_at is null and not y.inactive), '[]'::jsonb),
    'visits', coalesce((select jsonb_agg(jsonb_build_object(
        'id', j.id, 'date', j.date, 'time', j.time, 'type', j.type, 'status', j.status, 'site', y.name,
        'engineer', split_part(coalesce(nullif(j.engineer, ''), ''), ' ', 1),
        'customer_response', j.customer_response, 'customer_note', j.customer_note) order by j.date desc nulls last, j.time desc)
      from public.jobs j join public.systems y on y.id = j.system_id
      where y.client_id = c.id and j.deleted_at is null and j.status <> 'cancelled'
        and (j.date is null or j.date >= current_date - 730)), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'ref', r.ref, 'rev', r.rev, 'issued_at', r.issued_at, 'type', j.type, 'date', j.date,
        'site', y.name, 'path', f.path) order by r.issued_at desc)
      from public.service_reports r
      join public.jobs j on j.id = r.job_id join public.systems y on y.id = j.system_id
      join public.files f on f.id = r.pdf_file_id
      where y.client_id = c.id and j.deleted_at is null
        and r.rev = (select max(r2.rev) from public.service_reports r2 where r2.job_id = r.job_id)), '[]'::jsonb),
    'contracts', coalesce((select jsonb_agg(jsonb_build_object(
        'name', k.name, 'start_date', k.start_date, 'end_date', k.end_date, 'visits_per_year', k.visits_per_year,
        'visit_type', k.visit_type) order by k.end_date desc)
      from public.contracts k where k.client_id = c.id and k.status = 'active'), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
        'id', q.id, 'kind', q.kind, 'message', q.message, 'preferred', q.preferred, 'status', q.status,
        'reply', q.reply, 'created_at', q.created_at, 'site', y.name) order by q.created_at desc)
      from public.service_requests q left join public.systems y on y.id = q.system_id
      where q.client_id = c.id and q.created_at > now() - interval '1 year'), '[]'::jsonb)
  ) into out;
  return out;
end $$;

-- Free mornings and afternoons over the next four weeks (weekdays, from the day after tomorrow), when the
-- business lets customers book themselves.
create or replace function public.portal_slots(p_client uuid) returns table (day date, part text)
language plpgsql stable security definer set search_path = public as $$
declare
  c public.clients;
  st public.org_settings;
begin
  if not public.is_portal_user(p_client) then raise exception 'Not found' using errcode = '42501'; end if;
  select * into c from public.clients where id = p_client;
  select * into st from public.org_settings where org_id = c.org_id;
  if not coalesce(st.portal_self_booking, false) then return; end if;
  return query
    select d::date, h.part
    from generate_series(current_date + 2, current_date + 29, interval '1 day') d
    cross join (values ('am'), ('pm')) h(part)
    where extract(isodow from d) < 6
      and (select count(*) from public.jobs j
           where j.org_id = c.org_id and j.date = d::date and j.status <> 'cancelled' and j.deleted_at is null
             and (case when coalesce(j.time, '09:00') < '12:00' then 'am' else 'pm' end) = h.part)
          < st.portal_slots_per_half
    order by 1, 2;
end $$;

-- A customer asks for a visit. With a slot (self-booking on and the slot still free) it's booked straight away
-- as an unassigned job; otherwise it waits as "requested" for the business to book.
create or replace function public.portal_request(
  p_client uuid, p_system uuid, p_kind text, p_message text, p_preferred text default '',
  p_slot_date date default null, p_slot_part text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.clients;
  q uuid;
  j uuid;
begin
  if not public.is_portal_user(p_client) then raise exception 'Not found' using errcode = '42501'; end if;
  select * into c from public.clients where id = p_client;
  if p_system is not null and not exists (select 1 from public.systems where id = p_system and client_id = p_client) then
    raise exception 'Choose one of your sites';
  end if;
  if coalesce(trim(p_message), '') = '' and p_kind <> 'Service' then raise exception 'Say what the problem is'; end if;
  insert into public.service_requests (org_id, client_id, system_id, kind, message, preferred)
    values (c.org_id, c.id, p_system, case when p_kind in ('Service', 'Repair', 'Other') then p_kind else 'Other' end,
            left(coalesce(trim(p_message), ''), 2000), left(coalesce(trim(p_preferred), ''), 200))
    returning id into q;
  if p_slot_date is not null then
    if p_system is null then raise exception 'Choose the site for the visit'; end if;
    -- Lock the business's diary for the day so two customers can't take the last place at once.
    perform pg_advisory_xact_lock(hashtext(c.org_id::text || p_slot_date::text));
    if not exists (select 1 from public.portal_slots(p_client) s where s.day = p_slot_date and s.part = p_slot_part) then
      raise exception 'Sorry, that time has just gone. Pick another.';
    end if;
    insert into public.jobs (org_id, system_id, type, status, date, time, duration_hrs, notes, customer_response,
                             customer_responded_at)
      values (c.org_id, p_system, case p_kind when 'Service' then 'Annual service' else 'Repair / breakdown' end,
              'booked', p_slot_date, case p_slot_part when 'pm' then '13:00'::time else '09:00'::time end, 1,
              'Booked by the customer in the portal' || coalesce(': ' || nullif(left(trim(p_message), 500), ''), ''),
              'accepted', now())
      returning id into j;
    update public.service_requests set status = 'booked', job_id = j where id = q;
  end if;
  return jsonb_build_object('request', q, 'job', j);
end $$;

-- A customer accepts a booked visit, or asks for another time.
create or replace function public.portal_respond(p_job uuid, p_response text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  select y.client_id into cid from public.jobs j join public.systems y on y.id = j.system_id
    where j.id = p_job and j.status = 'booked' and j.deleted_at is null;
  if cid is null or not public.is_portal_user(cid) then raise exception 'Not found' using errcode = '42501'; end if;
  if p_response not in ('accepted', 'change') then raise exception 'Bad request'; end if;
  update public.jobs set customer_response = p_response, customer_note = left(coalesce(trim(p_note), ''), 1000),
    customer_responded_at = now() where id = p_job;
end $$;

create or replace function public.portal_withdraw(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  select client_id into cid from public.service_requests where id = p_request and status = 'requested';
  if cid is null or not public.is_portal_user(cid) then raise exception 'Not found' using errcode = '42501'; end if;
  update public.service_requests set status = 'withdrawn' where id = p_request;
end $$;

-- Report PDFs: a customer may download their own client's reports, nothing else in the bucket.
create or replace function public.portal_can_read(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.files f
    join public.service_reports r on r.pdf_file_id = f.id
    join public.jobs j on j.id = r.job_id
    join public.systems y on y.id = j.system_id
    join public.portal_users p on p.client_id = y.client_id and p.user_id = auth.uid()
    where f.path = p_path and j.deleted_at is null)
$$;
drop policy if exists "customers read their reports" on storage.objects;
create policy "customers read their reports" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[2] = 'reports' and public.portal_can_read(name));

revoke all on function public.is_portal_user(uuid), public.create_portal_invite(uuid, text),
  public.accept_portal_invite(text), public.my_portals(), public.portal_overview(uuid), public.portal_slots(uuid),
  public.portal_request(uuid, uuid, text, text, text, date, text), public.portal_respond(uuid, text, text),
  public.portal_withdraw(uuid), public.portal_can_read(text), public.portal_invite_info(text) from public, anon;
grant execute on function public.is_portal_user(uuid), public.create_portal_invite(uuid, text),
  public.accept_portal_invite(text), public.my_portals(), public.portal_overview(uuid), public.portal_slots(uuid),
  public.portal_request(uuid, uuid, text, text, text, date, text), public.portal_respond(uuid, text, text),
  public.portal_withdraw(uuid), public.portal_can_read(text) to authenticated;
grant execute on function public.portal_invite_info(text) to anon, authenticated;
revoke all on function public.reset_customer_response() from public, anon, authenticated;

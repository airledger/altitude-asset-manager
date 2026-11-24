-- Subcontractors (part 2 plan): outside engineers a business sends jobs to.
-- A subcontractor joins the business through the same invite as an engineer, but sees only the jobs booked to
-- them and the clients, installs and units those jobs are at: never other clients, the team, prices or
-- invoices. They accept or decline each job, complete it with the same checks and sign-off, keep their
-- insurance and certificates (with expiry dates) on file, and send their charge for the job for an owner to
-- approve.
--
-- How it's enforced: subcontractors are members with role 'sub', so everything an engineer can do still works,
-- and each table an engineer can read gets a RESTRICTIVE policy that, for a subcontractor only, narrows it to
-- their jobs. Owners and engineers are unaffected.

-- ---------- who's a subcontractor ----------
alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check check (role in ('owner', 'member', 'sub'));

alter table public.people
  add column sub boolean not null default false,
  add column company text not null default '';

-- A document belongs to an install (warranty, RAMS) or to a person (a subcontractor's insurance or certificates).
alter table public.documents alter column system_id drop not null;
alter table public.documents
  add column person_id uuid,
  add column expires_on date,
  add constraint documents_person_fk foreign key (person_id, org_id) references public.people (id, org_id) on delete cascade,
  add constraint documents_owner check ((system_id is null) <> (person_id is null));
alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check
  check (kind in ('warranty', 'rams', 'other', 'insurance', 'certificate'));
create index documents_person on public.documents (person_id) where person_id is not null;

create or replace function public.is_sub(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.members where org_id = p_org and user_id = auth.uid() and role = 'sub')
$$;

-- The caller's own row in the business's people.
create or replace function public.my_person(p_org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.people where org_id = p_org and user_id = auth.uid()
$$;

-- What a subcontractor may see: jobs booked to them, and the installs and clients those jobs are at.
create or replace function public.sub_job_ok(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.jobs j join public.people p on p.id = j.engineer_id
                where j.id = p_job and p.user_id = auth.uid())
$$;
create or replace function public.sub_system_ok(p_system uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.jobs j join public.people p on p.id = j.engineer_id
                where j.system_id = p_system and j.deleted_at is null and p.user_id = auth.uid())
$$;
create or replace function public.sub_client_ok(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.jobs j join public.systems s on s.id = j.system_id
                join public.people p on p.id = j.engineer_id
                where s.client_id = p_client and j.deleted_at is null and p.user_id = auth.uid())
$$;
-- A stored file: their own upload, or one belonging to something they can see.
create or replace function public.sub_file_ok(p_file uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.files where id = p_file and created_by = auth.uid())
    or exists(select 1 from public.documents d where d.file_id = p_file and (
         d.person_id = public.my_person(d.org_id)
         or (d.person_id is null and public.sub_system_ok(d.system_id) and (d.job_id is null or public.sub_job_ok(d.job_id)))))
    or exists(select 1 from public.service_reports r where r.pdf_file_id = p_file and public.sub_job_ok(r.job_id))
    or exists(select 1 from public.job_signoffs s where p_file in (s.engineer_signature_file_id, s.customer_signature_file_id)
              and public.sub_job_ok(s.job_id))
    or exists(select 1 from public.site_records r where p_file = any(r.photo_file_ids) and public.sub_system_ok(r.system_id)
              and (r.job_id is null or public.sub_job_ok(r.job_id)))
$$;
revoke all on function public.is_sub(uuid), public.my_person(uuid), public.sub_job_ok(uuid), public.sub_system_ok(uuid),
  public.sub_client_ok(uuid), public.sub_file_ok(uuid) from public, anon;
grant execute on function public.is_sub(uuid), public.my_person(uuid), public.sub_job_ok(uuid), public.sub_system_ok(uuid),
  public.sub_client_ok(uuid), public.sub_file_ok(uuid) to authenticated;

-- ---------- the narrowing rules ----------
-- p_pred is what a subcontractor's rows must satisfy; p_add says whether they may add rows at all.
create or replace function public.sub_rule(p_table text, p_pred text, p_add boolean default true)
returns void language plpgsql set search_path = public as $$
begin
  execute format('create policy "subcontractors" on public.%I as restrictive for all to authenticated '
    'using (not public.is_sub(org_id) or (%s)) with check (not public.is_sub(org_id) or (%s))', p_table, p_pred, p_pred);
  if not p_add then
    execute format('create policy "subcontractors add" on public.%I as restrictive for insert to authenticated '
      'with check (not public.is_sub(org_id))', p_table);
  end if;
end $$;
revoke all on function public.sub_rule(text, text, boolean) from public, anon, authenticated;

-- Their jobs, and what's at them.
select public.sub_rule('jobs', 'engineer_id is not null and engineer_id = public.my_person(org_id)', false);
select public.sub_rule('systems', 'public.sub_system_ok(id)', false);
select public.sub_rule('clients', 'public.sub_client_ok(id)', false);
select public.sub_rule('units', 'public.sub_system_ok(system_id)');
select public.sub_rule('contracts', 'public.sub_client_ok(client_id)');
select public.sub_rule('contract_systems', 'public.sub_system_ok(system_id)');
select public.sub_rule('site_records', 'public.sub_system_ok(system_id) and (job_id is null or public.sub_job_ok(job_id))');
select public.sub_rule('job_unit_checks', 'public.sub_job_ok(job_id)');
select public.sub_rule('job_leak_checks', 'public.sub_job_ok(job_id)');
select public.sub_rule('job_commissioning', 'public.sub_job_ok(job_id)');
select public.sub_rule('job_parts', 'public.sub_job_ok(job_id)');
select public.sub_rule('job_signoffs', 'public.sub_job_ok(job_id)');
select public.sub_rule('job_forms', 'public.sub_job_ok(job_id)');
select public.sub_rule('job_times', 'public.sub_job_ok(job_id)');
select public.sub_rule('service_reports', 'public.sub_job_ok(job_id)');
select public.sub_rule('report_sends', 'exists(select 1 from public.service_reports r where r.id = report_id and public.sub_job_ok(r.job_id))');
select public.sub_rule('review_requests', 'public.sub_job_ok(job_id)');
select public.sub_rule('document_signoffs', 'public.sub_job_ok(job_id)');
select public.sub_rule('sms_log', 'job_id is not null and public.sub_job_ok(job_id)');
select public.sub_rule('files', 'created_by = auth.uid() or public.sub_file_ok(id)');
-- Only themselves, never the rest of the team.
select public.sub_rule('people', 'user_id = auth.uid()', false);
select public.sub_rule('members', 'user_id = auth.uid()', false);
select public.sub_rule('busy_blocks', 'user_id = auth.uid()');
-- Nothing of the business's reminders, customer portal or requests.
select public.sub_rule('contact_logs', 'false');
select public.sub_rule('service_requests', 'false');
select public.sub_rule('portal_users', 'false');

-- The old single-document store: never for subcontractors.
create or replace function public.can_use_doc(p_org uuid, p_col text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_org in (select public.my_org_ids()) and not public.is_sub(p_org)
     and (p_col not in ('pricing','invoices') or public.is_owner(p_org))
$$;

-- Stored files (photos, signatures, reports, documents) in a business they subcontract for. Their own uploads (owner_id) are always theirs.
create or replace function public.sub_path_ok(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists(select 1 from public.members m where m.user_id = auth.uid() and m.role = 'sub'
                    and m.org_id::text = (storage.foldername(p_name))[1])
    or exists(select 1 from public.files f where f.path = p_name and public.sub_file_ok(f.id))
$$;
revoke all on function public.sub_path_ok(text) from public, anon;
grant execute on function public.sub_path_ok(text) to authenticated;
drop policy if exists "subcontractors read" on storage.objects;
drop policy if exists "subcontractors change" on storage.objects;
drop policy if exists "subcontractors delete" on storage.objects;
create policy "subcontractors read" on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'photos' or owner_id = (auth.uid())::text or public.sub_path_ok(name));
create policy "subcontractors change" on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'photos' or owner_id = (auth.uid())::text or public.sub_path_ok(name));
create policy "subcontractors delete" on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'photos' or owner_id = (auth.uid())::text or public.sub_path_ok(name));

-- Functions that read past row-level security check the job too.
create or replace function public.clock(p_job uuid, p_stage text, p_at timestamptz, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.jobs where id = p_job and deleted_at is null;
  if v_org is null or not public.is_member(v_org) or (public.is_sub(v_org) and not public.sub_job_ok(p_job)) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  if p_stage not in ('travel', 'arrived', 'left') then raise exception 'Unknown step %', p_stage; end if;
  if p_at > now() + interval '5 minutes' or p_at < now() - interval '7 days' then
    raise exception 'That time looks wrong. Check the phone''s clock.' using errcode = '23514';
  end if;
  insert into public.job_times (org_id, job_id, user_id, name)
    values (v_org, p_job, auth.uid(), coalesce(p_name, ''))
    on conflict (job_id, user_id) do nothing;
  update public.job_times set
    travel_at = case when p_stage = 'travel' then p_at else travel_at end,
    arrived_at = case when p_stage = 'arrived' then p_at when p_stage = 'travel' then null else arrived_at end,
    left_at = case when p_stage = 'left' then p_at else null end,
    name = case when coalesce(p_name, '') <> '' then p_name else name end,
    updated_at = now()
  where job_id = p_job and user_id = auth.uid();
end $$;

create or replace function public.claim_review_request(p_job uuid, p_email text)
returns table (link text, business text, contact text)
language plpgsql security definer set search_path = public as $$
declare
  j public.jobs;
  c public.clients;
  s public.org_settings;
begin
  select * into j from public.jobs where id = p_job and deleted_at is null;
  if not found or not public.is_member(j.org_id) or j.status <> 'completed' then return; end if;
  if public.is_sub(j.org_id) and not public.sub_job_ok(j.id) then return; end if;
  select * into s from public.org_settings where org_id = j.org_id;
  if not found or not s.review_requests or s.review_link = '' then return; end if;
  select cl.* into c from public.systems sy join public.clients cl on cl.id = sy.client_id where sy.id = j.system_id;
  if not found or not c.reminders_opt_in or coalesce(p_email, '') = '' then return; end if;
  if exists (select 1 from public.review_requests r where r.client_id = c.id
             and r.sent_at > now() - make_interval(months => s.review_gap_months)) then return; end if;
  insert into public.review_requests (org_id, client_id, job_id, email) values (j.org_id, c.id, j.id, lower(p_email));
  return query select s.review_link, o.name, coalesce(nullif(c.contact_name, ''), c.name)
    from public.orgs o where o.id = j.org_id;
end $$;

create or replace function public.diary_status(p_org uuid)
returns table (user_id uuid, synced_at timestamptz, error text)
language sql stable security definer set search_path = public as $$
  select f.user_id, f.synced_at, f.error from public.diary_links f
  where f.org_id = p_org and public.is_member(p_org) and (not public.is_sub(p_org) or f.user_id = auth.uid())
$$;

-- ---------- joining as a subcontractor ----------
create or replace function public.join_business(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_inv public.invites; v_sub boolean;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into v_inv from public.invites
    where code = upper(trim(p_code)) and used_by is null and org_id is not null and expires_at > now() for update;
  if not found then raise exception 'That invite code isn''t valid, has expired or has already been used'; end if;
  if v_inv.email is not null and v_inv.email <> lower(auth.jwt()->>'email') then
    raise exception 'This invite was sent to a different email address';
  end if;
  select coalesce((select sub from public.people where id = v_inv.person_id), false) into v_sub;
  insert into public.members (org_id, user_id, email, role)
    values (v_inv.org_id, auth.uid(), auth.jwt()->>'email', case when v_sub then 'sub' else 'member' end)
    on conflict do nothing;
  update public.invites set used_by = auth.uid(), used_at = now() where code = v_inv.code;
  return v_inv.org_id;
end $$;

-- An owner switching someone between engineer and subcontractor changes what they can see straight away.
-- Owners are never subcontractors.
create or replace function public.people_sub_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and exists(select 1 from public.members where org_id = new.org_id
      and user_id = new.user_id and role = 'owner') then
    new.sub := false;
    return new;
  end if;
  if new.sub is distinct from old.sub and not public.is_owner(new.org_id) then
    new.sub := old.sub;
    return new;
  end if;
  if new.user_id is not null and new.sub is distinct from old.sub then
    update public.members set role = case when new.sub then 'sub' else 'member' end
      where org_id = new.org_id and user_id = new.user_id and role <> 'owner';
  end if;
  return new;
end $$;
create trigger people_sub_role before update of sub on public.people for each row
  when (current_user = 'authenticated') execute function public.people_sub_role();

-- ---------- accept or decline ----------
alter table public.jobs
  add column sub_reply text not null default '' check (sub_reply in ('', 'accepted', 'declined')),
  add column sub_reply_note text not null default '',
  add column sub_reply_at timestamptz;

-- Sent to someone else, the job asks again.
create or replace function public.reset_sub_reply() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.engineer_id is distinct from old.engineer_id then
    new.sub_reply := ''; new.sub_reply_note := ''; new.sub_reply_at := null;
  end if;
  return new;
end $$;
create trigger reset_sub_reply before update of engineer_id on public.jobs for each row
  execute function public.reset_sub_reply();

-- The subcontractor a job is booked to says yes or no (with a reason).
create or replace function public.sub_reply(p_job uuid, p_accept boolean, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job and deleted_at is null for update;
  if not found or not public.is_sub(j.org_id) or j.engineer_id is distinct from public.my_person(j.org_id) then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  if j.status <> 'booked' then raise exception 'This job is already %', j.status; end if;
  if not p_accept and btrim(coalesce(p_note, '')) = '' then raise exception 'Say why you can''t do it'; end if;
  update public.jobs set sub_reply = case when p_accept then 'accepted' else 'declined' end,
    sub_reply_note = left(btrim(coalesce(p_note, '')), 500), sub_reply_at = now()
  where id = p_job;
end $$;
revoke all on function public.sub_reply(uuid, boolean, text) from public, anon;
grant execute on function public.sub_reply(uuid, boolean, text) to authenticated;

-- ---------- their charge for a job ----------
create table public.sub_charges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  job_id uuid not null,
  person_id uuid not null,
  amount numeric(10, 2) not null check (amount >= 0 and amount < 1000000),
  note text not null default '' check (length(note) <= 2000),
  their_ref text not null default '' check (length(their_ref) <= 60),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  reply text not null default '' check (length(reply) <= 500),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade,
  foreign key (person_id, org_id) references public.people (id, org_id) on delete cascade
);
create index sub_charges_org on public.sub_charges (org_id, status, submitted_at desc);
select public.apply_tenant_rules('sub_charges', 'owners');
-- A subcontractor reads their own, sends one for a completed job of theirs, and can change it until it's approved.
create policy "subs read their charges" on public.sub_charges for select to authenticated
  using (public.is_sub(org_id) and person_id = public.my_person(org_id));
create policy "subs send charges" on public.sub_charges for insert to authenticated
  with check (public.is_sub(org_id) and person_id = public.my_person(org_id) and status = 'submitted'
    and exists(select 1 from public.jobs j where j.id = job_id and j.status = 'completed'
               and j.engineer_id = public.my_person(org_id)));
create policy "subs change their charges" on public.sub_charges for update to authenticated
  using (public.is_sub(org_id) and person_id = public.my_person(org_id) and status <> 'approved')
  with check (public.is_sub(org_id) and person_id = public.my_person(org_id) and status = 'submitted'
    and public.sub_job_ok(job_id));

create or replace function public.stamp_sub_charge() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'submitted' then
      new.submitted_at := now(); new.decided_at := null; new.decided_by := null;
    else
      new.decided_at := now(); new.decided_by := auth.uid();
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status = 'approved'
     and (new.amount, new.job_id, new.person_id) is distinct from (old.amount, old.job_id, old.person_id) then
    raise exception 'An approved charge can''t be changed. Turn it down first.';
  end if;
  return new;
end $$;
create trigger stamp_sub_charge before insert or update on public.sub_charges for each row
  execute function public.stamp_sub_charge();

-- ---------- their insurance and certificates ----------
select public.sub_rule('documents',
  'person_id = public.my_person(org_id) or (person_id is null and public.sub_system_ok(system_id) '
  'and (job_id is null or public.sub_job_ok(job_id)))');
-- Engineers don't see subcontractors' papers; owners and the subcontractor do.
create policy "people's documents" on public.documents as restrictive for select to authenticated
  using (person_id is null or public.is_owner(org_id) or person_id = public.my_person(org_id));

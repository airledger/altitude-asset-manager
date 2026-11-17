-- Google review requests (part 2). When a signed-off job's report is emailed to the customer, they also get a
-- short thank-you asking for a Google review, with the business's own review link. Each customer is asked at
-- most once in a set number of months, and never if they've said no to reminders.

alter table public.org_settings
  add column review_link text not null default ''
    check (review_link = '' or review_link ~* '^https://[^\s]+$'),
  add column review_requests boolean not null default true,
  add column review_gap_months int not null default 6 check (review_gap_months between 1 and 36);

create table public.review_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  client_id uuid not null,
  job_id uuid,
  email text not null default '',
  sent_at timestamptz not null default now(),
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete cascade,
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete set null (job_id)
);
create index on public.review_requests (org_id, client_id, sent_at desc);
-- Read by the business; only claim_review_request() adds them.
alter table public.review_requests enable row level security;
create policy "members read review requests" on public.review_requests for select to authenticated
  using (public.is_member(org_id));

-- Called by the send-report function as the person sending the report. If this customer should be asked for a
-- review, records the request and returns what the email needs; otherwise returns nothing.
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
revoke all on function public.claim_review_request(uuid, text) from public, anon;
grant execute on function public.claim_review_request(uuid, text) to authenticated;

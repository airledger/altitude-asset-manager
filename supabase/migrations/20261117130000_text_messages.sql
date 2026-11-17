-- Text messages to customers (part 2): "on my way" from a job and service-due reminders, sent through the
-- send-sms function (Twilio). Each business can set the name its texts come from; every text is logged.

alter table public.org_settings
  add column sms_sender text not null default ''
    check (sms_sender = '' or sms_sender ~ '^[A-Za-z][A-Za-z0-9 ]{2,10}$');

create table public.sms_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  client_id uuid,
  job_id uuid,
  system_id uuid,
  kind text not null check (kind in ('on_the_way', 'service_due', 'other')),
  sent_to text not null,
  body text not null,
  provider_id text not null default '',
  sent_by uuid default auth.uid() references auth.users on delete set null,
  sent_at timestamptz not null default now(),
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete set null (client_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete set null (job_id),
  foreign key (system_id, org_id) references public.systems (id, org_id) on delete set null (system_id)
);
create index on public.sms_log (org_id, sent_at desc);
-- The send-sms function writes each text as the person who sent it; owners can tidy the log.
select public.apply_tenant_rules('sms_log', 'members');

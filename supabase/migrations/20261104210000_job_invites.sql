-- Calendar invites for booked jobs (rebuild stage 8, Lewis 4 Nov 2026: "straight to an engineer's calendar").
-- The job-invite server function emails the engineer an invite when a job is booked, and an update or a
-- cancellation when it changes. This table remembers what was last sent for each job, so the next change
-- updates the same calendar entry and a reassigned job leaves the old engineer's calendar.
-- Only the server function (service key) reads or writes it; app users have no access.
create table if not exists public.job_invites (
  job_id uuid primary key references public.jobs on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  email text not null,
  sequence int not null default 0,
  fingerprint text not null default '',
  cancelled boolean not null default false,
  sent_at timestamptz not null default now()
);
alter table public.job_invites enable row level security;
revoke all on public.job_invites from anon, authenticated;

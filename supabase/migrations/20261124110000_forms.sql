-- Forms and checklists (part 2): owners set up checklists (service, commissioning, breakdown…) for job types;
-- engineers fill them in on the job, and completed ones go on the service report. Each job keeps a copy of the
-- form as it was filled in, so changing a template later doesn't change old jobs.

create table public.form_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  name text not null check (btrim(name) <> '' and length(name) <= 120),
  -- Which job types it's for; empty means every job.
  job_types text[] not null default '{}',
  -- Must be done before the job can be completed.
  required boolean not null default false,
  fields jsonb not null default '[]' check (jsonb_typeof(fields) = 'array' and jsonb_array_length(fields) <= 200),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);
create index on public.form_templates (org_id);
-- Everyone uses them; owners set them up.
select public.apply_tenant_rules('form_templates', 'members-read');

create table public.job_forms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  job_id uuid not null,
  template_id uuid,
  name text not null check (btrim(name) <> ''),
  fields jsonb not null check (jsonb_typeof(fields) = 'array'),
  answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object'),
  completed_at timestamptz,
  completed_by text not null default '',
  updated_by uuid default auth.uid() references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  unique (job_id, template_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade,
  foreign key (template_id, org_id) references public.form_templates (id, org_id) on delete set null (template_id)
);
create index on public.job_forms (org_id, job_id);
select public.apply_tenant_rules('job_forms', 'members');

-- Whoever saves it last is recorded.
create or replace function public.stamp_job_form() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
create trigger stamp before insert or update on public.job_forms for each row execute function public.stamp_job_form();

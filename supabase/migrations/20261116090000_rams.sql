-- Risk assessments and method statements (RAMS), part 2. The office uploads RAMS as documents (kind 'rams')
-- against an install, or against one job; the engineer reads them on site and signs to say so before starting.
-- A sign-off can't be changed afterwards: it's the business's record that the person was briefed.

alter table public.documents
  add column job_id uuid,
  add foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade;
create index on public.documents (org_id, job_id) where job_id is not null;

create table public.document_signoffs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  document_id uuid not null,
  job_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (btrim(name) <> ''),
  signed_at timestamptz not null default now(),
  unique (document_id, job_id, user_id),
  foreign key (document_id, org_id) references public.documents (id, org_id) on delete cascade,
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade
);
create index on public.document_signoffs (org_id, job_id);
select public.apply_tenant_rules('document_signoffs', 'members');
create trigger audit after insert or update or delete on public.document_signoffs
  for each row execute function public.audit();

-- People sign for themselves, at the time they sign, and a sign-off is never edited.
create or replace function public.guard_document_signoff() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'UPDATE' then
    raise exception 'A risk assessment sign-off can''t be changed' using errcode = '42501';
  end if;
  new.user_id := auth.uid();
  new.signed_at := now();
  if not exists (select 1 from public.documents d join public.jobs j on j.id = new.job_id
                 where d.id = new.document_id and d.kind = 'rams'
                   and (d.job_id = j.id or (d.job_id is null and d.system_id = j.system_id))) then
    raise exception 'That risk assessment isn''t for this job' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger guard before insert or update on public.document_signoffs
  for each row execute function public.guard_document_signoff();

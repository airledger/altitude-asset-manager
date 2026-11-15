-- Warranty per unit (part 2). Each unit can have its own warranty end (blank = the install's, from its install
-- date and warranty years), whether it's been registered with the manufacturer and the registration reference.
-- Documents (the original warranty certificate, registration confirmation, manuals) are uploaded against an
-- install, and optionally one of its units. Risk assessments will use the same documents table.

alter table public.units
  add column warranty_end date,
  add column warranty_registered boolean not null default false,
  add column warranty_ref text not null default '';

-- Uploaded documents are files too.
alter table public.files drop constraint if exists files_kind_check;
alter table public.files add constraint files_kind_check
  check (kind in ('photo', 'signature', 'report_pdf', 'document'));

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  system_id uuid not null,
  unit_id uuid,
  kind text not null default 'warranty' check (kind in ('warranty', 'rams', 'other')),
  name text not null check (btrim(name) <> ''),
  file_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users on delete set null,
  unique (id, org_id),
  foreign key (system_id, org_id) references public.systems (id, org_id) on delete cascade,
  foreign key (unit_id, org_id) references public.units (id, org_id) on delete set null (unit_id),
  foreign key (file_id, org_id) references public.files (id, org_id) on delete cascade
);
create index on public.documents (org_id, system_id);
-- Engineers upload on site; everyone in the business reads them; owners delete (as with the files themselves).
select public.apply_tenant_rules('documents', 'members');
create trigger audit after insert or update or delete on public.documents for each row execute function public.audit();

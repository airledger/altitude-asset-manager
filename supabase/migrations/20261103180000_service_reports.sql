-- Service reports (rebuild stage 6, spec F10).
-- The app builds the signed PDF, stores it under <org>/reports/ and records it here. An issued report never
-- changes: editing the job afterwards means issuing the next revision, under the same reference.

-- ---------- report PDFs can't be overwritten or deleted ----------
-- Photos stay editable as before; anything under <org>/reports/ can be added and read, never changed.
drop policy if exists "members manage their photos" on storage.objects;
drop policy if exists "members read their photos" on storage.objects;
drop policy if exists "members add photos" on storage.objects;
drop policy if exists "members change photos" on storage.objects;
drop policy if exists "members delete photos" on storage.objects;
create policy "members read their photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (
    (storage.foldername(name))[1] in (select org_id::text from public.my_org_ids() org_id)
    or (position('/' in name) = 0 and (select legacy_org from public.platform) in (select public.my_org_ids()))));
create policy "members add photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] in (select org_id::text from public.my_org_ids() org_id));
create policy "members change photos" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and coalesce((storage.foldername(name))[2], '') <> 'reports' and (
    (storage.foldername(name))[1] in (select org_id::text from public.my_org_ids() org_id)
    or (position('/' in name) = 0 and (select legacy_org from public.platform) in (select public.my_org_ids()))))
  with check (bucket_id = 'photos' and coalesce((storage.foldername(name))[2], '') <> 'reports'
    and (storage.foldername(name))[1] in (select org_id::text from public.my_org_ids() org_id));
create policy "members delete photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and coalesce((storage.foldername(name))[2], '') <> 'reports' and (
    (storage.foldername(name))[1] in (select org_id::text from public.my_org_ids() org_id)
    or (position('/' in name) = 0 and (select legacy_org from public.platform) in (select public.my_org_ids()))));

-- ---------- issuing ----------
-- A report is for a completed job, its PDF is a report file in the business's reports folder, and revisions
-- go 1, 2, 3… under one reference.
-- Checked for people using the app; imports (the cut-over copy of the live app's reports) are trusted.
create or replace function public.guard_service_report() returns trigger
language plpgsql set search_path = public as $$
declare
  prev public.service_reports;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if not exists (select 1 from public.jobs where id = new.job_id and org_id = new.org_id and status = 'completed') then
    raise exception 'Complete the job before issuing its report' using errcode = '23514';
  end if;
  if not exists (select 1 from public.job_signoffs where job_id = new.job_id) then
    raise exception 'Sign the job off before issuing its report' using errcode = '23514';
  end if;
  if not exists (select 1 from public.files f where f.id = new.pdf_file_id and f.org_id = new.org_id
      and f.kind = 'report_pdf' and f.path like new.org_id::text || '/reports/%') then
    raise exception 'The report PDF must be stored in the business''s reports folder' using errcode = '23514';
  end if;
  select * into prev from public.service_reports where job_id = new.job_id order by rev desc limit 1;
  if prev.id is null then
    if new.rev <> 1 then raise exception 'The first report is revision 1' using errcode = '23514'; end if;
  else
    if new.rev <> prev.rev + 1 then
      raise exception 'This report is out of date; reload and issue it again' using errcode = '23514';
    end if;
    if new.ref <> prev.ref then raise exception 'A revision keeps the report''s reference' using errcode = '23514'; end if;
  end if;
  new.issued_at := now();
  new.issued_by := auth.uid();
  return new;
end $$;
drop trigger if exists guard_service_report on public.service_reports;
create trigger guard_service_report before insert on public.service_reports
  for each row execute function public.guard_service_report();

-- The PDF file row is write-once too.
create or replace function public.guard_report_file() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Deleting the whole business (or account) still clears it out.
  if old.kind = 'report_pdf' and exists (select 1 from public.orgs where id = old.org_id) then raise exception 'An issued report can''t be changed' using errcode = '42501'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists guard_report_file on public.files;
create trigger guard_report_file before update or delete on public.files
  for each row execute function public.guard_report_file();

create index if not exists service_reports_org_issued on public.service_reports (org_id, issued_at desc);
create index if not exists report_sends_report on public.report_sends (report_id, sent_at);

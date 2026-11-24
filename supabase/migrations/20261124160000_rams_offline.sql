-- Risk assessments can be signed with no signal: the phone keeps the sign-off and sends it later with the time
-- the person actually signed. That time is accepted if it's within the last 7 days (and not in the future);
-- recorded_at keeps when it reached Air Ledger.
alter table public.document_signoffs add column recorded_at timestamptz not null default now();

create or replace function public.guard_document_signoff() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'UPDATE' then
    raise exception 'A risk assessment sign-off can''t be changed' using errcode = '42501';
  end if;
  new.user_id := auth.uid();
  new.recorded_at := now();
  if new.signed_at is null or new.signed_at > now() + interval '5 minutes' or new.signed_at < now() - interval '7 days' then
    new.signed_at := now();
  end if;
  if not exists (select 1 from public.documents d join public.jobs j on j.id = new.job_id
                 where d.id = new.document_id and d.kind = 'rams'
                   and (d.job_id = j.id or (d.job_id is null and d.system_id = j.system_id))) then
    raise exception 'That risk assessment isn''t for this job' using errcode = '23514';
  end if;
  return new;
end $$;

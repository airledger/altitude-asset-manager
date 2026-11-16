-- Timesheets (part 2). Each person on a job taps Set off, Arrived and Finished; travel time is set off to
-- arrived, time on site is arrived to finished. Taps made with no signal are sent later with the time they
-- were made. Engineers record their own times through clock(); owners can correct anyone's.

create table public.job_times (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  job_id uuid not null,
  user_id uuid not null references auth.users on delete cascade,
  name text not null default '',
  travel_at timestamptz,
  arrived_at timestamptz,
  left_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (job_id, user_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade,
  check (arrived_at is null or travel_at is null or arrived_at >= travel_at),
  check (left_at is null or arrived_at is null or left_at >= arrived_at)
);
create index on public.job_times (org_id, arrived_at);
-- Everyone in the business reads them; owners add and correct them directly.
select public.apply_tenant_rules('job_times', 'members-read');
create trigger audit after insert or update or delete on public.job_times
  for each row execute function public.audit();

-- The signed-in person's own tap. p_at is when it was tapped (it may arrive later from a phone that had no
-- signal), so it can't be in the future or more than a week ago. Tapping an earlier step again starts over
-- from there.
create or replace function public.clock(p_job uuid, p_stage text, p_at timestamptz, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.jobs where id = p_job and deleted_at is null;
  if v_org is null or not public.is_member(v_org) then
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
revoke all on function public.clock(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.clock(uuid, text, timestamptz, text) to authenticated;

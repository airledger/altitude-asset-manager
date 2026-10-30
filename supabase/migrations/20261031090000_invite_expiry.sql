-- Invites expire after 14 days (specs/04-tenancy-roles-security.md). Owners can already revoke an unused invite
-- by deleting it (the "owners and admins delete invites" policy). Unused invites from before this change get
-- 14 days from now, so nobody's pending invite stops working the moment this runs.
alter table public.invites add column if not exists expires_at timestamptz;
update public.invites set expires_at = now() + interval '14 days' where expires_at is null;
alter table public.invites alter column expires_at set default now() + interval '14 days';
alter table public.invites alter column expires_at set not null;

create or replace function public.invite_info(p_code text) returns table (valid boolean, joins boolean, org_name text)
language sql stable security definer set search_path = public as $$
  select true, i.org_id is not null, o.name
  from public.invites i left join public.orgs o on o.id = i.org_id
  where i.code = upper(trim(p_code)) and i.used_by is null and i.expires_at > now()
$$;

create or replace function public.create_business(p_name text, p_code text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_inv public.invites; v_req boolean;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Please enter your business name'; end if;
  select require_invite into v_req from public.platform;
  if p_code is not null and trim(p_code) <> '' then
    select * into v_inv from public.invites
      where code = upper(trim(p_code)) and used_by is null and org_id is null and expires_at > now() for update;
    if not found then raise exception 'That invite code isn''t valid, has expired or has already been used'; end if;
  elsif v_req and not public.is_platform_admin() then
    raise exception 'You need an invite code to create a business';
  end if;
  insert into public.orgs (name, slug, created_by) values (trim(p_name), public.unique_slug(p_name), auth.uid()) returning id into v_org;
  insert into public.members (org_id, user_id, email, role) values (v_org, auth.uid(), auth.jwt()->>'email', 'owner');
  if v_inv.code is not null then update public.invites set used_by = auth.uid(), used_at = now() where code = v_inv.code; end if;
  return v_org;
end $$;

create or replace function public.join_business(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_inv public.invites;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into v_inv from public.invites
    where code = upper(trim(p_code)) and used_by is null and org_id is not null and expires_at > now() for update;
  if not found then raise exception 'That invite code isn''t valid, has expired or has already been used'; end if;
  if v_inv.email is not null and v_inv.email <> lower(auth.jwt()->>'email') then
    raise exception 'This invite was sent to a different email address';
  end if;
  insert into public.members (org_id, user_id, email, role) values (v_inv.org_id, auth.uid(), auth.jwt()->>'email', 'member')
    on conflict do nothing;
  update public.invites set used_by = auth.uid(), used_at = now() where code = v_inv.code;
  return v_inv.org_id;
end $$;

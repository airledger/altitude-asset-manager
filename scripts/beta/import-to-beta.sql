-- Replaces everything in BETA with the CSVs from export-production.sh, then scrubs customer contact details.
-- Run from the folder holding the CSVs: cd <csv dir> && psql <beta> -v ON_ERROR_STOP=1 -f <path>/import-to-beta.sql
-- Never point this at production: it deletes every user and record first.
\set ON_ERROR_STOP on
begin;

-- Clear beta. Deleting users cascades to identities, sessions and memberships.
delete from public.docs;
delete from public.invites;
delete from public.members;
delete from public.platform_admins;
update public.platform set legacy_org = null;
delete from public.orgs;
delete from auth.users;

\copy auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) from 'users.csv' with (format csv, header);
\copy auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) from 'identities.csv' with (format csv, header);
\copy public.orgs (id, name, slug, logo_url, created_by, created_at) from 'orgs.csv' with (format csv, header);
\copy public.members (org_id, user_id, email, role, created_at) from 'members.csv' with (format csv, header);
\copy public.platform_admins (user_id) from 'platform_admins.csv' with (format csv, header);
create temp table platform_in (require_invite boolean, legacy_org uuid);
\copy platform_in from 'platform.csv' with (format csv, header);
update public.platform p set require_invite = i.require_invite, legacy_org = i.legacy_org from platform_in i;
\copy public.docs (org_id, col, id, data, updated_at) from 'docs.csv' with (format csv, header);

\ir scrub.sql

commit;

select col, count(*) from public.docs group by col order by col;

-- Test accounts for the end-to-end run on BETA (never production). Run by .github/workflows/e2e.yml with
--   psql -v pw=<random per run> -v owner=<email> -v engineer=<email>
-- Each run starts clean: the two test users and any business they belong to are removed, then made again
-- with this run's password, plus one-use codes to set up a business (beta asks for one).
\set ON_ERROR_STOP on
begin;
delete from public.orgs where id in (
  select m.org_id from public.members m join auth.users u on u.id = m.user_id where u.email in (:'owner', :'engineer'));
delete from auth.users where email in (:'owner', :'engineer');
delete from public.invites where org_id is null and code like 'E2E%';

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
  email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token,
  reauthentication_token)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', e,
  extensions.crypt(:'pw', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', ''
from unnest(array[:'owner', :'engineer']) as e;
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u where u.email in (:'owner', :'engineer');

insert into public.invites (code, email) values ('E2EDESKTOP', :'owner'), ('E2EPHONE', :'owner');
commit;

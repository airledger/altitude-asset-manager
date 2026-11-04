-- After the end-to-end run: remove anything the test accounts left behind (a failed run can stop early).
\set ON_ERROR_STOP on
delete from public.orgs where id in (
  select m.org_id from public.members m join auth.users u on u.id = m.user_id where u.email in (:'owner_desktop', :'owner_iphone', :'engineer'));
delete from auth.users where email in (:'owner_desktop', :'owner_iphone', :'engineer');
delete from public.invites where org_id is null and code like 'E2E%';

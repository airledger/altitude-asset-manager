-- Warranty: units carry their own warranty details, and documents are uploaded against an install (and a unit)
-- in the business's own folder, seen only by that business.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'olivia@a.test'),
  ('00000000-0000-0000-0000-00000000000e', 'ed@a.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@b.test');
insert into public.orgs (id, name) values
  ('a0000000-0000-0000-0000-000000000000', 'Business A'),
  ('b0000000-0000-0000-0000-000000000000', 'Business B');
insert into public.members (org_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('a0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000e', 'member'),
  ('b0000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000b', 'owner');
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;
grant execute on all functions in schema pg_temp to authenticated;
insert into public.clients (id, org_id, name) values
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'Harbour Dental'),
  ('c0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000000', 'Other client');
insert into public.systems (id, org_id, client_id, name) values
  ('50000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000a', 'Surgery'),
  ('50000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000b', 'Other');
insert into public.units (id, org_id, sticker_code, system_id, role, manufacturer) values
  ('a1000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'AC-WAAA1', '50000000-0000-0000-0000-00000000000a', 'outdoor', 'Daikin');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
update public.units set warranty_end = '2031-03-01', warranty_registered = true, warranty_ref = 'SBM-123'
  where id = 'a1000000-0000-0000-0000-00000000000a';
select is((select warranty_ref from public.units where sticker_code = 'AC-WAAA1'), 'SBM-123',
  'engineers record the warranty registration on a unit');

insert into public.files (id, org_id, bucket, path, kind, content_type) values
  ('f1000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'photos',
   'a0000000-0000-0000-0000-000000000000/docs/x-warranty.pdf', 'document', 'application/pdf');
insert into public.documents (org_id, system_id, unit_id, name, file_id) values
  ('a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000a',
   'a1000000-0000-0000-0000-00000000000a', 'Warranty certificate.pdf', 'f1000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.documents), 1, 'an engineer uploads a warranty document');
select throws_ok($$ insert into public.documents (org_id, system_id, name, file_id) values
  ('a0000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-00000000000b', 'x', 'f1000000-0000-0000-0000-00000000000a') $$,
  '23503', null, 'a document can''t be put on another business''s install');
select throws_ok($$ insert into public.files (org_id, bucket, path, kind) values
  ('a0000000-0000-0000-0000-000000000000', 'photos', 'b0000000-0000-0000-0000-000000000000/docs/y.pdf', 'document') $$,
  '23514', null, 'documents go in the business''s own folder');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
select is((select count(*)::int from public.documents), 0, 'another business doesn''t see the documents');
reset role;

-- Deleting the unit keeps its documents on the install; deleting the file removes the document.
delete from public.units where id = 'a1000000-0000-0000-0000-00000000000a';
select is((select count(*)::int from public.documents where unit_id is null), 1, 'a deleted unit''s documents stay on the install');
delete from public.files where id = 'f1000000-0000-0000-0000-00000000000a';
select is((select count(*)::int from public.documents), 0, 'deleting the file removes its document');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select lives_ok($$ select public.delete_business('a0000000-0000-0000-0000-000000000000') $$, 'the business can still be deleted');
reset role;

select * from finish();
rollback;

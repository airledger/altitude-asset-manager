-- Stickers ordered from a print company come in hundreds or thousands, so owners can reserve up to 5,000 codes
-- at once (spec 03, F7). Anyone in the team can still reserve up to 210 (ten A4 sheets) to print at home.
create or replace function public.reserve_stickers(p_org uuid, p_count int) returns setof text
language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  made int := 0;
begin
  if not public.is_member(p_org) then raise exception 'Not a member of this business' using errcode = '42501'; end if;
  if p_count is null or p_count < 1 or p_count > 5000 then raise exception 'Choose between 1 and 5,000 stickers'; end if;
  if p_count > 210 and not public.is_owner(p_org) then
    raise exception 'Only an owner can order more than 210 stickers' using errcode = '42501';
  end if;
  while made < p_count loop
    select 'AC-' || string_agg(substr(alphabet, 1 + (get_byte(b, i) % 32), 1), '' order by i)
      into code from (select gen_random_bytes(5) b) r, generate_series(0, 4) i;
    if not exists(select 1 from public.units where sticker_code = code) then
      insert into public.sticker_reservations (code, org_id) values (code, p_org) on conflict do nothing;
      if found then made := made + 1; return next code; end if;
    end if;
  end loop;
end $$;

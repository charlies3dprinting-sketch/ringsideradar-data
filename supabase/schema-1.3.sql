-- Ringside Radar 1.3 — wrestler accounts. Safe to run more than once. Run after schema-1.2.sql.
--  * Saving a wrestler profile goes through save_wrestler_profile(): a direct upsert can't work because the booking
--    contact column is hidden from reads (it's only shown through booking_contact()).
--  * Wrestlers can change their own promotions and division (update_my_wrestler()).
--  * Indie wrestlers' submissions (wins, titles, disputes too) go live right away. Only wrestlers in major promotions
--    wait for review. The ✓ Verified badge is still added by an admin after checking the code in their bio.

-- Major: on the synced major list, or the account lists a major promotion.
create or replace function public.is_major_wrestler(wid text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from major_wrestlers m where m.wrestler_id = wid)
      or exists (select 1 from wrestler_accounts a where a.wrestler_id = wid
                 and a.promotions && array['wwe', 'nxt', 'aew', 'roh', 'tna', 'njpw', 'aaa', 'cmll'])
$$;
grant execute on function public.is_major_wrestler(text) to anon, authenticated;

create or replace function public.save_wrestler_profile(p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare wid text := p->>'wrestler_id';
begin
  if auth.uid() is null or wid is null or not (public.owns_wrestler(wid) or public.is_admin()) then
    raise exception 'not allowed';
  end if;
  insert into wrestler_profiles (wrestler_id, socials, merch_url, shoutout_url, appearance_url, booking_contact, contact_visibility,
                                 hometown, debut_year, trainer, height, weight, bio, photo_url, availability)
  values (wid, coalesce(p->'socials', '{}'::jsonb), p->>'merch_url', p->>'shoutout_url', p->>'appearance_url', p->>'booking_contact',
          coalesce(p->>'contact_visibility', 'promoters'), p->>'hometown', (p->>'debut_year')::int, p->>'trainer', p->>'height', p->>'weight',
          p->>'bio', p->>'photo_url', coalesce(p->'availability', '[]'::jsonb))
  on conflict (wrestler_id) do update set
    socials = excluded.socials, merch_url = excluded.merch_url, shoutout_url = excluded.shoutout_url, appearance_url = excluded.appearance_url,
    booking_contact = excluded.booking_contact, contact_visibility = excluded.contact_visibility, hometown = excluded.hometown,
    debut_year = excluded.debut_year, trainer = excluded.trainer, height = excluded.height, weight = excluded.weight, bio = excluded.bio,
    photo_url = excluded.photo_url, availability = excluded.availability;
end $$;
revoke execute on function public.save_wrestler_profile(jsonb) from anon;
grant execute on function public.save_wrestler_profile(jsonb) to authenticated;

create or replace function public.update_my_wrestler(p_promotions text[], p_gender text) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if coalesce(array_length(p_promotions, 1), 0) > 12 or exists (select 1 from unnest(p_promotions) x where length(x) not between 1 and 60) then
    raise exception 'check your promotions';
  end if;
  update wrestler_accounts
     set promotions = coalesce(p_promotions, '{}'),
         gender = case when p_gender in ('m', 'f') then p_gender else gender end
   where user_id = auth.uid();
end $$;
revoke execute on function public.update_my_wrestler(text[], text) from anon;
grant execute on function public.update_my_wrestler(text[], text) to authenticated;

-- Indie wrestlers' submissions go live right away; majors' rank-raising ones wait for review.
create or replace function public.submission_status() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  new.raises_rank := case new.kind
    when 'title' then true
    when 'match' then coalesce(new.payload->>'result', 'win') in ('win', 'draw')
    when 'dispute' then coalesce(new.payload->>'to', 'win') <> 'loss'
    else false end;
  new.status := case when new.raises_rank and public.is_major_wrestler(new.wrestler_id) then 'pending' else 'live' end;
  return new;
end $$;

-- Anything indie wrestlers already sent that is still waiting goes live now.
update public.wrestler_submissions set status = 'live', reviewed_at = now()
 where status = 'pending' and not public.is_major_wrestler(wrestler_id);

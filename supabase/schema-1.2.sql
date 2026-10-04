-- Ringside Radar 1.2 database additions. Run AFTER schema.sql (Supabase → SQL Editor → New query → paste → Run).
-- Additive and safe to run more than once: 1.1 phones keep working.
--
-- After running it once, make yourself the admin (use your own username):
--   update public.profiles set is_admin = true where username = 'YOUR_USERNAME';

create extension if not exists citext;

-- New profile columns: photo, bio, home area, privacy, saved ranking weights, stamps (for followers), admin flag
alter table public.profiles add column if not exists avatar_url text check (avatar_url is null or length(avatar_url) < 400);
alter table public.profiles add column if not exists bio text check (bio is null or length(bio) <= 200);
alter table public.profiles add column if not exists home_area text check (home_area is null or length(home_area) <= 60);
alter table public.profiles add column if not exists private boolean not null default false;
alter table public.profiles add column if not exists hide_stamps boolean not null default false;
alter table public.profiles add column if not exists weights jsonb check (weights is null or length(weights::text) < 2000);
alter table public.profiles add column if not exists stamps jsonb not null default '[]'::jsonb check (length(stamps::text) < 200000);
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- =====================================================================================
-- Helpers
-- =====================================================================================
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false)
$$;

-- Generic per-user rate limit: enforce_rate(limit, window, user column). Skipped for the SQL editor / service role.
create or replace function public.enforce_rate() returns trigger language plpgsql security definer set search_path = public as $$
declare n int; lim int := tg_argv[0]::int; win interval := tg_argv[1]::interval; col text := coalesce(tg_argv[2], 'user_id');
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  execute format('select count(*) from %I.%I where %I = $1 and created_at > now() - $2', tg_table_schema, tg_table_name, col)
    into n using auth.uid(), win;
  if n >= lim then raise exception 'rate_limited: slow down and try again later' using errcode = 'P0001'; end if;
  return new;
end $$;

-- Admin activity feed: every promoter submission, wrestler signup/submission, claim, correction and report lands here,
-- and the app shows it (with a phone notification) to the admin.
create table if not exists public.activity (
  id bigint generated always as identity primary key,
  kind text not null,
  op text not null,
  ref text,
  actor uuid,
  data jsonb,
  seen boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.activity enable row level security;
drop policy if exists "admin reads activity" on public.activity;
create policy "admin reads activity" on public.activity for select using (public.is_admin());
drop policy if exists "admin updates activity" on public.activity;
create policy "admin updates activity" on public.activity for update using (public.is_admin());
create index if not exists activity_created on public.activity (created_at desc);

create or replace function public.log_activity() returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into activity (kind, op, ref, actor, data)
  values (tg_table_name, lower(tg_op), coalesce(r->>'id', r->>'wrestler_id', r->>'show_id'), auth.uid(), r);
  return coalesce(new, old);
end $$;

-- =====================================================================================
-- Profiles: photo, bio, home area, privacy, saved ranking weights, stamps (for followers), admin flag
-- =====================================================================================

-- Only the SQL editor can make someone an admin.
create or replace function public.guard_profile() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and new.is_admin is distinct from old.is_admin then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.guard_profile();
create or replace function public.guard_profile_insert() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then new.is_admin := false; end if;
  return new;
end $$;
drop trigger if exists profiles_guard_insert on public.profiles;
create trigger profiles_guard_insert before insert on public.profiles for each row execute function public.guard_profile_insert();

-- Stamps and saved weights are not public columns: stamps go through fan_stamps() so privacy settings apply.
revoke select on public.profiles from anon, authenticated;
grant select (id, username, points, shows, avatar_url, bio, home_area, private, hide_stamps, created_at, updated_at) on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;

create or replace function public.my_profile() returns table (id uuid, username text, points int, shows int, avatar_url text, bio text, home_area text,
  private boolean, hide_stamps boolean, weights jsonb, is_admin boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.username::text, p.points, p.shows, p.avatar_url, p.bio, p.home_area, p.private, p.hide_stamps, p.weights, p.is_admin
  from profiles p where p.id = auth.uid()
$$;
revoke all on function public.my_profile() from public;
grant execute on function public.my_profile() to authenticated;

-- =====================================================================================
-- Social: one-way follows, blocks, public groups
-- =====================================================================================
create table if not exists public.follows (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  followee uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, followee),
  check (user_id <> followee)
);
alter table public.follows enable row level security;
drop policy if exists "follows are public" on public.follows;
create policy "follows are public" on public.follows for select using (true);
drop policy if exists "follow as me" on public.follows;
create policy "follow as me" on public.follows for insert with check (auth.uid() = user_id);
drop policy if exists "unfollow as me" on public.follows;
create policy "unfollow as me" on public.follows for delete using (auth.uid() = user_id);
drop trigger if exists follows_rate on public.follows;
create trigger follows_rate before insert on public.follows for each row execute function public.enforce_rate('200', '1 day');

create table if not exists public.blocks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked)
);
alter table public.blocks enable row level security;
drop policy if exists "my blocks" on public.blocks;
create policy "my blocks" on public.blocks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- A blocked fan can't follow you.
create or replace function public.no_follow_if_blocked() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from blocks b where b.user_id = new.followee and b.blocked = new.user_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists follows_block on public.follows;
create trigger follows_block before insert on public.follows for each row execute function public.no_follow_if_blocked();

create table if not exists public.groups (
  id bigint generated always as identity primary key,
  name citext unique not null check (length(name) between 3 and 40),
  description text check (description is null or length(description) <= 200),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.groups enable row level security;
drop policy if exists "groups are public" on public.groups;
create policy "groups are public" on public.groups for select using (true);
drop policy if exists "create group" on public.groups;
create policy "create group" on public.groups for insert with check (auth.uid() = owner and public.username_ok(name));
drop policy if exists "owner edits group" on public.groups;
create policy "owner edits group" on public.groups for update using (auth.uid() = owner or public.is_admin());
drop policy if exists "owner deletes group" on public.groups;
create policy "owner deletes group" on public.groups for delete using (auth.uid() = owner or public.is_admin());
drop trigger if exists groups_rate on public.groups;
create trigger groups_rate before insert on public.groups for each row execute function public.enforce_rate('5', '1 day', 'owner');

create table if not exists public.group_members (
  group_id bigint not null references public.groups (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.group_members enable row level security;
drop policy if exists "members are public" on public.group_members;
create policy "members are public" on public.group_members for select using (true);
drop policy if exists "join group" on public.group_members;
create policy "join group" on public.group_members for insert with check (auth.uid() = user_id);
drop policy if exists "leave group" on public.group_members;
create policy "leave group" on public.group_members for delete
  using (auth.uid() = user_id or auth.uid() = (select g.owner from public.groups g where g.id = group_id) or public.is_admin());
drop trigger if exists group_members_rate on public.group_members;
create trigger group_members_rate before insert on public.group_members for each row execute function public.enforce_rate('30', '1 day');

-- Group owners are members of their own group.
create or replace function public.owner_joins_group() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into group_members (group_id, user_id) values (new.id, new.owner) on conflict do nothing; return new; end $$;
drop trigger if exists groups_owner_joins on public.groups;
create trigger groups_owner_joins after insert on public.groups for each row execute function public.owner_joins_group();

create or replace function public.group_list(q text default '') returns table (id bigint, name text, description text, members int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select g.id, g.name::text, g.description, (select count(*)::int from group_members m where m.group_id = g.id), g.created_at
  from groups g where q = '' or g.name ilike '%' || q || '%'
  order by 4 desc, g.created_at limit 100
$$;
grant execute on function public.group_list(text) to anon, authenticated;

create or replace function public.group_board(gid bigint) returns table (id uuid, username text, points int, shows int, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.username::text, p.points, p.shows, p.avatar_url from group_members m join profiles p on p.id = m.user_id
  where m.group_id = gid order by p.points desc, p.created_at limit 500
$$;
grant execute on function public.group_board(bigint) to anon, authenticated;

-- A fan's public card plus follow counts. Stamps only when they don't hide them; private profiles show bio and stamps only to fans they follow.
create or replace function public.fan_card(uname text) returns table (id uuid, username text, points int, shows int, avatar_url text, bio text,
  home_area text, private boolean, followers int, following int, i_follow boolean, stamps jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.username::text, p.points, p.shows, p.avatar_url, case when p.private and p.id <> coalesce(auth.uid(), p.id) and not exists (select 1 from follows f where f.user_id = p.id and f.followee = auth.uid()) then null else p.bio end,
    p.home_area, p.private,
    (select count(*)::int from follows f where f.followee = p.id), (select count(*)::int from follows f where f.user_id = p.id),
    exists (select 1 from follows f where f.user_id = auth.uid() and f.followee = p.id),
    case when p.id = auth.uid() then p.stamps
         when p.hide_stamps then null
         when p.private and not exists (select 1 from follows f where f.user_id = p.id and f.followee = auth.uid()) then null
         else p.stamps end
  from profiles p where p.username = uname::citext
    and not exists (select 1 from blocks b where b.user_id = p.id and b.blocked = auth.uid())
$$;
grant execute on function public.fan_card(text) to anon, authenticated;

create or replace function public.my_following() returns table (id uuid, username text, points int, shows int, avatar_url text, stamps jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.username::text, p.points, p.shows, p.avatar_url,
    case when p.hide_stamps or (p.private and not exists (select 1 from follows b where b.user_id = p.id and b.followee = auth.uid())) then null else p.stamps end
  from follows f join profiles p on p.id = f.followee where f.user_id = auth.uid() order by p.username
$$;
grant execute on function public.my_following() to authenticated;

create or replace function public.search_fans(q text) returns table (id uuid, username text, points int, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.username::text, p.points, p.avatar_url from profiles p
  where length(q) >= 2 and p.username ilike q || '%' order by p.points desc limit 20
$$;
grant execute on function public.search_fans(text) to anon, authenticated;

-- =====================================================================================
-- Shows: going / interested, match star ratings, reviews, discussion
-- =====================================================================================
create table if not exists public.show_attendance (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  show_id text not null check (length(show_id) between 3 and 80),
  status text not null check (status in ('going', 'interested')),
  created_at timestamptz not null default now(),
  primary key (user_id, show_id)
);
alter table public.show_attendance enable row level security;
drop policy if exists "my attendance" on public.show_attendance;
create policy "my attendance" on public.show_attendance for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.attendance_counts(ids text[]) returns table (show_id text, going int, interested int)
language sql stable security definer set search_path = public as $$
  select a.show_id, count(*) filter (where a.status = 'going')::int, count(*) filter (where a.status = 'interested')::int
  from show_attendance a where a.show_id = any(ids) group by a.show_id
$$;
grant execute on function public.attendance_counts(text[]) to anon, authenticated;

create table if not exists public.match_ratings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  show_id text not null check (length(show_id) between 3 and 80),
  match_key text not null check (length(match_key) between 3 and 400),
  stars numeric(2,1) not null check (stars >= 0.5 and stars <= 5 and stars * 2 = floor(stars * 2)),
  created_at timestamptz not null default now(),
  primary key (user_id, show_id, match_key)
);
alter table public.match_ratings enable row level security;
drop policy if exists "my ratings" on public.match_ratings;
create policy "my ratings" on public.match_ratings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop trigger if exists match_ratings_rate on public.match_ratings;
create trigger match_ratings_rate before insert on public.match_ratings for each row execute function public.enforce_rate('100', '1 day');

create or replace function public.match_rating_avgs(p_show text) returns table (match_key text, stars numeric, votes int, mine numeric)
language sql stable security definer set search_path = public as $$
  select r.match_key, round(avg(r.stars), 2), count(*)::int, max(r.stars) filter (where r.user_id = auth.uid())
  from match_ratings r where r.show_id = p_show group by r.match_key
$$;
grant execute on function public.match_rating_avgs(text) to anon, authenticated;

create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('show', 'promotion')),
  target text not null check (length(target) between 1 and 80),
  stars int not null check (stars between 1 and 5),
  body text check (body is null or length(body) <= 1000),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, kind, target)
);
alter table public.reviews enable row level security;
drop policy if exists "my reviews" on public.reviews;
create policy "my reviews" on public.reviews for all using (auth.uid() = user_id) with check (auth.uid() = user_id and hidden = false);
drop policy if exists "admin moderates reviews" on public.reviews;
create policy "admin moderates reviews" on public.reviews for update using (public.is_admin());
drop trigger if exists reviews_rate on public.reviews;
create trigger reviews_rate before insert on public.reviews for each row execute function public.enforce_rate('20', '1 day');

create or replace function public.reviews_for(p_kind text, p_target text) returns table (id bigint, user_id uuid, username text, avatar_url text, stars int, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.user_id, p.username::text, p.avatar_url, r.stars, r.body, r.created_at
  from reviews r join profiles p on p.id = r.user_id
  where r.kind = p_kind and r.target = p_target and not r.hidden
    and not exists (select 1 from blocks b where b.user_id = auth.uid() and b.blocked = r.user_id)
  order by r.created_at desc limit 200
$$;
grant execute on function public.reviews_for(text, text) to anon, authenticated;

create table if not exists public.comments (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  show_id text not null check (length(show_id) between 3 and 80),
  body text not null check (length(body) between 1 and 500),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.comments enable row level security;
drop policy if exists "post comment" on public.comments;
create policy "post comment" on public.comments for insert with check (auth.uid() = user_id and hidden = false);
drop policy if exists "delete own comment" on public.comments;
create policy "delete own comment" on public.comments for delete using (auth.uid() = user_id or public.is_admin());
drop policy if exists "admin hides comment" on public.comments;
create policy "admin hides comment" on public.comments for update using (public.is_admin());
drop trigger if exists comments_rate on public.comments;
create trigger comments_rate before insert on public.comments for each row execute function public.enforce_rate('30', '1 hour');
create index if not exists comments_show on public.comments (show_id, created_at);

create or replace function public.show_comments(p_show text) returns table (id bigint, user_id uuid, username text, avatar_url text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.user_id, p.username::text, p.avatar_url, c.body, c.created_at
  from comments c join profiles p on p.id = c.user_id
  where c.show_id = p_show and not c.hidden
    and not exists (select 1 from blocks b where b.user_id = auth.uid() and b.blocked = c.user_id)
  order by c.created_at limit 500
$$;
grant execute on function public.show_comments(text) to anon, authenticated;

-- =====================================================================================
-- Fan poll ranking: each fan picks up to 10 wrestlers in order; #1 gets 10 points, #10 gets 1.
-- =====================================================================================
create table if not exists public.poll_ballots (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  picks text[] not null check (cardinality(picks) between 1 and 10),
  updated_at timestamptz not null default now()
);
alter table public.poll_ballots enable row level security;
drop policy if exists "my ballot" on public.poll_ballots;
create policy "my ballot" on public.poll_ballots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.poll_ranking() returns table (wrestler text, points int, voters int)
language sql stable security definer set search_path = public as $$
  select x.w, sum(11 - x.n)::int, count(*)::int
  from poll_ballots b, unnest(b.picks) with ordinality as x(w, n)
  group by x.w order by 2 desc, 3 desc limit 200
$$;
grant execute on function public.poll_ranking() to anon, authenticated;

-- =====================================================================================
-- Moderation: reports, corrections, duplicate merges
-- =====================================================================================
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('comment', 'review', 'user', 'group', 'media', 'show')),
  target text not null check (length(target) between 1 and 120),
  reason text check (reason is null or length(reason) <= 300),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
drop policy if exists "file report" on public.reports;
create policy "file report" on public.reports for insert with check (auth.uid() = user_id and status = 'open');
drop policy if exists "admin reads reports" on public.reports;
create policy "admin reads reports" on public.reports for select using (public.is_admin());
drop policy if exists "admin closes reports" on public.reports;
create policy "admin closes reports" on public.reports for update using (public.is_admin());
drop trigger if exists reports_rate on public.reports;
create trigger reports_rate before insert on public.reports for each row execute function public.enforce_rate('20', '1 day');
drop trigger if exists reports_activity on public.reports;
create trigger reports_activity after insert on public.reports for each row execute function public.log_activity();

create table if not exists public.corrections (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  target_kind text not null check (target_kind in ('wrestler', 'promotion', 'show', 'title', 'other')),
  target_id text not null check (length(target_id) between 1 and 120),
  body text not null check (length(body) between 3 and 1000),
  status text not null default 'open' check (status in ('open', 'done', 'rejected')),
  created_at timestamptz not null default now()
);
alter table public.corrections enable row level security;
drop policy if exists "send correction" on public.corrections;
create policy "send correction" on public.corrections for insert with check (auth.uid() = user_id and status = 'open');
drop policy if exists "read corrections" on public.corrections;
create policy "read corrections" on public.corrections for select using (auth.uid() = user_id or public.is_admin());
drop policy if exists "admin handles corrections" on public.corrections;
create policy "admin handles corrections" on public.corrections for update using (public.is_admin());
drop trigger if exists corrections_rate on public.corrections;
create trigger corrections_rate before insert on public.corrections for each row execute function public.enforce_rate('20', '1 day');
drop trigger if exists corrections_activity on public.corrections;
create trigger corrections_activity after insert on public.corrections for each row execute function public.log_activity();

create table if not exists public.merges (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('wrestler', 'promotion')),
  from_id text not null,
  into_id text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (kind, from_id)
);
alter table public.merges enable row level security;
drop policy if exists "merges are public" on public.merges;
create policy "merges are public" on public.merges for select using (true);
drop policy if exists "admin merges" on public.merges;
create policy "admin merges" on public.merges for all using (public.is_admin()) with check (public.is_admin());

-- =====================================================================================
-- Promoters: claim queue (admin verifies), then trusted: shows, posters, cards and results go live right away
-- =====================================================================================
create table if not exists public.promoter_claims (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  promotion text not null check (length(promotion) between 1 and 60),
  network text not null check (network in ('instagram', 'facebook', 'x')),
  handle text not null check (length(handle) between 2 and 60),
  role text not null check (length(role) between 2 and 60),
  email text not null check (length(email) between 5 and 120),
  code text not null check (length(code) between 4 and 20),
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  unique (user_id, promotion)
);
alter table public.promoter_claims enable row level security;
drop policy if exists "file promoter claim" on public.promoter_claims;
create policy "file promoter claim" on public.promoter_claims for insert with check (auth.uid() = user_id and status = 'pending');
drop policy if exists "read promoter claims" on public.promoter_claims;
create policy "read promoter claims" on public.promoter_claims for select using (auth.uid() = user_id or public.is_admin());
drop policy if exists "admin verifies promoters" on public.promoter_claims;
create policy "admin verifies promoters" on public.promoter_claims for update using (public.is_admin());
drop trigger if exists promoter_claims_rate on public.promoter_claims;
create trigger promoter_claims_rate before insert on public.promoter_claims for each row execute function public.enforce_rate('5', '1 day');
drop trigger if exists promoter_claims_activity on public.promoter_claims;
create trigger promoter_claims_activity after insert on public.promoter_claims for each row execute function public.log_activity();

create or replace function public.is_promoter_of(pid text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from promoter_claims c where c.user_id = auth.uid() and c.promotion = pid and c.status = 'verified')
$$;
create or replace function public.is_promoter() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from promoter_claims c where c.user_id = auth.uid() and c.status = 'verified')
$$;
create or replace function public.verified_promoters() returns table (promotion text) language sql stable security definer set search_path = public as $$
  select distinct c.promotion from promoter_claims c where c.status = 'verified'
$$;
grant execute on function public.verified_promoters() to anon, authenticated;

create table if not exists public.promoter_shows (
  id text primary key default ('ps-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12)),
  promotion text not null check (length(promotion) between 1 and 60),
  name text not null check (length(name) between 2 and 80),
  date date not null,
  time text not null default 'TBA' check (length(time) <= 20),
  doors text check (doors is null or length(doors) <= 20),
  city text not null check (length(city) between 2 and 60),       -- city id from the data bundle
  venue text not null check (length(venue) between 2 and 160),
  lat double precision, lng double precision,
  price numeric(7,2), price_max numeric(7,2),
  ticket_url text check (ticket_url is null or ticket_url ~ '^https?://'),
  poster_url text check (poster_url is null or length(poster_url) < 400),
  card jsonb not null default '[]'::jsonb check (length(card::text) < 20000),   -- [{talent: [...]} | {a: [...], b: [...], title?: text, stip?: text}]
  note text check (note is null or length(note) <= 300),
  replaces text,                                                    -- id of a scraped show this listing updates
  removed boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.promoter_shows enable row level security;
drop policy if exists "promoter shows are public" on public.promoter_shows;
create policy "promoter shows are public" on public.promoter_shows for select using (true);
drop policy if exists "promoter adds show" on public.promoter_shows;
create policy "promoter adds show" on public.promoter_shows for insert with check (public.is_promoter_of(promotion) or public.is_admin());
drop policy if exists "promoter edits show" on public.promoter_shows;
create policy "promoter edits show" on public.promoter_shows for update using (public.is_promoter_of(promotion) or public.is_admin());
drop policy if exists "promoter deletes show" on public.promoter_shows;
create policy "promoter deletes show" on public.promoter_shows for delete using (public.is_promoter_of(promotion) or public.is_admin());
drop trigger if exists promoter_shows_rate on public.promoter_shows;
create trigger promoter_shows_rate before insert on public.promoter_shows for each row execute function public.enforce_rate('40', '1 day', 'created_by');
drop trigger if exists promoter_shows_touch on public.promoter_shows;
create trigger promoter_shows_touch before update on public.promoter_shows for each row execute function public.touch_updated_at();
drop trigger if exists promoter_shows_activity on public.promoter_shows;
create trigger promoter_shows_activity after insert or update on public.promoter_shows for each row execute function public.log_activity();

create table if not exists public.official_results (
  id bigint generated always as identity primary key,
  show_id text not null check (length(show_id) between 3 and 80),
  promotion text not null,
  date date not null,
  winners text[] not null,        -- wrestler ids from the data bundle, or 'x:' + slug for anyone else
  losers text[] not null,
  winner_names text[] not null,
  loser_names text[] not null,
  draw boolean not null default false,
  title text,                     -- title id when a championship was on the line
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (cardinality(winners) between 1 and 10 and cardinality(losers) between 1 and 30)
);
alter table public.official_results enable row level security;
drop policy if exists "official results are public" on public.official_results;
create policy "official results are public" on public.official_results for select using (true);
drop policy if exists "promoter posts results" on public.official_results;
create policy "promoter posts results" on public.official_results for insert with check (public.is_promoter_of(promotion) or public.is_admin());
drop policy if exists "promoter fixes results" on public.official_results;
create policy "promoter fixes results" on public.official_results for update using (public.is_promoter_of(promotion) or public.is_admin());
drop policy if exists "promoter removes results" on public.official_results;
create policy "promoter removes results" on public.official_results for delete using (public.is_promoter_of(promotion) or public.is_admin());
drop trigger if exists official_results_rate on public.official_results;
create trigger official_results_rate before insert on public.official_results for each row execute function public.enforce_rate('60', '1 day', 'created_by');
drop trigger if exists official_results_activity on public.official_results;
create trigger official_results_activity after insert on public.official_results for each row execute function public.log_activity();

-- =====================================================================================
-- Wrestlers: self-signup, profile fields, submissions (rank-raising ones wait for admin review)
-- =====================================================================================
-- Wrestlers in major promotions need the admin's approval to sign up. The admin panel keeps this list in step with the data.
create table if not exists public.major_wrestlers (wrestler_id text primary key);
alter table public.major_wrestlers enable row level security;
drop policy if exists "majors are public" on public.major_wrestlers;
create policy "majors are public" on public.major_wrestlers for select using (true);
drop policy if exists "admin edits majors" on public.major_wrestlers;
create policy "admin edits majors" on public.major_wrestlers for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.wrestler_accounts (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  wrestler_id text not null unique check (length(wrestler_id) between 2 and 80),   -- bundle id, or 'new-<slug>' for self-signups
  ring_name text not null check (length(ring_name) between 2 and 60),
  network text not null check (network in ('instagram', 'x', 'tiktok', 'facebook')),
  handle text not null check (length(handle) between 2 and 60),
  code text not null check (length(code) between 4 and 20),
  promotions text[] not null default '{}',
  gender text not null default 'm' check (gender in ('m', 'f')),
  status text not null default 'live' check (status in ('live', 'pending', 'rejected')),
  verified boolean not null default false,      -- admin checked the code in their bio
  created_at timestamptz not null default now()
);
alter table public.wrestler_accounts enable row level security;
drop policy if exists "wrestler accounts are public" on public.wrestler_accounts;
create policy "wrestler accounts are public" on public.wrestler_accounts for select using (status = 'live' or auth.uid() = user_id or public.is_admin());
drop policy if exists "sign up as wrestler" on public.wrestler_accounts;
create policy "sign up as wrestler" on public.wrestler_accounts for insert with check (auth.uid() = user_id and verified = false);
drop policy if exists "admin reviews wrestlers" on public.wrestler_accounts;
create policy "admin reviews wrestlers" on public.wrestler_accounts for update using (public.is_admin());
drop policy if exists "wrestler leaves" on public.wrestler_accounts;
create policy "wrestler leaves" on public.wrestler_accounts for delete using (auth.uid() = user_id or public.is_admin());
-- Indie wrestlers go live right away; major-promotion wrestlers wait for approval.
create or replace function public.wrestler_signup_status() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.status := case when exists (select 1 from major_wrestlers m where m.wrestler_id = new.wrestler_id) then 'pending' else 'live' end;
    new.verified := false;
  end if;
  return new;
end $$;
drop trigger if exists wrestler_accounts_status on public.wrestler_accounts;
create trigger wrestler_accounts_status before insert on public.wrestler_accounts for each row execute function public.wrestler_signup_status();
drop trigger if exists wrestler_accounts_rate on public.wrestler_accounts;
create trigger wrestler_accounts_rate before insert on public.wrestler_accounts for each row execute function public.enforce_rate('3', '1 day');
drop trigger if exists wrestler_accounts_activity on public.wrestler_accounts;
create trigger wrestler_accounts_activity after insert on public.wrestler_accounts for each row execute function public.log_activity();

create or replace function public.owns_wrestler(wid text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from wrestler_accounts a where a.user_id = auth.uid() and a.wrestler_id = wid and a.status = 'live')
$$;

create table if not exists public.wrestler_profiles (
  wrestler_id text primary key,
  socials jsonb not null default '{}'::jsonb check (length(socials::text) < 2000),   -- {instagram, x, tiktok, youtube, facebook}
  merch_url text check (merch_url is null or merch_url ~ '^https?://'),
  shoutout_url text check (shoutout_url is null or shoutout_url ~ '^https?://'),
  appearance_url text check (appearance_url is null or appearance_url ~ '^https?://'),
  booking_contact text check (booking_contact is null or length(booking_contact) <= 120),
  contact_visibility text not null default 'promoters' check (contact_visibility in ('all', 'promoters', 'none')),
  hometown text check (hometown is null or length(hometown) <= 60),
  debut_year int check (debut_year is null or debut_year between 1950 and 2100),
  trainer text check (trainer is null or length(trainer) <= 80),
  height text check (height is null or length(height) <= 20),
  weight text check (weight is null or length(weight) <= 20),
  bio text check (bio is null or length(bio) <= 600),
  photo_url text check (photo_url is null or length(photo_url) < 400),
  availability jsonb not null default '[]'::jsonb check (length(availability::text) < 8000),  -- [{from, to, note}]
  updated_at timestamptz not null default now()
);
alter table public.wrestler_profiles enable row level security;
drop policy if exists "wrestler profiles are public" on public.wrestler_profiles;
create policy "wrestler profiles are public" on public.wrestler_profiles for select using (true);
drop policy if exists "wrestler edits profile" on public.wrestler_profiles;
create policy "wrestler edits profile" on public.wrestler_profiles for insert with check (public.owns_wrestler(wrestler_id) or public.is_admin());
drop policy if exists "wrestler updates profile" on public.wrestler_profiles;
create policy "wrestler updates profile" on public.wrestler_profiles for update using (public.owns_wrestler(wrestler_id) or public.is_admin());
-- Booking contact is only readable through booking_contact(), which applies the wrestler's visibility choice.
revoke select on public.wrestler_profiles from anon, authenticated;
grant select (wrestler_id, socials, merch_url, shoutout_url, appearance_url, contact_visibility, hometown, debut_year, trainer, height, weight, bio, photo_url, availability, updated_at)
  on public.wrestler_profiles to anon, authenticated;
grant insert, update on public.wrestler_profiles to authenticated;
drop trigger if exists wrestler_profiles_touch on public.wrestler_profiles;
create trigger wrestler_profiles_touch before update on public.wrestler_profiles for each row execute function public.touch_updated_at();

create or replace function public.booking_contact(wid text) returns text language sql stable security definer set search_path = public as $$
  select case when p.contact_visibility = 'all' or public.owns_wrestler(wid) or public.is_admin()
                or (p.contact_visibility = 'promoters' and public.is_promoter()) then p.booking_contact end
  from wrestler_profiles p where p.wrestler_id = wid
$$;
grant execute on function public.booking_contact(text) to anon, authenticated;

create table if not exists public.wrestler_submissions (
  id bigint generated always as identity primary key,
  wrestler_id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('title', 'match', 'booking', 'ringname', 'dispute')),
  payload jsonb not null check (length(payload::text) < 4000),
  raises_rank boolean not null default true,
  status text not null default 'pending' check (status in ('live', 'pending', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
alter table public.wrestler_submissions enable row level security;
drop policy if exists "live submissions are public" on public.wrestler_submissions;
create policy "live submissions are public" on public.wrestler_submissions for select using (status = 'live' or auth.uid() = user_id or public.is_admin());
drop policy if exists "wrestler submits" on public.wrestler_submissions;
create policy "wrestler submits" on public.wrestler_submissions for insert with check (auth.uid() = user_id and public.owns_wrestler(wrestler_id));
drop policy if exists "admin reviews submissions" on public.wrestler_submissions;
create policy "admin reviews submissions" on public.wrestler_submissions for update using (public.is_admin());
drop policy if exists "wrestler withdraws" on public.wrestler_submissions;
create policy "wrestler withdraws" on public.wrestler_submissions for delete using (auth.uid() = user_id and status = 'pending');
-- The server decides what could raise a ranking: titles, wins, draws, and disputes that change a result in the wrestler's favor.
create or replace function public.submission_status() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  new.raises_rank := case new.kind
    when 'title' then true
    when 'match' then coalesce(new.payload->>'result', 'win') in ('win', 'draw')
    when 'dispute' then coalesce(new.payload->>'to', 'win') <> 'loss'
    else false end;
  new.status := case when new.raises_rank then 'pending' else 'live' end;
  return new;
end $$;
drop trigger if exists wrestler_submissions_status on public.wrestler_submissions;
create trigger wrestler_submissions_status before insert on public.wrestler_submissions for each row execute function public.submission_status();
drop trigger if exists wrestler_submissions_rate on public.wrestler_submissions;
create trigger wrestler_submissions_rate before insert on public.wrestler_submissions for each row execute function public.enforce_rate('50', '1 day');
drop trigger if exists wrestler_submissions_activity on public.wrestler_submissions;
create trigger wrestler_submissions_activity after insert on public.wrestler_submissions for each row execute function public.log_activity();

-- Followers and page views for the wrestler dashboard.
alter table public.wrestler_accounts add column if not exists gender text not null default 'm' check (gender in ('m', 'f'));

create table if not exists public.wrestler_follows (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  wrestler_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, wrestler_id)
);
alter table public.wrestler_follows enable row level security;
drop policy if exists "my wrestler follows" on public.wrestler_follows;
create policy "my wrestler follows" on public.wrestler_follows for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.page_views (
  wrestler_id text not null,
  day date not null default current_date,
  views int not null default 0,
  primary key (wrestler_id, day)
);
alter table public.page_views enable row level security;
create or replace function public.bump_view(wid text) returns void language sql security definer set search_path = public as $$
  insert into page_views (wrestler_id, day, views) values (left(wid, 80), current_date, 1)
  on conflict (wrestler_id, day) do update set views = page_views.views + 1
$$;
grant execute on function public.bump_view(text) to anon, authenticated;

create or replace function public.wrestler_stats(wid text) returns table (followers int, views_30d int, views_7d int)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from wrestler_follows f where f.wrestler_id = wid),
         coalesce((select sum(v.views)::int from page_views v where v.wrestler_id = wid and v.day > current_date - 30), 0),
         coalesce((select sum(v.views)::int from page_views v where v.wrestler_id = wid and v.day > current_date - 7), 0)
$$;
grant execute on function public.wrestler_stats(text) to anon, authenticated;

-- Everything the app merges into its data on launch, in one call.
create or replace function public.live_data() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'shows', coalesce((select jsonb_agg(to_jsonb(s) - 'created_by') from promoter_shows s where not s.removed and s.date >= current_date - 400), '[]'::jsonb),
    'results', coalesce((select jsonb_agg(to_jsonb(r) - 'created_by') from official_results r where r.date >= current_date - 400), '[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'wrestler_id', w.wrestler_id, 'kind', w.kind, 'payload', w.payload, 'created_at', w.created_at))
                             from wrestler_submissions w where w.status = 'live'), '[]'::jsonb),
    'wrestlers', coalesce((select jsonb_agg(jsonb_build_object('wrestler_id', a.wrestler_id, 'ring_name', a.ring_name, 'promotions', a.promotions, 'verified', a.verified, 'gender', a.gender))
                           from wrestler_accounts a where a.status = 'live'), '[]'::jsonb),
    'merges', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'from', m.from_id, 'into', m.into_id)) from merges m), '[]'::jsonb),
    'promoters', coalesce((select jsonb_agg(distinct c.promotion) from promoter_claims c where c.status = 'verified'), '[]'::jsonb)
  )
$$;
grant execute on function public.live_data() to anon, authenticated;

-- Admin queue counts.
create or replace function public.admin_queue() returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then null else jsonb_build_object(
    'wrestlers', (select count(*) from wrestler_accounts where status = 'pending'),
    'submissions', (select count(*) from wrestler_submissions where status = 'pending'),
    'promoters', (select count(*) from promoter_claims where status = 'pending'),
    'corrections', (select count(*) from corrections where status = 'open'),
    'reports', (select count(*) from reports where status = 'open'),
    'activity', (select count(*) from activity where not seen)) end
$$;
grant execute on function public.admin_queue() to authenticated;

-- Keep-alive ping target for the scheduled GitHub Action (any cheap read works).
create or replace function public.ping() returns text language sql stable as $$ select 'ok'::text $$;
grant execute on function public.ping() to anon, authenticated;

-- result_submissions (1.1): rate limit too.
drop trigger if exists result_submissions_rate on public.result_submissions;
create trigger result_submissions_rate before insert on public.result_submissions for each row execute function public.enforce_rate('60', '1 day');

-- =====================================================================================
-- Image uploads: one public bucket, files under <user id>/..., images only, 1 MB max (the app resizes first)
-- =====================================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "media upload own folder" on storage.objects;
create policy "media upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "media replace own" on storage.objects;
create policy "media replace own" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "media delete own" on storage.objects;
create policy "media delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

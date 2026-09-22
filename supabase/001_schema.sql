-- Euchre League database schema.
-- Already applied. New changes go in numbered files after this one, run in order.
--
-- The database stores only raw facts (who played, scores, idiot points...).
-- Every stat (win %, synergy, SoS, streaks...) is calculated by the website,
-- so fixing a formula never requires touching stored data.


-- ============================================================
-- Tables
-- ============================================================

-- League-wide settings. Exactly one row (id is always true).
create table public.settings (
  id boolean primary key default true check (id),
  max_guests_per_game smallint not null default 1 check (max_guests_per_game between 0 and 3)
);
insert into public.settings default values;

create table public.players (
  id bigint generated always as identity primary key,
  name text not null check (name = btrim(name) and name <> '' and lower(name) <> 'guest'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
-- "Gilad" and "GIlad" count as the same name.
create unique index players_name_key on public.players (lower(name));

-- A game belongs to the latest season whose start date is on or before the
-- game's date, so seasons never need to be picked by hand.
create table public.seasons (
  id bigint generated always as identity primary key,
  name text not null unique check (btrim(name) <> ''),
  starts_on date not null unique
);

create table public.tournaments (
  id bigint generated always as identity primary key,
  held_on date not null unique,
  name text,
  format smallint not null default 4 check (format in (4, 6)),
  -- Generated round-robin schedule, written by Tournament Mode.
  schedule jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.games (
  id bigint generated always as identity primary key,
  played_on date not null,
  format smallint not null check (format in (4, 6)),  -- 4-handed or 6-handed
  seq smallint not null default 1,                    -- order within the day (streaks depend on it)
  team_a_points smallint not null check (team_a_points between 0 and 13),
  team_b_points smallint not null check (team_b_points between 0 and 13),
  -- Sets (euchres) are only recorded in tournament games.
  team_a_sets smallint check (team_a_sets >= 0),
  team_b_sets smallint check (team_b_sets >= 0),
  tournament_id bigint references public.tournaments (id) on delete restrict,
  tournament_phase text check (tournament_phase in ('prelim', 'final')),
  tournament_round smallint check (tournament_round > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One team reached 10+, the other stayed at 9 or below (so no ties).
  constraint games_valid_score check (
    greatest(team_a_points, team_b_points) >= 10
    and least(team_a_points, team_b_points) <= 9
  ),
  constraint games_tournament_fields check (
    (tournament_id is null and tournament_phase is null and tournament_round is null
      and team_a_sets is null and team_b_sets is null)
    or (tournament_id is not null and tournament_phase is not null and tournament_round is not null)
  )
);
create index games_played_on_idx on public.games (played_on, format, seq);

-- One row per seat in a game. A seat holds either a player or a guest.
create table public.game_players (
  game_id bigint not null references public.games (id) on delete cascade,
  team char(1) not null check (team in ('A', 'B')),
  seat smallint not null check (seat between 1 and 3),
  player_id bigint references public.players (id) on delete restrict,
  guest_name text check (guest_name = btrim(guest_name) and guest_name <> ''),  -- optional label for a guest
  idiot_points smallint not null default 0 check (idiot_points between 0 and 20),
  alone_wins smallint not null default 0 check (alone_wins between 0 and 20),     -- tournaments only
  primary key (game_id, team, seat),
  constraint game_players_player_or_guest check (player_id is null or guest_name is null),
  constraint game_players_no_duplicate unique (game_id, player_id)
);
create index game_players_player_idx on public.game_players (player_id);

-- Every insert/update/delete on the tables above, so mistakes can be traced
-- and undone by hand.
create table public.change_log (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  table_name text not null,
  action text not null,
  old_data jsonb,
  new_data jsonb
);


-- ============================================================
-- Integrity rules that span several rows
-- ============================================================

-- A game must have a full table (2 or 3 per team) and no more guests than
-- the league setting allows. Checked when the transaction commits, so a game
-- and its seats can be written in any order.
create function public.validate_game(gid bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  fmt smallint;
  per_team int;
  n_a int;
  n_b int;
  n_guests int;
  bad_seat boolean;
  max_guests int;
begin
  select format into fmt from games where id = gid;
  if not found then
    return;  -- game was deleted
  end if;
  per_team := fmt / 2;

  select count(*) filter (where team = 'A'),
         count(*) filter (where team = 'B'),
         count(*) filter (where player_id is null),
         coalesce(bool_or(seat > per_team), false)
    into n_a, n_b, n_guests, bad_seat
    from game_players where game_id = gid;

  if n_a <> per_team or n_b <> per_team or bad_seat then
    raise exception 'A %-handed game needs exactly % players per team (game %)', fmt, per_team, gid;
  end if;

  select max_guests_per_game into max_guests from settings;
  if n_guests > max_guests then
    raise exception 'Game % has % guests; the league allows %', gid, n_guests, max_guests;
  end if;
end $$;

create function public.game_players_validate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform validate_game(old.game_id); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform validate_game(new.game_id); end if;
  return null;
end $$;

create constraint trigger game_players_validate
  after insert or update or delete on public.game_players
  deferrable initially deferred
  for each row execute function public.game_players_validate();

create function public.games_validate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform validate_game(new.id);
  return null;
end $$;

create constraint trigger games_validate
  after insert or update on public.games
  deferrable initially deferred
  for each row execute function public.games_validate();

create function public.games_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger games_touch_updated_at
  before update on public.games
  for each row execute function public.games_touch_updated_at();

-- When a new player is added, earlier games where they played as a guest
-- under the same name become theirs.
create function public.claim_guest_games() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update game_players
     set player_id = new.id, guest_name = null
   where player_id is null and lower(guest_name) = lower(new.name);
  return null;
end $$;

create trigger players_claim_guest_games
  after insert on public.players
  for each row execute function public.claim_guest_games();


-- ============================================================
-- Change log
-- ============================================================

create function public.log_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into change_log (table_name, action, old_data, new_data)
  values (
    tg_table_name,
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return null;
end $$;

create trigger log_change after insert or update or delete on public.settings
  for each row execute function public.log_change();
create trigger log_change after insert or update or delete on public.players
  for each row execute function public.log_change();
create trigger log_change after insert or update or delete on public.seasons
  for each row execute function public.log_change();
create trigger log_change after insert or update or delete on public.tournaments
  for each row execute function public.log_change();
create trigger log_change after insert or update or delete on public.games
  for each row execute function public.log_change();
create trigger log_change after insert or update or delete on public.game_players
  for each row execute function public.log_change();


-- ============================================================
-- Saving a day of league games
-- ============================================================

-- Game Input sends every league game for one date and format at once.
-- Games with an id are updated, games without one are added, and league
-- games from that day that are missing from the list are deleted.
-- It all succeeds or fails together. Tournament games are never touched.
--
-- p_games: [{ "id": 12 or null, "team_a_points": 10, "team_b_points": 7,
--             "players": [{ "team": "A", "seat": 1, "player_id": 3,
--                           "guest_name": null, "idiot_points": 0 }, ...] }, ...]
create function public.save_day(p_played_on date, p_format int, p_games jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  g jsonb;
  gid bigint;
  keep bigint[] := '{}';
  i int := 0;
begin
  for g in select value from jsonb_array_elements(p_games) loop
    i := i + 1;
    gid := nullif(g ->> 'id', '')::bigint;

    if gid is null then
      insert into games (played_on, format, seq, team_a_points, team_b_points)
      values (p_played_on, p_format, i, (g ->> 'team_a_points')::smallint, (g ->> 'team_b_points')::smallint)
      returning id into gid;
    else
      update games
         set seq = i,
             team_a_points = (g ->> 'team_a_points')::smallint,
             team_b_points = (g ->> 'team_b_points')::smallint
       where id = gid and played_on = p_played_on and format = p_format and tournament_id is null;
      if not found then
        raise exception 'Game % is not a %-handed league game on %', gid, p_format, p_played_on;
      end if;
      delete from game_players where game_id = gid;
    end if;

    insert into game_players (game_id, team, seat, player_id, guest_name, idiot_points)
    select gid, p.team, p.seat, p.player_id, nullif(btrim(p.guest_name), ''), coalesce(p.idiot_points, 0)
      from jsonb_to_recordset(g -> 'players')
           as p(team char(1), seat smallint, player_id bigint, guest_name text, idiot_points smallint);

    keep := keep || gid;
  end loop;

  delete from games
   where played_on = p_played_on and format = p_format
     and tournament_id is null and id <> all (keep);
end $$;


-- ============================================================
-- Access from the website
-- ============================================================
-- For now anyone can read everything and anyone can edit, per the
-- requirements. Games can only be written through save_day() so a day's
-- games are always saved as a complete, validated set.

alter table public.settings     enable row level security;
alter table public.players      enable row level security;
alter table public.seasons      enable row level security;
alter table public.tournaments  enable row level security;
alter table public.games        enable row level security;
alter table public.game_players enable row level security;
alter table public.change_log   enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.settings, public.players, public.seasons, public.tournaments,
  public.games, public.game_players, public.change_log to anon, authenticated;
grant insert, update, delete on public.players, public.seasons, public.tournaments to anon, authenticated;
grant update on public.settings to anon, authenticated;

create policy "Anyone can read" on public.settings     for select to anon, authenticated using (true);
create policy "Anyone can read" on public.players      for select to anon, authenticated using (true);
create policy "Anyone can read" on public.seasons      for select to anon, authenticated using (true);
create policy "Anyone can read" on public.tournaments  for select to anon, authenticated using (true);
create policy "Anyone can read" on public.games        for select to anon, authenticated using (true);
create policy "Anyone can read" on public.game_players for select to anon, authenticated using (true);
create policy "Anyone can read" on public.change_log   for select to anon, authenticated using (true);

create policy "Anyone can edit" on public.settings for update to anon, authenticated using (true) with check (true);

create policy "Anyone can add"    on public.players for insert to anon, authenticated with check (true);
create policy "Anyone can edit"   on public.players for update to anon, authenticated using (true) with check (true);
create policy "Anyone can delete" on public.players for delete to anon, authenticated using (true);

create policy "Anyone can add"    on public.seasons for insert to anon, authenticated with check (true);
create policy "Anyone can edit"   on public.seasons for update to anon, authenticated using (true) with check (true);
create policy "Anyone can delete" on public.seasons for delete to anon, authenticated using (true);

create policy "Anyone can add"    on public.tournaments for insert to anon, authenticated with check (true);
create policy "Anyone can edit"   on public.tournaments for update to anon, authenticated using (true) with check (true);
create policy "Anyone can delete" on public.tournaments for delete to anon, authenticated using (true);

-- Only save_day() is callable from the website; the helpers are internal.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.save_day(date, int, jsonb) to anon, authenticated;

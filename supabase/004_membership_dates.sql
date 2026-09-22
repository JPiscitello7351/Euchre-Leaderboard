-- Membership dates: each player has a joined date and an optional left date,
-- replacing the single "active" flag. A player is ranked in a season if they
-- are still a member when the season ends (the website applies that rule).
-- Run once in Supabase: SQL Editor -> New query -> paste this file -> Run.


alter table public.players
  add column joined_on date,
  add column left_on date;

-- Joined: first game played (or the day they were added, if none yet).
-- Left: for players currently marked inactive, their last game.
update public.players p
   set joined_on = coalesce(
         (select min(g.played_on) from public.games g join public.game_players gp on gp.game_id = g.id where gp.player_id = p.id),
         p.created_at::date),
       left_on = case when p.active then null else
         (select max(g.played_on) from public.games g join public.game_players gp on gp.game_id = g.id where gp.player_id = p.id) end;

alter table public.players
  alter column joined_on set not null,
  alter column joined_on set default current_date,
  add constraint players_left_after_joined check (left_on is null or left_on >= joined_on);


-- Backups are now version 2 (players carry joined_on/left_on instead of
-- active). Restore still accepts version 1 files and converts them the same
-- way as above.
create or replace function public.export_backup() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'kind', 'euchre-league-backup',
    'version', 2,
    'exported_at', now(),
    'settings', (select to_jsonb(s) - 'id' from settings s),
    'players', coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from players p), '[]'),
    'seasons', coalesce((select jsonb_agg(to_jsonb(s) order by s.starts_on) from seasons s), '[]'),
    'tournaments', coalesce((select jsonb_agg(to_jsonb(t) order by t.held_on) from tournaments t), '[]'),
    'games', coalesce((
      select jsonb_agg(
               to_jsonb(g) || jsonb_build_object('players', (
                 select coalesce(jsonb_agg(to_jsonb(gp) - 'game_id' order by gp.team, gp.seat), '[]')
                   from game_players gp where gp.game_id = g.id))
               order by g.played_on, g.format, g.seq, g.id)
        from games g), '[]')
  );
$$;

create or replace function public.restore_backup(p_backup jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  previous jsonb := export_backup();
begin
  if p_backup ->> 'kind' is distinct from 'euchre-league-backup' or (p_backup ->> 'version')::int not in (1, 2) then
    raise exception 'Not a Euchre League backup file (version 1 or 2)';
  end if;

  insert into change_log (table_name, action, old_data, new_data)
  values ('*', 'RESTORE', previous,
          jsonb_build_object('exported_at', p_backup -> 'exported_at',
                             'games', jsonb_array_length(p_backup -> 'games')));

  perform set_config('euchre.restoring', 'on', true);

  delete from games where true;        -- also removes game_players (cascade)
  delete from tournaments where true;
  delete from seasons where true;
  delete from players where true;

  update settings
     set max_guests_per_game = coalesce((p_backup -> 'settings' ->> 'max_guests_per_game')::smallint, 1)
   where id;

  -- joined_on is filled in after the games are loaded when a backup lacks it.
  insert into players (id, name, joined_on, left_on, created_at) overriding system value
  select p.id, p.name, coalesce(p.joined_on, '1900-01-01'), p.left_on, coalesce(p.created_at, now())
    from jsonb_populate_recordset(null::players, p_backup -> 'players') p;

  insert into seasons (id, name, starts_on) overriding system value
  select id, name, starts_on
    from jsonb_populate_recordset(null::seasons, p_backup -> 'seasons');

  insert into tournaments (id, held_on, name, format, schedule, created_at) overriding system value
  select id, held_on, name, coalesce(format, 4), coalesce(schedule, '{}'), coalesce(created_at, now())
    from jsonb_populate_recordset(null::tournaments, p_backup -> 'tournaments');

  insert into games (id, played_on, format, seq, team_a_points, team_b_points, team_a_sets, team_b_sets,
                     tournament_id, tournament_phase, tournament_round, created_at, updated_at)
    overriding system value
  select id, played_on, format, coalesce(seq, 1), team_a_points, team_b_points, team_a_sets, team_b_sets,
         tournament_id, tournament_phase, tournament_round, coalesce(created_at, now()), coalesce(updated_at, now())
    from jsonb_populate_recordset(null::games, p_backup -> 'games');

  insert into game_players (game_id, team, seat, player_id, guest_name, idiot_points, alone_wins)
  select (g ->> 'id')::bigint, p.team, p.seat, p.player_id, p.guest_name,
         coalesce(p.idiot_points, 0), coalesce(p.alone_wins, 0)
    from jsonb_array_elements(p_backup -> 'games') g,
         jsonb_populate_recordset(null::game_players, g -> 'players') p;

  -- Version 1 backups: dates from game history, as in the upgrade above.
  update players p
     set joined_on = coalesce(
           (select min(g.played_on) from games g join game_players gp on gp.game_id = g.id where gp.player_id = p.id),
           p.created_at::date)
   where p.joined_on = '1900-01-01';
  update players p
     set left_on = (select max(g.played_on) from games g join game_players gp on gp.game_id = g.id where gp.player_id = p.id)
    from jsonb_array_elements(p_backup -> 'players') bp
   where (bp ->> 'id')::bigint = p.id and p.left_on is null and (bp ->> 'active')::boolean is false;

  -- New rows added after a restore continue numbering after the restored ids.
  perform setval(pg_get_serial_sequence('public.players', 'id'), coalesce(max(id), 0) + 1, false) from players;
  perform setval(pg_get_serial_sequence('public.seasons', 'id'), coalesce(max(id), 0) + 1, false) from seasons;
  perform setval(pg_get_serial_sequence('public.tournaments', 'id'), coalesce(max(id), 0) + 1, false) from tournaments;
  perform setval(pg_get_serial_sequence('public.games', 'id'), coalesce(max(id), 0) + 1, false) from games;

  return jsonb_build_object(
    'players', (select count(*) from players),
    'seasons', (select count(*) from seasons),
    'tournaments', (select count(*) from tournaments),
    'games', (select count(*) from games)
  );
end $$;


-- The old flag is replaced by the dates.
alter table public.players drop column active;

-- Backup download and restore.
-- Run once in Supabase: SQL Editor -> New query -> paste this file -> Run.


-- The whole league as one JSON document. This is the "Download backup" file.
create function public.export_backup() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'kind', 'euchre-league-backup',
    'version', 1,
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


-- Restoring writes thousands of rows; log it as one entry instead of one per row.
create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('euchre.restoring', true) = 'on' then
    return null;
  end if;
  insert into change_log (table_name, action, old_data, new_data)
  values (
    tg_table_name,
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return null;
end $$;


-- Replace ALL league data with the contents of a backup, keeping its ids.
-- Everything it replaces is saved first as one change_log entry
-- (action 'RESTORE', old_data = the previous full backup), so a restore can
-- itself be undone. All rules from 001 still apply: a backup with an invalid
-- game is rejected and nothing changes.
create function public.restore_backup(p_backup jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  previous jsonb := export_backup();
begin
  if p_backup ->> 'kind' is distinct from 'euchre-league-backup' or (p_backup ->> 'version')::int <> 1 then
    raise exception 'Not a Euchre League backup file (version 1)';
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

  insert into players (id, name, active, created_at) overriding system value
  select id, name, coalesce(active, true), coalesce(created_at, now())
    from jsonb_populate_recordset(null::players, p_backup -> 'players');

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


revoke execute on function public.export_backup() from public, anon, authenticated;
revoke execute on function public.restore_backup(jsonb) from public, anon, authenticated;
grant execute on function public.export_backup() to anon, authenticated;
grant execute on function public.restore_backup(jsonb) to anon, authenticated;

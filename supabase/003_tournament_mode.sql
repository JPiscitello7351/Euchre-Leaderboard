-- Tournament Mode: create a tournament, save each table's result, and
-- delete a tournament created by mistake.
-- Run once in Supabase: SQL Editor -> New query -> paste this file -> Run.


-- Each scheduled table is one game slot: (tournament, phase, round, seq).
create unique index games_tournament_slot
  on public.games (tournament_id, tournament_phase, tournament_round, seq)
  where tournament_id is not null;


-- Creates the tournament and, if no later season exists yet, opens the next
-- season the day after (a season starts when the previous tournament ends).
create function public.create_tournament(p_held_on date, p_schedule jsonb, p_next_season text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  tid bigint;
begin
  insert into tournaments (held_on, format, schedule)
  values (p_held_on, 4, p_schedule)
  returning id into tid;

  if p_next_season is not null and not exists (select 1 from seasons where starts_on > p_held_on) then
    insert into seasons (name, starts_on) values (p_next_season, p_held_on + 1);
  end if;
  return tid;
end $$;


-- Adds or replaces the result for one table.
-- p_game: { "phase": "prelim"|"final", "round": 1, "seq": 3,
--           "team_a_points": 10, "team_b_points": 7, "team_a_sets": 1, "team_b_sets": 0,
--           "players": [{ "team": "A", "seat": 1, "player_id": 4, "idiot_points": 0, "alone_wins": 1 }, ...] }
create function public.save_tournament_game(p_tournament_id bigint, p_game jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  t tournaments;
  gid bigint;
begin
  select * into t from tournaments where id = p_tournament_id;
  if not found then
    raise exception 'Tournament % not found', p_tournament_id;
  end if;

  select id into gid from games
   where tournament_id = t.id
     and tournament_phase = p_game ->> 'phase'
     and tournament_round = (p_game ->> 'round')::smallint
     and seq = (p_game ->> 'seq')::smallint;

  if gid is null then
    insert into games (played_on, format, seq, team_a_points, team_b_points, team_a_sets, team_b_sets,
                       tournament_id, tournament_phase, tournament_round)
    values (t.held_on, t.format, (p_game ->> 'seq')::smallint,
            (p_game ->> 'team_a_points')::smallint, (p_game ->> 'team_b_points')::smallint,
            coalesce((p_game ->> 'team_a_sets')::smallint, 0), coalesce((p_game ->> 'team_b_sets')::smallint, 0),
            t.id, p_game ->> 'phase', (p_game ->> 'round')::smallint)
    returning id into gid;
  else
    update games
       set team_a_points = (p_game ->> 'team_a_points')::smallint,
           team_b_points = (p_game ->> 'team_b_points')::smallint,
           team_a_sets = coalesce((p_game ->> 'team_a_sets')::smallint, 0),
           team_b_sets = coalesce((p_game ->> 'team_b_sets')::smallint, 0)
     where id = gid;
    delete from game_players where game_id = gid;
  end if;

  insert into game_players (game_id, team, seat, player_id, idiot_points, alone_wins)
  select gid, p.team, p.seat, p.player_id, coalesce(p.idiot_points, 0), coalesce(p.alone_wins, 0)
    from jsonb_to_recordset(p_game -> 'players')
         as p(team char(1), seat smallint, player_id bigint, idiot_points smallint, alone_wins smallint);

  return gid;
end $$;


-- Removes one table's saved result (e.g. entered on the wrong table).
create function public.clear_tournament_game(p_tournament_id bigint, p_phase text, p_round int, p_seq int)
returns void
language sql security definer set search_path = public as $$
  delete from games
   where tournament_id = p_tournament_id and tournament_phase = p_phase
     and tournament_round = p_round and seq = p_seq;
$$;


-- Deletes a tournament that has no saved games, plus the season it opened
-- if that season is still empty.
create function public.delete_tournament(p_tournament_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t tournaments;
begin
  select * into t from tournaments where id = p_tournament_id;
  if not found then
    return;
  end if;
  if exists (select 1 from games where tournament_id = t.id) then
    raise exception 'This tournament has saved games; clear them first.';
  end if;
  delete from seasons s
   where s.starts_on = t.held_on + 1
     and not exists (select 1 from games g where g.played_on >= s.starts_on);
  delete from tournaments where id = t.id;
end $$;


revoke execute on function public.create_tournament(date, jsonb, text) from public, anon, authenticated;
revoke execute on function public.save_tournament_game(bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.clear_tournament_game(bigint, text, int, int) from public, anon, authenticated;
revoke execute on function public.delete_tournament(bigint) from public, anon, authenticated;
grant execute on function public.create_tournament(date, jsonb, text) to anon, authenticated;
grant execute on function public.save_tournament_game(bigint, jsonb) to anon, authenticated;
grant execute on function public.clear_tournament_game(bigint, text, int, int) to anon, authenticated;
grant execute on function public.delete_tournament(bigint) to anon, authenticated;

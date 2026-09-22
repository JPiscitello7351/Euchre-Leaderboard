// Loads the whole league into memory. The data set is small (hundreds of
// games), so every tab works from one in-memory copy and stats are computed
// in the browser.
//
// Local preview: add ?data=local/<file>.json to the URL to load a backup
// file instead of Supabase (the local/ folder is git-ignored).

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PAGE = 1000; // Supabase returns at most 1000 rows per request.

async function fetchAll(table, columns, order) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from(table).select(columns).range(from, from + PAGE - 1);
    for (const col of order) query = query.order(col);
    const { data, error } = await query;
    if (error) throw new Error(`Loading ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function loadFromSupabase() {
  const [settings, players, seasons, tournaments, games] = await Promise.all([
    fetchAll('settings', 'max_guests_per_game', ['id']),
    fetchAll('players', '*', ['id']),
    fetchAll('seasons', '*', ['starts_on']),
    fetchAll('tournaments', '*', ['held_on']),
    fetchAll('games', '*, players:game_players(*)', ['played_on', 'format', 'seq', 'id']),
  ]);
  return { settings: settings[0], players, seasons, tournaments, games };
}

async function loadFromFile(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Loading ${path}: ${res.status}`);
  const backup = await res.json();
  // Version 1 backups have an "active" flag instead of membership dates:
  // joined = first game, left = last game for inactive players (as the
  // database upgrade does).
  if (backup.version === 1) {
    const first = new Map();
    const last = new Map();
    for (const g of backup.games) {
      for (const p of g.players) {
        if (p.player_id === null) continue;
        if (!(first.get(p.player_id) <= g.played_on)) first.set(p.player_id, g.played_on);
        if (!(last.get(p.player_id) >= g.played_on)) last.set(p.player_id, g.played_on);
      }
    }
    for (const p of backup.players) {
      p.joined_on ??= first.get(p.id) ?? (p.created_at ?? new Date().toISOString()).slice(0, 10);
      p.left_on ??= p.active === false ? last.get(p.id) ?? p.joined_on : null;
    }
  }
  return {
    settings: backup.settings,
    players: backup.players,
    seasons: backup.seasons,
    tournaments: backup.tournaments,
    games: backup.games,
  };
}

export async function loadLeague() {
  const file = new URLSearchParams(location.search).get('data');
  const league = file ? await loadFromFile(file) : await loadFromSupabase();
  league.source = file ? `local file ${file}` : 'Supabase';
  league.playerById = new Map(league.players.map((p) => [p.id, p]));
  return league;
}

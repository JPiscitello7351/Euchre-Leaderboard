// League membership. Each player has joined_on and an optional left_on.
// A player is ranked in a season if they were still a member when it ended
// (for the current season and all-time: a member today). Guests are always
// ranked as one combined entry.

import { GUEST } from './stats.js';

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayBefore(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const prev = new Date(y, m - 1, d - 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
}

export const isMemberOn = (player, date) =>
  !!player && player.joined_on <= date && (!player.left_on || player.left_on >= date);

export const isCurrentMember = (player) => isMemberOn(player, today());

// Last day of a season: the day before the next one starts, or today for
// the current season. `null` (all time) also means today.
export function seasonEnd(season, seasons) {
  if (!season) return today();
  const next = seasons.filter((s) => s.starts_on > season.starts_on).sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0];
  const end = next ? dayBefore(next.starts_on) : today();
  return end < today() ? end : today();
}

// isRanked(key) for a season (or all time when season is null).
export function rankedIn(league, season) {
  const end = seasonEnd(season, league.seasons);
  return (key) => key === GUEST || isMemberOn(league.playerById.get(key), end);
}

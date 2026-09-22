// Small display helpers shared by the views.

import { GUEST, seasonFor } from './stats.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const playerName = (league, key) => (key === GUEST ? 'Guest' : league.playerById.get(key)?.name ?? `#${key}`);

// A player's name linked to their profile. Guests have no profile, so they
// stay plain text.
export function playerLink(league, key) {
  const name = esc(playerName(league, key));
  return key === GUEST || key === null || key === undefined
    ? `<span class="guest">${name}</span>`
    : `<a class="player-link" href="#players?p=${key}">${name}</a>`;
}

const blank = (v) => v === null || v === undefined || Number.isNaN(v);

export const num = (v, digits = 2) => (blank(v) ? '–' : v.toFixed(digits));
export const signed = (v, digits = 2) => (blank(v) ? '–' : (v > 0 ? '+' : '') + v.toFixed(digits));
export const pct = (v) => (blank(v) ? '–' : (v * 100).toFixed(1) + '%');
export const int = (v) => (blank(v) ? '–' : String(v));

// Tournaments are named for the season they end, e.g. "Q1 2026 Tournament".
export function tournamentTitle(league, t) {
  if (t.name) return t.name;
  const season = seasonFor(t.held_on, league.seasons);
  return season ? `${season.name} Tournament` : `${formatDate(t.held_on)} Tournament`;
}

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

import { supabase } from '../data.js';
import { seasonFor, sortGames } from '../stats.js';
import { esc, formatDate } from '../format.js';
import { isMemberOn } from '../members.js';

// Game Input edits one date + format at a time: every league game from that
// day is loaded into a draft, edited here, and saved together with
// save_day(), which adds, updates and deletes to match the draft.
// Tournament games are entered in Tournament Mode instead.

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const state = { date: today(), format: 4, draft: null, dirty: false, message: null };

// Warn before closing or reloading the page with unsaved games.
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});

const emptySeat = (team, seat) => ({ team, seat, pick: '', guest_name: '', idiot_points: 0 });

function emptyGame(format) {
  const seats = [];
  for (const team of ['A', 'B']) for (let s = 1; s <= format / 2; s++) seats.push(emptySeat(team, s));
  return { id: null, team_a_points: '', team_b_points: '', seats };
}

function loadDraft(league) {
  state.draft = sortGames(league.games.filter((g) => g.played_on === state.date && g.format === state.format && !g.tournament_id)).map((g) => ({
    id: g.id,
    team_a_points: g.team_a_points,
    team_b_points: g.team_b_points,
    seats: [...g.players]
      .sort((a, b) => a.team.localeCompare(b.team) || a.seat - b.seat)
      .map((p) => ({
        team: p.team,
        seat: p.seat,
        pick: p.player_id === null ? 'guest' : String(p.player_id),
        guest_name: p.guest_name ?? '',
        idiot_points: p.idiot_points,
      })),
  }));
  state.dirty = false;
}

// Same rules the database enforces, checked here first for friendlier messages.
function problems(game, league) {
  const out = [];
  const guestLimit = league.settings?.max_guests_per_game ?? 1;
  if (game.seats.some((s) => !s.pick)) out.push('Pick a player (or Guest) for every seat.');
  const ids = game.seats.filter((s) => s.pick && s.pick !== 'guest').map((s) => s.pick);
  if (new Set(ids).size !== ids.length) out.push('The same player is in this game twice.');
  const guests = game.seats.filter((s) => s.pick === 'guest').length;
  if (guests > guestLimit) out.push(`Only ${guestLimit} guest${guestLimit === 1 ? '' : 's'} allowed per game.`);
  const a = game.team_a_points;
  const b = game.team_b_points;
  if (a === '' || b === '') out.push('Enter both scores.');
  else if (!(Math.max(a, b) >= 10 && Math.min(a, b) <= 9 && Math.max(a, b) <= 13)) {
    out.push('One team must reach 10–13 and the other finish on 9 or less.');
  }
  if (game.seats.some((s) => !(s.idiot_points >= 0 && s.idiot_points <= 20))) out.push('Idiot points must be 0–20.');
  return out;
}

export function render(el, league, { reload }) {
  if (!state.draft || !state.dirty) loadDraft(league);
  const readOnly = league.source !== 'Supabase';
  const season = seasonFor(state.date, league.seasons);
  const tournamentGames = league.games.filter((g) => g.played_on === state.date && g.format === state.format && g.tournament_id).length;
  const usedIds = new Set(state.draft.flatMap((g) => g.seats.map((s) => s.pick)));
  // Members on this date, plus anyone already in this day's games.
  const choices = [...league.players]
    .filter((p) => isMemberOn(p, state.date) || usedIds.has(String(p.id)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const allProblems = state.draft.map((g) => problems(g, league));
  const shown = state.message;
  state.message = null;

  const perTeam = state.format / 2;
  // One cell for a seat's player (plus a guest-name box for guests) and one for its IP.
  const seatCells = (gi, seat, si) => `
    <td class="pick-cell t${seat.team}">
      <select data-g="${gi}" data-s="${si}" data-field="pick" aria-label="Game ${gi + 1} team ${seat.team} player ${seat.seat}">
        <option value="">Player…</option>
        ${choices.map((p) => `<option value="${p.id}" ${seat.pick === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        <option value="guest" ${seat.pick === 'guest' ? 'selected' : ''}>Guest</option>
      </select>
      ${seat.pick === 'guest' ? `<input class="guest-name" data-g="${gi}" data-s="${si}" data-field="guest_name" value="${esc(seat.guest_name)}" placeholder="Guest’s name" maxlength="40" aria-label="Game ${gi + 1} guest name">` : ''}
    </td>
    <td class="ip-cell t${seat.team}"><input type="number" class="num" min="0" max="20" data-g="${gi}" data-s="${si}" data-field="idiot_points" value="${seat.idiot_points}" aria-label="Game ${gi + 1} team ${seat.team} player ${seat.seat} idiot points"></td>`;
  const scoreCell = (gi, game, team) => `
    <td class="score-cell t${team}" data-label="Team ${team} score"><input type="number" class="num score" min="0" max="13" data-g="${gi}" data-field="team_${team.toLowerCase()}_points" value="${game[`team_${team.toLowerCase()}_points`]}" aria-label="Game ${gi + 1} team ${team} score"></td>`;
  const teamCells = (gi, game, team) => game.seats.map((s, si) => (s.team === team ? seatCells(gi, s, si) : '')).join('');
  const header = (team) => Array.from({ length: perTeam }, (_, i) => `<th scope="col">${team}${i + 1}</th><th scope="col" title="Idiot points">IP</th>`).join('');
  const columns = 2 + 4 * perTeam + 2 + 1;

  el.innerHTML = `
    ${shown ? `<p class="${shown.ok ? 'notice' : 'error'}" role="status">${esc(shown.text)}</p>` : ''}
    ${readOnly ? `<p class="notice">Viewing ${esc(league.source)}: games can’t be saved here.</p>` : ''}
    <div class="toolbar">
      <label>Date <input type="date" id="gi-date" value="${state.date}"></label>
      <div class="segmented" role="group" aria-label="Game format">
        ${[4, 6].map((f) => `<button type="button" data-format="${f}" aria-pressed="${state.format === f}">${f}-handed</button>`).join('')}
      </div>
      <span class="muted">${formatDate(state.date)} · ${season ? esc(season.name) : 'before the first season'}</span>
    </div>
    <p class="muted">${state.draft.length ? `Editing ${state.draft.filter((g) => g.id).length} saved game${state.draft.filter((g) => g.id).length === 1 ? '' : 's'} from this date.` : 'No games saved for this date yet.'}
      Games are kept in the order shown.${tournamentGames ? ` This date also has ${tournamentGames} tournament games; edit those in Tournament Mode.` : ''}</p>

    ${state.draft.length ? `<div class="table-wrap"><table class="stats grid-input">
      <thead><tr>
        <th scope="col">#</th>${header('A')}<th scope="col" class="c score-h">A Score</th><th scope="col" class="c score-h">B Score</th>${header('B')}<th scope="col"><span class="visually-hidden">Actions</span></th>
      </tr></thead>
      <tbody>
        ${state.draft.map((g, gi) => `<tr class="game-row ${allProblems[gi].length ? 'has-problems' : ''}">
          <th scope="row" class="game-no">${gi + 1}${g.id ? '' : '<span class="new-dot" title="New game">•</span>'}</th>
          ${teamCells(gi, g, 'A')}
          ${scoreCell(gi, g, 'A')}${scoreCell(gi, g, 'B')}
          ${teamCells(gi, g, 'B')}
          <td class="row-actions">
            <button type="button" data-move="${gi}" data-dir="-1" ${gi === 0 ? 'disabled' : ''} aria-label="Move game ${gi + 1} up">↑</button>
            <button type="button" data-move="${gi}" data-dir="1" ${gi === state.draft.length - 1 ? 'disabled' : ''} aria-label="Move game ${gi + 1} down">↓</button>
            <button type="button" data-remove="${gi}" aria-label="Remove game ${gi + 1}">✕</button>
          </td>
        </tr>
        ${allProblems[gi].length ? `<tr class="problem-row"><td colspan="${columns}">Game ${gi + 1}: ${allProblems[gi].map(esc).join(' ')}</td></tr>` : ''}`).join('')}
      </tbody>
    </table></div>` : ''}

    <div class="inline-form sticky-actions">
      <button type="button" id="gi-add">+ Add game</button>
      <span class="spacer"></span>
      ${state.dirty ? '<span class="muted">Unsaved changes</span>' : ''}
      <button type="button" id="gi-discard" ${state.dirty ? '' : 'disabled'}>Discard changes</button>
      <button type="button" class="primary" id="gi-save" ${readOnly || !state.dirty || allProblems.some((p) => p.length) ? 'disabled' : ''}>Save ${esc(formatDate(state.date))}</button>
    </div>`;

  const rerender = () => render(el, league, { reload });
  const change = () => {
    state.dirty = true;
    rerender();
  };
  const leaveOk = () => !state.dirty || confirm('Discard unsaved changes for this date?');

  el.querySelector('#gi-date').addEventListener('change', (e) => {
    if (!e.target.value) return;
    if (!leaveOk()) {
      e.target.value = state.date;
      return;
    }
    state.date = e.target.value;
    loadDraft(league);
    rerender();
  });
  for (const btn of el.querySelectorAll('[data-format]')) {
    btn.addEventListener('click', () => {
      if (Number(btn.dataset.format) === state.format || !leaveOk()) return;
      state.format = Number(btn.dataset.format);
      loadDraft(league);
      rerender();
    });
  }
  for (const input of el.querySelectorAll('[data-field]')) {
    input.addEventListener('change', () => {
      const game = state.draft[Number(input.dataset.g)];
      const field = input.dataset.field;
      if (input.dataset.s !== undefined) {
        const seat = game.seats[Number(input.dataset.s)];
        seat[field] = field === 'idiot_points' ? Number(input.value || 0) : input.value;
        if (field === 'pick' && input.value !== 'guest') seat.guest_name = '';
      } else {
        game[field] = input.value === '' ? '' : Number(input.value);
      }
      change();
    });
  }
  for (const btn of el.querySelectorAll('[data-move]')) {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.move);
      const j = i + Number(btn.dataset.dir);
      [state.draft[i], state.draft[j]] = [state.draft[j], state.draft[i]];
      change();
    });
  }
  for (const btn of el.querySelectorAll('[data-remove]')) {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.remove);
      if (state.draft[i].id && !confirm(`Remove saved game ${i + 1}? It’s deleted when you save.`)) return;
      state.draft.splice(i, 1);
      change();
    });
  }
  el.querySelector('#gi-add').addEventListener('click', () => {
    state.draft.push(emptyGame(state.format));
    change();
    [...el.querySelectorAll('.game-row')].pop()?.querySelector('select')?.focus();
  });
  el.querySelector('#gi-discard').addEventListener('click', () => {
    if (!confirm('Discard unsaved changes for this date?')) return;
    loadDraft(league);
    rerender();
  });
  el.querySelector('#gi-save').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const payload = state.draft.map((g) => ({
      id: g.id,
      team_a_points: g.team_a_points,
      team_b_points: g.team_b_points,
      players: g.seats.map((s) => ({
        team: s.team,
        seat: s.seat,
        player_id: s.pick === 'guest' ? null : Number(s.pick),
        guest_name: s.pick === 'guest' ? s.guest_name.trim() || null : null,
        idiot_points: s.idiot_points,
      })),
    }));
    const { error } = await supabase.rpc('save_day', { p_played_on: state.date, p_format: state.format, p_games: payload });
    if (error) {
      state.message = { ok: false, text: `Not saved: ${error.message}` };
      rerender();
      return;
    }
    state.message = { ok: true, text: `Saved ${payload.length} game${payload.length === 1 ? '' : 's'} for ${formatDate(state.date)}.` };
    state.dirty = false; // the next render reloads the draft from the saved data
    await reload();
  });
}

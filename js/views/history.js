import { seasonFor, sortGames } from '../stats.js';
import { esc, formatDate, tournamentTitle } from '../format.js';

const state = { format: 'all', seasonId: 'all', playerId: 'all' };

function seatLabel(league, seat) {
  const name = seat.player_id !== null
    ? esc(league.playerById.get(seat.player_id)?.name ?? `#${seat.player_id}`)
    : `<span class="guest">Guest${seat.guest_name ? ` (${esc(seat.guest_name)})` : ''}</span>`;
  const extras = [];
  if (seat.idiot_points) extras.push(`<span class="ip" title="Idiot points">${seat.idiot_points} IP</span>`);
  if (seat.alone_wins) extras.push(`<span class="loner" title="Alone wins">${seat.alone_wins} alone</span>`);
  return `${name}${extras.length ? ' ' + extras.join(' ') : ''}`;
}

function team(league, game, side) {
  const seats = game.players.filter((p) => p.team === side).sort((a, b) => a.seat - b.seat);
  const pts = side === 'A' ? game.team_a_points : game.team_b_points;
  const other = side === 'A' ? game.team_b_points : game.team_a_points;
  const sets = side === 'A' ? game.team_a_sets : game.team_b_sets;
  return `<div class="team ${pts > other ? 'won' : ''}">
    <span class="score">${pts}</span>
    <span class="names">${seats.map((s) => seatLabel(league, s)).join(', ')}${sets ? ` <span class="sets" title="Sets (euchres)">${sets} set${sets === 1 ? '' : 's'}</span>` : ''}</span>
  </div>`;
}

export function render(el, league) {
  const tournamentsById = new Map(league.tournaments.map((t) => [t.id, t]));
  const games = sortGames(league.games)
    .filter((g) => state.format === 'all' || g.format === state.format)
    .filter((g) => state.seasonId === 'all' || seasonFor(g.played_on, league.seasons)?.id === state.seasonId)
    .filter((g) => state.playerId === 'all' || g.players.some((p) => p.player_id === state.playerId))
    .reverse();

  const byDay = new Map();
  for (const g of games) {
    if (!byDay.has(g.played_on)) byDay.set(g.played_on, []);
    byDay.get(g.played_on).push(g);
  }

  const players = [...league.players].sort((a, b) => a.name.localeCompare(b.name));
  el.innerHTML = `
    <div class="toolbar">
      <label>Season
        <select id="gh-season">
          <option value="all">All time</option>
          ${[...league.seasons].reverse().map((s) => `<option value="${s.id}" ${s.id === state.seasonId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>
      </label>
      <label>Player
        <select id="gh-player">
          <option value="all">Everyone</option>
          ${players.map((p) => `<option value="${p.id}" ${p.id === state.playerId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
      </label>
      <div class="segmented" role="group" aria-label="Game format">
        ${[['all', 'All'], [4, '4-handed'], [6, '6-handed']].map(([f, label]) => `<button type="button" data-format="${f}" aria-pressed="${state.format === f}">${label}</button>`).join('')}
      </div>
      <span class="muted">${games.length} game${games.length === 1 ? '' : 's'}</span>
    </div>
    ${games.length === 0 ? '<p class="placeholder">No games match.</p>' : ''}
    ${[...byDay].map(([day, dayGames]) => {
      const t = dayGames.find((g) => g.tournament_id)?.tournament_id;
      return `<section class="day">
        <h3>${formatDate(day)}${t ? ` <span class="badge">${esc(tournamentTitle(league, tournamentsById.get(t)))}</span>` : ''}</h3>
        <ol class="games">
          ${[...dayGames].reverse().map((g) => `<li class="game">
            <div class="meta">${g.format}-handed${g.tournament_id ? ` · ${g.tournament_phase === 'final' ? 'Finals' : 'Prelims'} round ${g.tournament_round}` : ''}</div>
            ${team(league, g, 'A')}
            ${team(league, g, 'B')}
          </li>`).join('')}
        </ol>
      </section>`;
    }).join('')}`;

  el.querySelector('#gh-season').addEventListener('change', (e) => {
    state.seasonId = e.target.value === 'all' ? 'all' : Number(e.target.value);
    render(el, league);
  });
  el.querySelector('#gh-player').addEventListener('change', (e) => {
    state.playerId = e.target.value === 'all' ? 'all' : Number(e.target.value);
    render(el, league);
  });
  for (const btn of el.querySelectorAll('[data-format]')) {
    btn.addEventListener('click', () => {
      state.format = btn.dataset.format === 'all' ? 'all' : Number(btn.dataset.format);
      render(el, league);
    });
  }
}

import { seasonFor, sortGames } from '../stats.js';
import { esc, formatDate, tournamentTitle } from '../format.js';

// Every game as one table row, laid out like the league spreadsheets:
// team A's players and idiot points, both scores, team B's players and
// idiot points. One format at a time, since 6-handed games have more seats.

const state = { format: 4, seasonId: 'all', playerId: 'all' };

function seatName(league, seat) {
  if (seat.player_id !== null) return esc(league.playerById.get(seat.player_id)?.name ?? `#${seat.player_id}`);
  return `<span class="guest">Guest${seat.guest_name ? ` (${esc(seat.guest_name)})` : ''}</span>`;
}

// Tournament round, sets and alone wins, which have no column of their own.
function notes(league, game) {
  const out = [];
  if (game.tournament_id) out.push(`${game.tournament_phase === 'final' ? 'Finals' : 'Prelims'} R${game.tournament_round}`);
  if (game.team_a_sets || game.team_b_sets) out.push(`Sets ${game.team_a_sets ?? 0}–${game.team_b_sets ?? 0}`);
  const alone = game.players.filter((p) => p.alone_wins);
  if (alone.length) out.push(alone.map((p) => `${seatName(league, p)} ${p.alone_wins} alone`).join(', '));
  return out.join(' · ');
}

export function render(el, league) {
  const tournamentsById = new Map(league.tournaments.map((t) => [t.id, t]));
  const perTeam = state.format / 2;
  const games = sortGames(league.games)
    .filter((g) => g.format === state.format)
    .filter((g) => state.seasonId === 'all' || seasonFor(g.played_on, league.seasons)?.id === state.seasonId)
    .filter((g) => state.playerId === 'all' || g.players.some((p) => p.player_id === state.playerId));

  // Newest night first; games within a night in the order they were played.
  const days = new Map();
  for (const g of games) {
    if (!days.has(g.played_on)) days.set(g.played_on, []);
    days.get(g.played_on).push(g);
  }
  const nights = [...days].reverse();

  const teamCells = (game, team, won) =>
    game.players
      .filter((p) => p.team === team)
      .sort((a, b) => a.seat - b.seat)
      .map((p) => `<td class="${won ? 'won' : ''}">${seatName(league, p)}</td><td class="ip-cell">${p.idiot_points || ''}</td>`)
      .join('');
  const header = (team) => Array.from({ length: perTeam }, (_, i) => `<th scope="col">${team}${i + 1}</th><th scope="col" class="c" title="Idiot points">IP</th>`).join('');

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
        ${[4, 6].map((f) => `<button type="button" data-format="${f}" aria-pressed="${state.format === f}">${f}-handed</button>`).join('')}
      </div>
      <span class="muted">${games.length} game${games.length === 1 ? '' : 's'}</span>
    </div>
    ${games.length === 0 ? '<p class="placeholder">No games match.</p>' : `
    <div class="table-wrap"><table class="stats history">
      <thead><tr>
        <th scope="col">Date</th><th scope="col">#</th>${header('A')}<th scope="col" class="c score-h">A Score</th><th scope="col" class="c score-h">B Score</th>${header('B')}<th scope="col">Notes</th>
      </tr></thead>
      <tbody>
        ${nights.map(([day, dayGames]) => dayGames.map((g, i) => {
          const aWon = g.team_a_points > g.team_b_points;
          return `<tr class="${i === 0 ? 'night-start' : ''}">
            ${i === 0 ? `<th scope="rowgroup" rowspan="${dayGames.length}" class="date-cell">${formatDate(day)}${g.tournament_id ? `<br><span class="badge">${esc(tournamentTitle(league, tournamentsById.get(g.tournament_id)))}</span>` : ''}</th>` : ''}
            <td class="muted">${i + 1}</td>
            ${teamCells(g, 'A', aWon)}
            <td class="score-cell ${aWon ? 'won' : ''}">${g.team_a_points}</td>
            <td class="score-cell ${aWon ? '' : 'won'}">${g.team_b_points}</td>
            ${teamCells(g, 'B', !aWon)}
            <td class="notes-cell">${notes(league, g)}</td>
          </tr>`;
        }).join('')).join('')}
      </tbody>
    </table></div>`}`;

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
      state.format = Number(btn.dataset.format);
      render(el, league);
    });
  }
}

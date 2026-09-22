import { standings, SCORING } from '../tournament.js';
import { sortGames } from '../stats.js';
import { esc, playerName, playerLink, formatDate, num, tournamentTitle } from '../format.js';

const state = { tournamentId: null };

// All of a tournament's games as one read-only table, laid out like
// Tournament Mode's "All games" view. Zeros are left blank so the
// alone wins, idiot points and sets that did happen stand out.
function gamesTable(league, games) {
  const blank = (n) => (n ? n : '');
  const teamHeader = (tk) => [1, 2].map((i) => `<th scope="col">${tk}${i}</th><th scope="col" class="c" title="Alone wins">Alone</th><th scope="col" class="c" title="Idiot points">IP</th>`).join('');
  const teamCells = (g, tk, won) => g.players
    .filter((p) => p.team === tk)
    .sort((a, b) => a.seat - b.seat)
    .map((p) => `<td class="${won ? 'won' : ''}">${playerLink(league, p.player_id ?? 'guest')}</td><td class="c">${blank(p.alone_wins)}</td><td class="c ip-cell">${blank(p.idiot_points)}</td>`)
    .join('');
  let lastRound = null;
  let tableNo = 0;
  const rows = games.map((g) => {
    const round = `${g.tournament_phase}-${g.tournament_round}`;
    const first = round !== lastRound;
    tableNo = first ? 1 : tableNo + 1;
    lastRound = round;
    const aWon = g.team_a_points > g.team_b_points;
    return `<tr class="${first ? 'night-start' : ''}">
      <th scope="row">${first ? `${g.tournament_phase === 'final' ? 'Finals' : 'Prelims'} R${g.tournament_round}` : ''}</th>
      <td class="c muted">${tableNo}</td>
      ${teamCells(g, 'A', aWon)}
      <td class="c sets-cell">${blank(g.team_a_sets)}</td><td class="score-cell ${aWon ? 'won' : ''}">${g.team_a_points}</td>
      <td class="score-cell ${aWon ? '' : 'won'}">${g.team_b_points}</td><td class="c sets-cell">${blank(g.team_b_sets)}</td>
      ${teamCells(g, 'B', !aWon)}
    </tr>`;
  });
  return `<div class="table-wrap"><table class="stats history results-games">
    <thead><tr><th scope="col">Round</th><th scope="col" class="c">Tbl</th>${teamHeader('A')}<th scope="col" class="c score-h" title="Sets (euchres) team A got">A Sets</th><th scope="col" class="c score-h">A Score</th><th scope="col" class="c score-h">B Score</th><th scope="col" class="c score-h" title="Sets (euchres) team B got">B Sets</th>${teamHeader('B')}</tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table></div>`;
}

export function render(el, league) {
  const tournaments = [...league.tournaments].sort((a, b) => b.held_on.localeCompare(a.held_on));
  if (!tournaments.length) {
    el.innerHTML = '<p class="placeholder">No tournaments yet.</p>';
    return;
  }
  state.tournamentId ??= tournaments[0].id;
  const t = tournaments.find((x) => x.id === state.tournamentId) ?? tournaments[0];
  const games = sortGames(league.games.filter((g) => g.tournament_id === t.id));
  const recorded = t.schedule?.recorded_standings;

  let body;
  if (games.length) {
    const rows = standings(games);
    const champ = rows[0];
    // Tournaments run in the app are finished once every finals table is saved.
    const slots = t.schedule?.finals?.rounds.reduce((n, r) => n + r.tables.length, 0);
    const finished = !t.schedule?.prelim || (slots !== undefined && games.filter((g) => g.tournament_phase === 'final').length === slots);
    body = `
      <div class="stat-cards">
        <div class="stat-card champion"><div class="label">${finished ? 'Champion' : 'Leader (in progress)'}</div><div class="value">${finished ? '🏆 ' : ''}${esc(playerName(league, champ.key))}</div><div class="sub">${champ.total} points</div></div>
        <div class="stat-card"><div class="label">Players</div><div class="value">${rows.length}</div><div class="sub">${games.length} games</div></div>
      </div>
      <section class="panel">
        <h3>${finished ? 'Final standings' : 'Standings so far'}</h3>
        <p class="muted">Points: ${SCORING.point} per point scored, +${SCORING.set} per team set, +${SCORING.alone} per alone win, +${SCORING.win} per win, ${SCORING.idiot} per idiot point. Ties: wins, then alone wins, then sets, then fewest points allowed per game.</p>
        <div class="table-wrap"><table class="stats">
          <thead><tr><th scope="col">Place</th><th scope="col" class="name-col">Player</th><th scope="col">Total</th><th scope="col">Prelims</th><th scope="col">Finals</th><th scope="col">W–L</th><th scope="col">Points</th><th scope="col">Sets</th><th scope="col">Alone</th><th scope="col">IP</th><th scope="col" title="Points allowed per game (4th tiebreaker, lower is better)">Allowed/G</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${r.place}</td><th scope="row">${playerLink(league, r.key)}</th><td><strong>${r.total}</strong></td><td>${r.prelimTotal}</td><td>${r.finalTotal || '–'}</td><td>${r.wins}–${r.losses}</td><td>${r.gamePoints}</td><td>${r.sets}</td><td>${r.aloneWins}</td><td>${r.idiotPoints}</td><td>${num(r.oppPpg, 1)}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>
      <section class="panel">
        <h3>Games</h3>
        ${gamesTable(league, games)}
      </section>`;
  } else if (recorded) {
    body = `
      <div class="stat-cards">
        <div class="stat-card champion"><div class="label">Champion</div><div class="value">🏆 ${esc(playerName(league, recorded[0].player_id))}</div><div class="sub">${recorded[0].points} points</div></div>
      </div>
      <section class="panel">
        <h3>Final standings</h3>
        ${t.schedule.note ? `<p class="muted">${esc(t.schedule.note)}</p>` : ''}
        <div class="table-wrap"><table class="stats">
          <thead><tr><th scope="col">Place</th><th scope="col" class="name-col">Player</th><th scope="col">Total</th></tr></thead>
          <tbody>${recorded.map((r) => `<tr><td>${r.place}</td><th scope="row">${playerLink(league, r.player_id)}</th><td><strong>${r.points}</strong></td></tr>`).join('')}</tbody>
        </table></div>
      </section>`;
  } else {
    body = '<p class="placeholder">No games recorded for this tournament yet. Run it from Tournament Mode.</p>';
  }

  el.innerHTML = `
    <div class="toolbar">
      <label>Tournament
        <select id="tr-select">
          ${tournaments.map((x) => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${esc(tournamentTitle(league, x))}</option>`).join('')}
        </select>
      </label>
    </div>
    <p class="muted">${formatDate(t.held_on)}</p>
    ${body}`;

  el.querySelector('#tr-select').addEventListener('change', (e) => {
    state.tournamentId = Number(e.target.value);
    render(el, league);
  });
}

import { standings, SCORING } from '../tournament.js';
import { sortGames } from '../stats.js';
import { esc, playerName, formatDate, num, tournamentTitle } from '../format.js';

const state = { tournamentId: null };

function gameLine(league, g) {
  const side = (team) => g.players.filter((p) => p.team === team).sort((a, b) => a.seat - b.seat)
    .map((p) => esc(playerName(league, p.player_id ?? 'guest')) + (p.alone_wins ? ` <span class="loner">${p.alone_wins} alone</span>` : '') + (p.idiot_points ? ` <span class="ip">${p.idiot_points} IP</span>` : ''))
    .join(', ');
  const sets = (n) => (n ? ` <span class="sets">${n} set${n === 1 ? '' : 's'}</span>` : '');
  const aWon = g.team_a_points > g.team_b_points;
  return `<li class="game">
    <div class="team ${aWon ? 'won' : ''}"><span class="score">${g.team_a_points}</span><span class="names">${side('A')}${sets(g.team_a_sets)}</span></div>
    <div class="team ${aWon ? '' : 'won'}"><span class="score">${g.team_b_points}</span><span class="names">${side('B')}${sets(g.team_b_sets)}</span></div>
  </li>`;
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
    const rounds = new Map();
    for (const g of games) {
      const id = `${g.tournament_phase}-${g.tournament_round}`;
      if (!rounds.has(id)) rounds.set(id, { label: `${g.tournament_phase === 'final' ? 'Finals' : 'Prelims'} round ${g.tournament_round}`, games: [] });
      rounds.get(id).games.push(g);
    }
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
          <tbody>${rows.map((r) => `<tr><td>${r.place}</td><th scope="row">${esc(playerName(league, r.key))}</th><td><strong>${r.total}</strong></td><td>${r.prelimTotal}</td><td>${r.finalTotal || '–'}</td><td>${r.wins}–${r.losses}</td><td>${r.gamePoints}</td><td>${r.sets}</td><td>${r.aloneWins}</td><td>${r.idiotPoints}</td><td>${num(r.oppPpg, 1)}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>
      ${[...rounds.values()].map((r) => `<section class="day"><h3>${r.label}</h3><ol class="games">${r.games.map((g) => gameLine(league, g)).join('')}</ol></section>`).join('')}`;
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
          <tbody>${recorded.map((r) => `<tr><td>${r.place}</td><th scope="row">${esc(playerName(league, r.player_id))}</th><td><strong>${r.points}</strong></td></tr>`).join('')}</tbody>
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

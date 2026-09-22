import { leaderboard, pairStats, seasonFor, sortGames, GUEST } from '../stats.js';
import { isCurrentMember, rankedIn } from '../members.js';
import { playerBlurb } from '../blurb.js';
import { esc, playerName, playerLink, num, signed, pct, formatDate } from '../format.js';
import { hashParams } from '../app.js';


const state = { playerId: null, format: 4 };

export function render(el, league) {
  const players = [...league.players].sort((a, b) => isCurrentMember(b) - isCurrentMember(a) || a.name.localeCompare(b.name));
  if (!players.length) {
    el.innerHTML = '<p class="placeholder">No players yet.</p>';
    return;
  }
  // A link like #players?p=4 opens that player.
  const wanted = Number(hashParams().get('p'));
  if (wanted && league.playerById.has(wanted)) state.playerId = wanted;
  state.playerId ??= players[0].id;
  const me = state.playerId;
  const formatGames = league.games.filter((g) => g.format === state.format);
  const myGames = sortGames(formatGames.filter((g) => g.players.some((p) => p.player_id === me)));

  // One leaderboard row per season (plus all time) for this player.
  const scopes = [{ name: 'All time', season: null, games: formatGames }, ...[...league.seasons].reverse().map((s) => ({
    name: s.name,
    season: s,
    games: formatGames.filter((g) => seasonFor(g.played_on, league.seasons)?.id === s.id),
  }))];
  const seasonRows = scopes
    .map((s) => ({ name: s.name, row: s.games.length ? leaderboard(s.games, { isRanked: rankedIn(league, s.season) }).find((r) => r.key === me) : null }))
    .filter((s) => s.row);
  const overall = seasonRows[0]?.row;

  let partners = [];
  let opponents = [];
  if (formatGames.length && overall) {
    const pairs = pairStats(formatGames);
    for (const [id, s] of pairs.partners) {
      const [a, b] = id.split('|');
      if (a === String(me)) partners.push({ key: b === GUEST ? GUEST : Number(b), ...s });
    }
    for (const [id, s] of pairs.opponents) {
      const [a, b] = id.split('|');
      if (a === String(me)) opponents.push({ key: b === GUEST ? GUEST : Number(b), ...s });
    }
    partners.sort((x, y) => y.winPct - x.winPct || y.games - x.games);
    opponents.sort((x, y) => y.winPct - x.winPct || y.games - x.games);
  }

  const card = (label, value, sub = '') => `<div class="stat-card"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  const pairList = (list, kind) => list.length
    ? `<table class="stats compact"><thead><tr><th scope="col" class="name-col">${kind}</th><th scope="col">Games</th><th scope="col">Record</th><th scope="col">Win %</th>${kind === 'Partner' ? '<th scope="col">Synergy</th>' : ''}</tr></thead>
       <tbody>${list.map((p) => `<tr><th scope="row">${playerLink(league, p.key)}</th><td>${p.games}</td><td>${p.wins}–${p.games - p.wins}</td><td>${pct(p.winPct)}</td>${kind === 'Partner' ? `<td>${signed(p.avgSynergy)}</td>` : ''}</tr>`).join('')}</tbody></table>`
    : '<p class="muted">No games with anyone yet.</p>';

  // Written from the numbers, so it keeps up as games are added.
  const about = playerBlurb(league, me, state.format);
  const recent = myGames.slice(-10).reverse();
  const seatName = (s) => (s.player_id === null ? 'Guest' : league.playerById.get(s.player_id)?.name);

  el.innerHTML = `
    <div class="toolbar">
      <label>Player
        <select id="pf-player">
          ${players.map((p) => `<option value="${p.id}" ${p.id === me ? 'selected' : ''}>${esc(p.name)}${isCurrentMember(p) ? '' : ' (former)'}</option>`).join('')}
        </select>
      </label>
      <div class="segmented" role="group" aria-label="Game format">
        ${[4, 6].map((f) => `<button type="button" data-format="${f}" aria-pressed="${state.format === f}">${f}-handed</button>`).join('')}
      </div>
    </div>
    ${!overall ? `<p class="placeholder">No ${state.format}-handed games yet.</p>` : `
      ${about ? `<section class="panel about">
        <h3>About</h3>
        <p class="about-intro">${esc(about.intro)}</p>
        <div class="two-col">
          <div><h4 class="strengths-head">Strengths</h4><ul class="traits">
            ${about.strengths.map((t) => `<li><strong>${esc(t.label)}.</strong> ${esc(t.detail)}</li>`).join('')}
          </ul></div>
          <div><h4 class="weaknesses-head">Weaknesses</h4><ul class="traits">
            ${about.weaknesses.map((t) => `<li><strong>${esc(t.label)}.</strong> ${esc(t.detail)}</li>`).join('')}
          </ul></div>
        </div>
      </section>` : ''}
      <div class="stat-cards">
        ${card('Record', `${overall.wins}–${overall.losses}`, `${overall.games} games · all time`)}
        ${card('Win %', pct(overall.winPct), overall.rank ? `Rank ${overall.rank} all time` : 'Unranked (former member)')}
        ${card('PPG', num(overall.ppg), `${signed(overall.ppgPlusMinus)} vs league`)}
        ${card('Synergy', signed(overall.avgSynergy), `Expected diff ${signed(overall.avgExpectedDiff)}`)}
        ${card('Idiot PPG', num(overall.idiotPpg), `${overall.idiotPoints} idiot points`)}
        ${card('Streak', overall.currentStreak ? `${overall.currentStreak.won ? 'W' : 'L'}${overall.currentStreak.length}` : '–', `Longest: W${overall.longestWinStreak} / L${overall.longestLossStreak}`)}
        ${card('Strength of schedule', num(overall.sos, 3), `Rank ${overall.sosRank} all time`)}
      </div>

      <section class="panel">
        <h3>By season</h3>
        <div class="table-wrap"><table class="stats">
          <thead><tr><th scope="col" class="name-col">Season</th><th scope="col">Rank</th><th scope="col">W</th><th scope="col">L</th><th scope="col">Win %</th><th scope="col">GB</th><th scope="col">PPG</th><th scope="col">IPPG</th><th scope="col">Avg Diff</th><th scope="col">Synergy</th><th scope="col">SoS</th></tr></thead>
          <tbody>${seasonRows.map(({ name, row: r }) => `<tr><th scope="row">${esc(name)}</th><td>${r.rank ?? '–'}</td><td>${r.wins}</td><td>${r.losses}</td><td>${pct(r.winPct)}</td><td>${num(r.gamesBehind, 1)}</td><td>${num(r.ppg)}</td><td>${num(r.idiotPpg)}</td><td>${signed(r.avgPointDiff)}</td><td>${signed(r.avgSynergy)}</td><td>${num(r.sos, 3)}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>

      <div class="two-col">
        <section class="panel"><h3>Partners</h3><div class="table-wrap">${pairList(partners, 'Partner')}</div></section>
        <section class="panel"><h3>Opponents</h3><p class="muted">Win % against each opponent.</p><div class="table-wrap">${pairList(opponents, 'Opponent')}</div></section>
      </div>

      <section class="panel">
        <h3>Recent games</h3>
        <ul class="recent">
          ${recent.map((g) => {
            const mine = g.players.find((p) => p.player_id === me);
            const us = g.players.filter((p) => p.team === mine.team && p !== mine).map(seatName);
            const them = g.players.filter((p) => p.team !== mine.team).map(seatName);
            const [ours, theirs] = mine.team === 'A' ? [g.team_a_points, g.team_b_points] : [g.team_b_points, g.team_a_points];
            return `<li><span class="${ours > theirs ? 'pos' : 'neg'}">${ours > theirs ? 'W' : 'L'} ${ours}–${theirs}</span>
              <span class="muted">${formatDate(g.played_on)}</span> with ${esc(us.join(' & '))} vs ${esc(them.join(' & '))}${mine.idiot_points ? ` <span class="ip">${mine.idiot_points} IP</span>` : ''}</li>`;
          }).join('')}
        </ul>
      </section>`}`;

  el.querySelector('#pf-player').addEventListener('change', (e) => {
    state.playerId = Number(e.target.value);
    // Keep the address in step without adding a history entry.
    history.replaceState(null, '', `#players?p=${state.playerId}`);
    render(el, league);
  });
  for (const btn of el.querySelectorAll('[data-format]')) {
    btn.addEventListener('click', () => {
      state.format = Number(btn.dataset.format);
      render(el, league);
    });
  }
}

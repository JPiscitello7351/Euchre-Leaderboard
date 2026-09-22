import { leaderboard, rankedOnly, seasonFor } from '../stats.js';
import { rankedIn } from '../members.js';
import { esc, playerName, playerLink, num, signed, pct, int } from '../format.js';

// label, tooltip, value -> text. `lowIsGood` columns sort ascending first.
const COLUMNS = [
  { id: 'rank', label: '#', tip: 'Rank by win %. Only players who were members when the season ended are listed (for all time: current members).', fmt: int, lowIsGood: true },
  { id: 'name', label: 'Player', tip: 'All guests are combined into one Guest entry.' },
  { id: 'wins', label: 'W', tip: 'Wins', fmt: int },
  { id: 'losses', label: 'L', tip: 'Losses', fmt: int, lowIsGood: true },
  { id: 'winPct', label: 'Win %', tip: 'Wins ÷ games', fmt: pct },
  { id: 'gamesBehind', label: 'GB', tip: 'Games behind: straight wins needed to match the leader’s win %', fmt: (v) => num(v, 1), lowIsGood: true },
  { id: 'pointsFor', label: 'PF', tip: 'Points for (your team’s points)', fmt: int },
  { id: 'pointsAgainst', label: 'PA', tip: 'Points against', fmt: int, lowIsGood: true },
  { id: 'pointDiff', label: 'Diff', tip: 'Point differential (PF − PA)', fmt: (v) => signed(v, 0) },
  { id: 'avgPointDiff', label: 'Avg Diff', tip: 'Average point differential per game', fmt: signed },
  { id: 'ppg', label: 'PPG', tip: 'Points per game: your share of your team’s points (team points ÷ players per team)', fmt: num },
  { id: 'ppgPlusMinus', label: '+/− PPG', tip: 'PPG minus the league-average PPG', fmt: signed },
  { id: 'idiotPoints', label: 'IP', tip: 'Idiot points', fmt: int, lowIsGood: true },
  { id: 'idiotPpg', label: 'IPPG', tip: 'Idiot points per game', fmt: num, lowIsGood: true },
  { id: 'idiotPpgPlusMinus', label: '+/− IPPG', tip: 'IPPG minus the league-average IPPG', fmt: signed, lowIsGood: true },
  { id: 'avgSynergy', label: 'Synergy', tip: 'Average synergy: actual point differential minus expected, where expected = your team’s combined PPG minus the opponents’', fmt: signed },
  { id: 'avgExpectedDiff', label: 'Exp Diff', tip: 'Average expected point differential (from everyone’s PPG)', fmt: signed },
  { id: 'oppWinPct', label: 'OW%', tip: 'Opponents’ average win %', fmt: pct },
  { id: 'oppOppWinPct', label: 'OOW%', tip: 'Opponents’ opponents’ average win %', fmt: pct },
  { id: 'sos', label: 'SoS', tip: 'Strength of schedule: (2 × OW% + OOW%) ÷ 3', fmt: (v) => num(v, 3) },
  { id: 'sosRank', label: 'SoS Rk', tip: 'Strength of schedule rank (1 = toughest)', fmt: int, lowIsGood: true },
  { id: 'streak', label: 'Streak', tip: 'Current streak, and longest win / loss streaks' },
];

const state = { format: 4, seasonId: null, sort: null };

function streakText(r) {
  if (!r.currentStreak) return '–';
  const s = r.currentStreak;
  return `<span class="${s.won ? 'pos' : 'neg'}">${s.won ? 'W' : 'L'}${s.length}</span> <span class="muted">(${r.longestWinStreak}/${r.longestLossStreak})</span>`;
}

function defaultSeason(league) {
  const today = new Date().toISOString().slice(0, 10);
  const withGames = new Set(
    league.games.filter((g) => g.format === state.format).map((g) => seasonFor(g.played_on, league.seasons)?.id)
  );
  const current = seasonFor(today, league.seasons);
  if (current && withGames.has(current.id)) return current.id;
  const latest = [...league.seasons].reverse().find((s) => withGames.has(s.id));
  return latest?.id ?? 'all';
}

export function render(el, league) {
  state.seasonId ??= defaultSeason(league);
  const season = league.seasons.find((s) => s.id === state.seasonId);
  const games = league.games.filter(
    (g) => g.format === state.format && (!season || seasonFor(g.played_on, league.seasons)?.id === season.id)
  );
  const isRanked = rankedIn(league, season);
  let rows = rankedOnly(leaderboard(games, { isRanked })).map((r) => ({ ...r, name: playerName(league, r.key) }));

  if (state.sort) {
    const { id, dir } = state.sort;
    const val = (r) => (id === 'streak' ? (r.currentStreak ? (r.currentStreak.won ? 1 : -1) * r.currentStreak.length : 0) : r[id]);
    rows = [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });
  }

  const seasons = [...league.seasons].reverse();
  el.innerHTML = `
    <div class="toolbar">
      <label>Season
        <select id="lb-season">
          ${seasons.map((s) => `<option value="${s.id}" ${s.id === state.seasonId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          <option value="all" ${state.seasonId === 'all' ? 'selected' : ''}>All time</option>
        </select>
      </label>
      <div class="segmented" role="group" aria-label="Game format">
        ${[4, 6].map((f) => `<button type="button" data-format="${f}" aria-pressed="${state.format === f}">${f}-handed</button>`).join('')}
      </div>
      <span class="muted">${games.length} game${games.length === 1 ? '' : 's'}</span>
    </div>
    ${
      rows.length === 0
        ? `<p class="placeholder">No ${state.format}-handed games ${season ? `in ${esc(season.name)}` : ''} yet.</p>`
        : `<div class="table-wrap"><table class="stats">
            <thead><tr>${COLUMNS.map((c) => {
              const sorted = state.sort?.id === c.id ? (state.sort.dir === 1 ? 'ascending' : 'descending') : 'none';
              return `<th scope="col" title="${esc(c.tip)}" aria-sort="${sorted}" class="sortable${c.id === 'name' ? ' name-col' : ''}"><button type="button" data-sort="${c.id}">${esc(c.label)}</button></th>`;
            }).join('')}</tr></thead>
            <tbody>${rows.map((r) => `<tr>${COLUMNS.map((c) => {
              if (c.id === 'name') return `<th scope="row">${playerLink(league, r.key)}</th>`;
              if (c.id === 'streak') return `<td>${streakText(r)}</td>`;
              return `<td>${c.fmt(r[c.id])}</td>`;
            }).join('')}</tr>`).join('')}</tbody>
          </table></div>`
    }`;

  el.querySelector('#lb-season').addEventListener('change', (e) => {
    state.seasonId = e.target.value === 'all' ? 'all' : Number(e.target.value);
    render(el, league);
  });
  for (const btn of el.querySelectorAll('[data-format]')) {
    btn.addEventListener('click', () => {
      state.format = Number(btn.dataset.format);
      render(el, league);
    });
  }
  for (const btn of el.querySelectorAll('[data-sort]')) {
    btn.addEventListener('click', () => {
      const col = COLUMNS.find((c) => c.id === btn.dataset.sort);
      const first = col.lowIsGood || col.id === 'name' ? 1 : -1;
      // Click cycles: best-first, worst-first, back to default order.
      if (state.sort?.id !== col.id) state.sort = { id: col.id, dir: first };
      else if (state.sort.dir === first) state.sort = { id: col.id, dir: -first };
      else state.sort = null;
      render(el, league);
    });
  }
}

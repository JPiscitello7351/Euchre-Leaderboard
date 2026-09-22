import { pairStats, seasonFor, GUEST } from '../stats.js';
import { esc, playerName, num, signed, pct, int } from '../format.js';

// Each metric reads one cell. `kind` picks the table: partners (same team)
// or opponents (row player against column player). `neutral`/`spread` set
// the colour scale: green above neutral, red below (reversed if lowIsGood).
const METRICS = [
  { id: 'games', label: 'Games together', kind: 'partners', get: (s) => s.games, fmt: int },
  { id: 'wins', label: 'Wins together', kind: 'partners', get: (s) => s.wins, fmt: int },
  { id: 'winPct', label: 'Win % together', kind: 'partners', get: (s) => s.winPct, fmt: pct, neutral: 0.5, spread: 0.5 },
  { id: 'avgPointDiff', label: 'Avg point diff together', kind: 'partners', get: (s) => s.avgPointDiff, fmt: signed, neutral: 0, spread: 5 },
  { id: 'avgSynergy', label: 'Synergy together', kind: 'partners', get: (s) => s.avgSynergy, fmt: signed, neutral: 0, spread: 5,
    note: 'Average of (actual point diff − expected diff) in games together. Expected diff comes from everyone’s PPG.' },
  { id: 'idiotPoints', label: 'Idiot points together', kind: 'partners', get: (s) => s.idiotPoints, fmt: int, note: 'Both partners’ idiot points combined.' },
  { id: 'idiotPpg', label: 'Idiot PPG together', kind: 'partners', get: (s) => s.idiotPpg, fmt: num, neutral: 0, spread: 0.5, lowIsGood: true,
    note: 'Both partners’ idiot points per game together. The “All partners” row is each player’s overall figure.' },
  { id: 'winPctAgainst', label: 'Win % against', kind: 'opponents', get: (s) => s.winPct, fmt: pct, neutral: 0.5, spread: 0.5,
    note: 'Row player’s win % in games against the column player.' },
  { id: 'winPctAgainstVsOwn', label: 'Win % against vs own win %', kind: 'opponents', fmt: signed,
    get: (s, row, stats) => s.winPct - stats.winPct.get(row), neutral: 0, spread: 0.4,
    note: 'Row player’s win % against the column player, minus the row player’s overall win %.' },
];

const state = { format: 4, seasonId: 'all', metric: 'winPct' };

function heat(metric, v) {
  if (metric.neutral === undefined || v === null || Number.isNaN(v)) return '';
  let t = Math.max(-1, Math.min(1, (v - metric.neutral) / metric.spread));
  if (metric.lowIsGood) t = -t;
  const color = t >= 0 ? '46, 139, 73' : '192, 57, 43';
  return `background: rgba(${color}, ${(Math.abs(t) * 0.55).toFixed(2)})`;
}

export function render(el, league) {
  const season = league.seasons.find((s) => s.id === state.seasonId);
  const games = league.games.filter(
    (g) => g.format === state.format && (!season || seasonFor(g.played_on, league.seasons)?.id === season.id)
  );
  const metric = METRICS.find((m) => m.id === state.metric);
  const stats = games.length ? pairStats(games) : null;
  // Inactive players still count in everyone's numbers but get no row or
  // column. Order by win % so the grid reads like the leaderboard.
  const shown = (key) => key === GUEST || league.playerById.get(key)?.active !== false;
  const keys = stats ? stats.keys.filter(shown).sort((a, b) => stats.winPct.get(b) - stats.winPct.get(a)) : [];
  const table = stats?.[metric.kind];

  const cell = (row, col) => {
    if (row === col) return '<td class="self"></td>';
    const s = table.get(`${row}|${col}`);
    if (!s) return '<td class="muted">·</td>';
    const v = metric.get(s, row, stats);
    return `<td style="${heat(metric, v)}" title="${esc(playerName(league, row))} ${metric.kind === 'partners' ? '&amp;' : 'vs'} ${esc(playerName(league, col))}: ${s.games} game${s.games === 1 ? '' : 's'}">${metric.fmt(v)}</td>`;
  };

  // Spreadsheet's "Partners' AVG IPPG": all of a player's partnered idiot points ÷ partnered games.
  const allPartnersRow = () => {
    const cells = keys.map((col) => {
      let ip = 0;
      let n = 0;
      for (const row of keys) {
        const s = table.get(`${row}|${col}`);
        if (s) {
          ip += s.idiotPoints;
          n += s.games;
        }
      }
      return `<td>${n ? num(ip / n) : '–'}</td>`;
    });
    return `<tr class="summary"><th scope="row">All partners</th>${cells.join('')}</tr>`;
  };

  el.innerHTML = `
    <div class="toolbar">
      <label>Season
        <select id="syn-season">
          <option value="all">All time</option>
          ${[...league.seasons].reverse().map((s) => `<option value="${s.id}" ${s.id === state.seasonId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>
      </label>
      <label>Show
        <select id="syn-metric">
          ${METRICS.map((m) => `<option value="${m.id}" ${m.id === state.metric ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
        </select>
      </label>
      <div class="segmented" role="group" aria-label="Game format">
        ${[4, 6].map((f) => `<button type="button" data-format="${f}" aria-pressed="${state.format === f}">${f}-handed</button>`).join('')}
      </div>
    </div>
    <p class="muted">${metric.note ? `${esc(metric.note)} ` : ''}Inactive players are hidden.</p>
    ${
      !stats
        ? '<p class="placeholder">No games for this selection.</p>'
        : `<div class="table-wrap"><table class="stats matrix">
            <thead><tr><th scope="col" class="name-col">${metric.kind === 'partners' ? 'Partner →' : 'Opponent →'}</th>
              ${keys.map((k) => `<th scope="col">${esc(playerName(league, k))}</th>`).join('')}</tr></thead>
            <tbody>
              ${keys.map((row) => `<tr><th scope="row">${esc(playerName(league, row))}</th>${keys.map((col) => cell(row, col)).join('')}</tr>`).join('')}
              ${metric.id === 'idiotPpg' ? allPartnersRow() : ''}
            </tbody>
          </table></div>`
    }`;

  el.querySelector('#syn-season').addEventListener('change', (e) => {
    state.seasonId = e.target.value === 'all' ? 'all' : Number(e.target.value);
    render(el, league);
  });
  el.querySelector('#syn-metric').addEventListener('change', (e) => {
    state.metric = e.target.value;
    render(el, league);
  });
  for (const btn of el.querySelectorAll('[data-format]')) {
    btn.addEventListener('click', () => {
      state.format = Number(btn.dataset.format);
      render(el, league);
    });
  }
}

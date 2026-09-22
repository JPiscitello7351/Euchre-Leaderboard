import { supabase } from '../data.js';
import { prelimSchedule, finalsSchedule, balance, MIN_PLAYERS, MAX_PLAYERS } from '../schedule.js';
import { standings, prelimStandings } from '../tournament.js';
import { seasonFor } from '../stats.js';
import { esc, formatDate, playerName, tournamentTitle } from '../format.js';
import { isMemberOn } from '../members.js';

// Tournament Mode runs a tournament live:
//   setup  - pick date and players, preview the schedule (re-roll if wanted), start
//   run    - score each table round by round; standings update as results are saved;
//            once prelims are done, generate the finals tables from prelim standings
//
// The schedule is stored on the tournament row:
//   { version: 1, seed, players: [ids], prelim: { rounds }, finals: null | { groups, rounds } }
// and each table's result is its own game, found by (phase, round, seq).

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const state = {
  screen: null, // 'list' | 'setup' | 'run'
  tournamentId: null,
  setup: { date: today(), players: new Set(), preview: null, seed: null },
  roundRef: null, // 'prelim-3' etc.; null = first round with unsaved tables
  runView: 'round', // 'round' (large cards) | 'table' (every game)
  focus: false, // current round only, everything else hidden
  drafts: new Map(), // slot key -> unsaved inputs
  message: null,
  busy: false,
};

const isAppRun = (t) => Array.isArray(t.schedule?.prelim?.rounds);

// Focus mode shows only the current round. Where the browser allows it, it
// also goes truly fullscreen; leaving that (Esc, back gesture) leaves focus mode.
let rerenderLast = null;
function exitFocus() {
  state.focus = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && state.focus) {
    state.focus = false;
    rerenderLast?.();
  }
});
const slotKey = (phase, round, seq) => `${phase}-${round}-${seq}`;

// seq numbers every table of the day in play order: prelim tables first, then finals.
function seqFor(schedule, phase, round, table) {
  const prelimTables = schedule.prelim.rounds[0].tables.length;
  if (phase === 'prelim') return (round - 1) * prelimTables + table + 1;
  const finalTables = schedule.finals.groups.length;
  return schedule.prelim.rounds.length * prelimTables + (round - 1) * finalTables + table + 1;
}

function nextSeasonName(name) {
  const m = /^Q([1-4]) (\d{4})$/.exec(name ?? '');
  if (!m) return null;
  const q = Number(m[1]);
  return q === 4 ? `Q1 ${Number(m[2]) + 1}` : `Q${q + 1} ${m[2]}`;
}

function progress(league, t) {
  const games = league.games.filter((g) => g.tournament_id === t.id);
  const prelimSlots = t.schedule.prelim.rounds.reduce((n, r) => n + r.tables.length, 0);
  const finalSlots = t.schedule.finals ? t.schedule.finals.rounds.reduce((n, r) => n + r.tables.length, 0) : null;
  const prelimDone = games.filter((g) => g.tournament_phase === 'prelim').length;
  const finalDone = games.filter((g) => g.tournament_phase === 'final').length;
  return {
    games,
    prelimSlots, prelimDone, finalSlots, finalDone,
    prelimComplete: prelimDone === prelimSlots,
    complete: finalSlots !== null && finalDone === finalSlots,
  };
}

export function render(el, league, { reload }) {
  const readOnly = league.source !== 'Supabase';
  const appRun = league.tournaments.filter(isAppRun).sort((a, b) => b.held_on.localeCompare(a.held_on));
  if (!state.screen) {
    const open = appRun.find((t) => !progress(league, t).complete);
    if (open) {
      state.screen = 'run';
      state.tournamentId = open.id;
    } else {
      state.screen = 'list';
    }
  }
  const shown = state.message;
  state.message = null;
  const banner = `${shown ? `<p class="${shown.ok ? 'notice' : 'error'}" role="status">${esc(shown.text)}</p>` : ''}${
    readOnly ? `<p class="notice">Viewing ${esc(league.source)}: tournaments can’t be saved here.</p>` : ''}`;
  const ctx = { el, league, reload, readOnly, banner };

  document.body.classList.remove('tm-focus');
  if (state.screen === 'setup') return renderSetup(ctx);
  const t = league.tournaments.find((x) => x.id === state.tournamentId);
  if (state.screen === 'run' && t && isAppRun(t)) return renderRun(ctx, t);
  return renderList(ctx, appRun);
}

function rerenderFn(ctx) {
  return () => render(ctx.el, ctx.league, { reload: ctx.reload });
}

// Runs a database call, shows its error or success message, and reloads.
async function act(ctx, fn) {
  state.busy = true;
  try {
    state.message = { ok: true, text: await fn() };
    state.busy = false;
    await ctx.reload();
  } catch (err) {
    state.busy = false;
    state.message = { ok: false, text: err.message };
    rerenderFn(ctx)();
  }
}
const check = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

// ---------------------------------------------------------------- list

function renderList({ el, league, readOnly, banner, ...ctx }, appRun) {
  el.innerHTML = `
    ${banner}
    <div class="inline-form"><button type="button" class="primary" id="tm-new" ${readOnly ? 'disabled' : ''}>+ New tournament</button></div>
    ${appRun.length ? `<section class="panel"><h3>Tournaments run here</h3><ul class="recent">
      ${appRun.map((t) => {
        const p = progress(league, t);
        const status = p.complete ? 'Finished' : p.prelimComplete ? `Finals ${p.finalDone}/${p.finalSlots ?? '–'} games` : `Prelims ${p.prelimDone}/${p.prelimSlots} games`;
        return `<li><button type="button" class="link" data-open="${t.id}">${esc(tournamentTitle(league, t))}</button> <span class="muted">${formatDate(t.held_on)} · ${t.schedule.players.length} players · ${status}</span></li>`;
      }).join('')}
    </ul></section>` : '<p class="muted">No tournaments have been run in the app yet. Past tournaments are on the Tournament Results tab.</p>'}`;

  el.querySelector('#tm-new').addEventListener('click', () => {
    state.screen = 'setup';
    state.setup = { date: today(), players: new Set(), preview: null, seed: null };
    rerenderFn({ el, league, ...ctx })();
  });
  for (const btn of el.querySelectorAll('[data-open]')) {
    btn.addEventListener('click', () => {
      state.screen = 'run';
      state.tournamentId = Number(btn.dataset.open);
      state.roundRef = null;
      rerenderFn({ el, league, ...ctx })();
    });
  }
}

// ---------------------------------------------------------------- setup

function renderSetup(ctx) {
  const { el, league, readOnly, banner } = ctx;
  const s = state.setup;
  const active = league.players.filter((p) => isMemberOn(p, s.date)).sort((a, b) => a.name.localeCompare(b.name));
  const n = s.players.size;
  const countOk = n >= MIN_PLAYERS && n <= MAX_PLAYERS;
  const season = seasonFor(s.date, league.seasons);
  const clash = league.tournaments.find((t) => t.held_on === s.date);
  const preview = s.preview;
  const bal = preview ? balance(preview) : null;
  const range = ([lo, hi]) => (lo === hi ? `${lo}` : `${lo}–${hi}`);

  el.innerHTML = `
    ${banner}
    <section class="panel">
      <h3>1. Date and players</h3>
      <div class="inline-form">
        <label>Date <input type="date" id="tm-date" value="${s.date}"></label>
        <span class="muted">${season ? `${esc(season.name)} Tournament` : 'This date is before the first season.'}</span>
      </div>
      ${clash ? `<p class="error">There’s already a tournament on ${formatDate(s.date)}.</p>` : ''}
      <p class="muted">Pick ${MIN_PLAYERS}–${MAX_PLAYERS} players. <strong>${n} selected.</strong></p>
      <div class="player-picks">
        ${active.map((p) => `<label class="pick"><input type="checkbox" value="${p.id}" ${s.players.has(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}
      </div>
      <div class="inline-form">
        <button type="button" id="tm-generate" class="primary" ${countOk && !clash && season ? '' : 'disabled'}>${preview ? 'Re-roll schedule' : 'Generate schedule'}</button>
        <button type="button" id="tm-cancel">Cancel</button>
      </div>
    </section>
    ${preview ? `
      <section class="panel">
        <h3>2. Schedule preview</h3>
        <p>${preview.rounds.length} prelim rounds, then 3 finals rounds.
          Everyone partners everyone ${bal.partners[1] === 1 ? 'exactly once' : 'at least once'}; opponents faced ${range(bal.opponents)} times;
          ${bal.sitOuts[1] ? `sit-outs ${range(bal.sitOuts)} each` : 'nobody sits out'}.</p>
        ${scheduleTable(league, preview.rounds)}
        <div class="inline-form">
          <button type="button" id="tm-start" class="primary" ${readOnly || state.busy ? 'disabled' : ''}>Start tournament</button>
        </div>
      </section>` : ''}`;

  const rerender = rerenderFn(ctx);
  el.querySelector('#tm-date').addEventListener('change', (e) => {
    if (!e.target.value) return;
    s.date = e.target.value;
    // Drop anyone who isn't a member on the new date.
    for (const id of s.players) if (!isMemberOn(league.playerById.get(id), s.date)) s.players.delete(id);
    s.preview = null;
    rerender();
  });
  for (const box of el.querySelectorAll('.player-picks input')) {
    box.addEventListener('change', () => {
      if (box.checked) s.players.add(Number(box.value));
      else s.players.delete(Number(box.value));
      s.preview = null; // player list changed; schedule must be regenerated
      rerender();
    });
  }
  el.querySelector('#tm-generate').addEventListener('click', (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Generating…';
    // Let the button repaint before the (up to ~1s) search runs.
    setTimeout(() => {
      s.seed = Math.floor(Math.random() * 2 ** 31);
      s.preview = prelimSchedule([...s.players], { seed: s.seed });
      rerender();
    }, 30);
  });
  el.querySelector('#tm-cancel').addEventListener('click', () => {
    state.screen = 'list';
    rerender();
  });
  el.querySelector('#tm-start')?.addEventListener('click', () =>
    act(ctx, async () => {
      const schedule = { version: 1, seed: s.seed, players: preview.players, prelim: { rounds: preview.rounds }, finals: null };
      const id = check(await supabase.rpc('create_tournament', {
        p_held_on: s.date,
        p_schedule: schedule,
        p_next_season: nextSeasonName(season?.name),
      }));
      state.screen = 'run';
      state.tournamentId = id;
      state.roundRef = null;
      return `${season.name} Tournament started. Good luck!`;
    })
  );
}

function scheduleTable(league, rounds) {
  const team = (ids) => ids.map((id) => esc(playerName(league, id))).join(' & ');
  return `<div class="table-wrap"><table class="stats compact schedule">
    <thead><tr><th scope="col">Round</th>${rounds[0].tables.map((_, i) => `<th scope="col">Table ${i + 1}</th>`).join('')}${rounds[0].sitting.length ? '<th scope="col">Sitting out</th>' : ''}</tr></thead>
    <tbody>${rounds.map((r, i) => `<tr><td>${i + 1}</td>${r.tables.map(([a, b]) => `<td>${team(a)} <span class="muted">vs</span> ${team(b)}</td>`).join('')}${r.sitting.length ? `<td class="muted">${r.sitting.map((id) => esc(playerName(league, id))).join(', ')}</td>` : ''}</tr>`).join('')}</tbody>
  </table></div>`;
}

// ---------------------------------------------------------------- run

// Every scheduled table in play order: prelim rounds, then finals.
function allSlots(schedule) {
  const out = [];
  const add = (phase, rounds) =>
    rounds.forEach((r, ri) =>
      r.tables.forEach((table, ti) => {
        const seq = seqFor(schedule, phase, ri + 1, ti);
        out.push({ phase, round: ri + 1, tableIdx: ti, seq, table, sitting: r.sitting, key: slotKey(phase, ri + 1, seq), ref: `${phase}-${ri + 1}` });
      })
    );
  add('prelim', schedule.prelim.rounds);
  if (schedule.finals) add('final', schedule.finals.rounds);
  return out;
}

const roundLabel = (slot) => `${slot.phase === 'final' ? 'Finals' : 'Prelims'} round ${slot.round}`;

function renderRun(ctx, t) {
  const { el, league, readOnly, banner } = ctx;
  const schedule = t.schedule;
  const p = progress(league, t);
  const saved = new Map(p.games.map((g) => [slotKey(g.tournament_phase, g.tournament_round, g.seq), g]));
  const slots = allSlots(schedule);
  const slotByKey = new Map(slots.map((sl) => [sl.key, sl]));
  const rounds = [...new Set(slots.map((sl) => sl.ref))].map((ref) => slots.filter((sl) => sl.ref === ref));
  const roundDone = (round) => round.every((sl) => saved.has(sl.key));
  if (!rounds.some((r) => r[0].ref === state.roundRef)) state.roundRef = null;
  const current = rounds.find((r) => r[0].ref === state.roundRef) ?? rounds.find((r) => !roundDone(r)) ?? rounds[rounds.length - 1];
  const currentIdx = rounds.indexOf(current);
  const rows = standings(p.games);
  const finalsStarted = p.games.some((g) => g.tournament_phase === 'final');
  const draftOf = (sl) => state.drafts.get(sl.key) ?? fromGame(saved.get(sl.key), sl.table);
  const name = (id) => esc(playerName(league, id));
  const dirtyValid = slots.filter((sl) => state.drafts.has(sl.key) && !tableProblems(state.drafts.get(sl.key)).length);

  // Inputs shared by both views.
  const numInput = (sl, field, value, label, max, team, idx, cls = '') =>
    `<input type="number" class="num ${cls}" min="0" max="${max}" data-slot="${sl.key}" data-field="${field}"${
      team ? ` data-team="${team}" data-idx="${idx}"` : ''} value="${value}" aria-label="${esc(label)}" ${readOnly ? 'disabled' : ''}>`;
  const status = (sl) =>
    state.drafts.has(sl.key) ? '<span class="status unsaved">unsaved</span>' : saved.has(sl.key) ? '<span class="status saved">✓ saved</span>' : '';
  const buttons = (sl) => {
    const canSave = !readOnly && !state.busy && state.drafts.has(sl.key) && !tableProblems(draftOf(sl)).length;
    return `${saved.has(sl.key) ? `<button type="button" data-clear="${sl.key}" ${readOnly ? 'disabled' : ''}>Clear</button>` : ''}
      <button type="button" class="primary" data-save="${sl.key}" ${canSave ? '' : 'disabled'}>Save</button>`;
  };
  const teamNames = (ids) => ids.map((id) => playerName(league, id)).join(' and ');

  // ---- Current round: large cards, one per table
  const card = (sl) => {
    const d = draftOf(sl);
    const problems = state.drafts.has(sl.key) ? tableProblems(d) : [];
    const team = (tk, ids) => `<div class="card-team">
      ${ids.map((id, idx) => `<div class="card-player">
        <span class="card-name">${name(id)}</span>
        <label>Alone ${numInput(sl, 'alone_wins', d.seats[tk][idx].alone_wins, `${playerName(league, id)} alone wins`, 20, tk, idx)}</label>
        <label>IP ${numInput(sl, 'idiot_points', d.seats[tk][idx].idiot_points, `${playerName(league, id)} idiot points`, 20, tk, idx)}</label>
      </div>`).join('')}
      <div class="card-score">
        <label>Score ${numInput(sl, `points_${tk}`, d[`points_${tk}`], `${teamNames(ids)} score`, 13, null, null, 'score')}</label>
        <label>Sets ${numInput(sl, `sets_${tk}`, d[`sets_${tk}`], `${teamNames(ids)} sets`, 20)}</label>
      </div>
    </div>`;
    return `<li class="round-card ${problems.length ? 'has-problems' : ''}">
      <div class="round-card-head"><span class="table-no">Table ${sl.tableIdx + 1}</span>${status(sl)}<span class="spacer"></span>${buttons(sl)}</div>
      <div class="card-teams">${team('A', sl.table[0])}<div class="card-vs">vs</div>${team('B', sl.table[1])}</div>
      ${problems.length ? `<ul class="problems">${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    </li>`;
  };
  const roundView = `
    <div class="round-nav">
      <button type="button" data-nav="-1" ${currentIdx === 0 ? 'disabled' : ''} aria-label="Previous round">←</button>
      <div class="round-title"><strong>${roundLabel(current[0])}</strong>
        <span class="muted">${current.filter((sl) => saved.has(sl.key)).length}/${current.length} tables saved</span></div>
      <button type="button" data-nav="1" ${currentIdx === rounds.length - 1 ? 'disabled' : ''} aria-label="Next round">→</button>
    </div>
    <div class="round-pills" role="group" aria-label="Jump to round">
      ${rounds.map((r) => `<button type="button" data-ref="${r[0].ref}" aria-pressed="${r === current}" class="${roundDone(r) ? 'done' : ''}">${r[0].phase === 'final' ? 'F' : ''}${r[0].round}${roundDone(r) ? ' ✓' : ''}</button>`).join('')}
    </div>
    ${current[0].sitting.length ? `<p class="muted">Sitting out: ${current[0].sitting.map(name).join(', ')}</p>` : ''}
    <ol class="round-cards">${current.map(card).join('')}</ol>`;

  // ---- All games: one editable row per scheduled table
  const teamHeader = (tk) => [1, 2].map((i) => `<th scope="col">${tk}${i}</th><th scope="col" title="Alone wins">Alone</th><th scope="col" title="Idiot points">IP</th>`).join('');
  const tableRow = (sl, first) => {
    const d = draftOf(sl);
    const problems = state.drafts.has(sl.key) ? tableProblems(d) : [];
    const where = `${roundLabel(sl)} table ${sl.tableIdx + 1}`;
    const teamCells = (tk, ids) => ids.map((id, idx) => `<td class="name-cell">${name(id)}</td>
      <td>${numInput(sl, 'alone_wins', d.seats[tk][idx].alone_wins, `${where} ${playerName(league, id)} alone wins`, 20, tk, idx)}</td>
      <td>${numInput(sl, 'idiot_points', d.seats[tk][idx].idiot_points, `${where} ${playerName(league, id)} idiot points`, 20, tk, idx)}</td>`).join('');
    const scoreCells = (tk) => `<td class="score-cell">${numInput(sl, `points_${tk}`, d[`points_${tk}`], `${where} team ${tk} score`, 13, null, null, 'score')}</td>
      <td>${numInput(sl, `sets_${tk}`, d[`sets_${tk}`], `${where} team ${tk} sets`, 20)}</td>`;
    return `<tr class="${first ? 'night-start' : ''} ${problems.length ? 'has-problems' : ''}">
      <th scope="row">${first ? (sl.phase === 'final' ? 'Finals R' : 'Prelims R') + sl.round : ''}</th>
      <td>${sl.tableIdx + 1}</td>
      ${teamCells('A', sl.table[0])}${scoreCells('A')}${scoreCells('B')}${teamCells('B', sl.table[1])}
      <td class="row-actions">${status(sl)} ${buttons(sl)}</td>
    </tr>
    ${problems.length ? `<tr class="problem-row"><td colspan="19">${esc(where)}: ${problems.map(esc).join(' ')}</td></tr>` : ''}`;
  };
  const tableView = `
    <div class="table-wrap"><table class="stats grid-input tm-grid">
      <thead><tr><th scope="col">Round</th><th scope="col">Tbl</th>${teamHeader('A')}<th scope="col" class="c">A</th><th scope="col" title="Team A sets">Sets</th><th scope="col" class="c">B</th><th scope="col" title="Team B sets">Sets</th>${teamHeader('B')}<th scope="col"><span class="visually-hidden">Save</span></th></tr></thead>
      <tbody>${rounds.map((r) => r.map((sl, i) => tableRow(sl, i === 0)).join('')).join('')}</tbody>
    </table></div>
    <div class="inline-form">
      <button type="button" class="primary" id="tm-save-all" ${readOnly || state.busy || !dirtyValid.length ? 'disabled' : ''}>Save all changes${dirtyValid.length ? ` (${dirtyValid.length})` : ''}</button>
      ${state.drafts.size ? '<button type="button" id="tm-discard">Discard changes</button>' : ''}
    </div>`;

  const champion = p.complete ? rows[0] : null;
  const focus = state.focus && state.runView === 'round';
  document.body.classList.toggle('tm-focus', focus);
  if (focus) {
    el.innerHTML = `
    ${banner}
    <div class="focus-bar">
      <strong>${esc(tournamentTitle(league, t))}</strong>
      <span class="spacer"></span>
      <button type="button" id="tm-refresh" title="Load results saved from other phones">Refresh</button>
      <button type="button" class="primary" id="tm-exit-focus">Exit fullscreen</button>
    </div>
    ${roundView}`;
  } else el.innerHTML = `
    ${banner}
    <div class="toolbar">
      <button type="button" id="tm-back">← All tournaments</button>
      <strong>${esc(tournamentTitle(league, t))}</strong>
      <span class="muted">${formatDate(t.held_on)} · ${schedule.players.length} players · prelims ${p.prelimDone}/${p.prelimSlots}${schedule.finals ? ` · finals ${p.finalDone}/${p.finalSlots}` : ''}</span>
      <span class="spacer"></span>
      <button type="button" id="tm-refresh" title="Load results saved from other phones">Refresh</button>
    </div>
    ${champion ? `<div class="stat-cards"><div class="stat-card champion"><div class="label">Champion</div><div class="value">🏆 ${name(champion.key)}</div><div class="sub">${champion.total} points · full results on the Tournament Results tab</div></div></div>` : ''}
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="View">
        <button type="button" data-view="round" aria-pressed="${state.runView === 'round'}">Current round</button>
        <button type="button" data-view="table" aria-pressed="${state.runView === 'table'}">All games</button>
      </div>
      ${state.runView === 'round' ? '<button type="button" id="tm-fullscreen" title="Show only the current round">⛶ Fullscreen</button>' : ''}
    </div>

    ${state.runView === 'table' ? tableView : roundView}

    ${p.prelimComplete && !finalsStarted ? `<section class="panel">
      <h3>${schedule.finals ? 'Finals tables' : 'Prelims complete'}</h3>
      <p class="muted">Finals tables come from the prelim standings: top 4, next 4${schedule.players.length % 4 ? ', and anyone left over sits out' : ''}. Points keep adding up from the prelims.</p>
      ${schedule.finals ? finalsGroups(league, schedule.finals) : ''}
      <button type="button" class="primary" id="tm-finals" ${readOnly || state.busy ? 'disabled' : ''}>${schedule.finals ? 'Regenerate finals from current standings' : 'Generate finals'}</button>
    </section>` : ''}

    <section class="panel">
      <h3>Standings</h3>
      <div class="table-wrap"><table class="stats compact">
        <thead><tr><th scope="col">#</th><th scope="col" class="name-col">Player</th><th scope="col">Total</th><th scope="col">W–L</th><th scope="col">Points</th><th scope="col">Sets</th><th scope="col">Alone</th><th scope="col">IP</th></tr></thead>
        <tbody>${rows.length ? rows.map((r) => `<tr><td>${r.place}</td><th scope="row">${name(r.key)}</th><td><strong>${r.total}</strong></td><td>${r.wins}–${r.losses}</td><td>${r.gamePoints}</td><td>${r.sets}</td><td>${r.aloneWins}</td><td>${r.idiotPoints}</td></tr>`).join('') : '<tr><td colspan="8" class="muted">No results saved yet.</td></tr>'}</tbody>
      </table></div>
    </section>

    <details class="danger-zone panel">
      <summary>Schedule and tournament options</summary>
      ${scheduleTable(league, schedule.prelim.rounds)}
      <p class="muted">A tournament can be deleted only while it has no saved results.</p>
      <button type="button" id="tm-delete" ${readOnly || p.games.length ? 'disabled' : ''}>Delete tournament</button>
    </details>`;

  const rerender = rerenderFn(ctx);
  rerenderLast = rerender;
  const saveSlot = async (sl) => {
    const d = draftOf(sl);
    check(await supabase.rpc('save_tournament_game', {
      p_tournament_id: t.id,
      p_game: {
        phase: sl.phase,
        round: sl.round,
        seq: sl.seq,
        team_a_points: d.points_A,
        team_b_points: d.points_B,
        team_a_sets: d.sets_A,
        team_b_sets: d.sets_B,
        players: ['A', 'B'].flatMap((tk, ti) => sl.table[ti].map((id, idx) => ({
          team: tk, seat: idx + 1, player_id: id,
          idiot_points: d.seats[tk][idx].idiot_points,
          alone_wins: d.seats[tk][idx].alone_wins,
        }))),
      },
    }));
    state.drafts.delete(sl.key);
  };

  el.querySelector('#tm-back')?.addEventListener('click', () => {
    state.screen = 'list';
    rerender();
  });
  el.querySelector('#tm-fullscreen')?.addEventListener('click', () => {
    state.focus = true;
    document.documentElement.requestFullscreen?.().catch(() => {});
    rerender();
    window.scrollTo(0, 0);
  });
  el.querySelector('#tm-exit-focus')?.addEventListener('click', () => {
    exitFocus();
    rerender();
  });
  el.querySelector('#tm-refresh').addEventListener('click', () => ctx.reload());
  for (const btn of el.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => {
      state.runView = btn.dataset.view;
      rerender();
    });
  }
  for (const btn of el.querySelectorAll('[data-nav]')) {
    btn.addEventListener('click', () => {
      state.roundRef = rounds[currentIdx + Number(btn.dataset.nav)][0].ref;
      rerender();
    });
  }
  for (const btn of el.querySelectorAll('[data-ref]')) {
    btn.addEventListener('click', () => {
      state.roundRef = btn.dataset.ref;
      rerender();
    });
  }
  for (const input of el.querySelectorAll('input[data-slot]')) {
    input.addEventListener('change', () => {
      const sl = slotByKey.get(input.dataset.slot);
      const draft = draftOf(sl);
      const value = input.value === '' ? '' : Number(input.value);
      if (input.dataset.team) draft.seats[input.dataset.team][Number(input.dataset.idx)][input.dataset.field] = value === '' ? 0 : value;
      else draft[input.dataset.field] = value;
      state.drafts.set(sl.key, draft);
      rerender();
    });
  }
  for (const btn of el.querySelectorAll('[data-save]')) {
    btn.addEventListener('click', () => {
      const sl = slotByKey.get(btn.dataset.save);
      act(ctx, async () => {
        await saveSlot(sl);
        // Finishing the round being viewed moves on to the next unfinished one.
        const round = rounds.find((r) => r[0].ref === sl.ref);
        if (state.runView === 'round' && round.every((x) => x === sl || saved.has(x.key))) state.roundRef = null;
        return `Saved ${roundLabel(sl)}, table ${sl.tableIdx + 1}.`;
      });
    });
  }
  el.querySelector('#tm-save-all')?.addEventListener('click', () =>
    act(ctx, async () => {
      for (const sl of dirtyValid) await saveSlot(sl);
      return `Saved ${dirtyValid.length} game${dirtyValid.length === 1 ? '' : 's'}.`;
    })
  );
  el.querySelector('#tm-discard')?.addEventListener('click', () => {
    if (!confirm('Discard all unsaved changes?')) return;
    state.drafts.clear();
    rerender();
  });
  for (const btn of el.querySelectorAll('[data-clear]')) {
    btn.addEventListener('click', () => {
      if (!confirm('Clear this table’s saved result?')) return;
      const sl = slotByKey.get(btn.dataset.clear);
      act(ctx, async () => {
        check(await supabase.rpc('clear_tournament_game', { p_tournament_id: t.id, p_phase: sl.phase, p_round: sl.round, p_seq: sl.seq }));
        state.drafts.delete(sl.key);
        return `Cleared ${roundLabel(sl)}, table ${sl.tableIdx + 1}.`;
      });
    });
  }
  el.querySelector('#tm-finals')?.addEventListener('click', () =>
    act(ctx, async () => {
      const ranked = prelimStandings(p.games).map((r) => r.key);
      check(await supabase.from('tournaments').update({ schedule: { ...schedule, finals: finalsSchedule(ranked) } }).eq('id', t.id));
      state.roundRef = 'final-1';
      return 'Finals tables set from the prelim standings.';
    })
  );
  el.querySelector('#tm-delete')?.addEventListener('click', () => {
    if (!confirm(`Delete ${tournamentTitle(league, t)}?`)) return;
    act(ctx, async () => {
      check(await supabase.rpc('delete_tournament', { p_tournament_id: t.id }));
      state.screen = 'list';
      return 'Tournament deleted.';
    });
  });
}

function finalsGroups(league, finals) {
  return `<ol class="finals-groups">${finals.groups.map((g, i) => `<li><strong>Table ${i + 1}:</strong> ${g.map((id) => esc(playerName(league, id))).join(', ')}</li>`).join('')}</ol>
    ${finals.rounds[0].sitting.length ? `<p class="muted">Sitting out the finals: ${finals.rounds[0].sitting.map((id) => esc(playerName(league, id))).join(', ')}</p>` : ''}`;
}

// Inputs for one table, from its saved game (or blank).
function fromGame(game, table) {
  const seats = { A: table[0].map(() => ({ alone_wins: 0, idiot_points: 0 })), B: table[1].map(() => ({ alone_wins: 0, idiot_points: 0 })) };
  if (!game) return { points_A: '', points_B: '', sets_A: 0, sets_B: 0, seats };
  for (const p of game.players) {
    const idx = table[p.team === 'A' ? 0 : 1].indexOf(p.player_id);
    if (idx >= 0) seats[p.team][idx] = { alone_wins: p.alone_wins, idiot_points: p.idiot_points };
  }
  return { points_A: game.team_a_points, points_B: game.team_b_points, sets_A: game.team_a_sets ?? 0, sets_B: game.team_b_sets ?? 0, seats };
}

function tableProblems(d) {
  const out = [];
  const a = d.points_A;
  const b = d.points_B;
  if (a === '' || b === '') out.push('Enter both scores.');
  else if (!(Math.max(a, b) >= 10 && Math.max(a, b) <= 13 && Math.min(a, b) <= 9)) out.push('One team must reach 10–13 and the other finish on 9 or less.');
  const counts = [d.sets_A, d.sets_B, ...['A', 'B'].flatMap((t) => d.seats[t].flatMap((s) => [s.alone_wins, s.idiot_points]))];
  if (counts.some((v) => !(v >= 0 && v <= 20))) out.push('Sets, alone wins and idiot points must be 0–20.');
  return out;
}

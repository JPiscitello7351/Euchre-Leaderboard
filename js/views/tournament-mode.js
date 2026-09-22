import { supabase } from '../data.js';
import { prelimSchedule, finalsSchedule, balance, MIN_PLAYERS, MAX_PLAYERS } from '../schedule.js';
import { standings, prelimStandings } from '../tournament.js';
import { seasonFor } from '../stats.js';
import { esc, formatDate, playerName, tournamentTitle } from '../format.js';

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
  phase: 'prelim',
  round: 1,
  drafts: new Map(), // slot key -> unsaved inputs
  message: null,
  busy: false,
};

const isAppRun = (t) => Array.isArray(t.schedule?.prelim?.rounds);
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
      state.phase = 'prelim';
      state.round = 1;
      rerenderFn({ el, league, ...ctx })();
    });
  }
}

// ---------------------------------------------------------------- setup

function renderSetup(ctx) {
  const { el, league, readOnly, banner } = ctx;
  const s = state.setup;
  const active = league.players.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name));
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
    if (e.target.value) s.date = e.target.value;
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
      state.phase = 'prelim';
      state.round = 1;
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

function renderRun(ctx, t) {
  const { el, league, readOnly, banner } = ctx;
  const schedule = t.schedule;
  const p = progress(league, t);
  const saved = new Map(p.games.map((g) => [slotKey(g.tournament_phase, g.tournament_round, g.seq), g]));
  if (state.phase === 'final' && !schedule.finals) state.phase = 'prelim';
  const phaseRounds = state.phase === 'final' ? schedule.finals.rounds : schedule.prelim.rounds;
  state.round = Math.min(Math.max(state.round, 1), phaseRounds.length);
  const round = phaseRounds[state.round - 1];
  const roundDone = (phase, r, rounds) => rounds[r - 1].tables.every((_, i) => saved.has(slotKey(phase, r, seqFor(schedule, phase, r, i))));
  const rows = standings(p.games);
  const finalsStarted = p.games.some((g) => g.tournament_phase === 'final');

  const tableCard = (table, i) => {
    const seq = seqFor(schedule, state.phase, state.round, i);
    const key = slotKey(state.phase, state.round, seq);
    const game = saved.get(key);
    const draft = state.drafts.get(key) ?? fromGame(game, table);
    const problems = tableProblems(draft);
    const seatRow = (team, idx, id) => {
      const s = draft.seats[team][idx];
      return `<div class="seat tm-seat"><span class="seat-name">${esc(playerName(league, id))}</span>
        <label class="ip-input" title="Hands won alone">Alone <input type="number" min="0" max="20" data-slot="${key}" data-team="${team}" data-idx="${idx}" data-field="alone_wins" value="${s.alone_wins}"></label>
        <label class="ip-input" title="Idiot points">IP <input type="number" min="0" max="20" data-slot="${key}" data-team="${team}" data-idx="${idx}" data-field="idiot_points" value="${s.idiot_points}"></label>
      </div>`;
    };
    const teamBlock = (team, ids) => `<fieldset class="team-input" aria-label="${ids.map((id) => esc(playerName(league, id))).join(' and ')}">
      ${ids.map((id, idx) => seatRow(team, idx, id)).join('')}
      <div class="inline-form">
        <label class="score-input">Score <input type="number" min="0" max="13" data-slot="${key}" data-field="points_${team}" value="${draft[`points_${team}`]}"></label>
        <label class="ip-input" title="Sets (euchres) this team got">Sets <input type="number" min="0" max="20" data-slot="${key}" data-field="sets_${team}" value="${draft[`sets_${team}`]}"></label>
      </div>
    </fieldset>`;
    return `<li class="game-input ${problems.length && state.drafts.has(key) ? 'has-problems' : ''}">
      <div class="game-input-head"><strong>Table ${i + 1}</strong>
        ${game ? '<span class="badge">saved</span>' : ''}${state.drafts.has(key) ? ' <span class="muted">unsaved changes</span>' : ''}
        <span class="spacer"></span>
        ${game ? `<button type="button" data-clear="${key}" ${readOnly ? 'disabled' : ''}>Clear</button>` : ''}
        <button type="button" class="primary" data-save="${key}" data-table="${i}" ${readOnly || problems.length || state.busy || (game && !state.drafts.has(key)) ? 'disabled' : ''}>${game ? 'Save changes' : 'Save'}</button>
      </div>
      <div class="teams-input">${teamBlock('A', table[0])}${teamBlock('B', table[1])}</div>
      ${problems.length && state.drafts.has(key) ? `<ul class="problems">${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    </li>`;
  };

  const champion = p.complete ? rows[0] : null;
  el.innerHTML = `
    ${banner}
    <div class="toolbar">
      <button type="button" id="tm-back">← All tournaments</button>
      <strong>${esc(tournamentTitle(league, t))}</strong>
      <span class="muted">${formatDate(t.held_on)} · ${schedule.players.length} players</span>
      <span class="spacer"></span>
      <button type="button" id="tm-refresh" title="Load results saved from other phones">Refresh</button>
    </div>
    ${champion ? `<div class="stat-cards"><div class="stat-card champion"><div class="label">Champion</div><div class="value">🏆 ${esc(playerName(league, champion.key))}</div><div class="sub">${champion.total} points · full results on the Tournament Results tab</div></div></div>` : ''}

    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Phase">
        <button type="button" data-phase="prelim" aria-pressed="${state.phase === 'prelim'}">Prelims (${p.prelimDone}/${p.prelimSlots})</button>
        <button type="button" data-phase="final" aria-pressed="${state.phase === 'final'}" ${schedule.finals ? '' : 'disabled'}>Finals${schedule.finals ? ` (${p.finalDone}/${p.finalSlots})` : ''}</button>
      </div>
    </div>
    <div class="round-pills" role="group" aria-label="Round">
      ${phaseRounds.map((_, i) => `<button type="button" data-round="${i + 1}" aria-pressed="${state.round === i + 1}" class="${roundDone(state.phase, i + 1, phaseRounds) ? 'done' : ''}">${i + 1}${roundDone(state.phase, i + 1, phaseRounds) ? ' ✓' : ''}</button>`).join('')}
    </div>

    <h3>${state.phase === 'final' ? 'Finals' : 'Prelims'} round ${state.round}</h3>
    ${round.sitting.length ? `<p class="muted">Sitting out: ${round.sitting.map((id) => esc(playerName(league, id))).join(', ')}</p>` : ''}
    <ol class="game-inputs">${round.tables.map(tableCard).join('')}</ol>

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
        <tbody>${rows.length ? rows.map((r) => `<tr><td>${r.place}</td><th scope="row">${esc(playerName(league, r.key))}</th><td><strong>${r.total}</strong></td><td>${r.wins}–${r.losses}</td><td>${r.gamePoints}</td><td>${r.sets}</td><td>${r.aloneWins}</td><td>${r.idiotPoints}</td></tr>`).join('') : '<tr><td colspan="8" class="muted">No results saved yet.</td></tr>'}</tbody>
      </table></div>
    </section>

    <details class="danger-zone panel">
      <summary>Schedule and tournament options</summary>
      ${scheduleTable(league, schedule.prelim.rounds)}
      <p class="muted">A tournament can be deleted only while it has no saved results.</p>
      <button type="button" id="tm-delete" ${readOnly || p.games.length ? 'disabled' : ''}>Delete tournament</button>
    </details>`;

  const rerender = rerenderFn(ctx);
  el.querySelector('#tm-back').addEventListener('click', () => {
    state.screen = 'list';
    rerender();
  });
  el.querySelector('#tm-refresh').addEventListener('click', () => ctx.reload());
  for (const btn of el.querySelectorAll('[data-phase]')) {
    btn.addEventListener('click', () => {
      state.phase = btn.dataset.phase;
      state.round = 1;
      rerender();
    });
  }
  for (const btn of el.querySelectorAll('[data-round]')) {
    btn.addEventListener('click', () => {
      state.round = Number(btn.dataset.round);
      rerender();
    });
  }
  for (const input of el.querySelectorAll('input[data-slot]')) {
    input.addEventListener('change', () => {
      const key = input.dataset.slot;
      const [phase, r, seq] = key.split('-');
      const tableIdx = round.tables.findIndex((_, i) => seqFor(schedule, phase, Number(r), i) === Number(seq));
      const draft = state.drafts.get(key) ?? fromGame(saved.get(key), round.tables[tableIdx]);
      const value = input.value === '' ? '' : Number(input.value);
      if (input.dataset.team) draft.seats[input.dataset.team][Number(input.dataset.idx)][input.dataset.field] = value === '' ? 0 : value;
      else draft[input.dataset.field] = value;
      state.drafts.set(key, draft);
      rerender();
    });
  }
  for (const btn of el.querySelectorAll('[data-save]')) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.save;
      const i = Number(btn.dataset.table);
      const table = round.tables[i];
      const draft = state.drafts.get(key) ?? fromGame(saved.get(key), table);
      act(ctx, async () => {
        check(await supabase.rpc('save_tournament_game', {
          p_tournament_id: t.id,
          p_game: {
            phase: state.phase,
            round: state.round,
            seq: seqFor(schedule, state.phase, state.round, i),
            team_a_points: draft.points_A,
            team_b_points: draft.points_B,
            team_a_sets: draft.sets_A,
            team_b_sets: draft.sets_B,
            players: ['A', 'B'].flatMap((team, ti) => table[ti].map((id, idx) => ({
              team, seat: idx + 1, player_id: id,
              idiot_points: draft.seats[team][idx].idiot_points,
              alone_wins: draft.seats[team][idx].alone_wins,
            }))),
          },
        }));
        state.drafts.delete(key);
        return `Saved table ${i + 1}, round ${state.round}.`;
      });
    });
  }
  for (const btn of el.querySelectorAll('[data-clear]')) {
    btn.addEventListener('click', () => {
      if (!confirm('Clear this table’s saved result?')) return;
      const key = btn.dataset.clear;
      const [phase, r, seq] = key.split('-');
      act(ctx, async () => {
        check(await supabase.rpc('clear_tournament_game', { p_tournament_id: t.id, p_phase: phase, p_round: Number(r), p_seq: Number(seq) }));
        state.drafts.delete(key);
        return 'Result cleared.';
      });
    });
  }
  el.querySelector('#tm-finals')?.addEventListener('click', () =>
    act(ctx, async () => {
      const ranked = prelimStandings(p.games).map((r) => r.key);
      check(await supabase.from('tournaments').update({ schedule: { ...schedule, finals: finalsSchedule(ranked) } }).eq('id', t.id));
      state.phase = 'final';
      state.round = 1;
      return 'Finals tables set from the prelim standings.';
    })
  );
  el.querySelector('#tm-delete').addEventListener('click', () => {
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

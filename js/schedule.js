// Tournament schedules.
//
// Prelims: every round seats as many tables of 4 as possible; the rest sit
// out. Tournaments have 8-12 players. With 8, 9 or 12 a perfect schedule
// is used (everyone partners everyone exactly once, opposes everyone
// exactly twice, sit-outs are equal). With 10 or 11 perfect balance is
// impossible, so a search makes partners, opponents and sit-outs as even
// as it can.
//
// Finals: prelim standings split players into tables of 4 (top 4, next 4,
// ...; anyone left over sits out). Each table plays the 3 ways of pairing
// 4 players, so everyone partners each tablemate once.
//
// A schedule is { players: [ids], rounds: [{ tables: [[[a, b], [c, d]], ...], sitting: [ids] }] }.

export const MIN_PLAYERS = 8;
export const MAX_PLAYERS = 12;
export const FINALS_ROUNDS = 3;

// Perfect schedules ("whist tournaments") for the player counts where one
// exists: every pair partners exactly once and opposes exactly twice, and
// sit-outs are equal. Each round lists seats in table order
// [a, b, c, d, ...] = a & b vs c & d; players not listed sit out.
// 8 and 9 were found by computer search; 12 is cyclic (players 0-10 shift
// by one each round, player 11 stays). All verified.
const cyclic = (base, mod, fixed = []) =>
  Array.from({ length: mod }, (_, r) => base.map((x) => (fixed.includes(x) ? x : (x + r) % mod)));
const PERFECT = {
  8: [[7, 4, 2, 3, 1, 5, 6, 0], [5, 4, 7, 1, 0, 2, 3, 6], [6, 5, 3, 4, 0, 1, 7, 2], [1, 4, 3, 0, 7, 5, 6, 2],
    [0, 7, 6, 4, 3, 5, 1, 2], [6, 1, 2, 4, 0, 5, 7, 3], [4, 0, 5, 2, 3, 1, 6, 7]],
  9: [[8, 6, 3, 1, 7, 4, 2, 5], [3, 7, 6, 5, 4, 0, 2, 8], [1, 7, 6, 4, 8, 3, 5, 0], [2, 7, 1, 8, 6, 0, 4, 5],
    [3, 5, 1, 2, 7, 6, 8, 0], [3, 4, 7, 8, 0, 2, 1, 6], [7, 0, 3, 2, 5, 1, 4, 8], [8, 5, 2, 6, 0, 3, 1, 4],
    [7, 5, 1, 0, 4, 2, 3, 6]],
  12: cyclic([11, 2, 0, 5, 1, 9, 7, 8, 10, 3, 4, 6], 11, [11]),
};

// Prelim rounds: the fewest that let everyone partner everyone once.
// 8 -> 7, 9 -> 9, 10 -> 12, 11 -> 14, 12 -> 11. With 10 or 11 players the
// seats don't divide evenly, so a few pairs partner twice and sit-outs
// differ by one.
export function prelimRounds(n) {
  const tables = Math.floor(n / 4);
  return Math.ceil((n * (n - 1)) / 2 / (2 * tables));
}

// Small seeded random generator so a schedule can be regenerated exactly.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// Round layout as a flat array of seats: [t0a0, t0a1, t0b0, t0b1, t1a0, ...,
// sitters...]. Seats 4k..4k+3 are table k (first two = one team).
function score(rounds, n) {
  const partner = new Int32Array(n * n);
  const opp = new Int32Array(n * n);
  const sits = new Int32Array(n);
  const tables = Math.floor(n / 4);
  for (const seats of rounds) {
    for (let t = 0; t < tables; t++) {
      const [a, b, c, d] = seats.slice(4 * t, 4 * t + 4);
      partner[a * n + b]++;
      partner[c * n + d]++;
      for (const x of [a, b]) for (const y of [c, d]) opp[Math.min(x, y) * n + Math.max(x, y)]++;
    }
    for (let i = 4 * tables; i < n; i++) sits[seats[i]]++;
  }
  let p2 = 0;
  let o2 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    s2 += sits[i] * sits[i];
    for (let j = i + 1; j < n; j++) {
      const p = partner[i * n + j] + partner[j * n + i];
      p2 += p * p;
      const o = opp[i * n + j];
      o2 += o * o;
    }
  }
  // Partners and sit-outs matter most; opponents are balanced after that.
  return 6 * p2 + 6 * s2 + o2;
}

export function balance(schedule) {
  const ids = schedule.players;
  const n = ids.length;
  const idx = new Map(ids.map((id, i) => [id, i]));
  const partner = new Map();
  const opp = new Map();
  const sits = new Map(ids.map((id) => [id, 0]));
  const key = (a, b) => (idx.get(a) < idx.get(b) ? `${a}|${b}` : `${b}|${a}`);
  for (const r of schedule.rounds) {
    for (const [t1, t2] of r.tables) {
      partner.set(key(...t1), (partner.get(key(...t1)) ?? 0) + 1);
      partner.set(key(...t2), (partner.get(key(...t2)) ?? 0) + 1);
      for (const x of t1) for (const y of t2) opp.set(key(x, y), (opp.get(key(x, y)) ?? 0) + 1);
    }
    for (const s of r.sitting) sits.set(s, sits.get(s) + 1);
  }
  const range = (map) => {
    const vals = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) vals.push(map.get(key(ids[i], ids[j])) ?? 0);
    return [Math.min(...vals), Math.max(...vals)];
  };
  const sitVals = [...sits.values()];
  return {
    partners: range(partner),
    opponents: range(opp),
    sitOuts: [Math.min(...sitVals), Math.max(...sitVals)],
  };
}

// Simulated annealing over seat swaps within a round.
export function prelimSchedule(playerIds, { seed = Date.now(), iterations = 400000 } = {}) {
  const n = playerIds.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(`Tournaments need ${MIN_PLAYERS}–${MAX_PLAYERS} players.`);
  const rounds = prelimRounds(n);
  const rand = rng(seed);
  const shuffled = () => {
    const a = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const tables = Math.floor(n / 4);
  if (PERFECT[n]) return fromDesign(playerIds, PERFECT[n], rand);

  let best = null;
  let bestScore = Infinity;
  const restarts = 4;
  for (let restart = 0; restart < restarts; restart++) {
    // Start with sit-outs rotating evenly, everything else random.
    const state = Array.from({ length: rounds }, shuffled);
    let current = score(state, n);
    const steps = iterations / restarts;
    for (let step = 0; step < steps; step++) {
      const temp = 3 * (1 - step / steps) + 0.01;
      const seats = state[Math.floor(rand() * rounds)];
      // Two kinds of move: swap two seats, or (with 2+ tables) swap a whole
      // team between tables, which changes opponents but keeps partners.
      let swaps;
      if (tables > 1 && rand() < 0.5) {
        const t1 = Math.floor(rand() * tables);
        let t2 = Math.floor(rand() * (tables - 1));
        if (t2 >= t1) t2++;
        const a = 4 * t1 + 2 * Math.floor(rand() * 2);
        const b = 4 * t2 + 2 * Math.floor(rand() * 2);
        swaps = [[a, b], [a + 1, b + 1]];
      } else {
        const i = Math.floor(rand() * n);
        let j = Math.floor(rand() * (n - 1));
        if (j >= i) j++;
        swaps = [[i, j]];
      }
      for (const [x, y] of swaps) [seats[x], seats[y]] = [seats[y], seats[x]];
      const next = score(state, n);
      if (next <= current || rand() < Math.exp((current - next) / temp)) {
        current = next;
        if (current < bestScore) {
          bestScore = current;
          best = state.map((s) => [...s]);
        }
      } else {
        for (const [x, y] of swaps.reverse()) [seats[x], seats[y]] = [seats[y], seats[x]];
      }
    }
  }

  return {
    players: [...playerIds],
    rounds: best.map((seats) => ({
      tables: Array.from({ length: tables }, (_, t) => [
        [playerIds[seats[4 * t]], playerIds[seats[4 * t + 1]]],
        [playerIds[seats[4 * t + 2]], playerIds[seats[4 * t + 3]]],
      ]),
      sitting: seats.slice(4 * tables).map((i) => playerIds[i]),
    })),
  };
}

// A perfect design with players randomly assigned to its slots and the
// rounds and tables in random order, so each tournament looks different.
function fromDesign(playerIds, design, rand) {
  const n = playerIds.length;
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const slot = shuffle([...playerIds]);
  return {
    players: [...playerIds],
    rounds: shuffle(design.map((seats) => [...seats])).map((seats) => {
      const tables = [];
      for (let t = 0; t < seats.length; t += 4) {
        tables.push([[slot[seats[t]], slot[seats[t + 1]]], [slot[seats[t + 2]], slot[seats[t + 3]]]]);
      }
      const playing = new Set(seats);
      return {
        tables: shuffle(tables),
        sitting: [...Array(n).keys()].filter((i) => !playing.has(i)).map((i) => slot[i]),
      };
    }),
  };
}

// rankedIds: players in prelim-standings order.
export function finalsSchedule(rankedIds) {
  const groups = [];
  for (let i = 0; i + 4 <= rankedIds.length; i += 4) groups.push(rankedIds.slice(i, i + 4));
  const sitting = rankedIds.slice(groups.length * 4);
  return {
    groups,
    rounds: [
      [[0, 1], [2, 3]],
      [[0, 2], [1, 3]],
      [[0, 3], [1, 2]],
    ].map(([t1, t2]) => ({
      tables: groups.map((g) => [t1.map((i) => g[i]), t2.map((i) => g[i])]),
      sitting,
    })),
  };
}

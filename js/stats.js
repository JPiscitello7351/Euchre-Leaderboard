// League statistics, calculated from raw games. Formulas mirror the league
// spreadsheets (Players / Synergy / Model tabs) so numbers line up with what
// the league is used to.
//
// A game looks like the database / backup format:
//   { id, played_on, format, seq, team_a_points, team_b_points, ...,
//     players: [{ team: 'A'|'B', seat, player_id, guest_name, idiot_points, alone_wins }] }
// All guests are pooled into a single "Guest" entry, keyed GUEST.

export const GUEST = 'guest';

const keyOf = (seat) => seat.player_id ?? GUEST;

export function sortGames(games) {
  return [...games].sort(
    (a, b) =>
      a.played_on.localeCompare(b.played_on) || a.format - b.format || a.seq - b.seq || a.id - b.id
  );
}

// The season a date falls in: the latest season starting on or before it.
export function seasonFor(date, seasons) {
  let found = null;
  for (const s of seasons) {
    if (s.starts_on <= date && (!found || s.starts_on > found.starts_on)) found = s;
  }
  return found;
}

// Per-game view: each team's keys, points and the point differential from
// that team's side.
function sides(game) {
  const a = game.players.filter((p) => p.team === 'A');
  const b = game.players.filter((p) => p.team === 'B');
  const diff = game.team_a_points - game.team_b_points;
  return [
    { seats: a, mates: a.map(keyOf), opps: b.map(keyOf), pts: game.team_a_points, against: game.team_b_points, diff },
    { seats: b, mates: b.map(keyOf), opps: a.map(keyOf), pts: game.team_b_points, against: game.team_a_points, diff: -diff },
  ];
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// Leaderboard rows for one format's games (4- or 6-handed; don't mix).
// Row fields match the spreadsheet's Players tab. Players for whom
// isRanked(key) is false (e.g. inactive) are listed after the ranked ones
// with rank null, and don't count as the leader for "games behind".
export function leaderboard(games, { isRanked = () => true } = {}) {
  games = sortGames(games);
  const rows = new Map();
  const row = (key) => {
    if (!rows.has(key)) {
      rows.set(key, {
        key, games: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, idiotPoints: 0,
        diffs: [], expected: [], residuals: [], opponents: [], results: [],
      });
    }
    return rows.get(key);
  };

  for (const game of games) {
    for (const side of sides(game)) {
      const won = side.pts > side.against;
      for (const seat of side.seats) {
        const r = row(keyOf(seat));
        r.games += 1;
        r[won ? 'wins' : 'losses'] += 1;
        r.pointsFor += side.pts;
        r.pointsAgainst += side.against;
        r.idiotPoints += seat.idiot_points;
        r.diffs.push(side.diff);
        r.opponents.push(...side.opps);
        r.results.push(won);
      }
    }
  }

  // PPG is a player's share of their team's points: team points per game
  // divided by players per team.
  for (const r of rows.values()) {
    const perTeam = games.find((g) => g.players.some((p) => keyOf(p) === r.key)).format / 2;
    r.ppg = r.pointsFor / r.games / perTeam;
    r.winPct = r.wins / r.games;
  }

  // Expected differential = sum of our PPGs minus sum of theirs; the
  // residual (actual minus expected) is "synergy".
  for (const game of games) {
    for (const side of sides(game)) {
      const expected =
        side.mates.reduce((s, k) => s + rows.get(k).ppg, 0) - side.opps.reduce((s, k) => s + rows.get(k).ppg, 0);
      for (const k of side.mates) {
        rows.get(k).expected.push(expected);
        rows.get(k).residuals.push(side.diff - expected);
      }
    }
  }

  for (const r of rows.values()) r.oppWinPct = mean(r.opponents.map((k) => rows.get(k).winPct));
  for (const r of rows.values()) r.oppOppWinPct = mean(r.opponents.map((k) => rows.get(k).oppWinPct));

  const all = [...rows.values()];
  const avgPpg = mean(all.map((r) => r.ppg));
  const avgIppg = mean(all.map((r) => r.idiotPoints / r.games));
  const leaderPct = Math.max(...all.filter((r) => isRanked(r.key)).map((r) => r.winPct));
  // Wins needed (with no more losses) to reach a target win %.
  const behind = (r, pct) => (pct >= 1 ? null : (pct * r.games - r.wins) / (1 - pct));

  const out = all.map((r) => ({
    key: r.key,
    games: r.games,
    wins: r.wins,
    losses: r.losses,
    pointsFor: r.pointsFor,
    pointsAgainst: r.pointsAgainst,
    pointDiff: r.pointsFor - r.pointsAgainst,
    winPct: r.winPct,
    gamesBehind: behind(r, leaderPct),
    ppg: r.ppg,
    ppgPlusMinus: r.ppg - avgPpg,
    idiotPoints: r.idiotPoints,
    idiotPpg: r.idiotPoints / r.games,
    idiotPpgPlusMinus: r.idiotPoints / r.games - avgIppg,
    avgPointDiff: mean(r.diffs),
    avgSynergy: mean(r.residuals),
    avgExpectedDiff: mean(r.expected),
    oppWinPct: r.oppWinPct,
    oppOppWinPct: r.oppOppWinPct,
    sos: (2 * r.oppWinPct + r.oppOppWinPct) / 3,
    ...streaks(r.results),
  }));

  for (const r of out) r.sosRank = 1 + out.filter((o) => o.sos > r.sos).length;

  // Default order: ranked players by win %, then wins; unranked after.
  // "Games behind next" compares with the ranked row above.
  const ranked = out.filter((r) => isRanked(r.key)).sort((a, b) => b.winPct - a.winPct || b.wins - a.wins);
  const unranked = out.filter((r) => !isRanked(r.key)).sort((a, b) => b.winPct - a.winPct || b.wins - a.wins);
  ranked.forEach((r, i) => {
    r.rank = i + 1;
    r.gamesBehindNext = i === 0 ? null : behind(r, ranked[i - 1].winPct);
  });
  for (const r of unranked) {
    r.rank = null;
    r.gamesBehindNext = null;
  }
  return [...ranked, ...unranked];
}

// results: chronological booleans (true = win).
function streaks(results) {
  let longestWin = 0;
  let longestLoss = 0;
  let run = 0;
  let prev = null;
  for (const won of results) {
    run = won === prev ? run + 1 : 1;
    prev = won;
    if (won) longestWin = Math.max(longestWin, run);
    else longestLoss = Math.max(longestLoss, run);
  }
  return {
    currentStreak: prev === null ? null : { won: prev, length: run },
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
  };
}

// Pair tables for the Synergy tab, keyed "a|b" for both orders.
//   partners: stats for two keys on the same team
//   opponents: stats for key a against key b (from a's point of view)
// Also returns each key's overall win % so "win % against minus own win %"
// can be shown.
export function pairStats(games) {
  games = sortGames(games);
  const board = leaderboard(games);
  const ppg = new Map(board.map((r) => [r.key, r.ppg]));
  const winPct = new Map(board.map((r) => [r.key, r.winPct]));
  const partners = new Map();
  const opponents = new Map();
  const bump = (map, a, b, fields) => {
    const id = `${a}|${b}`;
    const s = map.get(id) ?? { games: 0, wins: 0, diffSum: 0, residualSum: 0, idiotPoints: 0 };
    for (const [f, v] of Object.entries(fields)) s[f] += v;
    map.set(id, s);
  };

  for (const game of games) {
    for (const side of sides(game)) {
      const won = side.pts > side.against ? 1 : 0;
      const expected =
        side.mates.reduce((s, k) => s + ppg.get(k), 0) - side.opps.reduce((s, k) => s + ppg.get(k), 0);
      for (const a of side.seats) {
        for (const b of side.seats) {
          if (a === b) continue;
          bump(partners, keyOf(a), keyOf(b), {
            games: 1,
            wins: won,
            diffSum: side.diff,
            residualSum: side.diff - expected,
            // Both partners' idiot points, as in the spreadsheet.
            idiotPoints: a.idiot_points + b.idiot_points,
          });
        }
        for (const o of side.opps) {
          bump(opponents, keyOf(a), o, { games: 1, wins: won });
        }
      }
    }
  }

  const finish = (s) => ({
    ...s,
    winPct: s.wins / s.games,
    avgPointDiff: s.diffSum / s.games,
    avgSynergy: s.residualSum / s.games,
    idiotPpg: s.idiotPoints / s.games,
  });
  return {
    keys: board.map((r) => r.key),
    winPct,
    partners: new Map([...partners].map(([id, s]) => [id, finish(s)])),
    opponents: new Map([...opponents].map(([id, s]) => [id, { ...s, winPct: s.wins / s.games }])),
  };
}

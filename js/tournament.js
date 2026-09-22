// Tournament scoring (matches the tournament spreadsheets):
//   +1 per point your team scores
//   +2 per set (euchre) your team gets
//   +4 per hand you win alone
//   +5 per game your team wins
//   −3 per idiot point you give
// Ties are broken by wins, then alone wins, then sets, then fewest points
// allowed per game (holding opponents' scoring down).

import { GUEST, sortGames } from './stats.js';

export const SCORING = { point: 1, set: 2, alone: 4, win: 5, idiot: -3 };

const keyOf = (seat) => seat.player_id ?? GUEST;

export function standings(games) {
  const rows = new Map();
  const row = (key) => {
    if (!rows.has(key)) {
      rows.set(key, {
        key, games: 0, wins: 0, losses: 0, gamePoints: 0, sets: 0, aloneWins: 0, idiotPoints: 0,
        oppPoints: 0, prelimTotal: 0, finalTotal: 0,
      });
    }
    return rows.get(key);
  };

  for (const g of sortGames(games)) {
    for (const team of ['A', 'B']) {
      const pts = team === 'A' ? g.team_a_points : g.team_b_points;
      const against = team === 'A' ? g.team_b_points : g.team_a_points;
      const sets = (team === 'A' ? g.team_a_sets : g.team_b_sets) ?? 0;
      const won = pts > against;
      for (const seat of g.players.filter((p) => p.team === team)) {
        const r = row(keyOf(seat));
        const score =
          SCORING.point * pts + SCORING.set * sets + SCORING.alone * seat.alone_wins +
          (won ? SCORING.win : 0) + SCORING.idiot * seat.idiot_points;
        r.games += 1;
        r[won ? 'wins' : 'losses'] += 1;
        r.gamePoints += pts;
        r.sets += sets;
        r.aloneWins += seat.alone_wins;
        r.idiotPoints += seat.idiot_points;
        r.oppPoints += against;
        if (g.tournament_phase === 'final') r.finalTotal += score;
        else r.prelimTotal += score;
      }
    }
  }

  const out = [...rows.values()].map((r) => ({
    ...r,
    total: r.prelimTotal + r.finalTotal,
    oppPpg: r.games ? r.oppPoints / r.games : 0,
  }));
  out.sort(
    (a, b) =>
      b.total - a.total || b.wins - a.wins || b.aloneWins - a.aloneWins || b.sets - a.sets || a.oppPpg - b.oppPpg
  );
  out.forEach((r, i) => (r.place = i + 1));
  return out;
}

// Prelim standings decide the finals tables: top 4, next 4, ... ; anyone
// left over sits out the finals.
export function prelimStandings(games) {
  return standings(games.filter((g) => g.tournament_phase !== 'final'));
}

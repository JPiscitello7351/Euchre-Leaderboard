// A player's "About" write-up, worked out from their stats so it stays
// current as games are added: a short intro, then strengths (hyped) and
// weaknesses (blunt). Every claim is tied to a number, and thin samples are
// left out rather than over-claimed.

import { leaderboard, pairStats, sortGames, GUEST } from './stats.js';
import { playerName } from './format.js';
import { rankedIn } from './members.js';

const MIN_PAIR_GAMES = 5;      // a praised pairing needs this many games together
const MIN_CRITIC_GAMES = 6;   // a criticised one needs a few more before it counts
const MIN_GAMES = 5;      // below this, no write-up at all

const pct = (v) => `${Math.round(v * 100)}%`;
const one = (v) => v.toFixed(1);
const rec = (p) => `${p.wins}–${p.games - p.wins}`;

const article = (n) => (/^(8|11|18|8\d|11\d|18\d)/.test(String(n)) ? 'An' : 'A');

const ordinal = (n) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
};

export function playerBlurb(league, key, format) {
  const games = league.games.filter((g) => g.format === format);
  const rows = leaderboard(games, { isRanked: rankedIn(league, null) });
  const me = rows.find((r) => r.key === key);
  if (!me || me.games < MIN_GAMES) return null;

  const perTeam = format / 2;
  const allowed = (r) => r.pointsAgainst / r.games / perTeam;
  const name = playerName(league, key);
  const field = rows.filter((r) => r.games >= MIN_GAMES && (r.rank !== null || r.key === key));
  // 1 = league best on this measure.
  const place = (value, of, best = 'high') =>
    1 + of.filter((v) => (best === 'high' ? v > value : v < value)).length;
  const winPlace = place(me.winPct, field.map((r) => r.winPct));
  const ppgPlace = place(me.ppg, field.map((r) => r.ppg));
  const defPlace = place(allowed(me), field.map(allowed), 'low');
  const ipPlace = place(me.idiotPpg, field.map((r) => r.idiotPpg), 'low');
  const synPlace = place(me.avgSynergy, field.map((r) => r.avgSynergy));
  const n = field.length;
  const best = (p) => (p === 1 ? 'best' : `${ordinal(p)} best`);
  const worst = (p) => (p === n ? 'worst' : `${ordinal(n + 1 - p)} worst`);
  const top = (p) => p <= Math.max(2, Math.round(n / 4));
  const bottom = (p) => p > n - Math.max(2, Math.round(n / 4));

  // Partners and opponents with enough games together to mean something.
  const pairs = pairStats(games);
  const mine = (map) => [...map]
    .filter(([id, s]) => id.startsWith(`${key}|`) && s.games >= MIN_PAIR_GAMES)
    .map(([id, s]) => ({ key: id.split('|')[1] === GUEST ? GUEST : Number(id.split('|')[1]), ...s }))
    .filter((p) => p.key !== GUEST);
  const partners = mine(pairs.partners).sort((a, b) => b.winPct - a.winPct);
  const foes = mine(pairs.opponents).sort((a, b) => b.winPct - a.winPct);

  // Last ten games, oldest to newest.
  const played = sortGames(games.filter((g) => g.players.some((p) => (p.player_id ?? GUEST) === key)));
  const recent = played.slice(-10);
  const recentWins = recent.filter((g) => {
    const seat = g.players.find((p) => (p.player_id ?? GUEST) === key);
    const [ours, theirs] = seat.team === 'A' ? [g.team_a_points, g.team_b_points] : [g.team_b_points, g.team_a_points];
    return ours > theirs;
  }).length;

  // ---- Intro
  const ranked = rows.filter((r) => r.rank !== null);
  const rank = ranked.findIndex((r) => r.key === key) + 1;
  const where = rank === 0 ? `${ordinal(winPlace)} of ${n} by win rate` : `${ordinal(rank)} of ${ranked.length}`;
  const record = `${me.wins}–${me.losses} (${pct(me.winPct)})`;
  let intro;
  if (rank === 1) {
    intro = `${name} is the bar everyone else is trying to clear: ${record} across ${me.games} ${format}-handed games, top of the table and not by accident.`;
  } else if (top(winPlace)) {
    intro = `${name} is one of the genuine threats in this league: ${record} over ${me.games} ${format}-handed games, ${where}, and never a soft draw.`;
  } else if (bottom(winPlace)) {
    intro = `${name} has taken a beating: ${record} over ${me.games} ${format}-handed games, ${where}. The deal gets some of the blame. Not all of it.`;
  } else {
    intro = `${name} sits in the thick of it: ${record} over ${me.games} ${format}-handed games, ${where} — good enough to beat anyone on the right night, loose enough to hand one away on the wrong one.`;
  }
  if (rank === 0) intro += ' Their book is closed, but the numbers still count.';

  // Headings come in several flavours; which one a player gets depends on
  // their id, so profiles don't all read the same.
  let traitNo = 0;
  const hash = (text) => {
    let h = 2166136261;
    for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  };
  const flavour = (variants) => variants[hash(`${key}:${format}:${traitNo++}`) % variants.length];
  const add = (list, variants, detail) => list.push({ label: flavour(variants), detail });

  // ---- Strengths: lead hard.
  const strengths = [];
  if (rank === 1) add(strengths, ['The best record in the league', 'Nobody does it better', 'Top of the mountain', 'The one everybody is chasing'], `${record}. Nobody has squeezed more out of their hands.`);
  else if (top(winPlace)) add(strengths, ['Wins games', 'Piles up wins', 'Just keeps winning', 'Always in the hunt'], `${record}, the ${best(winPlace)} win rate of ${n}. Whatever they're doing, it keeps working.`);
  if (top(ppgPlace)) add(strengths, ['Puts up points', 'Scoreboard pressure', 'Points machine', 'Cashes every hand'], `${one(me.ppg)} a game, ${one(Math.abs(me.ppgPlusMinus))} clear of the league average and ${best(ppgPlace)} of ${n}. Give them a decent hand and they cash it.`);
  if (top(defPlace)) add(strengths, ['Brutal to score on', 'Locks the door', 'A wall', 'Nothing comes easy against them'], `Opponents scrape together just ${one(allowed(me))} a game, ${best(defPlace)} in the league. Points have to be earned.`);
  if (me.avgSynergy >= 0.4 || (top(synPlace) && me.avgSynergy > 0)) {
    add(strengths, ['Makes their partner better', 'Lifts whoever sits with them', 'A partner upgrade', 'Raises the whole table'], `Teams with ${name} beat what the lineup says they should do by ${one(me.avgSynergy)} points a game. The name you want called next to yours.`);
  }
  if (me.idiotPoints === 0) add(strengths, ['Ice cold', 'Flawless discipline', 'Never rattled', 'Not one moment of madness'], `${me.games} games, zero idiot points. Not one moment of madness on record.`);
  else if (top(ipPlace)) add(strengths, ['Keeps it clean', 'Disciplined', 'Rarely beats themselves', 'Mistake-free'], `Just ${me.idiotPoints} idiot point${me.idiotPoints === 1 ? '' : 's'} in ${me.games} games (${me.idiotPpg.toFixed(2)} a game), the ${best(ipPlace)} discipline of ${n}.`);
  if (me.longestWinStreak >= 5) add(strengths, ['Gets hot', 'Catches fire', 'Runs in streaks', 'Can go on a tear'], `${article(me.longestWinStreak)} ${me.longestWinStreak}-game winning streak on the books. When it clicks, the night is theirs.`);
  if (partners.length && partners[0].winPct >= 0.6) {
    add(strengths, [`Deadly alongside ${playerName(league, partners[0].key)}`, `Unstoppable with ${playerName(league, partners[0].key)}`, `Built to play with ${playerName(league, partners[0].key)}`, `${playerName(league, partners[0].key)} brings out their best`], `${rec(partners[0])} together (${pct(partners[0].winPct)}). That pairing is everyone else's problem.`);
  }
  if (foes.length && foes[0].winPct >= 0.65) {
    add(strengths, [`Owns ${playerName(league, foes[0].key)}`, `${playerName(league, foes[0].key)} can't solve them`, `Has ${playerName(league, foes[0].key)}'s number`, `${playerName(league, foes[0].key)} is a free square`], `${rec(foes[0])} head to head. That matchup is settled.`);
  }
  if (recentWins >= 7 && recent.length >= 8) add(strengths, ['Rolling right now', 'Hot hand at the moment', 'Peaking', 'In form'], `${recentWins}–${recent.length - recentWins} in their last ${recent.length}. Nobody wants this draw at the moment.`);

  // ---- Weaknesses: no sugar-coating.
  const weaknesses = [];
  if (bottom(winPlace) && rank !== 0) add(weaknesses, ['Loses more than they win', 'The record tells the story', 'On the wrong side of the ledger', 'More losses than wins'], `${record}, ${worst(winPlace)} of ${n} on win rate. ${me.games} games is long past the point where bad cards explain it.`);
  if (bottom(ppgPlace)) add(weaknesses, ['Can’t score', 'Punchless', 'Points are hard to come by', 'No scoring punch'], `${one(me.ppg)} a game, ${worst(ppgPlace)} of ${n}. Their teams scratch for points instead of taking them.`);
  if (bottom(defPlace)) add(weaknesses, ['Leaks points', 'A turnstile', 'Too easy to score on', 'Defence optional'], `Opponents hang ${one(allowed(me))} a game on them, ${worst(defPlace)} of ${n}. This is where their nights fall apart.`);
  if (me.avgSynergy <= -0.4 || (bottom(synPlace) && me.avgSynergy < 0)) {
    add(weaknesses, ['Drags teams under', 'Teams do worse with them', 'An anchor, and not the good kind', 'Lineups get worse, not better'], `Lineups with ${name} finish ${one(-me.avgSynergy)} points a game below what they should. Fine on paper, worse at the table.`);
  }
  if (bottom(ipPlace) && me.idiotPoints > 0) {
    add(weaknesses, ['Idiot points', 'Self-inflicted wounds', 'A discipline problem', 'Their own worst enemy'], `${me.idiotPoints} of them, ${me.idiotPpg.toFixed(2)} a game — ${worst(ipPlace)} of ${n}. Every one of those was a choice.`);
  }
  if (me.longestLossStreak >= 5 && me.longestLossStreak >= me.longestWinStreak) add(weaknesses, ['Goes cold hard', 'Bad runs get long', 'Spirals', 'When it goes, it really goes'], `${article(me.longestLossStreak)} ${me.longestLossStreak}-game losing streak on the books. When it turns, it stays turned.`);
  const badPartner = [...partners].reverse().find((p) => p.games >= MIN_CRITIC_GAMES && p.winPct <= 0.4);
  if (partners.length >= 2 && badPartner) {
    add(weaknesses, [`Nothing works with ${playerName(league, badPartner.key)}`, `${playerName(league, badPartner.key)} is not the answer`, `A dead end with ${playerName(league, badPartner.key)}`, `No chemistry with ${playerName(league, badPartner.key)}`], `${rec(badPartner)} together (${pct(badPartner.winPct)}). That partnership needs to stop happening.`);
  }
  const nemesis = [...foes].reverse().find((f) => f.games >= MIN_CRITIC_GAMES && f.winPct <= 0.35);
  if (nemesis) {
    add(weaknesses, [`${playerName(league, nemesis.key)} has their number`, `Owned by ${playerName(league, nemesis.key)}`, `${playerName(league, nemesis.key)} is a brick wall`, `No answer for ${playerName(league, nemesis.key)}`], `${rec(nemesis)} in those games. It stopped being a coincidence a while ago.`);
  }
  if (recentWins <= 3 && recent.length >= 8) add(weaknesses, ['Cold right now', 'Slumping', 'Off the boil', 'Stuck in a rut'], `${recentWins}–${recent.length - recentWins} in their last ${recent.length}. Whatever's wrong hasn't been fixed.`);

  // Always say something on both sides.
  if (!strengths.length) {
    const best = [[winPlace, `a ${pct(me.winPct)} win rate`], [ppgPlace, `${one(me.ppg)} points a game`], [defPlace, `${one(allowed(me))} allowed a game`]]
      .sort((a, b) => a[0] - b[0])[0];
    add(strengths, ['Keeps showing up', 'Puts in the hours', 'Always at the table', 'Turns up every week'], `${me.games} games in, and their best number is ${best[1]} (${ordinal(best[0])} of ${n}). Something to build on.`);
  }
  if (!weaknesses.length) {
    const worst = [[winPlace, 'win rate'], [ppgPlace, 'scoring'], [defPlace, 'points allowed'], [ipPlace, 'discipline']]
      .sort((a, b) => b[0] - a[0])[0];
    add(weaknesses, ['No obvious hole', 'Nothing to pick at', 'Hard to fault', 'No soft spot to find'], `Nothing here is bad. The closest thing to a soft spot is ${worst[1]}, ${ordinal(worst[0])} of ${n} — and that is nitpicking.`);
  }

  return { intro, strengths, weaknesses };
}

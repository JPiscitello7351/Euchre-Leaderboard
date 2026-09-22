// Backup download / restore and the Excel export.
//
// The backup file is the same format as supabase export_backup() and the
// spreadsheet import script, so any of them can be restored.

import { supabase } from './data.js';
import { leaderboard, rankedOnly, seasonFor, sortGames, GUEST } from './stats.js';
import { tournamentTitle } from './format.js';
import { rankedIn } from './members.js';

export function buildBackup(league) {
  return {
    kind: 'euchre-league-backup',
    version: 2,
    exported_at: new Date().toISOString(),
    settings: league.settings,
    players: league.players,
    seasons: league.seasons,
    tournaments: league.tournaments,
    games: league.games,
  };
}

const stamp = () => new Date().toISOString().slice(0, 10);

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBackup(league) {
  const json = JSON.stringify(buildBackup(league));
  download(new Blob([json], { type: 'application/json' }), `euchre-league-backup-${stamp()}.json`);
}

// Replaces ALL data in the database. The database saves what it replaced
// in its change log first, so a restore can be undone by restoring that.
export async function restoreBackup(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error('That file isn’t valid JSON.');
  }
  if (backup?.kind !== 'euchre-league-backup') throw new Error('That file isn’t a Euchre League backup.');
  const { data, error } = await supabase.rpc('restore_backup', { p_backup: backup });
  if (error) throw new Error(error.message);
  return data;
}

// Human-readable workbook: games laid out like the old spreadsheets, the
// player list, and a leaderboard sheet per season and format.
export async function exportExcel(league) {
  const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  const name = (seat) => (seat.player_id === null ? `Guest${seat.guest_name ? ` (${seat.guest_name})` : ''}` : league.playerById.get(seat.player_id)?.name);
  const tournaments = new Map(league.tournaments.map((t) => [t.id, t]));
  const wb = XLSX.utils.book_new();

  for (const format of [4, 6]) {
    const perTeam = format / 2;
    const header = ['Date', 'Season', 'Game #', 'Tournament', 'Phase', 'Round'];
    for (const side of ['A', 'B']) {
      for (let i = 1; i <= perTeam; i++) header.push(`Team${side}_P${i}`, `Team${side}_P${i}_Idiot_Points`, `Team${side}_P${i}_Alone_Wins`);
    }
    header.push('TeamA_Pts', 'TeamB_Pts', 'TeamA_Sets', 'TeamB_Sets');
    const rows = sortGames(league.games.filter((g) => g.format === format)).map((g) => {
      const row = [
        g.played_on,
        seasonFor(g.played_on, league.seasons)?.name ?? '',
        g.seq,
        g.tournament_id ? tournamentTitle(league, tournaments.get(g.tournament_id)) : '',
        g.tournament_phase ?? '',
        g.tournament_round ?? '',
      ];
      for (const side of ['A', 'B']) {
        for (const seat of g.players.filter((p) => p.team === side).sort((a, b) => a.seat - b.seat)) {
          row.push(name(seat), seat.idiot_points, seat.alone_wins);
        }
      }
      row.push(g.team_a_points, g.team_b_points, g.team_a_sets ?? '', g.team_b_sets ?? '');
      return row;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), `Games ${format}-handed`);
  }

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([['Player', 'Joined', 'Left'], ...league.players.map((p) => [p.name, p.joined_on, p.left_on ?? ''])]),
    'Players'
  );

  const scopes = [...league.seasons.map((s) => ({ label: s.name, season: s })), { label: 'All time', season: null }];
  for (const { label, season } of scopes) {
    for (const format of [4, 6]) {
      const games = league.games.filter(
        (g) => g.format === format && (!season || seasonFor(g.played_on, league.seasons)?.id === season.id)
      );
      if (!games.length) continue;
      const header = ['Rank', 'Player', 'Wins', 'Losses', 'Win %', 'Games Behind', 'Points For', 'Points Against', 'Point Diff',
        'PPG', '+/- PPG', 'Idiot Points', 'Idiot PPG', '+/- IPPG', 'AVG Point Diff', 'AVG Synergy', 'AVG Diff Expected',
        'OW%', 'OOW%', 'SoS', 'SoS Rank', 'Current Streak', 'Longest Win Streak', 'Longest Loss Streak'];
      const rows = rankedOnly(leaderboard(games, { isRanked: rankedIn(league, season) })).map((r) => [
        r.rank ?? '', r.key === GUEST ? 'Guest' : league.playerById.get(r.key)?.name, r.wins, r.losses, r.winPct, r.gamesBehind ?? '',
        r.pointsFor, r.pointsAgainst, r.pointDiff, r.ppg, r.ppgPlusMinus, r.idiotPoints, r.idiotPpg, r.idiotPpgPlusMinus,
        r.avgPointDiff, r.avgSynergy, r.avgExpectedDiff, r.oppWinPct, r.oppOppWinPct, r.sos, r.sosRank,
        r.currentStreak ? `${r.currentStreak.won ? 'W' : 'L'}${r.currentStreak.length}` : '', r.longestWinStreak, r.longestLossStreak,
      ]);
      // Sheet names max out at 31 characters.
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), `${label} ${format}H`.slice(0, 31));
    }
  }

  XLSX.writeFile(wb, `euchre-league-${stamp()}.xlsx`);
}

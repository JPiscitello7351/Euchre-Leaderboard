"""Convert the league's Q1-Q3 2026 spreadsheets into a backup file.

The output uses the same format as the website's "Download backup" button,
so it can be loaded with "Restore backup".

Usage:  python tools/import_spreadsheets.py <spreadsheet folder> <output.json>
Needs:  pip install openpyxl
"""

import json
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

import openpyxl

SEASON_FILES = [
    # (4-handed file, 6-handed file)
    ("260403_Q1 Final Euchre Leaderboard 4 Handed.xlsx", "260403_Q1 Final Euchre Leaderboard 6 Handed.xlsx"),
    ("260702_Final_Q2_Euchre Leaderboard 4 Handed.xlsx", "260702_Final_Q2_Euchre Leaderboard 6 Handed.xlsx"),
    ("260921_Final_Q3_Euchre Leaderboard 4 Handed.xlsx", "260921_Final_Q3_Euchre Leaderboard 6 Handed.xlsx"),
]

# Each season starts the day after the previous season's tournament.
SEASONS = [
    ("Q1 2026", date(2025, 12, 18)),
    ("Q2 2026", date(2026, 3, 29)),
    ("Q3 2026", date(2026, 6, 28)),
    ("Q4 2026", date(2026, 9, 20)),
]

TOURNAMENT_FILES = {
    date(2026, 6, 27): "260627_Euchre Tournament_9 player.xlsx",
    date(2026, 9, 19): "260919_Q3_Euchre Tournament_8 player.xlsx",
}

NAME_FIXES = {"GIlad": "Gilad", "TItts": "Titts", "titts": "Titts", "NIKOLAS EBELING": "Nik"}

# Former members: kept with their history. They left after their last game.
FORMER = {"Cameron", "Titts"}

# Seats the sheets got wrong: (date, format, game # that day, team, listed name) -> None for Guest.
SEAT_FIXES = {
    # Teegan was listed on both teams; the team B seat was someone else.
    (date(2026, 9, 10), 6, 3, "B", "Teegan"): None,
}

# Tournaments with only final standings recorded (no game-by-game sheet).
RESULTS_ONLY_TOURNAMENTS = {
    date(2026, 3, 28): {
        "note": "Only final standings were recorded. Only the top table played the final round robin.",
        "standings": [("Kamden", 160), ("Wyatt", 148), ("Aleck", 144), ("Gilad", 107),
                      ("Cameron", 84), ("Titts", 77), ("Darragh", 73), ("Nik", 60)],
    },
}

FINALS_ROUNDS = 3


def clean_name(raw):
    name = str(raw).strip()
    name = NAME_FIXES.get(name, name)
    return None if name.lower() == "guest" else name


def read_games(path, fmt):
    """Rows from a season sheet's Games tab, in sheet order."""
    ws = openpyxl.load_workbook(path, data_only=True)["Games"]
    per_team = fmt // 2
    games = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[2]:
            continue
        seats = []
        for team_index, team in enumerate("AB"):
            for seat in range(per_team):
                col = 2 + 2 * (team_index * per_team + seat)
                seats.append({
                    "team": team,
                    "seat": seat + 1,
                    "name": clean_name(row[col]),
                    "idiot_points": int(row[col + 1] or 0),
                    "alone_wins": 0,
                })
        points_col = 2 + 2 * fmt
        games.append({
            "played_on": row[1].date() if isinstance(row[1], datetime) else row[1],
            "format": fmt,
            "team_a_points": int(row[points_col]),
            "team_b_points": int(row[points_col + 1]),
            "seats": seats,
        })
    return games


def read_tournament_blocks(path):
    """Per-player, per-round stats from a tournament sheet.

    Returns [prelim, finals], each {player: {round: {points, loners, sets, ip, win}}},
    plus the schedules: [[(team1, team2, team3, team4) per round], ...] per phase.
    """
    ws = openpyxl.load_workbook(path, data_only=True).active
    cell = lambda r, c: ws.cell(r, c).value
    blocks, schedules = [], []
    r = 1
    while r <= ws.max_row:
        if cell(r, 1) == "Player" and str(cell(r, 2) or "").startswith("Round"):
            rounds = {}
            c = 2
            while str(cell(r, c) or "").startswith("Round"):
                rounds[int(str(cell(r, c)).split()[1])] = c
                c += 5
            stats = {}
            pr = r + 2
            while cell(pr, 1):
                name = clean_name(cell(pr, 1))
                stats[name] = {
                    rnd: {
                        "points": cell(pr, col) or 0,
                        "loners": cell(pr, col + 1) or 0,
                        "sets": cell(pr, col + 2) or 0,
                        "ip": cell(pr, col + 3) or 0,
                        "win": cell(pr, col + 4) or 0,
                    }
                    for rnd, col in rounds.items()
                }
                pr += 1
            blocks.append(stats)
            r = pr
        elif cell(r, 1) == "Schedule:":
            schedule = []
            c = 2
            while str(cell(r, c) or "").startswith("Round"):
                teams = [(clean_name(cell(r + t, c)), clean_name(cell(r + t, c + 1))) for t in range(1, 5)]
                schedule.append(teams)
                c += 2
            schedules.append(schedule)
            r += 5
        else:
            r += 1
    return blocks, schedules


def attach_tournament(games, held_on, path, problems):
    """Tag a tournament day's games with phase/round and fill in sets and loners."""
    blocks, schedules = read_tournament_blocks(path)
    prelim_rounds = len(schedules[0])
    for i, game in enumerate(games):
        rnd = i // 2 + 1
        table = i % 2
        phase = "prelim" if rnd <= prelim_rounds else "final"
        if phase == "final":
            rnd -= prelim_rounds
        stats = blocks[0 if phase == "prelim" else 1]
        teams = schedules[0 if phase == "prelim" else 1][rnd - 1]
        game.update(tournament_phase=phase, tournament_round=rnd)

        # The season sheet sometimes lists a known player as "Guest"; the
        # tournament schedule names them.
        expected = {"A": set(teams[table * 2]), "B": set(teams[table * 2 + 1])}
        for team in "AB":
            listed = {s["name"] for s in game["seats"] if s["team"] == team}
            if listed != expected[team]:
                missing = expected[team] - listed
                if None in listed and len(missing) == 1:
                    guest = next(s for s in game["seats"] if s["team"] == team and s["name"] is None)
                    guest["name"] = missing.pop()
                else:
                    problems.append(f"{held_on} {phase} round {rnd}: team {team} is {listed}, schedule says {expected[team]}")

        for team in "AB":
            team_points = game["team_a_points"] if team == "A" else game["team_b_points"]
            team_sets = set()
            for s in game["seats"]:
                if s["team"] != team:
                    continue
                st = stats.get(s["name"], {}).get(rnd)
                if st is None:
                    problems.append(f"{held_on} {phase} round {rnd}: no tournament stats for {s['name']}")
                    continue
                if st["points"] != team_points:
                    problems.append(f"{held_on} {phase} round {rnd}: {s['name']} has {st['points']} pts in tournament sheet, game says {team_points}")
                if st["ip"] != s["idiot_points"]:
                    problems.append(f"{held_on} {phase} round {rnd}: {s['name']} idiot points {st['ip']} (tournament) vs {s['idiot_points']} (season sheet); kept season sheet")
                s["alone_wins"] = int(st["loners"])
                team_sets.add(int(st["sets"]))
            if len(team_sets) > 1:
                problems.append(f"{held_on} {phase} round {rnd}: team {team} partners disagree on sets {team_sets}; used the higher")
            game[f"team_{team.lower()}_sets"] = max(team_sets) if team_sets else 0


def schedule_from_games(games):
    """Rebuild a Tournament Mode schedule from a tournament's saved games, so
    past tournaments can be viewed and edited there. Games must be in play
    order; team A is listed first at each table."""
    def team(g, side):
        return [p["player_id"] for p in sorted(g["players"], key=lambda p: p["seat"]) if p["team"] == side]

    players = sorted({p["player_id"] for g in games for p in g["players"]})

    def rounds(phase):
        out = []
        phase_games = [g for g in games if g["tournament_phase"] == phase]
        for rnd in sorted({g["tournament_round"] for g in phase_games}):
            tables = [[team(g, "A"), team(g, "B")] for g in phase_games if g["tournament_round"] == rnd]
            playing = {pid for t in tables for side in t for pid in side}
            out.append({"tables": tables, "sitting": [pid for pid in players if pid not in playing]})
        return out

    prelim = rounds("prelim")
    finals = rounds("final")
    return {
        "version": 1,
        "seed": None,
        "players": players,
        "prelim": {"rounds": prelim},
        # Finals groups: the players at each finals table, top table first.
        "finals": {"groups": [t[0] + t[1] for t in finals[0]["tables"]], "rounds": finals} if finals else None,
    }


def build(folder):
    folder = Path(folder)
    problems = []
    all_games = []
    for four, six in SEASON_FILES:
        all_games += read_games(folder / four, 4)
        all_games += read_games(folder / six, 6)

    day_counts = defaultdict(int)
    for g in all_games:
        day_counts[(g["played_on"], g["format"])] += 1
        game_no = day_counts[(g["played_on"], g["format"])]
        for s in g["seats"]:
            key = (g["played_on"], g["format"], game_no, s["team"], s["name"])
            if key in SEAT_FIXES:
                s["name"] = SEAT_FIXES.pop(key)
    for key in SEAT_FIXES:
        problems.append(f"Seat fix didn't match any game: {key}")

    tournaments = []
    held = sorted(set(TOURNAMENT_FILES) | set(RESULTS_ONLY_TOURNAMENTS))
    for t_id, held_on in enumerate(held, start=1):
        details = {}
        if held_on in TOURNAMENT_FILES:
            day_games = [g for g in all_games if g["played_on"] == held_on and g["format"] == 4]
            attach_tournament(day_games, held_on, folder / TOURNAMENT_FILES[held_on], problems)
            for g in day_games:
                g["tournament_id"] = t_id
        tournaments.append({"id": t_id, "held_on": held_on.isoformat(), "name": None, "format": 4, "schedule": details})

    names = sorted({s["name"] for g in all_games for s in g["seats"] if s["name"]})
    first_game, last_game = {}, {}
    for g in all_games:
        for s in g["seats"]:
            if s["name"]:
                d = g["played_on"].isoformat()
                first_game[s["name"]] = min(first_game.get(s["name"], d), d)
                last_game[s["name"]] = max(last_game.get(s["name"], d), d)
    player_ids = {name: i for i, name in enumerate(names, start=1)}

    # Results-only standings refer to players by id.
    for t in tournaments:
        extra = RESULTS_ONLY_TOURNAMENTS.get(date.fromisoformat(t["held_on"]))
        if extra:
            t["schedule"] = {
                "recorded_standings": [
                    {"place": i, "player_id": player_ids[name], "points": pts}
                    for i, (name, pts) in enumerate(extra["standings"], start=1)
                ],
                "note": extra["note"],
            }

    games_out = []
    seq = defaultdict(int)
    for g_id, g in enumerate(all_games, start=1):
        key = (g["played_on"], g["format"])
        seq[key] += 1
        games_out.append({
            "id": g_id,
            "played_on": g["played_on"].isoformat(),
            "format": g["format"],
            "seq": seq[key],
            "team_a_points": g["team_a_points"],
            "team_b_points": g["team_b_points"],
            "team_a_sets": g.get("team_a_sets"),
            "team_b_sets": g.get("team_b_sets"),
            "tournament_id": g.get("tournament_id"),
            "tournament_phase": g.get("tournament_phase"),
            "tournament_round": g.get("tournament_round"),
            "players": [
                {
                    "team": s["team"],
                    "seat": s["seat"],
                    "player_id": player_ids.get(s["name"]),
                    "guest_name": None,
                    "idiot_points": s["idiot_points"],
                    "alone_wins": s["alone_wins"],
                }
                for s in g["seats"]
            ],
        })

    for t in tournaments:
        t_games = sorted((g for g in games_out if g["tournament_id"] == t["id"]), key=lambda g: g["seq"])
        if t_games:
            t["schedule"] = schedule_from_games(t_games)

    backup = {
        "kind": "euchre-league-backup",
        "version": 2,
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "settings": {"max_guests_per_game": 1},
        "players": [
            {"id": i, "name": n, "joined_on": first_game[n], "left_on": last_game[n] if n in FORMER else None}
            for n, i in player_ids.items()
        ],
        "seasons": [{"id": i, "name": n, "starts_on": d.isoformat()} for i, (n, d) in enumerate(SEASONS, start=1)],
        "tournaments": tournaments,
        "games": games_out,
    }
    return backup, problems


def check_against_sheets(folder, backup):
    """Recompute W/L/PF/PA per player per season file and compare with each
    spreadsheet's Players tab. Returns a list of mismatches."""
    folder = Path(folder)
    names = {p["id"]: p["name"] for p in backup["players"]}
    seasons = sorted((s["starts_on"], s["name"]) for s in backup["seasons"])
    season_of = lambda d: [n for start, n in seasons if start <= d][-1]
    mismatches = []
    for q, (four, six) in enumerate(SEASON_FILES, start=1):
        for fname, fmt in ((four, 4), (six, 6)):
            totals = defaultdict(lambda: [0, 0, 0, 0])
            for g in backup["games"]:
                if g["format"] != fmt or season_of(g["played_on"]) != f"Q{q} 2026":
                    continue
                for s in g["players"]:
                    # The spreadsheets count a named-in-tournament guest as "Guest".
                    name = names.get(s["player_id"], "Guest")
                    mine, theirs = (g["team_a_points"], g["team_b_points"]) if s["team"] == "A" else (g["team_b_points"], g["team_a_points"])
                    t = totals[name]
                    t[0 if mine > theirs else 1] += 1
                    t[2] += mine
                    t[3] += theirs
            ws = openpyxl.load_workbook(folder / fname, data_only=True)["Players"]
            header = [c.value for c in ws[1]]
            col = {h: header.index(h) for h in ("Player", "Wins", "Losses", "Points For", "Points Against", "PPG") if h in header}
            for row in ws.iter_rows(min_row=2, values_only=True):
                name = row[col["Player"]]
                if not name or not (row[col["Wins"]] or row[col["Losses"]]):
                    continue
                name = clean_name(name) or "Guest"
                w, l, pf, pa = totals.get(name, [0, 0, 0, 0])
                ours = {"Wins": w, "Losses": l, "Points For": pf, "Points Against": pa,
                        "PPG": pf / (w + l) / (fmt // 2) if w + l else 0}
                for h, i in col.items():
                    if h != "Player" and abs(ours[h] - (row[i] or 0)) > 1e-9:
                        mismatches.append(f"Q{q} {fmt}-handed {name} {h}: sheet {row[i]:.4g}, import {ours[h]:.4g}")
    return mismatches


if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    backup, problems = build(src)
    Path(out).write_text(json.dumps(backup, indent=1), encoding="utf-8")
    games = backup["games"]
    print(f"Players ({len(backup['players'])}): {', '.join(p['name'] for p in backup['players'])}")
    for fmt in (4, 6):
        print(f"{fmt}-handed games: {sum(g['format'] == fmt for g in games)}")
    print(f"Tournament games: {sum(g['tournament_id'] is not None for g in games)}")
    print(f"Unnamed guest seats: {sum(s['player_id'] is None for g in games for s in g['players'])}")
    print(f"\nData notes ({len(problems)}):")
    for p in problems:
        print("  -", p)
    mismatches = check_against_sheets(src, backup)
    print(f"\nCross-check against spreadsheet Players tabs: {len(mismatches)} mismatches")
    for m in mismatches:
        print("  -", m)
    print(f"\nWrote {out}")

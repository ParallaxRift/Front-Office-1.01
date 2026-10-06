# ============================================================
# Front Office: daily FantasyPros value update
#
# Runs on GitHub Actions once a day. It:
#   1. Downloads FantasyPros dynasty rankings (1QB and Superflex)
#   2. Turns each ranking into a 0-10,000 value
#   3. Fills in deeper players from DynastyProcess if the
#      FantasyPros list is short (the free key returns partial data)
#   4. Saves everything to data/values.json for the website
#
# Your API key is NOT in this file. GitHub passes it in from the
# secret named FANTASYPROS_API_KEY.
# ============================================================
import csv
import io
import json
import math
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# ---------- Settings you can tweak ----------
SEASON = datetime.now(timezone.utc).year
BASE = f"https://api.fantasypros.com/public/v2/json/nfl/{SEASON}/consensus-rankings"

# Query settings for each list. If the first test run shows these
# aren't right, only this section needs to change.
QUERY_1QB = {"type": "dynasty", "scoring": "PPR", "position": "ALL"}
QUERY_SF = {"type": "dynasty", "scoring": "PPR", "position": "OP"}

CURVE = 0.0125      # how fast value drops by rank (rank 1 = 10,000, rank 100 ≈ 2,900)
DP_CSV = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-players.csv"
OUTPUT = os.path.join(os.path.dirname(__file__), "..", "data", "values.json")
# ---------------------------------------------

API_KEY = os.environ.get("FANTASYPROS_API_KEY", "").strip()
if not API_KEY:
    sys.exit("No API key found. Add a repository secret named FANTASYPROS_API_KEY.")


EXPERTS = {}  # how many experts contributed to each list, shown on the website


def fetch_fp(query, label):
    """Ask FantasyPros for one rankings list and print a summary for the log."""
    url = BASE + "?" + urllib.parse.urlencode(query)
    req = urllib.request.Request(url, headers={"x-api-key": API_KEY, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:300]
        print(f"[{label}] FantasyPros returned an error {e.code}: {body}")
        return []
    except Exception as e:
        print(f"[{label}] Could not reach FantasyPros: {e}")
        return []

    players = data.get("players") if isinstance(data, dict) else data
    players = players or []
    if isinstance(data, dict):
        try:
            EXPERTS[label] = int(data.get("total_experts") or 0)
        except (TypeError, ValueError):
            pass
        print(f"[{label}] Experts in this consensus: {EXPERTS.get(label, 'unknown')}")
    print(f"[{label}] Request: {query}")
    print(f"[{label}] Top-level fields: {list(data.keys()) if isinstance(data, dict) else 'list'}")
    print(f"[{label}] Players returned: {len(players)}")
    if players:
        print(f"[{label}] Fields on each player: {sorted(players[0].keys())}")
        sample = [f"{p.get('rank_ecr')}. {p.get('player_name')} ({p.get('player_position_id') or p.get('position')})" for p in players[:5]]
        print(f"[{label}] First five: {sample}")
    return players


def to_value(rank):
    return round(10000 * math.exp(-CURVE * (rank - 1)))


def position_of(p):
    pos = p.get("player_position_id") or p.get("position") or p.get("pos") or ""
    pos = str(pos).upper()
    return "".join(ch for ch in pos if ch.isalpha())[:2] or pos


def rank_of(p, fallback):
    for k in ("rank_ecr", "ecr", "rank"):
        try:
            return float(p[k])
        except (KeyError, TypeError, ValueError):
            continue
    return float(fallback)


def norm(name):
    name = (name or "").lower().replace(".", "").replace("'", "").replace("-", " ")
    words = [w for w in name.split() if w not in ("jr", "sr", "ii", "iii", "iv", "v")]
    return " ".join("".join(ch for ch in w if ch.isalpha()) for w in words).strip()


# ---------- 1) Download both lists ----------
one_qb = fetch_fp(QUERY_1QB, "1QB")
superflex = fetch_fp(QUERY_SF, "Superflex")

if not one_qb:
    sys.exit("No 1QB rankings came back, so values.json was left unchanged.")

# ---------- 2) Build values ----------
players = {}
for i, p in enumerate(one_qb, start=1):
    name, pos = p.get("player_name"), position_of(p)
    if not name or pos not in ("QB", "RB", "WR", "TE"):
        continue
    key = norm(name) + "|" + pos
    players.setdefault(key, {
        "name": name, "pos": pos, "team": p.get("player_team_id") or p.get("team") or "",
        "rank_1qb": rank_of(p, i), "value_1qb": to_value(rank_of(p, i)),
    })

if superflex:
    floor_1qb = min(p["value_1qb"] for p in players.values())
    sf_only = 0
    for i, p in enumerate(superflex, start=1):
        name, pos = p.get("player_name"), position_of(p)
        if not name or pos not in ("QB", "RB", "WR", "TE"):
            continue
        key = norm(name) + "|" + pos
        if key not in players:
            # Ranked in Superflex but not in 1QB (usually depth QBs): keep them,
            # with a 1QB value just below the last 1QB-ranked player
            players[key] = {"name": name, "pos": pos, "team": p.get("player_team_id") or p.get("team") or "",
                            "value_1qb": round(floor_1qb * 0.99)}
            sf_only += 1
        players[key]["rank_sf"] = rank_of(p, i)
        players[key]["value_2qb"] = to_value(rank_of(p, i))
    print(f"Added {sf_only} players ranked only in the Superflex list.")
    sf_source = "FantasyPros Superflex rankings"
else:
    sf_source = "1QB rankings with a QB boost (Superflex list unavailable)"

# Any player missing a Superflex value gets the 1QB value with a QB boost
qbs = sorted([p for p in players.values() if p["pos"] == "QB"], key=lambda p: p["rank_1qb"])
qb_rank = {id(p): n for n, p in enumerate(qbs, start=1)}
for p in players.values():
    if "value_2qb" not in p:
        boost = 1.0
        if p["pos"] == "QB":
            r = qb_rank[id(p)]
            boost = 1.7 if r <= 12 else 2.2 if r <= 24 else 1.3
        p["value_2qb"] = min(10000, round(p["value_1qb"] * boost))

# ---------- 3) Fill in players FantasyPros doesn't rank ----------
# Deep bench and taxi players still need a small value, so anyone missing
# from both FantasyPros lists comes from DynastyProcess, always valued
# below the lowest FantasyPros-ranked player.
filled = False
if True:
    print(f"{len(players)} players from FantasyPros. Filling unranked players from DynastyProcess.")
    try:
        with urllib.request.urlopen(DP_CSV, timeout=60) as r:
            rows = list(csv.DictReader(io.StringIO(r.read().decode("utf-8"))))
        floor_1 = min(p["value_1qb"] for p in players.values())
        floor_2 = min(p["value_2qb"] for p in players.values())
        added = 0
        for row in rows:
            pos = (row.get("pos") or "").upper()
            key = norm(row.get("player")) + "|" + pos
            if pos not in ("QB", "RB", "WR", "TE") or key in players:
                continue
            v1, v2 = float(row.get("value_1qb") or 0), float(row.get("value_2qb") or 0)
            if v1 <= 0 and v2 <= 0:
                continue
            # keep every filled player below the lowest FantasyPros player
            players[key] = {"name": row.get("player"), "pos": pos, "team": row.get("team") or "",
                            "value_1qb": round(min(v1, floor_1 * 0.99)), "value_2qb": round(min(v2, floor_2 * 0.99)),
                            "source": "dynastyprocess"}
            added += 1
        filled = added > 0
        print(f"Added {added} deeper players from DynastyProcess.")
    except Exception as e:
        print(f"Couldn't fill from DynastyProcess: {e}")

# ---------- 4) Save ----------
out = {
    "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "source": "FantasyPros dynasty consensus rankings (personal, non-commercial use)",
    "superflex_source": sf_source,
    "filled_from_dynastyprocess": filled,
    "experts_1qb": EXPERTS.get("1QB", 0),
    "experts_sf": EXPERTS.get("Superflex", 0),
    "players": sorted(players.values(), key=lambda p: -p["value_1qb"]),
}
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
with open(OUTPUT, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1)
print(f"Saved {len(out['players'])} players to data/values.json")

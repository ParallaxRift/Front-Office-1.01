# ============================================================
# Front Office: daily FantasyPros value update
#
# Runs on GitHub Actions (three times a day). It:
#   1. Downloads FantasyPros dynasty rankings (1QB and Superflex), keeping each
#      player's AVERAGE expert rank, so gaps and tiers between players show up
#   2. Smooths the average rank over the last 3 days, so one day's shuffle
#      doesn't jolt values
#   3. Adds deeper players from DynastyProcess, continuing the ranking past the
#      last FantasyPros player (no cliff where everyone gets the same value)
#   4. Downloads FantasyPros season projections, so the website can score every
#      player under each league's own rules
#   5. Saves everything to data/values.json for the website, and what
#      FantasyPros answered to data/values-status.json (never the key)
#   6. Keeps a compact daily snapshot in data/history/ (one file per day)
#   7. During the season, switches to rest-of-season projections if FantasyPros offers them
#
# The website turns ranks into values itself (it can fine-tune the curve to
# each league's trades), so this file stores ranks, not final values.
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
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# ---------- Settings you can tweak ----------
SEASON = datetime.now(timezone.utc).year
BASE = "https://api.fantasypros.com/public/v2/json/nfl/{season}/consensus-rankings"
QUERY_1QB = {"type": "dynasty", "scoring": "PPR", "position": "ALL"}
QUERY_SF = {"type": "dynasty", "scoring": "PPR", "position": "OP"}

# Season projections, tried in order until one works (the status file shows which)
PROJ_URLS = [
    "https://api.fantasypros.com/public/v2/json/nfl/{season}/projections?position={pos}&week=0",
    "https://api.fantasypros.com/public/v2/json/nfl/{season}/projections?position={pos}",
    "https://api.fantasypros.com/public/v2/json/nfl/projections?season={season}&position={pos}&week=0",
]
CURVE = 0.0125      # backup curve for values.json's simple value columns (rank 1 = 10,000, rank 100 = 2,901)
SMOOTH_DAYS = 3     # average the expert rank over this many days
FP_PAUSE = 2.0      # seconds between FantasyPros requests (they limit how fast we can ask)
DP_CSV = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-players.csv"
HERE = os.path.dirname(__file__)
OUTPUT = os.path.join(HERE, "..", "data", "values.json")
HISTORY = os.path.join(HERE, "..", "data", "rank-history.json")
STATUS = os.path.join(HERE, "..", "data", "values-status.json")
HISTORY_DIR = os.path.join(HERE, "..", "data", "history")   # one snapshot per day
# ---------------------------------------------

API_KEY = os.environ.get("FANTASYPROS_API_KEY", "").strip()
if not API_KEY:
    sys.exit("No API key found. Add a repository secret named FANTASYPROS_API_KEY.")

status = {"checked": datetime.now(timezone.utc).isoformat(timespec="seconds"), "rankings": {}, "projections": []}
EXPERTS = {}
calls = 0


def fp_get(url):
    """One FantasyPros request: paced, and patient when they say 'too many requests'."""
    global calls
    for wait in (0, 30, 60, 90):
        if wait:
            print(f"FantasyPros asked us to slow down; waiting {wait}s")
            time.sleep(wait)
        if calls:
            time.sleep(FP_PAUSE)
        calls += 1
        req = urllib.request.Request(url, headers={"x-api-key": API_KEY, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read()), 200
        except urllib.error.HTTPError as e:
            if e.code == 429:
                continue
            return None, (e.code, e.read().decode("utf-8", "replace")[:300])
        except Exception as e:
            return None, ("no connection", str(e)[:300])
    return None, (429, "Too Many Requests")


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def first(p, *keys):
    for k in keys:
        v = num(p.get(k)) if isinstance(p, dict) else None
        if v is not None:
            return v
    return None


def fetch_rankings(query, label):
    url = BASE.format(season=SEASON) + "?" + urllib.parse.urlencode(query)
    data, st = fp_get(url)
    if data is None:
        print(f"[{label}] FantasyPros error: {st}")
        status["rankings"][label] = {"status": st[0], "reply": st[1]}
        return []
    players = (data.get("players") if isinstance(data, dict) else data) or []
    if isinstance(data, dict):
        try:
            EXPERTS[label] = int(data.get("total_experts") or 0)
        except (TypeError, ValueError):
            pass
    status["rankings"][label] = {"status": 200, "players": len(players),
                                 "fields": sorted(players[0].keys()) if players else [],
                                 "has_average_rank": bool(players and first(players[0], "rank_ave", "rank_avg", "avg") is not None)}
    print(f"[{label}] {len(players)} players; experts {EXPERTS.get(label, '?')}")
    return players


def position_of(p):
    pos = str(p.get("player_position_id") or p.get("position") or p.get("pos") or "").upper()
    return "".join(ch for ch in pos if ch.isalpha())[:2] or pos


def norm(name):
    name = (name or "").lower().replace(".", "").replace("'", "").replace("-", " ")
    words = [w for w in name.split() if w not in ("jr", "sr", "ii", "iii", "iv", "v")]
    return " ".join("".join(ch for ch in w if ch.isalpha()) for w in words).strip()


def to_value(rank):
    return round(10000 * math.exp(-CURVE * (max(1.0, rank) - 1)))


def parse(list_, label):
    """name|pos -> {name, pos, team, rank (average expert rank), ecr, sd, tier}"""
    out = {}
    for i, p in enumerate(list_, start=1):
        name, pos = p.get("player_name"), position_of(p)
        if not name or pos not in ("QB", "RB", "WR", "TE"):
            continue
        ecr = first(p, "rank_ecr", "ecr", "rank") or float(i)
        ave = first(p, "rank_ave", "rank_avg", "avg") or ecr
        out.setdefault(norm(name) + "|" + pos, {
            "name": name, "pos": pos, "team": p.get("player_team_id") or p.get("team") or "",
            "rank": ave, "ecr": ecr, "sd": first(p, "rank_std", "std_dev", "stdev"), "tier": first(p, "tier")})
    return out


# ---------- 1) Rankings ----------
one_qb = parse(fetch_rankings(QUERY_1QB, "1QB"), "1QB")
superflex = parse(fetch_rankings(QUERY_SF, "Superflex"), "Superflex")
if not one_qb:
    sys.exit("No 1QB rankings came back, so values.json was left unchanged.")

players = {}
for key, p in one_qb.items():
    players[key] = {"name": p["name"], "pos": p["pos"], "team": p["team"], "r1": p["rank"], "sd1": p["sd"], "tier1": p["tier"]}
last1 = max(p["rank"] for p in one_qb.values())
sf_only = sorted((p for k, p in superflex.items() if k not in players), key=lambda p: p["rank"])
for i, p in enumerate(sf_only, start=1):       # ranked in Superflex only (usually depth QBs): place them just after the 1QB list
    players[norm(p["name"]) + "|" + p["pos"]] = {"name": p["name"], "pos": p["pos"], "team": p["team"], "r1": last1 + i}
for key, p in superflex.items():
    players[key].update({"r2": p["rank"], "sd2": p["sd"], "tier2": p["tier"]})
sf_source = "FantasyPros Superflex rankings" if superflex else "1QB rankings with a QB boost (Superflex list unavailable)"
if not superflex:                               # no Superflex list: estimate a Superflex rank from the 1QB one
    qbs = sorted((p for p in players.values() if p["pos"] == "QB"), key=lambda p: p["r1"])
    for n, p in enumerate(qbs, start=1):
        p["_qbn"] = n
    for p in players.values():
        boost = 1.0 if p["pos"] != "QB" else (1.7 if p["_qbn"] <= 12 else 2.2 if p["_qbn"] <= 24 else 1.3)
        p["r2"] = max(1.0, p["r1"] - math.log(boost) / CURVE)
        p.pop("_qbn", None)
last2 = max((p.get("r2") or 0) for p in players.values())
for p in players.values():                      # 1QB-only players: just after the Superflex list
    if p.get("r2") is None:
        last2 += 1
        p["r2"] = last2

# ---------- 2) Smooth the average rank over the last few days ----------
today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
try:
    with open(HISTORY, encoding="utf-8") as f:
        hist = json.load(f)
except Exception:
    hist = {}
hist[today] = {k: [round(p["r1"], 2), round(p["r2"], 2)] for k, p in players.items()}
days = sorted(hist)[-SMOOTH_DAYS:]
hist = {d: hist[d] for d in sorted(hist)[-7:]}   # keep a week
for k, p in players.items():
    seen = [hist[d][k] for d in days if k in hist[d]]
    p["r1"] = round(sum(s[0] for s in seen) / len(seen), 2)
    p["r2"] = round(sum(s[1] for s in seen) / len(seen), 2)
os.makedirs(os.path.dirname(HISTORY), exist_ok=True)
with open(HISTORY, "w", encoding="utf-8") as f:
    json.dump(hist, f, separators=(",", ":"))
status["smoothed_days"] = len(days)

# ---------- 3) Deeper players from DynastyProcess, continuing the ranking ----------
filled = 0
try:
    with urllib.request.urlopen(DP_CSV, timeout=60) as r:
        rows = list(csv.DictReader(io.StringIO(r.read().decode("utf-8"))))
    extra = []
    for row in rows:
        pos = (row.get("pos") or "").upper()
        key = norm(row.get("player")) + "|" + pos
        if pos not in ("QB", "RB", "WR", "TE") or key in players:
            continue
        v1, v2 = num(row.get("value_1qb")) or 0, num(row.get("value_2qb")) or 0
        if v1 <= 0 and v2 <= 0:
            continue
        extra.append((key, row.get("player"), pos, row.get("team") or "", v1, v2))
    m1 = max(p["r1"] for p in players.values())
    m2 = max(p["r2"] for p in players.values())
    for n, (key, name, pos, team, v1, v2) in enumerate(sorted(extra, key=lambda x: -x[4]), start=1):
        players[key] = {"name": name, "pos": pos, "team": team, "r1": m1 + n, "source": "dynastyprocess"}
    for n, (key, *_rest) in enumerate(sorted(extra, key=lambda x: -x[5]), start=1):
        players[key]["r2"] = m2 + n
    filled = len(extra)
    print(f"Added {filled} deeper players from DynastyProcess, ranked after the FantasyPros lists.")
except Exception as e:
    print(f"Couldn't fill from DynastyProcess: {e}")

# ---------- 4) Season projections ----------
PROJ_KEYS = {   # our short name -> names FantasyPros might use
    "py": ("pass_yds", "pass_yd", "passing_yds", "passing_yards"), "ptd": ("pass_tds", "pass_td", "passing_tds"),
    "pint": ("pass_ints", "pass_int", "ints", "interceptions"), "ry": ("rush_yds", "rush_yd", "rushing_yds", "rushing_yards"),
    "rtd": ("rush_tds", "rush_td", "rushing_tds"), "rec": ("rec_rec", "receptions", "rec", "rec_receptions"),
    "recy": ("rec_yds", "rec_yd", "receiving_yds", "receiving_yards"), "rectd": ("rec_tds", "rec_td", "receiving_tds"),
    "fl": ("fumbles", "fum_lost", "fumbles_lost", "fum"),
}
proj_url, proj_count = None, 0
for pos in ("QB", "RB", "WR", "TE"):
    data = None
    for pattern in ([proj_url] if proj_url else PROJ_URLS):
        url = pattern.format(season=SEASON, pos=pos)
        data, st = fp_get(url)
        if data is not None:
            proj_url = pattern
            break
        status["projections"].append({"url": url, "status": st[0], "reply": st[1]})
    if data is None:
        continue
    items = (data.get("players") if isinstance(data, dict) else data) or []
    if items and len(status["projections"]) < 8:
        sample = items[0]
        status["projections"].append({"url": proj_url.format(season=SEASON, pos=pos), "status": 200, "players": len(items),
                                      "fields": sorted(sample.keys()), "stat_fields": sorted((sample.get("stats") or {}).keys())[:40]})
    for it in items:
        stats = it.get("stats") if isinstance(it.get("stats"), dict) else it
        key = norm(it.get("player_name") or it.get("name")) + "|" + pos
        if key not in players:
            continue
        pj = [first(stats, *PROJ_KEYS[k]) or 0 for k in ("py", "ptd", "pint", "ry", "rtd", "rec", "recy", "rectd", "fl")]
        if any(pj):
            players[key]["pj"] = [round(x, 1) for x in pj]
            proj_count += 1
# ---------- 4b) Rest-of-season projections, when FantasyPros offers them ----------
# During the season, rest-of-season projections describe players better than the preseason
# full-season ones. FantasyPros' documentation doesn't say how to ask for them, so this tries a
# few likely ways and only uses an answer that is clearly rest-of-season: passing yards for all
# QBs must come in below 95% of the full-season total. Otherwise the full-season numbers stay.
ROS_PATTERNS = [
    "https://api.fantasypros.com/public/v2/json/nfl/{season}/projections?position={pos}&week=ros",
    "https://api.fantasypros.com/public/v2/json/nfl/{season}/projections?position={pos}&week=ROS",
    "https://api.fantasypros.com/public/v2/json/nfl/{season}/projections?position={pos}&type=ros",
]
def proj_rows(data, pos):
    items = (data.get("players") if isinstance(data, dict) else data) or []
    out = {}
    for it in items:
        stats = it.get("stats") if isinstance(it.get("stats"), dict) else it
        key = norm(it.get("player_name") or it.get("name")) + "|" + pos
        if key in players:
            out[key] = [round(first(stats, *PROJ_KEYS[k]) or 0, 1) for k in ("py", "ptd", "pint", "ry", "rtd", "rec", "recy", "rectd", "fl")]
    return out
status["projection_basis"] = "full season"
status["ros_probe"] = []
season_py = sum(p["pj"][0] for k, p in players.items() if k.endswith("|QB") and p.get("pj"))
if proj_count and season_py > 0:
    ros_url = None
    for pattern in ROS_PATTERNS:
        data, st = fp_get(pattern.format(season=SEASON, pos="QB"))
        rows = proj_rows(data, "QB") if data is not None else {}
        py = sum(v[0] for v in rows.values())
        status["ros_probe"].append({"url": pattern.format(season=SEASON, pos="QB"), "status": st[0] if data is None else 200,
                                    "players": len(rows), "qb_pass_yds_vs_season": round(py / season_py, 3) if season_py else None})
        if rows and 0 < py < 0.95 * season_py:
            ros_url = pattern
            break
    if ros_url:
        ros_count = 0
        for pos in ("QB", "RB", "WR", "TE"):
            data, st = fp_get(ros_url.format(season=SEASON, pos=pos))
            if data is None:
                continue
            for key, pj in proj_rows(data, pos).items():
                if any(pj):
                    players[key]["pj"] = pj
                    ros_count += 1
        if ros_count:
            status["projection_basis"] = "rest of season"
            print(f"Using rest-of-season projections for {ros_count} players")
status["projected_players"] = proj_count
print(f"Projections for {proj_count} players" + (f" from {proj_url.split('?')[0]}" if proj_url else " (none found)"))

# ---------- 5) Save ----------
out_players = []
for p in players.values():
    p["value_1qb"], p["value_2qb"] = to_value(p["r1"]), to_value(p["r2"])   # simple values for older copies of the site
    out_players.append({k: v for k, v in p.items() if v is not None})
out = {
    "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "source": "FantasyPros dynasty consensus rankings (personal, non-commercial use)",
    "superflex_source": sf_source,
    "filled_from_dynastyprocess": filled > 0,
    "experts_1qb": EXPERTS.get("1QB", 0),
    "experts_sf": EXPERTS.get("Superflex", 0),
    "rank_basis": "average expert rank, smoothed over %d days" % len(days),
    "projections": proj_count,
    "projection_basis": status.get("projection_basis", "full season"),
    "players": sorted(out_players, key=lambda p: p["r1"]),
}
with open(OUTPUT, "w", encoding="utf-8") as f:
    json.dump(out, f, separators=(",", ":"))
# Daily snapshot: one compact file per day in data/history/, written by the first update of the day.
# It keeps each player's ranks, spread, tier and projections, so the site can later rebuild any
# league's values as they were on that date (fair grading of old trades, trend charts, accuracy tests).
SNAP_FIELDS = ["name", "pos", "team", "r1", "r2", "sd1", "sd2", "tier1", "tier2", "pj"]
snap_path = os.path.join(HISTORY_DIR, out["updated"][:10] + ".json")
if not os.path.exists(snap_path):
    os.makedirs(HISTORY_DIR, exist_ok=True)
    snap = {"date": out["updated"][:10], "updated": out["updated"], "fields": SNAP_FIELDS,
            "players": [[p.get(k) for k in SNAP_FIELDS] for p in out["players"]]}
    with open(snap_path, "w", encoding="utf-8") as f:
        json.dump(snap, f, separators=(",", ":"))
    print(f"Saved today's snapshot to data/history/{os.path.basename(snap_path)}")
status["snapshot"] = os.path.basename(snap_path)
status["calls"] = calls
with open(STATUS, "w", encoding="utf-8") as f:
    json.dump(status, f, indent=1)
print(f"Saved {len(out_players)} players to data/values.json")

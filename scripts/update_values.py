# ============================================================
# Front Office: daily player card data (career stats + injury history)
#
# Runs on GitHub Actions right after update_values.py. It:
#   1. Downloads Sleeper's player list (to know every QB, RB, WR and TE)
#   2. Downloads Sleeper's season stats for every season since 2012
#      (one request per season; past seasons are saved and not downloaded again)
#   3. Downloads FantasyPros injury reports, week by week, with your API key
#   4. Saves everything to data/players.json for the player cards
#
# The website also asks Sleeper for stats live when a card opens; this file is
# the backup if Sleeper is slow, and the only source for injury history.
#
# Your API key is NOT in this file. GitHub passes it in from the secret
# named FANTASYPROS_API_KEY.
# ============================================================
import json
import os
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

# ---------- Settings you can tweak ----------
FIRST_SEASON = 2012              # oldest season of stats to include
SLEEPER_PLAYERS = "https://api.sleeper.app/v1/players/nfl"
SLEEPER_SEASON = "https://api.sleeper.app/v1/stats/nfl/regular/{season}"

FP_FIRST_SEASON = 2015           # oldest season of FantasyPros injury reports to try
FP_WEEKS = 18
FP_URLS = [   # tried in order until one works; the log shows which
    "https://api.fantasypros.com/public/v2/json/nfl/{season}/injuries?week={week}",
    "https://api.fantasypros.com/public/v2/json/nfl/injuries?season={season}&week={week}",
]

HERE = os.path.dirname(__file__)
OUTPUT = os.path.join(HERE, "..", "data", "players.json")
STATS_CACHE = os.path.join(HERE, "..", "data", "season-stats")
FP_CACHE = os.path.join(HERE, "..", "data", "fp-injuries")
# ---------------------------------------------

POSITIONS = ("QB", "RB", "WR", "TE")
now = datetime.now(timezone.utc)
CURRENT = now.year if now.month >= 8 else now.year - 1      # NFL season starts in September
API_KEY = os.environ.get("FANTASYPROS_API_KEY", "").strip()


def get_json(url, headers=None):
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "front-office", **(headers or {})})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def norm(name):
    name = (name or "").lower().replace(".", "").replace("'", "").replace("-", " ")
    words = [w for w in name.split() if w not in ("jr", "sr", "ii", "iii", "iv", "v")]
    return " ".join("".join(ch for ch in w if ch.isalpha()) for w in words).strip()


# ---------- 1) Who are the players? ----------
try:
    sleeper = get_json(SLEEPER_PLAYERS)
except Exception as e:
    raise SystemExit(f"Couldn't download Sleeper's player list ({e}), so players.json was left unchanged.")
skill = {pid: p for pid, p in sleeper.items() if p.get("position") in POSITIONS}
by_name = {}
for pid, p in skill.items():
    nm = p.get("full_name") or f"{p.get('first_name', '')} {p.get('last_name', '')}"
    key = norm(nm) + "|" + p["position"]
    # prefer the player who is on a team (two players can share a name)
    if key not in by_name or (p.get("team") and not skill[by_name[key]].get("team")):
        by_name[key] = pid
print(f"{len(skill)} QBs, RBs, WRs and TEs on Sleeper")

players = defaultdict(lambda: {"s": [], "i": []})

# ---------- 2) Season stats from Sleeper ----------
os.makedirs(STATS_CACHE, exist_ok=True)
for y in range(FIRST_SEASON, CURRENT + 1):
    path = os.path.join(STATS_CACHE, f"{y}.json")
    if y < CURRENT and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            season = json.load(f)
    else:
        try:
            raw = get_json(SLEEPER_SEASON.format(season=y))
        except Exception as e:
            print(f"{y}: couldn't download stats ({e})")
            continue
        season = {}
        for pid, x in (raw or {}).items():
            if pid not in skill or not isinstance(x, dict) or not x.get("gp"):
                continue
            v = lambda k: round(float(x.get(k) or 0), 1)
            # [games, cmp, att, pass yds, pass td, int, carries, rush yds, rush td,
            #  targets, rec, rec yds, rec td, fumbles lost, PPR fantasy points]
            season[pid] = [v("gp"), v("pass_cmp"), v("pass_att"), v("pass_yd"), v("pass_td"), v("pass_int"),
                           v("rush_att"), v("rush_yd"), v("rush_td"), v("rec_tgt"), v("rec"), v("rec_yd"),
                           v("rec_td"), v("fum_lost"), v("pts_ppr")]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(season, f, separators=(",", ":"))
        time.sleep(0.5)
    for pid, row in season.items():
        # [season, team, ...stats]; team is filled in live by the website
        players[pid]["s"].append([y, ""] + [int(n) if n == int(n) else n for n in row])
    print(f"{y}: {len(season)} player seasons")

# ---------- 3) FantasyPros injury reports ----------
def pick(d, *keys):
    for k in keys:
        v = d.get(k) if isinstance(d, dict) else None
        if isinstance(v, dict):
            v = v.get("name") or v.get("abbr") or v.get("id")
        if v not in (None, ""):
            return str(v).strip()
    return ""


def flatten(data):
    """Find the list of injury records wherever FantasyPros puts it."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in ("injuries", "players", "data", "items", "results"):
            if isinstance(data.get(k), list):
                return data[k]
        for v in data.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
    return []


fp_url, fp_logged = None, False


def fp_week(season, week):
    """One week of injury records as [name, pos, team, status, injury] rows. None = request failed."""
    global fp_url, fp_logged
    for pattern in ([fp_url] if fp_url else FP_URLS):
        url = pattern.format(season=season, week=week)
        try:
            data = get_json(url, {"x-api-key": API_KEY})
        except urllib.error.HTTPError as e:
            if not fp_url:
                print(f"[FP injuries] {url.split('?')[0]} -> error {e.code}: {e.read().decode('utf-8', 'replace')[:200]}")
            continue
        except Exception as e:
            print(f"[FP injuries] could not reach FantasyPros: {e}")
            return None
        items = flatten(data)
        if not fp_logged:
            print(f"[FP injuries] Using {pattern.split('?')[0]}")
            print(f"[FP injuries] Top-level fields: {list(data.keys()) if isinstance(data, dict) else 'list'}")
            if items:
                print(f"[FP injuries] Fields on each record: {sorted(items[0].keys())}")
                print(f"[FP injuries] Sample record: {json.dumps(items[0])[:400]}")
            fp_logged = True
        fp_url = pattern
        rows = []
        for it in items:
            name = pick(it, "player_name", "name", "full_name", "player")
            pos = pick(it, "player_position_id", "position", "pos").upper()[:2]
            if name and pos in POSITIONS + ("FB",):
                rows.append([name, pos, pick(it, "player_team_id", "team", "team_id"),
                             pick(it, "injury_status", "status", "game_status", "designation", "report_status"),
                             pick(it, "injury", "injury_type", "injury_body_part", "body_part", "injury_desc", "description")])
        return rows
    return None


def fp_status(text):
    """Which column a status counts in: 4 Out, 5 Doubtful, 6 Questionable, 7 IR/PUP."""
    t = (text or "").lower()
    if "question" in t: return 6
    if "doubt" in t: return 5
    if t in ("ir", "pup", "nfi") or "reserve" in t or "pup" in t or "injured" in t: return 7
    if t.startswith("out") or t == "o": return 4
    return None


NOT_INJURIES = ("coach", "rest", "not injury", "non-injury", "non injury", "personal", "suspen", "team decision")
fp_seasons = {}
if not API_KEY:
    print("[FP injuries] No FANTASYPROS_API_KEY secret, so cards will have no injury history.")
else:
    os.makedirs(FP_CACHE, exist_ok=True)
    for y in range(FP_FIRST_SEASON, CURRENT + 1):
        path = os.path.join(FP_CACHE, f"{y}.json")
        if y < CURRENT and os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                fp_seasons[y] = json.load(f)
            continue
        weeks, failed = {}, False
        for w in range(1, FP_WEEKS + 1):
            rows = fp_week(y, w)
            if rows is None:
                failed = True
                break
            if rows:
                weeks[str(w)] = rows
            time.sleep(0.25)          # be gentle with the API
        if failed:
            print(f"[FP injuries] {y}: request failed")
            if fp_url is None:
                break                 # no URL pattern works, so stop trying
            continue
        # Some APIs ignore the week and return the same list every time; that isn't weekly history
        if len(weeks) >= 10 and len({json.dumps(v, sort_keys=True) for v in weeks.values()}) == 1:
            print(f"[FP injuries] {y}: every week came back identical (current statuses only), so it isn't used as history")
            continue
        with open(path, "w", encoding="utf-8") as f:
            json.dump(weeks, f, separators=(",", ":"))
        fp_seasons[y] = weeks
        print(f"[FP injuries] {y}: {sum(len(v) for v in weeks.values())} records across {len(weeks)} weeks")

# One line per player, season and injury: first and last week listed, and how many
# weeks he was listed Out, Doubtful, Questionable, or on Injured Reserve / PUP.
unmatched = set()
for y, weeks in fp_seasons.items():
    spells = {}
    for w, rows in (weeks or {}).items():
        w = int(w)
        for name, pos, team, status, injury in rows:
            col = fp_status(status)
            injury = (injury or "Not listed").strip().title()
            if col is None or any(x in injury.lower() for x in NOT_INJURIES):
                continue
            pid = by_name.get(norm(name) + "|" + ("RB" if pos == "FB" else pos))
            if not pid:
                unmatched.add(name)
                continue
            s = spells.setdefault((pid, injury), [y, injury, w, w, 0, 0, 0, 0, set()])
            if w in s[8]:
                continue
            s[8].add(w)
            s[2], s[3] = min(s[2], w), max(s[3], w)
            s[col] += 1
    for (pid, _), s in spells.items():
        players[pid]["i"].append(s[:8])     # [season, injury, first wk, last wk, out, doubtful, questionable, IR/PUP]
if unmatched:
    print(f"[FP injuries] {len(unmatched)} names didn't match a Sleeper player, e.g. {sorted(unmatched)[:5]}")

# ---------- 4) Save ----------
# Keep players who are on a team or played/were hurt in the last five seasons (their whole career is kept)
recent = CURRENT - 4
players = {pid: p for pid, p in players.items()
           if skill.get(pid, {}).get("team") or any(r[0] >= recent for r in p["s"]) or any(r[0] >= recent for r in p["i"])}
for p in players.values():
    p["s"].sort(key=lambda r: r[0])
    p["i"].sort(key=lambda r: (-r[0], r[2]))
out = {
    "updated": now.isoformat(timespec="seconds"),
    "source": "Sleeper (season stats) and FantasyPros (injury reports)",
    "season": CURRENT,
    "fp_injury_seasons": sorted(y for y, w in fp_seasons.items() if w),
    "players": players,
}
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
with open(OUTPUT, "w", encoding="utf-8") as f:
    json.dump(out, f, separators=(",", ":"))
print(f"Saved {len(players)} players to data/players.json ({os.path.getsize(OUTPUT) // 1024} KB)")

# ============================================================
# Front Office: daily player card data (career stats + injury history)
#
# Runs on GitHub Actions right after update_values.py. It:
#   1. Downloads Sleeper's player list (to know every QB, RB, WR and TE)
#   2. Downloads Sleeper's season stats for every season since 2012
#      (one request per season; past seasons are saved and not downloaded again)
#   3. Downloads FantasyPros injury reports, week by week, and the latest
#      injury news, with your API key
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
SLEEPER_STATE = "https://api.sleeper.app/v1/state/nfl"

FP_WEEKS = 18                    # FantasyPros only reports the CURRENT season, so each season is saved
                                 # as it happens and becomes history the next year
FP_URLS = [   # tried in order until one works; data/fp-status.json shows which
    "https://api.fantasypros.com/public/v2/json/nfl/injuries?season={season}&week={week}",
    "https://api.fantasypros.com/public/v2/json/nfl/{season}/injuries?week={week}",
]
FP_NEWS_URLS = [   # latest injury news; tried in order until one works
    "https://api.fantasypros.com/public/v2/json/nfl/news?category=injury&limit=500",
    "https://api.fantasypros.com/public/v2/json/nfl/news?category=injury",
    "https://api.fantasypros.com/public/v2/json/nfl/news",
]
FP_PAUSE = 2.5                   # seconds between FantasyPros requests (they limit how fast we can ask)
FP_MAX_CALLS = 45                # FantasyPros requests per run; older seasons fill in over a few runs
NEWS_DAYS = 45                   # ignore injury news older than this

HERE = os.path.dirname(__file__)
OUTPUT = os.path.join(HERE, "..", "data", "players.json")
STATS_CACHE = os.path.join(HERE, "..", "data", "season-stats")
STATUS_FILE = os.path.join(HERE, "..", "data", "fp-status.json")   # what FantasyPros answered (never the key)
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

# ---------- 3) FantasyPros: injury news, then weekly injury reports ----------
def pick(d, *keys):
    for k in keys:
        v = d.get(k) if isinstance(d, dict) else None
        if isinstance(v, dict):
            v = v.get("name") or v.get("abbr") or v.get("id")
        if v not in (None, ""):
            return str(v).strip()
    return ""


def flatten(data):
    """Find the list of records wherever FantasyPros puts it."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in ("injuries", "players", "data", "items", "results", "news"):
            if isinstance(data.get(k), list):
                return data[k]
        for v in data.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
    return []


fp_report = {"checked": now.isoformat(timespec="seconds"), "key_present": bool(API_KEY), "calls": 0,
             "rate_limited": 0, "injuries": [], "news": [], "seasons": {}}
fp_stop = False          # set when FantasyPros keeps saying "too many requests"


def note(kind, url, **info):
    """Remember what FantasyPros said (status, short reply), so it can be checked without the log."""
    if len(fp_report[kind]) < 8:
        fp_report[kind].append({"url": url, **info})


def fp_get(url):
    """One FantasyPros request: paced, and patient when they say 'too many requests'.
    Returns (data, status). data is None if it failed."""
    global fp_stop
    if fp_stop or fp_report["calls"] >= FP_MAX_CALLS:
        return None, "budget"
    for wait in (0, 30, 60, 90):
        if wait:
            print(f"[FP] FantasyPros asked us to slow down; waiting {wait}s")
            time.sleep(wait)
        if fp_report["calls"]:
            time.sleep(FP_PAUSE)
        fp_report["calls"] += 1
        try:
            return get_json(url, {"x-api-key": API_KEY}), 200
        except urllib.error.HTTPError as e:
            if e.code == 429:
                fp_report["rate_limited"] += 1
                continue
            return None, (e.code, e.read().decode("utf-8", "replace")[:300])
        except Exception as e:
            return None, ("no connection", str(e)[:300])
    fp_stop = True
    print("[FP] Still rate-limited after waiting; the rest will be collected on the next run")
    return None, (429, "Too Many Requests")


def row_of(it):
    """[name, pos, team, status, injury, comment, chance of playing, practice 1-3, updated]"""
    return [pick(it, "name", "player_name", "full_name", "player"),
            pick(it, "position_id", "player_position_id", "position", "pos").upper()[:2],
            pick(it, "team_id", "player_team_id", "team"),
            pick(it, "status", "injury_status", "game_status", "designation", "report_status"),
            pick(it, "injury_type", "injury", "injury_body_part", "body_part", "practice_report_injury_type"),
            pick(it, "comment", "notes", "note"),
            pick(it, "probability_of_playing"),
            pick(it, "practice_1"), pick(it, "practice_2"), pick(it, "practice_3"),
            pick(it, "injury_update_date", "updated", "date")]


fp_url = None


def fp_week(season, week):
    """One week of injury rows; None if the request failed."""
    global fp_url
    for pattern in ([fp_url] if fp_url else FP_URLS):
        url = pattern.format(season=season, week=week)
        data, status = fp_get(url)
        if data is None:
            if not fp_url:
                note("injuries", url, status=status[0] if isinstance(status, tuple) else status,
                     reply=status[1] if isinstance(status, tuple) else "")
            if status == "budget" or fp_stop:
                return None
            continue
        items = flatten(data)
        if not fp_url:
            note("injuries", url, status=200, records=len(items), sample=json.dumps(items[0])[:300] if items else None)
            print(f"[FP injuries] Using {pattern.split('?')[0]}")
        fp_url = pattern
        return [r for r in (row_of(it) for it in items) if r[0] and r[1] in POSITIONS + ("FB",)]
    return None


def fp_status(text):
    """Which column a status counts in: 4 Out, 5 Doubtful, 6 Questionable, 7 IR/PUP."""
    t = (text or "").lower()
    if "question" in t: return 6
    if "doubt" in t: return 5
    if t in ("ir", "pup", "nfi") or "reserve" in t or "pup" in t or "injured" in t: return 7
    if t.startswith("out") or t == "o": return 4
    return None


def pid_of(name, pos):
    return by_name.get(norm(name) + "|" + ("RB" if pos == "FB" else pos))


NOT_INJURIES = ("coach", "rest", "not injury", "non-injury", "non injury", "personal", "suspen", "team decision",
                "retire", "other", "holdout", "unsigned", "released", "exempt")
news_count = 0
fp_seasons = {}
if not API_KEY:
    print("[FP] No FANTASYPROS_API_KEY secret, so cards will have no injury history or news.")
else:
    # 3a) News first: one request, so it never gets squeezed out by the weekly reports
    names = sorted(((p.get("full_name") or "", pid) for pid, p in skill.items() if p.get("team") and p.get("full_name")),
                   key=lambda x: -len(x[0]))
    items = []
    for url in FP_NEWS_URLS:
        data, status = fp_get(url)
        if data is None:
            note("news", url, status=status[0] if isinstance(status, tuple) else status, reply=status[1] if isinstance(status, tuple) else "")
            if fp_stop:
                break
            continue
        items = flatten(data)
        note("news", url, status=200, records=len(items), sample=json.dumps(items[0])[:300] if items else None)
        break
    cutoff = now.timestamp() - NEWS_DAYS * 86400
    for it in items:
        title = pick(it, "title", "headline")
        desc = pick(it, "desc", "description", "body", "summary", "news")
        when = pick(it, "created", "date", "published", "updated")
        try:
            ts = datetime.fromisoformat(when.replace("Z", "+00:00").replace(" ", "T")).timestamp() if when else now.timestamp()
        except ValueError:
            ts = now.timestamp()
        if ts < cutoff or not title:
            continue
        who = pick(it, "player_name", "name")
        pid = pid_of(who, pick(it, "position_id", "position").upper()[:2]) if who else None
        if not pid:
            low = title.lower()
            pid = next((pid for nm, pid in names if nm.lower() in low), None)
        if pid and len(players[pid].setdefault("n", [])) < 3:
            players[pid]["n"].append([datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d"), title[:200], desc[:600]])
            news_count += 1
    print(f"[FP news] {len(items)} items, {news_count} matched to players")

    # 3b) Weekly injury reports. FantasyPros only has the current season (asking for an older season
    # returns this season again), and it returns leftovers for weeks not played yet, so we ask only
    # for weeks 1 through the current week. Each season's file is kept and becomes history next year.
    fp_season, week_now = CURRENT, 0          # week 0 = not in season (or Sleeper didn't answer): download nothing new
    try:
        state = get_json(SLEEPER_STATE)
        fp_season = int(state.get("season") or CURRENT)
        if state.get("season_type") == "regular":
            week_now = min(FP_WEEKS, int(state.get("display_week") or state.get("week") or 0))
        elif state.get("season_type") == "post":
            week_now = FP_WEEKS                # regular season is over; make sure every week is saved
    except Exception as e:
        print(f"[FP injuries] couldn't get the current NFL week from Sleeper ({e}); keeping what's saved")
    fp_report["current_week"] = week_now
    os.makedirs(FP_CACHE, exist_ok=True)
    for name in os.listdir(FP_CACHE):
        path = os.path.join(FP_CACHE, name)
        try:
            with open(path, encoding="utf-8") as f:
                saved = json.load(f)
            y = int(name.split(".")[0])
        except Exception:
            continue
        if saved.get("verified") and saved.get("season") == y:
            fp_seasons[y] = saved["weeks"]
        else:
            os.remove(path)                                      # files from before this fix weren't real history
            print(f"[FP injuries] removed {name}: FantasyPros returned this season's reports for it")
    weeks = dict(fp_seasons.get(fp_season, {}))
    if week_now:
        path = os.path.join(FP_CACHE, f"{fp_season}.json")
        weeks = {w: v for w, v in weeks.items() if int(w) <= week_now}   # drop leftovers for weeks not played yet
        have = sorted(int(w) for w in weeks)
        start = max(1, (have[-1] - 1) if have else 1)                   # re-check the latest weeks; reports change all week
        for w in range(start, week_now + 1):
            rows = fp_week(fp_season, w)
            if rows is None:
                break                                                   # FantasyPros didn't answer; keep what we have
            weeks[str(w)] = rows
        if weeks:
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"season": fp_season, "verified": True, "weeks": weeks}, f, separators=(",", ":"))
            fp_seasons[fp_season] = weeks
        print(f"[FP injuries] {fp_season}: {sum(len(v) for v in weeks.values())} records across {len(weeks)} weeks (through week {week_now})")
    else:
        print("[FP injuries] Not in the regular season or playoffs, so nothing new to download")
    fp_report["seasons"] = {str(y): f"{len(w)} weeks" for y, w in sorted(fp_seasons.items())}

# Turn the weekly reports into one line per player, season and injury.
unmatched = set()
for y, weeks in fp_seasons.items():
    spells = {}
    last_injury = {}                       # a player's most recent named injury this season
    first_named = {}                       # ...and his first named one, for blank weeks before it
    for w, rows in sorted(weeks.items(), key=lambda kv: int(kv[0])):
        for r in rows:
            pid = pid_of(r[0], r[1])
            if pid and (r[4] or "").strip() and pid not in first_named:
                first_named[pid] = r[4].strip().title()
    for w, rows in sorted(weeks.items(), key=lambda kv: int(kv[0])):
        w = int(w)
        for r in rows:
            name, pos, status = r[0], r[1], r[3]
            comment = (r[5] if len(r) > 5 else "").lower()
            col = fp_status(status)
            if col is None or any(x in (r[4] or "").lower() or x in comment for x in NOT_INJURIES):
                continue
            pid = pid_of(name, pos)
            if not pid:
                unmatched.add(name)
                continue
            # Players who stay on IR often lose the injury name in later reports; carry it forward
            injury = (r[4] or "").strip().title() or last_injury.get(pid) or first_named.get(pid) or "Undisclosed"
            last_injury[pid] = injury
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

# This week's FantasyPros details for anyone on the latest report (chance of playing, practices, comment)
cur = fp_seasons.get(fp_season if API_KEY else CURRENT) or {}
if cur:
    wk = max(int(w) for w in cur)
    for r in cur[str(wk)]:
        pid = pid_of(r[0], r[1])
        if pid and len(r) >= 11 and not any(x in (r[5] or "").lower() for x in ("retire", "other")):
            players[pid]["c"] = {"wk": wk, "st": r[3], "inj": r[4], "note": r[5][:400], "prob": r[6],
                                 "prac": [x for x in r[7:10] if x], "upd": r[10]}

# ---------- 4) Save ----------
# Keep players who are on a team or played/were hurt in the last five seasons (their whole career is kept)
recent = CURRENT - 4
players = {pid: p for pid, p in players.items()
           if skill.get(pid, {}).get("team") or p.get("n") or p.get("c") or any(r[0] >= recent for r in p["s"]) or any(r[0] >= recent for r in p["i"])}
for p in players.values():
    p["s"].sort(key=lambda r: r[0])
    p["i"].sort(key=lambda r: (-r[0], r[2]))
out = {
    "updated": now.isoformat(timespec="seconds"),
    "source": "Sleeper (season stats) and FantasyPros (injury reports)",
    "season": CURRENT,
    "fp_injury_seasons": sorted(y for y, w in fp_seasons.items() if any(w.values())),
    "players": players,
}
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
fp_report["injury_seasons_saved"] = out["fp_injury_seasons"]
fp_report["players_with_this_week"] = sum(1 for p in players.values() if p.get("c"))
fp_report["news_matched"] = news_count
with open(STATUS_FILE, "w", encoding="utf-8") as f:
    json.dump(fp_report, f, indent=1)
with open(OUTPUT, "w", encoding="utf-8") as f:
    json.dump(out, f, separators=(",", ":"))
print(f"Saved {len(players)} players to data/players.json ({os.path.getsize(OUTPUT) // 1024} KB)")

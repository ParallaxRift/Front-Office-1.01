# ============================================================
# Front Office: daily player card data (career stats)
#
# Runs on GitHub Actions 3 times a day. Everything comes from Sleeper:
#   1. Downloads Sleeper's player list (to know every QB, RB, WR and TE) and saves
#      a trimmed copy for the website (data/sleeper-players.json)
#   2. Downloads Sleeper's season stats for every season since 2012
#      (one request per season; past seasons are saved and not downloaded again)
#   3. Saves the stats to data/players.json for the player cards
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

HERE = os.path.dirname(__file__)
OUTPUT = os.path.join(HERE, "..", "data", "players.json")
STATS_CACHE = os.path.join(HERE, "..", "data", "season-stats")
# ---------------------------------------------

POSITIONS = ("QB", "RB", "WR", "TE")
now = datetime.now(timezone.utc)
CURRENT = now.year if now.month >= 8 else now.year - 1      # NFL season starts in September


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

# Save a trimmed copy of Sleeper's player list for the website. Sleeper asks apps to download this big
# file at most once a day and keep their own copy, so the site loads this file instead of asking Sleeper
# on every visit (it's also much faster on phones). Only players who could be on a roster are kept, and
# Sleeper's cross-site ID numbers and search helpers are dropped. The site falls back to Sleeper itself if
# this file is missing or more than three days old.
SITE_PLAYERS = os.path.join(HERE, "..", "data", "sleeper-players.json")
DROP_FIELDS = {"espn_id", "yahoo_id", "sportradar_id", "fantasy_data_id", "rotowire_id", "rotoworld_id", "gsis_id",
               "stats_id", "swish_id", "pandascore_id", "oddsjam_id", "opta_id", "kalshi_id", "hashtag", "high_school",
               "search_first_name", "search_last_name", "search_full_name", "birth_city", "birth_state", "birth_country",
               "sport", "competitions", "team_changed_at", "news_updated", "team_abbr"}
try:
    keep = {}
    for pid, p in sleeper.items():
        if not isinstance(p, dict): continue
        if not (p.get("team") or p.get("active") or p.get("position") == "DEF"): continue   # retired, never-signed
        q = {k: v for k, v in p.items() if k not in DROP_FIELDS and v not in (None, "", [], {})}
        if isinstance(q.get("metadata"), dict):
            q["metadata"] = {k: v for k, v in q["metadata"].items() if k == "rookie_year"} or None
            if not q["metadata"]: del q["metadata"]
        keep[pid] = q
    if len(keep) > 1500:                     # a sane list; never replace a good file with a broken download
        with open(SITE_PLAYERS, "w") as f:
            json.dump({"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "players": keep},
                      f, separators=(",", ":"), sort_keys=True)
        print(f"Saved {len(keep)} Sleeper players for the website (data/sleeper-players.json)")
    else:
        print(f"Only {len(keep)} Sleeper players came back; kept the old data/sleeper-players.json")
except Exception as e:
    print(f"Couldn't save data/sleeper-players.json ({e}); the site will ask Sleeper directly")
skill = {pid: p for pid, p in sleeper.items() if p.get("position") in POSITIONS}
by_name = {}
for pid, p in skill.items():
    nm = p.get("full_name") or f"{p.get('first_name', '')} {p.get('last_name', '')}"
    key = norm(nm) + "|" + p["position"]
    # prefer the player who is on a team (two players can share a name)
    if key not in by_name or (p.get("team") and not skill[by_name[key]].get("team")):
        by_name[key] = pid
print(f"{len(skill)} QBs, RBs, WRs and TEs on Sleeper")

players = defaultdict(lambda: {"s": []})

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

# ---------- 3) Save ----------
# Keep players who are on a team or played/were hurt in the last five seasons (their whole career is kept)
recent = CURRENT - 4
players = {pid: p for pid, p in players.items()
           if skill.get(pid, {}).get("team") or any(r[0] >= recent for r in p["s"])}
for p in players.values():
    p["s"].sort(key=lambda r: r[0])
out = {
    "updated": now.isoformat(timespec="seconds"),
    "source": "Sleeper (season stats)",
    "season": CURRENT,
    "players": players,
}
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
with open(OUTPUT, "w", encoding="utf-8") as f:
    json.dump(out, f, separators=(",", ":"))
print(f"Saved {len(players)} players to data/players.json ({os.path.getsize(OUTPUT) // 1024} KB)")

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
import re
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
raw_current = {}

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
            if y == CURRENT:
                raw_current = raw          # kept for this season's usage shares (step 3)
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

# ---------- 3) Usage trends and depth chart moves (for the player cards) ----------
# Usage: share of his team's offensive snaps, and of its targets + carries ("opportunity share"),
# over the last 3 weeks played vs. the whole season, plus carries + catches per game.
# Depth moves: each player's depth chart spot (RB1, WR3...) is saved once per NFL week in
# data/depth-history.json, so the card can say "up from WR3 last week".
DEPTH_HISTORY = os.path.join(HERE, "..", "data", "depth-history.json")
SLEEPER_WEEK = "https://api.sleeper.app/v1/stats/nfl/regular/{season}/{week}"
try:
    state = get_json(SLEEPER_STATE)
    season_now = int(state.get("season") or CURRENT)
    week_now = int(state.get("week") or 0) if state.get("season_type") == "regular" else 0
except Exception as e:
    print(f"[usage] couldn't get the NFL week from Sleeper ({e})")
    season_now, week_now = CURRENT, 0


def usage(weeks):
    team_opp, out = defaultdict(float), {}
    for w in weeks:
        for pid, x in (w or {}).items():
            t = skill.get(pid, {}).get("team")
            if t and isinstance(x, dict):
                team_opp[t] += float(x.get("rec_tgt") or 0) + float(x.get("rush_att") or 0)
    for w in weeks:
        for pid, x in (w or {}).items():
            if pid not in skill or not isinstance(x, dict):
                continue
            o = out.setdefault(pid, {"snp": 0.0, "tsnp": 0.0, "opp": 0.0, "touch": 0.0, "gp": 0.0})
            o["snp"] += float(x.get("off_snp") or 0); o["tsnp"] += float(x.get("tm_off_snp") or 0)
            o["opp"] += float(x.get("rec_tgt") or 0) + float(x.get("rush_att") or 0)
            o["touch"] += float(x.get("rush_att") or 0) + float(x.get("rec") or 0)
            o["gp"] += float(x.get("gp") or (1 if x.get("off_snp") else 0))
    for pid, o in out.items():
        t = team_opp.get(skill[pid].get("team"), 0)
        o["share"] = o["opp"] / t if t else 0
    return out


if week_now > 1:
    recent_weeks = []
    for w in range(max(1, week_now - 3), week_now):
        try:
            recent_weeks.append(get_json(SLEEPER_WEEK.format(season=season_now, week=w)))
            time.sleep(0.5)
        except Exception as e:
            print(f"[usage] week {w}: {e}")
    l3, full = usage(recent_weeks), usage([raw_current])
    r2 = lambda v: round(v, 3)
    for pid, o in l3.items():
        if o["gp"] <= 0:
            continue
        f_ = full.get(pid)
        players[pid]["u"] = [r2(o["snp"] / o["tsnp"]) if o["tsnp"] else None, r2(f_["snp"] / f_["tsnp"]) if f_ and f_["tsnp"] else None,
                             r2(o["share"]), r2(f_["share"]) if f_ else None, round(o["touch"] / o["gp"], 1), len(recent_weeks)]
    print(f"[usage] {sum(1 for p in players.values() if p.get('u'))} players, weeks {week_now - len(recent_weeks)}-{week_now - 1}")

# depth chart labels the way the site shows them: RB1, QB2, WR3 (receivers ranked across left, right and slot)
GRP = {"LWR": "WR", "RWR": "WR", "SWR": "WR", "WR": "WR", "QB": "QB", "RB": "RB", "TE": "TE"}
groups = defaultdict(list)
for pid, p in skill.items():
    g, o = GRP.get(p.get("depth_chart_position") or ""), p.get("depth_chart_order")
    if p.get("team") and g == p.get("position") and o:
        groups[(p["team"], g)].append((int(o), p.get("search_rank") or 10 ** 9, pid))
labels = {}
for (team, g), arr in groups.items():
    for i, (_, _, pid) in enumerate(sorted(arr)):
        labels[pid] = f"{g}{i + 1}"
if week_now:
    try:
        with open(DEPTH_HISTORY, encoding="utf-8") as f:
            hist = json.load(f)
    except (OSError, ValueError):
        hist = {}
    if hist.get("season") != season_now:
        hist = {"season": season_now, "weeks": {}}
    hist["weeks"][str(week_now)] = labels                          # the latest run of the week wins
    hist["weeks"] = {w: v for w, v in hist["weeks"].items() if int(w) >= week_now - 2}
    with open(DEPTH_HISTORY, "w", encoding="utf-8") as f:
        json.dump(hist, f, separators=(",", ":"))
    before = hist["weeks"].get(str(week_now - 1)) or {}
    moves = 0
    for pid, now_label in labels.items():
        was = before.get(pid)
        if was and was != now_label:
            players[pid]["dm"] = was; moves += 1
    print(f"[depth] {moves} depth chart moves since last week")

# ---------- 4) Save ----------
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

# ---------- 5) Value history: one snapshot of the Front Office Rankings per update ----------
# Reads the public rankings file the Rankings Desk publishes (Pat's own two lists) and keeps every
# player's spot in data/value-history.json, one entry per day the rankings change, so the player
# card can chart how his value has moved. A failure here never stops the rest of the update.
RANKINGS_URL = "https://parallaxrift.github.io/The-Desk---Rankings/rankings.json"
VALUE_HISTORY = os.path.join(HERE, "..", "data", "value-history.json")
HISTORY_MAX = 260                 # about 5 years of weekly updates


def name_key(name, pos):
    """Same as the website's normName(name) + "|" + pos, so the two always match."""
    n = (name or "").lower()
    n = re.sub(r"[.'’`]", "", n).replace("-", " ")
    n = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", n)
    n = re.sub(r"[^a-z ]", "", n)
    return re.sub(r"\s+", " ", n).strip() + "|" + str(pos or "").upper()


try:
    rk = get_json(RANKINGS_URL + "?t=" + str(int(time.time())))
    try:
        with open(VALUE_HISTORY, encoding="utf-8") as f:
            vh = json.load(f)
    except (OSError, ValueError):
        vh = {}
    vh.setdefault("dates", []); vh.setdefault("published", []); vh.setdefault("sf", {}); vh.setdefault("1qb", {})
    published = str(rk.get("updated") or "")
    if published and published not in vh["published"]:
        day = published[:10]
        if vh["dates"] and vh["dates"][-1] == day:          # published again the same day: the newest list wins
            i = len(vh["dates"]) - 1; vh["published"][i] = published
        else:
            vh["dates"].append(day); vh["published"].append(published); i = len(vh["dates"]) - 1
        for fmt in ("sf", "1qb"):
            spots, seen = {}, set()
            for p in (rk.get("lists") or {}).get(fmt) or []:
                k = name_key(p.get("name"), p.get("pos"))
                if k in seen:
                    continue
                seen.add(k); spots[k] = len(seen)
            table = vh[fmt]
            for k in set(table) | set(spots):
                row = table.setdefault(k, [])
                row.extend([0] * (i + 1 - len(row)))          # 0 = not on the list that day
                row[i] = spots.get(k, 0)
                del row[i + 1:]
        # keep the newest snapshots only, and drop players who are on none of them
        cut = max(0, len(vh["dates"]) - HISTORY_MAX)
        vh["dates"], vh["published"] = vh["dates"][cut:], vh["published"][cut:]
        for fmt in ("sf", "1qb"):
            vh[fmt] = {k: r[cut:] for k, r in vh[fmt].items() if any(r[cut:])}
        with open(VALUE_HISTORY, "w", encoding="utf-8") as f:
            json.dump(vh, f, separators=(",", ":"))
        print(f"[history] saved the rankings published {published} ({len(vh['dates'])} snapshots)")
    else:
        print("[history] rankings unchanged since the last snapshot")
except Exception as e:
    print(f"[history] skipped: {e}")

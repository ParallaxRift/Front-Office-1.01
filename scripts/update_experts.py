# ============================================================
# Rankings Desk: reference rankings from outside sources
#
# Runs on GitHub Actions in THIS (private) repository only, every morning and
# whenever you press "Run workflow". It downloads, for Superflex and 1QB:
#   - FantasyPros dynasty expert consensus (needs your API key) + their season projections
#   - DynastyProcess dynasty values (free open data on GitHub)
#   - FantasyCalc dynasty values, built from real trades (free public API)
# and saves them all to data/experts.json. If one source fails, the others are still saved,
# and data/experts.json says which source failed and why (the Desk shows this at the top).
#
# That file stays private: the website is published only from the docs/ folder,
# so data/ is never on the public site, and Front Office never sees it.
# The Desk uses it to pre-fill your lists (FantasyPros first, then the others) and
# as comparison columns.
#
# Your API key is NOT in this file. GitHub passes it in from the repository
# secret named FANTASYPROS_API_KEY.
# ============================================================
import csv
import io
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

SEASON = datetime.now(timezone.utc).year
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "experts.json")
API_KEY = os.environ.get("FANTASYPROS_API_KEY", "").strip()
POS = ("QB", "RB", "WR", "TE")

FP_RANKINGS = "https://api.fantasypros.com/public/v2/json/nfl/{season}/consensus-rankings"
FP_QUERIES = {"1qb": {"type": "dynasty", "scoring": "PPR", "position": "ALL"},
              "sf": {"type": "dynasty", "scoring": "PPR", "position": "OP"}}
FP_PROJ = ["https://api.fantasypros.com/public/v2/json/nfl/{season}/projections?position={pos}&week=0",
           "https://api.fantasypros.com/public/v2/json/nfl/{season}/projections?position={pos}"]
DP_CSV = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-players.csv"
FC_API = "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs={qbs}&numTeams=12&ppr=1"


def fetch(url, headers=None, raw=False):
    """One request, patient with 'too many requests'. Raises RuntimeError with a short reason."""
    for wait in (0, 20, 45):
        if wait:
            print(f"  asked to slow down; waiting {wait}s")
            time.sleep(wait)
        req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "rankings-desk", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
                return body.decode("utf-8", "replace") if raw else json.loads(body)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                continue
            raise RuntimeError(f"error {e.code}: {e.read().decode('utf-8', 'replace')[:160]}")
        except Exception as e:
            raise RuntimeError(str(e)[:160])
    raise RuntimeError("kept saying 'too many requests'")


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def ranked(rows):
    """Sort by value/rank and number them 1, 2, 3..."""
    for i, p in enumerate(rows):
        p["rank"] = i + 1
    return rows


now = datetime.now(timezone.utc).isoformat(timespec="seconds")
out = {"updated": now, "sources": {}, "experts": {}, "sf": [], "1qb": [], "proj": [], "dp": {}, "fc": {}}
try:
    with open(OUT, encoding="utf-8") as f:
        old = json.load(f)       # keep the last good copy of any source that fails today
except (OSError, ValueError):
    old = {}


def keep_old(key, why):
    out["sources"][key] = {"ok": False, "why": why, "updated": old.get("sources", {}).get(key, {}).get("updated", "")}
    if key == "fp":
        for k in ("sf", "1qb", "proj", "experts"):
            if old.get(k):
                out[k] = old[k]
    elif old.get(key):
        out[key] = old[key]
    print(f"[{key}] FAILED: {why} (kept the previous copy if there was one)")


# ---------- 1) FantasyPros expert consensus + projections ----------
def fantasypros():
    if not API_KEY:
        raise RuntimeError("no API key: add a repository secret named FANTASYPROS_API_KEY")
    hdr = {"x-api-key": API_KEY}
    for fmt, q in FP_QUERIES.items():
        data = fetch(FP_RANKINGS.format(season=SEASON) + "?" + urllib.parse.urlencode(q), hdr)
        time.sleep(2)
        rows = (data.get("players") if isinstance(data, dict) else data) or []
        if isinstance(data, dict):
            out["experts"][fmt] = int(data.get("total_experts") or 0)
        players = []
        for p in rows:
            pos = "".join(ch for ch in str(p.get("player_position_id") or "").upper() if ch.isalpha())[:2]
            avg = num(p.get("rank_ave")) or num(p.get("rank_ecr"))
            if pos in POS and avg is not None:
                players.append({"name": p.get("player_name", ""), "pos": pos, "team": p.get("player_team_id") or "", "avg": round(avg, 2)})
        if len(players) < 100:
            raise RuntimeError(f"only {len(players)} {fmt} players came back")
        out[fmt] = ranked(sorted(players, key=lambda x: x["avg"]))
        print(f"[fp] {fmt}: {len(players)} players from {out['experts'].get(fmt, '?')} experts")
    # season projections (reference on the Projections tab); a failure here doesn't fail the rankings
    keys = {"py": ("pass_yds", "pass_yd", "passing_yds"), "ptd": ("pass_tds", "pass_td", "passing_tds"),
            "pint": ("pass_ints", "pass_int", "ints", "interceptions"), "ry": ("rush_yds", "rush_yd", "rushing_yds"),
            "rtd": ("rush_tds", "rush_td", "rushing_tds"), "rec": ("rec_rec", "receptions", "rec"),
            "recy": ("rec_yds", "rec_yd", "receiving_yds"), "rectd": ("rec_tds", "rec_td", "receiving_tds"),
            "fl": ("fumbles", "fum_lost", "fumbles_lost")}
    first = lambda d, ks: next((num(d.get(k)) for k in ks if isinstance(d, dict) and num(d.get(k)) is not None), 0) or 0
    for pos in POS:
        data = None
        for pattern in FP_PROJ:
            try:
                data = fetch(pattern.format(season=SEASON, pos=pos), hdr)
                break
            except RuntimeError as e:
                print(f"[fp] projections {pos}: {e}")
            finally:
                time.sleep(2)
        for it in ((data.get("players") if isinstance(data, dict) else data) or []):
            st = it.get("stats") if isinstance(it.get("stats"), dict) else it
            pj = [round(first(st, keys[k]), 1) for k in ("py", "ptd", "pint", "ry", "rtd", "rec", "recy", "rectd", "fl")]
            if any(pj):
                out["proj"].append({"name": it.get("player_name") or it.get("name") or "", "pos": pos, "pj": pj})
    qb_top = max([p["pj"][0] for p in out["proj"] if p["pos"] == "QB"] or [0])
    if 0 < qb_top < 1500:                        # weekly numbers: scale to a 17-game season
        for p in out["proj"]:
            p["pj"] = [round(x * 17, 1) for x in p["pj"]]
    print(f"[fp] projections for {len(out['proj'])} players")


# ---------- 2) DynastyProcess values ----------
def dynastyprocess():
    text = fetch(DP_CSV, raw=True)
    rows = list(csv.DictReader(io.StringIO(text)))
    for fmt, col in (("sf", "value_2qb"), ("1qb", "value_1qb")):
        players = [{"name": r.get("player", ""), "pos": (r.get("pos") or "").upper(), "team": r.get("team") or "", "value": num(r.get(col)) or 0}
                   for r in rows if (r.get("pos") or "").upper() in POS and r.get("player")]
        if len(players) < 100:
            raise RuntimeError(f"only {len(players)} players in the file")
        out["dp"][fmt] = ranked(sorted(players, key=lambda x: -x["value"]))
    print(f"[dp] {len(out['dp']['sf'])} players")


# ---------- 3) FantasyCalc values (from real trades) ----------
def fantasycalc():
    for fmt, qbs in (("sf", 2), ("1qb", 1)):
        data = fetch(FC_API.format(qbs=qbs))
        time.sleep(1)
        players = []
        for it in data or []:
            p = it.get("player") or {}
            pos = str(p.get("position") or "").upper()
            if pos in POS and p.get("name"):
                players.append({"name": p["name"], "pos": pos, "id": str(p.get("sleeperId") or ""), "value": num(it.get("value")) or 0})
        if len(players) < 100:
            raise RuntimeError(f"only {len(players)} players came back")
        out["fc"][fmt] = ranked(sorted(players, key=lambda x: -x["value"]))
    print(f"[fc] {len(out['fc']['sf'])} players")


for key, job in (("fp", fantasypros), ("dp", dynastyprocess), ("fc", fantasycalc)):
    try:
        job()
        out["sources"][key] = {"ok": True, "updated": now}
    except RuntimeError as e:
        keep_old(key, str(e))

if not any(s.get("ok") for s in out["sources"].values()) and not old:
    raise SystemExit("Every source failed and there's no earlier copy, so nothing was saved.")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, separators=(",", ":"))
print("Saved data/experts.json:", {k: ("ok" if v["ok"] else "failed: " + v["why"]) for k, v in out["sources"].items()})

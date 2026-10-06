// Front Office: Live Scores tab
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// LIVE SCORES TAB
// Sleeper updates matchup points during games. While this tab is
// open on the current week, it refreshes every 60 seconds.
// ============================================================
const REFRESH_MS = 60000;
let scoresTimer = null, scoresLeague = null;
function currentWeek(){
  const st = S.nflState || {};
  if (st.season_type === "regular" || st.season_type === "post") return Math.min(18, Math.max(1, st.display_week || st.week || 1));
  return 1;
}
function setupScores(){
  const last = S.league.settings?.last_scored_leg || 18;
  const weeks = Math.max(17, Math.min(18, S.league.settings?.playoff_week_start ? S.league.settings.playoff_week_start + 3 : 18));
  $("weekSelect").innerHTML = Array.from({length: weeks}, (_,i) => `<option value="${i+1}">Week ${i+1}${i+1===currentWeek() && S.nflState?.season_type==="regular" ? " (this week)" : ""}</option>`).join("");
  $("weekSelect").value = currentWeek();
  scoresLeague = null;
  $("matchups").innerHTML = "";
  if ($("panel-scores").classList.contains("on")) loadScores();
}
$("weekSelect").addEventListener("change", () => loadScores());
$("refreshScores").addEventListener("click", () => loadScores());
document.addEventListener("visibilitychange", () => { if (!document.hidden && $("panel-scores").classList.contains("on")) loadScores(); });

// Exact fantasy points, shown with both decimal places (e.g. 1.52, 18.50) so nothing is cut off
const ptsText = v => (Math.round(Number(v || 0) * 100) / 100).toFixed(2);
// Headshot for a player, or the NFL team logo for team defenses (their ID is the team abbreviation)
function scorePhoto(pid, pl){
  const isDef = pl?.pos === "DEF" || /^[A-Z]{2,3}$/.test(pid);
  const url = isDef ? `https://sleepercdn.com/images/team_logos/nfl/${String(pid).toLowerCase()}.png` : PLAYER_IMG(pid);
  return avatar(url, pl?.name || "", "xs").replace('class="av', 'class="av pl');
}
function playerLabel(pid){
  if (!pid || pid === "0") return null;
  const p = S.sleeperPlayers?.[pid];
  if (!p) return { name: pid, pos: "DEF" };
  if (p.position === "DEF") return { name: `${p.first_name||""} ${p.last_name||""}`.trim() || pid, pos: "DEF" };
  return { name: p.full_name || `${p.first_name||""} ${p.last_name||""}`.trim(), pos: p.position };
}

// Which NFL games haven't kicked off yet, from ESPN's public scoreboard (no key needed).
// Players on those teams show "–" instead of 0.00. If it can't be reached, scores show as before.
const ESPN_TEAM = { WSH: "WAS" };   // ESPN abbreviations that differ from Sleeper's
async function loadGameStatus(week){
  try {
    const season = Number(S.nflState?.season) || new Date().getFullYear();
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`);
    if (!r.ok) return null;
    const d = await r.json(), status = {};
    for (const ev of d.events || []){
      const state = ev.status?.type?.state || ev.competitions?.[0]?.status?.type?.state;   // "pre", "in" or "post"
      for (const c of ev.competitions?.[0]?.competitors || []){
        const ab = c.team?.abbreviation; if (ab) status[ESPN_TEAM[ab] || ab] = state;
      }
    }
    return Object.keys(status).length ? status : null;
  } catch(e){ return null; }
}
// The latest regular-season week whose games are all final (ESPN). If ESPN can't be reached,
// fall back to the week before Sleeper's current week.
async function lastFinishedWeek(){
  const wk = currentWeek();
  const st = await loadGameStatus(wk);
  if (st && Object.values(st).every(x => x === "post")) return wk;
  return wk - 1;
}
const notStarted = pid => {
  if (!S.gameStatus) return false;
  const team = /^[A-Z]{2,3}$/.test(pid) ? pid : S.sleeperPlayers?.[pid]?.team;
  if (!team) return false;
  return !S.gameStatus[team] || S.gameStatus[team] === "pre";      // no game listed = bye week
};
async function loadScores(){
  clearTimeout(scoresTimer);
  if (!S.league) return;
  const week = Number($("weekSelect").value || currentWeek());
  const leagueId = S.league.league_id;
  if (scoresLeague !== leagueId + ":" + week) $("matchups").innerHTML = `<p class="empty">Loading week ${week}...</p>`;
  try {
    const live0 = week === currentWeek() && S.nflState?.season_type === "regular";
    const [data, games] = await Promise.all([getJSON(`/league/${leagueId}/matchups/${week}`), live0 ? loadGameStatus(week) : null]);
    S.gameStatus = games;
    if (S.league.league_id !== leagueId) return; // user switched leagues mid-load
    scoresLeague = leagueId + ":" + week;
    renderScores(data || [], week);
    const live = week === currentWeek() && S.nflState?.season_type === "regular";
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
    $("scoresUpdated").innerHTML = live ? `<span class="live-dot"></span>Live, updated ${time}. Refreshes every minute.` : `Updated ${time}`;
    if (live && !document.hidden && $("panel-scores").classList.contains("on")) scoresTimer = setTimeout(loadScores, REFRESH_MS);
  } catch(err){
    console.error(err);
    $("scoresUpdated").textContent = "Couldn't load scores. Check your connection and tap Refresh.";
  }
}

function renderScores(data, week){
  const slots = (S.cfg.rp || []).filter(x => !["BN","IR","TAXI"].includes(x));
  const slotName = { SUPER_FLEX:"SF", FLEX:"FLX", WRRB_FLEX:"W/R", REC_FLEX:"W/T", IDP_FLEX:"IDP" };
  const groups = new Map();
  for (const m of data){ if (m.matchup_id == null) continue; if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []); groups.get(m.matchup_id).push(m); }
  if (!groups.size){
    $("matchups").innerHTML = `<p class="empty">No matchups scheduled for week ${week}. Pick another week.</p>`;
    return;
  }
  const pts = m => Number(m.custom_points ?? m.points ?? 0);
  const list = [...groups.values()].sort((a,b) => (b.some(m=>m.roster_id===S.myRid)) - (a.some(m=>m.roster_id===S.myRid)));
  $("matchups").innerHTML = list.map(pair => {
    const mine = pair.some(m => m.roster_id === S.myRid);
    if (mine) pair.sort((a,b) => (b.roster_id===S.myRid) - (a.roster_id===S.myRid));
    const top = Math.max(...pair.map(pts));
    const anyPts = pair.some(m => pts(m) > 0);
    const row = m => { const t = S.teams.get(m.roster_id);
      return `<div class="mu-row${anyPts && pts(m) === top ? " lead" : ""}">${teamPhoto(m.roster_id, "md")}
        <span class="mu-name"><b>${esc(t?.name || "Team " + m.roster_id)}</b>${t?.manager && t.manager !== t.name ? `<small>${esc(t.manager)}</small>` : ""}</span>
        <span class="mu-pts">${pts(m).toFixed(2)}</span></div>`; };
    const lineup = m => (m.starters || []).map((pid, i) => {
      const pl = playerLabel(pid), sp = m.starters_points?.[i];
      const slot = slotName[slots[i]] || slots[i] || "";
      const raw = sp ?? m.players_points?.[pid];
      return pl ? `<div class="lu"><span><i>${esc(slot)}</i>${scorePhoto(pid, pl)}${esc(pl.name)}${injTag(pid)}</span><b>${notStarted(pid) && !Number(raw) ? "–" : ptsText(raw)}</b></div>`
                : `<div class="lu empty"><span><i>${esc(slot)}</i>Empty</span><b>0.00</b></div>`;
    }).join("");
    // Bench = everyone on the roster who isn't starting, highest scorers first
    const benchOf = m => {
      const starters = new Set(m.starters || []);
      return (m.players || []).filter(pid => pid && pid !== "0" && !starters.has(pid))
        .map(pid => ({ pid, pl: playerLabel(pid), p: Number(m.players_points?.[pid] ?? 0) }))
        .filter(x => x.pl).sort((a, b) => b.p - a.p);
    };
    const bench = m => { const b = benchOf(m);
      return b.length ? b.map(x => `<div class="lu"><span><i>${esc(x.pl.pos || "BN")}</i>${scorePhoto(x.pid, x.pl)}${esc(x.pl.name)}${injTag(x.pid)}</span><b>${notStarted(x.pid) && !x.p ? "–" : ptsText(x.p)}</b></div>`).join("")
        + `<div class="lu total"><span>Bench total</span><b>${ptsText(b.reduce((s, x) => s + x.p, 0))}</b></div>`
        : `<div class="lu empty"><span>No bench players</span><b></b></div>`; };
    return `<article class="mu${mine ? " mine" : ""}">${mine ? `<div class="mu-tag">Your matchup</div>` : ""}
      ${pair.map(row).join("")}
      ${pair.length === 2 ? `<details${mine ? " open" : ""}><summary>Starting Lineups</summary><div class="lineups"><div>${lineup(pair[0])}</div><div>${lineup(pair[1])}</div></div></details>
      <details><summary>Bench</summary><div class="lineups"><div>${bench(pair[0])}</div><div>${bench(pair[1])}</div></div></details>` : ""}
    </article>`;
  }).join("");
}


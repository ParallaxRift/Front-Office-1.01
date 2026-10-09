// Front Office: Live Scores tab
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// LIVE SCORES TAB
// Sleeper updates matchup points during games. While this tab is
// open on the current week, it refreshes every 60 seconds.
// ============================================================
const REFRESH_MS = 60000;
let scoresTimer = null, scoresLeague = null;
// The week flips every Tuesday at 6 a.m. Central (11:00 UTC; 5 a.m. once daylight saving ends), right after
// Monday Night Football, instead of waiting for Sleeper, which moves on Wednesday. Weeks are counted from
// the Tuesday before the season's opening Thursday (Sleeper's season_start_date). If that date is
// missing, Sleeper's own week is used.
const WEEK_FLIP_UTC_HOUR = 11;
function flipWeek(st){
  const d = /^\d{4}-\d{2}-\d{2}$/.test(st.season_start_date || "") ? new Date(st.season_start_date + "T00:00:00Z") : null;
  if (!d || isNaN(d)) return null;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - 2 + 7) % 7));    // back to the Tuesday on or before kickoff
  d.setUTCHours(WEEK_FLIP_UTC_HOUR);
  return Math.floor((Date.now() - d.getTime()) / (7 * 864e5)) + 1;
}
function currentWeek(){
  const st = S.nflState || {};
  if (st.season_type === "regular" || st.season_type === "post"){
    const sleeper = st.display_week || st.week || 1, mine = flipWeek(st);
    // trust the date math only when it's within a week of Sleeper's count (protects against odd schedules)
    const wk = mine && Math.abs(mine - sleeper) <= 1 ? mine : sleeper;
    return Math.min(18, Math.max(1, wk));
  }
  return 1;
}
// If the site stays open across Tuesday morning, move Live Scores to the new week on its own,
// unless you picked a different week yourself.
let autoWeek = null;
setInterval(() => {
  if (!S.league || autoWeek === null) return;
  const now = currentWeek();
  if (now !== autoWeek && Number($("weekSelect").value) === autoWeek) setupScores();
}, 60000);
function setupScores(){
  const last = S.league.settings?.last_scored_leg || 18;
  const weeks = Math.max(17, Math.min(18, S.league.settings?.playoff_week_start ? S.league.settings.playoff_week_start + 3 : 18));
  $("weekSelect").innerHTML = Array.from({length: weeks}, (_,i) => `<option value="${i+1}">Week ${i+1}${i+1===currentWeek() && S.nflState?.season_type==="regular" ? " (this week)" : ""}</option>`).join("");
  $("weekSelect").value = autoWeek = currentWeek();
  scoresLeague = null;
  $("matchups").innerHTML = "";
  if ($("panel-scores").classList.contains("on")) loadScores();
}
$("weekSelect").addEventListener("change", () => loadScores());

$("refreshScores").addEventListener("click", () => loadScores());
// click (or Enter on) a player in a matchup to open his player card
$("matchups").addEventListener("click", e => { const c = e.target.closest(".bx-p[data-pid]"); if (c) openPlayerCard(c.dataset.pid); });
$("matchups").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const c = e.target.closest(".bx-p[data-pid]"); if (c){ e.preventDefault(); openPlayerCard(c.dataset.pid); }
});
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
    const ahead = week >= currentWeek() && S.nflState?.season_type === "regular";   // projections for this week and weeks to come
    const season = Number(S.nflState?.season) || new Date().getFullYear();
    const [data, games, proj] = await Promise.all([getJSON(`/league/${leagueId}/matchups/${week}`), live0 ? loadGameStatus(week) : null,
      ahead && typeof weekProjections === "function" ? weekProjections(season, week).catch(() => null) : null]);
    S.scoreProj = proj;
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
  // Each matchup is a small scoreboard: both teams face to face with their scores and a bar for who's
  // ahead, a "yet to play" line during the live week, then one side-by-side box score for the starting
  // lineups (and the bench), so you compare slot by slot instead of reading two separate lists.
  const slots = (S.cfg.rp || []).filter(x => !["BN","IR","TAXI"].includes(x));
  const slotName = { SUPER_FLEX:"SF", FLEX:"FLX", WRRB_FLEX:"W/R", REC_FLEX:"W/T", IDP_FLEX:"IDP" };
  const groups = new Map();
  for (const m of data){ if (m.matchup_id == null) continue; if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []); groups.get(m.matchup_id).push(m); }
  if (!groups.size){
    $("matchups").innerHTML = `<p class="empty">No matchups scheduled for week ${week}. Pick another week.</p>`;
    $("scoresRecap").innerHTML = "";
    return;
  }
  const pts = m => Number(m.custom_points ?? m.points ?? 0);
  const live = !!S.gameStatus && week === currentWeek();
  const gameOf = pid => { const team = /^[A-Z]{2,3}$/.test(pid) ? pid : S.sleeperPlayers?.[pid]?.team; return team ? S.gameStatus?.[team] || "pre" : "bye"; };
  const statusLine = m => {
    if (!live) return "";
    const st = (m.starters || []).filter(pid => pid && pid !== "0").map(gameOf);
    const left = st.filter(x => x === "pre").length, now = st.filter(x => x === "in").length;
    return [now ? `<b>${now}</b> playing` : "", left ? `<b>${left}</b> yet to play` : "", !now && !left ? "All done" : ""].filter(Boolean).join(" · ");
  };
  const list = [...groups.values()].sort((a,b) => (b.some(m=>m.roster_id===S.myRid)) - (a.some(m=>m.roster_id===S.myRid)));
  // Projected final (this week and upcoming weeks): points so far, plus Sleeper's projection for starters yet to play
  // and half of what's left of the projection for starters playing now
  const final = !live && (week < currentWeek() || S.nflState?.season_type !== "regular");
  const projOf = m => {
    if (final || !S.scoreProj) return null;
    let t = 0, left = 0;
    (m.starters || []).forEach((pid, i) => {
      if (!pid || pid === "0") return;
      const got = Number(m.starters_points?.[i] ?? m.players_points?.[pid] ?? 0), g = gameOf(pid), pr = S.scoreProj.get(String(pid));
      const pp = pr ? leaguePoints(pr.st, S.sleeperPlayers?.[pid]?.position) : 0;
      if (g === "pre"){ t += pp; left += pp; } else if (g === "in"){ const r = Math.max(0, pp - got) * 0.5; t += got + r; left += r; } else t += got;
    });
    return { t, left };
  };
  const winChance = (pa, pb) => { if (!pa || !pb) return null; const sd = Math.max(3, Math.sqrt(pa.left + pb.left) * 2.2); return 0.5 * (1 + erf((pa.t - pb.t) / sd / Math.SQRT2)); };
  const cell = (pid, raw, side) => {
    if (!pid || pid === "0") return `<span class="bx-p ${side} empty"><span class="bx-nm">Empty</span><b>0.00</b></span>`;
    const pl = playerLabel(pid); if (!pl) return `<span class="bx-p ${side} empty"><span class="bx-nm">Unknown</span><b>–</b></span>`;
    const g = live ? gameOf(pid) : "", v = notStarted(pid) && !Number(raw) ? "–" : ptsText(raw);
    const canOpen = pl.pos !== "DEF" && !/^[A-Z]{2,3}$/.test(pid) && S.sleeperPlayers?.[pid];
    return `<span class="bx-p ${side}${g === "in" ? " now" : ""}${canOpen ? ` click" data-pid="${esc(pid)}" role="button" tabindex="0" title="Open ${esc(pl.name)}'s player card` : ""}">${scorePhoto(pid, pl)}<span class="bx-nm"><b>${esc(pl.name)}${injTag(pid)}</b><small>${esc([pl.pos, pl.team].filter(Boolean).join(" · "))}</small></span><b class="bx-v">${v}</b></span>`;
  };
  $("matchups").innerHTML = list.map(pair => {
    const mine = pair.some(m => m.roster_id === S.myRid);
    if (mine) pair.sort((a,b) => (b.roster_id===S.myRid) - (a.roster_id===S.myRid));
    const [A, B] = pair, a = pts(A), b = B ? pts(B) : 0, any = a + b > 0;
    const pA = projOf(A), pB = B ? projOf(B) : null, wA = B ? winChance(pA, pB) : null;
    const team = (m, side) => { const t = S.teams.get(m.roster_id), lead = any && pts(m) === Math.max(a, b), pr = m === A ? pA : pB, wc = wA == null ? null : m === A ? wA : 1 - wA;
      const res = final && B && any ? (lead && a !== b ? `<span class="sb-res w">W</span>` : a === b ? `<span class="sb-res t">T</span>` : `<span class="sb-res l">L</span>`) : "";
      return `<div class="sb-team ${side}${lead ? " lead" : ""}">${teamPhoto(m.roster_id, "md")}<span class="sb-nm"><b>${esc(t?.name || "Team " + m.roster_id)}</b>${t?.manager && t.manager !== t.name ? `<small>${esc(t.manager)}</small>` : ""}${statusLine(m) ? `<small class="sb-st">${statusLine(m)}</small>` : ""}${pr ? `<small class="sb-proj">Proj ${pr.t.toFixed(1)}${wc != null ? ` · <b>${Math.round(wc * 100)}%</b> to win` : ""}</small>` : ""}</span><span class="sb-pts">${res}${pts(m).toFixed(2)}</span></div>`; };
    if (!B) return `<article class="mb${mine ? " mine" : ""}"><div class="sb">${team(A, "l")}</div></article>`;
    // the bar splits the projected final (once a week is over, the actual final score)
    const pTot = pA && pB ? pA.t + pB.t : 0;
    const share = pTot > 0 ? Math.round(pA.t / pTot * 100) : any ? Math.round(a / (a + b) * 100) : 50;
    const rows = slots.map((slot, i) => `<div class="bx-row">${cell(A.starters?.[i], A.starters_points?.[i] ?? A.players_points?.[A.starters?.[i]], "l")}<span class="bx-slot">${esc(slotName[slot] || slot)}</span>${cell(B.starters?.[i], B.starters_points?.[i] ?? B.players_points?.[B.starters?.[i]], "r")}</div>`).join("");
    const benchOf = m => { const st = new Set(m.starters || []);
      return (m.players || []).filter(pid => pid && pid !== "0" && !st.has(pid) && playerLabel(pid)).map(pid => ({ pid, p: Number(m.players_points?.[pid] ?? 0) })).sort((x, y) => y.p - x.p); };
    const bA = benchOf(A), bB = benchOf(B), n = Math.max(bA.length, bB.length);
    const bench = n ? Array.from({ length: n }, (_, i) => `<div class="bx-row">${bA[i] ? cell(bA[i].pid, bA[i].p, "l") : `<span class="bx-p l none"></span>`}<span class="bx-slot">BN</span>${bB[i] ? cell(bB[i].pid, bB[i].p, "r") : `<span class="bx-p r none"></span>`}</div>`).join("")
      + `<div class="bx-row bx-total"><span class="bx-p l"><span class="bx-nm">Bench total</span><b class="bx-v">${ptsText(bA.reduce((s, x) => s + x.p, 0))}</b></span><span class="bx-slot"></span><span class="bx-p r"><span class="bx-nm">Bench total</span><b class="bx-v">${ptsText(bB.reduce((s, x) => s + x.p, 0))}</b></span></div>`
      : `<p class="note">No bench players.</p>`;
    return `<article class="mb${mine ? " mine" : ""}">${mine ? `<div class="mb-tag">Your matchup${final ? " · Final" : live ? " · Live" : ""}</div>` : final ? `<div class="mb-tag quiet">Final</div>` : ""}
      <div class="sb">${team(A, "l")}<span class="sb-vs">vs</span>${team(B, "r")}</div>
      <div class="sb-bar" role="img" aria-label="${esc(S.teams.get(A.roster_id)?.name || "")} ${pTot > 0 ? `has ${share}% of the projected points` : `has ${share}% of the points`}"><i style="width:${share}%"></i></div>
      <details${mine ? " open" : ""}><summary>Box score</summary><div class="bx">${rows}</div></details>
      <details><summary>Bench</summary><div class="bx">${bench}</div></details>
    </article>`;
  }).join("");
  // ---- week recap: high and low score, closest game, biggest win ----
  const games = list.filter(g => g.length === 2 && pts(g[0]) + pts(g[1]) > 0), all = list.flat().filter(m => pts(m) > 0);
  if (!all.length){ $("scoresRecap").innerHTML = ""; return; }
  const nm = m => esc(S.teams.get(m.roster_id)?.name || "Team " + m.roster_id);
  const hi = all.reduce((x, y) => pts(y) > pts(x) ? y : x), lo = all.reduce((x, y) => pts(y) < pts(x) ? y : x);
  const gap = g => Math.abs(pts(g[0]) - pts(g[1])), close = games.length ? games.reduce((x, y) => gap(y) < gap(x) ? y : x) : null, blow = games.length ? games.reduce((x, y) => gap(y) > gap(x) ? y : x) : null;
  const winner = g => pts(g[0]) >= pts(g[1]) ? g[0] : g[1], loser = g => winner(g) === g[0] ? g[1] : g[0];
  const avg = all.reduce((t, m) => t + pts(m), 0) / all.length;
  const tile = (k, big, sub) => `<div class="pj-tile"><small>${k}</small><b>${big}</b><span>${sub}</span></div>`;
  $("scoresRecap").innerHTML = `<div class="pj-tiles">
    ${tile(live ? "Top score so far" : "High score", ptsText(pts(hi)), nm(hi))}
    ${tile(live ? "Lowest so far" : "Low score", ptsText(pts(lo)), nm(lo))}
    ${close ? tile(live ? "Closest right now" : "Closest game", ptsText(gap(close)), `${nm(winner(close))} over ${nm(loser(close))}`) : ""}
    ${blow ? tile(live ? "Biggest lead" : "Biggest win", ptsText(gap(blow)), `${nm(winner(blow))} over ${nm(loser(blow))}`) : ""}
    ${tile("League average", ptsText(avg), `Week ${week}`)}
  </div>`;
}

// Front Office: Lineup & Waivers tab (My Team)
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// LINEUP & WAIVERS
// Start/sit: each player gets a start score that blends two things, both in THIS league's points:
//  - 65%: Sleeper's projection for the week, scored with the league's rules
//  - 35%: what a player of his value usually scores (his overall and position value in this league,
//    turned into points from how every player at his position is projected this week)
// so one soft weekly projection doesn't bench a much better player. Questionable counts 90%, doubtful
// 35%; out, IR and bye weeks count 0. Starters already set in Sleeper get a half-point edge, so near
// ties don't flip your lineup. Then it compares the best lineup with the one set in Sleeper.
// Waivers: unrostered players by dynasty value (stash) and by this week's projection (streamers),
// marked when they'd start for you, plus your lowest-value bench players as drop candidates.
// ============================================================
const LU = { week: null, cache: new Map() };
const LU_AVAIL = { Questionable: 0.9, Doubtful: 0.35, Out: 0, IR: 0, PUP: 0, NFI: 0, Sus: 0, COV: 0 };
const LU_PROJ_W = 0.65, LU_KEEP = 0.5;   // weight on this week's projection; edge for players already set in Sleeper
const LU_SLOT_LABEL = { SUPER_FLEX: "Superflex", FLEX: "Flex", WRRB_FLEX: "W/R Flex", REC_FLEX: "W/T Flex" };
// Every player's projected stats for one week, in one request (Sleeper)
async function weekProjections(season, week){
  const k = season + "|" + week;
  if (LU.cache.has(k)) return LU.cache.get(k);
  const pos = ["QB", "RB", "WR", "TE"].map(p => "position[]=" + p).join("&");
  const tries = [`https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular&${pos}`, `https://api.sleeper.app/v1/projections/nfl/regular/${season}/${week}`];
  for (const url of tries){
    try {
      const r = await fetch(url); if (!r.ok) continue;
      const d = await r.json(), m = new Map();
      if (Array.isArray(d)) for (const e of d){ if (e?.player_id && e.stats) m.set(String(e.player_id), { st: e.stats, opp: e.opponent || "" }); }
      else for (const [pid, st] of Object.entries(d || {})) if (st && typeof st === "object") m.set(String(pid), { st: st.stats || st, opp: st.opponent || "" });
      if (m.size){ LU.cache.set(k, m); return m; }
    } catch(e){}
  }
  return null;
}
function luPlayer(a, proj){
  const sp = S.sleeperPlayers?.[a.pid] || {}, p = proj?.get(String(a.pid));
  const bye = !p || !p.st || Object.keys(p.st).length === 0;
  const pts = bye ? 0 : leaguePoints(p.st, a.pos), st = sp.injury_status, avail = bye ? 0 : st in LU_AVAIL ? LU_AVAIL[st] : 1;
  return { a, pts, opp: p?.opp || "", bye, st, avail };
}
// Points a player of a given value usually scores this week, per position: a straight-line fit of this
// week's projections against league value, over every healthy, projected player at that position
function valueToPoints(proj){
  const fit = {};
  for (const pos of ["QB", "RB", "WR", "TE"]){
    const pts = [...S.assets.values()].filter(a => a.kind === "player" && a.pos === pos && a.value > 300).map(a => luPlayer(a, proj)).filter(p => !p.bye && p.pts > 0 && p.avail === 1).map(p => [p.a.value, p.pts]);
    if (pts.length < 8){ fit[pos] = null; continue; }
    const mx = pts.reduce((t, x) => t + x[0], 0) / pts.length, my = pts.reduce((t, x) => t + x[1], 0) / pts.length;
    const b = Math.max(0, pts.reduce((t, x) => t + (x[0] - mx) * (x[1] - my), 0) / Math.max(1, pts.reduce((t, x) => t + (x[0] - mx) ** 2, 0)));
    fit[pos] = v => Math.max(0, my + b * (v - mx));
  }
  return fit;
}
function scorePlayers(list, fit, setNow){
  for (const p of list){
    p.talent = fit[p.a.pos] ? fit[p.a.pos](p.a.value) : p.pts;
    p.score = p.avail ? (LU_PROJ_W * p.pts + (1 - LU_PROJ_W) * p.talent) * p.avail + (setNow.has(String(p.a.pid)) ? LU_KEEP : 0) : 0;
    p.exp = p.score;   // (waivers compare on the same score)
  }
  return list;
}
// Best lineup: strict slots first (QB, RB...), then the flex spots, each with the best start score left
// (ties go to the more valuable player)
function bestLineup(players, slots){
  const pool = [...players].sort((x, y) => y.score - x.score || y.a.value - x.a.value), used = new Set(), out = [];
  const order = slots.map((s, i) => ({ s, i })).filter(x => SLOT_OK[x.s]).sort((x, y) => SLOT_OK[x.s].length - SLOT_OK[y.s].length);
  for (const { s, i } of order){
    const p = pool.find(q => !used.has(q.a.id) && SLOT_OK[s].includes(q.a.pos));
    if (p) used.add(p.a.id);
    out[i] = { s, p: p || null };
  }
  return { slots: out.filter(Boolean), used };
}
const luRank = a => [a.lgPosRank ? a.pos + a.lgPosRank : "", a.lgRank ? "#" + a.lgRank + " overall" : ""].filter(Boolean).join(", ");
// Why one player starts over another, in plain words
function luWhy(p, o){
  if (!o) return "";
  if (!o.avail) return ` ${esc(o.a.name)} is ${o.bye ? "on bye" : o.st === "IR" ? "on IR" : esc(String(o.st).toLowerCase())}.`;
  if (p.pts >= o.pts + 0.5 && p.a.value >= o.a.value) return " Higher projection and the better player.";
  if (p.pts >= o.pts + 0.5) return ` Projected ${(p.pts - o.pts).toFixed(1)} more points this week.`;
  if (p.a.value > o.a.value) return ` A lower projection this week, but the clearly better player (${esc(luRank(p.a))} vs. ${esc(luRank(o.a))}).`;
  if (o.avail < 1) return ` ${esc(o.a.name)} is ${esc(String(o.st).toLowerCase())}.`;
  return "";
}
async function renderLineup(){
  if (!S.league || S.myRid == null) return;
  const inSeason = S.nflState?.season_type === "regular", season = liveSeasonYear();
  const cur = inSeason ? currentWeek() : 1, lastFantasy = lastFantasyWeek();
  if (LU.week == null || LU.week < cur) LU.week = cur;
  const weekOpts = Array.from({ length: Math.max(1, Math.min(18, lastFantasy) - cur + 1) }, (_, i) => cur + i).map(w => `<option value="${w}"${w === LU.week ? " selected" : ""}>Week ${w}${w === cur ? " (this week)" : ""}</option>`).join("");
  $("luWeek").innerHTML = $("luWeekW").innerHTML = weekOpts;
  if (!inSeason){ $("luBody").innerHTML = `<p class="empty">Start/sit runs during the NFL regular season.</p>`; $("luWaivers").innerHTML = `<p class="empty">Waiver help runs during the NFL regular season.</p>`; return; }
  $("luBody").innerHTML = $("luWaivers").innerHTML = `<p class="pc-loading">Loading Week ${LU.week} projections…</p>`;
  const week = LU.week, proj = await weekProjections(season, week);
  if (LU.week !== week) return;
  if (!proj){ $("luBody").innerHTML = $("luWaivers").innerHTML = `<p class="empty">Sleeper's projections aren't available right now. Try again in a minute.</p>`; return; }
  const r = S.rosters.find(x => x.roster_id === S.myRid), slots = (S.cfg.rp || []).filter(x => !["BN", "IR", "TAXI"].includes(x));
  const reserve = new Set([...(r?.reserve || []), ...(r?.taxi || [])].map(String));
  // the lineup set in Sleeper right now (same order as the league's starting slots)
  const setNow = (r?.starters || []).filter(pid => pid && pid !== "0").map(String);
  const nowSet = new Set(setNow), fit = valueToPoints(proj);
  const mine = scorePlayers(teamAssets(S.myRid).filter(a => a.kind === "player").map(a => luPlayer(a, proj)), fit, nowSet);
  const eligible = mine.filter(p => !reserve.has(String(p.a.pid)));
  const best = bestLineup(eligible, slots), byPid = new Map(mine.map(p => [String(p.a.pid), p]));
  const live = p => p.avail ? p.pts : 0;   // projected points shown in the totals
  const bestPts = best.slots.reduce((t, x) => t + (x.p ? live(x.p) : 0), 0);
  const nowPts = setNow.reduce((t, pid) => t + (byPid.get(pid) ? live(byPid.get(pid)) : 0), 0);
  const swapsIn = best.slots.map(x => x.p).filter(p => p && setNow.length && !nowSet.has(String(p.a.pid)));
  // pair each player going in with one coming out: same position first, then anyone his slot allows
  const outs = setNow.map(pid => byPid.get(pid)).filter(p => p && !best.used.has(p.a.id));
  const swapsOut = swapsIn.map(p => { const i = outs.findIndex(o => o.a.pos === p.a.pos) >= 0 ? outs.findIndex(o => o.a.pos === p.a.pos) : 0; return outs.splice(i, 1)[0]; });
  const tag = p => p.st && p.st in LU_AVAIL ? `<span class="lu-st s-${p.avail ? "q" : "o"}">${esc(p.st === "Questionable" ? "Q" : p.st === "Doubtful" ? "D" : p.st)}</span>` : p.bye ? `<span class="lu-st s-o">Bye</span>` : "";
  const row = (label, p) => p ? `<tr data-id="${esc(p.a.id)}"><td class="lu-slot">${esc(label)}</td><td><span class="teamcell">${assetPhoto(p.a, true)}${esc(p.a.name)}${tag(p)}</span><small class="lu-sub">${esc(p.a.pos)} · ${esc(p.a.nfl || "FA")}${p.opp ? " vs " + esc(p.opp) : ""}</small></td><td class="c hide-sm">${esc(p.a.lgPosRank ? p.a.pos + p.a.lgPosRank : "–")}</td><td class="c hide-sm">${p.a.lgRank || "–"}</td><td class="n">${p.avail ? p.pts.toFixed(1) : "0.0"}</td><td class="n">${!setNow.length ? "" : label === "BN" ? (nowSet.has(String(p.a.pid)) ? `<span class="lu-sit">Sit</span>` : "") : nowSet.has(String(p.a.pid)) ? `<span class="lu-ok">✓ set</span>` : `<span class="lu-change">Start</span>`}</td></tr>`
    : `<tr><td class="lu-slot">${esc(label)}</td><td colspan="5" class="empty">No one available</td></tr>`;
  const bench = eligible.filter(p => !best.used.has(p.a.id)).sort((x, y) => y.score - x.score);
  const changes = swapsIn.length ? `<div class="box gr-box lu-moves"><h3>Lineup Changes</h3><ul class="moves">${swapsIn.map((p, i) => { const o = swapsOut[i]; return `<li>Start <b>${esc(p.a.name)}</b> (${p.pts.toFixed(1)} proj, ${esc(luRank(p.a))})${o ? ` over <b>${esc(o.a.name)}</b> (${live(o).toFixed(1)} proj, ${esc(luRank(o.a))})` : ""}.${luWhy(p, o)}</li>`; }).join("")}</ul><p class="note" style="margin:6px 0 0">Make the changes in Sleeper.${bestPts - nowPts >= 0.1 ? ` About <b>+${(bestPts - nowPts).toFixed(1)}</b> projected points.` : ""} Close calls lean toward the better player, not just this week's projection.</p></div>`
    : setNow.length ? `<div class="box gr-box lu-moves"><p style="margin:0"><b>Your Sleeper lineup is already the best one</b> by this week's projections and player value.</p></div>` : "";
  const hurtStarters = best.slots.filter(x => x.p && x.p.avail > 0 && x.p.avail < 1).map(x => x.p);
  $("luBody").innerHTML = `<div class="pj-tiles">
      <div class="pj-tile"><small>Best lineup</small><b>${bestPts.toFixed(1)}</b><span>projected points, Week ${week}</span></div>
      ${setNow.length ? `<div class="pj-tile"><small>Lineup set in Sleeper</small><b>${nowPts.toFixed(1)}</b><span>${bestPts - nowPts > 0.05 ? `${(bestPts - nowPts).toFixed(1)} points left on the bench` : "already the best"}</span></div>` : ""}
      ${hurtStarters.length ? `<div class="pj-tile"><small>Check before kickoff</small><b>${hurtStarters.length}</b><span>${esc(hurtStarters.map(p => p.a.name).join(", "))}</span></div>` : ""}
    </div>${changes}
    <div class="tablewrap"><table class="lu-table"><thead><tr><th>Slot</th><th>Recommended starter</th><th class="c hide-sm">Pos Rank</th><th class="c hide-sm">Overall</th><th class="n" title="Sleeper's projection for the week, in your league's scoring">Proj</th><th class="n">${setNow.length ? "In Sleeper" : ""}</th></tr></thead>
      <tbody>${best.slots.map(x => row(LU_SLOT_LABEL[x.s] || x.s, x.p)).join("")}</tbody>
      <tbody class="lu-bench"><tr><th colspan="6">Bench</th></tr>${bench.map(p => row("BN", p)).join("") || `<tr><td colspan="6" class="empty">No bench players.</td></tr>`}</tbody></table></div>`;

  // ---- waivers ----
  const fa = scorePlayers([...S.assets.values()].filter(a => a.kind === "player" && a.owner == null && a.nfl && a.nfl !== "FA").map(a => luPlayer(a, proj)), fit, new Set());
  const lowStarterScore = pos => Math.min(...best.slots.filter(x => x.p && SLOT_OK[x.s].includes(pos)).map(x => x.p.score - (nowSet.has(String(x.p.a.pid)) ? LU_KEEP : 0)), Infinity);
  const would = p => p.score > 0 && p.score > lowStarterScore(p.a.pos);
  const stash = [...fa].sort((x, y) => y.a.value - x.a.value).slice(0, 10);
  const stream = fa.filter(p => p.avail && p.pts > 0).sort((x, y) => y.pts - x.pts).slice(0, 10);
  const drops = mine.filter(p => !best.used.has(p.a.id) && !reserve.has(String(p.a.pid))).sort((x, y) => x.a.value - y.a.value).slice(0, 3);
  const faRow = p => `<tr data-id="${esc(p.a.id)}"><td><span class="teamcell">${assetPhoto(p.a, true)}${esc(p.a.name)}${tag(p)}${trendTag(p.a.pid)}</span><small class="lu-sub">${esc(p.a.pos)} · ${esc(p.a.nfl)}${p.a.age ? " · age " + esc(ageText(p.a.age)) : ""}${p.opp ? " · vs " + esc(p.opp) : ""}</small></td><td class="n">${fmt(p.a.value)}</td><td class="n">${p.avail && p.pts ? p.pts.toFixed(1) : "–"}</td><td>${would(p) ? `<span class="lu-change">Would start</span>` : ""}</td></tr>`;
  const table = (title, sub, list) => `<div class="box gr-box"><h3>${title}</h3><p class="note" style="margin:0 0 8px">${sub}</p>${list.length ? `<div class="tablewrap"><table class="lu-table"><thead><tr><th>Player</th><th class="n">Value</th><th class="n">Wk ${week}</th><th></th></tr></thead><tbody>${list.map(faRow).join("")}</tbody></table></div>` : `<p class="empty">No one available.</p>`}</div>`;
  const budget = faabBudget();
  $("luWaivers").innerHTML = `<div class="grid2">
    ${table("Best Available: Stash", "Highest dynasty value in this league among players no one has rostered.", stash)}
    ${table(`Best Available: Week ${week}`, "Highest projected points this week in your scoring. \"Would start\" means he'd beat one of your starters.", stream)}
    </div>
    <div class="box gr-box"><h3>Drop Candidates</h3><p class="note" style="margin:0 0 8px">Your lowest-value bench players, if you need a roster spot.${budget ? ` You have $${faabLeft(S.myRid)} of $${budget} FAAB left.` : ""}</p>
      ${drops.length ? `<ul class="moves">${drops.map(p => `<li><b>${esc(p.a.name)}</b> (${esc(p.a.pos)}, value ${fmt(p.a.value)}${p.avail && p.pts ? `, ${p.pts.toFixed(1)} projected` : ""})</li>`).join("")}</ul>` : `<p class="empty">No bench players.</p>`}</div>`;
}
for (const id of ["luWeek", "luWeekW"]) $(id).addEventListener("change", () => { LU.week = Number($(id).value); renderLineup(); });
for (const id of ["luBody", "luWaivers"]) $(id).addEventListener("click", e => { const tr = e.target.closest("tr[data-id^='p:']"); if (tr) openPlayerCard(tr.dataset.id.slice(2)); });

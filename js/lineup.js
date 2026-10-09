// Front Office: Lineup & Waivers tab (My Team)
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// LINEUP & WAIVERS
// Start/sit: Sleeper's weekly projections, scored with THIS league's rules, fill your league's
// starting slots with your best players. Questionable players count at 75% and doubtful at 25%;
// players ruled out, on bye or on IR count 0. Then it compares that lineup with the one set in Sleeper.
// Waivers: unrostered players by dynasty value (stash) and by this week's projection (streamers),
// marked when they'd start for you, plus your lowest-value bench players as drop candidates.
// ============================================================
const LU = { week: null, cache: new Map() };
const LU_AVAIL = { Questionable: 0.75, Doubtful: 0.25, Out: 0, IR: 0, PUP: 0, NFI: 0, Sus: 0, COV: 0 };
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
  const pts = p ? leaguePoints(p.st, a.pos) : 0, st = sp.injury_status, avail = st in LU_AVAIL ? LU_AVAIL[st] : 1;
  return { a, pts, exp: pts * avail, opp: p?.opp || "", bye: !p || !p.st || Object.keys(p.st).length === 0, st, avail };
}
// Best lineup: strict slots first (QB, RB...), then the flex spots, each with the best player left
function bestLineup(players, slots){
  const pool = [...players].sort((x, y) => y.exp - x.exp), used = new Set(), out = [];
  const order = slots.map((s, i) => ({ s, i })).filter(x => SLOT_OK[x.s]).sort((x, y) => SLOT_OK[x.s].length - SLOT_OK[y.s].length);
  for (const { s, i } of order){
    const p = pool.find(q => !used.has(q.a.id) && SLOT_OK[s].includes(q.a.pos));
    if (p) used.add(p.a.id);
    out[i] = { s, p: p || null };
  }
  return { slots: out.filter(Boolean), used };
}
async function renderLineup(){
  if (!S.league || S.myRid == null) return;
  const inSeason = S.nflState?.season_type === "regular", season = liveSeasonYear();
  const cur = inSeason ? currentWeek() : 1, lastFantasy = lastFantasyWeek();
  if (LU.week == null || LU.week < cur) LU.week = cur;
  $("luWeek").innerHTML = Array.from({ length: Math.max(1, Math.min(18, lastFantasy) - cur + 1) }, (_, i) => cur + i).map(w => `<option value="${w}"${w === LU.week ? " selected" : ""}>Week ${w}${w === cur ? " (this week)" : ""}</option>`).join("");
  if (!inSeason){ $("luBody").innerHTML = `<p class="empty">Start/sit and waiver help run during the NFL regular season.</p>`; $("luWaivers").innerHTML = ""; return; }
  $("luBody").innerHTML = `<p class="pc-loading">Loading Week ${LU.week} projections…</p>`;
  const week = LU.week, proj = await weekProjections(season, week);
  if (LU.week !== week) return;
  if (!proj){ $("luBody").innerHTML = `<p class="empty">Sleeper's projections aren't available right now. Try again in a minute.</p>`; $("luWaivers").innerHTML = ""; return; }
  const r = S.rosters.find(x => x.roster_id === S.myRid), slots = (S.cfg.rp || []).filter(x => !["BN", "IR", "TAXI"].includes(x));
  const reserve = new Set([...(r?.reserve || []), ...(r?.taxi || [])].map(String));
  const mine = teamAssets(S.myRid).filter(a => a.kind === "player").map(a => luPlayer(a, proj));
  const eligible = mine.filter(p => !reserve.has(String(p.a.pid)));
  const best = bestLineup(eligible, slots);
  // the lineup set in Sleeper right now (same order as the league's starting slots)
  const setNow = (r?.starters || []).filter(pid => pid && pid !== "0").map(String);
  const nowSet = new Set(setNow), byPid = new Map(mine.map(p => [String(p.a.pid), p]));
  const bestPts = best.slots.reduce((t, x) => t + (x.p?.exp || 0), 0);
  const nowPts = setNow.reduce((t, pid) => t + (byPid.get(pid)?.exp || 0), 0);
  const swapsIn = best.slots.map(x => x.p).filter(p => p && setNow.length && !nowSet.has(String(p.a.pid)));
  const swapsOut = setNow.map(pid => byPid.get(pid)).filter(p => p && !best.used.has(p.a.id));
  const tag = p => p.st && p.st in LU_AVAIL ? `<span class="lu-st s-${p.avail ? "q" : "o"}">${esc(p.st === "Questionable" ? "Q" : p.st === "Doubtful" ? "D" : p.st)}</span>` : p.bye ? `<span class="lu-st s-o">Bye</span>` : "";
  const row = (label, p) => p ? `<tr data-id="${esc(p.a.id)}"><td class="lu-slot">${esc(label)}</td><td><span class="teamcell">${assetPhoto(p.a, true)}${esc(p.a.name)}${tag(p)}</span><small class="lu-sub">${esc(p.a.pos)} · ${esc(p.a.nfl || "FA")}${p.opp ? " vs " + esc(p.opp) : ""}</small></td><td class="n">${p.pts.toFixed(1)}</td><td class="n hide-sm">${p.avail < 1 && p.avail > 0 ? p.exp.toFixed(1) : ""}</td><td class="n">${!setNow.length ? "" : label === "BN" ? (nowSet.has(String(p.a.pid)) ? `<span class="lu-sit">Sit</span>` : "") : nowSet.has(String(p.a.pid)) ? `<span class="lu-ok">✓ set</span>` : `<span class="lu-change">Start</span>`}</td></tr>`
    : `<tr><td class="lu-slot">${esc(label)}</td><td colspan="4" class="empty">No one available</td></tr>`;
  const bench = eligible.filter(p => !best.used.has(p.a.id)).sort((x, y) => y.exp - x.exp);
  const changes = swapsIn.length ? `<div class="box gr-box lu-moves"><h3>Lineup Changes</h3><ul class="moves">${swapsIn.map((p, i) => { const o = swapsOut[i]; return `<li>Start <b>${esc(p.a.name)}</b> (${p.exp.toFixed(1)})${o ? ` over <b>${esc(o.a.name)}</b> (${o.exp.toFixed(1)})` : ""}.${o?.st && o.st in LU_AVAIL && !o.avail ? ` ${esc(o.a.name)} is ${esc(o.st === "IR" ? "on IR" : o.st.toLowerCase())}.` : o?.bye ? ` ${esc(o.a.name)} is on bye.` : ""}</li>`; }).join("")}</ul><p class="note" style="margin:6px 0 0">Make the changes in Sleeper: about <b>+${(bestPts - nowPts).toFixed(1)}</b> projected points.</p></div>`
    : setNow.length ? `<div class="box gr-box lu-moves"><p style="margin:0"><b>Your Sleeper lineup is already the best one</b> by this week's projections.</p></div>` : "";
  const hurtStarters = best.slots.filter(x => x.p && x.p.avail > 0 && x.p.avail < 1).map(x => x.p);
  $("luBody").innerHTML = `<div class="pj-tiles">
      <div class="pj-tile"><small>Best lineup</small><b>${bestPts.toFixed(1)}</b><span>projected points, Week ${week}</span></div>
      ${setNow.length ? `<div class="pj-tile"><small>Lineup set in Sleeper</small><b>${nowPts.toFixed(1)}</b><span>${bestPts - nowPts > 0.05 ? `${(bestPts - nowPts).toFixed(1)} points left on the bench` : "already the best"}</span></div>` : ""}
      ${hurtStarters.length ? `<div class="pj-tile"><small>Check before kickoff</small><b>${hurtStarters.length}</b><span>${esc(hurtStarters.map(p => p.a.name).join(", "))}</span></div>` : ""}
    </div>${changes}
    <div class="tablewrap"><table class="lu-table"><thead><tr><th>Slot</th><th>Recommended starter</th><th class="n">Proj</th><th class="n hide-sm" title="Projection times his chance of playing">Expected</th><th class="n">${setNow.length ? "In Sleeper" : ""}</th></tr></thead>
      <tbody>${best.slots.map(x => row(LU_SLOT_LABEL[x.s] || x.s, x.p)).join("")}</tbody>
      <tbody class="lu-bench"><tr><th colspan="5">Bench</th></tr>${bench.map(p => row("BN", p)).join("") || `<tr><td colspan="5" class="empty">No bench players.</td></tr>`}</tbody></table></div>`;

  // ---- waivers ----
  const lowStarter = pos => Math.min(...best.slots.filter(x => x.p && SLOT_OK[x.s].includes(pos)).map(x => x.p.exp), Infinity);
  const fa = [...S.assets.values()].filter(a => a.kind === "player" && a.owner == null && a.nfl && a.nfl !== "FA").map(a => luPlayer(a, proj));
  const would = p => p.exp > 0 && p.exp > lowStarter(p.a.pos);
  const stash = [...fa].sort((x, y) => y.a.value - x.a.value).slice(0, 10);
  const stream = fa.filter(p => p.exp > 0).sort((x, y) => y.exp - x.exp).slice(0, 10);
  const drops = mine.filter(p => !best.used.has(p.a.id) && !reserve.has(String(p.a.pid))).sort((x, y) => x.a.value - y.a.value).slice(0, 3);
  const faRow = p => `<tr data-id="${esc(p.a.id)}"><td><span class="teamcell">${assetPhoto(p.a, true)}${esc(p.a.name)}${tag(p)}${trendTag(p.a.pid)}</span><small class="lu-sub">${esc(p.a.pos)} · ${esc(p.a.nfl)}${p.a.age ? " · age " + esc(ageText(p.a.age)) : ""}${p.opp ? " · vs " + esc(p.opp) : ""}</small></td><td class="n">${fmt(p.a.value)}</td><td class="n">${p.exp ? p.exp.toFixed(1) : "–"}</td><td>${would(p) ? `<span class="lu-change">Would start</span>` : ""}</td></tr>`;
  const table = (title, sub, list) => `<div class="box gr-box"><h3>${title}</h3><p class="note" style="margin:0 0 8px">${sub}</p>${list.length ? `<div class="tablewrap"><table class="lu-table"><thead><tr><th>Player</th><th class="n">Value</th><th class="n">Wk ${week}</th><th></th></tr></thead><tbody>${list.map(faRow).join("")}</tbody></table></div>` : `<p class="empty">No one available.</p>`}</div>`;
  const budget = faabBudget();
  $("luWaivers").innerHTML = `<div class="grid2">
    ${table("Best Available: Stash", "Highest dynasty value in this league among players no one has rostered.", stash)}
    ${table(`Best Available: Week ${week}`, "Highest projected points this week in your scoring. \"Would start\" means he'd beat one of your starters.", stream)}
    </div>
    <div class="box gr-box"><h3>Drop Candidates</h3><p class="note" style="margin:0 0 8px">Your lowest-value bench players, if you need a roster spot.${budget ? ` You have $${faabLeft(S.myRid)} of $${budget} FAAB left.` : ""}</p>
      ${drops.length ? `<ul class="moves">${drops.map(p => `<li><b>${esc(p.a.name)}</b> (${esc(p.a.pos)}, value ${fmt(p.a.value)}${p.exp ? `, ${p.exp.toFixed(1)} projected` : ""})</li>`).join("")}</ul>` : `<p class="empty">No bench players.</p>`}</div>`;
}
$("luWeek").addEventListener("change", () => { LU.week = Number($("luWeek").value); renderLineup(); });
for (const id of ["luBody", "luWaivers"]) $(id).addEventListener("click", e => { const tr = e.target.closest("tr[data-id^='p:']"); if (tr) openPlayerCard(tr.dataset.id.slice(2)); });

// Front Office: My Roster tab (My Team section)
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// MY ROSTER
// Every player and pick on a team, with the same detail as Rankings plus lineup slot, depth chart,
// points per game, snap share and value trend. Pick any team; it opens on yours.
// Click a column heading to sort; click a player to open his card.
// ============================================================
let rosterSort = { key: "value", dir: -1 }, rosterPos = "ALL";
const ROSTER_SLOT_ORDER = { Starter: 0, Bench: 1, Taxi: 2, IR: 3 };
const ROSTER_FIRST_DIR = { name: 1, pos: 1, slot: 1, rank: 1, posrank: 1, age: 1, nfl: 1 };   // everything else starts with the highest first
function rosterSlot(r, pid){
  if ((r?.starters || []).includes(pid)) return "Starter";
  if ((r?.reserve || []).includes(pid)) return "IR";
  if ((r?.taxi || []).includes(pid)) return "Taxi";
  return "Bench";
}
// This season's PPR points per game, from the daily player file (blank before he plays)
function rosterPPG(pid){
  const rows = cardData?.players?.[pid]?.s || [], season = liveSeasonYear(), r = rows.find(x => x[0] === season);
  return r && r[2] ? r[16] / r[2] : null;
}
// Value change since the first saved snapshot (Value History), as a percentage
function rosterTrend(a, vh){
  const pts = valueHistoryPoints(a, vh);
  return pts.length >= 2 && pts[0].v ? (pts[pts.length - 1].v / pts[0].v - 1) * 100 : null;
}
// The league's starting slot at a spot in Sleeper's lineup (QB, RB, WR, TE, Flex, Superflex...)
const lineupSlotName = i => { const s = (S.cfg?.rp || []).filter(x => !["BN", "IR", "TAXI"].includes(x))[i]; return { SUPER_FLEX: "Superflex", FLEX: "Flex", WRRB_FLEX: "W/R Flex", REC_FLEX: "W/T Flex" }[s] || s || "Starter"; };
async function renderRoster(){
  if (!S.league || !S.teams?.size) return;
  syncPicker("rosterTeam");
  const rid = Number($("rosterTeam").value), t = S.teams.get(rid), r = S.rosters.find(x => x.roster_id === rid);
  if (!t){ $("rosterBody").innerHTML = ""; return; }
  const [, vh] = await Promise.all([loadCardData(), loadValueHistory()]);
  if (Number($("rosterTeam").value) !== rid) return;   // switched teams while loading
  const mine = [...S.assets.values()].filter(a => a.owner === rid);
  const players = mine.filter(a => a.kind === "player").map(a => ({ a, slot: rosterSlot(r, a.pid), ppg: rosterPPG(a.pid), snap: cardData?.players?.[a.pid]?.u?.[0] ?? null,
    depth: depthChartText(a.pid), trend: rosterTrend(a, vh), ch: a.market ? (a.value / a.market - 1) * 100 : 0 }));
  const picks = mine.filter(a => a.kind === "pick").sort((x, y) => x.season - y.season || x.round - y.round || y.value - x.value);

  // ---- summary ----
  const prof = teamProfiles().get(rid), N = S.teams.size;
  const total = mine.reduce((s, a) => s + a.value, 0);
  const totals = [...S.teams.keys()].map(k => [...S.assets.values()].filter(a => a.owner === k).reduce((s, a) => s + a.value, 0)).sort((x, y) => y - x);
  const totalRank = totals.indexOf(total) + 1;
  const tile = (label, big, sub) => `<div class="pj-tile"><small>${label}</small><b>${big}</b>${sub ? `<span>${sub}</span>` : ""}</div>`;
  const hurt = players.filter(p => S.sleeperPlayers?.[p.a.pid]?.injury_status && p.slot === "Starter").length;
  $("rosterSum").innerHTML = `<div class="ros-head">${teamPhoto(rid, "xl")}<div><b>${esc(t.name)}</b><span class="badge ${badgeClass[t.status]}">${statusText[t.status]}</span></div></div>
    <div class="pj-tiles">
      ${tile("Total value", fmt(Math.round(total)), `${ordinal(totalRank)} of ${N} teams`)}
      ${prof ? tile("Starters", ordinal(prof.strengthRank), `roster strength, of ${N}`) : ""}
      ${prof ? tile("Roster age", prof.age ? prof.age.toFixed(1) : "–", `${ordinal(prof.ageRank)} youngest (value-weighted)`) : ""}
      ${tile("Draft picks", fmt(Math.round(picks.reduce((s, a) => s + a.value, 0))), `${picks.length} pick${picks.length === 1 ? "" : "s"}${prof ? ` · ${ordinal(prof.pickRank)} of ${N}` : ""}`)}
      ${tile("Players", players.length, [(r?.starters || []).length ? `${players.filter(p => p.slot === "Starter").length} starting` : "", hurt ? `${hurt} starter${hurt > 1 ? "s" : ""} hurt` : ""].filter(Boolean).join(" · "))}
    </div>`;

  // ---- players table ----
  const key = {
    slot: p => ROSTER_SLOT_ORDER[p.slot], name: p => p.a.name.toLowerCase(), pos: p => p.a.pos, posrank: p => p.a.lgPosRank || 1e9, rank: p => p.a.lgRank || 1e9,
    age: p => p.a.age || 99, nfl: p => p.a.nfl || "", ppg: p => p.ppg ?? -1, snap: p => p.snap ?? -1, value: p => p.a.value, market: p => p.a.market || 0,
    change: p => p.ch, trend: p => p.trend ?? -1e9
  }[rosterSort.key] || (p => p.a.value);
  // Current Lineup: the starters set in Sleeper, in the league's lineup order (QB, RB, WR... flex)
  const lineupOrder = new Map((r?.starters || []).map((pid, i) => [String(pid), i]));
  const shown = players.filter(p => rosterPos === "ALL" || (rosterPos === "LINEUP" ? p.slot === "Starter" : p.a.pos === rosterPos))
    .sort((x, y) => { if (rosterPos === "LINEUP" && rosterSort.key === "lineup") return lineupOrder.get(String(x.a.pid)) - lineupOrder.get(String(y.a.pid));
      const u = key(x), v = key(y); return (typeof u === "string" ? u.localeCompare(v) : u - v) * rosterSort.dir || y.a.value - x.a.value; });
  for (const th of $("rosterTable").querySelectorAll("th[data-sort]")) th.setAttribute("aria-sort", th.dataset.sort === rosterSort.key ? (rosterSort.dir > 0 ? "ascending" : "descending") : "none");
  const pct = (x, d = 0) => x == null ? "–" : `${x > 0 ? "+" : ""}${x.toFixed(d)}%`;
  $("rosterBody").innerHTML = shown.map(({ a, slot, ppg, snap, depth, trend, ch }) => {
    const cliff = CLIFF[a.pos], old = a.age && cliff && a.age >= cliff;
    return `<tr data-id="${esc(a.id)}" tabindex="0">
      <td><span class="slot s-${slot.toLowerCase()}">${rosterPos === "LINEUP" ? esc(lineupSlotName(lineupOrder.get(String(a.pid)))) : slot}</span></td>
      <td><span class="teamcell">${assetPhoto(a, true)}${esc(a.name)}${injTag(a.pid)}${trendTag(a.pid)}</span></td>
      <td class="hide-sm">${esc(a.pos)}</td>
      <td class="rk">${a.lgPosRank ? esc(a.pos) + a.lgPosRank : "–"}</td>
      <td class="rk hide-sm">${a.lgRank || "–"}</td>
      <td class="n${old ? " old" : ""}"${old ? ` title="Past the usual ${esc(a.pos)} age cliff (${cliff})"` : ""}>${esc(ageText(a.age)) || "–"}</td>
      <td class="hide-sm">${esc(a.nfl || "FA")}${depth && depth !== "Not on the depth chart" ? ` <small class="dc">${esc(depth.split(" · ")[0])}</small>` : ""}</td>
      <td class="n hide-sm">${ppg == null ? "–" : ppg.toFixed(1)}</td>
      <td class="n hide-sm">${snap == null ? "–" : Math.round(snap * 100) + "%"}</td>
      <td class="n big">${fmt(a.value)}</td>
      <td class="n hide-sm">${fmt(a.market)}</td>
      <td class="n hide-sm">${Math.abs(ch) < 1 ? "" : `<span class="${ch > 0 ? "up" : "down"}">${pct(ch)}</span>`}</td>
      <td class="n hide-sm">${trend == null || Math.abs(trend) < 0.5 ? "–" : `<span class="${trend > 0 ? "up" : "down"}">${trend > 0 ? "▲" : "▼"} ${Math.abs(trend).toFixed(0)}%</span>`}</td></tr>`;
  }).join("") || `<tr><td colspan="13" class="empty">${rosterPos === "LINEUP" ? "No starting lineup is set in Sleeper for this team yet." : `No players${rosterPos !== "ALL" ? " at " + esc(rosterPos) : ""}.`}</td></tr>`;
  const posTotals = ["QB", "RB", "WR", "TE"].map(p => { const v = players.filter(x => x.a.pos === p).reduce((s, x) => s + x.a.value, 0); return `${p} ${fmt(Math.round(v))}${prof ? ` <small>(${ordinal(prof.pos[p].rank)})</small>` : ""}`; });
  $("rosterCount").innerHTML = `${shown.length} player${shown.length === 1 ? "" : "s"} · value by position: ${posTotals.join(" · ")}`;

  // ---- picks ----
  $("rosterPicks").innerHTML = picks.length ? `<div class="tablewrap"><table class="ros-picks"><thead><tr><th>Pick</th><th class="hide-sm">From</th><th class="n">Value</th></tr></thead><tbody>
    ${picks.map(a => `<tr><td><span class="teamcell">${assetPhoto(a, true)}${esc(a.name)}</span></td><td class="hide-sm">${esc(a.nfl || "")}</td><td class="n big">${fmt(a.value)}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="empty">No draft picks.</p>`;
}
$("rosterTeam").addEventListener("change", renderRoster);
$("rosterTable").querySelector("thead").addEventListener("click", e => {
  const th = e.target.closest("th[data-sort]"); if (!th) return;
  const k = th.dataset.sort;
  rosterSort = rosterSort.key === k ? { key: k, dir: -rosterSort.dir } : { key: k, dir: ROSTER_FIRST_DIR[k] || -1 };
  renderRoster();
});
$("rosterPos").addEventListener("click", e => {
  const b = e.target.closest("button[data-pos]"); if (!b) return;
  rosterPos = b.dataset.pos;
  if (rosterPos === "LINEUP") rosterSort = { key: "lineup", dir: 1 }; else if (rosterSort.key === "lineup") rosterSort = { key: "value", dir: -1 };
  for (const x of $("rosterPos").children) x.setAttribute("aria-pressed", x === b);
  renderRoster();
});
$("rosterBody").addEventListener("click", e => { const tr = e.target.closest("tr[data-id^='p:']"); if (tr) openPlayerCard(tr.dataset.id.slice(2)); });
$("rosterBody").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const tr = e.target.closest("tr[data-id^='p:']"); if (tr){ e.preventDefault(); openPlayerCard(tr.dataset.id.slice(2)); }
});

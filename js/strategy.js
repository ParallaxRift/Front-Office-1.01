// Front Office: My Team Strategy tab
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// TEAM STRATEGY TAB
// Rule-based: compares every team's starters, depth, age and
// picks to the rest of the league, then suggests moves.
// ============================================================
const CLIFF = {QB:34, RB:27, WR:30, TE:31};
const REBUILD_MAX_AGE = 27;   // rebuilding teams are never pointed at players older than 27
const tooOldForRebuild = a => a.kind === "player" && a.age && Math.floor(a.age) > REBUILD_MAX_AGE;
function slotNeeds(){
  const rp = S.cfg.rp, n = x => rp.filter(y=>y===x).length;
  const flex = n("FLEX"), wrrb = n("WRRB_FLEX"), rec = n("REC_FLEX"), sf = n("SUPER_FLEX");
  return { QB: n("QB") + sf*0.9, RB: n("RB") + flex*0.4 + wrrb*0.5, WR: n("WR") + flex*0.5 + wrrb*0.5 + rec*0.8, TE: n("TE") + flex*0.1 + rec*0.2 };
}
function teamProfiles(){
  const need = slotNeeds(), out = new Map();
  for (const t of S.teams.values()){
    const mine = [...S.assets.values()].filter(a => a.owner === t.rid);
    const pl = mine.filter(a => a.kind === "player");
    const pos = {};
    for (const p of ["QB","RB","WR","TE"]){
      const vals = pl.filter(a=>a.pos===p).map(a=>a.value).sort((a,b)=>b-a);
      const k = need[p], whole = Math.floor(k), frac = k - whole;
      let start = vals.slice(0, whole).reduce((s,v)=>s+v,0) + (vals[whole]||0)*frac;
      const depth = vals.slice(Math.ceil(k), Math.ceil(k)+2).reduce((s,v)=>s+v,0);
      pos[p] = { start, depth, count: vals.length };
    }
    const aged = pl.filter(a => a.age && a.value > 0);
    const wsum = aged.reduce((s,a)=>s+a.value,0) || 1;
    const age = aged.reduce((s,a)=>s+a.age*a.value,0) / wsum;
    const picks = mine.filter(a => a.kind === "pick").reduce((s,a)=>s+a.value,0);
    out.set(t.rid, { team: t, pos, age, picks, players: pl });
  }
  // league ranks (1 = best; for age, 1 = youngest)
  const all = [...out.values()];
  const rankBy = (get, asc) => { const sorted = [...all].sort((a,b) => asc ? get(a)-get(b) : get(b)-get(a)); return x => sorted.indexOf(x)+1; };
  for (const p of ["QB","RB","WR","TE"]){
    const rs = rankBy(x=>x.pos[p].start), rd = rankBy(x=>x.pos[p].depth);
    for (const x of all){ x.pos[p].rank = rs(x); x.pos[p].depthRank = rd(x); }
  }
  const ra = rankBy(x=>x.age, true), rpk = rankBy(x=>x.picks), rst = rankBy(x=>x.team.strength);
  for (const x of all){ x.ageRank = ra(x); x.pickRank = rpk(x); x.strengthRank = rst(x); }
  return out;
}
const andList = a => a.length <= 1 ? (a[0]||"") : a.slice(0,-1).join(", ") + " and " + a[a.length-1];
const ordinal = n => n + (n%100>=11&&n%100<=13 ? "th" : ({1:"st",2:"nd",3:"rd"}[n%10] || "th"));

function renderStrategy(){
  const rid = Number($("stratTeam").value), N = S.teams.size;
  syncPicker("stratTeam");
  const prof = teamProfiles(), me = prof.get(rid), t = me.team;
  const third = N/3, POS = ["QB","RB","WR","TE"];
  const needs = POS.filter(p => me.pos[p].rank > N - third);
  const deepCut = Math.max(1, Math.floor(N/4));
  const surplus = POS.filter(p => me.pos[p].depthRank <= deepCut && me.pos[p].rank <= N/2);
  const young = me.ageRank <= third, old = me.ageRank > N - third;

  let plan, why;
  if (t.status === "contend"){ plan = "Win Now"; why = `Your starters rank ${ordinal(me.strengthRank)} of ${N}. Spend future value to fill holes this season.`; }
  else if (t.status === "rebuild"){ plan = "Rebuild"; why = `Your starters rank ${ordinal(me.strengthRank)} of ${N}. Turn veterans into picks and young players before they lose value.`; }
  else if (young || me.pickRank <= third){ plan = "Build Toward Next Year"; why = "You're in the middle, but young and well stocked with picks. Add rising players rather than chasing this season."; }
  else if (old){ plan = "Pick a Lane"; why = "Middle of the pack with an older roster is the riskiest spot. Either push in now or sell veterans before they decline."; }
  else { plan = "Push to Contend"; why = "You're close. One or two targeted upgrades at your weakest spots could make you a contender."; }
  const buying = plan === "Win Now" || plan === "Push to Contend";

  // targets for needs
  const otherProfiles = [...prof.values()].filter(x => x.team.rid !== rid);
  const myTop = Math.max(0, ...me.players.map(a=>a.value));
  const targetsFor = p => otherProfiles
    .filter(x => buying ? x.team.status !== "contend" : true)
    .flatMap(x => x.players.filter(a => a.pos === p))
    .filter(a => buying ? (a.age||0) >= 24 && a.age < CLIFF[p] : (a.age||99) <= 24)
    .filter(a => a.value > 1000 && a.value <= myTop*1.1)
    .filter(a => !(buying && seasonOutlook(a.pid)?.done))     // a contender can't use a player who's out for the season
    .sort((a,b) => b.value - a.value).slice(0,3);

  // sell candidates
  const sells = buying
    ? me.players.filter(a => (a.age||0) <= 23 && a.value > 800 && me.pos[a.pos] && a.value < me.pos[a.pos].start/Math.max(1,slotNeeds()[a.pos]) * 0.8).sort((a,b)=>b.value-a.value).slice(0,3)
    : me.players.filter(a => a.age && a.age >= CLIFF[a.pos]-1 && a.value > 1200).sort((a,b)=>b.value-a.value).slice(0,4);
  const buyersFor = a => otherProfiles.filter(x => x.team.status !== "rebuild" && x.pos[a.pos].rank > N/2).map(x => x.team.name).slice(0,2);

  // best trade partners
  const partners = otherProfiles.map(x => {
    const xNeeds = POS.filter(p => x.pos[p].rank > N - third);
    const xSurplus = POS.filter(p => x.pos[p].depthRank <= deepCut && x.pos[p].rank <= N/2);
    let score = needs.filter(p => xSurplus.includes(p)).length + xNeeds.filter(p => surplus.includes(p)).length;
    if ((t.status==="contend" && x.team.status==="rebuild") || (t.status==="rebuild" && x.team.status==="contend")) score += 1.5;
    const h = managerHabits().get(x.team.rid);
    if (h){ score += h.active ? 0.75 : h.never ? -0.75 : 0; score += 0.4 * surplus.filter(p => h.buys.includes(p)).length; }   // willing traders who buy what you have
    return { x, score, h, fit: needs.filter(p => xSurplus.includes(p)), give: xNeeds.filter(p => surplus.includes(p)) };
  }).filter(p => p.score > 0).sort((a,b) => b.score - a.score).slice(0,2);

  // settings-aware tips
  const tips = [];
  const qbStarters = me.players.filter(a => a.pos==="QB").sort((a,b)=>b.value-a.value);
  if (S.cfg.superflex){
    const qbRanks = [...S.assets.values()].filter(a=>a.pos==="QB").sort((a,b)=>b.value-a.value);
    const startable = qbStarters.filter(q => qbRanks.indexOf(q) < N*2).length;
    if (startable < 2) tips.push(`Superflex: you have ${startable} startable QB${startable===1?"":"s"}. A second starting QB is worth more here than almost any other upgrade.`);
    else if (startable >= 3) tips.push(`Superflex: you hold ${startable} startable QBs. Your third is premium trade bait, since every team needs two.`);
  }
  if (S.cfg.tep){
    const te1 = me.players.filter(a=>a.pos==="TE").sort((a,b)=>b.value-a.value)[0];
    tips.push(me.pos.TE.rank <= 3 ? "TE premium: your tight end room is a real edge. Don't sell it for market value, since it's worth more here." : "TE premium: an elite tight end scores like a WR1 in this league. Worth targeting if you're contending.");
  }
  if (S.cfg.rec < .5 && me.pos.RB.rank > N/2) tips.push("Low PPR scoring favors running backs, and yours rank in the bottom half.");
  if (S.cfg.wr >= 3 && me.pos.WR.rank > N/2) tips.push(`You start ${S.cfg.wr} WRs and your receiver room ranks ${ordinal(me.pos.WR.rank)}. Depth at WR matters more than usual.`);
  if (S.cfg.teams >= 14) tips.push(`In a ${S.cfg.teams}-team league the waiver wire is thin, so roster depth holds trade value.`);

  // Line 1: player name with position and age. Line 2: the fantasy team that owns him.
  const tgtBtn = a => `<button class="tgt" data-id="${esc(a.id)}"><span class="info">
      <span class="l1">${esc(a.name)}${injTag(a.pid)}<small>${esc(a.pos)}, ${esc(ageText(a.age)||"?")}</small></span>
      <span class="l2">${teamPhoto(a.owner, true)}<span>${esc(S.teams.get(a.owner)?.name)}</span></span>
    </span><span class="val">${fmt(a.value)}</span></button>`;
  const cell = p => { const r = me.pos[p].rank, cls = r <= third ? "good" : r > N-third ? "bad" : ""; return `<div class="pg ${cls}"><b>${p}</b><span>${ordinal(r)}</span><small>depth ${ordinal(me.pos[p].depthRank)}</small></div>`; };
  const pickCls = me.pickRank <= third ? "good" : me.pickRank > N-third ? "bad" : "";

  const moves = [];
  if (needs.length) moves.push(`${buying ? "Upgrade" : "Rebuild"} at ${andList(needs)}, your weakest starting spot${needs.length>1?"s":""} relative to the league.`);
  if (buying && me.pickRank <= N/2) moves.push("Your picks rank " + ordinal(me.pickRank) + ". Use them as currency for proven starters.");
  if (!buying && me.pickRank > N/2) moves.push("Your picks rank " + ordinal(me.pickRank) + ". Rebuilding teams should be adding picks, not short on them.");
  if (surplus.length) moves.push(`You're deep at ${andList(surplus)}. Trade from that depth instead of from your starters.`);
  if (old && buying) moves.push("Your roster skews old, so a title window is likely 1–2 seasons. Make it count.");
  if (young && !buying) moves.push("Your roster is one of the youngest. Be patient and let it mature.");

  $("strategy").innerHTML = `
    <div class="strat-hero"><div class="stratTop">${teamPhoto(t.rid, "xl")}<div>
    <span class="badge ${badgeClass[t.status]}">${statusText[t.status]}</span>
    <p class="plan">${esc(plan)}</p></div></div>
    <p class="facts">${esc(why)}</p>
    <div class="posgrid">${POS.map(cell).join("")}<div class="pg ${pickCls}"><b>Picks</b><span>${ordinal(me.pickRank)}</span><small>${fmt(me.picks)} value</small></div></div>
    <p class="facts" style="margin-bottom:14px">Starter ranks out of ${N} teams. Roster age ranks ${ordinal(me.ageRank)} youngest (value-weighted average ${me.age ? me.age.toFixed(1) : "?"}).</p></div>
    <div class="grid2">
      <div class="box"><h3>Recommended Moves</h3><ul class="moves">${moves.concat(tips).map(m=>`<li>${esc(m)}</li>`).join("") || "<li>Your roster is balanced. Look for value trades rather than filling holes.</li>"}</ul></div>
      ${needs.map(p => { const list = targetsFor(p); return `<div class="box"><h3>${buying ? "Targets" : "Young Targets"} at ${p}</h3>${list.length ? `<p class="note" style="margin:0">${buying ? "Proven players on non-contending teams. Tap to open in the trade calculator." : "Young players with upside. Tap to open in the trade calculator."}</p><div class="targets">${list.map(tgtBtn).join("")}</div>` : `<p class="note">No clear targets in range.</p>`}</div>`; }).join("")}
      ${sells.length ? `<div class="box"><h3>${buying ? "Sell for Help Now" : "Sell Before They Decline"}</h3><div class="targets">${sells.map(a => { const buyers = !buying ? buyersFor(a) : []; return `<div class="tgt" style="cursor:default"><span class="info">
      <span class="l1">${esc(a.name)}${injTag(a.pid)}<small>${esc(a.pos)}, ${esc(ageText(a.age)||"?")}</small></span>
      <span class="l2">${buyers.length ? `<span>Possible buyers: ${esc(buyers.join(", "))}</span>` : `<span>${buying ? "Bench piece to package" : "Aging, sell soon"}</span>`}</span>
    </span><span class="val">${fmt(a.value)}</span></div>`; }).join("")}</div></div>` : ""}
      ${historyInsightsHTML(t.rid)}
      ${partners.length ? `<div class="box"><h3>Best Trade Partners</h3><ul class="moves">${partners.map(p => `<li><span class="teamcell" style="vertical-align:middle">${teamPhoto(p.x.team.rid, true)}<b>${esc(p.x.team.name)}</b></span> (${statusText[p.x.team.status].toLowerCase()})${p.fit.length ? `: deep at ${andList(p.fit)}` : ""}${p.give.length ? `${p.fit.length?",":":"} needs ${andList(p.give)}, where you're deep` : ""}.${S.history ? ` <small class="habit">Trade habits: ${esc(habitText(p.h))}.</small>` : ""}</li>`).join("")}</ul></div>` : ""}
    </div>`;
}
$("stratTeam").addEventListener("change", renderStrategy);
$("strategy").addEventListener("click", e => {
  const b = e.target.closest("button.tgt"); if (!b) return;
  const a = S.assets.get(b.dataset.id); if (!a) return;
  $("teamA").value = $("stratTeam").value; $("teamB").value = a.owner;
  S.sendIds.clear(); S.getIds.clear(); S.getIds.add(a.id);
  renderCalc();
  $("tabs").querySelector('[data-tab="calc"]').click();
  window.scrollTo({ top: $("groups").offsetTop, behavior: "smooth" });
});


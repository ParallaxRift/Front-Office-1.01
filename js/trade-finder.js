// Front Office: Trade Finder tab
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// TRADE FINDER
// Pick what you'd trade away. Front Office searches every other roster for
// fair packages (one to four pieces back) and ranks them by how well they fit
// your team's direction and needs, and how likely the other team is to say yes.
// ============================================================
const tfSend = new Set();
let tfTarget = null;   // a player on another team you want; Front Office finds what to send for them
const statusPhrase = { contend: "contending", middle: "in the middle", rebuild: "rebuilding" };
const FAIR_LOW = 0.88, FAIR_HIGH = 1.12;   // packages within this range of what you send
// On computers the two sections work on their own: the top (Players to Trade Away + Suggested Trades)
// ignores the Find a Player dropdowns, and Find a Player (dropdowns, recommendations and "Find a deal")
// shows its results in its own box. Phones keep one combined flow, with the filters under the picked players.
const tfSplit = () => !(typeof isPhoneView === "function" && isPhoneView());
const tfTopOpts = () => tfSplit() ? { want: "fit", partner: "any", max: 4 } : { want: $("tfWant").value, partner: $("tfPartner").value, max: Number($("tfMax").value) || 4 };

function renderFinder(){
  if (!S.league) return;
  const findClean = !tfTarget && $("tfWant").value === "fit" && $("tfPartner").value === "any" && $("tfMax").value === "4";
  $("tfReset").disabled = tfSplit() ? findClean : findClean && !tfSend.size && !$("tfSearch").value;
  syncPicker("tfTeam");
  const me = Number($("tfTeam").value), t = S.teams.get(me);
  void t;
  // drop anything no longer on this roster (team switched, or a trade happened)
  for (const id of [...tfSend]) if (S.assets.get(id)?.owner !== me) tfSend.delete(id);
  // roster list
  const q = normName($("tfSearch").value);
  const mine = teamAssets(me).filter(a => !q || normName(a.name).includes(q));
  $("tfList").innerHTML = mine.length ? mine.map(a => assetRow(a, tfSend.has(a.id))).join("") : `<p class="empty">Nothing matches that search.</p>`;
  // partner options
  const pSel = $("tfPartner"), prevP = pSel.value;
  pSel.innerHTML = `<option value="any">Any team</option>` + [...S.teams.values()].filter(x => x.rid !== me).map(x => `<option value="${x.rid}">${esc(x.name)}</option>`).join("");
  pSel.value = [...pSel.options].some(o => o.value === prevP) ? prevP : "any";
  // sending summary
  const sending = [...tfSend].map(id => S.assets.get(id)).filter(Boolean).sort((a, b) => b.value - a.value);
  const V = tradeValue(sending.map(a => a.value), []);
  if (tfTarget && (!S.assets.get(tfTarget) || S.assets.get(tfTarget).owner === me)) tfTarget = null;
  renderRecs(me);
  $("tfFindOut").hidden = true;
  if (tfTarget && tfSplit()){ findForTarget(me, S.assets.get(tfTarget), $("tfFindOut")); }   // computers: results stay in Find a Player
  else if (tfTarget){
    const a = S.assets.get(tfTarget), owner = S.teams.get(a.owner);
    $("tfOptsTitle").textContent = "Find a Player";
    $("tfSending").innerHTML = `<button type="button" class="tf-target" id="tfClearTarget" aria-label="Stop looking for ${esc(a.name)}">
      ${assetPhoto(a, "sm")}<span class="bi-text"><b>${esc(a.name)}${injTag(a.pid)}</b><small>${esc([a.pos + (a.lgPosRank || ""), a.nfl, a.age ? "age " + ageText(a.age) : "", "from " + (owner?.name || "")].filter(Boolean).join(", "))}</small></span><span class="v">${fmt(a.value)}</span><span class="tf-x" aria-hidden="true">✕</span></button>`;
    findForTarget(me, a);
    return;
  }
  $("tfOptsTitle").textContent = "Find a Player";
  $("tfSending").innerHTML = sending.length ? sending.map(a => `<button type="button" class="tf-chip" data-id="${esc(a.id)}" aria-label="Remove ${esc(a.name)}">
      ${assetPhoto(a, "sm")}<span class="bi-text"><b>${esc(a.name)}${injTag(a.pid)}</b><small>${esc(a.kind === "player" ? [a.pos + (a.lgPosRank || ""), a.nfl, a.age ? "age " + ageText(a.age) : ""].filter(Boolean).join(", ") : a.nfl)}</small></span><span class="v">${fmt(a.value)}</span><span class="tf-x" aria-hidden="true">✕</span></button>`).join("")
      + (sending.length > 1 ? `<div class="tf-total"><span>Package value</span><span>${fmt(V)}</span></div>` : "")
    : "";
  findTrades(me, sending, V);
}

// Shared picture of a team used by the finder and its recommendations
function finderContext(me){
  const prof = teamProfiles(), my = prof.get(me), N = S.teams.size, third = N / 3, need = slotNeeds();
  const status = S.teams.get(me).status;
  const dir = status === "contend" ? "win" : status === "rebuild" ? "build" : (my.ageRank <= third || my.pickRank <= third) ? "build" : "win";
  const POS = ["QB","RB","WR","TE"], weak = POS.filter(p => my.pos[p].rank > N - third);
  const starterSum = (players, p) => {
    const k = need[p], whole = Math.floor(k), frac = k - whole;
    const v = players.filter(a => a.pos === p).map(a => a.value).sort((a, b) => b - a);
    return v.slice(0, whole).reduce((s, x) => s + x, 0) + (v[whole] || 0) * frac;
  };
  const futureVal = a => a.kind === "pick" ? a.value * 1.2 : a.value * (!a.age ? 1 : a.age <= 23 ? 1.2 : a.age <= 25 ? 1.08 : a.age >= (CLIFF[a.pos] || 30) ? 0.7 : 0.95);
  const nowVal = a => a.kind === "pick" ? a.value * 0.35 : a.value * (a.age && a.age <= 22 ? 0.85 : 1);
  return { prof, my, N, third, need, status, dir, POS, weak, starterSum, futureVal, nowVal };
}

// Recommended players to trade for: realistic, impactful targets, not the obvious stars.
//  - Skips the elite tier (roughly the league's top 2 players per team overall, and each
//    position's top tier) since everyone already knows those players are worth chasing.
//  - Only suggests players you could land with your NON-CORE pieces (bench players and
//    picks, not your starters or your three best players), so a deal won't gut your roster.
//  - Ranks by impact for the price: how much he'd improve your lineup (or, for a rebuild,
//    his long-term value), boosted for your weak positions and for young upside.
//  - Shows a realistic price from your non-core pieces, e.g. "Could cost: 2027 2nd".
function myCore(me, C){
  const mine = teamAssets(me).filter(a => a.kind === "player");
  const core = new Set(mine.slice(0, 3).map(a => a.id));
  for (const p of C.POS){
    const k = Math.ceil(C.need[p] || 0);
    mine.filter(a => a.pos === p).slice(0, k).forEach(a => core.add(a.id));
  }
  return core;
}
function priceFrom(pool, v){
  // one piece worth about the same, else the best fair pair
  const single = pool.filter(a => a.value >= v * 0.9 && a.value <= v * 1.35).sort((x, y) => x.value - y.value)[0];
  if (single) return [single];
  let best = null, bestGap = Infinity;
  const top = pool.slice(0, 20);
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++){
    const t = tradeValue([top[i].value, top[j].value], [v]);
    if (t >= v * 0.92 && t - v < bestGap){ best = [top[i], top[j]]; bestGap = t - v; }
  }
  return best;
}
const TF_RECS_SHOWN = 5;
const tfRecsShown = () => typeof isPhoneView === "function" && isPhoneView() ? 3 : TF_RECS_SHOWN;   // phones show 3 at first
const tfMaxIdeas = n => typeof isPhoneView === "function" && isPhoneView() ? 15 : n;              // phones: 3 shown, up to 12 more behind a button
let tfRecTop = [], tfRecsAll = false;   // the recommended targets, and whether "Show more" is open
function renderRecs(me){
  const want = $("tfWant").value, partner = $("tfPartner").value;
  const { C, spare, top } = computeRecs(me, want, partner);
  $("tfRecsNote").textContent = C.dir === "win"
    ? "Realistic targets outside the elite tier who would help your lineup, priced against your bench and picks."
    : "Young, affordable players with upside for your rebuild, priced against your non-core pieces.";
  tfRecTop = tfSplit() ? computeRecs(me, "fit", "any").top : top;   // the top section's suggestions don't follow the Find a Player dropdowns on computers
  const shown = tfRecsAll ? top : top.slice(0, tfRecsShown());
  $("tfRecs").innerHTML = top.length ? shown.map(r => {
    const cost = priceFrom(spare, r.a.value);
    const costTxt = cost ? `Could cost: ${cost.map(x => x.name).join(" + ")}` : "";
    return tfRecHTML(r, costTxt);
  }).join("") + (top.length > tfRecsShown() ? `<button type="button" class="ghost tf-more" id="tfRecsMore">${tfRecsAll ? "Show fewer" : `Show ${top.length - tfRecsShown()} more`}</button>` : "")
    : `<p class="empty">No affordable targets${want !== "fit" && want !== "PICK" ? " at that position" : ""}${partner !== "any" ? " on that team" : ""} right now. Your bench and picks may not stretch that far.</p>`;
}
function computeRecs(me, want, partner){
  const C = finderContext(me);
  const myPlayers = teamAssets(me).filter(a => a.kind === "player");
  const core = myCore(me, C);
  const spare = teamAssets(me).filter(a => !core.has(a.id) && a.value > 0);          // non-core: bench + picks
  const budget = spare.length ? tradeValue(spare.slice(0, 2).map(a => a.value), []) : 0;
  const eliteRank = S.cfg.teams * 2;                                                  // ~top 20-24 overall
  const posElite = p => Math.max(3, Math.round(S.cfg.teams / 2));                    // ~top 5-6 at each position
  const recs = [];
  for (const [rid, th] of C.prof){
    if (rid === me || (partner !== "any" && String(rid) !== partner)) continue;
    for (const a of teamAssets(rid)){
      if (a.kind !== "player" || a.value < 500) continue;
      if (want !== "fit" && want !== "PICK" && a.pos !== want) continue;
      if ((a.lgRank && a.lgRank <= eliteRank) || (a.lgPosRank && a.lgPosRank <= posElite(a.pos))) continue;   // elite tier: a given
      if (a.value > budget) continue;                                                  // can't afford without gutting the roster
      const add = C.starterSum(myPlayers.concat([a]), a.pos) - C.starterSum(myPlayers, a.pos);
      const isWeak = C.weak.includes(a.pos), young = a.age && a.age <= 24.5, old = a.age && a.age >= (CLIFF[a.pos] || 30) - 1;
      let score, why;
      const ol = seasonOutlook(a.pid), wk = currentWeek(), away = ol && ol.back && ol.back > wk + 1;   // injured for more than this week
      if (C.dir === "win"){
        if (ol?.done) continue;                                                        // out for the season: no help to a contender
        if (add <= 0 && !isWeak) continue;                                             // must actually help
        score = add / 800 + (add / Math.max(1, a.value)) * 1.5 + (isWeak ? 1 : 0) + (young ? 0.3 : 0) - (old ? 0.8 : 0);
        if (away){ const left = Math.max(1, lastFantasyWeek() - wk + 1); score *= 0.4 + 0.6 * Math.max(0, (lastFantasyWeek() - ol.back + 1) / left); }   // weeks he'll miss count against him
        why = add > 0 ? (isWeak ? `Cheap fix for your thin ${a.pos} room` : `Would start for you at ${a.pos}`) : `Depth at your weak ${a.pos} spot`;
        if (away) why += ` once he's back (around Week ${ol.back})`;
      } else {
        if (old || tooOldForRebuild(a)) continue;
        score = C.futureVal(a) / 2500 + (young ? 0.9 : 0) + (isWeak ? 0.3 : 0) + (C.futureVal(a) / Math.max(1, a.value) - 1);
        why = young ? `Young (${ageText(a.age)}) with upside for your rebuild` : `Long-term value at ${a.pos}`;
      }
      if (young && C.dir === "win") why += ", with upside";
      if (th.team.status === "rebuild" && C.dir === "win") why += "; his team is rebuilding";
      if (th.team.status === "contend" && C.dir === "build") why += "; his team is contending";
      if (ol?.done && C.dir === "build") why += "; out for the season, so he may come cheap";
      recs.push({ a, score, why });
    }
  }
  recs.sort((x, y) => y.score - x.score);
  const per = {}, top = [];
  for (const r of recs){ if ((per[r.a.owner] = (per[r.a.owner] || 0) + 1) <= 2) top.push(r); if (top.length >= 10) break; }
  return { C, spare, top };
}
const tfRecHTML = (r, costTxt) => `<div class="tf-rec${tfTarget === r.a.id ? " on" : ""}">
      ${assetPhoto(r.a, "md")}<span class="tn"><b>${esc(r.a.name)}${injTag(r.a.pid)}</b><small>${esc([r.a.pos + (r.a.lgPosRank || ""), r.a.nfl, r.a.age ? "age " + ageText(r.a.age) : "", S.teams.get(r.a.owner)?.name].filter(Boolean).join(", "))}</small><span class="why">${esc(r.why)}</span>${costTxt ? `<span class="cost">${esc(costTxt)}</span>` : ""}</span>
      <span class="v">${fmt(r.a.value)}</span><button type="button" class="ghost go" data-target="${esc(r.a.id)}">Find a deal</button></div>`;

// FAAB to even out a deal that's a little off: the side coming out ahead adds FAAB (as much as it has
// left), valued the same way as in the calculator. Only offered when it actually makes the deal fair.
function tfFaab(me, rid, getV, sendV){
  const B = faabBudget(); if (!B) return null;
  const gap = getV - sendV; if (tradeCall(gap, Math.max(getV, sendV)) === "fair") return null;
  const perDollar = pickValue(24, 0) * FAAB_SHARE / B; if (!(perDollar > 0)) return null;
  const mine = gap > 0, left = faabLeft(mine ? me : rid), need = Math.ceil(Math.abs(gap) / perDollar);
  const amt = Math.min(left, need); if (amt < 1) return null;
  const after = mine ? getV - (sendV + faabValue(amt)) : (getV + faabValue(amt)) - sendV;
  if (tradeCall(after, Math.max(getV, sendV)) !== "fair") return null;
  return { side: mine ? "send" : "get", amt, text: mine ? `Add $${amt} of your FAAB to make it fair` : `Ask for $${amt} of their FAAB to make it fair` };
}
const tfFaabHTML = f => f ? `<p class="tf-faab"><span class="tf-faab-ic">$</span>${esc(f.text)}</p>` : "";
const tfFaabData = f => f ? ` data-faab-side="${f.side}" data-faab="${f.amt}"` : "";
// Reverse search: what could you send to land one specific player?
function targetPackages(me, target, C = finderContext(me), maxK = 3){
  const T = target.value, rid = target.owner, th = C.prof.get(rid);
  const mine = teamAssets(me), myPlayers = mine.filter(a => a.kind === "player");
  const before = {}; C.POS.forEach(p => before[p] = C.starterSum(myPlayers, p));
  const theirPlayers = teamAssets(rid).filter(a => a.kind === "player");
  const theirBefore = {}; C.POS.forEach(p => theirBefore[p] = C.starterSum(theirPlayers, p));
  const pool = mine.filter(a => a.value >= T * 0.08 && a.value <= T * 1.15);
  const POOL = { 1: 24, 2: 20, 3: 14 };
  function* combos(arr, k, start = 0, picked = []){
    if (picked.length === k){ yield picked.slice(); return; }
    for (let i = start; i <= arr.length - (k - picked.length); i++){ picked.push(arr[i]); yield* combos(arr, k, i + 1, picked); picked.pop(); }
  }
  const results = [];
  for (let k = 1; k <= maxK; k++) for (const pack of combos(pool.slice(0, POOL[k]), k)){
    if (pack.reduce((t, a) => t + a.value, 0) < T * 0.9) continue;
    const pv = pack.map(a => a.value);
    const S2 = tradeValue(pv, [T]) * T / Math.max(1, tradeValue([T], pv));   // adjusted for depth and roster spots
    if (S2 < T * 0.9 || S2 > T * 1.15) continue;                          // what you send should be close to what they're giving up
    const ids = new Set(pack.map(a => a.id));
    const after = myPlayers.filter(a => !ids.has(a.id)).concat(target.kind === "player" ? [target] : []);
    let gain = 0; const gainBy = {}; C.POS.forEach(p => { gainBy[p] = C.starterSum(after, p) - before[p]; gain += gainBy[p]; });
    const futureGain = C.futureVal(target) - pack.reduce((t, a) => t + C.futureVal(a), 0);
    let fit = C.dir === "win" ? gain / 1000 : futureGain / 1000 + 0.25 * gain / 1000;
    fit -= 0.3 * (pack.length - 1);
    const theirAfter = theirPlayers.filter(a => a.id !== target.id).concat(pack.filter(a => a.kind === "player"));
    let theirGain = 0; C.POS.forEach(p => theirGain += C.starterSum(theirAfter, p) - theirBefore[p]);
    const theirFuture = pack.reduce((t, a) => t + C.futureVal(a), 0) - C.futureVal(target);
    let accept = th.team.status === "rebuild" ? theirFuture / 1000 : th.team.status === "contend" ? theirGain / 1000 : Math.max(theirGain, theirFuture) / 1000;
    const theirNeed = pack.filter(a => a.kind === "player" && th.pos[a.pos].rank > C.N / 2).length;
    accept += theirNeed * 0.5 + habitBoost(rid, pack);
    const score = fit + 0.6 * accept - 3 * Math.abs(S2 - T) / T;
    results.push({ pack, S2, gain, gainBy, futureGain, theirNeed, score });
  }
  results.sort((a, b) => b.score - a.score);
  return { results, C, th, T, rid };
}
// Why a package works, in plain words (shared by "Ways to Get" and the default suggestions)
function packageWhy(r, C, th){
  const why = [];
  const lost = C.POS.filter(p => r.gainBy[p] < -200);
  if (C.dir === "win") why.push(r.gain >= 0 ? `Your starting lineup gets about ${fmt(r.gain)} stronger.` : `Costs about ${fmt(-r.gain)} of starting-lineup value${lost.length ? " at " + andList(lost) : ""}.`);
  else why.push(r.futureGain >= 0 ? "Adds long-term value for your rebuild." : "Costs some long-term value, but lands a player you want.");
  if (r.pack.some(a => a.kind === "pick") && r.gain > -200) why.push("Uses draft picks instead of your starters.");
  if (r.theirNeed) why.push(`${th.team.name} needs ${andList([...new Set(r.pack.filter(a => a.kind === "player" && th.pos[a.pos].rank > C.N / 2).map(a => a.pos))])}, so this should appeal to them.`);
  else if (th.team.status === "rebuild" && r.pack.some(a => a.kind === "pick" || (a.age && a.age <= 24))) why.push(`${th.team.name} is rebuilding, so youth and picks appeal to them.`);
  const h = managerHabits().get(th.team.rid), hb = h ? h.buys.filter(c => r.pack.some(a => (a.kind === "pick" ? "PICK" : a.pos) === c)) : [];
  if (hb.length) why.push(`${th.team.name} tends to buy ${andList(hb.map(catWord))} in trades.`);
  else if (h && h.never) why.push(`${th.team.name} hasn't made a trade yet, so expect a harder sell.`);
  return why;
}
const tfRowHTML = a => `<div class="tf-row">${assetPhoto(a, "md")}<span class="tn"><b>${esc(a.name)}${injTag(a.pid)}</b><small>${esc(a.kind === "player" ? [a.pos + (a.lgPosRank || ""), a.nfl, a.age ? "age " + ageText(a.age) : ""].filter(Boolean).join(", ") : a.nfl)}</small></span><span class="v">${fmt(a.value)}</span></div>`;
function tfVerdict(T, S2){ const diff = T - S2; return tradeCall(diff, Math.max(T, S2)) === "fair" ? ["Fair", "#3B82F6"] : diff > 0 ? ["You win by " + fmt(diff), "#22A55A"] : ["You pay " + fmt(-diff) + " extra", "#E5484D"]; }
function findForTarget(me, target, box){
  const plan = $("tfPlan"), maxK = box ? Math.min(3, Number($("tfMax").value) || 3) : 3;
  const { results, C, th, T, rid } = targetPackages(me, target, undefined, maxK);
  plan.textContent = `Looking for ways to get ${target.name} from ${th.team.name}${C.dir === "win" ? " while keeping your starting lineup as strong as possible" : " without giving up your best young pieces"}.`;
  const top = results.slice(0, tfMaxIdeas(box ? 6 : 8));
  const noteTxt = top.length ? "Packages from your roster that match their value, easiest on your lineup first." : "";
  const none = `<p class="empty">No fair packages of up to ${maxK} piece${maxK > 1 ? "s" : ""} found for ${esc(target.name)}. They may be worth more than your tradeable pieces.</p>`;
  let out;
  if (box){   // computers: a results area inside Find a Player, so Suggested Trades above stays as it is
    box.hidden = false;
    box.innerHTML = `<div class="tf-find-head"><h3>Ways to Get ${esc(target.name)}</h3><button type="button" class="ghost" id="tfClearTarget">Close</button></div>
      <p class="note" style="margin:0 0 12px">${noteTxt}</p><div class="tf-results" id="tfFindResults"></div>`;
    out = $("tfFindResults");
  } else {
    out = $("tfResults");
    $("tfHeading").textContent = `Ways to Get ${target.name}`;
    $("tfQuick").hidden = true;
    $("tfNote").textContent = noteTxt;
  }
  if (!top.length){ out.innerHTML = none; return; }
  out.innerHTML = top.map((r, i) => {
    const verdict = tfVerdict(T, r.S2), why = packageWhy(r, C, th), fb = tfFaab(me, rid, T, r.S2);
    return `<article class="tf-card${i === 0 ? " best" : ""}">
      <div class="tf-card-head"><span class="tf-rank" title="Rank ${i + 1} of ${top.length}">${i === 0 ? "#1 Best trade" : "#" + (i + 1)}</span>${teamPhoto(rid, "md")}<span class="nm"><b>${esc(th.team.name)}</b><small>${statusText[th.team.status]}</small></span></div>
      <div class="tf-get"><div class="lbl">You send</div>
        ${r.pack.map(tfRowHTML).join("")}
      </div>
      <ul class="tf-why">${why.slice(0, 3).map(w => `<li>${esc(w)}</li>`).join("")}</ul>${tfFaabHTML(fb)}
      <div class="tf-foot"><span class="tf-verdict" style="color:${verdict[1]}">${verdict[0]}</span>
        <button type="button" class="btn tf-open" data-rid="${rid}" data-send="${esc(r.pack.map(a => a.id).join(","))}" data-get="${esc(target.id)}"${tfFaabData(fb)}>Open in calculator</button></div>
    </article>`;
  }).join("");
}

// Before you pick anyone: the best deal for each of the top recommended players, so the page starts with answers
let tfQuick = { pos: "ALL", deal: "any", team: "any" };
function suggestDefault(me){
  const out = $("tfResults"), note = $("tfNote");
  $("tfQuick").hidden = true;
  $("tfHeading").textContent = "Suggested Trades for Your Team";
  const C = finderContext(me), cards = [];
  for (const rec of tfRecTop){
    if (cards.length >= tfMaxIdeas(3)) break;
    const { results, th, T, rid } = targetPackages(me, rec.a, C);
    if (results.length) cards.push({ target: rec.a, r: results[0], th, T, rid });
  }
  note.textContent = !cards.length ? "" : tfSplit() ? "The best deal from your selected players to trade away."
    : "The best deal for each of your top recommended players. Or pick players from your roster to see what they could bring back.";
  if (!cards.length){ out.innerHTML = `<p class="empty">Choose who you'd trade away and Front Office will find fair deals that fit your team.</p>`; return; }
  out.innerHTML = cards.map(({ target, r, th, T, rid }, i) => {
    const verdict = tfVerdict(T, r.S2), why = packageWhy(r, C, th), fb = tfFaab(me, rid, T, r.S2);
    return `<article class="tf-card${i === 0 ? " best" : ""}">
      <div class="tf-card-head"><span class="tf-rank">${i === 0 ? "#1 Best trade" : "#" + (i + 1)}</span>${teamPhoto(rid, "md")}<span class="nm"><b>${esc(th.team.name)}</b><small>${statusText[th.team.status]}</small></span></div>
      <div class="tf-get"><div class="lbl">You get</div>${tfRowHTML(target)}</div>
      <div class="tf-get"><div class="lbl">You send</div>${r.pack.map(tfRowHTML).join("")}</div>
      <ul class="tf-why">${why.slice(0, 3).map(w => `<li>${esc(w)}</li>`).join("")}</ul>${tfFaabHTML(fb)}
      <div class="tf-foot"><span class="tf-verdict" style="color:${verdict[1]}">${verdict[0]}</span>
        <button type="button" class="btn tf-open" data-rid="${rid}" data-send="${esc(r.pack.map(a => a.id).join(","))}" data-get="${esc(target.id)}"${tfFaabData(fb)}>Open in calculator</button></div>
    </article>`;
  }).join("");
}
function findTrades(me, sending, V){
  $("tfHeading").textContent = "Trades That Make Sense";
  $("tfQuick").hidden = true;
  const out = $("tfResults"), note = $("tfNote"), plan = $("tfPlan");
  const prof = teamProfiles(), my = prof.get(me), N = S.teams.size, third = N / 3, need = slotNeeds();
  const status = S.teams.get(me).status;
  const dir = status === "contend" ? "win" : status === "rebuild" ? "build" : (my.ageRank <= third || my.pickRank <= third) ? "build" : "win";
  const POS = ["QB","RB","WR","TE"];
  const weak = POS.filter(p => my.pos[p].rank > N - third);
  plan.textContent = `${S.teams.get(me).name} is ${statusPhrase[status]}, so results favor ${dir === "win" ? "proven players who help now" : "young players and picks"}${weak.length ? `, especially at ${andList(weak)}` : ""}.`;
  if (!sending.length){ suggestDefault(me); return; }

  // Your starting-lineup value by position, before and after a trade
  const starterSum = (players, p) => {
    const k = need[p], whole = Math.floor(k), frac = k - whole;
    const v = players.filter(a => a.pos === p).map(a => a.value).sort((a, b) => b - a);
    return v.slice(0, whole).reduce((s, x) => s + x, 0) + (v[whole] || 0) * frac;
  };
  const myPlayers = teamAssets(me).filter(a => a.kind === "player");
  const sentIds = new Set(sending.map(a => a.id));
  const keep = myPlayers.filter(a => !sentIds.has(a.id));
  const before = {}; POS.forEach(p => before[p] = starterSum(myPlayers, p));
  const futureVal = a => a.kind === "pick" ? a.value * 1.2 : a.value * (!a.age ? 1 : a.age <= 23 ? 1.2 : a.age <= 25 ? 1.08 : a.age >= (CLIFF[a.pos] || 30) ? 0.7 : 0.95);
  const nowVal = a => a.kind === "pick" ? a.value * 0.35 : a.value * (a.age && a.age <= 22 ? 0.85 : 1);
  const sentFuture = sending.reduce((s, a) => s + futureVal(a), 0), sentNow = sending.reduce((s, a) => s + nowVal(a), 0);
  const { want, partner, max: maxPieces } = tfTopOpts();

  const results = [];
  // Biggest pieces first; bigger packages look at fewer candidates to stay fast
  const POOL = { 1: 30, 2: 26, 3: 16, 4: 12 };
  function* combos(arr, k, start = 0, picked = []){
    if (picked.length === k){ yield picked.slice(); return; }
    for (let i = start; i <= arr.length - (k - picked.length); i++){ picked.push(arr[i]); yield* combos(arr, k, i + 1, picked); picked.pop(); }
  }
  for (const [rid, th] of prof){
    if (rid === me || (partner !== "any" && String(rid) !== partner)) continue;
    const roster = teamAssets(rid);
    const theirPlayers = roster.filter(a => a.kind === "player");
    const theirBefore = {}; POS.forEach(p => theirBefore[p] = starterSum(theirPlayers, p));
    const pool = roster.filter(a => a.value >= V * 0.08 && a.value <= V * FAIR_HIGH && !(dir === "build" && tooOldForRebuild(a)));
    for (let k = 1; k <= maxPieces; k++){
     for (const pack of combos(pool.slice(0, POOL[k]), k)){
      const raw = pack.reduce((t, a) => t + a.value, 0);
      if (raw < V * FAIR_LOW) continue;                         // can't reach fair value
      // Adjusted value you get, on the same scale as what you send
      const pv = pack.map(a => a.value), sv = sending.map(a => a.value);
      const R = tradeValue(pv, sv) * V / Math.max(1, tradeValue(sv, pv));
      if (R < V * FAIR_LOW || R > V * FAIR_HIGH) continue;
      if (want !== "fit" && !pack.some(a => (want === "PICK" ? a.kind === "pick" : a.pos === want))) continue;
      // How much your starting lineup improves (losing what you send, gaining what you get)
      const after = keep.concat(pack.filter(a => a.kind === "player"));
      let gain = 0; const gainBy = {};
      POS.forEach(p => { const d = starterSum(after, p) - before[p]; gainBy[p] = d; gain += d; });
      const futureGain = pack.reduce((s, a) => s + futureVal(a), 0) - sentFuture;
      const nowGain = pack.reduce((s, a) => s + nowVal(a), 0) - sentNow;
      let fit = dir === "win" ? gain / 1000 + 0.35 * nowGain / 1000 : futureGain / 1000 + 0.25 * gain / 1000;
      const fills = pack.filter(a => a.kind === "player" && weak.includes(a.pos) && gainBy[a.pos] > 0).map(a => a.pos);
      fit += fills.length * 0.8;
      fit -= 0.3 * (pack.length - 1);                              // simpler deals first
      const spots = pack.length - sending.length;                  // roster spots you'd need to open
      if (spots >= 2) fit -= 0.2 * (spots - 1);
      if (dir === "win") fit -= 0.4 * pack.filter(a => a.kind === "player" && a.age && a.age >= (CLIFF[a.pos] || 30) + 2).length;  // about to decline
      // Would they say yes? Their lineup gain + their direction
      const theirAfter = theirPlayers.filter(a => !pack.includes(a)).concat(sending.filter(a => a.kind === "player"));
      let theirGain = 0; POS.forEach(p => theirGain += starterSum(theirAfter, p) - theirBefore[p]);
      const theirDir = th.team.status === "contend" ? "win" : th.team.status === "rebuild" ? "build" : "either";
      let accept = theirDir === "build" ? (sentFuture - pack.reduce((s, a) => s + futureVal(a), 0)) / 1000 : theirGain / 1000;
      if (theirDir === "either") accept = Math.max(accept, (sentFuture - pack.reduce((s, a) => s + futureVal(a), 0)) / 1000);
      const theirNeed = sending.filter(a => a.kind === "player" && th.pos[a.pos].rank > N / 2).length;
      accept += theirNeed * 0.5 + habitBoost(rid, sending);     // their trading habits: active traders, positions they buy
      const score = fit + 0.5 * accept - 3 * Math.abs(R - V) / V + (R - V) / V;
      results.push({ rid, pack, R, gain, gainBy, futureGain, fills, accept, theirNeed, score, theirDir, spots });
     }
    }
  }
  // best two per team, then best overall
  results.sort((a, b) => b.score - a.score);
  const perTeam = {}, pool = [];
  for (const r of results){ if ((perTeam[r.rid] = (perTeam[r.rid] || 0) + 1) <= 12) pool.push(r); if (pool.length >= 400) break; }
  // quick filters above the results: what you get, how even the deal is, and which team
  const dealOf = r => tradeCall(r.R - V, Math.max(r.R, V)) === "fair" ? "fair" : r.R > V ? "win" : "pay";
  const teamsIn = [...new Set(pool.map(r => r.rid))];
  if (tfQuick.team !== "any" && !teamsIn.includes(Number(tfQuick.team))) tfQuick.team = "any";
  $("tfQuickTeam").innerHTML = `<option value="any">All teams</option>` + teamsIn.map(rid => `<option value="${rid}"${String(rid) === tfQuick.team ? " selected" : ""}>${esc(S.teams.get(rid)?.name || "")}</option>`).join("");
  const filtered = pool.filter(r => (tfQuick.pos === "ALL" || r.pack.some(a => tfQuick.pos === "PICK" ? a.kind === "pick" : a.pos === tfQuick.pos))
    && (tfQuick.deal === "any" || (tfQuick.deal === "one" ? r.pack.length === 1 && sending.length === 1 : dealOf(r) === tfQuick.deal))
    && (tfQuick.team === "any" || String(r.rid) === tfQuick.team));
  const seen = {}, picks = [];
  for (const r of filtered){ if (tfQuick.team === "any" && (seen[r.rid] = (seen[r.rid] || 0) + 1) > 2) continue; picks.push(r); if (picks.length >= tfMaxIdeas(10)) break; }
  $("tfQuick").hidden = !pool.length;
  note.textContent = picks.length
    ? `Every deal here is within about ${Math.round((1 - FAIR_LOW) * 100)}% of fair by your league's values. Best fits first.`
    : "";
  if (!picks.length && pool.length){ out.innerHTML = `<p class="empty">No trades match these filters. <button type="button" class="linklike" id="tfQuickClear">Show all</button></p>`; return; }
  if (!picks.length){ out.innerHTML = `<p class="empty">No fair deals of up to ${maxPieces} piece${maxPieces > 1 ? "s" : ""} found${want !== "fit" ? " for that position" : ""}${partner !== "any" ? " with that team" : ""}. Try "Best fit," "Any team," or add or remove a piece.</p>`; return; }

  out.innerHTML = picks.map((r, i) => {
    const th = S.teams.get(r.rid), diff = r.R - V, pct = Math.abs(diff) / Math.max(r.R, V);
    const verdict = tradeCall(diff, Math.max(r.R, V)) === "fair" ? ["Fair", "#3B82F6"] : diff > 0 ? ["You win by " + fmt(diff), "#22A55A"] : ["You pay " + fmt(-diff) + " extra", "#E5484D"];
    const why = [];
    for (const a of r.pack.filter(a => a.kind === "player")){
      const g = r.gainBy[a.pos];
      if (g > 0) why.push(`${a.name} ${r.fills.includes(a.pos) ? "fills a weak spot at " + a.pos : "upgrades your " + a.pos + " starters"}.`);
    }
    if (dir === "win" && r.gain > 0) why.push(`Your starting lineup gets about ${fmt(r.gain)} stronger overall.`);
    if (dir === "build" && r.futureGain > 0) why.push(`Adds long-term value: ${r.pack.some(a => a.kind === "pick") ? "draft capital" : "younger talent"} for your rebuild.`);
    if (dir === "win" && r.pack.every(a => a.kind === "player" && a.age && a.age >= 24)) why.push("Proven players who help this season.");
    if (r.theirNeed) why.push(`${th.name} ${th.status === "rebuild" ? "is rebuilding but" : "is " + statusPhrase[th.status] + " and"} needs ${andList([...new Set(sending.filter(a => a.kind === "player" && prof.get(r.rid).pos[a.pos].rank > N / 2).map(a => a.pos))])}, so they should be interested.`);
    else if (r.theirDir === "build" && sending.some(a => a.kind === "pick" || (a.age && a.age <= 24))) why.push(`${th.name} is rebuilding, so youth and picks appeal to them.`);
    else if (r.theirDir === "win") why.push(`${th.name} is contending, so they're looking to win now.`);
    { const h = managerHabits().get(r.rid); const hb = h && h.buys.filter(c => sending.some(a => (a.kind === "pick" ? "PICK" : a.pos) === c));
      if (hb && hb.length) why.push(`${th.name} tends to buy ${andList(hb.map(catWord))} in trades.`);
      else if (h && h.active) why.push(`${th.name} trades often (${h.recent} trades in the last year).`); }
    if (!why.length) why.push("Close in value and keeps your lineup balanced.");
    const fb = tfFaab(me, r.rid, r.R, V);
    return `<article class="tf-card${i === 0 ? " best" : ""}">
      <div class="tf-card-head"><span class="tf-rank" title="Rank ${i + 1} of ${picks.length}">${i === 0 ? "#1 Best trade" : "#" + (i + 1)}</span>${teamPhoto(r.rid, "md")}<span class="nm"><b>${esc(th.name)}</b><small>${statusText[th.status]}</small></span></div>
      <div class="tf-get"><div class="lbl">You get</div>
        ${r.pack.map(a => `<div class="tf-row">${assetPhoto(a, "md")}<span class="tn"><b>${esc(a.name)}${injTag(a.pid)}</b><small>${esc(a.kind === "player" ? [a.pos + (a.lgPosRank || ""), a.nfl, a.age ? "age " + ageText(a.age) : ""].filter(Boolean).join(", ") : a.nfl)}</small></span><span class="v">${fmt(a.value)}</span></div>`).join("")}
      </div>
      <ul class="tf-why">${why.slice(0, 3).map(w => `<li>${esc(w)}</li>`).join("")}</ul>${tfFaabHTML(fb)}
      <div class="tf-foot"><span class="tf-verdict" style="color:${verdict[1]}">${verdict[0]}</span>
        <button type="button" class="btn tf-open" data-rid="${r.rid}" data-get="${esc(r.pack.map(a => a.id).join(","))}"${tfFaabData(fb)}>Open in calculator</button></div>
    </article>`;
  }).join("");
}
$("tfRecs").addEventListener("click", e => {
  if (e.target.closest("#tfRecsMore")){ tfRecsAll = !tfRecsAll; renderRecs(Number($("tfTeam").value)); return; }
  const b = e.target.closest("[data-target]"); if (!b) return;
  tfTarget = tfTarget === b.dataset.target ? null : b.dataset.target;
  if (tfTarget && !tfSplit()) tfSend.clear();
  renderFinder();
  if (tfSplit()){ if (tfTarget) $("tfFindOut").scrollIntoView({ behavior: "smooth", block: "start" }); }
  else $("tfHeading").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("tfList").addEventListener("click", e => {
  const b = e.target.closest(".asset"); if (!b) return;
  if (!tfSplit()) tfTarget = null;
  tfSend.has(b.dataset.id) ? tfSend.delete(b.dataset.id) : tfSend.add(b.dataset.id); renderFinder();
});
$("tfSending").addEventListener("click", e => {
  if (e.target.closest("#tfClearTarget")){ tfTarget = null; renderFinder(); return; }
  const b = e.target.closest(".tf-chip"); if (b){ tfSend.delete(b.dataset.id); renderFinder(); }
});
["tfTeam","tfWant","tfPartner","tfMax"].forEach(id => $(id).addEventListener("change", renderFinder));
$("tfSearch").addEventListener("input", renderFinder);
// Reset: clear everything picked and put the filters back to their defaults
// (computers: this Reset sits in Find a Player, so it only resets that section)
$("tfReset").addEventListener("click", () => {
  tfTarget = null;
  if (!tfSplit()){ tfSend.clear(); tfQuickReset(); $("tfSearch").value = ""; }
  $("tfWant").value = "fit"; $("tfPartner").value = "any"; $("tfMax").value = "4";
  renderFinder();
});
// quick filters on Trades That Make Sense
for (const [id, k] of [["tfQuickPos", "pos"], ["tfQuickDeal", "deal"]]) $(id).addEventListener("click", e => {
  const b = e.target.closest("button[data-v]"); if (!b) return;
  tfQuick[k] = b.dataset.v;
  for (const x of $(id).children) x.setAttribute("aria-pressed", x === b);
  renderFinder();
});
$("tfQuickTeam").addEventListener("change", e => { tfQuick.team = e.target.value; renderFinder(); });
function tfQuickReset(){
  tfQuick = { pos: "ALL", deal: "any", team: "any" };
  for (const id of ["tfQuickPos", "tfQuickDeal"]) for (const x of $(id).children) x.setAttribute("aria-pressed", x === $(id).firstElementChild);
}
$("tfFindOut").addEventListener("click", e => {
  if (e.target.closest("#tfClearTarget")){ tfTarget = null; renderFinder(); return; }
  tfOpenInCalc(e);
});
$("tfResults").addEventListener("click", e => {
  if (e.target.closest("#tfQuickClear")){ tfQuickReset(); renderFinder(); return; }
  tfOpenInCalc(e);
});
function tfOpenInCalc(e){
  const b = e.target.closest(".tf-open"); if (!b) return;
  $("teamA").value = $("tfTeam").value; $("teamB").value = b.dataset.rid;
  S.sendIds = new Set(b.dataset.send ? b.dataset.send.split(",") : tfSend); S.getIds = new Set(b.dataset.get.split(","));
  S.faab = { send: 0, get: 0 }; S.faabOn = { send: false, get: false };
  if (b.dataset.faab){ S.faab[b.dataset.faabSide] = Number(b.dataset.faab); S.faabOn[b.dataset.faabSide] = true; }
  renderCalc();
  $("tabs").querySelector('[data-tab="calc"]').click();
  window.scrollTo({ top: $("groups").offsetTop, behavior: "smooth" });
}

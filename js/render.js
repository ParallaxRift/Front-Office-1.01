// Front Office: Rendering: league header, trade calculator, player values
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// RENDERING
// ============================================================
function renderLeague(){
  const c = S.cfg;
  $("leagueBar").style.display = "block";
  $("tabs").style.display = "flex"; $("groups").style.display = "flex";
  document.body.classList.add("has-league");

  $("modeBar").hidden = false; applyMode(currentMode(), true);
  $("leagueName").textContent = S.league.name;
  $("leagueAv").innerHTML = avatar(S.league.avatar, S.league.name, "lg");
  const myT = S.teams.get(S.myRid);
  $("myTeamLine").innerHTML = myT ? `<span class="teamcell">${teamPhoto(S.myRid, "sm")}${esc(myT.name)}</span>` : "";
  const recLabel = c.rec >= 1 ? "Full PPR" : c.rec >= .5 ? "Half PPR" : c.rec > 0 ? c.rec + " PPR" : "Standard";
  const chips = [`${c.teams} teams`, c.superflex ? "Superflex" : "1QB", recLabel];
  if (c.tep) chips.push(`TE premium +${c.tep}`);
  if (c.flex > 1) chips.push(`${c.flex} flex spots`);
  const rosterSpots = c.rp.filter(x => !["IR","TAXI"].includes(x)).length;
  chips.push(`${rosterSpots} roster spots`);
  chips.push(`${c.st.reserve_slots || 0} IR spots`);
  chips.push(`${c.st.taxi_slots || 0} taxi spots`);
  if (!c.dynasty) chips.push("Not a dynasty league");
  $("chips").innerHTML = "";   // league format details now live only on the League Settings tab
  $("champSlot").replaceChildren();
  // (last year's champion used to show here; it was removed from the header on 10/6. The Trophy Room still lists every champion.)
  const tuned = S.nudge ? `, and tuned to ${S.nudge.n} of your league's trades` : "";
  $("source").textContent = S.market.kind === "fo"
    ? `Market values: Front Office Rankings, adjusted for this league's settings${tuned}.`
    : `Market values: Estimated from Sleeper's player rankings and age curves, adjusted for this league's settings${tuned}.`;
  renderUpdated();
  const opts = [...S.teams.values()].map(t => `<option value="${t.rid}">${esc(t.name)}</option>`).join("");
  $("teamA").innerHTML = opts; $("teamB").innerHTML = opts;
  $("teamA").value = S.myRid;
  const other = [...S.teams.keys()].find(r => r !== S.myRid);
  $("teamB").value = other ?? S.myRid;
  $("board").style.display = "block"; $("sides").style.display = "grid";
  $("stratTeam").innerHTML = opts; $("stratTeam").value = S.myRid;
  $("tfTeam").innerHTML = opts; $("tfTeam").value = S.myRid;
  renderCalc(); renderValues(); renderSettings(); renderStrategy(); setupScores();
  if (S.history) renderHistory();
}

// ============================================================
// LAST YEAR'S CHAMPION
// Follows the league's link to last season, finds the winner of the
// 1st-place game in that playoff bracket, and adds a chip at the end.
// ============================================================
const TROPHY = `<svg class="trophy" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3V3zm-1 4v1a2 2 0 0 0 2 2V7H6zm12 0v3a2 2 0 0 0 2-2V7h-2z"/></svg>`;
async function loadChampion(league){
  const prevId = league.previous_league_id;
  if (!prevId || prevId === "0") return;
  try {
    const [prev, bracket, rosters, users] = await Promise.all([
      getJSON(`/league/${prevId}`), getJSON(`/league/${prevId}/winners_bracket`),
      getJSON(`/league/${prevId}/rosters`), getJSON(`/league/${prevId}/users`)
    ]);
    const final = (bracket || []).find(m => m.p === 1 && m.w);
    if (!final || S.league?.league_id !== league.league_id) return;
    const ro = (rosters || []).find(r => r.roster_id === final.w);
    const u = (users || []).find(x => x.user_id === ro?.owner_id);
    // Prefer the champ's current team name and photo if they're still in the league
    const now = [...S.teams.values()].find(t => t.owner === ro?.owner_id);
    const name = now?.name || u?.metadata?.team_name || u?.display_name || "Unknown";
    const photo = now ? now.photo : (u?.metadata?.avatar || u?.avatar);
    const chip = document.createElement("span");
    chip.className = "chip champ";
    chip.title = `${prev?.season || "Last season"} champion`;
    chip.innerHTML = `${avatar(photo, name)}${TROPHY}${esc(prev?.season || "Last year")} champ: ${esc(name)}`;
    $("champSlot").replaceChildren(chip);
  } catch(e){ console.warn("Couldn't load last season's champion", e); }
}

const statusText = { contend:"Contender", middle:"Middle", rebuild:"Rebuilding" };
const badgeClass = { contend:"b-contend", middle:"b-middle", rebuild:"b-rebuild" };

function teamAssets(rid){
  return [...S.assets.values()].filter(a => a.owner === rid && a.value > 0).sort((a,b) => b.value - a.value);
}
// Player headshots come from Sleeper's image server (same place the Sleeper app gets them).
// Picks show the logo of the team the pick originally belonged to. Missing images fall back to the football icon.
const PLAYER_IMG = pid => `https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(pid)}.jpg`;
// Injury designation tag shown next to a player's name everywhere (live from Sleeper's player list)
const INJ_SHORT = { Questionable: ["Q", "q"], Doubtful: ["D", "d"], Out: ["O", "o"], IR: ["IR", "o"], PUP: ["PUP", "o"], NFI: ["NFI", "o"], Sus: ["SUS", "o"], COV: ["COV", "o"], NA: ["NA", "d"], DNR: ["DNR", "d"] };
function injTag(pid){
  const sp = pid != null ? S.sleeperPlayers?.[pid] : null, st = sp?.injury_status, t = INJ_SHORT[st];
  if (!t) return "";
  const full = (INJ_LABEL[st]?.[0] || st) + (sp.injury_body_part ? ": " + sp.injury_body_part : "");
  return ` <span class="inj inj-${t[1]}" title="${esc(full)}" aria-label="${esc(full)}">${t[0]}</span>`;
}
const NFL_COLORS = {ARI:"#97233F",ATL:"#A71930",BAL:"#241773",BUF:"#00338D",CAR:"#0085CA",CHI:"#0B162A",CIN:"#FB4F14",CLE:"#311D00",DAL:"#041E42",DEN:"#FB4F14",DET:"#0076B6",GB:"#203731",HOU:"#03202F",IND:"#002C5F",JAX:"#006778",KC:"#E31837",LV:"#000000",LAC:"#0080C6",LAR:"#003594",LA:"#003594",MIA:"#008E97",MIN:"#4F2683",NE:"#002244",NO:"#101820",NYG:"#0B2265",NYJ:"#125740",PHI:"#004C54",PIT:"#101820",SF:"#AA0000",SEA:"#002244",TB:"#D50A0A",TEN:"#0C2340",WAS:"#5A1414"};
// The player's CURRENT NFL team, straight from Sleeper's player list (reloaded every time a league opens)
const currentTeam = pid => { const t = S.sleeperPlayers?.[pid]?.team; return t && NFL_COLORS[t] ? t : null; };
const teamBgStyle = t => t ? `--tm:${NFL_COLORS[t]};--tm-logo:url('https://sleepercdn.com/images/team_logos/nfl/${t.toLowerCase()}.png')` : "";
function assetPhoto(a, size){
  if (a.kind === "player"){
    const t = currentTeam(a.pid);
    return avatar(PLAYER_IMG(a.pid), a.name, size)
      .replace('class="av', `data-pid="${esc(a.pid)}"${t ? ` style="${teamBgStyle(t)}"` : ""} class="av pl${t ? " tm" : ""}`)
      .replace(/title="[^"]*"/, `title="${esc(a.name)}: tap for player card"`);
  }
  const orig = Number(String(a.id).split("-").pop());
  return S.teams.has(orig) ? teamPhoto(orig, size) : avatar(null, a.name, size);
}
// "WR5, #11 overall" in bold, from this league's values
const rankHTML = a => [a.lgPosRank ? a.pos + a.lgPosRank : "", a.lgRank ? "#" + a.lgRank + " overall" : ""].filter(Boolean).map(x => `<strong class="rk-b">${x}</strong>`).join(", ");
function assetRow(a, sel, showOwner){
  // second line; the player's position rank and overall rank are in bold
  const sub = a.kind === "pick" ? esc([a.nfl, showOwner ? S.teams.get(a.owner)?.name : ""].filter(Boolean).join(", "))
    : [esc(a.nfl), a.age ? "age " + ageText(a.age) : "", rankHTML(a), showOwner ? esc(S.teams.get(a.owner)?.name || "") : ""].filter(Boolean).join(", ");
  return `<button class="asset${sel?" sel":""}" data-id="${esc(a.id)}" aria-pressed="${sel}">
    <span class="pos">${esc(a.pos)}</span>
    ${assetPhoto(a, "row")}
    <span class="nm"><b>${esc(a.name)}${injTag(a.pid)}</b><small>${sub}</small></span>
    <span class="val">${fmt(a.value)}</span></button>`;
}
// FAAB a team still has this season: the league budget minus what it has spent on waivers
function faabLeft(rid){
  const ro = S.rosters?.find(r => r.roster_id === rid);
  return Math.max(0, faabBudget() - (Number(ro?.settings?.waiver_budget_used) || 0));
}
function faabAssetRow(rid, side){
  const left = faabLeft(rid), amt = S.faab[side] || 0, sel = !!S.faabOn[side];
  return `<div class="asset faab-asset${sel ? " sel" : ""}" data-faab="${side}" role="button" tabindex="0" aria-pressed="${sel}">
    <span class="pos">FAAB</span><span class="faab-ico" aria-hidden="true">$</span>
    <span class="nm"><b>FAAB</b><small>$${fmt(left)} left of $${fmt(faabBudget())}${sel ? "" : " · tap to add"}</small></span>
    ${sel ? `<label class="faab-in" title="How much FAAB to include">$<input type="text" inputmode="numeric" class="faab-amt" value="${amt || ""}" placeholder="0" aria-label="FAAB amount"></label>` : ""}
    <span class="val">${sel ? fmt(faabValue(amt)) : left ? fmt(faabValue(left)) : "$0"}</span></div>`;
}
function renderSide(rid, listEl, badgeEl, set){
  const t = S.teams.get(rid);
  badgeEl.textContent = statusText[t.status]; badgeEl.className = "badge " + badgeClass[t.status];
  const side = listEl.id === "listA" ? "A" : "B";
  listEl.classList.toggle("browse", !!browseAll[side]);   // "All Players" keeps its own scroll; a team roster shows in full
  const f = $("pos" + side).value;
  const q = browseAll[side] ? normName($("browse" + side).value) : "";
  const pool = browseAll[side] ? [...S.assets.values()].filter(a => a.owner != null && a.value > 0 && (!q || normName(a.name).includes(q))).sort((a, b) => b.value - a.value).slice(0, 300)
                               : teamAssets(rid);
  const items = pool.filter(a => f === "EVERY" ? true : f === "ALL" ? a.kind === "player" : f === "PICK" ? a.kind === "pick" : a.pos === f);
  const faabSide = side === "A" ? "send" : "get";
  const faabHTML = !browseAll[side] && faabBudget() && (f === "EVERY" || f === "PICK") ? faabAssetRow(rid, faabSide) : "";
  listEl.innerHTML = items.length || faabHTML ? faabHTML + items.map(a => assetRow(a, set.has(a.id), browseAll[side])).join("") : `<p class="empty">${browseAll[side] ? "No players or picks match." : f === "EVERY" || f === "ALL" ? "No valued players on this roster yet." : "None on this roster."}</p>`;
}
const eq = vals => Math.pow(vals.reduce((s,v) => s + Math.pow(v, STUD_EXPONENT), 0), 1/STUD_EXPONENT);

// ---------- Trade value adjustment ----------
// Several lesser pieces never add up to one difference-maker. For one side of a trade:
//  1. Its best piece counts in full.
//  2. Every extra piece is discounted by how far it falls below the best piece in the whole trade
//     (half as valuable counts about 80%, a quarter as valuable about 66%, a tenth about 55%).
//  3. Each extra roster spot it takes (receiving more pieces than you send) costs about one
//     waiver-level player (the best player nobody in the league has room for), since someone has to be cut.
const DEPTH_FLOOR = 0.4, DEPTH_CURVE = 0.6;
// Team-aware version used by the Trade Calculator. On top of tradeValue's rules it:
//  - discounts depth more when the best piece is a true star (top of the league),
//  - discounts less for extra pieces that would crack the receiving team's starting lineup,
//  - charges less for roster spots when the receiving team actually has open spots.
const STAR_EXTRA = 0.12;      // up to 12% more depth discount against an elite piece
// These three are the defaults; with enough trades they're fit to the league's own trades (S.depth)
const depthSettings = () => S.depth || { floor: DEPTH_FLOOR, curve: DEPTH_CURVE, star: STAR_EXTRA };
// (Team-specific relief for pieces that would start, and cheaper roster spots for teams with open
// spots, were removed from the grade: trades are graded on league market value only.)
function teamOpenSpots(rid){
  const r = S.rosters.find(x => x.roster_id === rid); if (!r) return 0;
  const size = (S.cfg.rp || []).filter(x => !["IR","TAXI"].includes(x)).length;
  const active = (r.players || []).length - (r.taxi || []).length - (r.reserve || []).length;
  return Math.max(0, size - active);
}
function wouldStart(a, rid, leaving){
  if (!a || a.kind !== "player" || rid == null) return false;
  const k = Math.ceil(slotNeeds()[a.pos] || 0); if (!k) return false;
  const vals = teamAssets(rid).filter(x => x.kind === "player" && x.pos === a.pos && !leaving.has(x.id)).map(x => x.value).sort((x, y) => y - x);
  return vals.length < k || a.value > vals[k - 1];
}
// One side's adjusted trade value. Rules:
//  - Its best piece counts in full.
//  - Every other piece is discounted by how far it falls short of the best piece it's being traded
//    FOR (the other side's best): about 80% at half as valuable, 66% at a quarter, 55% at a tenth,
//    and up to 12% more when that piece is a true star. Measuring against the OTHER side keeps the
//    math monotonic: adding something to a side can never lower that side's total.
//  - Each extra roster spot the side takes (more pieces in than out) costs about one waiver-level
//    player, charged against its smallest pieces and never more than a piece is worth, so a throw-in
//    can only add value, never subtract it.
//  - It uses league market values only. How a trade fits a particular roster is shown separately
//    (lineup impact) and never changes the grade.
function tradeValue(getVals, giveVals){
  if (!getVals.length) return 0;
  const v = [...getVals].sort((a, b) => b - a), best = v[0];
  const ref = giveVals.length ? Math.max(1, ...giveVals) : best;           // the best piece this side is getting traded for
  const eliteLine = S.eliteValue || 9000;
  const starness = Math.max(0, Math.min(1, (ref - eliteLine * 0.75) / (10000 - eliteLine * 0.75)));
  const contrib = [{ c: best, w: 1 }];
  for (let i = 1; i < v.length; i++){
    const D = depthSettings();
    const w = (D.floor + (1 - D.floor) * Math.pow(Math.min(1, v[i] / ref), D.curve)) * (1 - D.star * starness);
    contrib.push({ c: v[i] * w, w });
  }
  // The roster-spot charge is the waiver level on the same discounted scale as the piece, so a piece
  // is never penalized twice, and never charged more than it's worth.
  const extra = Math.max(0, getVals.length - giveVals.length), rep = S.replacement || 0;
  const charge = [...contrib].sort((a, b) => a.c - b.c).slice(0, extra).reduce((t, x) => t + Math.min(rep * x.w, x.c), 0);
  return Math.max(0, contrib.reduce((t, x) => t + x.c, 0) - charge);
}
// Kept for the calculator: same market-only math, from assets instead of numbers
function tradeValueFor(getAssets, giveAssets){
  if (!getAssets.length) return { total: 0, raw: 0 };
  const g = getAssets.map(a => a.value), s = giveAssets.map(a => a.value);
  return { total: tradeValue(g, s), raw: g.reduce((t, x) => t + x, 0) };
}
// Lineup impact: how much a team's projected starting lineup (by league value) changes after the trade.
// Shown next to the grade as roster fit; it never changes the grade itself.
function lineupValue(players){
  const need = slotNeeds(); let total = 0;
  for (const p of ["QB", "RB", "WR", "TE"]){
    const vals = players.filter(a => a.pos === p).map(a => a.value).sort((x, y) => y - x), k = need[p] || 0, whole = Math.floor(k);
    total += vals.slice(0, whole).reduce((t, x) => t + x, 0) + (vals[whole] || 0) * (k - whole);
  }
  return total;
}
function lineupImpact(rid, outIds, inAssets){
  const before = teamAssets(rid).filter(a => a.kind === "player");
  const after = before.filter(a => !outIds.has(a.id)).concat(inAssets.filter(a => a.kind === "player"));
  return lineupValue(after) - lineupValue(before);
}

// The "Trade Analysis Breakdown" button beside the verdict opens the reasoning; it stays open or closed as you edit the trade
let analysisOpen = false;
function renderAnalysis(notes){
  const btn = $("analysisBtn"), panel = $("hint");
  btn.hidden = !notes.length;
  panel.innerHTML = notes.length ? `<ul class="ta-list">${notes.map(([k, v]) => `<li><b>${esc(k)}</b><span>${esc(v)}</span></li>`).join("")}</ul>` : "";
  panel.hidden = !notes.length || !analysisOpen;
  btn.setAttribute("aria-expanded", String(!panel.hidden));
}
$("analysisBtn").addEventListener("click", () => { analysisOpen = !analysisOpen; $("hint").hidden = !analysisOpen; $("analysisBtn").setAttribute("aria-expanded", String(analysisOpen)); });
// ---------- FAAB in trades ----------
// FAAB is usually a throw-in, so a league's full FAAB budget counts as half of a late 2nd-round
// pick in that league (12-team 2.12),
// and any amount is that times its share of the budget. FAAB takes no roster spot, so it adds
// straight on top without the depth discount.
const faabBudget = () => Number(S.cfg?.st?.waiver_budget) || 0;
const FAAB_SHARE = 0.5;   // a full budget = half a late 2nd
function faabValue(amt){ const B = faabBudget(); return amt > 0 && B > 0 ? Math.round(amt / B * pickValue(24, 0) * FAAB_SHARE) : 0; }
function renderCalc(){
  const ra = Number($("teamA").value), rb = Number($("teamB").value);
  syncPicker("teamA"); syncPicker("teamB");
  // drop selections that no longer belong to the chosen teams
  for (const id of [...S.sendIds]) if (S.assets.get(id)?.owner !== ra) S.sendIds.delete(id);
  for (const id of [...S.getIds]) if (S.assets.get(id)?.owner !== rb) S.getIds.delete(id);
  S.faab.send = Math.min(S.faab.send || 0, faabLeft(ra)); S.faab.get = Math.min(S.faab.get || 0, faabLeft(rb));   // can't trade more FAAB than a team has
  renderSide(ra, $("listA"), $("badgeA"), S.sendIds);
  renderSide(rb, $("listB"), $("badgeB"), S.getIds);
  $("avA").innerHTML = teamPhoto(ra, "md"); $("avB").innerHTML = teamPhoto(rb, "md");

  const send = [...S.sendIds].map(id => S.assets.get(id).value);
  const get = [...S.getIds].map(id => S.assets.get(id).value);
  $("shareLink").disabled = $("shareImage").disabled = !((send.length || S.faab.send) && (get.length || S.faab.get));
  // Value adjustment, shown KeepTradeCut-style: nobody's players lose value. Instead, the side with
  // the fewer, better pieces gets a bonus added on top, worth the difference the depth/roster-spot
  // math finds. (The comparison comes out exactly the same as discounting the other side.)
  const rawS = send.reduce((a, b) => a + b, 0), rawG = get.reduce((a, b) => a + b, 0);
  const both = send.length && get.length;
  const sendA = [...S.sendIds].map(id => S.assets.get(id)).filter(Boolean), getA = [...S.getIds].map(id => S.assets.get(id)).filter(Boolean);
  // what you get lands on your team (ra); what you send lands on theirs (rb)
  const adjDiff = both ? (rawG - tradeValueFor(getA, sendA, ra).total) - (rawS - tradeValueFor(sendA, getA, rb).total) : 0;
  const bonusS = Math.max(0, Math.round(adjDiff)), bonusG = Math.max(0, Math.round(-adjDiff));
  const fS = faabValue(S.faab.send), fG = faabValue(S.faab.get);   // FAAB counts on top: it doesn't take a roster spot
  const eS = rawS + bonusS + fS, eG = rawG + bonusG + fG;
  $("sendNum").textContent = fmt(eS); $("getNum").textContent = fmt(eG);
  // Team name + logo on each side, and the players/picks being traded (tap one to remove it)
  const tA = S.teams.get(ra), tB = S.teams.get(rb);
  $("sendTeam").innerHTML = tA ? `${teamPhoto(ra, "md")}<span class="nm">${esc(tA.name)}</span>` : "";
  $("getTeam").innerHTML = tB ? `${teamPhoto(rb, "md")}<span class="nm">${esc(tB.name)}</span>` : "";
  const itemsHTML = (ids, side) => [...ids].map(id => S.assets.get(id)).filter(Boolean).sort((a, b) => b.value - a.value)
    .map(a => {
      const sub = a.kind === "player" ? [esc(a.nfl), a.age ? "age " + ageText(a.age) : "", rankHTML(a)].filter(Boolean).join(", ") : esc(a.nfl);
      return `<div class="bitem">
        <button type="button" class="bi-link" data-show="${esc(a.id)}" title="${a.kind === "player" ? "Open " + esc(a.name) + "'s player card" : "See " + esc(a.name) + " in Rankings"}">
          ${assetPhoto(a, "trade")}<span class="bi-text"><b>${esc(a.name)}${injTag(a.pid)}</b><small>${sub}</small></span></button>
        <span class="bi-val">${fmt(a.value)}</span>
        <button type="button" class="bi-x" data-side="${side}" data-id="${esc(a.id)}" aria-label="Remove ${esc(a.name)} from the trade">✕</button></div>`;
    }).join("");
  // The team that would need to add value is the one receiving the bonus's opposite side
  const equivalent = (n, fromRid, exclude) => {
    if (n < 300 || fromRid == null) return null;
    const pool = teamAssets(fromRid).filter(a => !exclude.has(a.id) && a.value > 0);
    return pool.sort((a, b) => Math.abs(a.value - n) - Math.abs(b.value - n))[0] || null;
  };
  const adjRow = (n, fromRid, exclude) => {
    if (n < 1) return "";
    const eqA = equivalent(n, fromRid, exclude);
    return `<div class="badj"><span><span>Value adjustment<button type="button" class="info-btn" data-info="adjust" aria-label="What is the value adjustment?">?</button></span>${eqA ? `<small class="badj-eq" title="A player with a market value close to the adjustment. Position and roster fit still matter, so it's a starting point, not an exact match.">Approximate balancing piece: ${esc(eqA.name)}${injTag(eqA.pid)} (${fmt(eqA.value)})</small>` : ""}</span><b>+${fmt(n)}</b></div>`;
  };
  // bonus on your side = the other team (rb) would need to add; bonus on their side = you (ra) would
  const faabRow = (amt, val, side) => amt > 0 ? `<div class="bitem faab-item"><span class="bi-link"><span class="faab-ico" aria-hidden="true">$</span><span class="bi-text"><b>$${fmt(amt)} FAAB</b><small>waiver budget</small></span></span><span class="bi-val">${fmt(val)}</span><button type="button" class="bi-x" data-faab="${side}" aria-label="Remove FAAB">✕</button></div>` : "";
  $("sendItems").innerHTML = itemsHTML(S.sendIds, "send") + faabRow(S.faab.send, fS, "send") + adjRow(bonusS, rb, S.getIds);
  $("getItems").innerHTML = itemsHTML(S.getIds, "get") + faabRow(S.faab.get, fG, "get") + adjRow(bonusG, ra, S.sendIds);
  $("bPlayers").hidden = !S.sendIds.size && !S.getIds.size && !S.faab.send && !S.faab.get;
  $("swCountA").textContent = S.sendIds.size ? `(${S.sendIds.size})` : ""; $("swCountB").textContent = S.getIds.size ? `(${S.getIds.size})` : "";
  $("swTeamA").textContent = browseAll.A ? "All Players" : (tA?.name || ""); $("swTeamB").textContent = browseAll.B ? "All Players" : (tB?.name || "");
  $("resetTrade").disabled = !S.sendIds.size && !S.getIds.size && !S.faab.send && !S.faab.get;
  // Under each total: the value adjustment, when there is one
  $("sendRaw").innerHTML = ""; $("getRaw").innerHTML = "";
  // The math, laid out like a problem in the middle of the calculator: players & picks, then FAAB and
  // the value adjustment if any, then the total. Left team right-aligned, right team left-aligned.
  const anyS = S.sendIds.size || S.faab.send, anyG = S.getIds.size || S.faab.get;
  if (anyS || anyG){
    const line = (lbl, l, r, cls = "") => `<div class="tm-l ${cls}">${l}</div><div class="tm-lbl ${cls}">${lbl}</div><div class="tm-r ${cls}">${r}</div>`;
    const plus = n => n ? "+" + fmt(n) : "—";
    let h = line("Players &amp; picks", fmt(rawS), fmt(rawG));
    if (fS || fG) h += line("FAAB", plus(fS), plus(fG));
    if (bonusS || bonusG) h += line("Value adjustment", plus(bonusS), plus(bonusG), "adj");
    h += line("Total", fmt(eS), fmt(eG), "tot");
    $("tradeMath").innerHTML = `<div class="tm-grid">${h}</div>`;
  }
  $("tradeMath").hidden = !(anyS || anyG);
  const total = eS + eG;
  $("fill").style.width = (total ? (eS/total*100) : 50) + "%";
  $("fill").className = "fill";   // gold until both sides have something

  const sug = $("suggest"); sug.innerHTML = "";
  const hasS = send.length || S.faab.send > 0, hasG = get.length || S.faab.get > 0;
  if (!hasS && !hasG){ $("verdict").textContent = "Tap players and picks to build a trade."; renderAnalysis([]); return; }
  if (!hasS || !hasG){ $("verdict").textContent = "Add something to both sides."; renderAnalysis([]); return; }
  const gap = eG - eS, pct = Math.abs(gap) / Math.max(eS, eG), call = tradeCall(gap, Math.max(eS, eG));
  const extraPct = Math.round(Math.abs(gap) / Math.max(1, Math.min(eS, eG)) * 100);   // how much more one side gets
  const themName = S.teams.get(rb)?.name || "They";
  // Bar color: blue = fair, green = you win, red = you overpay, orange = lopsided in your favor
  $("fill").classList.add(call === "fair" ? "even" : call === "lopsided" && gap > 0 ? "lopsided" : gap > 0 ? "win" : "lose");
  if (call === "fair") $("verdict").textContent = "Fair trade";
  else if (call === "lopsided") $("verdict").textContent = gap > 0 ? `One-sided: favors you by ${fmt(gap)}` : `One-sided: you overpay by ${fmt(-gap)}`;
  else if (gap > 0) $("verdict").textContent = `You win by ${fmt(gap)}`;
  else $("verdict").textContent = `You overpay by ${fmt(-gap)}`;

  // Trade Analysis Breakdown: the reasoning behind the verdict, one labeled point each
  const me = S.teams.get(ra);
  const getPicks = [...S.getIds].filter(id => S.assets.get(id).kind === "pick").length;
  const getYoung = [...S.getIds].filter(id => { const a=S.assets.get(id); return a.kind==="player" && a.age && a.age <= 24; }).length;
  const notes = [];
  if (call === "lopsided") notes.push(["Who gives up too much", gap > 0
    ? `${themName} gives up too much here: you get about ${extraPct}% more than you send. They're unlikely to accept, and a league with trade review might veto it.`
    : `You give up too much here: ${themName} gets about ${extraPct}% more than you. Ask for more back before sending it.`]);
  else if (call === "fair") notes.push(["Why it's fair", `The two sides are ${fmt(Math.abs(gap))} apart, inside the fair range (${fmt(FAIR_POINTS)} points, or ${Math.round(FAIR_BAND * 100)}% of the bigger side on large trades).`]);
  else notes.push(["The edge", `${gap > 0 ? "You get" : themName + " gets"} about ${extraPct}% more. That's a normal negotiating gap, not one-sided.`]);
  if (me.status === "rebuild" && (getPicks || getYoung)) notes.push(["Team fit", "Picks and young players fit your rebuild."]);
  else if (me.status === "contend" && (getPicks || getYoung) && !(gap > 0)) notes.push(["Team fit", "You're contending, so trading proven players for futures could hurt this season."]);
  if (fS || fG) notes.push(["FAAB", `A full $${fmt(faabBudget())} budget counts as about half a late 2nd-round pick (${fmt(faabValue(faabBudget()))}), since FAAB is usually a throw-in, so ${[S.faab.send ? `your $${fmt(S.faab.send)} is worth ${fmt(fS)}` : "", S.faab.get ? `their $${fmt(S.faab.get)} is worth ${fmt(fG)}` : ""].filter(Boolean).join(" and ")}.`]);
  // Explain the value adjustment when it changes the picture noticeably
  const bonus = Math.max(bonusS, bonusG);
  if (bonus > 0.05 * Math.max(rawS, rawG))
    notes.push(["Value adjustment", `The ${bonusS ? "side you send" : "side you get"} gets +${fmt(bonus)}, because one difference-maker is worth more than several smaller pieces that take up roster spots.`]);
  // Roster fit, shown separately from the grade: how each team's starting lineup changes
  const youImp = lineupImpact(ra, S.sendIds, getA), themImp = lineupImpact(rb, S.getIds, sendA);
  const sgn = n => (n >= 0 ? "+" : "−") + fmt(Math.abs(Math.round(n)));
  if (Math.abs(youImp) >= 50 || Math.abs(themImp) >= 50)
    notes.push(["Lineup impact", `Your starting lineup ${sgn(youImp)}, theirs ${sgn(themImp)}. Starters only; this isn't part of the grade.`]);
  renderAnalysis(notes);

  // suggest assets to even it out
  if (call !== "fair"){
    const needFromThem = gap < 0; // you overpay: ask them to add
    const pool = teamAssets(needFromThem ? rb : ra).filter(a => !(needFromThem ? S.getIds : S.sendIds).has(a.id));
    const target = Math.abs(gap);
    const picks = pool.sort((a,b) => Math.abs(a.value-target) - Math.abs(b.value-target)).slice(0,3);
    if (picks.length){
      const lbl = document.createElement("span"); lbl.className="hint";
      lbl.textContent = needFromThem ? "Ask them to add:" : "You could add:";
      sug.appendChild(lbl);
      for (const a of picks){
        const b = document.createElement("button");
        b.innerHTML = `<span>${esc(a.name)}</span><b>${fmt(a.value)}</b>`;
        b.addEventListener("click", () => { (needFromThem ? S.getIds : S.sendIds).add(a.id); renderCalc(); });
        sug.appendChild(b);
      }
    }
  }
}

function isPhone(){ return window.matchMedia("(max-width:600px)").matches; }
function addedNote(set, id, wasIn){
  if (!isPhone()) return;
  const a = S.assets.get(id); if (!a) return;
  toast(wasIn ? `Removed ${a.name}` : `${a.name} added to ${set === S.sendIds ? "You Send" : "You Get"}`);
}
function toggle(set, e){
  if (e.target.closest(".faab-in")) return;                      // typing an amount, not toggling
  const fb = e.target.closest(".faab-asset");
  if (fb){ const side = fb.dataset.faab, rid = Number($(side === "send" ? "teamA" : "teamB").value);
    S.faabOn[side] = !S.faabOn[side];
    S.faab[side] = S.faabOn[side] ? faabLeft(rid) : 0;            // add all of it; then type a smaller amount if you like
    renderCalc(); if (S.faabOn[side]) $(side === "send" ? "listA" : "listB").querySelector(".faab-amt")?.select(); return; }
  const btn = e.target.closest(".asset"); if (!btn) return;
  const id = btn.dataset.id, wasIn = set.has(id);
  wasIn ? set.delete(id) : set.add(id); renderCalc(); addedNote(set, id, wasIn);
}
// Phone: show one roster at a time, chosen with the You Send / You Get switch
function setSideSwitch(side){
  for (const b of $("sideSwitch").children) b.setAttribute("aria-selected", b.dataset.side === side);
  $("sides").dataset.show = side;
}
$("sideSwitch").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setSideSwitch(b.dataset.side); });
setSideSwitch("A");
$("listA").addEventListener("click", e => browseAll.A ? browseClick("A", e) : toggle(S.sendIds, e));
$("resetTrade").addEventListener("click", () => { S.sendIds.clear(); S.getIds.clear(); S.faab = { send: 0, get: 0 }; S.faabOn = { send: false, get: false }; renderCalc(); });
// FAAB in the roster lists: tap the row to add it, then type how much to include
for (const [listId, side] of [["listA", "send"], ["listB", "get"]])
  $(listId).addEventListener("input", e => {
    const inp = e.target.closest(".faab-amt"); if (!inp) return;
    const rid = Number($(side === "send" ? "teamA" : "teamB").value), max = faabLeft(rid);
    const n = Math.max(0, Math.min(max, Math.round(Number(String(inp.value).replace(/[^0-9]/g, "")) || 0)));
    S.faab[side] = n; renderCalc();
    const again = $(listId).querySelector(".faab-amt"); if (again){ again.focus(); const L = again.value.length; again.setSelectionRange(L, L); }   // keep typing
  });
$("board").addEventListener("click", e => {
  const x = e.target.closest(".bi-x");
  if (x && x.dataset.faab){ S.faab[x.dataset.faab] = 0; S.faabOn[x.dataset.faab] = false; renderCalc(); return; }
  if (x){ (x.dataset.side === "send" ? S.sendIds : S.getIds).delete(x.dataset.id); renderCalc(); return; }
  const l = e.target.closest(".bi-link");
  if (!l || !l.dataset.show) return;
  const a = S.assets.get(l.dataset.show);
  if (a && a.kind === "player") openPlayerCard(a.pid);    // players open their player card
  else showInValues(l.dataset.show);                      // picks still jump to Rankings
});
// Jump to a player's (or pick's) row in League Values and highlight it
function showInValues(id){
  const a = S.assets.get(id); if (!a) return;
  const valuesTab = $("tabs").querySelector('[data-tab="values"]');
  valuesTab.click();
  S.posFilter = a.kind === "pick" ? "PICK" : "ALL";
  for (const x of $("posFilter").children) x.setAttribute("aria-pressed", x.dataset.pos === S.posFilter);
  $("valueSearch").value = a.name;
  if (a.owner == null) $("rosteredOnly").checked = false;
  renderValues();
  const row = $("valuesBody").querySelector(`tr[data-id="${CSS.escape(id)}"]`);
  S.valuesHL = id;
  if (row){ row.classList.add("hl"); row.scrollIntoView({ behavior: "smooth", block: "center" }); }
}
$("listB").addEventListener("click", e => browseAll.B ? browseClick("B", e) : toggle(S.getIds, e));
$("teamA").addEventListener("change", renderCalc);
$("posA").addEventListener("change", renderCalc);
$("posB").addEventListener("change", renderCalc);
$("teamB").addEventListener("change", renderCalc);

const marketWord = () => "Front Office Rankings";
// Green light = league tuning active, yellow = not active yet, grey = still checking
function renderTuningLight(){
  const el = $("tuningLight"); if (!el || !S.league) return;
  const link = "";
  if (S.historyError){
    el.innerHTML = `<span class="light off" aria-hidden="true"></span><div class="tuning-text"><b>League Tuning Is Off</b><p>Couldn't check your league's trade history, so values use ${marketWord()} and your league settings only. Reopen the league to try again.</p>${link}</div>`;
    return;
  }
  if (!S.history){
    el.innerHTML = `<span class="light wait" aria-hidden="true"></span><div class="tuning-text"><b>Checking Your League's Trade History...</b><p>Values may adjust slightly in a moment.</p>${link}</div>`;
    return;
  }
  const twoTeam = S.history.trades.filter(t => t.sides.length >= 2).length;
  if (S.nudge){
    const adj = ["QB","RB","WR","TE","PICK"].map(k => ({ k, m: S.nudge[k] }))
      .map(x => `<span class="chip">${x.k === "PICK" ? "Picks" : x.k + "s"} ×${(Math.round(x.m*100)/100).toFixed(2)}</span>`).join("");
    el.innerHTML = `<span class="light on" aria-hidden="true"></span><div class="tuning-text"><b>League Tuning Is On</b><p>These values include your league's trade habits, learned from ${S.nudge.n} trades, along with ${marketWord()}.</p><div class="chips">${adj}</div>${link}</div>`;
  } else {
    const left = Math.max(0, NUDGE_MIN_TRADES - twoTeam);
    const pct = Math.min(100, Math.round(twoTeam / NUDGE_MIN_TRADES * 100));
    el.innerHTML = `<span class="light off" aria-hidden="true"></span><div class="tuning-text"><b>League Tuning Is Off for Now: ${left} More Trade${left === 1 ? "" : "s"} to Go</b><p>Your league has ${twoTeam} of the ${NUDGE_MIN_TRADES} trades needed. Until then, values use ${marketWord()} and your league settings only.</p><div class="tprog" role="progressbar" aria-valuemin="0" aria-valuemax="${NUDGE_MIN_TRADES}" aria-valuenow="${twoTeam}" aria-label="Trades toward league tuning"><span style="width:${pct}%"></span></div><small class="tprog-label">${twoTeam} / ${NUDGE_MIN_TRADES} trades</small>${link}</div>`;
  }
}

// "Values updated 3 hours ago", from the time stamp the Rankings Desk writes when rankings are published
function updatedAgo(iso){
  const t = Date.parse(iso || ""); if (isNaN(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 2) return "just now";
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24); return d === 1 ? "yesterday" : `${d} days ago`;
}
function renderUpdated(){
  const iso = S.market?.updated, ago = updatedAgo(iso);
  const stale = ago && Date.now() - Date.parse(iso) > 36 * 3600000;   // the update runs 3 times a day, so 36 hours means it's stuck
  const txt = !ago ? "" : stale ? `Values may be out of date: last updated ${ago}.` : `Values updated ${ago}.`;
  for (const id of ["valuesUpdated", "footUpdated"]){ const el = $(id); if (el){ el.textContent = txt; el.classList.toggle("stale", !!stale); el.title = iso ? new Date(iso).toLocaleString() : ""; } }
}
// Player Values shows 50 rows at a time ("Show 50 more"), sorted by any column heading
const VALUES_PAGE = 50;
let valuesLimit = VALUES_PAGE, valuesSort = { key: "value", dir: -1 };
const valueChange = a => a.kind === "pick" || !a.market ? 0 : a.value / a.market - 1;
const VALUE_SORTS = {
  rank: a => a.lgRank || 99999, posrank: a => a.kind === "player" && a.lgPosRank ? a.lgPosRank : 99999, name: a => normName(a.name), pos: a => a.pos + String(a.lgPosRank || 999).padStart(3, "0"),
  age: a => a.age || 0, value: a => a.value, market: a => a.market || 0, change: valueChange
};
const SORT_FIRST_DIR = { rank: 1, posrank: 1, name: 1, pos: 1 };   // A to Z and #1 first; numbers biggest first
// Rookies: first NFL season (Sleeper's years of experience is 0, or his rookie year is this season)
const isRookie = a => { if (a.kind !== "player") return false; const sp = S.sleeperPlayers?.[a.pid] || {};
  return sp.years_exp === 0 || Number(sp.metadata?.rookie_year) === Number(S.nflState?.season || S.season); };
// My Players: every player and pick on your team
const isMine = a => S.myRid != null && a.owner === S.myRid;
function renderValues(){
  renderTuningLight(); renderUpdated();
  $("valueClear").hidden = !$("valueSearch").value;
  const q = normName($("valueSearch").value), pos = S.posFilter, rosteredOnly = $("rosteredOnly").checked;
  const key = VALUE_SORTS[valuesSort.key] || VALUE_SORTS.value, dir = valuesSort.dir;
  const all = [...S.assets.values()]
    .filter(a => pos === "ALL" ? a.kind === "player" : pos === "PICK" ? a.kind === "pick" : pos === "ROOKIE" ? isRookie(a) : pos === "MINE" ? isMine(a) : a.pos === pos)
    .filter(a => !rosteredOnly || a.owner != null)
    .filter(a => !q || normName(a.name).includes(q))
    .sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || b.value - a.value; });
  if (S.valuesHL){ const k = all.findIndex(a => a.id === S.valuesHL); if (k >= valuesLimit) valuesLimit = Math.ceil((k + 1) / VALUES_PAGE) * VALUES_PAGE; }
  const rows = pos === "MINE" ? all : all.slice(0, valuesLimit);   // your whole team on one page
  for (const th of $("valuesTable").querySelectorAll("th[data-sort]")) th.setAttribute("aria-sort", th.dataset.sort === valuesSort.key ? (dir > 0 ? "ascending" : "descending") : "none");
  const mineTotal = pos === "MINE" ? all.reduce((t, a) => t + a.value, 0) : 0;
  $("valuesCount").textContent = !all.length ? "" : pos === "MINE"
    ? `${all.filter(a => a.kind === "player").length} players and ${all.filter(a => a.kind === "pick").length} picks · total value ${fmt(Math.round(mineTotal))}`
    : `Showing ${rows.length} of ${all.length}`;
  $("valuesMore").hidden = rows.length >= all.length;
  $("valuesMore").textContent = `Show ${Math.min(VALUES_PAGE, all.length - rows.length)} more`;
  $("valuesBody").innerHTML = rows.map((a,i) => {
    const team = a.owner != null ? S.teams.get(a.owner)?.name : "Free agent";
    const teamHTML = a.owner != null ? `<span class="teamcell">${teamPhoto(a.owner, true)}${esc(team)}</span>` : "Free agent";
    const ch = a.market ? (a.value/a.market - 1) * 100 : 0;
    const chTxt = a.kind === "pick" || Math.abs(ch) < 1 ? "" : `<span class="${ch>0?"up":"down"}">${ch>0?"+":""}${Math.round(ch)}%</span>`;
    return `<tr data-id="${esc(a.id)}"${a.kind === "player" ? ' tabindex="0"' : ""}${(() => { const c = [a.id === S.valuesHL ? "hl" : "", a.owner != null && a.owner === S.myRid ? "mine" : ""].filter(Boolean).join(" "); return c ? ` class="${c}"` : ""; })()}><td class="rk">${a.kind === "player" && a.lgRank ? a.lgRank : i+1}</td><td class="rk">${a.kind === "player" && a.lgPosRank ? esc(a.pos) + a.lgPosRank : ""}</td><td><span class="teamcell">${assetPhoto(a, true)}${esc(a.name)}${injTag(a.pid)}</span></td><td class="hide-sm">${esc(a.pos)}</td><td class="n">${esc(ageText(a.age))}</td>
      <td class="hide-sm">${teamHTML}</td><td class="n big">${fmt(a.value)}</td><td class="n hide-sm">${a.kind==="pick"?"":fmt(a.market)}</td><td class="n">${chTxt}</td></tr>`;
  }).join("") || `<tr><td colspan="9" class="empty">${pos === "MINE" && S.myRid == null ? "Choose your team in the league header to see your players." : "No players match. Try a different search or filter."}</td></tr>`;
}
$("valueSearch").addEventListener("input", () => { valuesLimit = VALUES_PAGE; renderValues(); });
$("valuesMore").addEventListener("click", () => { valuesLimit += VALUES_PAGE; renderValues(); });
$("valuesTable").querySelector("thead").addEventListener("click", e => {
  const th = e.target.closest("th[data-sort]"); if (!th || e.target.closest(".info-btn")) return;
  const k = th.dataset.sort;
  valuesSort = valuesSort.key === k ? { key: k, dir: -valuesSort.dir } : { key: k, dir: SORT_FIRST_DIR[k] || -1 };
  valuesLimit = VALUES_PAGE; renderValues();
});
// ✕ inside the search box: clear the search, show everyone, and keep the player you were looking at in view
$("valueClear").addEventListener("click", () => {
  const keep = S.valuesHL || $("valuesBody").querySelector("tr[data-id]")?.dataset.id;
  $("valueSearch").value = ""; S.posFilter = "ALL";
  for (const x of $("posFilter").children) x.setAttribute("aria-pressed", x.dataset.pos === "ALL");
  S.valuesHL = keep || null;
  renderValues();
  if (keep) $("valuesBody").querySelector(`tr[data-id="${CSS.escape(keep)}"]`)?.scrollIntoView({ block: "center" });
  setTimeout(() => { S.valuesHL = null; $("valuesBody").querySelector("tr.hl")?.classList.remove("hl"); }, 4000);
  $("valueSearch").focus();
});
$("rosteredOnly").addEventListener("change", () => { valuesLimit = VALUES_PAGE; renderValues(); });
$("posFilter").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  S.posFilter = b.dataset.pos;
  for (const x of $("posFilter").children) x.setAttribute("aria-pressed", x === b);
  valuesLimit = VALUES_PAGE; renderValues();
});


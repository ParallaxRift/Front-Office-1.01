// Front Office: Trade History tab, plus learning from your league's trades (curve, age, position tuning, accuracy)
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// LEAGUE TRADE HISTORY
// Reads every trade from this season and up to 3 earlier seasons,
// grades each one with today's values, learns the league's trading
// habits (a light value adjustment), and feeds Team Strategy.
// ============================================================
const HISTORY_SEASONS = 4;      // this season plus up to 3 earlier ones
const NUDGE_MIN_TRADES = 15;    // fewer trades than this = no value adjustment
// (The league's weight now grows with evidence: see shrinkWeight. Each position stays within ±7.5%.)

async function loadHistory(league){
  $("tradeList").innerHTML = `<p class="empty">Loading your league's trade history...</p>`;
  $("histStats").innerHTML = ""; $("histNote").textContent = "";
  try {
    // Walk back through linked seasons
    const seasons = [league];
    let lg = league;
    while (seasons.length < HISTORY_SEASONS && lg.previous_league_id && lg.previous_league_id !== "0"){
      lg = await getJSON(`/league/${lg.previous_league_id}`).catch(() => null);
      if (!lg) break;
      seasons.push(lg);
    }
    const perSeason = await Promise.all(seasons.map(async (L, idx) => {
      const isCurrent = idx === 0;
      const [rosters, users, drafts, weeks] = await Promise.all([
        isCurrent ? S.rosters : getJSON(`/league/${L.league_id}/rosters`).catch(() => []),
        isCurrent ? S.users : getJSON(`/league/${L.league_id}/users`).catch(() => []),
        getJSON(`/league/${L.league_id}/drafts`).catch(() => []),
        Promise.all(Array.from({length: 19}, (_, w) => getJSON(`/league/${L.league_id}/transactions/${w}`).catch(() => [])))
      ]);
      const draftPicks = await Promise.all((drafts || []).filter(d => d.status === "complete")
        .map(d => getJSON(`/draft/${d.draft_id}/picks`).then(ps => ({ d, ps })).catch(() => null)));
      return { L, rosters: rosters || [], users: users || [], draftPicks: draftPicks.filter(Boolean), tx: weeks.flat() };
    }));
    if (S.league?.league_id !== league.league_id) return; // switched leagues mid-load

    // What each traded pick turned into: "season-round-originalRoster" -> player id
    const pickResult = new Map();
    for (const sd of perSeason) for (const { d, ps } of sd.draftPicks){
      const slotMap = d.slot_to_roster_id || {};
      for (const pk of ps || []){
        const orig = slotMap[pk.draft_slot];
        if (orig != null && pk.player_id) pickResult.set(`${d.season}-${pk.round}-${orig}`, { pid: pk.player_id, slot: pk.draft_slot, no: pk.pick_no });
      }
    }

    const trades = [], seen = new Set();
    for (const sd of perSeason){
      const ownerOf = new Map(sd.rosters.map(r => [r.roster_id, r.owner_id]));
      for (const t of sd.tx){
        if (t?.type !== "trade" || t.status !== "complete" || seen.has(t.transaction_id)) continue;
        seen.add(t.transaction_id);
        const sides = (t.roster_ids || []).map(rid => {
          const owner = ownerOf.get(rid);
          const now = [...S.teams.values()].find(x => x.owner === owner);
          const u = sd.users.find(x => x.user_id === owner);
          return { rid, owner, curRid: now?.rid ?? null,
            name: now?.name || u?.metadata?.team_name || u?.display_name || `Team ${rid}`,
            photo: now ? now.photo : (u?.metadata?.avatar || u?.avatar || null), gets: [], faab: 0 };
        });
        const side = rid => sides.find(x => x.rid === rid);
        // "from" = the team that gave the item up (Sleeper lists it under drops / previous_owner_id)
        const other = rid => sides.length === 2 ? sides.find(x => x.rid !== rid)?.rid : null;
        for (const [pid, rid] of Object.entries(t.adds || {}))
          side(rid)?.gets.push({ kind: "player", pid, from: (t.drops || {})[pid] ?? other(rid) });
        for (const pk of t.draft_picks || [])
          side(pk.owner_id)?.gets.push({ kind: "pick", season: Number(pk.season), round: pk.round, orig: pk.roster_id, from: pk.previous_owner_id ?? other(pk.owner_id) });
        for (const w of t.waiver_budget || []) { const x = side(w.receiver); if (x) x.faab += w.amount || 0; }
        if (sides.length >= 2) trades.push({ id: t.transaction_id, created: t.created, season: Number(sd.L.season), sides });
      }
    }
    trades.sort((a, b) => b.created - a.created);
    S.history = { trades, pickResult, seasons: seasons.map(x => Number(x.season)) };
    S.historyError = false;

    // Learn the league's habits: first the shape of the value curve, then the per-position tuning
    S.nudge = null;
    const fit = fitCurve(trades), curveChanged = fit.B !== (S.curveB || 1) || fit.T !== (S.curveT || 1);
    S.curveB = fit.B; S.curveT = fit.T;
    if (curveChanged) buildValues();
    const age = fitAge(trades), ageChanged = age.s !== (S.ageStrength ?? 1);
    S.ageStrength = age.s; S.ageFit = age.n ? age : null;
    if (ageChanged) buildValues();
    const dfit = fitDepth(trades), depthChanged = JSON.stringify(dfit.depth) !== JSON.stringify(S.depth);
    S.depth = dfit.depth; S.depthFit = dfit;
    if (depthChanged) buildValues();
    const nudge = learnNudge(trades);
    if (nudge){ S.nudge = nudge; buildValues(); }
    S.accuracy = tradeAccuracy(trades);
    if (nudge || curveChanged || ageChanged || depthChanged) rerenderKeepingPlace();
    else { renderHistory(); renderStrategy(); renderTuningLight(); }
    if (typeof renderSettings === "function" && S.cfg) renderSettings();
    updatePickOdds();
  } catch(err){
    console.error(err);
    $("tradeList").innerHTML = `<p class="empty">Couldn't load trade history. Reopen the league to try again.</p>`;
    S.historyError = true; renderTuningLight();
  }
}

// Pick names follow one pattern everywhere: "2027 1.08", "2028 Late 1st", "2029 1st"
const pickOrd = n => n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n + "th";
// Today's value for one traded item
function valueItem(it){
  if (it.kind === "player"){
    const a = S.assets.get("p:" + it.pid), p = S.sleeperPlayers?.[it.pid] || {};
    const name = a?.name || p.full_name || `${p.first_name||""} ${p.last_name||""}`.trim() || "Unknown player";
    return { photoPid: it.pid, name, pos: a?.pos || p.position || "", value: a?.value || 0, sub: a ? `${a.pos}, ${a.nfl}` : (p.position || "No longer rostered") , cat: a?.pos || p.position };
  }
  const label = `${it.season} ${pickOrd(it.round)}`;   // e.g. "2025 2nd"
  const live = S.assets.get(`k:${it.season}-${it.round}-${it.orig}`);
  if (live) return { name: live.name, pos: "PICK", value: live.value, sub: "Pick still to be made", cat: "PICK" };
  const used = S.history?.pickResult.get(`${it.season}-${it.round}-${it.orig}`);
  if (used){
    const pid = used.pid || used;   // older format stored just the id
    const a = S.assets.get("p:" + pid), p = S.sleeperPlayers?.[pid] || {};
    const pname = a?.name || p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || "a player";
    const slotTxt = used.slot ? `${it.season} ${it.round}.${String(used.slot).padStart(2, "0")}` : label;
    const detail = [a?.pos || p.position, a?.nfl || p.team].filter(Boolean).join(", ");
    return { name: slotTxt, pos: "PICK", value: a?.value || 0, sub: `Used on ${pname}${detail ? " (" + detail + ")" : ""}`, cat: "PICK", photoPid: pid, usedOn: pname };
  }
  const teams = S.cfg?.teams || 12;
  const est = pickValue(((it.round-1)*teams + (teams+1)/2 - 1) * 12/teams + 1, 0) / (S.pickTiming || 1);
  return { name: label, pos: "PICK", value: est, sub: "Estimated (pick result unknown)", cat: "PICK" };
}
function gradeTrade(tr){
  const sides = tr.sides.map(sd => {
    const items = sd.gets.map(it => ({ ...valueItem(it), from: it.from })).sort((a,b) => b.value - a.value);
    return { ...sd, items, raw: items.reduce((s,i) => s + i.value, 0) };
  });
  for (const x of sides){
    // What this team gave up = everything other teams received from it
    x.sentItems = sides.filter(y => y !== x).flatMap(y => y.items.filter(i => i.from === x.rid));
    const got = x.items.map(i => i.value), gave = x.sentItems.map(i => i.value);
    x.total = tradeValue(got, gave);
    x.sentTotal = tradeValue(gave, got);
    x.margin = x.total - x.sentTotal;
    x.result = tradeCall(x.margin, Math.max(x.total, x.sentTotal, 1)) === "fair" ? "even" : x.margin > 0 ? "won" : "lost";
  }
  return { ...tr, sides };
}

// ---------- Fit the value curve to this league's trades ----------
// Tries curve shapes from B = 0.8 (bigger premium for elite players) to B = 1.2 (more value kept in
// depth) and keeps the one that makes this league's accepted trades balance best, blended toward the
// standard curve the same way as the trade-habit tuning (at most halfway with 30+ trades).
const tradeWeight = t => Math.pow(0.5, Math.max(0, Date.now() - (t.created || Date.now())) / (365 * 864e5));   // a year-old trade counts half
// Lopsided trades say less about the league's taste (they may be mistakes or collusion), so they're down-weighted:
// a trade 35% out of balance by current values counts half, 70% out counts a fifth.
function outlierWeight(t){
  const g = gradeTrade(t);
  const imb = Math.max(0, ...g.sides.map(x => Math.abs(x.margin) / Math.max(1, x.total, x.sentTotal)));
  return 1 / (1 + Math.pow(imb / 0.35, 2));
}
// Bayesian-style shrinkage: how much the league's own evidence counts, from the effective number of
// trades (recent, balanced trades count fully). 15 trades -> 20%, 30 -> 33%, 75 -> 56%, 150 -> 71%.
const SHRINK_K = 60;
const shrinkWeight = nEff => nEff / (nEff + SHRINK_K);
function fitCurve(trades){
  const recent = trades.filter(t => t.sides.length >= 2);
  if (recent.length < NUDGE_MIN_TRADES) return { B: 1, T: 1 };
  const players = [...S.assets.values()].filter(a => a.kind === "player" && a.mRank != null);
  const itemPid = it => it.kind === "player" ? it.pid : (S.history?.pickResult.get(`${it.season}-${it.round}-${it.orig}`)?.pid || null);
  const tw = new Map(recent.map(t => [t, tradeWeight(t) * outlierWeight(t)]));
  const nEff = [...tw.values()].reduce((x, y) => x + y, 0);
  const errFor = (B, T) => {
    const raw = a => marketCurve(a.mRank, B, T) * (a.adj || 1);
    const v = players.map(raw).sort((x, y) => y - x), scale = 10000 / Math.max(1, (v.slice(0, 5).reduce((t, x) => t + x, 0) / Math.max(1, Math.min(5, v.length))) * 1.025);
    let err = 0;
    for (const t of recent){
      const w = tw.get(t);
      const val = it => { const pid = itemPid(it), a = pid ? S.assets.get("p:" + pid) : null; return a && a.mRank != null ? raw(a) * scale : valueItem(it).value; };
      for (const sd of t.sides){
        const got = sd.gets.reduce((s2, it) => s2 + val(it), 0);
        const gave = t.sides.filter(o => o !== sd).flatMap(o => o.gets.filter(it => it.from === sd.rid)).reduce((s2, it) => s2 + val(it), 0);
        if (got + gave > 0) err += w * Math.pow((got - gave) / (got + gave), 2);
      }
    }
    return err;
  };
  // 1) one curve shape for everyone
  let best = 1, bestErr = errFor(1, 1);
  for (let B = 0.8; B <= 1.2001; B += 0.05){ const e = errFor(B, 1); if (e < bestErr - 1e-9){ best = B; bestErr = e; } }
  // 2) only if the data clearly asks for it (30+ trades and at least 10% better): a separate slope past rank 60
  let tail = 1;
  if (recent.length >= 30){
    let tErr = bestErr;
    for (const T of [0.8, 0.85, 0.9, 0.95, 1.05, 1.1, 1.15, 1.2]){ const e = errFor(best, T); if (e < tErr){ tErr = e; tail = T; } }
    if (tErr > bestErr * 0.9) tail = 1;
  }
  const w = Math.min(0.7, shrinkWeight(nEff));
  const r3 = x => Math.round(x * 1000) / 1000;
  return { B: r3(1 + w * (best - 1)), T: r3(1 + w * (tail - 1)) };
}
// ---------- Test the age discount against this league's trades ----------
// Expert rankings already mark older players down. If this league's managers dump veterans faster
// than the experts do, a stronger age discount makes its trades balance better; if they pay expert
// value for vets, a weaker one does. Front Office tries strengths from none (x0) to double the
// default (x2) and leans toward the best one by the amount of evidence (same scale as the curve fit).
function fitAge(trades){
  const recent = trades.filter(t => t.sides.length >= 2);
  if (recent.length < NUDGE_MIN_TRADES) return { s: 1, n: 0 };
  const itemPid = it => it.kind === "player" ? it.pid : (S.history?.pickResult.get(`${it.season}-${it.round}-${it.orig}`)?.pid || null);
  const tw = new Map(recent.map(t => [t, tradeWeight(t) * outlierWeight(t)]));
  const nEff = [...tw.values()].reduce((x, y) => x + y, 0);
  const cur = S.ageStrength ?? 1;
  const errFor = st => {
    let err = 0;
    for (const t of recent){
      const w = tw.get(t);
      // a player's value with this age strength instead of the current one (picks unchanged)
      const val = it => { const v = valueItem(it).value, pid = it.kind === "player" ? itemPid(it) : null, a = pid ? S.assets.get("p:" + pid) : null;
        return a && a.age ? v * ageMul(a, st) / Math.max(0.01, ageMul(a, cur)) : v; };
      for (const sd of t.sides){
        const got = sd.gets.reduce((s2, it) => s2 + val(it), 0);
        const gave = t.sides.filter(o => o !== sd).flatMap(o => o.gets.filter(it => it.from === sd.rid)).reduce((s2, it) => s2 + val(it), 0);
        if (got + gave > 0) err += w * Math.pow((got - gave) / (got + gave), 2);
      }
    }
    return err;
  };
  let best = 1, bestErr = errFor(1);
  for (let st = AGE_FIT_MIN; st <= AGE_FIT_MAX + 1e-9; st += 0.25){ const e = errFor(st); if (e < bestErr - 1e-9){ best = st; bestErr = e; } }
  const w = Math.min(0.7, shrinkWeight(nEff));
  return { s: Math.round((1 + w * (best - 1)) * 1000) / 1000, best, weight: w, n: recent.length, nEff: Math.round(nEff * 10) / 10 };
}
// ---------- Fit the value adjustment to this league's trades ----------
// The value adjustment's three settings (how much an extra piece keeps at minimum, how fast that
// rises as it gets closer to the top piece, and the extra discount against elite pieces) start as
// hand-set defaults. Trades where at least one side sends 2+ pieces show how this league really
// prices depth against stars, so Front Office tests a grid of settings and leans toward the one that
// makes those trades balance best, by the same evidence weight as the curve fit (at most 60%).
const DEPTH_GRID = { floor: [0.3, 0.4, 0.5, 0.6], curve: [0.4, 0.6, 0.8, 1.0], star: [0, 0.12, 0.24] };
function fitDepth(trades){
  const multi = trades.filter(t => t.sides.length >= 2 && t.sides.some(sd => sd.gets.length >= 2));
  const base = { floor: DEPTH_FLOOR, curve: DEPTH_CURVE, star: STAR_EXTRA };
  if (multi.length < NUDGE_MIN_TRADES) return { depth: null, n: multi.length };
  const tw = new Map(multi.map(t => [t, tradeWeight(t) * outlierWeight(t)]));
  const nEff = [...tw.values()].reduce((x, y) => x + y, 0);
  // each side's received and sent values, worked out once (values don't change between candidates)
  const rows = multi.flatMap(t => { const g = gradeTrade(t); return g.sides.map(x => ({ w: tw.get(t), got: x.items.map(i => i.value), gave: x.sentItems.map(i => i.value) })).filter(r => r.got.length && r.gave.length); });
  const was = S.depth;
  const errFor = d => { S.depth = d; let e = 0; for (const r of rows){ const a = tradeValue(r.got, r.gave), b = tradeValue(r.gave, r.got); if (a + b > 0) e += r.w * ((a - b) / (a + b)) ** 2; } return e; };
  let best = base, bestErr = errFor(base);
  for (const floor of DEPTH_GRID.floor) for (const curve of DEPTH_GRID.curve) for (const star of DEPTH_GRID.star){
    const d = { floor, curve, star }, e = errFor(d); if (e < bestErr - 1e-9){ best = d; bestErr = e; }
  }
  S.depth = was;
  const w = Math.min(0.6, shrinkWeight(nEff)), mix = k => Math.round((base[k] + w * (best[k] - base[k])) * 1000) / 1000;
  const depth = { floor: mix("floor"), curve: mix("curve"), star: mix("star") };
  const same = Object.keys(base).every(k => Math.abs(depth[k] - base[k]) < 0.005);
  return { depth: same ? null : depth, best, weight: w, n: multi.length, nEff: Math.round(nEff * 10) / 10 };
}
// ---------- Accuracy check ----------
// How far apart the two sides of your league's real trades come out, on average, using Front Office's
// values vs plain market values. Managers agreed to these trades, so smaller is more accurate.
function tradeAccuracy(trades){
  const recent = trades.filter(t => t.sides.length >= 2);
  if (recent.length < 5) return null;
  const gap = useMarket => {
    let tot = 0, wsum = 0;
    for (const t of recent){
      const w = tradeWeight(t);
      const val = it => { const v = valueItem(it); if (!useMarket) return v.value; const a = it.kind === "player" ? S.assets.get("p:" + it.pid) : null; return a ? a.market : v.value; };
      for (const sd of t.sides){
        const got = sd.gets.map(val), gave = t.sides.filter(o => o !== sd).flatMap(o => o.gets.filter(it => it.from === sd.rid)).map(val);
        if (!got.length || !gave.length) continue;
        const a = tradeValue(got, gave), b = tradeValue(gave, got);
        if (a + b > 0){ tot += w * Math.abs(a - b) / Math.max(a, b); wsum += w; }
      }
    }
    return wsum ? tot / wsum : null;
  };
  const fo = gap(false), mk = gap(true);
  return fo == null || mk == null ? null : { n: recent.length, fo, mk };
}
// Least-squares fit: what multiplier per position makes this league's trades balance?
function learnNudge(trades){
  const recent = trades.filter(t => t.sides.length >= 2);
  if (recent.length < NUDGE_MIN_TRADES) return null;
  const K = ["QB","RB","WR","TE","PICK"], rows = [];
  let nEff = 0;
  for (const t of recent){
    const g = gradeTrade(t), tw = tradeWeight(t) * outlierWeight(t), w = Math.sqrt(tw);   // recent, balanced trades count most
    nEff += tw;
    // One balance equation per team; the last team's is implied by the others, so it's skipped
    g.sides.slice(0, -1).forEach(x => {
      const row = K.map(() => 0);
      x.items.forEach(i => { const k = K.indexOf(i.cat); if (k >= 0) row[k] += w * i.value/10000; });
      x.sentItems.forEach(i => { const k = K.indexOf(i.cat); if (k >= 0) row[k] -= w * i.value/10000; });
      rows.push(row);
    });
  }
  // Find small per-position adjustments d (multiplier = 1 + d) that make the league's trades
  // balance best. Two guards keep it honest:
  //  - the adjustments must average out to zero, so the fit can only move positions RELATIVE
  //    to each other (shrinking every value equally would "balance" trades trivially), and
  //  - a ridge penalty pulls every adjustment toward zero unless the trades clearly disagree.
  // This is a 6x6 linear system: [G+λI  1; 1ᵀ 0][d; μ] = [-G·1; 0], where G = DᵀD.
  const n = K.length, lam = 2;
  const G = K.map((_, a) => K.map((_, c) => rows.reduce((t, r) => t + r[a]*r[c], 0)));
  const M = [], rhs = [];
  for (let a = 0; a < n; a++){
    M.push([...G[a].map((v, c) => v + (a === c ? lam : 0)), 1]);
    rhs.push(-G[a].reduce((t, v) => t + v, 0));
  }
  M.push([...K.map(() => 1), 0]); rhs.push(0);
  const N = n + 1;
  for (let c = 0; c < N; c++){
    let piv = c; for (let r = c+1; r < N; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]]; [rhs[c], rhs[piv]] = [rhs[piv], rhs[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < N; r++) if (r !== c){ const f = M[r][c]/M[c][c]; for (let k = c; k < N; k++) M[r][k] -= f*M[c][k]; rhs[r] -= f*rhs[c]; }
  }
  const delta = K.map((_, a) => Math.abs(M[a][a]) < 1e-12 ? 0 : rhs[a]/M[a][a]);
  // Shrink toward market by the amount of evidence, then a hard cap of ±7.5% per position
  const w = shrinkWeight(nEff);
  const out = { n: recent.length, nEff: Math.round(nEff * 10) / 10, weight: w };
  K.forEach((k, i) => { const m = Math.min(1.2, Math.max(0.8, 1 + delta[i])); out[k] = Math.min(1.075, Math.max(0.925, 1 + w * (m - 1))); });
  return out;
}

const fmtDate = ms => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
let histSort = { key: "net", dir: -1 };   // records table sort
function renderHistory(){
  const H = S.history;
  if (!H){ return; }
  const ownerTeam = o => [...S.teams.values()].find(t => t.owner === o);
  // ---- Filter controls ----
  const teamSel = $("histTeam"), seasonSel = $("histSeason"), resSel = $("histResult"), sizeSel = $("histSize"), sortSel = $("histSort");
  const prevTeam = teamSel.value, prevSeason = seasonSel.value;
  teamSel.innerHTML = `<option value="all">All teams</option>` + [...S.teams.values()].map(t => `<option value="${esc(t.owner)}">${esc(t.name)}</option>`).join("");
  seasonSel.innerHTML = `<option value="all">All seasons</option>` + H.seasons.map(y => `<option value="${y}">${y}</option>`).join("");
  teamSel.value = [...teamSel.options].some(o => o.value === prevTeam) ? prevTeam : "all";
  seasonSel.value = [...seasonSel.options].some(o => o.value === prevSeason) ? prevSeason : "all";
  const team = teamSel.value;
  resSel.disabled = team === "all";
  if (team === "all") resSel.value = "all";
  const winOpt = sortSel.querySelector('[value="win"]'), lossOpt = sortSel.querySelector('[value="loss"]');
  winOpt.textContent = team === "all" ? "Biggest win" : "Their biggest wins";
  lossOpt.textContent = team === "all" ? "Biggest loss" : "Their biggest losses";

  const graded = H.trades.map(gradeTrade);

  // ---- Summary cards (whole league) ----
  const count = {}, net = {};
  for (const t of graded) for (const x of t.sides){ count[x.owner] = (count[x.owner]||0) + 1; net[x.owner] = (net[x.owner]||0) + x.margin; }
  const top = (obj) => Object.entries(obj).filter(([o]) => ownerTeam(o)).sort((a,b) => b[1]-a[1])[0];
  const busiest = top(count), sharp = top(net);
  const biggest = graded.flatMap(t => t.sides.filter(x => x.result === "won").map(x => ({ t, x }))).sort((a,b) => b.x.margin - a.x.margin)[0];
  const teamLine = o => { const t = ownerTeam(o); return t ? `<span class="teamcell">${teamPhoto(t.rid, true)}${esc(t.name)}</span>` : ""; };
  $("histStats").innerHTML = `
    <div class="hs"><small>Trades found</small><b>${graded.length}</b><small>${H.seasons.length > 1 ? `${H.seasons[H.seasons.length-1]}–${H.seasons[0]}` : H.seasons[0]}</small></div>
    ${busiest ? `<div class="hs"><small>Most active trader</small><b>${busiest[1]} trades</b>${teamLine(busiest[0])}</div>` : ""}
    ${sharp && sharp[1] > 0 ? `<div class="hs"><small>Best trader (today's values)</small><b>+${fmt(sharp[1])}</b>${teamLine(sharp[0])}</div>` : ""}
    ${biggest ? `<div class="hs"><small>Biggest win</small><b>+${fmt(biggest.x.margin)}</b><span class="teamcell">${avatar(biggest.x.photo, biggest.x.name, true)}${esc(biggest.x.name)}</span></div>` : ""}`;
  $("histNote").textContent = S.nudge
    ? `Trades are graded using today’s player values. All ${S.nudge.n} league trades, including 3- and 4-team deals, also help fine-tune player valuations based on your league’s actual trade activity. These adjustments are intentionally small and can be reviewed in League Settings.`
    : `Trades are graded with today's values, so they show how each deal has aged.${graded.length < NUDGE_MIN_TRADES ? ` Once your league has ${NUDGE_MIN_TRADES} trades, they'll also tune player values.` : ""}`;

  // ---- Team trade records table (respects the season and size filters) ----
  const inScope = t => (seasonSel.value === "all" || String(t.season) === seasonSel.value)
                    && (sizeSel.value === "all" || (sizeSel.value === "2" ? t.sides.length === 2 : t.sides.length > 2));
  const rec = new Map([...S.teams.values()].map(t => [t.owner, { owner: t.owner, rid: t.rid, name: t.name, trades: 0, won: 0, lost: 0, even: 0, net: 0, picksOut: 0, picksIn: 0, partners: {} }]));
  for (const t of graded.filter(inScope)) for (const x of t.sides){
    const r = rec.get(x.owner); if (!r) continue;
    r.trades++; r[x.result]++; r.net += x.margin;
    r.picksIn += x.items.filter(i => i.cat === "PICK").length;
    r.picksOut += x.sentItems.filter(i => i.cat === "PICK").length;
    for (const y of t.sides) if (y.owner !== x.owner) r.partners[y.owner] = (r.partners[y.owner]||0) + 1;
  }
  for (const r of rec.values()){
    const fav = Object.entries(r.partners).sort((a,b) => b[1]-a[1])[0];
    r.partner = fav ? (ownerTeam(fav[0])?.name || "Former manager") : "";
    r.partnerN = fav ? fav[1] : 0;
    r.winPct = r.trades ? r.won / r.trades : -1;
  }
  const cols = [
    { key: "name", label: "Team", num: false },
    { key: "trades", label: "Trades", num: true },
    { key: "won", label: "Won", num: true },
    { key: "lost", label: "Lost", num: true },
    { key: "even", label: "Even", num: true },
    { key: "winPct", label: "Win %", num: true },
    { key: "net", label: "Net value", num: true },
    { key: "picksIn", label: "Picks in", num: true },
    { key: "picksOut", label: "Picks out", num: true },
    { key: "partner", label: "Top partner", num: false },
  ];
  const rows = [...rec.values()].sort((a, b) => {
    const k = histSort.key, va = a[k], vb = b[k];
    const c = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return c * histSort.dir || a.name.localeCompare(b.name);
  });
  $("histTable").innerHTML = `<thead><tr>${cols.map(c => `<th class="${c.num ? "n" : ""}" aria-sort="${histSort.key === c.key ? (histSort.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-key="${c.key}">${c.label}</button></th>`).join("")}</tr></thead>
    <tbody>${rows.map(r => `<tr data-owner="${esc(r.owner)}" class="${r.owner === team ? "sel" : ""}" tabindex="0">
      <td><span class="teamcell">${teamPhoto(r.rid, true)}${esc(r.name)}</span></td>
      <td class="n">${r.trades}</td><td class="n">${r.won}</td><td class="n">${r.lost}</td><td class="n">${r.even}</td>
      <td class="n">${r.trades ? Math.round(r.winPct*100) + "%" : "–"}</td>
      <td class="n ${r.net > 0 ? "up" : r.net < 0 ? "down" : ""}">${r.trades ? (r.net > 0 ? "+" : "") + fmt(r.net) : "–"}</td>
      <td class="n">${r.picksIn}</td><td class="n">${r.picksOut}</td>
      <td>${r.partner ? `${esc(r.partner)} (${r.partnerN})` : "–"}</td></tr>`).join("")}</tbody>`;

  // ---- Filter + sort the trade list ----
  const sideOf = t => t.sides.find(x => x.owner === team);
  let shown = graded.filter(t => inScope(t)
    && (team === "all" || sideOf(t))
    && (resSel.value === "all" || sideOf(t)?.result === resSel.value));
  const maxMargin = t => Math.max(...t.sides.map(x => x.margin));
  const moved = t => t.sides.reduce((s, x) => s + x.total, 0);
  const sorters = {
    new: (a, b) => b.created - a.created,
    old: (a, b) => a.created - b.created,
    win: (a, b) => team === "all" ? maxMargin(b) - maxMargin(a) : sideOf(b).margin - sideOf(a).margin,
    loss: (a, b) => team === "all" ? maxMargin(b) - maxMargin(a) : sideOf(a).margin - sideOf(b).margin,
    value: (a, b) => moved(b) - moved(a),
  };
  shown.sort(sorters[sortSel.value] || sorters.new);
  $("histCount").textContent = `Showing ${shown.length} of ${graded.length} trade${graded.length === 1 ? "" : "s"}${team !== "all" ? ` for ${ownerTeam(team)?.name || "this team"}` : ""}.`;

  if (!shown.length){
    $("tradeList").innerHTML = `<p class="empty">${graded.length ? "No trades match these filters. Try Clear filters." : "No trades found in this league yet."}</p>`;
    return;
  }
  const tagFor = x => x.result === "won" ? `<span class="verdict-tag v-won">Won by ${fmt(x.margin)}</span>`
                    : x.result === "lost" ? `<span class="verdict-tag v-lost">Lost by ${fmt(-x.margin)}</span>`
                    : `<span class="verdict-tag v-even">Even</span>`;
  $("tradeList").innerHTML = shown.slice(0, 150).map(t => {
    // When filtering by a team, show that team's side first and highlight it
    const sides = team === "all" ? t.sides : [...t.sides].sort((a, b) => (b.owner === team) - (a.owner === team));
    return `
    <article class="trade">
      <div class="trade-head"><span>${fmtDate(t.created)}</span><span>${t.season} season${t.sides.length > 2 ? `, ${t.sides.length}-team trade` : ""}</span></div>
      <div class="trade-sides">${sides.map(x => `
        <div class="tside${team !== "all" && x.owner === team ? " focus" : ""}">
          <div class="tside-head">${avatar(x.photo, x.name, "md")}<span class="nm"><b>${esc(x.name)}</b><small>Received</small></span>${tagFor(x)}</div>
          ${x.items.map(i => `<div class="titem">${i.photoPid ? avatar(PLAYER_IMG(i.photoPid), i.usedOn || i.name, "sm").replace('class="av', 'class="av pl') : ""}<span class="tn">${esc(i.name)}${i.usedOn ? "" : injTag(i.photoPid)}<small class="${i.usedOn ? "used" : ""}">${esc(i.sub)}</small></span><span class="tv">${fmt(i.value)}</span></div>`).join("") || `<div class="titem"><span class="tn">Nothing but FAAB</span></div>`}
          ${x.faab ? `<div class="titem"><span class="tn">$${x.faab} FAAB<small>Not valued</small></span><span class="tv">–</span></div>` : ""}
          <div class="ttotal"><span>Received, value today</span><span>${fmt(x.total)}</span></div>
          <div class="ttotal gave"><span>Gave up, value today</span><span>${fmt(x.sentTotal)}</span></div>
        </div>`).join("")}
      </div>
    </article>`;
  }).join("") + (shown.length > 150 ? `<p class="note">Showing the first 150. Narrow the filters to see more.</p>` : "");
}
["histTeam","histSeason","histResult","histSize","histSort"].forEach(id => $(id).addEventListener("change", renderHistory));
$("histClear").addEventListener("click", () => {
  $("histTeam").value = "all"; $("histSeason").value = "all"; $("histResult").value = "all"; $("histSize").value = "all"; $("histSort").value = "new";
  renderHistory();
});
$("histTable").addEventListener("click", e => {
  const h = e.target.closest("th button");
  if (h){
    const k = h.dataset.key;
    histSort = histSort.key === k ? { key: k, dir: -histSort.dir } : { key: k, dir: k === "name" || k === "partner" ? 1 : -1 };
    renderHistory(); return;
  }
  const row = e.target.closest("tbody tr");
  if (row){ $("histTeam").value = $("histTeam").value === row.dataset.owner ? "all" : row.dataset.owner; renderHistory(); }
});
$("histTable").addEventListener("keydown", e => {
  const row = e.target.closest("tbody tr");
  if (row && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); row.click(); }
});

// Insights for Team Strategy
// ---------- Each manager's trading habits ----------
// From every trade Front Office can see: how often each manager trades, which positions they
// buy and sell (by value, today's values), and how they use picks. Used by the Trade Finder's
// "would they say yes?" score and by Best Trade Partners.
let habitsCache = null;
function managerHabits(){
  const H = S.history; if (!H || !S.teams) return new Map();
  if (habitsCache && habitsCache.h === H && habitsCache.a === S.assets) return habitsCache.m;
  const byOwner = {}, yearAgo = Date.now() - 365 * 864e5;
  const get = o => byOwner[o] ||= { trades: 0, recent: 0, won: 0, lost: 0, inV: {}, outV: {} };
  for (const t of H.trades.map(gradeTrade)) for (const x of t.sides){
    const h = get(x.owner); h.trades++; if ((t.created || 0) >= yearAgo) h.recent++;
    if (x.result === "won") h.won++; else if (x.result === "lost") h.lost++;
    for (const i of x.items) h.inV[i.cat] = (h.inV[i.cat] || 0) + i.value;
    for (const i of x.sentItems) h.outV[i.cat] = (h.outV[i.cat] || 0) + i.value;
  }
  const m = new Map();
  for (const team of S.teams.values()){
    const h = byOwner[team.owner] || { trades: 0, recent: 0, won: 0, lost: 0, inV: {}, outV: {} };
    const cats = ["QB", "RB", "WR", "TE", "PICK"], total = cats.reduce((s, c) => s + (h.inV[c] || 0) + (h.outV[c] || 0), 0) || 1;
    // a position they clearly buy (or sell): net value in (or out) is at least 15% of everything they've traded
    const net = c => ((h.inV[c] || 0) - (h.outV[c] || 0)) / total;
    const buys = h.trades >= 2 ? cats.filter(c => net(c) >= 0.15) : [], sells = h.trades >= 2 ? cats.filter(c => net(c) <= -0.15) : [];
    m.set(team.rid, { ...h, buys, sells, active: h.recent >= 3, never: h.trades === 0 });
  }
  habitsCache = { h: H, a: S.assets, m };
  return m;
}
const catWord = c => c === "PICK" ? "picks" : c + "s";
// "6 trades in the last year; buys RBs, sells picks"
function habitText(h){
  if (!h || h.never) return "hasn't made a trade Front Office can see";
  const parts = [`${h.trades} trade${h.trades > 1 ? "s" : ""}${h.recent && h.recent !== h.trades ? ` (${h.recent} in the last year)` : ""}`];
  if (h.buys.length) parts.push("buys " + andList(h.buys.map(catWord)));
  if (h.sells.length) parts.push("sells " + andList(h.sells.map(catWord)));
  return parts.join("; ");
}
// How much more (or less) likely a manager is to say yes, from their habits and what they'd receive
function habitBoost(rid, receiving){
  const h = managerHabits().get(rid); if (!h) return 0;
  let b = h.active ? 0.4 : h.never ? -0.4 : 0;
  const cats = receiving.map(a => a.kind === "pick" ? "PICK" : a.pos);
  b += 0.3 * cats.filter(c => h.buys.includes(c)).length;
  return b;
}
function historyInsightsHTML(rid){
  const H = S.history; if (!H) return "";
  const me = S.teams.get(rid); if (!me) return "";
  const graded = H.trades.map(gradeTrade);
  const mine = graded.filter(t => t.sides.some(x => x.owner === me.owner));
  const lines = [];
  if (mine.length){
    const twoTeam = mine.map(t => t.sides.find(x => x.owner === me.owner));
    const won = twoTeam.filter(x => x.result === "won").length, lost = twoTeam.filter(x => x.result === "lost").length;
    const netV = twoTeam.reduce((s, x) => s + x.margin, 0);
    lines.push(`You've made ${mine.length} trade${mine.length>1?"s":""}: ${won} won, ${lost} lost by today's values (net ${netV >= 0 ? "+" : ""}${fmt(netV)}).`);
    const partners = {};
    for (const t of mine) for (const x of t.sides) if (x.owner !== me.owner) partners[x.owner] = (partners[x.owner]||0) + 1;
    const fav = Object.entries(partners).sort((a,b) => b[1]-a[1])[0];
    const favTeam = fav && [...S.teams.values()].find(t => t.owner === fav[0]);
    if (fav && fav[1] >= 2 && favTeam) lines.push(`You and ${favTeam.name} have traded ${fav[1]} times. A proven partner is a good first call.`);
  } else lines.push("You haven't made a trade yet in the seasons Front Office can see.");
  // Other managers' habits
  const picksOut = {}, losses = {}, trades = {};
  for (const t of graded){
    for (const x of t.sides){
      trades[x.owner] = (trades[x.owner]||0) + 1;
      if (x.result === "lost") losses[x.owner] = (losses[x.owner]||0) + 1;
      for (const y of t.sides) if (y !== x) for (const it of y.gets) if (it.kind === "pick" && it.orig === x.rid) picksOut[x.owner] = (picksOut[x.owner]||0) + 1;
    }
  }
  const nameOf = o => [...S.teams.values()].find(t => t.owner === o && t.owner !== me.owner)?.name;
  const seller = Object.entries(picksOut).filter(([o, n]) => nameOf(o) && n >= 3).sort((a,b) => b[1]-a[1])[0];
  if (seller) lines.push(`${nameOf(seller[0])} has traded away ${seller[1]} of their own draft picks. They may part with picks for the right player.`);
  const giver = Object.entries(losses).filter(([o, n]) => nameOf(o) && n >= 2 && n / trades[o] >= 0.6).sort((a,b) => b[1]-a[1])[0];
  if (giver) lines.push(`${nameOf(giver[0])} has come out behind in ${giver[1]} of ${trades[giver[0]]} trades by today's values. Worth checking in with.`);
  return `<div class="box"><h3>From Your League's Trade History</h3><ul class="moves">${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul></div>`;
}

// League settings opens from the football button beside the league name (not a tab)
function openSettingsPanel(){
  for (const t of $("tabs").children) t.setAttribute("aria-selected", "false");
  for (const name of ["calc","finder","standings","trophy","history","feedback","scores","values","settings","strategy"]) $("panel-"+name).classList.toggle("on", name === "settings");
  $("settingsBtn").setAttribute("aria-pressed", "true");
  store.set("tr_tab", "settings");
}
$("settingsBtn").addEventListener("click", () => {
  if ($("settingsBtn").getAttribute("aria-pressed") === "true"){ $("tabs").querySelector('[data-tab="calc"]').click(); return; }   // tap again to close
  openSettingsPanel();
  $("panel-settings").scrollIntoView({ behavior: "smooth", block: "start" });
});

// Front Office logo: back to the Trade Calculator from anywhere
document.addEventListener("click", e => {
  const h = e.target.closest(".brand-home"); if (!h) return;
  e.preventDefault();
  if (location.hash && location.hash !== "#") location.hash = "";
  if (S.league){ $("tabs").querySelector('[data-tab="calc"]').click(); }
  window.scrollTo({ top: 0, behavior: "smooth" });
});


// Front Office: Market values, league settings and the value engine
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// STEP 3: MARKET (BASE) VALUES
// Uses DynastyProcess open data if reachable; otherwise estimates
// from Sleeper's own player rankings and ages.
// ============================================================
function parseCSV(text){
  const rows=[]; let row=[], cell="", q=false;
  for (let i=0;i<text.length;i++){
    const c=text[i];
    if (q){ if (c==='"'){ if (text[i+1]==='"'){cell+='"';i++;} else q=false; } else cell+=c; }
    else if (c==='"') q=true;
    else if (c===','){ row.push(cell); cell=""; }
    else if (c==='\n'){ row.push(cell); rows.push(row); row=[]; cell=""; }
    else if (c!=='\r') cell+=c;
  }
  if (cell || row.length){ row.push(cell); rows.push(row); }
  return rows;
}
const normName = n => (n||"").toLowerCase().replace(/[.'’`]/g,"").replace(/-/g," ")
  .replace(/\b(jr|sr|ii|iii|iv|v)\b/g,"").replace(/[^a-z ]/g,"").replace(/\s+/g," ").trim();

// 1st choice: data/values.json, written daily by the GitHub Action from FantasyPros.
// It only exists when the site is hosted (GitHub Pages), not when opened as a local file.
const FP_VALUES = "data/values.json";
let fpDataPromise = null;
function getValuesFile(){
  if (!fpDataPromise) fpDataPromise = fetch(FP_VALUES, { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error("values.json " + r.status); return r.json(); })
    .catch(e => { fpDataPromise = null; throw e; });
  return fpDataPromise;
}
// "87 of the country's top fantasy football experts", or a safe fallback if the count is unknown
function expertPhrase(n){ return n > 0 ? `${n} of the country's top fantasy football experts` : "the country's top fantasy football experts"; }
async function loadFantasyPros(){
  const data = await getValuesFile();
  const map = new Map();
  for (const p of data.players || []){
    const key = normName(p.name) + "|" + String(p.pos||"").toUpperCase();
    if (!map.has(key)) map.set(key, { v1: +p.value_1qb || 0, v2: +p.value_2qb || 0, r1: p.r1 != null ? +p.r1 : null, r2: p.r2 != null ? +p.r2 : null, pj: Array.isArray(p.pj) ? p.pj : null });
  }
  if (map.size < 100) throw new Error("too few players");
  return { kind: "fp", map, updated: data.updated, mixed: !!data.filled_from_dynastyprocess,
           experts: { oneqb: +data.experts_1qb || 0, sf: +data.experts_sf || 0 } };
}
async function loadMarket(){
  try { return await loadFantasyPros(); } catch(e){ console.info("FantasyPros values not available, trying DynastyProcess", e.message); }
  try {
    const r = await fetch(MARKET_CSV);
    if (!r.ok) throw new Error("csv " + r.status);
    const rows = parseCSV(await r.text());
    const h = rows[0].map(x => x.trim().toLowerCase());
    const iName=h.indexOf("player"), iPos=h.indexOf("pos"), i1=h.indexOf("value_1qb"), i2=h.indexOf("value_2qb");
    if ([iName,iPos,i1,i2].includes(-1)) throw new Error("unexpected columns");
    const map = new Map();
    for (const row of rows.slice(1)){
      if (!row[iName]) continue;
      const key = normName(row[iName]) + "|" + (row[iPos]||"").toUpperCase();
      if (!map.has(key)) map.set(key, { v1: +row[i1]||0, v2: +row[i2]||0 });
    }
    if (map.size < 100) throw new Error("too few rows");
    return { kind: "dp", map };
  } catch(e){
    console.warn("Market CSV unavailable, using Sleeper estimate", e);
    return { kind: "sleeper", map: null };
  }
}

function ageFactor(pos, age){
  if (!age) return 1;
  const peak={QB:31,RB:25,WR:27,TE:28}[pos], drop={QB:.07,RB:.15,WR:.10,TE:.10}[pos];
  if (age <= peak-2) return 1.08;
  if (age <= peak) return 1;
  return Math.pow(1-drop, age-peak);
}

// ============================================================
// STEP 4: READ LEAGUE SETTINGS
// ============================================================
function readSettings(league, rosters){
  const rp = league.roster_positions || [];
  const sc = league.scoring_settings || {};
  const count = p => rp.filter(x => x===p).length;
  let rounds = league.settings?.draft_rounds || 4;
  if (rounds > 6) rounds = 4;
  return {
    teams: league.total_rosters || rosters.length || 12,
    superflex: rp.includes("SUPER_FLEX") || count("QB") >= 2,
    flex: rp.filter(x => ["FLEX","REC_FLEX","WRRB_FLEX"].includes(x)).length,
    wr: count("WR"),
    starters: rp.filter(x => !["BN","IR","TAXI"].includes(x)).length,
    rec: sc.rec ?? 1, tep: sc.bonus_rec_te || 0, passTd: sc.pass_td ?? 4,
    rounds, dynasty: league.settings?.type === 2,
    rp, sc, st: league.settings || {}
  };
}

// ============================================================
// STEP 5: BUILD LEAGUE-SPECIFIC VALUES
// ============================================================
// Age to one decimal (e.g. 26.4), worked out from the birth date; falls back to Sleeper's whole-number age
function exactAge(p){
  const born = p?.birth_date ? Date.parse(p.birth_date) : NaN;
  if (!isNaN(born)) return Math.round((Date.now() - born) / 31557600000 * 10) / 10;
  return p?.age ? Number(p.age) : null;
}
const ageText = a => a == null || a === "" ? "" : Number(a).toFixed(1);
// ---------- Age discount (29 and older) ----------
// Dynasty value is about future seasons, so an older player is worth less than a
// similar younger one. Starting at age 29, each year (counted to the decimal) takes
// a position-based bite, capped so legends don't drop to zero.
const AGE_START = 28;                                     // discount begins after age 28, i.e. at 29
const AGE_MAX = 33;                                       // 33 through 99 all get the age-33 discount
const AGE_RATE = { RB: 0.12, WR: 0.08, TE: 0.07, QB: 0.04 };
const AGE_FLOOR = 0.55;                                   // full-strength cap (45% off)
const AGE_SCALE = 0.75;                                   // apply 75% of the full-strength discount
const AGE_POS_SCALE = { WR: 0.83 * 0.97 };                // WRs: 17% smaller discount, then 3% smaller again
const AGE_SET = { WR: { 32: 0.15, 33: 0.186 } };          // exact discounts chosen by Pat
function ageCurve(pos, age){                              // discount (0-1) on the smooth curve
  const yrs = Math.min(age, AGE_MAX) - AGE_START, rate = AGE_RATE[pos] ?? 0.08;
  const full = 1 - Math.max(AGE_FLOOR, Math.pow(1 - rate, yrs));
  return full * AGE_SCALE * (AGE_POS_SCALE[pos] ?? 1);
}
// Positions with a fully hand-set table: discount at each age, straight lines between ages, flat from 33 on
const AGE_TABLE = { QB: { 28: 0, 29: 0.02, 30: 0.035, 31: 0.042, 32: 0.055, 33: 0.08 } };   // set by Pat
function ageDiscount(pos, age){
  if (!age || age <= AGE_START) return 1;
  const tbl = AGE_TABLE[pos];
  if (tbl){
    const a = Math.min(age, AGE_MAX), lo = Math.floor(a), hi = Math.min(AGE_MAX, lo + 1);
    return 1 - (tbl[lo] + (tbl[hi] - tbl[lo]) * (a - lo));
  }
  let d;
  if (age <= 31) d = ageCurve(pos, age);
  else {
    const set = AGE_SET[pos] || {};
    const d31 = ageCurve(pos, 31), d33 = set[33] ?? ageCurve(pos, 33), d32 = set[32] ?? d33 - 0.02;   // age 32 = 2 points less than 33+ unless set
    d = age <= 32 ? d31 + (d32 - d31) * (age - 31)
      : age < 33 ? d32 + (d33 - d32) * (age - 32) : d33;
  }
  return 1 - d;
}
// ---------- Market curve: average expert rank -> 0-10,000 value ----------
// value = 10,000 x e^(-K x (rank - 1)^B). B = 1 is the standard curve (each spot ~1.25% below the
// one above, rank 100 = 2,901). With 15+ trades, B is fine-tuned to how this league actually trades
// (B < 1 pays a bigger premium at the very top; B > 1 keeps more value deeper down). Rank 100
// stays at 2,901 either way, so the scale doesn't drift.
const CURVE_R100 = 2901;
function curveVal(rank, B = 1){
  const K = Math.log(10000 / CURVE_R100) / Math.pow(99, B);
  return 10000 * Math.exp(-K * Math.pow(Math.max(1, rank) - 1, B));
}
// The curve actually used: one shape (B), plus a separate slope past rank 60 (T) only when your
// league's trades clearly call for it. T = 1 means no separate slope.
const CURVE_TAIL_FROM = 60;
function marketCurve(rank, B = S.curveB || 1, T = S.curveT || 1){
  if (T === 1 || rank <= CURVE_TAIL_FROM) return curveVal(rank, B);
  const at = curveVal(CURVE_TAIL_FROM, B);
  return at * Math.pow(curveVal(rank, B) / at, T);
}
// ---------- League scoring from projections ----------
// Each player's FantasyPros season projection is scored twice: under THIS league's rules and lineup,
// and under a standard 12-team full-PPR league (with Superflex if this league has it, since the
// market list already prices that in). Comparing his value over a replacement-level player in each
// gives a scoring factor: a 90-catch TE gains from TE premium, a blocking TE barely moves, a rushing
// QB gains in 6-point leagues more than a pocket passer, and depth matters more in bigger leagues.
// The factor is applied at half strength on top of the market (market x factor^0.5), kept between
// x0.75 and x1.35, and averages out to x1.00 across the league's top players.
const PROJ_MIN_PLAYERS = 150, PROJ_SMOOTH = 20, PROJ_WEIGHT = 0.5, PROJ_MIN = 0.75, PROJ_MAX = 1.35;
const SLOT_POS = { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], FLEX: ["RB", "WR", "TE"], WRRB_FLEX: ["RB", "WR"], REC_FLEX: ["WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"] };
function projPoints(pj, pos, sc){
  const [py, ptd, pint, ry, rtd, rec, recy, rectd, fl] = pj;
  const bonus = pos === "TE" ? sc.bonus_rec_te || 0 : pos === "RB" ? sc.bonus_rec_rb || 0 : pos === "WR" ? sc.bonus_rec_wr || 0 : 0;
  return py * (sc.pass_yd ?? 0.04) + ptd * (sc.pass_td ?? 4) + pint * (sc.pass_int ?? -1) + ry * (sc.rush_yd ?? 0.1) + rtd * (sc.rush_td ?? 6)
       + rec * ((sc.rec ?? 1) + bonus) + recy * (sc.rec_yd ?? 0.1) + rectd * (sc.rec_td ?? 6) + fl * (sc.fum_lost ?? -2);
}
function replacementLevels(players, pts, slots, teams){
  // Fill every team's starting lineup with the best available players; the best player left over at
  // each position is "replacement level" (what you could start for free)
  const pool = players.map(a => ({ a, p: pts(a) })).sort((x, y) => y.p - x.p), used = new Set();
  const order = slots.filter(s => SLOT_POS[s]).sort((x, y) => SLOT_POS[x].length - SLOT_POS[y].length);
  for (const s of order) for (let t = 0; t < teams; t++){
    const i = pool.findIndex((x, k) => !used.has(k) && SLOT_POS[s].includes(x.a.pos)); if (i >= 0) used.add(i);
  }
  const rep = {};
  for (const pos of ["QB", "RB", "WR", "TE"]){ const i = pool.findIndex((x, k) => !used.has(k) && x.a.pos === pos); rep[pos] = i >= 0 ? pool[i].p : 0; }
  return rep;
}
function scoringFactors(list, cfg){
  const withP = list.filter(a => a.pj);
  if (withP.length < PROJ_MIN_PLAYERS) return null;
  const STD = { pass_yd: 0.04, pass_td: 4, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2 };
  const lg = a => projPoints(a.pj, a.pos, cfg.sc || {}), st = a => projPoints(a.pj, a.pos, STD);
  const leagueSlots = (cfg.rp || []).filter(x => SLOT_POS[x]);
  const stdSlots = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"].concat(cfg.superflex ? ["SUPER_FLEX"] : []);
  const repL = replacementLevels(withP, lg, leagueSlots.length ? leagueSlots : stdSlots, cfg.teams || 12), repS = replacementLevels(withP, st, stdSlots, 12);
  // smoothing = the position's replacement-level points, so players near the cutoff don't swing wildly
  const raw = new Map(withP.map(a => { const c = Math.max(PROJ_SMOOTH, repS[a.pos]); return [a.id, (Math.max(0, lg(a) - repL[a.pos]) + c) / (Math.max(0, st(a) - repS[a.pos]) + c)]; }));
  // average out to 1.00 across the top 150 players (weighted by value), so this reshuffles rather than inflates
  const top = [...withP].sort((x, y) => y.base - x.base).slice(0, 150);
  const mean = top.reduce((t, a) => t + raw.get(a.id) * a.base, 0) / Math.max(1, top.reduce((t, a) => t + a.base, 0));
  const out = new Map();
  raw.forEach((f, id) => out.set(id, Math.min(PROJ_MAX, Math.max(PROJ_MIN, Math.pow(f / mean, PROJ_WEIGHT)))));
  return out;
}
// ---------- Strength of the age and role adjustments ----------
// FantasyPros' experts already rank older players lower and update ranks when starters change,
// so these apply at reduced strength to avoid counting the same thing twice. Role: half strength.
// Age: a quarter of the full table by default (Pat cut it 50% from half strength), and then tested
// against the league's own trades, which can move it from no age discount (x0) up to double (x2,
// the old half-strength level) as the evidence builds.
const AGE_STRENGTH = 0.25, ROLE_STRENGTH = 0.5;
const AGE_FIT_MIN = 0, AGE_FIT_MAX = 2;
const ageMul = (a, s = S.ageStrength ?? 1) => 1 - (1 - ageDiscount(a.pos, a.age)) * AGE_STRENGTH * s;
// All of a player's adjustments together can move him at most this far from his market value
const ADJ_MIN = 0.65, ADJ_MAX = 1.5;
// ---------- Draft picks ----------
// A pick is worth the league value of the player it typically turns into: a projected 1.01 is valued
// like your league's ~30th-best player, and each pick after that like a player about 5 spots lower.
// Because it uses this league's own player values, picks rise in Superflex and TE-premium leagues
// along with the players they become. Picks are worth more as the draft gets close (+4% in the
// weeks before it, -10% at most 10+ months out), and 8% less for each extra year away.
const PICK_RANK_1 = 29.5, PICK_RANK_STEP = 4.8;
function draftTiming(){
  const now = new Date(), draft = new Date(now.getFullYear(), 4, 1);   // rookie drafts are mostly early May
  if (now > draft) draft.setFullYear(draft.getFullYear() + 1);
  const months = (draft - now) / (30.4 * 864e5);
  return Math.min(1.04, Math.max(0.9, 1.04 - 0.014 * months));
}
function pickValue(p12, yearsOut){
  const vals = S.playerCurve || [];
  const r = PICK_RANK_1 + PICK_RANK_STEP * (p12 - 1), i = Math.floor(r - 1), f = r - 1 - i;
  const at = k => vals[Math.min(vals.length - 1, Math.max(0, k))] ?? 0;
  const v = vals.length ? at(i) + (at(i + 1) - at(i)) * f : 7000 * Math.exp(-0.06 * (p12 - 1));
  return v * Math.pow(0.92, yearsOut) * (yearsOut === 0 ? (S.pickTiming ?? 1) : 1) * (S.nudge ? S.nudge.PICK : 1);
}
// ---------- Depth chart role (from Sleeper's NFL depth charts, updated as teams change starters) ----------
// A starting QB gets a boost, most for lower-ranked QBs whose value depends on the job (a top QB's
// starting role is already in his market value). Starting RBs outside the top 20 get a boost, and the RB2 on his team
// (the handcuff, next in line for the work) gets a smaller one.
const ROLE_RB1 = 0.06, ROLE_RB2 = 0.03;
// Smooth slopes instead of steps: a starting QB's boost rises steadily from +3% (QB12 and better)
// to +8% (QB24) and +15% (QB36 and lower); a starting RB's from 0 (RB16 and better) to +6% (RB24
// and lower). (These are full-strength numbers; ROLE_STRENGTH halves them.)
const lerpPts = (x, pts) => { if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return pts.at(-1)[1]; };
const ROLE_QB_CURVE = [[12, 0.03], [24, 0.08], [36, 0.15]], ROLE_RB_CURVE = [[16, 0], [24, 0.06]];
function roleBuff(a){
  if (a.pos === "QB" && a.depthPos === "QB" && a.depthOrder === 1) return 1 + lerpPts(a.posRank || 99, ROLE_QB_CURVE);
  if (a.pos === "RB" && a.depthPos === "RB" && a.depthOrder === 1) return 1 + lerpPts(a.posRank || 99, ROLE_RB_CURVE);
  if (a.pos === "RB" && a.depthPos === "RB" && a.depthOrder === 2) return 1 + ROLE_RB2;
  return 1;
}
function roleText(a){
  if (a.depthPos !== a.pos || !a.depthOrder) return "";
  if (a.pos === "QB" && a.depthOrder === 1) return "Starting QB";
  if (a.pos === "RB" && a.depthOrder === 1) return "Starting RB";
  if (a.pos === "RB" && a.depthOrder === 2) return "Handcuff RB";
  return "";
}
function buildValues(){
  const cfg = S.cfg, P = S.sleeperPlayers, assets = new Map();
  const owner = new Map();
  for (const r of S.rosters) for (const pid of (r.players||[])) owner.set(pid, r.roster_id);

  // base value for each player
  const list = [];
  for (const [pid, p] of Object.entries(P)){
    const pos = p.position;
    if (!["QB","RB","WR","TE"].includes(pos)) continue;
    const rostered = owner.has(pid);
    if (!rostered && !p.team) continue;
    const name = p.full_name || `${p.first_name||""} ${p.last_name||""}`.trim();
    let base = 0, rank = null, pj = null;
    if (S.market.kind !== "sleeper"){
      const m = S.market.map.get(normName(name) + "|" + pos);
      if (m){
        rank = cfg.superflex ? m.r2 : m.r1;
        base = rank != null ? marketCurve(rank) : (cfg.superflex ? m.v2 : m.v1);   // average expert rank -> value
        pj = m.pj;
      }
    } else {
      const rk = p.search_rank;
      if (rk && rk < 2000) base = 10000 * Math.exp(-0.011*(rk-1)) * ageFactor(pos, p.age);
    }
    if (!base && !rostered) continue;
    list.push({ id:"p:"+pid, pid, kind:"player", name, pos, nfl:p.team||"FA", age:exactAge(p), base, mRank: rank, pj, owner: owner.get(pid), depthPos: p.team ? p.depth_chart_position : null, depthOrder: p.team ? Number(p.depth_chart_order) || null : null });
  }

  // rank by base, overall and per position
  list.sort((a,b) => b.base - a.base);
  const posCount = {};
  list.forEach((a,i) => { a.rank = i+1; posCount[a.pos]=(posCount[a.pos]||0)+1; a.posRank = posCount[a.pos]; });

  // league multipliers
  const r = Math.max(0, Math.min(1, cfg.rec));
  let sRB=1, sWR=1, sTE=1;
  if (r < 1 && r >= .5){ const t=(1-r)/.5; sRB=1+.05*t; sWR=1-.07*t; sTE=1-.10*t; }
  else if (r < .5){ const t=(.5-r)/.5; sRB=1.05+.05*t; sWR=.93-.08*t; sTE=.90-.05*t; }
  const tepMult = 1 + Math.min(cfg.tep, 1) * 0.30;
  const sizeMult = cfg.teams < 12 ? Math.max(.6, 1-(12-cfg.teams)*.075) : Math.min(1.4, 1+(cfg.teams-12)*.05);

  const rules = [];
  const r2 = x => Math.round(x*100)/100;
  // League scoring from projections replaces the flat setting multipliers when projections are available
  const SF = S.market.kind === "fp" ? scoringFactors(list, cfg) : null;
  S.scoringFromProjections = !!SF;
  if (S.market.kind === "sleeper" && cfg.superflex) rules.push({m:"×1.3–2.2", t:"Superflex boosts QBs", d:"QBs ranked 13–24 gain the most because they become starters."});
  if (S.market.kind !== "sleeper" && cfg.superflex) rules.push({m:"SF", t:"Superflex market values used", d:"QBs start from Superflex market values, which already price in the second QB slot."});
  if (SF){
    const movers = list.filter(a => SF.has(a.id) && a.base > 2500).map(a => ({ a, f: SF.get(a.id) })).sort((x, y) => y.f - x.f);
    const up = movers.slice(0, 3).filter(x => x.f > 1.01).map(x => `${x.a.name} +${Math.round((x.f - 1) * 100)}%`);
    const down = movers.slice(-3).reverse().filter(x => x.f < 0.99).map(x => `${x.a.name} ${Math.round((x.f - 1) * 100)}%`);
    rules.push({ m: "Scoring", t: "Your scoring and lineup, from projections",
      d: `Every player's season projection is scored under your league's rules${cfg.tep ? ` (including +${cfg.tep} per TE catch)` : ""} and compared with a standard league. Biggest gains: ${up.join(", ") || "none"}. Biggest drops: ${down.join(", ") || "none"}.` });
  } else {
  if (cfg.tep) rules.push({m:"×"+r2(tepMult), t:`TE premium (+${cfg.tep} per catch)`, d:"Applies to every tight end."});
  if (sizeMult !== 1) rules.push({m:"×"+r2(sizeMult), t:`${cfg.teams}-team league`, d:"Applies to players outside the top 36, since depth is "+(sizeMult>1?"scarcer":"easier to find")+"."});
  if (r < 1) rules.push({m:`RB ×${r2(sRB)}`, t:r>=.5?"Half PPR":"Low or no PPR", d:`WRs ×${r2(sWR)}, TEs ×${r2(sTE)}. Fewer catch points shift value toward running backs.`});
  if (cfg.passTd >= 6) rules.push({m:"×1.1", t:`${cfg.passTd}-point passing TDs`, d:"Applies to every quarterback."});
  if (cfg.flex > 1) rules.push({m:"×"+r2(Math.pow(1.05,cfg.flex-1)), t:`${cfg.flex} flex spots`, d:"RBs, WRs and TEs ranked outside the top 24 overall, since more of them start."});
  if (cfg.wr >= 3) rules.push({m:"×1.05", t:`${cfg.wr} starting WRs`, d:"Applies to every wide receiver."});
  }
  if ((S.curveB && Math.abs(S.curveB - 1) >= 0.01) || (S.curveT && Math.abs(S.curveT - 1) >= 0.01)) rules.push({ m: "Curve", t: "Value curve fit to your league's trades",
    d: [S.curveB && Math.abs(S.curveB - 1) >= 0.01 ? (S.curveB < 1 ? "Your league pays a bigger premium for elite players than the standard curve." : "Your league keeps more value in good starters than the standard curve.") : "",
        S.curveT && Math.abs(S.curveT - 1) >= 0.01 ? (S.curveT > 1 ? "Players past the top 60 fall off faster in your league." : "Players past the top 60 hold more value in your league.") : ""].filter(Boolean).join(" ") });
  if (S.nudge){
    const parts = ["QB","RB","WR","TE","PICK"].filter(k => Math.abs(S.nudge[k]-1) >= 0.005)
      .map(k => `${k === "PICK" ? "Picks" : k + "s"} ×${r2(S.nudge[k])}`);
    rules.push({ m: "League", t: `Your league's trade habits (${S.nudge.n} trades)`,
      d: parts.length ? parts.join(", ") + ". A light adjustment based on how your league has actually traded." : "Your league trades close to market value, so no adjustment was needed." });
  }
  rules.push({ m: "Role", t: "Starters and handcuffs", d: "From NFL depth charts, on smooth slopes by market rank. Starting QBs: +1.5% (QB12 and better) rising to +4% at QB24 and +7.5% at QB36 and lower. Starting RBs: 0 at RB16 and better, rising to +3% at RB24 and lower. Each team's RB2 (the handcuff) +1.5%. Half-strength, because expert rankings already react to depth chart changes." });
  { const st = S.ageStrength ?? 1, pc = (pos, age) => ((1 - ageDiscount(pos, age)) * AGE_STRENGTH * st * 100).toFixed(1).replace(/\.0$/, "");
    const at = age => `RB −${pc("RB", age)}%, WR −${pc("WR", age)}%, TE −${pc("TE", age)}%, QB −${pc("QB", age)}%`;
    const fit = S.ageFit, why = !fit ? "A light default, because expert rankings already mark older players down. With 15+ trades it's tested against how your league actually trades."
      : st > 1.05 ? `Your league discounts older players more than the experts do, so the age adjustment is at ${Math.round(st * 100)}% of the default (from ${fit.n} trades; it moves further as more trades come in).`
      : st < 0.95 ? `Your league trades older players closer to expert value, so the age adjustment is at ${Math.round(st * 100)}% of the default (from ${fit.n} trades).`
      : `Your league's ${fit.n} trades are consistent with the default.`;
    rules.push({ m: "Age", t: st < 0.005 ? "Players 29 and older (no extra discount)" : "Players 29 and older", d: st < 0.005 ? "Your league trades older players at expert value, so there's no extra age discount. " + why : `Value drops each year from 29 to 33, then holds. At 29: ${at(29)}. At 31: ${at(31)}. At 33 and older: ${at(33)}. ` + why }); }
  S.rules = rules;
  for (const a of list){
    let m = S.nudge ? (S.nudge[a.pos] || 1) : 1;
    m *= ageMul(a);
    m *= 1 + (roleBuff(a) - 1) * ROLE_STRENGTH;
    if (S.market.kind === "sleeper" && cfg.superflex && a.pos==="QB") m *= a.posRank<=12 ? 1.7 : a.posRank<=24 ? 2.2 : 1.3;
    if (SF){
      m *= SF.get(a.id) ?? 1;                    // scoring and lineup, from projections
    } else {
      if (a.pos==="TE") m *= tepMult;
      if (a.rank > 36) m *= sizeMult;
      m *= {RB:sRB, WR:sWR, TE:sTE}[a.pos] || 1;
      if (a.pos==="QB" && cfg.passTd >= 6) m *= 1.10;
      if (["RB","WR","TE"].includes(a.pos) && a.rank > 24 && cfg.flex > 1) m *= Math.pow(1.05, cfg.flex-1);
      if (a.pos==="WR" && cfg.wr >= 3) m *= 1.05;
    }
    a.adj = Math.min(ADJ_MAX, Math.max(ADJ_MIN, m));   // all adjustments together stay within x0.65 to x1.5 of market
    a.raw = a.base * a.adj;
  }

  // rescale both columns to 0-10,000 so they compare cleanly
  // Scale so a typical #1 lands at 10,000, using the top 5 so one player's swing doesn't move everyone
  const top5 = arr => { const v = arr.slice().sort((x, y) => y - x).slice(0, 5); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : 1; };
  const topRaw = Math.max(1, top5(list.map(a => a.raw)) * 1.025, Math.max(...list.map(a => a.raw)) * 0.97);
  const topBase = Math.max(1, top5(list.map(a => a.base)) * 1.025, Math.max(...list.map(a => a.base)) * 0.97);
  for (const a of list){ a.value = a.raw/topRaw*10000; a.market = a.base/topBase*10000; assets.set(a.id, a); }
  // Waiver-level value: roughly the player every team could pick up for free
  const byValue = list.map(a => a.value).sort((a, b) => b - a);
  S.playerCurve = byValue;                     // draft picks are valued from this league's player values
  S.pickTiming = draftTiming();
  S.eliteValue = byValue[Math.min(byValue.length - 1, 11)] || 9000;
  // the first player who wouldn't fit on any roster in this league (starters + bench, every team)
  // starters + bench + taxi squads: taxi players are rostered too, so they push waiver level deeper
  const rosterSpots = ((cfg.rp || []).filter(x => !["IR","TAXI"].includes(x)).length || (cfg.starters + 10)) + (Number(cfg.st?.taxi_slots) || 0);
  S.replacement = Math.min(1200, byValue[Math.min(byValue.length - 1, cfg.teams * rosterSpots)] || 300);

  // Ranks by this league's values: overall (#1, #2...) and by position (WR1, WR2...)
  const posSeen = {};
  [...list].filter(a => a.value > 0).sort((a,b) => b.value - a.value).forEach((a, i) => {
    a.lgRank = i + 1;
    posSeen[a.pos] = (posSeen[a.pos] || 0) + 1;
    a.lgPosRank = posSeen[a.pos];
  });

  // team strength: sum of each roster's best (starters + 3) players
  const teams = new Map();
  for (const ro of S.rosters){
    const u = S.users.find(x => x.user_id === ro.owner_id);
    const nm = u?.metadata?.team_name || u?.display_name || ("Team " + ro.roster_id);
    const vals = (ro.players||[]).map(pid => assets.get("p:"+pid)?.value || 0).sort((a,b)=>b-a);
    const strength = vals.slice(0, cfg.starters + 3).reduce((s,v)=>s+v, 0);
    const photo = u?.metadata?.avatar || u?.avatar || null;
    teams.set(ro.roster_id, { rid: ro.roster_id, name: nm, manager: u?.display_name || "", photo, owner: ro.owner_id, co: ro.co_owners||[], strength });
  }
  const ranked = [...teams.values()].sort((a,b) => a.strength - b.strength); // weakest first
  ranked.forEach((t,i) => {
    t.slot = i+1;
    const third = ranked.length/3;
    t.status = i >= ranked.length - third ? "contend" : i < third ? "rebuild" : "middle";
  });

  // draft picks
  const status = S.league.status;
  const firstSeason = Number(S.league.season) + (["in_season","post_season","complete"].includes(status) ? 1 : 0);
  const seasons = [firstSeason, firstSeason+1, firstSeason+2];
  const pickOwner = new Map();
  for (const s of seasons) for (let rd=1; rd<=cfg.rounds; rd++) for (const t of teams.values()) pickOwner.set(`${s}-${rd}-${t.rid}`, t.rid);
  for (const tp of S.traded){
    const key = `${tp.season}-${tp.round}-${tp.roster_id}`;
    if (pickOwner.has(key)) pickOwner.set(key, tp.owner_id);
  }
  const mid = (cfg.teams+1)/2;
  const ord = n => n===1?"1st":n===2?"2nd":n===3?"3rd":n+"th";
  for (const [key, own] of pickOwner){
    const [s, rd, orig] = key.split("-").map(Number);
    const yi = s - firstSeason, t = teams.get(orig);
    if (!t) continue;
    const odds = yi === 0 ? S.pickOdds?.get(orig) : null;
    const p12of = sl => ((rd - 1) * cfg.teams + sl - 1) * 12 / cfg.teams + 1;
    let slot = yi===0 ? t.slot : yi===1 ? (t.slot+mid)/2 : mid, value, range = "";
    if (odds && odds.some(x => x > 0)){
      // the average value over every slot this pick landed in across the simulated seasons
      value = odds.reduce((sum, p, k) => sum + p * pickValue(p12of(k + 1), 0), 0);
      slot = odds.reduce((sum, p, k) => sum + p * (k + 1), 0);
      let c = 0, lo = 1, hi = cfg.teams;
      for (let k = 0; k < odds.length; k++){ c += odds[k]; if (c >= 0.1){ lo = k + 1; break; } }
      c = 0; for (let k = 0; k < odds.length; k++){ c += odds[k]; if (c >= 0.9){ hi = k + 1; break; } }
      range = lo === hi ? "" : `simulated: likely ${rd}.${String(lo).padStart(2, "0")}–${rd}.${String(hi).padStart(2, "0")}`;
    } else value = pickValue(p12of(slot), yi);
    let label;
    if (yi===0) label = `${s} ${rd}.${String(Math.round(slot)).padStart(2,"0")}`;   // e.g. "2027 1.08"
    else { const tier = slot <= cfg.teams/3 ? "Early" : slot > cfg.teams*2/3 ? "Late" : "Mid"; label = yi===1 ? `${s} ${tier} ${ord(rd)}` : `${s} ${ord(rd)}`; }
    const via = own !== orig ? `from ${t.name}${range ? ", " + range : ""}` : (yi===0 ? (range || "projected slot") : "own pick");
    assets.set("k:"+key, { id:"k:"+key, kind:"pick", name: label, pos:"PICK", nfl: via, value, market: value, owner: own, round: rd, season: s });
  }

  S.assets = assets; S.teams = teams;
  const mine = [...teams.values()].find(t => t.owner === S.user.user_id || t.co.includes(S.user.user_id));
  S.myRid = mine ? mine.rid : [...teams.keys()][0];
}


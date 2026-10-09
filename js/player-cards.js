// Front Office: Player cards: career stats, injuries, status
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// PLAYER CARDS
// Click a player's photo anywhere (or a player row on Player Values) to open his card:
// photo, bio and current injury come from Sleeper; career stats and past injury reports
// come live from Sleeper (backup: data/players.json); there is no injury history.
// ============================================================
const NFL_TEAMS = {ARI:"Arizona Cardinals",ATL:"Atlanta Falcons",BAL:"Baltimore Ravens",BUF:"Buffalo Bills",CAR:"Carolina Panthers",CHI:"Chicago Bears",CIN:"Cincinnati Bengals",CLE:"Cleveland Browns",DAL:"Dallas Cowboys",DEN:"Denver Broncos",DET:"Detroit Lions",GB:"Green Bay Packers",HOU:"Houston Texans",IND:"Indianapolis Colts",JAX:"Jacksonville Jaguars",KC:"Kansas City Chiefs",LV:"Las Vegas Raiders",LAC:"Los Angeles Chargers",LAR:"Los Angeles Rams",LA:"Los Angeles Rams",MIA:"Miami Dolphins",MIN:"Minnesota Vikings",NE:"New England Patriots",NO:"New Orleans Saints",NYG:"New York Giants",NYJ:"New York Jets",PHI:"Philadelphia Eagles",PIT:"Pittsburgh Steelers",SF:"San Francisco 49ers",SEA:"Seattle Seahawks",TB:"Tampa Bay Buccaneers",TEN:"Tennessee Titans",WAS:"Washington Commanders"};
const CARD_DATA = "data/players.json";
let cardData = null, cardDataLoad = null;
function loadCardData(){
  if (!cardDataLoad) cardDataLoad = fetch(CARD_DATA + "?v=" + new Date().toISOString().slice(0, 10))
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => (cardData = d))
    .catch(() => { cardDataLoad = null; return null; });
  return cardDataLoad;
}
// Career stats straight from Sleeper, one request per season he's played (they run side by side),
// so the card is as current as Sleeper itself. data/players.json is the backup.
const careerCache = new Map();
const liveSeasonYear = () => Number(S.nflState?.season) || (cardData && cardData.season) || new Date().getFullYear();
async function sleeperSeason(pid, season, sp){
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`https://api.sleeper.com/stats/nfl/player/${encodeURIComponent(pid)}?season_type=regular&season=${season}&grouping=season`, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return { ok: false };
    const d = await r.json(), x = d && d.stats;
    if (!x || !x.gp) return { ok: true, row: null };
    const v = k => Number(x[k]) || 0;
    return { ok: true, row: [season, d.team || (season === liveSeasonYear() ? sp?.team : "") || "", v("gp"), v("pass_cmp"), v("pass_att"), v("pass_yd"), v("pass_td"), v("pass_int"),
      v("rush_att"), v("rush_yd"), v("rush_td"), v("rec_tgt"), v("rec"), v("rec_yd"), v("rec_td"), v("fum_lost"), v("pts_ppr")] };
  } catch(e){ return { ok: false }; }
}
async function liveCareer(pid, sp){
  if (careerCache.has(pid)) return careerCache.get(pid);
  const now = liveSeasonYear();
  let first = Number(sp?.metadata?.rookie_year) || (now - (Number(sp?.years_exp) || 0));
  first = Math.max(2012, Math.min(now, first));
  const years = []; for (let y = first; y <= now; y++) years.push(y);
  const res = await Promise.all(years.map(y => sleeperSeason(pid, y, sp)));
  const out = { ok: res.filter(r => r.ok).length, okYears: new Set(years.filter((y, i) => res[i].ok)), rows: res.filter(r => r.row).map(r => { r.row.live = true; return r.row; }) };
  if (out.ok) careerCache.set(pid, out);
  return out;
}
function cardRecord(pid){ return cardData?.players?.[pid] || null; }
const INJ_LABEL = { Questionable: ["Questionable", "q"], Doubtful: ["Doubtful", "d"], Out: ["Out", "o"], IR: ["Injured Reserve", "o"], PUP: ["PUP list", "o"], NFI: ["Non-football injury list", "o"], Sus: ["Suspended", "o"], COV: ["COVID list", "o"], NA: ["Not active", "d"], DNR: ["Did not report", "d"] };
function heightText(h){
  if (!h) return "";
  if (/['"]/.test(h)) return h;
  const n = Number(h); return n ? `${Math.floor(n / 12)}'${n % 12}"` : String(h);
}
function expText(y){ y = Number(y); if (isNaN(y)) return ""; if (y === 0) return "Rookie"; const n = y + 1; return n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th","st","nd","rd"][n % 10] || "th") + " season"; }
function dateText(d){ if (/^\d{4}-\d{2}-\d{2}$/.test(d || "")) d += "T12:00:00"; const t = Date.parse(d); return isNaN(t) ? "" : new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }); }
const n0 = v => (v || 0).toLocaleString();

function statsTable(rec, pos, season){
  const rows = rec?.s || [];
  if (!rows.length) return `<p class="empty">No NFL regular-season stats yet.</p>`;
  // column: [header, value from a season row]
  const C = {
    g: ["G", r => r[2]], ca: ["Cmp/Att", r => `${n0(r[3])}/${n0(r[4])}`], py: ["Pass Yds", r => n0(r[5])], ptd: ["Pass TD", r => r[6]], int: ["INT", r => r[7]],
    car: ["Carries", r => n0(r[8])], ry: ["Rush Yds", r => n0(r[9])], rtd: ["Rush TD", r => r[10]],
    tgt: ["Targets", r => n0(r[11])], rec: ["Rec", r => n0(r[12])], recy: ["Rec Yds", r => n0(r[13])], rectd: ["Rec TD", r => r[14]],
    pts: ["PPR Pts", r => (Math.round(r[16] * 10) / 10).toLocaleString()], ppg: ["Pts/G", r => r[2] ? (r[16] / r[2]).toFixed(1) : "–"]
  };
  const cols = pos === "QB" ? ["g","ca","py","ptd","int","ry","rtd","pts","ppg"]
             : pos === "RB" ? ["g","car","ry","rtd","rec","recy","rectd","pts","ppg"]
             : ["g","tgt","rec","recy","rectd","ry","pts","ppg"];
  const tot = [0, "", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  rows.forEach(r => { for (let i = 2; i < tot.length; i++) tot[i] += Number(r[i]) || 0; });
  const body = [...rows].reverse().map(r => `<tr><td>${r[0]}</td><td class="l">${esc(r[1] || "–")}</td>${cols.map(k => `<td>${C[k][1](r)}</td>`).join("")}</tr>`).join("");
  const yrs = new Set(rows.map(r => r[0])).size;
  return `<div class="pc-scroll"><table><thead><tr><th>Season</th><th class="l">Team</th>${cols.map(k => `<th>${C[k][0]}</th>`).join("")}</tr></thead>
    <tbody>${body}<tr class="tot"><td>Career</td><td class="l">${yrs} season${yrs > 1 ? "s" : ""}</td>${cols.map(k => `<td>${C[k][1](tot)}</td>`).join("")}</tr></tbody></table></div>`;
}
// ---------- Current injury: details + Front Office's return estimate ----------
// Typical NFL time missed, in weeks [fewest, most], by injury. First match wins, so specific injuries come first.
const INJURY_TIMES = [
  [/achilles/, 36, 52, "Achilles tears usually end the season"], [/\bacl\b|anterior cruciate/, 36, 52, "ACL tears usually take 9 to 12 months"],
  [/lisfranc/, 8, 16, ""], [/pectoral|\bpec\b/, 8, 16, ""], [/collarbone|clavicle/, 6, 10, ""],
  [/fractur|broken|break/, 4, 10, "Fractures usually take 4 to 10 weeks"], [/\bpcl\b/, 3, 8, ""], [/meniscus/, 3, 6, ""], [/\bmcl\b/, 2, 6, ""],
  [/high ankle/, 3, 6, "High ankle sprains usually take 3 to 6 weeks"], [/turf toe/, 2, 6, ""], [/\bac joint|separated shoulder/, 2, 4, ""],
  [/torn|tear|rupture/, 4, 10, "Tears usually cost several weeks"],
  [/concussion|head/, 1, 2, "Concussions depend on clearing the league protocol, usually 1 to 2 weeks"],
  [/hamstring/, 1, 3, "Hamstrings often linger and can re-aggravate"], [/groin|adductor/, 1, 3, ""], [/quad/, 1, 3, ""], [/calf/, 1, 3, ""],
  [/oblique|abdom|core|ribs?\b|chest/, 1, 3, ""], [/hip/, 1, 3, ""], [/back|neck|spine/, 1, 3, ""], [/shoulder/, 1, 4, ""],
  [/knee/, 1, 4, ""], [/ankle/, 1, 3, ""], [/foot/, 1, 4, ""], [/toe/, 1, 3, ""], [/elbow|wrist|forearm/, 1, 3, ""],
  [/hand|finger|thumb/, 0, 2, ""], [/illness|sick|flu/, 0, 1, ""]
];
// Saved news is [date, title, text, kind, link]; kind "i" = injury news (older saves had only injury news)
const isInjuryNews = n => n.length < 4 || n[3] === "i";
function returnEstimate(sp, news, fpNow){
  news = (news || []).filter(isInjuryNews);
  const st = sp?.injury_status;
  if (!st || st === "Sus" || st === "NA" || st === "DNR") return null;
  const text = [sp.injury_body_part, sp.injury_notes, fpNow?.inj, fpNow?.note, ...(news || []).slice(0, 2).map(n => n[1] + " " + n[2])].filter(Boolean).join(" ").toLowerCase();
  const wk = currentWeek(), inSeason = S.nflState?.season_type === "regular";
  const since = Date.parse((sp.injury_start_date || "") + (/^\d{4}-\d{2}-\d{2}$/.test(sp.injury_start_date || "") ? "T12:00:00" : ""));
  const out = isNaN(since) ? 0 : Math.max(0, Math.floor((Date.now() - since) / (7 * 864e5)));
  let lo, hi, why = [];
  // 1) a timeline in the notes or news beats everything else
  const m = text.match(/(\d+)\s*(?:-|to|–)\s*(\d+)\s*weeks?/) || text.match(/(\d+)\s*weeks?/);
  const months = text.match(/(\d+)\s*(?:-|to|–)?\s*(\d+)?\s*months?/);
  if (/season[- ]ending|out for (the )?season|miss (the )?(rest of the )?season|year[- ]ending/.test(text)){ lo = hi = 99; why.push("Reports say he's out for the season"); }
  else if (m && !/practice|returned|after \d+ weeks/.test(text.slice(Math.max(0, m.index - 20), m.index))){ lo = +m[1]; hi = +(m[2] || m[1]); why.push(`Reports give a ${m[2] ? m[1] + "–" + m[2] : m[1]}-week timeline`); }
  else if (months){ lo = 4 * +months[1]; hi = 4 * +(months[2] || months[1]); why.push(`Reports give a ${months[2] ? months[1] + "–" + months[2] : months[1]}-month timeline`); }
  else {
    const hit = INJURY_TIMES.find(([re]) => re.test(text));
    [lo, hi] = hit ? [hit[1], hit[2]] : [1, 3];
    why.push(hit ? (hit[3] || `${(sp.injury_body_part || "This injury")} injuries usually cost ${hit[1] === hit[2] ? hit[1] : hit[1] + "–" + hit[2]} week${hit[2] === 1 ? "" : "s"}`) : "Typical range for an unspecified injury");
    if (/week[- ]to[- ]week/.test(text)){ lo = Math.max(lo, 1); why.push("described as week-to-week"); }
    if (/day[- ]to[- ]day/.test(text)){ hi = Math.min(hi, 1); why.push("described as day-to-day"); }
    if (/surgery/.test(text)){ lo = Math.max(lo, 4); hi = Math.max(hi, 8); why.push("surgery adds time"); }
  }
  // 2) the designation sets a floor or ceiling
  const prob = fpNow && fpNow.prob !== "" && fpNow.prob != null ? Number(fpNow.prob) : NaN;
  if (st === "Questionable" && !isNaN(prob)){
    lo = 0; hi = prob >= 0.5 ? 0 : 1;
    why.push(`Injury reports give him a ${Math.round(prob * 100)}% chance to play this week`);
  }
  else if (st === "Questionable"){ lo = 0; hi = Math.min(hi, 1); why.push("Questionable players usually play or miss one game"); }
  else if (st === "Doubtful"){ lo = 1; hi = Math.min(Math.max(hi, 1), 2); why.push("Doubtful players usually miss this week"); }
  else if (["IR", "PUP", "NFI"].includes(st) && lo < 99){ lo = Math.max(lo, 4); hi = Math.max(hi, 4); why.push(`${INJ_LABEL[st][0]} means at least 4 games`); }
  else if (st === "Out" || st === "COV"){ lo = Math.max(lo, 1); hi = Math.max(hi, 1); }
  // 3) time already missed comes off the estimate
  if (out && lo < 99 && st !== "Questionable" && st !== "Doubtful"){ lo = Math.max(st === "Out" || INJ_LABEL[st]?.[1] === "o" ? 1 : 0, lo - out); hi = Math.max(lo, hi - out); why.push(`he's already been out about ${out} week${out > 1 ? "s" : ""}`); }
  // In words
  let head, sub;
  if (lo >= 99){ head = "Out for the season"; sub = "Expected back next season"; }
  else if (hi === 0){ head = st === "Questionable" ? "Likely to play this week" : "Expected to play this week"; sub = !isNaN(prob) ? `${Math.round(prob * 100)}% chance of playing` : ""; }
  else if (st === "Questionable"){ head = "Game-time decision"; sub = !isNaN(prob) ? `${Math.round(prob * 100)}% chance of playing; most likely misses 0–1 games` : "Most likely misses 0–1 games"; }
  else {
    const span = (a, b) => b > 8 ? (Math.round(a / 4.3) === Math.round(b / 4.3) ? `About ${Math.round(a / 4.3)} months` : `About ${Math.round(a / 4.3)}–${Math.round(b / 4.3)} months`)
      : a === b ? `About ${a} week${a === 1 ? "" : "s"}` : `About ${a}–${b} weeks`;
    const w1 = wk + Math.max(lo, 1), w2 = wk + Math.max(hi, 1);       // misses this week through the range, back the week after
    if (inSeason && w1 > 18){ head = "Likely out for the season"; sub = span(lo, hi) + ", so expected back next season"; }
    else {
      head = span(lo, hi);
      sub = !inSeason ? "" : w1 === w2 ? `Likely back Week ${w1}` : `Likely back between Week ${w1} and ${w2 > 18 ? "the end of the season" : "Week " + w2}`;
    }
  }
  const conf = why[0]?.startsWith("Reports") ? "Based on reported timeline" : why.some(w => w.startsWith("Injury reports give")) ? "Based on reported odds" : "Rough estimate";
  return { head, sub, why: why.join("; ") + ".", conf, lo, hi };
}
// Will an injured player help a fantasy lineup again this season? Uses the same return estimate as the
// player card. "done" = out for the season, or even the earliest return comes after the league's
// championship week. "back" = the likely week he returns. null = healthy (or not in season).
function lastFantasyWeek(){
  const st = S.league?.settings || {};
  const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, Number(st.playoff_teams) || 6))));
  return Math.min(18, (Number(st.playoff_week_start) || 15) + rounds - 1);
}
function seasonOutlook(pid){
  const sp = S.sleeperPlayers?.[pid]; if (!sp?.injury_status) return null;
  const c = cardData?.players?.[pid], est = returnEstimate(sp, c?.n || [], c?.c);
  if (!est) return null;
  if (est.lo >= 99) return { done: true, back: null, est };
  if (S.nflState?.season_type !== "regular") return null;
  const now = currentWeek(), back = now + Math.max(1, Math.round((est.lo + est.hi) / 2));
  return { done: now + est.lo > lastFantasyWeek(), back, est };
}
function currentStatus(sp, rec, news){
  const st = sp?.injury_status, lab = INJ_LABEL[st];
  if (!st && (!sp?.status || sp.status === "Active")) {
    return `<div class="pc-status"><b>No current injury designation</b><p>Active${sp?.team ? " for the " + esc(NFL_TEAMS[sp.team] || sp.team) : ""}.</p></div>`;
  }
  const label = lab ? lab[0] : (st || sp.status);
  const cls = lab && lab[1] === "q" ? "warn" : "hurt";
  const sinceT = Date.parse((sp.injury_start_date || "") + "T12:00:00");
  const days = isNaN(sinceT) ? null : Math.max(0, Math.round((Date.now() - sinceT) / 864e5));
  const fp = rec?.c;
  const PRAC = { dnp: "Did not practice", limit: "Limited", limited: "Limited", full: "Full" };
  const pr = x => PRAC[String(x).toLowerCase()] || x;
  const practice = fp?.prac?.length ? fp.prac.map(pr).join(" → ") : [sp.practice_participation, sp.practice_description].filter(Boolean).join(": ");
  // Our own estimate from the designation (NFL teams only give the designation, not odds)
  const chance = { Questionable: "About 75% (our estimate)", Doubtful: "About 25% (our estimate)", Out: "Won't play this week", IR: "Out (injured reserve)", PUP: "Out (PUP list)", NFI: "Out (NFI list)", Sus: "Suspended" }[st] || "";
  const rows = [
    ["Designation", label], ["Details", sp.injury_notes], ["Chance of playing", chance],
    ["Since", sp.injury_start_date ? `${dateText(sp.injury_start_date)}${days != null ? ` (${days === 0 ? "today" : days === 1 ? "1 day ago" : days + " days ago"})` : ""}` : ""],
    ["Practice this week", practice]
  ].filter(r => r[1]);
  const est = returnEstimate(sp, news, fp);
  return `<div class="pc-status ${cls}"><b>${esc(label)}${sp.injury_body_part ? " · " + esc(sp.injury_body_part) : ""}</b>
    <dl class="pc-inj">${rows.slice(1).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    ${est ? `<div class="pc-est"><small>Estimated time out</small><b>${esc(est.head)}</b>${est.sub ? `<span>${esc(est.sub)}</span>` : ""}<p>${esc(est.conf)}: ${esc(est.why)} This is Front Office's estimate, not a team report.</p></div>` : ""}
  </div>`;
}
// Where he sits on his NFL team's depth chart: RB1, WR3, QB2… (Sleeper splits receivers into left, right and slot)
const DEPTH_GROUP = { LWR: "WR", RWR: "WR", SWR: "WR", WR: "WR", QB: "QB", RB: "RB", TE: "TE" };
function depthChartText(pid){
  const sp = S.sleeperPlayers?.[pid]; if (!sp?.team) return "";
  const grp = DEPTH_GROUP[sp.depth_chart_position], order = Number(sp.depth_chart_order);
  if (!grp || grp !== sp.position || !order) return "Not on the depth chart";
  const val = id => S.assets?.get("p:" + id)?.value || 0;
  const mates = Object.entries(S.sleeperPlayers).filter(([, p]) => p.team === sp.team && p.position === grp && DEPTH_GROUP[p.depth_chart_position] === grp && Number(p.depth_chart_order))
    .sort(([ia, a], [ib, b]) => Number(a.depth_chart_order) - Number(b.depth_chart_order) || val(ib) - val(ia) || ia.localeCompare(ib));
  const n = mates.findIndex(([id]) => id === String(pid)) + 1;
  if (!n) return "";
  const spot = { SWR: "slot", LWR: "outside", RWR: "outside" }[sp.depth_chart_position];
  return `${grp}${n}${spot ? " · " + spot : ""}`;
}

// Depth chart move since last week ("up from WR3 last week"), from the daily data update
function depthMoveText(pid){
  const was = cardData?.players?.[pid]?.dm, now = depthChartText(pid).split(" ")[0];
  if (!was || !now || was === now) return "";
  const n = x => parseInt(String(x).replace(/\D/g, "")) || 99;
  return `${n(now) < n(was) ? "up" : "down"} from ${was} last week`;
}
// Sleeper trending chip for the card header
function trendChip(pid){
  const n = S.trending?.get(String(pid)); if (!n || Math.abs(n) < TREND_MIN) return "";
  return `<span class="pc-tag ${n > 0 ? "h" : "o"}" title="Sleeper leagues adding him minus dropping him, last 24 hours">${n > 0 ? "Trending ▲" : "Dropping ▼"} ${fmt(Math.abs(n))}</span>`;
}
// Usage over the last weeks played vs. the season: snap share, share of team targets + carries, touches per game
function usageBlock(u){
  if (!u) return `<p class="empty">Usage appears during the season, after a few games.</p>`;
  const [snap, snapS, share, shareS, tpg, n] = u, p = x => x == null ? "–" : Math.round(x * 100) + "%";
  const arrow = (a, b) => a == null || b == null || Math.abs(a - b) < 0.05 ? "" : a > b ? ` <span class="up">▲ ${Math.round((a - b) * 100)}</span>` : ` <span class="down">▼ ${Math.round((b - a) * 100)}</span>`;
  return `<div class="pc-scroll"><table class="pc-use"><thead><tr><th class="l">Share of his team's…</th><th>Last ${n || 3} weeks</th><th>Season</th></tr></thead><tbody>
    <tr><td class="l">Offensive snaps</td><td>${p(snap)}${arrow(snap, snapS)}</td><td>${p(snapS)}</td></tr>
    <tr><td class="l">Targets + carries</td><td>${p(share)}${arrow(share, shareS)}</td><td>${p(shareS)}</td></tr>
    <tr><td class="l">Touches per game</td><td>${tpg != null ? tpg.toFixed(1) : "–"}</td><td></td></tr>
  </tbody></table></div><p class="pc-note">Arrows show a change of 5 points or more vs. his season. From Sleeper's weekly stats.</p>`;
}
// ---------- Value history ----------
// data/value-history.json holds every player's spot on the Front Office Rankings each day they changed
// (saved by the data update). Each spot is turned into a value the same way today's value is, with
// this league's adjustments, so the last point matches the value at the top of the card.
const VALUE_HISTORY = "data/value-history.json";
let vhLoad = null;
function loadValueHistory(){
  if (!vhLoad) vhLoad = fetch(VALUE_HISTORY + "?v=" + Math.floor(Date.now() / 6e5), { cache: "no-store" })
    .then(r => r.ok ? r.json() : null).catch(() => null).then(d => { if (!d) vhLoad = null; return d; });
  return vhLoad;
}
const VH_RANGES = [["3m", "3 months", 92], ["1y", "1 year", 366], ["all", "All", 1e9]];
let vhRange = "all";
function valueHistoryPoints(a, vh){
  if (!a || a.kind !== "player" || !vh?.dates?.length) return [];
  const ranks = vh[S.cfg?.superflex ? "sf" : "1qb"]?.[normName(a.name) + "|" + a.pos] || [];
  const adj = a.base ? a.value / a.base : 1;               // this league's adjustments, as they stand today
  const pts = vh.dates.map((d, i) => ({ t: Date.parse(d + "T12:00:00"), r: ranks[i] || 0 }))
    .filter(p => p.r > 0).map(p => ({ t: p.t, v: Math.round(marketCurve(p.r) * adj), r: p.r }));
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const last = pts[pts.length - 1];
  if (last && new Date(last.t).toDateString() === today.toDateString()) pts.pop();
  pts.push({ t: today.getTime(), v: Math.round(a.value), r: a.mRank, now: true });
  return pts;
}
function valueHistoryBlock(a, vh){
  if (!a || a.kind !== "player") return "";
  const all = valueHistoryPoints(a, vh), days = VH_RANGES.find(x => x[0] === vhRange)[2];
  const from = Date.now() - days * 864e5, pts = all.filter((p, i) => p.t >= from || i === all.length - 1);
  const since = vh?.dates?.[0] ? dateText(vh.dates[0]) : dateText(new Date().toISOString().slice(0, 10));
  if (all.length < 2) return `<p class="empty">Value history is just getting started. Front Office saves a snapshot every time the rankings change (the first was ${esc(since)}), so his chart fills in from there. Today: <b>${fmt(Math.round(a.value))}</b>.</p>`;
  if (pts.length < 2) pts.splice(0, pts.length, ...all.slice(-2));
  const phone = matchMedia("(max-width:600px)").matches, W = phone ? 340 : 600, H = phone ? 190 : 170, L = 52, R = 10, T = 14, B = 26;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t, vs = pts.map(p => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs); const pad = Math.max(50, (hi - lo) * 0.12); lo = Math.max(0, lo - pad); hi += pad;
  const x = t => L + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (W - L - R), y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  // a step line: his value holds until the rankings next change
  let d = `M${x(pts[0].t).toFixed(1)},${y(pts[0].v).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += `H${x(pts[i].t).toFixed(1)}V${y(pts[i].v).toFixed(1)}`;
  const first = pts[0], now = pts[pts.length - 1], ch = now.v - first.v, pc = first.v ? Math.round(ch / first.v * 100) : 0;
  const peak = pts.reduce((m, p) => p.v > m.v ? p : m, pts[0]), low = pts.reduce((m, p) => p.v < m.v ? p : m, pts[0]);
  const ticks = [hi - pad, (hi + lo) / 2, lo + pad].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="vh-grid"/><text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmt(Math.round(v / 10) * 10)}</text>`).join("");
  const dots = pts.map(p => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${p.now ? 4.5 : 3}" class="${p.now ? "vh-now" : "vh-dot"}"><title>${esc(p.now ? "Today" : dateText(new Date(p.t).toISOString().slice(0, 10)))}: ${fmt(p.v)}${p.r ? ` (#${p.r} on the rankings)` : ""}</title></circle>`).join("");
  const dl = t => new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: t1 - t0 > 300 * 864e5 ? "numeric" : undefined });
  return `<div class="vh">
    <div class="vh-top"><p class="vh-sum">${ch === 0 ? "No change" : `<b class="${ch > 0 ? "up" : "down"}">${ch > 0 ? "▲ Up" : "▼ Down"} ${fmt(Math.abs(ch))}${pc ? ` (${ch > 0 ? "+" : ""}${pc}%)` : ""}</b>`} since ${esc(dl(first.t))}${peak.v > now.v ? ` · peak ${fmt(peak.v)} on ${esc(dl(peak.t))}` : ""}${low.v < now.v && low !== first ? ` · low ${fmt(low.v)}` : ""}</p>
      ${all.length > 2 && all[0].t < Date.now() - 92 * 864e5 ? `<div class="vh-range" role="group" aria-label="Time range">${VH_RANGES.map(([k, l]) => `<button type="button" data-vh="${k}" aria-pressed="${vhRange === k}">${l}</button>`).join("")}</div>` : ""}</div>
    <svg class="vh-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Value over time: ${fmt(first.v)} on ${esc(dl(first.t))}, ${fmt(now.v)} today">
      ${ticks}<path d="${d}" class="vh-line"/>${dots}
      <text x="${L}" y="${H - 6}" class="vh-x">${esc(dl(t0))}</text><text x="${W - R}" y="${H - 6}" text-anchor="end" class="vh-x">Today</text>
    </svg></div>
    <p class="pc-note">His value in your league each time the Front Office Rankings changed, using your league's settings as they are today. ${matchMedia("(hover:none)").matches ? "Tap" : "Hover over"} a dot for the date and value.</p>`;
}
// ---------- Game log and usage history (week by week, from Sleeper) ----------
const PC_TABS = [["status", "Current Status", "Status"], ["proj", "Projections", "Proj"], ["log", "Game Log", "Games"], ["career", "Career Stats", "Career"], ["usage", "Usage", "Usage"], ["value", "Value History", "Value"], ["trades", "Trade History", "Trades"]];   // [key, label, short label for phones]
const PC = { pid: null, pos: "", tab: "status", season: null, seasons: null };
const weekCache = new Map();
async function sleeperWeeks(pid, season){
  const k = pid + "|" + season;
  if (weekCache.has(k)) return weekCache.get(k);
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`https://api.sleeper.com/stats/nfl/player/${encodeURIComponent(pid)}?season_type=regular&season=${season}&grouping=week`, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const d = await r.json();
    const list = Array.isArray(d) ? d.map(e => [e?.week, e]) : Object.entries(d || {});
    const rows = list.map(([wk, e]) => e && e.stats ? { wk: Number(e.week ?? wk), opp: e.opponent || "", team: e.team || "", st: e.stats } : null)
      .filter(x => x && x.wk >= 1 && x.wk <= 18).sort((x, y) => x.wk - y.wk);
    weekCache.set(k, rows);
    return rows;
  } catch(e){ return null; }
}
// Fantasy points under THIS league's scoring: every scoring rule times his matching stat
function leaguePoints(st, pos){
  const sc = S.league?.scoring_settings;
  if (!sc) return Number(st.pts_ppr) || 0;
  let t = 0;
  for (const [k, v] of Object.entries(sc)){ const x = Number(st[k]); if (x && Number(v)) t += x * Number(v); }
  const bonus = { TE: "bonus_rec_te", RB: "bonus_rec_rb", WR: "bonus_rec_wr" }[pos];
  if (bonus && Number(sc[bonus]) && st[bonus] == null) t += (Number(st.rec) || 0) * Number(sc[bonus]);   // per-catch bonus by position
  return Math.round(t * 100) / 100;
}
const played = st => Number(st.gp) > 0 || Number(st.off_snp) > 0;
function seasonPicker(){
  const ss = PC.seasons || [];
  if (ss.length < 2) return ss.length ? `<span class="pc-season-one">${ss[0]} season</span>` : "";
  return `<label class="pc-season-lab">Season <select class="pc-season">${ss.map(y => `<option value="${y}"${y === PC.season ? " selected" : ""}>${y}</option>`).join("")}</select></label>`;
}
async function renderWeekPanes(){
  const pid = PC.pid, season = PC.season;
  if (!PC.seasons){ if ($("pcLog")) $("pcLog").innerHTML = `<p class="pc-loading">Loading game log…</p>`; return; }   // filled once career stats load
  if (!PC.seasons.length){
    const none = `<p class="empty">No NFL regular-season games yet.</p>`;
    $("pcLog").innerHTML = none; $("pcUseHist").innerHTML = ""; return;
  }
  const box = PC.tab === "usage" ? $("pcUseHist") : $("pcLog");
  if (box && !box.querySelector("table")) box.innerHTML = `<p class="pc-loading">Loading ${season} games…</p>`;
  const rows = await sleeperWeeks(pid, season);
  if ($("pcard").hidden || PC.pid !== pid || PC.season !== season) return;
  $("pcLog").innerHTML = gameLogTable(rows, PC.pos, season);
  $("pcUseHist").innerHTML = usageHistory(rows, season);
}
function gameLogTable(rows, pos, season){
  if (!rows) return `${seasonPicker()}<p class="empty">The game log isn't available right now. Try again in a minute.</p>`;
  const games = rows.filter(r => played(r.st));
  if (!games.length) return `${seasonPicker()}<p class="empty">No games played in ${season}.</p>`;
  const v = (st, k) => Number(st[k]) || 0, n = x => (x || 0).toLocaleString();
  const C = {
    ca: ["Cmp/Att", st => `${v(st, "pass_cmp")}/${v(st, "pass_att")}`], py: ["Pass Yds", st => n(v(st, "pass_yd"))], ptd: ["Pass TD", st => v(st, "pass_td")], int: ["INT", st => v(st, "pass_int")],
    car: ["Car", st => v(st, "rush_att")], ry: ["Rush Yds", st => n(v(st, "rush_yd"))], rtd: ["Rush TD", st => v(st, "rush_td")],
    tgt: ["Tgt", st => v(st, "rec_tgt")], rec: ["Rec", st => v(st, "rec")], recy: ["Rec Yds", st => n(v(st, "rec_yd"))], rectd: ["Rec TD", st => v(st, "rec_td")],
    fl: ["FL", st => v(st, "fum_lost")]
  };
  const cols = pos === "QB" ? ["ca", "py", "ptd", "int", "car", "ry", "rtd", "fl"]
             : pos === "RB" ? ["car", "ry", "rtd", "tgt", "rec", "recy", "rectd", "fl"]
             : ["tgt", "rec", "recy", "rectd", "car", "ry", "fl"];
  const pts = games.map(g => leaguePoints(g.st, pos)), best = Math.max(...pts), total = pts.reduce((a, b) => a + b, 0);
  const tot = {}; for (const g of games) for (const [k, x] of Object.entries(g.st)) tot[k] = (tot[k] || 0) + (Number(x) || 0);
  const byWeek = new Map(rows.map(r => [r.wk, r]));
  const last = Math.max(...rows.map(r => r.wk));
  const lines = [];
  for (let w = 1; w <= last; w++){
    const g = byWeek.get(w);
    if (!g || !played(g.st)){ lines.push(`<tr class="pc-dnp"><td>${w}</td><td class="l">${g?.opp ? esc(g.opp) : ""}</td><td colspan="${cols.length + 2}" class="l">${g ? "Did not play" : "Bye or no game"}</td></tr>`); continue; }
    const p = leaguePoints(g.st, pos), snap = g.st.tm_off_snp ? Math.round(g.st.off_snp / g.st.tm_off_snp * 100) + "%" : "–";
    lines.push(`<tr><td>${w}</td><td class="l">${g.opp ? esc(g.opp) : "–"}</td>${cols.map(k => `<td>${C[k][1](g.st)}</td>`).join("")}<td>${snap}</td><td class="pc-pts${p === best && games.length > 1 ? " best" : ""}">${p.toFixed(1)}</td></tr>`);
  }
  return `<div class="pc-log-top">${seasonPicker()}<p class="pc-log-sum"><b>${total.toFixed(1)}</b> points in ${games.length} game${games.length > 1 ? "s" : ""} · <b>${(total / games.length).toFixed(1)}</b> per game · best ${best.toFixed(1)}</p></div>
    <div class="pc-scroll"><table class="pc-log"><thead><tr><th>Wk</th><th class="l">Opp</th>${cols.map(k => `<th>${C[k][0]}</th>`).join("")}<th>Snap %</th><th>Pts</th></tr></thead>
    <tbody>${lines.join("")}<tr class="tot"><td colspan="2" class="l">Total</td>${cols.map(k => `<td>${C[k][1](tot)}</td>`).join("")}<td>${tot.tm_off_snp ? Math.round(tot.off_snp / tot.tm_off_snp * 100) + "%" : "–"}</td><td class="pc-pts">${total.toFixed(1)}</td></tr></tbody></table></div>
    <p class="pc-note">Points use your league's scoring settings. Week-by-week stats from Sleeper, regular season only.</p>`;
}
// Usage history: snap share each week as bars, with targets, carries and touches underneath
function usageHistory(rows, season){
  if (!rows) return "";
  const games = rows.filter(r => played(r.st));
  if (!games.length) return "";
  const v = (st, k) => Number(st[k]) || 0;
  const W = Math.max(games.length * 34, 280), H = 120, top = 16, base = 96;
  const bars = games.map((g, i) => {
    const sh = g.st.tm_off_snp ? v(g.st, "off_snp") / v(g.st, "tm_off_snp") : null, h = sh == null ? 0 : sh * (base - top), x = i * 34 + 6;
    return `<g><rect x="${x}" y="${(base - h).toFixed(1)}" width="22" height="${h.toFixed(1)}" rx="3" class="uh-bar"><title>Week ${g.wk}: ${sh == null ? "snaps not reported" : Math.round(sh * 100) + "% of snaps"}</title></rect>
      <text x="${x + 11}" y="${(base - h - 4).toFixed(1)}" text-anchor="middle" class="uh-val">${sh == null ? "" : Math.round(sh * 100)}</text><text x="${x + 11}" y="${base + 16}" text-anchor="middle" class="uh-wk">${g.wk}</text></g>`;
  }).join("");
  const row = (label, f) => `<tr><td class="l">${label}</td>${games.map(g => `<td>${f(g.st)}</td>`).join("")}</tr>`;
  return `<h4 class="pc-h4">Week by week · ${season} ${seasonPicker()}</h4>
    <div class="pc-scroll"><svg class="uh-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Snap share by week">${bars}</svg></div>
    <p class="pc-note" style="margin-top:2px">Bars: share of his team's offensive snaps each week (%).</p>
    <div class="pc-scroll"><table class="pc-uh"><thead><tr><th class="l">Week</th>${games.map(g => `<th>${g.wk}</th>`).join("")}</tr></thead><tbody>
      ${row("Snaps", st => st.off_snp != null ? v(st, "off_snp") : "–")}
      ${row("Targets", st => v(st, "rec_tgt"))}
      ${row("Carries", st => v(st, "rush_att"))}
      ${row("Touches", st => v(st, "rush_att") + v(st, "rec"))}
      ${PC.pos === "QB" ? row("Pass att", st => v(st, "pass_att")) : ""}
    </tbody></table></div>`;
}
// ---------- Trade history: this league's trades that included him ----------
// Includes trades of a draft pick that was later used on him ("pick used on him").
function playerTradesBlock(pid){
  const H = S.history;
  if (!H) return `<p class="pc-loading">${S.historyError ? "Your league's trades couldn't be loaded. Reopen the league to try again." : "Loading your league's trades…"}</p>`;
  const pickOn = it => it.kind === "pick" && String(H.pickResult.get(`${it.season}-${it.round}-${it.orig}`)?.pid || "") === String(pid);
  const isHim = it => (it.kind === "player" && String(it.pid) === String(pid)) || pickOn(it);
  const trades = H.trades.filter(t => t.sides.some(sd => sd.gets.some(isHim)))
    .sort((a, b) => b.created - a.created).map(t => ({ t, g: gradeTrade(t) }));
  if (!trades.length) return `<p class="empty">He hasn't been part of a trade in your league${H.seasons?.length > 1 ? ` since ${H.seasons[H.seasons.length - 1]}` : ""}.</p>`;
  const tag = x => x.result === "won" ? `<span class="verdict-tag v-won">Won by ${fmt(x.margin)}</span>` : x.result === "lost" ? `<span class="verdict-tag v-lost">Lost by ${fmt(-x.margin)}</span>` : `<span class="verdict-tag v-even">Even</span>`;
  const n = trades.length, viaPick = trades.filter(({ t }) => !t.sides.some(sd => sd.gets.some(it => it.kind === "player" && String(it.pid) === String(pid)))).length;
  return `<p class="pc-log-sum" style="margin:0 0 12px">Traded <b>${n}</b> time${n > 1 ? "s" : ""} in your league${viaPick ? ` (${viaPick} as the draft pick later used on him)` : ""}. Newest first; graded with today's values.</p>
    <div class="pc-trades">${trades.map(({ t, g }) => {
      const sides = [...g.sides].sort((x, y) => (t.sides.find(s => s.rid === y.rid).gets.some(isHim)) - (t.sides.find(s => s.rid === x.rid).gets.some(isHim)));
      return `<article class="trade">
        <div class="trade-head"><span>${fmtDate(t.created)}</span><span>${t.season} season${t.sides.length > 2 ? `, ${t.sides.length}-team trade` : ""}</span></div>
        <div class="trade-sides">${sides.map(x => {
          const raw = t.sides.find(s => s.rid === x.rid), got = raw.gets.some(isHim);
          return `<div class="tside${got ? " focus" : ""}">
            <div class="tside-head">${avatar(x.photo, x.name, "md")}<span class="nm"><b>${esc(x.name)}</b><small>${got ? "Got him" : "Received"}</small></span>${tag(x)}</div>
            ${x.items.map((i, k) => { const me = String(i.photoPid || "") === String(pid);
              return `<div class="titem${me ? " me" : ""}">${i.photoPid ? avatar(PLAYER_IMG(i.photoPid), i.usedOn || i.name, "sm") : ""}<span class="tn">${esc(i.name)}${me ? `<span class="pc-me">This player</span>` : ""}<small class="${i.usedOn ? "used" : ""}">${esc(i.sub)}</small></span><span class="tv">${fmt(i.value)}</span></div>`; }).join("") || `<div class="titem"><span class="tn">Nothing but FAAB</span></div>`}
            ${x.faab ? `<div class="titem"><span class="tn">$${x.faab} FAAB<small>Not valued</small></span><span class="tv">–</span></div>` : ""}
          </div>`; }).join("")}</div></article>`; }).join("")}</div>`;
}
// ---------- School logo (College on the card) ----------
// ESPN's college football team list gives each school's logo; Sleeper gives the college's name.
let schoolsLoad = null;
const schoolKey = n => String(n || "").toLowerCase().replace(/&/g, "and").replace(/\buniv(ersity)?\b|\bof\b|\bthe\b|\bstate\b/g, m => m.includes("state") ? "st" : "").replace(/\bst\b\.?/g, "st").replace(/[^a-z0-9]/g, "");
const SCHOOL_ALIAS = { "southern california": "USC", "mississippi": "Ole Miss", "louisiana state": "LSU", "central florida": "UCF", "brigham young": "BYU", "texas christian": "TCU",
  "southern methodist": "SMU", "alabama-birmingham": "UAB", "alabama birmingham": "UAB", "north carolina state": "NC State", "florida international": "FIU", "nevada-las vegas": "UNLV",
  "miami (fl)": "Miami", "miami (fla.)": "Miami", "miami fl": "Miami", "texas-el paso": "UTEP", "texas-san antonio": "UTSA", "louisiana-lafayette": "Louisiana", "louisiana-monroe": "UL Monroe",
  "massachusetts": "UMass", "connecticut": "UConn", "pittsburgh": "Pitt", "middle tennessee state": "Middle Tennessee", "western kentucky": "Western Kentucky", "hawaii": "Hawai'i", "san jose state": "San José State" };
function loadSchools(){
  if (!schoolsLoad) schoolsLoad = fetch("https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000")
    .then(r => r.ok ? r.json() : null).then(d => {
      const m = new Map(), teams = d?.sports?.[0]?.leagues?.[0]?.teams || [];
      for (const { team: t } of teams){
        const logo = t?.logos?.[0]?.href; if (!logo) continue;
        for (const n of [t.location, t.shortDisplayName, t.nickname, t.abbreviation, t.displayName]) { const k = schoolKey(n); if (k && !m.has(k)) m.set(k, logo); }
      }
      if (!m.size) schoolsLoad = null;
      return m;
    }).catch(() => { schoolsLoad = null; return new Map(); });
  return schoolsLoad;
}
// ESPN's logo number for the schools most NFL players come from, so their logos show without
// waiting on (or depending on) ESPN's team list
const SCHOOL_IDS = { "Alabama": 333, "Georgia": 61, "Ohio State": 194, "Michigan": 130, "LSU": 99, "Clemson": 228, "Oklahoma": 201, "USC": 30, "Florida": 57,
  "Notre Dame": 87, "Penn State": 213, "Oregon": 2483, "Auburn": 2, "Tennessee": 2633, "Texas": 251, "Texas A&M": 245, "Florida State": 52, "Miami": 2390,
  "Wisconsin": 275, "Iowa": 2294, "Washington": 264, "Utah": 254, "TCU": 2628, "Ole Miss": 145, "Arkansas": 8, "Kentucky": 96, "South Carolina": 2579,
  "Missouri": 142, "Nebraska": 158, "Minnesota": 135, "Purdue": 2509, "Michigan State": 127, "UCLA": 26, "Stanford": 24, "California": 25, "Arizona": 12,
  "Arizona State": 9, "Colorado": 38, "Boise State": 68, "BYU": 252, "Pitt": 221, "Virginia Tech": 259, "North Carolina": 153, "Louisville": 97, "Baylor": 239,
  "Texas Tech": 2641, "Oklahoma State": 197, "West Virginia": 277, "Iowa State": 66, "Kansas State": 2306, "Kansas": 2305, "Mississippi State": 344,
  "Vanderbilt": 238, "Illinois": 356, "Indiana": 84, "Northwestern": 77, "Maryland": 120, "Rutgers": 164, "Duke": 150, "NC State": 152, "Georgia Tech": 59,
  "Syracuse": 183, "Boston College": 103, "Wake Forest": 154, "Virginia": 258, "Oregon State": 204, "Washington State": 265, "Cincinnati": 2132, "UCF": 2116,
  "Houston": 248, "SMU": 2567, "Memphis": 235, "Tulane": 2655 };
const schoolIdLogo = name => { const k = schoolKey(name), hit = Object.entries(SCHOOL_IDS).find(([n]) => schoolKey(n) === k); return hit ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${hit[1]}.png` : ""; };
async function schoolLogo(college){
  if (!college) return "";
  const alias = SCHOOL_ALIAS[college.toLowerCase().trim()], name = alias || college, bare = college.replace(/\s*\(.*\)\s*/, "");
  const known = schoolIdLogo(name);   // (not the bare name: "Miami (OH)" is not Miami)
  if (known) return known;
  const m = await loadSchools();
  return m.get(schoolKey(name)) || m.get(schoolKey(bare)) || "";
}
// ---------- Projections: this week, the rest of the season, and the full season, in this league's scoring ----------
const projCache = new Map();
async function sleeperProjWeeks(pid, season){
  const k = pid + "|" + season;
  if (projCache.has(k)) return projCache.get(k);
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`https://api.sleeper.com/projections/nfl/player/${encodeURIComponent(pid)}?season_type=regular&season=${season}&grouping=week`, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const d = await r.json();
    const list = Array.isArray(d) ? d.map(e => [e?.week, e]) : Object.entries(d || {});
    const rows = list.map(([wk, e]) => e && e.stats ? { wk: Number(e.week ?? wk), opp: e.opponent || "", st: e.stats } : null)
      .filter(x => x && x.wk >= 1 && x.wk <= 18).sort((x, y) => x.wk - y.wk);
    projCache.set(k, rows);
    return rows;
  } catch(e){ return null; }
}
async function renderProjections(){
  const pid = PC.pid, pos = PC.pos, a = S.assets?.get("p:" + pid), sp = S.sleeperPlayers?.[pid] || {};
  const season = liveSeasonYear(), inSeason = S.nflState?.season_type === "regular", wk = inSeason ? currentWeek() : 0;
  const lastReg = Math.min(18, (Number(S.league?.settings?.playoff_week_start) || 15) - 1), lastFantasy = lastFantasyWeek();
  const [proj, played] = await Promise.all([sleeperProjWeeks(pid, season), inSeason ? sleeperWeeks(pid, season) : Promise.resolve(null)]);
  if ($("pcard").hidden || PC.pid !== pid) return;
  const out = seasonOutlook(pid), st = sp.injury_status;
  // a player ruled out (or on IR) is projected at 0 until Front Office's estimated return
  const backWk = out?.done ? 99 : out?.back || 0;
  const availNote = w => st && ["Out", "IR", "PUP", "NFI", "Sus"].includes(st) && w < Math.max(wk + 1, backWk) ? (st === "Sus" ? "Suspended" : "Expected out") : "";
  const ahead = (proj || []).filter(r => r.wk >= Math.max(1, wk) && r.wk <= lastFantasy).map(r => ({ ...r, pts: availNote(r.wk) ? 0 : leaguePoints(r.st, pos), note: availNote(r.wk) }));
  const thisWeek = ahead.find(r => r.wk === wk);
  const rest = ahead.filter(r => r.wk <= lastReg).reduce((t, r) => t + r.pts, 0), restN = ahead.filter(r => r.wk <= lastReg).length;
  const pjStats = pj => Object.fromEntries(["pass_yd", "pass_td", "pass_int", "rush_yd", "rush_td", "rec", "rec_yd", "rec_td", "fum_lost"].map((k, i) => [k, Number(pj[i]) || 0]));
  const fo = a?.pj ? leaguePoints(pjStats(a.pj), pos) : null;   // same scoring as the weekly numbers
  const games = (played || []).filter(r => played && (Number(r.st.gp) > 0 || Number(r.st.off_snp) > 0)), soFar = games.reduce((t, g) => t + leaguePoints(g.st, pos), 0);
  const tile = (label, big, sub) => `<div class="pj-tile"><small>${label}</small><b>${big}</b>${sub ? `<span>${sub}</span>` : ""}</div>`;
  const tiles = [
    inSeason ? tile(`This week${wk ? " · Wk " + wk : ""}`, thisWeek ? thisWeek.pts.toFixed(1) : "–", thisWeek ? (thisWeek.note || (thisWeek.opp ? "vs " + esc(thisWeek.opp) : "")) : proj ? "Bye or no projection" : "Not available right now") : "",
    inSeason && restN ? tile("Rest of regular season", rest.toFixed(0), `${restN} game${restN > 1 ? "s" : ""}, ${(rest / restN).toFixed(1)} per game`) : "",
    fo != null ? tile("Full season (Front Office)", fo.toFixed(0), `${(fo / 17).toFixed(1)} per game over 17 games`) : "",
    games.length ? tile("Scored so far", soFar.toFixed(1), `${(soFar / games.length).toFixed(1)} per game in ${games.length} game${games.length > 1 ? "s" : ""}`) : ""
  ].join("");
  const v = (x, k) => Number(x[k]) || 0;
  const line = r => pos === "QB" ? `${v(r.st, "pass_yd").toFixed(0)} pass yds, ${v(r.st, "pass_td").toFixed(1)} TD, ${v(r.st, "rush_yd").toFixed(0)} rush yds`
    : pos === "RB" ? `${v(r.st, "rush_att").toFixed(1)} car, ${v(r.st, "rush_yd").toFixed(0)} rush yds, ${v(r.st, "rec").toFixed(1)} rec, ${(v(r.st, "rush_td") + v(r.st, "rec_td")).toFixed(1)} TD`
    : `${v(r.st, "rec_tgt").toFixed(1)} tgt, ${v(r.st, "rec").toFixed(1)} rec, ${v(r.st, "rec_yd").toFixed(0)} yds, ${v(r.st, "rec_td").toFixed(1)} TD`;
  const table = ahead.length ? `<h4 class="pc-h4">Week by week</h4><div class="pc-scroll"><table class="pc-proj"><thead><tr><th>Wk</th><th class="l">Opp</th><th class="l">Projected stats</th><th>Pts</th></tr></thead><tbody>
    ${(() => { const rows = []; const by = new Map(ahead.map(r => [r.wk, r])); for (let w = ahead[0].wk; w <= ahead[ahead.length - 1].wk; w++) rows.push(by.get(w) || { wk: w, bye: true }); return rows; })().map(r => r.bye ? `<tr class="pc-dnp"><td>${r.wk}</td><td class="l"></td><td class="l" colspan="2">Bye</td></tr>` : `<tr class="${r.wk === wk ? "now" : ""}${r.wk > lastReg ? " po" : ""}"><td>${r.wk}</td><td class="l">${esc(r.opp || "–")}</td><td class="l">${r.note ? `<i>${esc(r.note)}</i>` : line(r)}</td><td class="pc-pts">${r.pts.toFixed(1)}</td></tr>`).join("")}
    </tbody></table></div>` : "";
  $("pcProj").innerHTML = `${tiles ? `<div class="pj-tiles">${tiles}</div>` : `<p class="empty">No projections for him right now.</p>`}${table}
    <p class="pc-note">All points use your league's scoring settings. Weekly projections from Sleeper${ahead.some(r => r.wk > lastReg) ? "; shaded weeks are your fantasy playoffs" : ""}. The full-season number is from the Front Office Rankings projections. Players ruled out count 0 until Front Office's estimated return.</p>`;
}
async function openPlayerCard(pid){
  const sp = S.sleeperPlayers?.[pid] || {}, a = S.assets?.get("p:" + pid);
  const name = a?.name || sp.full_name || `${sp.first_name || ""} ${sp.last_name || ""}`.trim() || "Player";
  const pos = a?.pos || sp.position || "", team = sp.team || "";
  const lab = INJ_LABEL[sp.injury_status];
  const owner = a?.owner != null ? S.teams.get(a.owner)?.name : "Free agent";
  const facts = [
    ["Age", (() => { const ag = a?.age || Number(sp.age) || 0, c = CLIFF[pos]; return ag ? `${ageText(ag)}${c && ag >= c ? ` · past the usual ${pos} age cliff (${c})` : c && ag >= c - 1 ? ` · nearing the ${pos} age cliff (${c})` : ""}` : ""; })()], ["Height", heightText(sp.height)], ["Weight", sp.weight ? sp.weight + " lb" : ""],
    ["College", sp.college], ["Experience", expText(sp.years_exp)], ["Depth chart", [depthChartText(pid), depthMoveText(pid), a?.starterLift > 0 ? `value lifted +${fmt(Math.round(a.starterLift))} while he starts` : ""].filter(Boolean).join(" · ")], ["Fantasy team", owner]
  ].filter(f => f[1] !== undefined && f[1] !== null && f[1] !== "");
  $("pcard").innerHTML = `<div class="pc" role="dialog" aria-modal="true" aria-labelledby="pcName">
    <button type="button" class="pc-close" aria-label="Close player card">×</button>
    <header class="pc-head">
      <div class="pc-photo${currentTeam(pid) ? " tm" : ""}" style="${teamBgStyle(currentTeam(pid))}">${FOOTBALL}<img src="https://sleepercdn.com/content/nfl/players/${encodeURIComponent(pid)}.jpg" alt="" onerror="this.remove()"></div>
      <div class="pc-id"><h2 id="pcName">${esc(name)}</h2>
        <div class="pc-sub"><span>${esc(pos)}${sp.number ? " · #" + esc(sp.number) : ""}</span>
          ${team ? `<span><img src="https://sleepercdn.com/images/team_logos/nfl/${esc(team.toLowerCase())}.png" alt="" onerror="this.remove()"> ${esc(NFL_TEAMS[team] || team)}</span>` : `<span>Free agent</span>`}
          <span class="pc-tag ${lab ? lab[1] : sp.injury_status ? "o" : "h"}">${esc(lab ? lab[0] : sp.injury_status || "Healthy")}</span>${trendChip(pid)}</div></div>
      ${a ? `<div class="pc-val"><b>${fmt(a.value)}</b><small>${[a.lgPosRank ? pos + a.lgPosRank : "", a.lgRank ? "#" + a.lgRank + " overall" : ""].filter(Boolean).join(" · ")} in your league</small></div>` : ""}
    </header>
    <div class="pc-body">
      <dl class="pc-facts">${facts.map(([k, v]) => `<div${k === "Fantasy team" || k === "College" ? ' class="wide"' : ""}><dt>${esc(k)}</dt><dd>${k === "Fantasy team" && a?.owner != null ? `<span class="pc-ft">${teamPhoto(a.owner, "sm")}${esc(v)}</span>` : esc(v)}</dd></div>`).join("")}</dl>
      <div class="pc-tabs" role="tablist" aria-label="Player details">${PC_TABS.filter(([k]) => k !== "value" || a).map(([k, l, sh], i) => `<button type="button" role="tab" data-pctab="${k}" aria-selected="${i === 0}" aria-label="${l}"><span class="t-full">${l}</span><span class="t-short">${sh}</span></button>`).join("")}</div>
      <section class="pc-pane" data-pane="status"><div id="pcNow">${currentStatus(sp)}</div><p class="pc-note">Current status from Sleeper.</p></section>
      <section class="pc-pane" data-pane="proj" hidden><div id="pcProj"><p class="pc-loading">Loading projections…</p></div></section>
      <section class="pc-pane" data-pane="log" hidden><div id="pcLog"><p class="pc-loading">Loading game log…</p></div></section>
      <section class="pc-pane" data-pane="career" hidden><div id="pcStats"><p class="pc-loading">Loading stats…</p></div><p class="pc-note">Career stats from Sleeper. Regular season only. Fantasy points here use standard full-PPR scoring; the Game Log uses your league's scoring.</p></section>
      <section class="pc-pane" data-pane="usage" hidden><div id="pcUse"><p class="pc-loading">Loading usage…</p></div><div id="pcUseHist"></div></section>
      <section class="pc-pane" data-pane="trades" hidden><div id="pcTrades"></div></section>
      ${a ? `<section class="pc-pane" data-pane="value" hidden><div id="pcHist"><p class="pc-loading">Loading value history…</p></div></section>` : ""}
    </div></div>`;
  if (sp.college) schoolLogo(sp.college).then(src => {
    if (!src || $("pcard").hidden || PC.pid !== pid) return;
    const dt = [...$("pcard").querySelectorAll(".pc-facts dt")].find(x => x.textContent === "College");
    if (dt && !dt.nextElementSibling.querySelector("img")) dt.nextElementSibling.insertAdjacentHTML("afterbegin", `<img class="pc-school" src="${esc(src)}" alt="" onerror="this.remove()">`);
  });
  PC.pid = pid; PC.pos = pos; PC.tab = "status"; PC.season = null; PC.seasons = null;
  $("pcard").hidden = false; document.body.style.overflow = "hidden";
  $("pcard").querySelector(".pc-close").focus();
  if (a) loadValueHistory().then(vh => { const box = $("pcHist"); if (box && !$("pcard").hidden){ box.innerHTML = valueHistoryBlock(a, vh); box.dataset.pid = pid; } });
  const [data, live] = await Promise.all([loadCardData(), liveCareer(pid, sp)]);
  if ($("pcard").hidden) return;
  const rec0 = data ? cardRecord(pid) : null;
  // every season Sleeper answered live; the daily file fills any season it didn't
  const bySeason = new Map();
  (rec0?.s || []).forEach(r => { if (!live.okYears?.has(r[0])) bySeason.set(r[0], r); });
  live.rows.forEach(r => bySeason.set(r[0], r));
  const rec = { s: [...bySeason.values()].sort((x, y) => x[0] - y[0]), i: rec0?.i || [] };
  const season = liveSeasonYear();
  $("pcStats").innerHTML = data || live.ok ? statsTable(rec, pos, season) : `<p class="empty">Stats aren't available right now. Try again in a minute.</p>`;
  $("pcNow").innerHTML = currentStatus(sp, { ...rec, c: rec0?.c }, rec0?.n || []);
  $("pcUse").innerHTML = usageBlock(rec0?.u);
  PC.seasons = [...new Set([...rec.s.filter(r => r[2] > 0).map(r => r[0]), ...(S.nflState?.season_type === "regular" ? [season] : [])])].sort((x, y) => y - x);
  if (!PC.seasons.includes(PC.season)) PC.season = PC.seasons[0] || season;
  if (PC.tab === "log" || PC.tab === "usage") renderWeekPanes();
  const dm = depthMoveText(pid); if (dm){ const dd = [...$("pcard").querySelectorAll(".pc-facts dt")].find(x => x.textContent === "Depth chart"); if (dd && !dd.nextElementSibling.textContent.includes(dm)) dd.nextElementSibling.textContent += " · " + dm; }
}
function closePlayerCard(){ $("pcard").hidden = true; $("pcard").innerHTML = ""; document.body.style.overflow = ""; }
// Capture phase, so tapping a photo inside a roster row opens the card instead of adding him to a trade
document.addEventListener("click", e => {
  const ph = e.target.closest(".av.pl[data-pid]");
  if (ph && !e.target.closest("#pcard")){ e.preventDefault(); e.stopPropagation(); openPlayerCard(ph.dataset.pid); }
}, true);
$("pcard").addEventListener("click", e => {
  const t = e.target.closest("[data-pctab]"); if (!t) return;
  PC.tab = t.dataset.pctab;
  for (const b of $("pcard").querySelectorAll("[data-pctab]")) b.setAttribute("aria-selected", b === t);
  for (const pane of $("pcard").querySelectorAll(".pc-pane")) pane.hidden = pane.dataset.pane !== PC.tab;
  if (PC.tab === "log" || PC.tab === "usage") renderWeekPanes();
  if (PC.tab === "trades") $("pcTrades").innerHTML = playerTradesBlock(PC.pid);
  if (PC.tab === "proj") renderProjections();
});
$("pcard").addEventListener("keydown", e => {   // arrow keys move between tabs
  const t = e.target.closest("[data-pctab]"); if (!t || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const all = [...$("pcard").querySelectorAll("[data-pctab]")], n = all[(all.indexOf(t) + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
  n.focus(); n.click();
});
$("pcard").addEventListener("change", e => {
  if (!e.target.classList.contains("pc-season")) return;
  PC.season = Number(e.target.value); renderWeekPanes();
});
$("pcard").addEventListener("click", async e => {
  const b = e.target.closest("[data-vh]"); if (!b) return;
  vhRange = b.dataset.vh; const box = $("pcHist"), a = S.assets?.get("p:" + box?.dataset.pid);
  if (box && a) box.innerHTML = valueHistoryBlock(a, await loadValueHistory());
});
$("pcard").addEventListener("click", e => { if (e.target === $("pcard") || e.target.closest(".pc-close")) closePlayerCard(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("pcard").hidden) closePlayerCard(); });
$("valuesBody").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const tr = e.target.closest("tr[data-id^='p:']"); if (tr){ e.preventDefault(); openPlayerCard(tr.dataset.id.slice(2)); }
});
$("valuesBody").addEventListener("click", e => {
  const tr = e.target.closest("tr[data-id^='p:']"); if (tr) openPlayerCard(tr.dataset.id.slice(2));
});


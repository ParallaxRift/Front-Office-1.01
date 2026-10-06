// Front Office: Player cards: career stats, injuries, status
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// PLAYER CARDS
// Click a player's photo anywhere (or a player row on Player Values) to open his card:
// photo, bio and current injury come from Sleeper; career stats and past injury reports
// come live from Sleeper (backup: data/players.json); injury history comes from FantasyPros via the daily GitHub Action.
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
function injuryTable(rec){
  const rows = rec?.i || [];
  if (!rows.length) return `<p class="empty">No injury report listings on record.</p>`;
  const body = rows.map(r => {
    const wk = r[2] === r[3] ? `Week ${r[2]}` : `Weeks ${r[2]}–${r[3]}`;
    const listed = [r[7] ? `Injured Reserve/PUP ${r[7]}` : "", r[4] ? `Out ${r[4]}` : "", r[5] ? `Doubtful ${r[5]}` : "", r[6] ? `Questionable ${r[6]}` : ""].filter(Boolean).join(", ");
    return `<tr><td>${r[0]}</td><td class="l">${esc(r[1])}</td><td class="l">${wk}</td><td class="l">${listed}</td></tr>`;
  }).join("");
  const outWeeks = rows.reduce((t, r) => t + r[4] + (r[7] || 0), 0);
  return `<div class="pc-scroll"><table><thead><tr><th>Season</th><th class="l">Injury</th><th class="l">When</th><th class="l">Weeks listed</th></tr></thead><tbody>${body}</tbody></table></div>
    <p class="pc-note">${rows.length} injury listing${rows.length > 1 ? "s" : ""}, ${outWeeks} week${outWeeks === 1 ? "" : "s"} missed (Out, IR or PUP). Regular season only.${(cardData?.fp_injury_seasons || []).length ? ` FantasyPros injury reports, ${cardData.fp_injury_seasons[0]}${cardData.fp_injury_seasons.length > 1 ? "–" + cardData.fp_injury_seasons.at(-1) : ""}.` : ""}</p>`;
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
function returnEstimate(sp, news, fpNow){
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
    why.push(`FantasyPros gives him a ${Math.round(prob * 100)}% chance to play this week`);
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
  const conf = why[0]?.startsWith("Reports") ? "Based on reported timeline" : why.some(w => w.startsWith("FantasyPros gives")) ? "Based on FantasyPros' odds" : "Rough estimate";
  return { head, sub, why: why.join("; ") + ".", conf, lo, hi };
}
function currentStatus(sp, rec, news){
  const st = sp?.injury_status, lab = INJ_LABEL[st];
  if (!st && (!sp?.status || sp.status === "Active")) {
    const n = (news || [])[0];
    return `<div class="pc-status"><b>No current injury designation</b><p>Active${sp?.team ? " for the " + esc(NFL_TEAMS[sp.team] || sp.team) : ""}.</p></div>${n ? newsBlock(news) : ""}`;
  }
  const label = lab ? lab[0] : (st || sp.status);
  const cls = lab && lab[1] === "q" ? "warn" : "hurt";
  const sinceT = Date.parse((sp.injury_start_date || "") + "T12:00:00");
  const days = isNaN(sinceT) ? null : Math.max(0, Math.round((Date.now() - sinceT) / 864e5));
  const fp = rec?.c;
  const PRAC = { dnp: "Did not practice", limit: "Limited", limited: "Limited", full: "Full" };
  const pr = x => PRAC[String(x).toLowerCase()] || x;
  const practice = fp?.prac?.length ? fp.prac.map(pr).join(" → ") : [sp.practice_participation, sp.practice_description].filter(Boolean).join(": ");
  const chance = fp && fp.prob !== "" && fp.prob != null && !isNaN(Number(fp.prob)) ? `${Math.round(Number(fp.prob) * 100)}%` : "";
  const part = (sp.injury_body_part || "").toLowerCase();
  const past = part ? (rec?.i || []).filter(r => r[0] < (Number(S.nflState?.season) || 9999) && r[1].toLowerCase().includes(part)).length : 0;
  const thisSeason = (rec?.i || []).filter(r => r[0] === (Number(S.nflState?.season) || 0)).reduce((t, r) => t + r[4] + (r[7] || 0), 0);
  const rows = [
    ["Designation", label], ["Details", sp.injury_notes], ["Chance of playing", chance], ["Team report", fp?.note],
    ["Since", sp.injury_start_date ? `${dateText(sp.injury_start_date)}${days != null ? ` (${days === 0 ? "today" : days === 1 ? "1 day ago" : days + " days ago"})` : ""}` : ""],
    ["Practice this week", practice], ["Missed this season", thisSeason ? `${thisSeason} week${thisSeason > 1 ? "s" : ""}` : ""],
    ["History", past ? `Listed with a ${sp.injury_body_part.toLowerCase()} injury in ${past} earlier season${past > 1 ? "s" : ""}` : ""]
  ].filter(r => r[1]);
  const est = returnEstimate(sp, news, fp);
  return `<div class="pc-status ${cls}"><b>${esc(label)}${sp.injury_body_part ? " · " + esc(sp.injury_body_part) : ""}</b>
    <dl class="pc-inj">${rows.slice(1).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    ${est ? `<div class="pc-est"><small>Estimated time out</small><b>${esc(est.head)}</b>${est.sub ? `<span>${esc(est.sub)}</span>` : ""}<p>${esc(est.conf)}: ${esc(est.why)} This is Front Office's estimate, not a team report.</p></div>` : ""}
  </div>${news?.length ? newsBlock(news) : ""}`;
}
function newsBlock(news){
  return `<div class="pc-news"><small>Latest injury news · FantasyPros</small>${news.slice(0, 3).map(n => `<article><b>${esc(n[1])}</b>${n[2] ? `<p>${esc(n[2])}</p>` : ""}<time>${esc(dateText(n[0]))}</time></article>`).join("")}</div>`;
}
async function openPlayerCard(pid){
  const sp = S.sleeperPlayers?.[pid] || {}, a = S.assets?.get("p:" + pid);
  const name = a?.name || sp.full_name || `${sp.first_name || ""} ${sp.last_name || ""}`.trim() || "Player";
  const pos = a?.pos || sp.position || "", team = sp.team || "";
  const lab = INJ_LABEL[sp.injury_status];
  const owner = a?.owner != null ? S.teams.get(a.owner)?.name : "Free agent";
  const facts = [
    ["Age", a?.age ? ageText(a.age) : sp.age], ["Height", heightText(sp.height)], ["Weight", sp.weight ? sp.weight + " lb" : ""],
    ["College", sp.college], ["Experience", expText(sp.years_exp)], ["Role", a ? roleText(a) : ""], ["Fantasy team", owner]
  ].filter(f => f[1] !== undefined && f[1] !== null && f[1] !== "");
  $("pcard").innerHTML = `<div class="pc" role="dialog" aria-modal="true" aria-labelledby="pcName">
    <button type="button" class="pc-close" aria-label="Close player card">×</button>
    <header class="pc-head">
      <div class="pc-photo${currentTeam(pid) ? " tm" : ""}" style="${teamBgStyle(currentTeam(pid))}">${FOOTBALL}<img src="https://sleepercdn.com/content/nfl/players/${encodeURIComponent(pid)}.jpg" alt="" onerror="this.remove()"></div>
      <div class="pc-id"><h2 id="pcName">${esc(name)}</h2>
        <div class="pc-sub"><span>${esc(pos)}${sp.number ? " · #" + esc(sp.number) : ""}</span>
          ${team ? `<span><img src="https://sleepercdn.com/images/team_logos/nfl/${esc(team.toLowerCase())}.png" alt="" onerror="this.remove()"> ${esc(NFL_TEAMS[team] || team)}</span>` : `<span>Free agent</span>`}
          <span class="pc-tag ${lab ? lab[1] : sp.injury_status ? "o" : "h"}">${esc(lab ? lab[0] : sp.injury_status || "Healthy")}</span></div></div>
      ${a ? `<div class="pc-val"><b>${fmt(a.value)}</b><small>${[a.lgPosRank ? pos + a.lgPosRank : "", a.lgRank ? "#" + a.lgRank + " overall" : ""].filter(Boolean).join(" · ")} in your league</small></div>` : ""}
    </header>
    <div class="pc-body">
      <dl class="pc-facts">${facts.map(([k, v]) => `<div${k === "Fantasy team" || k === "College" ? ' class="wide"' : ""}><dt>${esc(k)}</dt><dd>${k === "Fantasy team" && a?.owner != null ? `<span class="pc-ft">${teamPhoto(a.owner, "sm")}${esc(v)}</span>` : esc(v)}</dd></div>`).join("")}</dl>
      <h3>Current Status</h3><div id="pcNow">${currentStatus(sp)}</div>
      <h3>Career Stats</h3><div id="pcStats"><p class="pc-loading">Loading stats…</p></div>
      <h3>Injury History</h3><div id="pcInj"><p class="pc-loading">Loading injury history…</p></div>
      <p class="pc-note">Current status and career stats from Sleeper. Injury history from FantasyPros, updated daily. Regular season only. Fantasy points use standard full-PPR scoring.</p>
    </div></div>`;
  $("pcard").hidden = false; document.body.style.overflow = "hidden";
  $("pcard").querySelector(".pc-close").focus();
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
  $("pcInj").innerHTML = !data ? `<p class="empty">Injury history isn't available right now. Try again in a minute.</p>`
    : !(data.fp_injury_seasons || []).length ? `<p class="empty">Injury history from FantasyPros will appear after the next daily update.</p>` : injuryTable(rec);
}
function closePlayerCard(){ $("pcard").hidden = true; $("pcard").innerHTML = ""; document.body.style.overflow = ""; }
// Capture phase, so tapping a photo inside a roster row opens the card instead of adding him to a trade
document.addEventListener("click", e => {
  const ph = e.target.closest(".av.pl[data-pid]");
  if (ph && !e.target.closest("#pcard")){ e.preventDefault(); e.stopPropagation(); openPlayerCard(ph.dataset.pid); }
}, true);
$("pcard").addEventListener("click", e => { if (e.target === $("pcard") || e.target.closest(".pc-close")) closePlayerCard(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("pcard").hidden) closePlayerCard(); });
$("valuesBody").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const tr = e.target.closest("tr[data-id^='p:']"); if (tr){ e.preventDefault(); openPlayerCard(tr.dataset.id.slice(2)); }
});
$("valuesBody").addEventListener("click", e => {
  const tr = e.target.closest("tr[data-id^='p:']"); if (tr) openPlayerCard(tr.dataset.id.slice(2));
});


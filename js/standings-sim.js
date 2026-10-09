// Front Office: Standings and the season simulator (League Analysis tab)
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// STANDINGS
// Wins, losses, points for/against and max points come from Sleeper's
// roster settings. "Power" is Front Office's roster-strength rank.
// ============================================================
// Chance to win it all, from the season simulator (background run on league load, or the latest Simulator run)
function titleOddsText(rid){
  const p = S.titleOdds?.odds.get(rid); if (p == null) return "–";
  const v = p * 100; return v >= 99.5 && p < 1 ? ">99%" : v > 0 && v < 0.5 ? "<1%" : Math.round(v) + "%";
}
// Standings sort: which column, and 1 = low to high, -1 = high to low
let standSort = { key: "place", dir: 1 };
const STAND_FIRST_DIR = { place: 1, name: 1, rec: 1, power: 1, stat: 1 };   // everything else starts with the highest first
const STATUS_ORDER = { contend: 0, middle: 1, rebuild: 2 };
$("standTable").addEventListener("click", e => {
  const th = e.target.closest("th[data-sort]"); if (!th) return;
  const k = th.dataset.sort;
  standSort = standSort.key === k ? { key: k, dir: -standSort.dir } : { key: k, dir: STAND_FIRST_DIR[k] || -1 };
  renderStandings();
});
// Power: roster strength blended with title odds. Strength says how good the roster is; title odds add
// record, injuries, points scored and trend from the season simulator. Odds count for more as the
// season goes on (25% before any games, up to 60% by Week 7). Score 0-100; before the simulator
// has run, Power is roster strength alone.
function powerScores(){
  const teams = [...S.teams.values()], strs = teams.map(t => t.strength), lo = Math.min(...strs), hi = Math.max(...strs);
  const odds = S.titleOdds?.odds, maxOdds = odds ? Math.max(0.0001, ...teams.map(t => odds.get(t.rid) || 0)) : 0;
  const w = odds ? Math.min(0.6, 0.25 + 0.05 * (S.weeksPlayed || 0)) : 0;
  const m = new Map(teams.map(t => { const sN = hi > lo ? (t.strength - lo) / (hi - lo) : 1, oN = odds ? Math.sqrt((odds.get(t.rid) || 0) / maxOdds) : 0;
    return [t.rid, { score: Math.round(100 * ((1 - w) * sN + w * oN)), odds: odds ? odds.get(t.rid) ?? null : null }]; }));
  [...m.entries()].sort((a, b) => b[1].score - a[1].score || S.teams.get(b[0]).strength - S.teams.get(a[0]).strength).forEach(([, v], i) => v.rank = i + 1);
  return { m, w };
}
function renderStandings(){
  if (!S.league) return;
  const pts = (w, d) => (Number(w) || 0) + (Number(d) || 0) / 100;
  const PW = powerScores();
  const rows = S.rosters.map(r => {
    const st = r.settings || {}, t = S.teams.get(r.roster_id);
    const w = st.wins || 0, l = st.losses || 0, ti = st.ties || 0, gp = w + l + ti;
    return { rid: r.roster_id, t, w, l, ti, gp, pf: pts(st.fpts, st.fpts_decimal), pa: pts(st.fpts_against, st.fpts_against_decimal),
             max: pts(st.ppts, st.ppts_decimal), streak: r.metadata?.streak || "", power: PW.m.get(r.roster_id)?.rank || 0 };
  }).sort((a, b) => (b.w + b.ti / 2) - (a.w + a.ti / 2) || b.pf - a.pf);
  const playoff = Number(S.league.settings?.playoff_teams) || 0;
  const anyMax = rows.some(r => r.max > 0);
  rows.forEach((r, i) => { r.place = i + 1; r.pct = r.gp ? (r.w + r.ti / 2) / r.gp : -1; r.odds = S.titleOdds?.odds.get(r.rid) ?? -1;
    const m = /^(\d+)\s*([wl])/i.exec(r.streak || ""); r.strk = m ? (m[2].toLowerCase() === "w" ? 1 : -1) * Number(m[1]) : 0;
    r.stat = r.t ? (STATUS_ORDER[r.t.status] ?? 9) : 9; });
  // Click a column heading to sort by it; click again to flip. "#" (or Record) is the league's own order.
  const sk = standSort.key, sd = standSort.dir, ranked = sk === "place";
  const val = { place: r => r.place, name: r => (r.t?.name || "").toLowerCase(), rec: r => r.place, pct: r => r.pct, odds: r => r.odds, pf: r => r.pf, pa: r => r.pa, max: r => r.max, strk: r => r.strk, power: r => r.power, stat: r => r.stat }[sk] || (r => r.place);
  const shown = [...rows].sort((a, b) => { const x = val(a), y = val(b); return (typeof x === "string" ? x.localeCompare(y, undefined, { numeric: true }) : x < y ? -1 : x > y ? 1 : 0) * sd || a.place - b.place; });
  const H = (k, label, cls = "", extra = "") => `<th class="sortable ${cls}" data-sort="${k}" aria-sort="${sk === k && !(ranked && sd > 0) ? (sd > 0 ? "ascending" : "descending") : "none"}" ${extra}>${label}</th>`;
  $("standTable").innerHTML = `<thead><tr>${H("place", "#", "n")}${H("name", "Team")}${H("rec", "Record", "n")}${H("pct", "Win %", "n hide-sm")}${H("odds", `Title odds <button type="button" class="info-btn" data-info="col-odds" aria-label="What title odds mean">?</button>`, "n")}${H("pf", "Points for", "n hide-sm")}${H("pa", "Points against", "n hide-sm")}${anyMax ? H("max", "Max points", "n hide-sm") : ""}${H("strk", "Streak", "hide-sm")}${H("power", `Power <button type="button" class="info-btn" data-info="col-power" aria-label="What Power means">?</button>`, "n hide-sm")}${H("stat", "Status")}</tr></thead>
    <tbody>${shown.map(r => `<tr class="${r.rid === S.myRid ? "me" : ""}${ranked && sd > 0 && playoff && r.place === playoff ? " cut" : ""}">
      <td class="n rk">${r.place}</td>
      <td><span class="teamcell">${teamPhoto(r.rid, "sm")}<span><b>${esc(r.t?.name || "Team " + r.rid)}</b>${r.t?.manager && r.t.manager !== r.t.name ? `<br><small style="color:var(--muted)">${esc(r.t.manager)}</small>` : ""}</span></span></td>
      <td class="n rec">${r.w}-${r.l}${r.ti ? "-" + r.ti : ""}</td>
      <td class="n hide-sm">${r.gp ? Math.round(r.pct * 1000) / 10 + "%" : "–"}</td>
      <td class="n"><b>${titleOddsText(r.rid)}</b></td>
      <td class="n hide-sm">${r.pf.toFixed(2)}</td><td class="n hide-sm">${r.pa.toFixed(2)}</td>
      ${anyMax ? `<td class="n hide-sm">${r.max ? r.max.toFixed(2) : "–"}</td>` : ""}
      <td class="hide-sm">${r.streak ? `<span class="strk ${/w/i.test(r.streak) ? "w" : "l"}">${esc(r.streak)}</span>` : "–"}</td>
      <td class="n hide-sm">${ordinal(r.power)}</td>
      <td>${r.t ? `<span class="badge ${badgeClass[r.t.status]}">${statusText[r.t.status]}</span>` : ""}</td></tr>`).join("")}</tbody>`;
  // ---- Power Rankings ----
  const strRank = new Map([...S.teams.values()].sort((a, b) => b.strength - a.strength).map((t, i) => [t.rid, i + 1]));
  const byStrength = [...S.teams.values()].sort((a, b) => PW.m.get(a.rid).rank - PW.m.get(b.rid).rank);   // ordered by Power
  const standRank = new Map(rows.map((r, i) => [r.rid, i + 1]));
  const recOf = new Map(rows.map(r => [r.rid, `${r.w}-${r.l}${r.ti ? "-" + r.ti : ""}`]));
  $("powerTable").innerHTML = `<thead><tr><th class="n">#</th><th>Team</th><th class="n">Power <button type="button" class="info-btn" data-info="col-power" aria-label="What Power means">?</button></th><th class="n">Roster strength <button type="button" class="info-btn" data-info="col-strength" aria-label="What does Roster strength mean?">?</button></th><th class="n">Title odds</th><th class="hide-sm">Best players</th><th class="n">Record</th><th class="n hide-sm">Standing</th><th class="hide-sm">Record vs. roster</th><th>Status</th></tr></thead>
    <tbody>${byStrength.map((t, i) => {
      const top = teamAssets(t.rid).filter(a => a.kind === "player").slice(0, 3).map(a => a.name);
      const diff = (standRank.get(t.rid) || 0) - strRank.get(t.rid);   // positive = standings rank worse than roster-strength rank
      const luck = !standRank.get(t.rid) ? "" : diff >= 3 ? `<span class="luck down">Underachieving (${diff} spots lower)</span>` : diff <= -3 ? `<span class="luck up">Overachieving (${-diff} spots higher)</span>` : `<span class="note" style="font-size:13px">As expected</span>`;
      return `<tr class="${t.rid === S.myRid ? "me" : ""}">
        <td class="n rk">${i + 1}</td>
        <td><span class="teamcell">${teamPhoto(t.rid, "sm")}<b>${esc(t.name)}</b></span></td>
        <td class="n"><b class="pw-score">${PW.m.get(t.rid).score}</b><span class="pw-bar" style="width:${Math.max(4, Math.round(PW.m.get(t.rid).score / 100 * 70))}px"></span></td>
        <td class="n">${fmt(t.strength)}</td>
        <td class="n">${titleOddsText(t.rid)}</td>
        <td class="hide-sm" style="white-space:normal;max-width:260px;font-size:14px">${esc(top.join(", "))}</td>
        <td class="n rec">${esc(recOf.get(t.rid) || "–")}</td>
        <td class="n hide-sm">${standRank.get(t.rid) ? ordinal(standRank.get(t.rid)) : "–"}</td>
        <td class="hide-sm">${luck}</td>
        <td><span class="badge ${badgeClass[t.status]}">${statusText[t.status]}</span></td></tr>`;
    }).join("")}</tbody>`;
  const oddsWhen = S.titleOdds ? `from ${S.titleOdds.runs.toLocaleString()} simulated seasons, as of ${S.titleOdds.at.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : S.nflState?.season_type === "regular" ? "they appear once the season simulator finishes" : "available during the regular season";
  const line = (k, v) => `<li><b>${k}</b> ${v}</li>`;
  $("standNote").innerHTML = `<ul class="stand-key">
    ${playoff ? line("Playoffs:", `the top ${playoff} teams make it; the line under #${playoff} marks the cutoff. Ties are broken by Points For.`) : line("Ties:", "broken by Points For.")}
    ${line("Title odds:", `each team's chance to win the championship, ${oddsWhen}. They weigh record, games left and the schedule still to play, roster strength and bench depth, injuries and how serious they are, bye weeks, points scored and which way each team is trending.`)}
    ${line("Power:", PW.w ? `roster strength blended with title odds (${Math.round(PW.w * 100)}% title odds this week), so record, injuries, points scored and trend count too.` : "roster strength from player values. Title odds blend in once the season simulator has run.")}
    ${line("Sort:", "click any column heading; click again to flip the order.")}
  </ul>`;
}

// ============================================================
// SEASON SIMULATOR (League Analysis tab)
// Plays out the rest of the regular season and the playoffs 10,000 times.
//  - Each player's weekly projection blends how he has actually scored this season (last 3 weeks
//    count extra) with what his league value says he should score, leaning on value when he has
//    few games.
//  - Injured players sit until Front Office's estimated return; Questionable players count at
//    their chance of playing. Each team's best legal lineup is projected for every week.
//  - Each simulated game draws a score around that projection, as spread out as the team's real
//    weekly scores have been. Records start from the actual results so far.
// ============================================================
const SIM_RUNS = 10000;
let simCache = null;
const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const SLOT_OK = { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], FLEX: ["RB", "WR", "TE"], WRRB_FLEX: ["RB", "WR"], REC_FLEX: ["WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"] };
async function simData(){
  const L = S.league, st = L.settings || {};
  const firstPlayoff = Number(st.playoff_week_start) || 15, lastReg = firstPlayoff - 1;
  const done = S.nflState?.season_type === "regular" ? await lastFinishedWeek() : S.nflState?.season_type === "post" || L.status === "complete" ? 18 : 0;
  const weeks = await Promise.all(Array.from({ length: Math.min(18, lastReg + 3) }, (_, i) => getJSON(`/league/${L.league_id}/matchups/${i + 1}`).catch(() => [])));
  await loadCardData();
  // NFL bye weeks for every week left (ESPN's schedule: a team with no game that week is on bye). If ESPN can't be
  // reached, the simulator just doesn't know about byes, as before.
  const dn = Math.min(done, lastReg), byes = new Map();
  if (S.nflState?.season_type === "regular" && typeof loadGameStatus === "function"){
    const wks = Array.from({ length: Math.max(0, firstPlayoff - dn) }, (_, i) => dn + 1 + i).filter(w => w <= 18);
    const got = await Promise.all(wks.map(w => loadGameStatus(w).catch(() => null)));
    wks.forEach((w, i) => { const g = got[i]; if (g && Object.keys(g).length >= 20) byes.set(w, new Set(Object.keys(g))); });   // the teams that DO play
  }
  return { weeks, done: dn, lastReg, firstPlayoff, byes };
}
// chance a healthy starter misses any given future week, by position (league-wide injury rates)
const INJ_WEEKLY = { QB: 0.04, RB: 0.07, WR: 0.05, TE: 0.05 };
function buildSim(D){
  const slots = (S.cfg.rp || []).filter(x => !["BN", "IR", "TAXI"].includes(x));
  const rids = [...S.teams.keys()];
  // 1) actual results so far
  const rec = new Map(rids.map(r => [r, { w: 0, l: 0, t: 0, pf: 0, scores: [], other: [] }]));
  const median = !!Number(S.league.settings?.league_average_match);
  const pPts = new Map();                                   // player id -> [{wk, pts}]
  for (let w = 1; w <= D.done; w++){
    const ms = D.weeks[w - 1] || [];
    const by = new Map(); ms.forEach(m => { if (m.matchup_id != null) (by.get(m.matchup_id) || by.set(m.matchup_id, []).get(m.matchup_id)).push(m); });
    for (const m of ms){
      const R = rec.get(m.roster_id); if (!R) continue;
      const pts = Number(m.custom_points ?? m.points ?? 0); R.pf += pts; R.scores.push(pts);
      // points from slots we don't project (K, DEF, IDP...), averaged later
      const sp = m.starters_points || [], stIds = m.starters || [];
      let other = 0; slots.forEach((s, i) => { if (!SLOT_OK[s]) other += Number(sp[i] || 0); }); R.other.push(other);
      for (const [pid, p] of Object.entries(m.players_points || {})) if (p) (pPts.get(pid) || pPts.set(pid, []).get(pid)).push({ wk: w, pts: Number(p) });
      void stIds;
    }
    for (const pair of by.values()) if (pair.length === 2){
      const [a, b] = pair, pa = Number(a.custom_points ?? a.points ?? 0), pb = Number(b.custom_points ?? b.points ?? 0);
      const A = rec.get(a.roster_id), B = rec.get(b.roster_id); if (!A || !B) continue;
      if (pa > pb){ A.w++; B.l++; } else if (pb > pa){ B.w++; A.l++; } else { A.t++; B.t++; }
    }
    if (median && ms.length){
      const sc = ms.map(m => Number(m.custom_points ?? m.points ?? 0)).sort((x, y) => x - y), mid = (sc[Math.floor((sc.length - 1) / 2)] + sc[Math.ceil((sc.length - 1) / 2)]) / 2;
      ms.forEach(m => { const R = rec.get(m.roster_id); if (!R) return; const p = Number(m.custom_points ?? m.points ?? 0); if (p > mid) R.w++; else if (p < mid) R.l++; else R.t++; });
    }
  }
  // 2) value -> points-per-game, fit from this season's players (per position), for players with few games
  const ppgOf = pid => { const g = pPts.get(pid) || []; if (!g.length) return null;
    const avg = g.reduce((t, x) => t + x.pts, 0) / g.length, last = g.slice(-3), l3 = last.reduce((t, x) => t + x.pts, 0) / last.length;
    return { n: g.length, ppg: 0.6 * avg + 0.4 * l3 }; };
  const fit = {};
  for (const pos of ["QB", "RB", "WR", "TE"]){
    const pts = [...S.assets.values()].filter(a => a.kind === "player" && a.pos === pos && a.owner != null).map(a => [a.value, ppgOf(a.pid)]).filter(x => x[1] && x[1].n >= 2);
    if (pts.length >= 6){
      const mx = pts.reduce((t, x) => t + x[0], 0) / pts.length, my = pts.reduce((t, x) => t + x[1].ppg, 0) / pts.length;
      const b = pts.reduce((t, x) => t + (x[0] - mx) * (x[1].ppg - my), 0) / Math.max(1, pts.reduce((t, x) => t + (x[0] - mx) ** 2, 0));
      fit[pos] = v => Math.max(0, my + Math.max(0, b) * (v - mx));
    } else fit[pos] = v => 2 + v / 10000 * ({ QB: 22, RB: 17, WR: 16, TE: 12 }[pos]);   // before any games: a sensible scale
  }
  // 3) each player's projection and availability by week
  const proj = a => { const g = ppgOf(a.pid), prior = fit[a.pos](a.value); if (!g) return prior; const w = g.n / (g.n + 3); return w * g.ppg + (1 - w) * prior; };
  const avail = (a, wk) => {
    const sp = S.sleeperPlayers?.[a.pid];
    const plays = D.byes?.get(wk); if (plays && sp?.team && !plays.has(sp.team)) return 0;   // on bye that week
    const st = sp?.injury_status; if (!st) return 1;
    const c = cardData?.players?.[a.pid];
    const est = returnEstimate(sp, c?.n || [], c?.c);
    const now = currentWeek();
    if (st === "Questionable"){ const p = Number(c?.c?.prob); return wk === now || wk === D.done + 1 ? (isNaN(p) ? 0.75 : p) : 1; }
    if (st === "Doubtful") return wk <= Math.max(now, D.done + 1) ? 0.2 : 1;
    if (!est) return ["Sus", "NA", "DNR"].includes(st) ? (wk <= D.done + 2 ? 0 : 1) : 1;
    if (est.lo >= 99) return 0;                                        // out for the season (and the playoffs)
    // severity: he comes back somewhere in his estimated window, so each week inside it counts partly;
    // his first couple of games back count a little less (rust, snap limits, re-injury risk)
    const w0 = D.done + 1 + est.lo, w1 = D.done + 1 + Math.max(est.lo, est.hi);
    const p = wk < w0 ? 0 : wk >= w1 ? 1 : (wk - w0 + 1) / (w1 - w0 + 1);
    const fresh = wk >= w0 && wk <= w1 + 1 ? 0.9 : 1;
    return p * fresh;
  };
  const lineupProj = (rid, wk, healthy) => {
    const pool = teamAssets(rid).filter(a => a.kind === "player").map(a => ({ pos: a.pos, pts: proj(a) * (healthy ? 1 : avail(a, wk)) })).sort((x, y) => y.pts - x.pts);
    const used = new Set(); let total = 0;
    const order = slots.filter(s => SLOT_OK[s]).sort((x, y) => SLOT_OK[x].length - SLOT_OK[y].length);   // fill strict slots first
    const picked = [];
    for (const s of order){ const i = pool.findIndex((p, k) => !used.has(k) && SLOT_OK[s].includes(p.pos)); if (i >= 0){ used.add(i); total += pool[i].pts; picked.push([s, pool[i]]); } }
    if (!healthy && wk > Math.max(currentWeek(), D.done + 1)){
      const ahead = Math.min(1, (wk - Math.max(currentWeek(), D.done + 1)) / 3);   // the further out, the more can go wrong
      for (const [s, p] of picked){
        const rep = pool.find((q, k) => !used.has(k) && SLOT_OK[s].includes(q.pos));
        total -= INJ_WEEKLY[p.pos] * ahead * Math.max(0, p.pts - (rep ? rep.pts : 0));
      }
    }
    const R = rec.get(rid), other = R.other.length ? R.other.reduce((t, x) => t + x, 0) / R.other.length : slots.filter(s => !SLOT_OK[s]).length * 8;
    return total + other;
  };
  // 4) team form. Roster strength and injuries come from the lineup projection above; blend in what the
  //    team has actually scored (points for, scaled down by its current injuries) and which way it's
  //    trending (last 3 weeks vs. the weeks before). Points against is luck (it's the opponent's score),
  //    so it only counts through the record the team already has. Weight grows with games played.
  const formOf = rid => {
    const s = rec.get(rid).scores, n = s.length; if (n < 2) return null;
    const ppg = s.reduce((t, x) => t + x, 0) / n;
    let trend = 0;
    if (n >= 4){ const l3 = s.slice(-3).reduce((t, x) => t + x, 0) / 3, before = s.slice(0, -3).reduce((t, x) => t + x, 0) / (n - 3);
      trend = Math.max(-0.12, Math.min(0.12, (l3 - before) / Math.max(1, before))); }
    return { n, ppg, trend };
  };
  const teamProj = (rid, wk, playoffs = false) => {
    const base = lineupProj(rid, wk), f = formOf(rid); if (!f) return base;
    const healthy = lineupProj(rid, wk, true), hurt = healthy > 0 ? base / healthy : 1;   // share of the lineup that's available that week
    const w = Math.min(0.35, f.n / (f.n + 8));
    return ((1 - w) * base + w * f.ppg * hurt) * (1 + 0.4 * f.trend * (playoffs ? 0.5 : 1));
  };
  // spread: each team's real week-to-week swing, pulled toward a typical 16%
  const sdOf = (rid, mean) => { const s = rec.get(rid).scores; if (s.length < 3) return mean * 0.16;
    const m = s.reduce((t, x) => t + x, 0) / s.length, sd = Math.sqrt(s.reduce((t, x) => t + (x - m) ** 2, 0) / (s.length - 1)), k = s.length / (s.length + 4);
    return k * sd + (1 - k) * mean * 0.16; };
  // schedule: Sleeper lists every regular-season pairing ahead of time
  const sched = [];
  for (let w = D.done + 1; w <= D.lastReg; w++){
    const ms = D.weeks[w - 1] || [], by = new Map();
    ms.forEach(m => { if (m.matchup_id != null) (by.get(m.matchup_id) || by.set(m.matchup_id, []).get(m.matchup_id)).push(m.roster_id); });
    let pairs = [...by.values()].filter(p => p.length === 2);
    if (!pairs.length){ const sh = [...rids]; pairs = []; for (let i = 0; i + 1 < sh.length; i += 2) pairs.push([sh[i], sh[i + 1]]); pairs.random = true; }
    sched.push({ wk: w, pairs, mean: new Map(rids.map(r => [r, teamProj(r, w)])) });
  }
  const playoffMean = new Map(rids.map(r => [r, teamProj(r, D.firstPlayoff, true)]));
  const sd = new Map(rids.map(r => [r, sdOf(r, playoffMean.get(r))]));
  return { rec, sched, playoffMean, sd, median, rids };
}
function runSim(M, runs = SIM_RUNS, trackSlots = false, keepLast = false){
  let last = null;                       // with keepLast: the final run's records, seeds and every playoff game
  const nPO = Math.min(Number(S.league.settings?.playoff_teams) || 6, M.rids.length);
  const out = new Map(M.rids.map(r => [r, { wins: 0, losses: 0, playoffs: 0, champ: 0, final: 0, seed: 0, bye: 0, slots: new Array(M.rids.length).fill(0) }]));
  const draw = (r, mean) => mean + randn() * M.sd.get(r);
  for (let n = 0; n < runs; n++){
    const W = new Map(M.rids.map(r => { const R = M.rec.get(r); return [r, { w: R.w + R.t / 2, pf: R.pf }]; }));
    for (const wk of M.sched){
      let pairs = wk.pairs;
      if (pairs.random){ const sh = [...M.rids].sort(() => Math.random() - 0.5); pairs = []; for (let i = 0; i + 1 < sh.length; i += 2) pairs.push([sh[i], sh[i + 1]]); }
      const sc = new Map(M.rids.map(r => [r, draw(r, wk.mean.get(r))]));
      for (const [a, b] of pairs){ const A = W.get(a), B = W.get(b); if (!A || !B) continue; if (sc.get(a) >= sc.get(b)) A.w++; else B.w++; }
      if (M.median){ const v = [...sc.values()].sort((x, y) => x - y), mid = (v[Math.floor((v.length - 1) / 2)] + v[Math.ceil((v.length - 1) / 2)]) / 2; sc.forEach((p, r) => { if (p > mid) W.get(r).w++; }); }
      sc.forEach((p, r) => { W.get(r).pf += p; });
    }
    const games = M.sched.length * (M.median ? 2 : 1);
    const seeds = [...M.rids].sort((a, b) => W.get(b).w - W.get(a).w || W.get(b).pf - W.get(a).pf);
    seeds.forEach((r, i) => { const o = out.get(r); o.wins += W.get(r).w; o.losses += (M.rec.get(r).w + M.rec.get(r).l + M.rec.get(r).t + games) - W.get(r).w; o.seed += i + 1; });
    const field = seeds.slice(0, nPO); field.forEach(r => out.get(r).playoffs++);
    const out1 = [];                     // playoff teams in the order they're knocked out: [team, round]
    let rnd = 0; const log = [];
    const game = (a, b) => { const w = draw(a, M.playoffMean.get(a)) >= draw(b, M.playoffMean.get(b)) ? a : b; out1.push([w === a ? b : a, rnd]); log.push({ a, b, w, rnd }); return w; };
    let champ;
    if (nPO === 6){ out.get(field[0]).bye++; out.get(field[1]).bye++;
      const w36 = game(field[2], field[5]), w45 = game(field[3], field[4]); rnd = 1;
      const s1 = game(field[0], w45), s2 = game(field[1], w36); rnd = 2;
      out.get(s1).final++; out.get(s2).final++; champ = game(s1, s2); }
    else if (nPO === 8){ const r1 = [game(field[0], field[7]), game(field[3], field[4]), game(field[1], field[6]), game(field[2], field[5])]; rnd = 1;
      const s1 = game(r1[0], r1[1]), s2 = game(r1[2], r1[3]); rnd = 2; out.get(s1).final++; out.get(s2).final++; champ = game(s1, s2); }
    else if (nPO >= 4){ const s1 = game(field[0], field[3]), s2 = game(field[1], field[2]); rnd = 1; out.get(s1).final++; out.get(s2).final++; champ = game(s1, s2); }
    else if (nPO >= 2){ out.get(field[0]).final++; out.get(field[1]).final++; champ = game(field[0], field[1]); }
    if (champ) out.get(champ).champ++;
    if (keepLast) last = { W, seeds, games: log, champ, gamesLeft: games };
    if (trackSlots){
      // Next year's draft order: non-playoff teams worst record first, then playoff teams by how early
      // they were knocked out (worse seed first within a round), the runner-up second to last, the champion last
      const order = seeds.slice(nPO).reverse();
      const seedOf = r => seeds.indexOf(r);
      order.push(...out1.sort((x, y) => x[1] - y[1] || seedOf(y[0]) - seedOf(x[0])).map(x => x[0]));
      if (champ) order.push(champ);
      field.forEach(r => { if (!order.includes(r)) order.push(r); });
      order.forEach((r, i) => { const o = out.get(r); if (o && i < o.slots.length) o.slots[i]++; });
    }
  }
  return { out, nPO, last };
}
// ---------- Draft pick odds from the season simulator ----------
// Plays out the rest of the season 3,000 times in the background and records where each team's
// next-year pick lands. A pick's value is then the average over all those possible slots, so a
// 2-3 team that could still turn it around isn't valued like a locked-in 1.01.
const PICK_SIM_RUNS = 3000;
async function updatePickOdds(){
  try {
    if (S.nflState?.season_type !== "regular" || !S.league) return;
    const league = S.league.league_id;
    if (!simCache || simCache.league !== league || Date.now() - simCache.at > 10 * 60000) simCache = { league, at: Date.now(), D: await simData() };
    const D = simCache.D;
    if (S.league?.league_id !== league || D.done >= D.lastReg) return;
    const M = buildSim(D), R = runSim(M, PICK_SIM_RUNS, true);
    S.pickOdds = new Map([...R.out].map(([rid, o]) => [rid, o.slots.map(c => c / PICK_SIM_RUNS)]));
    S.playoffOdds = new Map([...R.out].map(([rid, o]) => [rid, o.playoffs / PICK_SIM_RUNS]));   // also used for team status
    S.titleOdds = { odds: new Map([...R.out].map(([rid, o]) => [rid, o.champ / PICK_SIM_RUNS])), at: new Date(), runs: PICK_SIM_RUNS };   // Standings: chance to win it all
    S.weeksPlayed = D.done;
    buildValues();
    rerenderKeepingPlace();
  } catch(e){ console.warn("Pick odds unavailable", e); }
}
const pct = (n, d = SIM_RUNS) => { const p = n / d * 100; return p >= 99.5 && n < d ? ">99%" : p > 0 && p < 0.5 ? "<1%" : Math.round(p) + "%"; };
function headToHead(M, a, b){ const d = M.playoffMean.get(a) - M.playoffMean.get(b), s = Math.hypot(M.sd.get(a), M.sd.get(b)) || 1; return 0.5 * (1 + erf(d / s / Math.SQRT2)); }
function erf(x){ const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
async function simulateSeason(){
  const btn = $("simBtn"), out = $("simOut");
  btn.disabled = true; btn.textContent = "Simulating…";
  out.innerHTML = `<p class="pc-loading">Playing out the rest of the season ${SIM_RUNS.toLocaleString()} times…</p>`;
  try {
    if (!simCache || simCache.league !== S.league.league_id || Date.now() - simCache.at > 10 * 60000) simCache = { league: S.league.league_id, at: Date.now(), D: await simData() };
    const D = simCache.D;
    await new Promise(r => setTimeout(r, 30));
    if (D.done >= D.lastReg){ out.innerHTML = `<p class="empty">The regular season is over, so there's nothing left to simulate. Check the Trophy Room for playoff results.</p>`; return; }
    const M = buildSim(D), R = runSim(M);
    S.titleOdds = { odds: new Map([...R.out].map(([rid, o]) => [rid, o.champ / SIM_RUNS])), at: new Date(), runs: SIM_RUNS };
    // One full season played out, game by game. This is what changes on every click; the 10,000-season odds barely move.
    const one = runSim(M, 1, false, true).last;
    const oneRec = r => { const c = M.rec.get(r), w = one.W.get(r).w, tot = c.w + c.l + c.t + one.gamesLeft; return `${Math.round(w)}-${Math.round(tot - w)}`; };
    const row = r => { const o = R.out.get(r), t = S.teams.get(r), cur = M.rec.get(r);
      const w = o.wins / SIM_RUNS, games = cur.w + cur.l + cur.t + M.sched.length * (M.median ? 2 : 1);
      return { r, t, w, l: games - w, cur, o, seed: o.seed / SIM_RUNS }; };
    const rows = M.rids.map(row).sort((a, b) => b.w - a.w || a.seed - b.seed);
    const champ = [...rows].sort((a, b) => b.o.champ - a.o.champ)[0];
    // bracket from that one simulated season: its seeds, its games, its upsets
    const seeds = one.seeds.slice(0, R.nPO);
    const nm = r => esc(S.teams.get(r)?.name || "Team " + r);
    const rdName = (rd, maxRd) => rd === maxRd ? "Championship" : rd === maxRd - 1 ? "Semifinal" : "Round " + (rd + 1);
    const maxRd = Math.max(0, ...one.games.map(g => g.rnd));
    const gameHtml = g => { const p = headToHead(M, g.a, g.b), pw = g.w === g.a ? p : 1 - p, upset = pw < 0.5;
      const side = r => `<div class="${g.w === r ? "w" : ""}">${teamPhoto(r, "sm")}<span>${seeds.indexOf(r) + 1}. ${nm(r)}</span></div>`;
      return `<div class="sim-game"><small>${rdName(g.rnd, maxRd)}</small>${side(g.a)}${side(g.b)}<em>${upset ? "Upset! " : ""}${nm(g.w)} wins (${Math.round(pw * 100)}% chance)</em></div>`; };
    const rounds = [...new Set(one.games.map(g => g.rnd))].map(rd => one.games.filter(g => g.rnd === rd).map(g => ({ html: gameHtml(g) })));
    const recTxt = (w, l) => `${Math.round(w)}-${Math.round(l)}`;
    const mine = rows.find(x => x.r === S.myRid);
    out.innerHTML = `
      <div class="sim-champ">${teamPhoto(one.champ, "lg")}<div><small>This simulation's champion</small><b>${nm(one.champ)}</b><span>${one.champ === champ.r ? "Also the most likely champion" : `Most likely champion: ${nm(champ.r)}`}, ${pct(champ.o.champ)} of ${SIM_RUNS.toLocaleString()} seasons</span></div></div>
      ${mine && mine.r !== champ.r ? `<p class="note" style="margin:8px 0 0">Your team, <b>${nm(mine.r)}</b>: projected ${recTxt(mine.w, mine.l)}, makes the playoffs ${pct(mine.o.playoffs)} of the time, wins it all ${pct(mine.o.champ)}.</p>` : ""}
      <h4 class="sim-h">Projected Final Standings</h4>
      <div class="tablewrap"><table class="stand sim-table"><thead><tr><th class="n">#</th><th>Team</th><th class="n hide-sm">Now</th><th class="n">Projected</th><th class="n">This sim</th><th class="n">Playoffs</th><th class="n hide-sm">Final</th><th class="n">Title</th></tr></thead>
      <tbody>${rows.map((x, i) => `<tr class="${x.r === S.myRid ? "me" : ""}${i === R.nPO - 1 ? " cut" : ""}"><td class="n rk">${i + 1}</td>
        <td><span class="teamcell">${teamPhoto(x.r, "sm")}<b>${nm(x.r)}</b></span></td>
        <td class="n hide-sm">${x.cur.w}-${x.cur.l}${x.cur.t ? "-" + x.cur.t : ""}</td><td class="n rec">${recTxt(x.w, x.l)}</td><td class="n">${oneRec(x.r)}</td>
        <td class="n">${pct(x.o.playoffs)}</td><td class="n hide-sm">${pct(x.o.final)}</td><td class="n"><b>${pct(x.o.champ)}</b></td></tr>`).join("")}</tbody></table></div>
      <h4 class="sim-h">This Simulation's Playoffs</h4>
      <div class="sim-bracket">${rounds.map(rd => `<div class="sim-round">${rd.map(g => g.html).join("")}</div>`).join("")}</div>
      <p class="note">Simulated ${M.sched.length} remaining week${M.sched.length === 1 ? "" : "s"} (through Week ${D.lastReg}) and a ${R.nPO}-team playoff starting Week ${D.firstPlayoff}${M.median ? ", with a win or loss against the league median each week" : ""}. Projections use each player's scoring this season (last 3 weeks count extra), league values, and current injuries with Front Office's estimated return dates. Bye weeks and future trades aren't included. Projected records and percentages average ${SIM_RUNS.toLocaleString()} simulated seasons, so they only move a point or two between clicks. The champion, the This sim column, and the playoffs show one of those seasons played out game by game, so they change every time you simulate.</p>`;
  } catch(e){
    console.error(e);
    out.innerHTML = `<p class="empty">Couldn't run the simulation right now. Try again in a minute.</p>`;
  } finally { btn.disabled = false; btn.textContent = "Simulate Again"; $("simReset").hidden = !$("simOut").innerHTML.trim(); }
}
// Reset: clear the results and start fresh (the next run re-downloads the latest scores and injuries)
function resetSimulator(){
  simCache = null;
  $("simOut").innerHTML = "";
  $("simBtn").textContent = "Simulate Season";
  $("simReset").hidden = true;
  $("simBtn").focus();
}
$("simBtn").addEventListener("click", simulateSeason);
$("simReset").addEventListener("click", resetSimulator);


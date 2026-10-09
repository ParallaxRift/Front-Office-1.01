// Front Office: Scouting Reports tab (League Locker)
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// SCOUTING REPORTS
// A report on every manager, built from your league's trade history (graded with today's values):
// what they buy and sell, what they overpay for, whether they trade picks, if they consolidate
// (2-for-1) or spread out, young or old players, favorite partners, and how to pitch them a trade.
// ============================================================
function scoutData(){
  const H = S.history; if (!H || !S.teams) return null;
  const graded = H.trades.map(gradeTrade), habits = managerHabits(), prof = teamProfiles();
  const cats = ["QB", "RB", "WR", "TE", "PICK"];
  const out = new Map();
  for (const t of S.teams.values()){
    const mine = graded.map(g => ({ g, x: g.sides.find(s => s.owner === t.owner) })).filter(o => o.x);
    const n = mine.length, h = habits.get(t.rid);
    const net = mine.reduce((s, o) => s + o.x.margin, 0);
    // value won or lost on trades where they received each kind of asset, shared out by value
    const overpay = Object.fromEntries(cats.map(c => [c, { m: 0, n: 0 }]));
    let picksIn = 0, picksOut = 0, consol = 0, spread = 0, ageIn = [0, 0], ageOut = [0, 0];
    const partners = {};
    for (const { g, x } of mine){
      const tot = x.items.reduce((s, i) => s + i.value, 0) || 1;
      for (const i of x.items){ const c = overpay[i.cat]; if (c){ c.m += x.margin * i.value / tot; c.n++; } }
      picksIn += x.items.filter(i => i.cat === "PICK").length; picksOut += x.sentItems.filter(i => i.cat === "PICK").length;
      if (x.sentItems.length >= 2 && x.items.length === 1) consol++;
      if (x.items.length >= 2 && x.sentItems.length === 1) spread++;
      const age = (list, acc) => { for (const i of list){ const a = i.photoPid && !i.usedOn ? S.assets.get("p:" + i.photoPid) : null; if (a?.age && i.value > 0){ acc[0] += a.age * i.value; acc[1] += i.value; } } };
      age(x.items, ageIn); age(x.sentItems, ageOut);
      for (const y of g.sides) if (y !== x) partners[y.owner] = (partners[y.owner] || 0) + 1;
    }
    const pay = cats.filter(c => overpay[c].n >= 2).map(c => ({ c, avg: overpay[c].m / overpay[c].n })).sort((a, b) => a.avg - b.avg);
    const last = mine.length ? Math.max(...mine.map(o => o.g.created || 0)) : 0;
    out.set(t.rid, { t, h, n, net, won: h?.won || 0, lost: h?.lost || 0, picksIn, picksOut, consol, spread,
      ageIn: ageIn[1] ? ageIn[0] / ageIn[1] : null, ageOut: ageOut[1] ? ageOut[0] / ageOut[1] : null,
      overpays: pay[0] && pay[0].avg < -400 ? pay[0].c : null, bargains: pay.length && pay[pay.length - 1].avg > 400 ? pay[pay.length - 1].c : null,
      partners: Object.entries(partners).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([o, k]) => ({ team: [...S.teams.values()].find(x => x.owner === o), k })).filter(p => p.team),
      last, prof: prof.get(t.rid) });
  }
  return out;
}
// Short labels for the summary table and the top of each report
function scoutTraits(d){
  const tr = [];
  if (!d.n) return ["No trades yet"];
  if (d.h?.active) tr.push("Active trader"); else if (d.n <= 2) tr.push("Rarely trades");
  if (d.overpays) tr.push(`Overpays for ${catWord(d.overpays)}`);
  if (d.bargains) tr.push(`Gets bargains on ${catWord(d.bargains)}`);
  for (const c of d.h?.buys || []) if (c !== d.overpays) tr.push(`Buys ${catWord(c)}`);
  for (const c of d.h?.sells || []) tr.push(`Sells ${catWord(c)}`);
  if (d.n >= 3 && !d.picksIn && !d.picksOut) tr.push("Never trades picks");
  if (d.consol >= 2 && d.consol >= d.n / 3) tr.push("Consolidates (2-for-1)");
  if (d.spread >= 2 && d.spread >= d.n / 3) tr.push("Takes quantity (1-for-2)");
  if (d.ageIn && d.ageOut && d.ageOut - d.ageIn >= 1.5) tr.push("Buys youth");
  if (d.ageIn && d.ageOut && d.ageIn - d.ageOut >= 1.5) tr.push("Buys veterans");
  if (d.n >= 3 && d.won / d.n >= 0.6) tr.push("Sharp: wins most deals");
  if (d.n >= 3 && d.lost / d.n >= 0.6) tr.push("Often loses trades");
  return tr;
}
// How to pitch them a trade, in plain sentences
function scoutPitch(d){
  const p = [], me = S.teams.get(S.myRid);
  if (!d.n) return [`${d.t.name} hasn't made a trade Front Office can see. Start with a simple, fair 1-for-1 at a position they need.`];
  if (d.overpays) p.push(`Offer ${catWord(d.overpays)}. They've given up extra value to get them before.`);
  for (const c of (d.h?.sells || []).slice(0, 1)) p.push(`Ask for ${catWord(c)}. They move them more than they buy them.`);
  if (d.n >= 3 && !d.picksIn && !d.picksOut) p.push("Leave picks out of it. They've never traded one.");
  if (d.consol >= 2 && d.consol >= d.n / 3) p.push("Offer one better player for two of theirs. They like consolidating.");
  if (d.spread >= 2 && d.spread >= d.n / 3) p.push("Offer two pieces for one. They like getting more bodies back.");
  if (d.ageOut && d.ageIn && d.ageOut - d.ageIn >= 1.5) p.push("Pitch younger players. They trade away veterans for youth.");
  if (d.ageOut && d.ageIn && d.ageIn - d.ageOut >= 1.5) p.push("Pitch proven veterans. They pay for players who can help now.");
  if (d.n >= 3 && d.won / d.n >= 0.6) p.push("Check every offer from them carefully. They usually come out ahead.");
  const needs = d.prof ? ["QB", "RB", "WR", "TE"].filter(x => d.prof.pos[x].rank > S.teams.size * 2 / 3) : [];
  if (needs.length) p.push(`Their weakest starting spots right now: ${andList(needs)}.`);
  if (d.t.status === "contend") p.push("They're contending, so proven starters move them more than picks.");
  if (d.t.status === "rebuild") p.push("They're rebuilding, so picks and young players are the best currency.");
  if (me && d.t.rid === me.rid) return ["This is you. This is how the rest of the league sees your trading."].concat(scoutTraits(d).map(x => x + "."));
  return p;
}
let scoutSel = null, scoutSort = { key: "trades", dir: -1 };
function renderScouting(){
  const box = $("scoutBody"); if (!box) return;
  if (!S.history){ box.innerHTML = `<p class="pc-loading">${S.historyError ? "Your league's trades couldn't be loaded. Reopen the league to try again." : "Loading your league's trades…"}</p>`; $("scoutTable").innerHTML = ""; return; }
  const D = scoutData(); if (!D) return;
  const all = [...D.values()];
  // ---- filters ----
  const traitSel = $("scTrait"), keepTrait = traitSel.value;
  const traits = [...new Set(all.flatMap(scoutTraits))].filter(x => x !== "No trades yet").sort();
  traitSel.innerHTML = `<option value="">All styles</option>` + traits.map(x => `<option${x === keepTrait ? " selected" : ""}>${esc(x)}</option>`).join("");
  const act = $("scActivity").value, stat = $("scStatus").value, trait = traitSel.value;
  const rows = all.filter(r => (!trait || scoutTraits(r).includes(trait))
      && (act === "all" || (act === "traded" ? r.n > 0 : act === "active" ? r.h?.active : r.n === 0))
      && (stat === "all" || r.t.status === stat));
  const key = { name: r => r.t.name.toLowerCase(), trades: r => r.n, wl: r => r.n ? r.won / r.n : -1, net: r => r.n ? r.net : -1e12 }[scoutSort.key];
  rows.sort((x, y) => { const u = key(x), v = key(y); return (typeof u === "string" ? u.localeCompare(v) : u - v) * scoutSort.dir || y.n - x.n || y.net - x.net; });
  $("scClear").hidden = !trait && act === "all" && stat === "all";
  $("scCount").textContent = `${rows.length} of ${all.length} managers`;
  if (scoutSel == null || !D.has(scoutSel)) scoutSel = ([...all].sort((x, y) => y.n - x.n).find(r => r.t.rid !== S.myRid && r.n) || all[0])?.t.rid;
  const th = (k, label, cls = "", extra = "") => `<th class="sortable ${cls}" data-sort="${k}" aria-sort="${scoutSort.key === k ? (scoutSort.dir > 0 ? "ascending" : "descending") : "none"}">${label}${extra}</th>`;
  const tagCls = x => /^(Sharp|Gets bargains)/.test(x) ? "good" : /^(Overpays|Often loses)/.test(x) ? "warn" : /^(Rarely trades|No trades)/.test(x) ? "quiet" : "";
  $("scoutTable").innerHTML = `<colgroup><col class="sc-c-name"><col class="sc-c-num"><col class="sc-c-num hide-sm"><col class="sc-c-net hide-sm"><col></colgroup>
    <thead><tr>${th("name", "Manager")}${th("trades", "Trades", "c")}${th("wl", "Won–Lost", "c hide-sm")}${th("net", "Net Value from Trades", "c hide-sm", ` <button type="button" class="info-btn" data-info="col-netv" aria-label="What does Net Value from Trades mean?">?</button>`)}<th>Style</th></tr></thead>
    <tbody>${rows.map(r => `<tr data-rid="${r.t.rid}" tabindex="0" class="${r.t.rid === scoutSel ? "sel" : ""}">
      <td><span class="teamcell">${teamPhoto(r.t.rid, true)}<span><b>${esc(r.t.name)}</b>${r.t.rid === S.myRid ? ` <small class="sc-you">You</small>` : ""}</span></span></td>
      <td class="c">${r.n}</td>
      <td class="c hide-sm">${r.n ? `${r.won}–${r.lost}<small class="sc-pct">${Math.round(r.won / r.n * 100)}%</small>` : "–"}</td>
      <td class="c hide-sm ${r.net > 0 ? "up" : r.net < 0 ? "down" : ""}">${r.n ? (r.net > 0 ? "+" : "") + fmt(r.net) : "–"}</td>
      <td class="sc-traits">${scoutTraits(r).slice(0, 3).map(x => `<span class="sc-tag ${tagCls(x)}">${esc(x)}</span>`).join("")}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No managers match these filters.</td></tr>`}</tbody>`;
  const d = D.get(scoutSel); if (!d){ box.innerHTML = ""; return; }
  const ago = d.last ? Math.round((Date.now() - d.last) / 864e5) : null;
  const fact = (k, v) => v === "" || v == null ? "" : `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  box.innerHTML = `<div class="box sc-report">
    <div class="ros-head">${teamPhoto(d.t.rid, "xl")}<div><b>${esc(d.t.name)}</b>${d.t.manager && d.t.manager !== d.t.name ? `<small style="color:var(--muted);display:block">${esc(d.t.manager)}</small>` : ""}<span class="badge ${badgeClass[d.t.status]}">${statusText[d.t.status]}</span></div></div>
    <div class="sc-tags">${scoutTraits(d).map(x => `<span class="sc-tag ${/^(Sharp|Gets bargains)/.test(x) ? "good" : /^(Overpays|Often loses)/.test(x) ? "warn" : /^(Rarely trades|No trades)/.test(x) ? "quiet" : ""}">${esc(x)}</span>`).join("")}</div>
    <dl class="pc-facts sc-facts">
      ${fact("Trades", d.n ? `${d.n}${d.h?.recent && d.h.recent !== d.n ? ` (${d.h.recent} in the last year)` : ""}` : "None")}
      ${fact("Record (today's values)", d.n ? `${d.won} won, ${d.lost} lost, ${d.n - d.won - d.lost} even` : "")}
      ${fact("Net value from trades", d.n ? `${d.net > 0 ? "+" : ""}${fmt(d.net)}` : "")}
      ${fact("Picks", d.n ? `${d.picksIn} in, ${d.picksOut} out` : "")}
      ${fact("Age of players in / out", d.ageIn && d.ageOut ? `${d.ageIn.toFixed(1)} / ${d.ageOut.toFixed(1)}` : "")}
      ${fact("Trade shape", d.n ? `${d.consol} 2-for-1 (gave more pieces), ${d.spread} 1-for-2 (got more pieces)` : "")}
      ${fact("Favorite partners", d.partners.length ? d.partners.map(p => `${esc(p.team.name)} (${p.k})`).join(", ") : "")}
      ${fact("Last trade", ago == null ? "" : ago === 0 ? "Today" : ago === 1 ? "Yesterday" : `${ago} days ago`)}
    </dl>
    <h3>How to Trade With Them</h3><ul class="moves">${scoutPitch(d).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
    ${d.t.rid !== S.myRid ? `<button type="button" class="ghost" data-scout-grade="${d.t.rid}">Build a trade with ${esc(d.t.name)}</button>` : ""}
  </div>`;
}
$("scoutTable").addEventListener("click", e => {
  if (e.target.closest(".info-btn")) return;
  const h = e.target.closest("th[data-sort]");
  if (h){ const k = h.dataset.sort; scoutSort = scoutSort.key === k ? { key: k, dir: -scoutSort.dir } : { key: k, dir: k === "name" ? 1 : -1 }; return renderScouting(); }
  const tr = e.target.closest("tr[data-rid]"); if (!tr) return; scoutSel = Number(tr.dataset.rid); renderScouting(); $("scoutBody").scrollIntoView({ behavior: "smooth", block: "start" }); });
$("scoutTable").addEventListener("keydown", e => { if (e.key !== "Enter") return; const tr = e.target.closest("tr[data-rid]"); if (tr){ scoutSel = Number(tr.dataset.rid); renderScouting(); } });
$("scoutBody").addEventListener("click", e => {
  const b = e.target.closest("[data-scout-grade]"); if (!b) return;
  $("teamA").value = S.myRid; $("teamB").value = b.dataset.scoutGrade; S.sendIds.clear(); S.getIds.clear();
  renderCalc(); navTab("calc").click(); window.scrollTo({ top: $("groups").offsetTop, behavior: "smooth" });
});

for (const id of ["scTrait", "scActivity", "scStatus"]) $(id).addEventListener("change", renderScouting);
$("scClear").addEventListener("click", () => { $("scTrait").value = ""; $("scActivity").value = "all"; $("scStatus").value = "all"; renderScouting(); });

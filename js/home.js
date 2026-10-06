// Front Office: home page preview (before a username is entered)
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// HOME PAGE PREVIEW
// Shows what Front Office does before anyone types a username: a sample trade graded the same
// way the calculator grades trades, and today's top dynasty values. Both use a standard
// 12-team league, since no league is loaded yet.
// ============================================================
let homeData = null, homeFormat = "sf";
function homeAssets(f){
  const key = f === "sf" ? "r2" : "r1";
  return (homeData?.players || []).filter(p => p[key] != null && ["QB", "RB", "WR", "TE"].includes(p.pos))
    .sort((a, b) => a[key] - b[key]).map(p => ({ name: p.name, pos: p.pos, team: p.team || "FA", value: marketCurve(p[key], 1, 1) }));
}
function renderHome(){
  if (!homeData) return;
  for (const b of $("homeFormat").children) b.setAttribute("aria-pressed", b.dataset.f === homeFormat);
  const list = homeAssets(homeFormat), top = list[0]?.value || 1, scale = v => v / top * 10000;
  $("homeTop").innerHTML = list.slice(0, 10).map((a, i) => `<li><span class="hr">${i + 1}</span><span class="hn"><b>${esc(a.name)}</b><small>${esc(a.pos)} · ${esc(a.team)}</small></span><span class="hv">${fmt(scale(a.value))}</span></li>`).join("");
  $("homeAsOf").textContent = homeData.updated ? `Expert consensus via FantasyPros, updated ${updatedAgo(homeData.updated)}.` : "";
  // Sample trade: a top-3 player for the two good starters that come closest to fair, graded the
  // same way the calculator grades trades (so the value adjustment shows up)
  const one = list[2];
  if (!one){ $("homeTrade").innerHTML = ""; return; }
  const v1 = scale(one.value), keep = S.replacement; S.replacement = 1000;  // a typical waiver level for a 12-team league
  const grade = two => { const v2 = two.map(a => scale(a.value)), t1 = tradeValue([v1], v2), t2 = tradeValue(v2, [v1]), raw2 = v2[0] + v2[1];
    const adj = Math.max(0, Math.round((raw2 - t2) - (v1 - t1))); return { two, raw2, adj, gap: raw2 - (v1 + adj) }; };
  let best = null;
  for (let i = 6; i < 40 && i < list.length; i++) for (let k = i + 1; k < 50 && k < list.length; k++){
    if (list[i].pos === list[k].pos && list[i].pos === one.pos) continue;      // keep it varied
    const g = grade([list[i], list[k]]); if (!best || Math.abs(g.gap) < Math.abs(best.gap)) best = g;
  }
  S.replacement = keep;
  const { two, raw2, adj, gap } = best, e1 = v1 + adj, call = tradeCall(gap, Math.max(e1, raw2));
  const verdict = call === "fair" ? "Fair trade" : call === "lopsided" ? (gap > 0 ? "Lopsided: the two-player side wins big" : "Lopsided: the star side wins big") : gap > 0 ? `The two-player side wins by ${fmt(gap)}` : `The star side wins by ${fmt(-gap)}`;
  const row = a => `<div class="ht-row"><span><b>${esc(a.name)}</b><small>${esc(a.pos)} · ${esc(a.team)}</small></span><span>${fmt(scale(a.value))}</span></div>`;
  $("homeTrade").innerHTML = `<div class="ht-sides">
      <div class="ht-side"><div class="ht-lbl">Team A sends</div>${row(one)}${adj ? `<div class="ht-row ht-adj"><span><b>Value adjustment</b><small>one star beats two good players</small></span><span>+${fmt(adj)}</span></div>` : ""}<div class="ht-total">${fmt(e1)}</div></div>
      <div class="ht-side"><div class="ht-lbl">Team B sends</div>${two.map(row).join("")}<div class="ht-total">${fmt(raw2)}</div></div>
    </div><p class="ht-verdict ${call === "fair" ? "fair" : ""}">${esc(verdict)}</p>`;
}
getValuesFile().then(d => { homeData = d; renderHome(); }).catch(() => { $("homeExtra").hidden = true; });
$("homeFormat").addEventListener("click", e => { const b = e.target.closest("button[data-f]"); if (!b) return; homeFormat = b.dataset.f; renderHome(); });
$("homeTry").addEventListener("click", () => { window.scrollTo({ top: 0, behavior: "smooth" }); setTimeout(() => $("username").focus(), 300); });

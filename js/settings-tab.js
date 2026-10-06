// Front Office: League Settings tab
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// LEAGUE SETTINGS TAB
// ============================================================
function kv(el, pairs){ el.innerHTML = pairs.filter(p => p[1] !== null && p[1] !== undefined && p[1] !== "").map(([k,v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join(""); }
const pts = n => (n>0?"+":"") + (Math.round(n*100)/100);
function renderSettings(){
  const c = S.cfg, sc = c.sc, st = c.st;
  kv($("setFormat"), [
    ["League type", c.dynasty ? "Dynasty" : st.type === 1 ? "Keeper" : "Redraft"],
    ["Teams", c.teams],
    ["Quarterbacks", c.superflex ? "Superflex" : "1QB"],
    ["Season", S.league.season],
    ["Playoff teams", st.playoff_teams],
    ["Trade deadline", st.trade_deadline ? (st.trade_deadline >= 99 ? "None" : "Week " + st.trade_deadline) : null],
    ["FAAB budget", st.waiver_budget != null ? "$" + st.waiver_budget : null],
    ["Rookie draft rounds", c.rounds]
  ]);
  const order = ["QB","RB","WR","TE","FLEX","WRRB_FLEX","REC_FLEX","SUPER_FLEX","K","DEF","DL","LB","DB","IDP_FLEX"];
  const label = {FLEX:"FLEX",WRRB_FLEX:"W/R",REC_FLEX:"W/T",SUPER_FLEX:"SF",IDP_FLEX:"IDP"};
  const starters = c.rp.filter(x => !["BN","IR","TAXI"].includes(x));
  const counts = {}; starters.forEach(x => counts[x]=(counts[x]||0)+1);
  const keys = Object.keys(counts).sort((a,b) => (order.indexOf(a)+99*(order.indexOf(a)<0)) - (order.indexOf(b)+99*(order.indexOf(b)<0)));
  $("setSlots").innerHTML = keys.map(k => `<span class="slot">${esc(label[k]||k)}${counts[k]>1?" ×"+counts[k]:""}</span>`).join("")
    + `<span class="slot bench">BN ×${c.rp.filter(x=>x==="BN").length}</span>`;
  kv($("setRoster"), [
    ["Starters", starters.length],
    ["Bench", c.rp.filter(x=>x==="BN").length],
    ["Taxi squad", st.taxi_slots || null],
    ["Injured reserve", st.reserve_slots || null]
  ]);
  const yd = (v, per) => v ? `1 per ${Math.round(1/v)} yds` : null;
  kv($("setScoring"), [
    ["Reception", sc.rec != null ? pts(sc.rec) : "0"],
    ["TE reception bonus", sc.bonus_rec_te ? pts(sc.bonus_rec_te) : null],
    ["RB reception bonus", sc.bonus_rec_rb ? pts(sc.bonus_rec_rb) : null],
    ["WR reception bonus", sc.bonus_rec_wr ? pts(sc.bonus_rec_wr) : null],
    ["Passing TD", sc.pass_td != null ? pts(sc.pass_td) : null],
    ["Passing yards", yd(sc.pass_yd)],
    ["Interception", sc.pass_int ? pts(sc.pass_int) : null],
    ["Rushing TD", sc.rush_td != null ? pts(sc.rush_td) : null],
    ["Rushing yards", yd(sc.rush_yd)],
    ["Receiving TD", sc.rec_td != null ? pts(sc.rec_td) : null],
    ["Receiving yards", yd(sc.rec_yd)],
    ["Rush attempt", sc.rush_att ? pts(sc.rush_att) : null],
    ["First down bonus", sc.rec_fd || sc.rush_fd ? "Yes" : null],
    ["Fumble lost", sc.fum_lost ? pts(sc.fum_lost) : null]
  ]);
  const A = S.accuracy;
  const accLi = A ? `<li><span class="mult">Check</span><span class="why">Accuracy on your league's ${A.n} trades<small>Using Front Office values, the two sides of your league's real trades come out ${Math.round(A.fo * 1000) / 10}% apart on average, vs ${Math.round(A.mk * 1000) / 10}% using plain market values${A.fo < A.mk ? `, so these values match how your league actually trades ${Math.round((1 - A.fo / A.mk) * 100)}% better` : A.fo > A.mk ? ". Plain market values fit your league's trades slightly better right now" : ""}. Recent trades count more.</small></span></li>` : "";
  $("setRules").innerHTML = (S.rules.length
    ? S.rules.map(x => `<li><span class="mult">${esc(x.m)}</span><span class="why">${esc(x.t)}<small>${esc(x.d)}</small></span></li>`).join("")
    : `<li><span class="why">Standard settings<small>This league matches the baseline (12 teams, 1QB, full PPR), so values match the market.</small></span></li>`) + accLi;
  // positional share
  const players = [...S.assets.values()].filter(a => a.kind === "player");
  const shareOf = key => {
    const top = [...players].sort((a,b) => b[key]-a[key]).slice(0,150);
    const tot = top.reduce((s,a)=>s+a[key],0) || 1, out = {};
    for (const p of ["QB","RB","WR","TE"]) out[p] = top.filter(a=>a.pos===p).reduce((s,a)=>s+a[key],0)/tot*100;
    return out;
  };
  const L = shareOf("value"), M = shareOf("market"), max = Math.max(...Object.values(L), ...Object.values(M));
  $("setShare").innerHTML = ["QB","RB","WR","TE"].map(p => `<b>${p}</b><div class="bars"><div class="bar l" style="width:${L[p]/max*100}%"></div><div class="bar m" style="width:${M[p]/max*100}%"></div></div><span>${Math.round(L[p])}%</span>`).join("");
}


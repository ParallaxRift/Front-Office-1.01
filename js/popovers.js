// Front Office: Popovers: team statuses, value adjustment, column definitions
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// POPOVERS: status meanings and the value adjustment explainer
// ============================================================
const STATUS_INFO = {
  contend: ["Contender", "The strongest third of the league by roster strength (and, as the season goes on, playoff odds). Built to win now, so Front Office steers contenders toward proven starters."],
  middle:  ["Middle", "The middle third. Close enough to push for a title or start a retool; age and draft picks decide which way Front Office leans."],
  rebuild: ["Rebuilding", "The weakest third. Better served building for the future, so recommendations favor young players and draft picks."]
};
let popEl = null;
function closePop(){ popEl?.remove(); popEl = null; }
let popScrollY = 0;
function showPop(anchor, html){
  closePop();
  popEl = document.createElement("div"); popEl.className = "pop"; popEl.setAttribute("role", "dialog");
  popEl.innerHTML = `<button type="button" class="pop-x" aria-label="Close">✕</button>` + html;
  document.body.appendChild(popEl);
  const r = anchor.getBoundingClientRect(), w = popEl.offsetWidth, h = popEl.offsetHeight;
  let left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  let top = r.bottom + 8; if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
  popEl.style.left = left + "px"; popEl.style.top = top + "px";
  // the page is zoomed on computers: if the popup lands off by the zoom, scale the spot back so it sits under its button
  const got = popEl.getBoundingClientRect(), k = left > 0 ? got.left / left : 1;
  if (Math.abs(k - 1) > 0.01){ popEl.style.left = (left / k) + "px"; popEl.style.top = (top / k) + "px";
    const g2 = popEl.getBoundingClientRect(); if (g2.right > window.innerWidth - 8) popEl.style.left = ((window.innerWidth - 8 - g2.width) / k) + "px"; }
  popEl.querySelector(".pop-x").focus({ preventScroll: true });
  popScrollY = window.scrollY;
}
function openStatusKey(){
  closePop();
  $("tabs").querySelector('[data-tab="statuses"]').click();   // works in either mode
  const key = document.querySelector(".status-key");
  if (key){ key.scrollIntoView({ behavior: "smooth", block: "center" }); key.classList.add("flash"); setTimeout(() => key.classList.remove("flash"), 1600); }
}
document.addEventListener("click", e => {
  if (popEl && e.target.closest(".pop-x")){ closePop(); return; }
  if (popEl && e.target.closest(".pop-link")){ openStatusKey(); return; }
  const badge = e.target.closest(".badge.b-contend, .badge.b-middle, .badge.b-rebuild");
  if (badge){
    e.preventDefault(); e.stopPropagation();
    const k = badge.classList.contains("b-contend") ? "contend" : badge.classList.contains("b-middle") ? "middle" : "rebuild";
    showPop(badge, `<h4>${STATUS_INFO[k][0]}</h4><p>${STATUS_INFO[k][1]}</p><button type="button" class="pop-link">See What the Team Statuses Mean</button>`);
    return;
  }
  // Sleeper trending tag (▲16.3k / ▼2.1k): what the number means
  const trend = e.target.closest(".trend[data-why]");
  if (trend){
    e.preventDefault(); e.stopPropagation();
    showPop(trend, `<h4>Sleeper Trending</h4><p><b>${esc(trend.dataset.why)}.</b></p><p>${TREND_INFO}</p>`);
    return;
  }
  const info = e.target.closest(".info-btn[data-info]");
  if (info && (info.dataset.info === "adjust" || COLUMN_INFO[info.dataset.info])){
    e.preventDefault(); e.stopPropagation();
    const c = COLUMN_INFO[info.dataset.info];
    showPop(info, c ? `<h4>${c[0]}</h4><p>${c[1]}</p>` : ADJUST_INFO_HTML); return; }
  if (popEl && !e.target.closest(".pop")) closePop();
}, true);
document.addEventListener("keydown", e => { if (e.key === "Escape") closePop(); });
document.addEventListener("keydown", e => {   // Enter or Space on a trending tag opens its explanation
  const t = (e.key === "Enter" || e.key === " ") && e.target.closest?.(".trend[data-why]");
  if (t){ e.preventDefault(); e.stopPropagation(); t.click(); }
}, true);
// close on a real scroll, not the few pixels the browser may move while opening the popup
window.addEventListener("scroll", () => { if (popEl && Math.abs(window.scrollY - popScrollY) > 40) closePop(); }, { passive: true });

// What the green ▲ / red ▼ trending tags next to player names mean
const TREND_INFO = "This tag comes from Sleeper and counts every Sleeper league, not just yours. It's how many more leagues added this player than dropped him in the last 24 hours. <b>▲ green</b> means more adds than drops; <b>▼ red</b> means more drops than adds. \"k\" means thousands, so ▲16.3k is about 16,300 more leagues adding him. Only moves of 300 or more show. A big jump usually follows news: a breakout game, a new role, or an injury to the player ahead of him. It's a heads-up, not part of his Front Office value.";
const COLUMN_INFO = {
  "col-league": ["This League", "The player's value in your league after all of Front Office's adjustments. This is the number the calculator uses."],
  "col-market": ["Market", "The same player's value from Front Office Rankings, before any league adjustments. It shows what he'd be worth in a generic league as a single value."],
  "col-power": ["Power", "A 0-100 score that blends two things. <b>Roster strength</b> is how good the roster is on paper, from player values. <b>Title odds</b> add what's happening on the field: record, injuries, points scored and which way the team is trending. Title odds count for 25% before any games and grow 5 points a week, up to 60% by Week 7, so early on the best rosters lead and late in the season results matter most. 100 is the top team. The Power Rankings page lists teams in this order."],
  "col-odds": ["Title Odds", "Each team's chance to win the championship. Front Office plays out the rest of the season and the playoffs thousands of times. Every team starts from its <b>current record</b>. Each week's score comes from its best healthy lineup (<b>roster strength</b> from player values, with <b>injured players</b> left out until their estimated return), blended with the <b>points it has actually scored</b> and its <b>recent trend</b> (last 3 weeks vs. earlier), which count for more as the season goes on. Points against is mostly luck, the other team's score, so it only counts through the wins and losses already on the record. Odds move a point or two between updates."],
  "col-strength": ["Roster Strength", "The combined Front Office value of the team's best possible starting lineup plus its three most valuable bench players, using your league's values (the same numbers as the Trade Calculator). A top player is worth up to 10,000, so in most leagues teams land somewhere between about 40,000 and 80,000. It measures talent only. Wins, record and draft picks don't count."],
  "col-netv": ["Net Value from Trades", "Everything this manager has received in trades minus everything they've given up, using today's player values (picks already used count as the player they became). A positive number means their trades have aged well; negative means they've given up more than they got. Each trade is graded with the same value adjustment as the Trade Calculator, so a pile of depth doesn't beat a star."],
  "col-change": ["Change", "The % difference between your league's values after all logic is applied and the singular generic market value. It stays blank when the difference is under 1%."]
};
const ADJUST_INFO_HTML = `<h4>What Is the Value Adjustment?</h4>
  <p>A fantasy roster has limited spots and limited starters, so one difference-maker is worth more than the same total value spread across several lesser players. Front Office adds a bonus to the side giving up the best piece, so a pile of depth can't "equal" a star.</p>
  <h4>How Is It Worked Out?</h4>
  <p>Each side's best asset counts at full value. Additional pieces still add value, but with diminishing impact, because roster spots and starting slots are limited. The farther an added piece is from the top asset it's being traded for, the less of its value counts toward closing a star-for-depth gap, and that effect grows gradually as the top asset gets closer to elite (there's no hard "stud" line).</p>
  <p>If one side receives more players than the other, it's also charged for the net extra roster spots, at your league's replacement level (the best player no team has room for). That charge comes off the smallest pieces and never exceeds what they're worth, so adding an asset never lowers a side's value.</p>
  <p>Each side's effective value is its raw value minus those reductions. The value adjustment is the difference between the two sides' reductions, added to the side that lost less. It uses league market values only; how the trade fits each roster is shown separately as lineup impact. With enough trades, how strong the diminishing effect is gets fit to your league's own trades.</p>
  <p>The approximate balancing piece is a player on the other roster with a market value near the adjustment: a practical idea of what could close the gap, not an exact match, since position and roster fit still matter.</p>`;


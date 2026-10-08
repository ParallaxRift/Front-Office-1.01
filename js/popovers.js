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
  const info = e.target.closest(".info-btn[data-info]");
  if (info && (info.dataset.info === "adjust" || COLUMN_INFO[info.dataset.info])){
    e.preventDefault(); e.stopPropagation();
    const c = COLUMN_INFO[info.dataset.info];
    showPop(info, c ? `<h4>${c[0]}</h4><p>${c[1]}</p>` : ADJUST_INFO_HTML); return; }
  if (popEl && !e.target.closest(".pop")) closePop();
}, true);
document.addEventListener("keydown", e => { if (e.key === "Escape") closePop(); });
// close on a real scroll, not the few pixels the browser may move while opening the popup
window.addEventListener("scroll", () => { if (popEl && Math.abs(window.scrollY - popScrollY) > 40) closePop(); }, { passive: true });

const COLUMN_INFO = {
  "col-league": ["This League", "The player's value in your league after all of Front Office's adjustments. This is the number the calculator uses."],
  "col-market": ["Market", "The same player's value from the generic rankings, before any league adjustments. It shows what he'd be worth in a generic league as a single value."],
  "col-change": ["Change", "The % difference between your league's values after all logic is applied and the singular generic market value. It stays blank when the difference is under 1%."]
};
const ADJUST_INFO_HTML = `<h4>What Is the Value Adjustment?</h4>
  <p>A fantasy roster has limited spots and limited starters, so one difference-maker is worth more than the same total value spread across several lesser players. Front Office adds a bonus to the side giving up the best piece, so a pile of depth can't "equal" a star.</p>
  <h4>How Is It Worked Out?</h4>
  <p>Each side's best asset counts at full value. Additional pieces still add value, but with diminishing impact, because roster spots and starting slots are limited. The farther an added piece is from the top asset it's being traded for, the less of its value counts toward closing a star-for-depth gap, and that effect grows gradually as the top asset gets closer to elite (there's no hard "stud" line).</p>
  <p>If one side receives more players than the other, it's also charged for the net extra roster spots, at your league's replacement level (the best player no team has room for). That charge comes off the smallest pieces and never exceeds what they're worth, so adding an asset never lowers a side's value.</p>
  <p>Each side's effective value is its raw value minus those reductions. The value adjustment is the difference between the two sides' reductions, added to the side that lost less. It uses league market values only; how the trade fits each roster is shown separately as lineup impact. With enough trades, how strong the diminishing effect is gets fit to your league's own trades.</p>
  <p>The approximate balancing piece is a player on the other roster with a market value near the adjustment: a practical idea of what could close the gap, not an exact match, since position and roster fit still matter.</p>`;


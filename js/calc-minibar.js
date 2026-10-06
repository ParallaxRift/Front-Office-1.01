// Front Office: phone trade summary bar
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// On phones the rosters are long, so the trade summary scrolls out of view while you
// add players. This slim bar stays pinned to the bottom of the screen with both totals
// and the verdict; tap it to jump back to the full summary.
// ============================================================
const MINIBAR_MAX_WIDTH = 720;
let boardInView = true;
function updateMiniBar(){
  const bar = $("miniBar"); if (!bar) return;
  const hasTrade = S.sendIds.size + S.getIds.size > 0;
  const show = hasTrade && !boardInView && window.innerWidth <= MINIBAR_MAX_WIDTH && $("panel-calc").classList.contains("on") && $("board").style.display !== "none";
  bar.hidden = !show;
  if (!show) return;
  $("mbSend").textContent = $("sendNum").textContent; $("mbGet").textContent = $("getNum").textContent;
  $("mbVerdict").textContent = $("verdict").textContent;
  const f = $("fill").classList; bar.dataset.result = f.contains("win") ? "win" : f.contains("lose") ? "lose" : f.contains("even") ? "even" : "";
}
new IntersectionObserver(es => { boardInView = es[0].isIntersecting; updateMiniBar(); }).observe($("board"));
new MutationObserver(updateMiniBar).observe($("verdict"), { childList: true, characterData: true, subtree: true });
new MutationObserver(updateMiniBar).observe($("panel-calc"), { attributes: true, attributeFilter: ["class"] });
window.addEventListener("resize", updateMiniBar, { passive: true });
$("miniBar").addEventListener("click", () => window.scrollTo({ top: Math.max(0, $("board").getBoundingClientRect().top + window.scrollY - 10), behavior: "smooth" }));

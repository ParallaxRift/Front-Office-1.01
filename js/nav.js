// Front Office: sections (grouped navigation)
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// SECTIONS
// The tabs are grouped into four sections: Trade, Player Values, My Team and League.
// The section bar picks a section; the row under it (only when a section has more
// than one tab) picks the tab inside it. The tab buttons themselves are unchanged,
// so every other part of the site still opens a tab the same way.
// Feedback & Build Notes moved to the footer.
// ============================================================
const NAV_GROUPS = [
  { id: "trade",  label: "Trade",         tabs: ["calc", "finder", "history"] },
  { id: "values", label: "Player Values", tabs: ["values"] },
  { id: "team",   label: "My Team",       tabs: ["strategy"] },
  { id: "league", label: "League",        tabs: ["standings", "trophy", "scores"] },
  { id: "more",   label: "Feedback",      tabs: ["feedback"], footer: true }
];
const navGroupOf = tab => NAV_GROUPS.find(g => g.tabs.includes(tab));
const navTab = tab => $("tabs").querySelector(`[data-tab="${tab}"]`);
const navLast = {};   // last tab opened in each section
$("groups").innerHTML = NAV_GROUPS.filter(g => !g.footer).map(g => `<button type="button" class="group" data-group="${g.id}" aria-pressed="false">${esc(g.label)}</button>`).join("");
for (const t of $("tabs").children) t.dataset.group = navGroupOf(t.dataset.tab)?.id || "";

function syncNav(){
  const open = $("tabs").querySelector('.tab[aria-selected="true"]');
  const active = open ? navGroupOf(open.dataset.tab) : null;
  if (open) navLast[active.id] = open.dataset.tab;
  const visibleIn = g => g.tabs.map(navTab).filter(t => t && !t.hidden);
  for (const b of $("groups").children){
    const g = NAV_GROUPS.find(x => x.id === b.dataset.group), vis = visibleIn(g);
    b.hidden = !vis.length;
    b.setAttribute("aria-pressed", active === g);
    // a section with a single tab is named after that tab (in The Basics, "Trade" is just the calculator)
    b.textContent = g.tabs.length > 1 && vis.length === 1 ? vis[0].dataset.full : g.label;
  }
  for (const t of $("tabs").children) t.classList.toggle("off-group", !active || t.dataset.group !== active.id);
  $("tabs").classList.toggle("single", !active || visibleIn(active).length < 2);
  const fb = navTab("feedback");
  $("footFeedback").hidden = !S.league || !fb || fb.hidden;
}
$("groups").addEventListener("click", e => {
  const b = e.target.closest(".group"); if (!b) return;
  const g = NAV_GROUPS.find(x => x.id === b.dataset.group);
  const pick = [navLast[g.id], ...g.tabs].map(x => x && navTab(x)).find(t => t && !t.hidden);
  if (pick) pick.click(); else syncNav();
});
$("footFeedback").addEventListener("click", e => {
  e.preventDefault();
  navTab("feedback")?.click();
  window.scrollTo({ top: $("groups").offsetTop - 10, behavior: "smooth" });
});
// keep the section bar in step with whatever opens a tab (clicks, links, The Basics / Freakshow, reloads)
new MutationObserver(syncNav).observe($("tabs"), { subtree: true, attributes: true, attributeFilter: ["aria-selected", "hidden"] });
$("settingsBtn").addEventListener("click", () => setTimeout(syncNav));
function navRevealTargets(tabs){ return [...new Set(tabs.map(t => $("groups").querySelector(`[data-group="${t.dataset.group}"]`)).filter(b => b && !b.hidden))]; }
syncNav();

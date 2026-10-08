// Front Office: page routing (runs last)
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// PAGE ROUTING: #about, #terms, #privacy, #modes and #beta open their own pages; anything else shows the app
// ============================================================
function route(){
  let page = location.hash.slice(1);
  if (page === "tuning") page = "about";          // older links to the tuning section
  const pages = { about: ["aboutView", "About Front Office"], terms: ["termsView", "Terms of Use | Front Office"], privacy: ["privacyView", "Privacy | Front Office"], beta: ["betaView", "Sleeper Leagues in Beta | Front Office"], modes: ["modesView", "The Basics vs. Freakshow | Front Office"] };
  for (const [k, [id]] of Object.entries(pages)) $(id).hidden = page !== k;
  $("appView").hidden = !!pages[page];
  document.title = pages[page] ? pages[page][1] : "Front Office";
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", route);
route();
try { localStorage.removeItem("fo_about_ok"); } catch(e){}   // forget unlocks saved by older versions

// Front Office: page routing (runs last)
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// PAGE ROUTING: #modes and #beta open their own pages; anything else shows the app
// ============================================================
function route(){
  let page = location.hash.slice(1);
  // The About page was removed; old links to it (#about, #tuning) open the app
  if (page === "about" || page === "tuning"){ history.replaceState(null, "", location.pathname + location.search); page = ""; }
  const pages = { beta: ["betaView", "Sleeper Leagues in Beta | Front Office"], modes: ["modesView", "The Basics vs. Freakshow | Front Office"] };
  $("betaView").hidden = page !== "beta";
  $("modesView").hidden = page !== "modes";
  $("appView").hidden = !!pages[page];
  document.title = pages[page] ? pages[page][1] : "Front Office";
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", route);
route();
try { localStorage.removeItem("fo_about_ok"); } catch(e){}   // forget unlocks saved by older versions

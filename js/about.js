// Front Office: About page and page routing (runs last)
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// ABOUT PAGE: shown when the address ends in #about
// ============================================================
// About page password. Only a fingerprint (SHA-256 hash) of the password is stored here, not the password itself.
// NOTE: this keeps casual visitors out, but it isn't true security: the page's text is still inside this file.
const ABOUT_PW_HASH = "c0d96d34dea3af284012631b2609a0c7975b92e8178e4cfface8c545d3644a81";
async function sha256(text){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
// Unlocks only for this visit to the About page. Leaving the page locks it again.
let aboutOpen = false;
const aboutUnlocked = () => aboutOpen;
try { localStorage.removeItem("fo_about_ok"); } catch(e){}   // forget unlocks saved by older versions
$("lockForm").addEventListener("submit", async e => {
  e.preventDefault();
  const st = $("lockStatus");
  try {
    if (await sha256($("lockPw").value) === ABOUT_PW_HASH){ aboutOpen = true; $("lockPw").value = ""; st.textContent = ""; route(); }
    else { st.textContent = "That password isn't right."; st.className = "status error"; $("lockPw").select(); }
  } catch(err){ st.textContent = "Couldn't check the password in this browser."; st.className = "status error"; }
});
function route(){
  let page = location.hash.slice(1), section = null;
  if (page === "tuning"){ page = "about"; section = "tuning"; }
  if (page !== "about") aboutOpen = false;          // leaving About locks it again
  const pages = { about: ["aboutView", "About Front Office"], beta: ["betaView", "Sleeper Leagues in Beta | Front Office"], modes: ["modesView", "The Basics vs. Freakshow | Front Office"] };
  const locked = page === "about" && !aboutUnlocked();
  $("lockView").hidden = !locked;
  if (locked){ $("aboutView").hidden = true; $("betaView").hidden = true; $("modesView").hidden = true; $("appView").hidden = true; document.title = "About Front Office"; window.scrollTo({ top: 0 }); setTimeout(() => $("lockPw").focus(), 50); return; }
  $("aboutView").hidden = page !== "about";
  $("betaView").hidden = page !== "beta";
  $("modesView").hidden = page !== "modes";
  $("appView").hidden = !!pages[page];
  document.title = pages[page] ? pages[page][1] : "Front Office";
  if (section) requestAnimationFrame(() => $(section)?.scrollIntoView({ block: "start" }));
  else window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", route);
getValuesFile().then(d => {
  const n = Math.max(+d.experts_1qb || 0, +d.experts_sf || 0);
  if (n > 0) document.querySelectorAll(".expertCount").forEach(el => el.textContent = n);
}).catch(() => {});
route();

// Front Office: phone app frame (bottom tab bar, More menu) and install support
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// PHONE APP FRAME
// On phones (600px wide or less) the site works like an app: a slim header, a tab bar pinned to
// the bottom (Trade, Values, My Team, League, Scores, More), and a More menu for everything else.
// Desktop never shows any of this; it's all hidden by the stylesheet above 600px.
// It also registers the service worker, so the site can be added to a phone's home screen.
// ============================================================
const isPhoneView = () => window.matchMedia("(max-width:600px)").matches;
const TB_ICONS = {
  trade:  '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  values: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  team:   '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.9-4 4-6 7.5-6s6.6 2 7.5 6"/>',
  league: '<path d="M8 4h8v3a4 4 0 0 1-8 0V4zM6 5H4v1.5A3.5 3.5 0 0 0 7.5 10M18 5h2v1.5a3.5 3.5 0 0 1-3.5 3.5M12 11v4M8.5 20h7l-.8-5H9.3z"/>',
  scores: '<rect x="3" y="4" width="18" height="14" rx="2.5"/><path d="M12 4v14M8 21h8"/><path d="M6.5 9.5h2M7.5 8.5v2M15.5 9.5h2M15.5 12.5h2"/>',
  more:   '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
};
const TB_ITEMS = [["trade", "Trade"], ["values", "Values"], ["team", "My Team"], ["league", "League"], ["scores", "Scores"], ["more", "More"]];
const tabbar = document.createElement("nav");
tabbar.className = "tabbar"; tabbar.id = "tabbar"; tabbar.setAttribute("aria-label", "Main");
tabbar.innerHTML = TB_ITEMS.map(([k, label]) => `<button type="button" data-go="${k}" aria-current="false"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TB_ICONS[k]}</svg><span>${label}</span></button>`).join("");
document.body.appendChild(tabbar);

// More menu: a sheet that slides up from the bottom
const moreSheet = document.createElement("div");
moreSheet.className = "more-sheet"; moreSheet.id = "moreSheet"; moreSheet.hidden = true;
moreSheet.innerHTML = `<div class="ms-backdrop" data-close></div>
  <div class="ms-panel" role="dialog" aria-modal="true" aria-label="More">
    <div class="ms-grab" aria-hidden="true"></div>
    <div class="ms-list">
      <button type="button" data-more="feedback"><b>Feedback &amp; Build Notes</b><small>Report a bug, suggest an idea, see what's new</small></button>
      <button type="button" data-more="settings"><b>League Settings</b><small>Scoring, lineup and how they change values</small></button>
      <div class="ms-mode"><span>View</span><div class="ms-toggle" id="msMode"><button type="button" data-mode="basics">The Basics</button><button type="button" data-mode="freak">Freakshow</button></div></div>
      <button type="button" data-more="modes"><b>The Basics vs. Freakshow</b><small>What each view shows</small></button>
      <button type="button" data-more="about"><b>About Front Office</b><small>How the values work</small></button>
      <button type="button" data-more="switch"><b>Switch league</b><small>Open a different Sleeper league</small></button>
    </div>
    <p class="ms-fine">Expert consensus rankings provided by FantasyPros. Not affiliated with Sleeper or FantasyPros. <span id="msVersion"></span></p>
  </div>`;
document.body.appendChild(moreSheet);
const openMore = () => { syncModeButtons(); $("msVersion").textContent = [$("footVersion")?.textContent, $("footUpdated")?.textContent].filter(Boolean).join(" · "); moreSheet.hidden = false; requestAnimationFrame(() => moreSheet.classList.add("open")); };
const closeMore = () => { moreSheet.classList.remove("open"); setTimeout(() => { moreSheet.hidden = true; }, 200); };
moreSheet.addEventListener("click", e => {
  if (e.target.closest("[data-close]")) return closeMore();
  const m = e.target.closest("#msMode button"); if (m){ applyMode(m.dataset.mode, true); syncModeButtons(); return; }
  const b = e.target.closest("[data-more]"); if (!b) return;
  const go = b.dataset.more; closeMore();
  if (go === "feedback") $("groups").querySelector('[data-group="more"]')?.click();
  else if (go === "settings") openSettingsPanel();
  else if (go === "about") location.hash = "#about";
  else if (go === "modes") location.hash = "#modes";
  else if (go === "switch") $("switchLeague").click();
  window.scrollTo({ top: 0 });
});

tabbar.addEventListener("click", e => {
  const b = e.target.closest("button[data-go]"); if (!b) return;
  if (b.dataset.go === "more") return moreSheet.hidden ? openMore() : closeMore();
  closeMore();
  const g = { trade: "trade", values: "values", team: "team", league: "league", scores: "scores" }[b.dataset.go];
  $("groups").querySelector(`[data-group="${g}"]`)?.click();
  if (location.hash && location.hash !== "#") location.hash = "";
  window.scrollTo({ top: 0 });
});
// Highlight the tab for whatever is open; hide tabs The Basics doesn't use
function syncTabbar(){
  const open = $("groups").querySelector('.group[aria-pressed="true"]')?.dataset.group;
  const settings = $("settingsBtn").getAttribute("aria-pressed") === "true";
  const cur = settings || open === "more" ? "more" : open || "";
  for (const b of tabbar.children){
    b.setAttribute("aria-current", b.dataset.go === cur ? "page" : "false");
    if (b.dataset.go !== "more"){ const gb = $("groups").querySelector(`[data-group="${b.dataset.go}"]`); b.hidden = !gb || gb.hidden; }
  }
  const msFb = moreSheet.querySelector('[data-more="feedback"]'), fb = $("groups").querySelector('[data-group="more"]');
  if (msFb) msFb.hidden = !fb || fb.hidden;
}
new MutationObserver(syncTabbar).observe($("groups"), { subtree: true, attributes: true, attributeFilter: ["aria-pressed", "hidden"] });
new MutationObserver(syncTabbar).observe($("settingsBtn"), { attributes: true, attributeFilter: ["aria-pressed"] });
syncTabbar();

// The Basics / Freakshow switch: in the More menu, and on the home page on phones
function syncModeButtons(){
  const m = currentMode();
  for (const id of ["msMode", "homeMode"]) for (const b of ($(id)?.children || [])) b.setAttribute("aria-pressed", b.dataset.mode === m);
}
{ const card = document.querySelector("#connect .ccard");
  if (card){
    const box = document.createElement("div"); box.className = "home-mode";
    box.innerHTML = `<span>View</span><div class="ms-toggle" id="homeMode"><button type="button" data-mode="basics">The Basics</button><button type="button" data-mode="freak">Freakshow</button></div><a href="#modes">What's the difference?</a>`;
    card.appendChild(box);
    box.addEventListener("click", e => { const b = e.target.closest("button[data-mode]"); if (!b) return; applyMode(b.dataset.mode, true); syncModeButtons(); });
  }
  syncModeButtons();
}

// ---------- Install as an app ----------
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost"))
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(e => console.info("Service worker not registered", e.message)));
// A one-time tip on phones that haven't installed it yet
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let installPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; showInstallTip(); });
function showInstallTip(){
  if (!isPhoneView() || standalone() || store.get("fo_install_tip") === "done" || $("installTip")) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!ios && !installPrompt) return;
  const tip = document.createElement("div"); tip.className = "install-tip"; tip.id = "installTip";
  tip.innerHTML = `<img src="icons/icon-192.png" alt=""><span><b>Get the Front Office app</b><small>${ios ? 'Tap <b>Share</b> <span aria-hidden="true">⎋</span>, then <b>Add to Home Screen</b>.' : "Install it on your home screen. It opens full screen, like an app."}</small></span>${installPrompt ? '<button type="button" class="btn" data-install>Install</button>' : ""}<button type="button" class="it-x" aria-label="Dismiss">✕</button>`;
  document.body.appendChild(tip);
  tip.addEventListener("click", async e => {
    if (e.target.closest("[data-install]") && installPrompt){ installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; }
    else if (!e.target.closest(".it-x")) return;
    store.set("fo_install_tip", "done"); tip.remove();
  });
}
setTimeout(showInstallTip, 2500);

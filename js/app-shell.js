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
const TB_ITEMS = [["trade", "Trade"], ["values", "Rankings"], ["team", "My Team"], ["league", "League"], ["scores", "Scores"], ["more", "More"]];
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
      <button type="button" data-more="statuses"><b>Team Statuses</b><small>Who's contending, in the middle or rebuilding, and why</small></button>
      <button type="button" data-more="modes"><b>The Basics vs. Freakshow</b><small>What each view shows</small></button>
      <button type="button" data-more="about"><b>About Front Office</b><small>What Front Office does, credits, terms and privacy</small></button>
      <button type="button" data-more="getapp" class="ms-getapp"><b>Get the app</b><small>Add Front Office to your home screen</small></button>
      <div class="ms-mode"><span>View</span><div class="ms-toggle" id="msMode"><button type="button" data-mode="basics">The Basics</button><button type="button" data-mode="freak">Freakshow</button></div></div>
    </div>
    <p class="ms-fine">League data from Sleeper. Not affiliated with Sleeper. <span id="msVersion"></span></p>
  </div>`;
document.body.appendChild(moreSheet);
const openMore = () => { syncModeButtons(); $("msVersion").textContent = [$("footVersion")?.textContent, $("footUpdated")?.textContent].filter(Boolean).join(" · "); moreSheet.hidden = false; requestAnimationFrame(() => moreSheet.classList.add("open")); };
const closeMore = () => { moreSheet.classList.remove("open"); setTimeout(() => { moreSheet.hidden = true; }, 200); };
moreSheet.addEventListener("click", e => {
  if (e.target.closest("[data-close]")) return closeMore();
  const m = e.target.closest("#msMode button"); if (m){ applyMode(m.dataset.mode, true); syncModeButtons(); return; }
  const b = e.target.closest("[data-more]"); if (!b) return;
  const go = b.dataset.more; closeMore();
  if (go === "statuses"){ navTab(go)?.click(); window.scrollTo({ top: 0 }); }
  else if (go === "getapp") return openAppGuide();
  else if (go === "modes") location.hash = "#modes";
  else if (go === "about") location.hash = "#about";
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
  const cur = settings ? "league" : open === "more" ? "more" : open || "";
  for (const b of tabbar.children){
    b.setAttribute("aria-current", b.dataset.go === cur ? "page" : "false");
    if (b.dataset.go !== "more"){ const gb = $("groups").querySelector(`[data-group="${b.dataset.go}"]`); b.hidden = !gb || gb.hidden; }
  }
  for (const k of ["statuses"]){ const b = moreSheet.querySelector(`[data-more="${k}"]`), t = navTab(k); if (b) b.hidden = !S.league || !t || t.hidden; }
}
new MutationObserver(syncTabbar).observe($("groups"), { subtree: true, attributes: true, attributeFilter: ["aria-pressed", "hidden"] });
new MutationObserver(syncTabbar).observe($("tabs"), { subtree: true, attributes: true, attributeFilter: ["hidden"] });
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
// ---------- "Get the app" guide (phones only) ----------
// Step-by-step help for adding Front Office to the home screen, with iPhone and Android tabs. It opens
// from the one-time tip, the More menu, and the home page. Hidden once the site is already installed.
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let installPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; syncInstallButtons(); showInstallTip(); });
window.addEventListener("appinstalled", () => { installPrompt = null; closeAppGuide(); $("installTip")?.remove(); store.set("fo_install_tip", "done"); syncInstallButtons(); });
const AG_IC = {
  share: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
  dots: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
  more: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>'
};
const agKey = t => `<span class="ag-key">${t}</span>`;
const appGuide = document.createElement("div");
appGuide.className = "more-sheet app-guide"; appGuide.id = "appGuide"; appGuide.hidden = true;
appGuide.innerHTML = `<div class="ms-backdrop" data-close></div>
  <div class="ms-panel" role="dialog" aria-modal="true" aria-labelledby="agTitle">
    <div class="ms-grab" aria-hidden="true"></div>
    <button type="button" class="ag-x" data-close aria-label="Close">✕</button>
    <div class="ag-head"><img src="icons/icon-192.png" alt=""><div><h3 id="agTitle">Get the Front Office app</h3>
      <p>Free, with no App Store download. Add it to your home screen and it opens full screen with its own icon, like any other app.</p></div></div>
    <div class="ms-toggle ag-os" role="tablist"><button type="button" role="tab" data-os="ios">iPhone</button><button type="button" role="tab" data-os="android">Android</button></div>
    <div class="ag-install" hidden><button type="button" class="btn" data-install>Install Front Office</button><small>One tap. Your phone asks you to confirm.</small></div>
    <div class="ag-demo" aria-hidden="true">
      <div class="agd-phone" data-for="ios">
        <div class="agd-f"><div class="agd-page"><i></i><i></i><i class="s"></i><i></i></div><div class="agd-bar bottom"><span>‹</span><span>›</span><span class="tap">${AG_IC.share}</span><span>${AG_IC.more}</span></div></div>
        <div class="agd-f"><div class="agd-page dim"><i></i><i></i></div><div class="agd-sheet"><b>Front Office</b><u>Copy</u><u>Add to Reading List</u><u class="tap">Add to Home Screen ${AG_IC.plus}</u><u>Find on Page</u></div></div>
        <div class="agd-f"><div class="agd-top"><span>Cancel</span><b>Add to Home Screen</b><span class="tap">Add</span></div><div class="agd-add"><img src="icons/icon-192.png" alt=""><span>Front Office</span></div></div>
        <div class="agd-f"><div class="agd-home"><i></i><i></i><i></i><i></i><i></i><i></i><img class="tap" src="icons/icon-192.png" alt=""><i></i></div></div>
      </div>
      <div class="agd-phone" data-for="android">
        <div class="agd-f"><div class="agd-bar top"><span class="url">front office</span><span class="tap">${AG_IC.dots}</span></div><div class="agd-page"><i></i><i></i><i class="s"></i><i></i></div></div>
        <div class="agd-f"><div class="agd-bar top"><span class="url">front office</span><span>${AG_IC.dots}</span></div><div class="agd-menu"><u>New tab</u><u>History</u><u class="tap">Add to home screen</u><u>Settings</u></div></div>
        <div class="agd-f"><div class="agd-page dim"><i></i><i></i></div><div class="agd-dialog"><img src="icons/icon-192.png" alt=""><b>Install app</b><span>Front Office</span><div><u>Cancel</u><u class="tap">Install</u></div></div></div>
        <div class="agd-f"><div class="agd-home"><i></i><i></i><i></i><i></i><i></i><i></i><img class="tap" src="icons/icon-192.png" alt=""><i></i></div></div>
      </div>
    </div>
    <ol class="ag-steps" data-for="ios">
      <li><b>Open this page in Safari.</b><span>Opened it from a link inside another app (Instagram, Facebook, a group chat)? Tap that app's menu and choose <b>Open in Safari</b> first. Chrome on iPhone works too.</span></li>
      <li><b>Tap the Share button</b> ${agKey(AG_IC.share)}<span>It's in the bar at the bottom of Safari (in Chrome, at the top right). If you only see ${agKey(AG_IC.more)}, tap that first, then <b>Share</b>.</span></li>
      <li><b>Tap Add to Home Screen</b> ${agKey(AG_IC.plus)}<span>Scroll down the list to find it. Not there? Tap <b>Edit Actions</b> at the bottom and add it.</span></li>
      <li><b>Tap Add</b><span>Top right corner. The green Front Office icon shows up on your home screen.</span></li>
    </ol>
    <ol class="ag-steps" data-for="android">
      <li><b>Open this page in Chrome.</b><span>Opened it from a link inside another app? Tap that app's menu and choose <b>Open in Chrome</b> (or Open in browser) first.</span></li>
      <li><b>Tap the menu</b> ${agKey(AG_IC.dots)}<span>The three dots at the top right of Chrome.</span></li>
      <li><b>Tap Add to home screen</b> or <b>Install app</b><span>Then tap <b>Install</b> (or <b>Add</b>) to confirm.</span></li>
      <li><b>Find the icon</b><span>The green Front Office icon is on your home screen (or in your app drawer). Using Samsung Internet? Tap ☰, then <b>Add page to</b>, then <b>Home screen</b>.</span></li>
    </ol>
    <p class="ag-fine">Your league, view and last tab are remembered, so the app opens right where you left off. To remove it later, press and hold the icon like any other app.</p>
    <button type="button" class="btn ag-done" data-close>Got it</button>
  </div>`;
document.body.appendChild(appGuide);
let agTimer = null, agStep = 0;
const AG_FRAME_STEP = { ios: [1, 2, 3, 3], android: [1, 2, 2, 3] };
function agShow(n){
  agStep = n;
  const os = appGuide.querySelector("[data-os][aria-pressed=true]")?.dataset.os || "ios";
  const ph = appGuide.querySelector(`.agd-phone[data-for="${os}"]`);
  ph?.querySelectorAll(".agd-f").forEach((f, i) => f.classList.toggle("on", i === n));
  const step = AG_FRAME_STEP[os][n];      // which written step each picture belongs to
  appGuide.querySelectorAll(`.ag-steps[data-for="${os}"] li`).forEach((li, i) => li.classList.toggle("on", i === step));
}
function agPlay(){ clearInterval(agTimer); agShow(0); agTimer = setInterval(() => agShow((agStep + 1) % 4), 2400); }
function setGuideOS(os){
  for (const b of appGuide.querySelectorAll("[data-os]")) b.setAttribute("aria-pressed", b.dataset.os === os);
  for (const ol of appGuide.querySelectorAll(".ag-steps")) ol.hidden = ol.dataset.for !== os;
  for (const ph of appGuide.querySelectorAll(".agd-phone")) ph.hidden = ph.dataset.for !== os;
  if (!appGuide.hidden) agPlay();
}
function syncInstallButtons(){
  appGuide.querySelector(".ag-install").hidden = !installPrompt;
  for (const b of document.querySelectorAll(".ms-getapp, .home-app")) b.hidden = standalone();
}
function openAppGuide(){
  setGuideOS(isIOS() ? "ios" : "android"); syncInstallButtons();
  appGuide.hidden = false; requestAnimationFrame(() => appGuide.classList.add("open")); agPlay();
}
function closeAppGuide(){ clearInterval(agTimer); appGuide.classList.remove("open"); setTimeout(() => { appGuide.hidden = true; }, 200); }
async function runInstall(){
  if (!installPrompt) return openAppGuide();
  installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; syncInstallButtons();
}
appGuide.addEventListener("click", e => {
  if (e.target.closest("[data-close]")) return closeAppGuide();
  const os = e.target.closest("[data-os]"); if (os) return setGuideOS(os.dataset.os);
  if (e.target.closest("[data-install]")) return runInstall();
  const li = e.target.closest(".ag-steps li"); if (li){ clearInterval(agTimer); const os = li.parentElement.dataset.for, i = [...li.parentElement.children].indexOf(li), f = AG_FRAME_STEP[os].indexOf(i); agShow(f < 0 ? 0 : f); agTimer = setInterval(() => agShow((agStep + 1) % 4), 2400); }
});
// Home page link (phones, before a league is open)
{ const card = document.querySelector("#connect .ccard");
  if (card){
    const b = document.createElement("button"); b.type = "button"; b.className = "home-app";
    b.innerHTML = `<img src="icons/icon-192.png" alt=""><span><b>Get the app</b><small>Add Front Office to your home screen. It takes 3 taps.</small></span><span class="ha-go" aria-hidden="true">›</span>`;
    b.addEventListener("click", openAppGuide); card.appendChild(b);
  }
}
syncInstallButtons();
// A one-time tip on phones that haven't installed it yet
function showInstallTip(){
  if (!isPhoneView() || standalone() || store.get("fo_install_tip") === "done" || $("installTip")) return;
  const tip = document.createElement("div"); tip.className = "install-tip"; tip.id = "installTip";
  tip.innerHTML = `<img src="icons/icon-192.png" alt=""><span><b>Get the Front Office app</b><small>Add it to your home screen in 3 taps.</small></span><button type="button" class="btn" data-how>${installPrompt ? "Install" : "Show me how"}</button><button type="button" class="it-x" aria-label="Dismiss">✕</button>`;
  document.body.appendChild(tip);
  tip.addEventListener("click", e => {
    if (e.target.closest("[data-how]")){ installPrompt ? runInstall() : openAppGuide(); }
    else if (!e.target.closest(".it-x")) return;
    store.set("fo_install_tip", "done"); tip.remove();
  });
}
setTimeout(showInstallTip, 2500);

// Phones: "Switch league" sits at the top right, beside the league name (desktop keeps its own in the header)
{ const b = document.createElement("button");
  b.type = "button"; b.className = "ghost phone-switch"; b.id = "phoneSwitch"; b.textContent = "Switch league";
  b.addEventListener("click", () => $("switchLeague").click());
  $("leagueBar").appendChild(b); }

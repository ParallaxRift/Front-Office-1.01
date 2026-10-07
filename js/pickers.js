// Front Office: Team pickers with photos
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// TEAM PICKERS: the browser's built-in dropdown can't show images,
// so each team <select> gets a custom button and list with photos.
// The hidden <select> still holds the value, so nothing else changes.
// ============================================================
const PICKERS = ["teamA", "teamB", "stratTeam", "tfTeam"];
const CHEVRON_DOWN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;color:var(--muted)"><path d="M6 9l6 6 6-6"/></svg>`;
function makePicker(id){
  const sel = $(id);
  const wrap = document.createElement("div"); wrap.className = "picker";
  sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel);
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "pk-btn";
  btn.setAttribute("aria-haspopup", "listbox"); btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-label", sel.getAttribute("aria-label") || "Choose a team");
  const list = document.createElement("div");
  list.className = "pk-list"; list.setAttribute("role", "listbox"); list.hidden = true;
  wrap.append(btn, list);
  const close = (focusBtn) => { list.hidden = true; btn.setAttribute("aria-expanded", "false"); if (focusBtn) btn.focus(); };
  btn.addEventListener("click", () => {
    const open = list.hidden;
    PICKERS.forEach(other => { if (other !== id) $(other).parentNode.querySelector(".pk-list").hidden = true; });
    if (open){ fillPickerList(id); list.hidden = false; btn.setAttribute("aria-expanded", "true");
      (list.querySelector('[aria-selected="true"]') || list.firstElementChild)?.focus(); }
    else close();
  });
  list.addEventListener("click", e => {
    const opt = e.target.closest(".pk-opt"); if (!opt) return;
    const side = id === "teamA" ? "A" : id === "teamB" ? "B" : null;
    if (opt.dataset.rid === "all"){ close(true); if (side) setBrowse(side, true); return; }
    if (side && browseAll[side]){ browseAll[side] = false; $("browse" + side).hidden = true; $("browse" + side).value = ""; }
    sel.value = opt.dataset.rid; close(true); syncPicker(id);
    sel.dispatchEvent(new Event("change"));
  });
  list.addEventListener("keydown", e => {
    const opts = [...list.querySelectorAll(".pk-opt")], i = opts.indexOf(document.activeElement);
    if (e.key === "Escape"){ e.preventDefault(); close(true); }
    else if (e.key === "ArrowDown"){ e.preventDefault(); opts[Math.min(opts.length-1, i+1)]?.focus(); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); opts[Math.max(0, i-1)]?.focus(); }
  });
  document.addEventListener("click", e => { if (!wrap.contains(e.target) && !list.hidden) close(); });
}
function fillPickerList(id){
  const sel = $(id), list = sel.parentNode.querySelector(".pk-list"), cur = Number(sel.value);
  const allRow = (id === "teamA" || id === "teamB") ? (() => {
    const on = browseAll[id === "teamA" ? "A" : "B"];
    return `<button type="button" class="pk-opt" role="option" data-rid="all" aria-selected="${on}">
      ${avatar(null, "All", "md")}<span class="pk-text"><b>All Players</b><small>Every player and pick in the league</small></span></button>`;
  })() : "";
  list.innerHTML = allRow + [...sel.options].map(o => {
    const rid = Number(o.value), t = S.teams.get(rid);
    if (!t) return "";
    const sub = [t.manager && t.manager !== t.name ? t.manager : "", statusText[t.status]].filter(Boolean).join(", ");
    return `<button type="button" class="pk-opt" role="option" data-rid="${rid}" aria-selected="${rid === cur}">
      ${teamPhoto(rid, "md")}<span class="pk-text"><b>${esc(t.name)}</b><small>${esc(sub)}</small></span>
      ${rid === S.myRid ? `<span class="pk-you">Your team</span>` : ""}</button>`;
  }).join("");
}
function syncPicker(id){
  const sel = $(id), btn = sel.parentNode.querySelector(".pk-btn");
  if (!btn) return;
  const rid = Number(sel.value), t = S.teams.get(rid);
  const side = id === "teamA" ? "A" : id === "teamB" ? "B" : null;
  if (side && browseAll[side]){
    btn.innerHTML = `${avatar(null, "All", "md")}<span class="pk-name">All Players${t ? ` <small style="color:var(--muted)">(trading with ${esc(t.name)})</small>` : ""}</span>${CHEVRON_DOWN}`;
    return;
  }
  btn.innerHTML = t ? `${teamPhoto(rid, "md")}<span class="pk-name">${esc(t.name)}</span>${CHEVRON_DOWN}` : `<span class="pk-name">Choose a team</span>${CHEVRON_DOWN}`;
}
PICKERS.forEach(makePicker);

// tabs
$("tabs").addEventListener("click", e => {
  const b = e.target.closest(".tab[data-tab]"); if (!b) return;   // (the phone-only League Settings tab has no data-tab and opens itself)
  for (const t of $("tabs").children) t.setAttribute("aria-selected", t === b);
  for (const p of document.querySelectorAll("#appView section.panel")) p.classList.toggle("on", p.id === "panel-" + b.dataset.tab);
  if (b.dataset.tab === "scores") loadScores();
  if (b.dataset.tab === "feedback") loadFeedback();
  if (b.dataset.tab === "finder") renderFinder();
  if (["standings", "power", "sim"].includes(b.dataset.tab)) renderStandings();
  if (b.dataset.tab === "trophy") loadTrophyRoom();
  store.set("tr_tab", b.dataset.tab);
  $("settingsBtn").setAttribute("aria-pressed", String(b.dataset.tab === "settings"));
});


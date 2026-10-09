// Front Office: The Basics / Freakshow modes and auto refresh
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// THE BASICS / FREAKSHOW
// The Basics shows only the Trade Calculator and League Values, for newer
// players. Freakshow shows every tab. The choice is remembered per device.
// ============================================================
const BASIC_TABS = ["calc", "values"];
const currentMode = () => store.get("fo_mode") === "basics" ? "basics" : "freak";
function applyMode(mode, quiet){
  const was = $("modeToggle").querySelector('[aria-checked="true"]')?.dataset.mode;
  store.set("fo_mode", mode);
  for (const b of $("modeToggle").children) b.setAttribute("aria-checked", b.dataset.mode === mode);
  const revealed = [];
  for (const t of $("tabs").children){
    const hide = mode === "basics" && !BASIC_TABS.includes(t.dataset.tab);
    if (t.hidden && !hide) revealed.push(t);
    t.hidden = hide;
  }
  // The big moment: flipping from The Basics to Freakshow
  if (!quiet && was === "basics" && mode === "freak"){ igniteFreakshow(); revealTabs(revealed); }
  // If the open tab just got hidden, go back to the calculator
  const open = $("tabs").querySelector('.tab[aria-selected="true"]');
  if (open && open.hidden) $("tabs").querySelector('[data-tab="calc"]').click();
}
$("modeToggle").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  applyMode(b.dataset.mode);
});
$("modeToggle").addEventListener("keydown", e => {
  if (!["ArrowLeft","ArrowRight"].includes(e.key)) return;
  e.preventDefault();
  const next = currentMode() === "basics" ? "freak" : "basics";
  applyMode(next); $("modeToggle").querySelector(`[data-mode="${next}"]`).focus();
});

// ---------- Freakshow fire, smoke, and tab reveal ----------
const calmMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function igniteFreakshow(){
  const btn = $("modeToggle").querySelector('[data-mode="freak"]');
  if (!btn || calmMotion()) return;
  btn.classList.remove("on-fire"); void btn.offsetWidth; btn.classList.add("on-fire");
  setTimeout(() => btn.classList.remove("on-fire"), 1700);
  const r = btn.getBoundingClientRect();
  const layer = document.createElement("div"); layer.className = "fx-layer";
  const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;   // the page is zoomed on computers
  layer.style.left = r.left / z + "px"; layer.style.top = r.top / z + "px"; layer.style.width = r.width / z + "px"; layer.style.height = r.height / z + "px";
  document.body.appendChild(layer);
  const rand = (a, b) => a + Math.random() * (b - a);
  // flames: licking up from the button for about a second
  for (let i = 0; i < 40; i++){
    const f = document.createElement("span"); f.className = "fx-flame";
    const size = rand(22, 42);
    f.style.cssText = `left:${rand(2, 98)}%;width:${size}px;height:${size * 1.7}px;animation-delay:${rand(0, 800)}ms;animation-duration:${rand(700, 1100)}ms;--dx:${rand(-12, 12)}px;--rise:${rand(30, 70)}px`;
    layer.appendChild(f);
  }
  // sparks
  for (let i = 0; i < 14; i++){
    const k = document.createElement("span"); k.className = "fx-spark";
    k.style.cssText = `left:${rand(10, 90)}%;animation-delay:${rand(100, 900)}ms;--dx:${rand(-40, 40)}px;--rise:${rand(50, 95)}px`;
    layer.appendChild(k);
  }
  // smoke: drifts up after the flames die down
  for (let i = 0; i < 12; i++){
    const m = document.createElement("span"); m.className = "fx-smoke";
    const size = rand(26, 48);
    m.style.cssText = `left:${rand(10, 90)}%;width:${size}px;height:${size}px;animation-delay:${900 + rand(0, 700)}ms;--dx:${rand(-30, 30)}px;--rise:${rand(60, 110)}px`;
    layer.appendChild(m);
  }
  setTimeout(() => layer.remove(), 3400);
}
function revealTabs(tabs){
  if (typeof navRevealTargets === "function") tabs = navRevealTargets(tabs);   // animate the section buttons that just appeared
  tabs.forEach((t, i) => {
    t.classList.remove("tab-reveal"); void t.offsetWidth;
    t.style.animationDelay = calmMotion() ? "0ms" : (250 + i * 110) + "ms";
    t.classList.add("tab-reveal");
    setTimeout(() => { t.classList.remove("tab-reveal"); t.style.animationDelay = ""; }, 250 + i * 110 + 1500);
  });
}

// ============================================================
// AUTO REFRESH
// Every 10 minutes (and when you come back to the tab after a couple of
// minutes away) Front Office re-checks the league on Sleeper. If rosters,
// picks, or settings changed, everything recalculates in place. Sleeper is
// free and needs no key, so this costs nothing.
// ============================================================
const AUTO_REFRESH_MS = 10 * 60 * 1000;
const RETURN_REFRESH_MS = 2 * 60 * 1000;
let lastLeagueCheck = 0, refreshing = false;

function leagueSignature(league, rosters, traded){
  const r = (rosters || []).map(x => [x.roster_id, x.owner_id, [...(x.players||[])].sort(), [...(x.taxi||[])].sort(), [...(x.reserve||[])].sort()])
    .sort((a, b) => a[0] - b[0]);
  const t = (traded || []).map(x => `${x.season}-${x.round}-${x.roster_id}-${x.owner_id}`).sort();
  return JSON.stringify([league?.name, league?.avatar, league?.roster_positions, league?.scoring_settings, league?.settings?.taxi_slots, league?.settings?.reserve_slots, r, t]);
}
// Re-draw every tab after new data, keeping the teams, week, and trade you had picked
function rerenderKeepingPlace(){
  const keep = { a: $("teamA").value, b: $("teamB").value, st: $("stratTeam").value, tf: $("tfTeam").value, ro: $("rosterTeam").value, wk: $("weekSelect").value };
  // keep the trade being built: renderLeague briefly resets the teams, which would otherwise drop its pieces
  const keepTrade = { send: new Set(S.sendIds), get: new Set(S.getIds) };
  const scoresOpen = $("panel-scores").classList.contains("on");
  renderLeague();
  S.sendIds = keepTrade.send; S.getIds = keepTrade.get;
  const has = v => v !== "" && S.teams.has(Number(v));
  if (has(keep.a)) $("teamA").value = keep.a;
  if (has(keep.b)) $("teamB").value = keep.b;
  if (has(keep.st)) $("stratTeam").value = keep.st;
  if (has(keep.tf)) $("tfTeam").value = keep.tf;
  if (has(keep.ro)) $("rosterTeam").value = keep.ro;
  if ($("panel-roster").classList.contains("on")) renderRoster();
  if ($("panel-scouting").classList.contains("on")) renderScouting();
  if ($("panel-lineup").classList.contains("on") || $("panel-waivers").classList.contains("on")) renderLineup();
  if (keep.wk && [...$("weekSelect").options].some(o => o.value === keep.wk)) $("weekSelect").value = keep.wk;
  renderCalc(); renderStrategy();
  if ($("panel-finder").classList.contains("on")) renderFinder();
  if (["standings", "power", "sim"].some(t => $("panel-" + t).classList.contains("on"))) renderStandings();
  if (scoresOpen) loadScores();
}
function toast(msg){
  const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 5000);
}
async function refreshLeague(){
  if (!S.league || refreshing || document.hidden) return;
  refreshing = true; lastLeagueCheck = Date.now();
  const id = S.league.league_id;
  try {
    const [league, rosters, users, traded] = await Promise.all([
      getJSON(`/league/${id}`), getJSON(`/league/${id}/rosters`), getJSON(`/league/${id}/users`), getJSON(`/league/${id}/traded_picks`)
    ]);
    if (S.league?.league_id !== id) return;              // switched leagues meanwhile
    if (leagueSignature(league, rosters, traded) === S.leagueSig){
      S.users = users || S.users;                         // pick up renamed teams/photos quietly
      return;
    }
    Object.assign(S, { league, rosters: rosters || [], users: users || [], traded: traded || [] });
    S.cfg = readSettings(league, S.rosters);
    S.leagueSig = leagueSignature(league, rosters, traded);
    buildValues();
    rerenderKeepingPlace();
    loadHistory(league);                                  // a roster change usually means a new trade
    toast("League updated with the latest moves from Sleeper");
  } catch(e){
    console.warn("Auto refresh skipped", e);              // try again next time
  } finally { refreshing = false; }
}
setInterval(refreshLeague, AUTO_REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastLeagueCheck > RETURN_REFRESH_MS) refreshLeague();
});


// Front Office: Finding your leagues and loading one
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// STEP 1: USER AND LEAGUES
// ============================================================
const AV_URL = id => `https://sleepercdn.com/avatars/thumbs/${encodeURIComponent(id)}`;
// Fallback icon shown when a league or team has no photo (or the photo fails to load)
const FOOTBALL = `<svg class="fb" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M5 19C4 13 7.5 7.2 12.6 5.2 15.4 4.1 17.8 4.2 19 5c1 6-2.5 11.8-7.6 13.8C8.6 19.9 6.2 19.8 5 19z" fill="currentColor" fill-opacity=".18"/>
  <path d="M6.2 14.6l3.2 3.2M14.6 6.2l3.2 3.2"/>
  <path d="M9.6 14.4l4.8-4.8M9.7 12.7l1.6 1.6M11.2 11.2l1.6 1.6M12.7 9.7l1.6 1.6"/>
</svg>`;
// size: true/"sm", "md", "lg", "xl" or empty for default. id can be a Sleeper avatar id or a full image URL.
function avatar(id, name, size){
  const cls = size === true ? "sm" : (size || "");
  const src = id ? (/^https?:\/\//.test(id) ? id : AV_URL(id)) : "";
  return `<span class="av${cls ? " av-" + cls : ""}" title="${esc(name||"")}">${FOOTBALL}${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>`;
}
const teamPhoto = (rid, size) => { const t = S.teams.get(rid); return t ? avatar(t.photo, t.name, size) : ""; };
const chevron = `<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;
const store = { get: k => { try { return localStorage.getItem(k); } catch(e){ return null; } }, set: (k,v) => { try { localStorage.setItem(k,v); } catch(e){} } };

$("loadUser").addEventListener("click", loadUser);
$("username").addEventListener("keydown", e => { if (e.key === "Enter") loadUser(); });
$("changeUser").addEventListener("click", () => {
  $("userChip").hidden = true; $("userForm").hidden = false;
  $("step2").classList.add("off");
  $("leagueList").innerHTML = `<p class="placeholder">Your leagues will show up here.</p>`;
  $("username").select(); $("username").focus();
});
$("leagueList").addEventListener("click", e => {
  const b = e.target.closest(".lg"); if (b && !b.disabled) openLeague(b.dataset.id);
});
$("switchLeague").addEventListener("click", () => {
  $("connect").hidden = false; $("appbar").hidden = true;
  renderLeagueList();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

function leagueMeta(l){
  const rp = l.roster_positions || [];
  const sf = rp.includes("SUPER_FLEX") || rp.filter(x => x==="QB").length >= 2;
  const type = l.settings?.type === 2 ? "Dynasty" : l.settings?.type === 1 ? "Keeper" : "Redraft";
  return `${l.total_rosters || "?"} teams, ${sf ? "Superflex" : "1QB"}, ${type}`;
}
function renderLeagueList(){
  const last = store.get("tr_league");
  const list = [...S.leagues].sort((a,b) =>
    ((b.settings?.type===2) - (a.settings?.type===2)) || ((b.league_id===last) - (a.league_id===last)));
  $("leagueList").innerHTML = list.map(l => {
    const dyn = l.settings?.type === 2;
    const tag = S.league && l.league_id === S.league.league_id ? "Open now" : l.league_id === last ? "Last opened" : "";
    return `<button class="lg${dyn ? "" : " other"}" data-id="${esc(l.league_id)}">
      ${avatar(l.avatar, l.name)}
      <span class="lg-text"><b>${esc(l.name)}</b><small>${esc(leagueMeta(l))}</small></span>
      ${tag ? `<span class="tag">${tag}</span>` : ""}${chevron}</button>`;
  }).join("");
  $("step2").classList.remove("off");
}

async function loadUser(opts){
  const auto = opts && opts.auto === true;   // true only when reopening the site
  const name = $("username").value.trim();
  if (!name){ setStatus("Enter your Sleeper username to find your leagues.", true); $("username").focus(); return; }
  $("loadUser").disabled = true; $("loadUser").textContent = "Finding...";
  setStatus("");
  try {
    const user = await getJSON("/user/" + encodeURIComponent(name));
    if (!user || !user.user_id) throw new Error("NOUSER");
    S.user = user;
    store.set("tr_username", name);
    const state = await getJSON("/state/nfl");
    S.nflState = state;
    S.season = state.league_season || state.season;
    let leagues = await getJSON(`/user/${user.user_id}/leagues/nfl/${S.season}`);
    if ((!leagues || !leagues.length) && state.season !== S.season) leagues = await getJSON(`/user/${user.user_id}/leagues/nfl/${state.season}`);
    S.leagues = leagues || [];
    $("userAv").innerHTML = avatar(user.avatar, user.display_name || name);
    $("userName").textContent = user.display_name || name;
    $("userMeta").textContent = S.leagues.length
      ? `${S.leagues.length} league${S.leagues.length>1?"s":""} this season, ${S.leagues.filter(l=>l.settings?.type===2).length} dynasty`
      : "No leagues this season";
    $("userForm").hidden = true; $("userChip").hidden = false;
    if (!S.leagues.length){ setStatus(`${user.display_name || name} isn't in any Sleeper leagues this season.`, true); return; }
    renderLeagueList();
    // Reopen the league you were last in, if it's still one of yours this season
    const last = store.get("tr_league");
    if (auto && last && S.leagues.some(l => l.league_id === last)){
      setStatus("Opening your last league...");
      openLeague(last);
    }
  } catch(err){
    setStatus(err.message === "NOUSER"
      ? `No Sleeper account named "${name}". Usernames are case-sensitive in some apps, so check the spelling in your Sleeper profile.`
      : "Couldn't reach Sleeper. Check your internet connection and try again.", true);
  } finally { $("loadUser").disabled = false; $("loadUser").textContent = "Find leagues"; }
}

// ============================================================
// STEP 2: LOAD A LEAGUE (with a visible progress checklist)
// ============================================================
const STEPS = ["League, rosters and picks", "NFL player list", "Market values", "Your league's values"];
function progress(i, state){
  const el = $("progress");
  if (i === -1){ el.hidden = false; el.innerHTML = STEPS.map(t => `<li><span class="dot"></span>${t}</li>`).join(""); return; }
  const li = el.children[i]; li.className = state;
  li.querySelector(".dot").textContent = state === "done" ? "✓" : "";
}

async function openLeague(leagueId){
  const buttons = [...document.querySelectorAll(".lg")];
  buttons.forEach(b => { b.disabled = true; b.classList.toggle("loading", b.dataset.id === leagueId); });
  setStatus(""); progress(-1);
  try {
    progress(0, "active");
    const [league, rosters, users, traded] = await Promise.all([
      getJSON(`/league/${leagueId}`), getJSON(`/league/${leagueId}/rosters`),
      getJSON(`/league/${leagueId}/users`), getJSON(`/league/${leagueId}/traded_picks`)
    ]);
    Object.assign(S, { league, rosters: rosters||[], users: users||[], traded: traded||[] });
    progress(0, "done");

    progress(1, "active");
    if (!S.sleeperPlayers) S.sleeperPlayers = await getJSON("/players/nfl");
    progress(1, "done");

    progress(2, "active");
    if (S.market === null) S.market = await loadMarket();
    progress(2, "done");

    progress(3, "active");
    S.cfg = readSettings(league, S.rosters);
    S.history = null; S.nudge = null; S.curveB = 1; S.curveT = 1; S.ageStrength = 1; S.ageFit = null; S.accuracy = null; S.pickOdds = null; S.historyError = false;
    S.leagueSig = leagueSignature(league, S.rosters, S.traded); lastLeagueCheck = Date.now();
    buildValues();
    S.sendIds.clear(); S.getIds.clear(); tfSend.clear(); tfTarget = null; trophy = null;
    renderLeague();
    loadHistory(league);
    progress(3, "done");

    store.set("tr_league", leagueId);
    $("whoMini").innerHTML = `${avatar(league.avatar, league.name, true)}<span class="nm">${esc(league.name)}</span>${teamPhoto(S.myRid, true)}`;
    // Return to the tab you were last on
    const lastTab = store.get("tr_tab");
    const tabBtn = lastTab && $("tabs").querySelector(`[data-tab="${lastTab}"]`);
    if (lastTab === "settings") openSettingsPanel();
    else if (tabBtn && !tabBtn.hidden && tabBtn.getAttribute("aria-selected") !== "true") tabBtn.click();
    setTimeout(() => {
      $("connect").hidden = true; $("appbar").hidden = false; $("progress").hidden = true;
      setStatus("");
      window.scrollTo({ top: 0 });
    }, 350);
  } catch(err){
    console.error(err);
    $("progress").hidden = true;
    setStatus("Couldn't load that league. Check your connection and try again.", true);
  } finally {
    buttons.forEach(b => { b.disabled = false; b.classList.remove("loading"); });
  }
}

// Pick up where you left off
const savedName = store.get("tr_username");
if (savedName){ $("username").value = savedName; loadUser({ auto: true }); }


// Front Office: Feedback & Build Notes content
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// BUILD NOTES
// To add a build: copy the first entry, put it at the TOP of the list,
// change the version, date, title and changes. Newest first.
// Wrap a feature name in **double stars** to make it bold.
// ============================================================
const BUILD_NOTES = [
  { version: "Beta 0.7", date: "Oct 2026", title: "Feedback, smarter history, and quality of life", changes: [
    "**Build notes** (you're reading them), editable right on the site, and a version number in the footer.",
    "**Auto refresh:** your league re-checks Sleeper every 10 minutes and when you come back to the tab, so trades and roster moves show up without reloading.",
    "**Remembers your last league and tab.** Reopening Front Office takes you straight back where you left off.",
    "**Trade History:** a sortable team trade records table, plus filters for team, result, season, and trade size, and new sort options.",
    "**Live Scores:** exact points with two decimals, a new Bench section with bench totals, and long names no longer push scores off the card.",
    "**Beta Feedback** tab with a public feedback board.",
    "Tabs reordered, with Live Scores and Beta Feedback last, and the tab row's stray scroll bar removed.",
  ]},
  { version: "Beta 0.6", date: "Oct 2026", title: "League tuning upgrades", changes: [
    "**3- and 4-team trades** now count toward league tuning and trade grades. Every team is measured against what it personally gave up.",
    "**League tuning light** on League Values: green when active, yellow with a countdown of trades left until it turns on.",
    "**Fixed:** tuning could shrink every position equally instead of learning real differences between positions.",
  ]},
  { version: "Beta 0.5", date: "Oct 2026", title: "Your league's trade history", changes: [
    "**Trade History** tab: every trade from up to four seasons, graded with today's values. Used picks show the player they became.",
    "**League tuning:** once a league has 15 trades, values are lightly adjusted toward how your managers actually trade.",
    "**Team Strategy** now includes each team's trade record, favorite partner, and managers who tend to sell picks or come out behind.",
    "About page explains how values are built and tuned, and market values now credit expert consensus.",
  ]},
  { version: "Beta 0.4", date: "Oct 2026", title: "Daily expert values", changes: [
    "**Market values from expert consensus dynasty rankings,** refreshed automatically every morning.",
    "Every player in the calculator shows **position rank and overall rank** for your league.",
    "**Team dropdowns show team photos.**",
  ]},
  { version: "Beta 0.3", date: "Oct 2026", title: "Front Office is born", changes: [
    "**New name and logo:** Front Office.",
    "**Live Scores** tab with every matchup and starting lineups, refreshing every minute.",
    "**About** and **Sleeper Leagues in Beta** pages.",
    "League header shows roster, IR, and taxi spots, plus last year's champion.",
  ]},
  { version: "Beta 0.2", date: "Oct 2026", title: "Strategy and polish", changes: [
    "**League Settings** tab: lineup, scoring, and exactly how your settings change values.",
    "**Team Strategy** tab: a game plan, position report card, trade targets, sell list, and best trade partners for every team.",
    "Redesigned sign-in with league cards, plus league and team photos (with a football icon when there's no photo).",
  ]},
  { version: "Beta 0.1", date: "Oct 2026", title: "First prototype", changes: [
    "Enter a Sleeper username, pick a league, and get **values built for that league**.",
    "**Trade Calculator** with projected draft picks, contender and rebuilding labels, and fair-trade suggestions.",
    "**League Values** list showing how your settings move each player.",
  ]},
];
// Live notes come from data/build-notes.json in the GitHub repository, which the
// Edit button saves to. BUILD_NOTES above is only the starting copy / fallback.
let notes = BUILD_NOTES;
const NOTES_FILE = "data/build-notes.json";
fetch(NOTES_FILE, { cache: "no-store" }).then(r => r.ok ? r.json() : null)
  .then(d => { if (Array.isArray(d) && d.length){ notes = d; renderBuildNotes(); } }).catch(() => {});

function renderBuildNotes(){
  const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  $("notesVersion").textContent = notes[0]?.version || "";
  $("footVersion").textContent = notes[0] ? "Version " + notes[0].version : "";
  $("buildNotes").innerHTML = notes.map((n, i) => `
    <details class="bn"${i === 0 ? " open" : ""}>
      <summary><b>${esc(n.version)}</b>${i === 0 ? `<span class="cur">Current</span>` : ""}<span>${esc(n.date)}</span><span>${esc(n.title)}</span></summary>
      <ul>${n.changes.map(c => `<li>${md(c)}</li>`).join("")}</ul>
    </details>`).join("");
}
renderBuildNotes();

// ---------- Editing build notes on the site ----------
// Saving writes data/build-notes.json straight into the GitHub repository using a
// GitHub access token that lives only in the editor's own browser.
function ghRepo(){
  const host = location.hostname;
  if (host.endsWith(".github.io")) return { owner: host.split(".")[0], repo: location.pathname.split("/").filter(Boolean)[0] || host };
  return { owner: "pattretina-cmyk", repo: "Front-Office-1.01" };   // used when testing outside GitHub Pages
}
const ghToken = () => store.get("fo_gh_token");
let draft = null;

$("notesEditBtn").addEventListener("click", () => {
  if (!$("notesEditor").hidden || !$("notesAuth").hidden){ closeNotesEditor(); return; }
  if (!ghToken()) showNotesAuth(); else openNotesEditor();
});
function closeNotesEditor(){
  $("notesEditor").hidden = true; $("notesAuth").hidden = true; $("buildNotes").hidden = false;
  $("notesEditBtn").textContent = "Edit"; draft = null;
}
function showNotesAuth(){
  const { owner, repo } = ghRepo();
  $("buildNotes").hidden = true; $("notesEditBtn").textContent = "Cancel";
  $("notesAuth").hidden = false;
  $("notesAuth").innerHTML = `
    <div class="ne-card">
      <label for="ghTok">GitHub access token</label>
      <input id="ghTok" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_...">
      <div class="ne-actions"><button class="btn" type="button" id="ghTokSave">Unlock editing</button></div>
      <p class="status" id="ghTokStatus" role="status" aria-live="polite"></p>
      <details class="ne-help"><summary>How to get a token (one time, about 3 minutes)</summary>
        <ol>
          <li>On GitHub, click your profile picture, then <b>Settings</b>.</li>
          <li>At the bottom of the left menu, click <b>Developer settings</b>, then <b>Personal access tokens</b>, then <b>Fine-grained tokens</b>.</li>
          <li>Click <b>Generate new token</b>. Name it <b>Front Office notes</b> and pick an expiration (1 year is fine).</li>
          <li>Under <b>Repository access</b>, choose <b>Only select repositories</b> and pick <b>${esc(repo)}</b>.</li>
          <li>Under <b>Permissions</b>, find <b>Contents</b> and set it to <b>Read and write</b>.</li>
          <li>Click <b>Generate token</b>, copy it, and paste it above.</li>
        </ol>
        The token is saved only in this browser, never in the website's files. Anyone without it can read the notes but can't edit them.
      </details>
    </div>`;
  $("ghTokSave").addEventListener("click", async () => {
    const tok = $("ghTok").value.trim(), st = $("ghTokStatus");
    if (!tok){ st.textContent = "Paste your token first."; st.className = "status error"; return; }
    st.className = "status"; st.textContent = "Checking...";
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json" } });
      const d = r.ok ? await r.json() : null;
      if (!r.ok) throw new Error(r.status === 401 ? "That token isn't valid. Check it was copied completely." : `That token can't access ${repo}. Check its repository access.`);
      if (d.permissions && !d.permissions.push) throw new Error("That token can read but not save. Set Contents to Read and write.");
      store.set("fo_gh_token", tok);
      openNotesEditor();
    } catch(e){ st.textContent = e.message; st.className = "status error"; }
  });
}
function nextVersion(v){
  const m = String(v || "").match(/^(.*?)(\d+)(?!.*\d)/);
  return m ? m[1] + (Number(m[2]) + 1) + String(v).slice(m[0].length) : "Beta";
}
function openNotesEditor(){
  draft = JSON.parse(JSON.stringify(notes));
  $("notesAuth").hidden = true; $("buildNotes").hidden = true;
  $("notesEditor").hidden = false; $("notesEditBtn").textContent = "Cancel";
  renderNotesEditor();
}
function renderNotesEditor(){
  $("notesEditor").innerHTML = `
    <div class="ne-bar">
      <button class="btn" type="button" data-act="add">+ Add new build</button>
      <button class="ghost" type="button" data-act="save">Save and publish</button>
      <button class="ghost" type="button" data-act="logout" style="margin-left:auto">Forget token on this device</button>
    </div>
    <p class="status" id="neStatus" role="status" aria-live="polite"></p>
    <p class="ne-help" style="margin:0 0 10px">One change per line in "Changes." Wrap words in **double stars** to bold them. The top build is shown as Current.</p>
    ${draft.map((n, i) => `
      <div class="ne-card" data-i="${i}">
        <div class="ne-row">
          <div><label>Version</label><input data-f="version" value="${esc(n.version)}"></div>
          <div><label>Date</label><input data-f="date" value="${esc(n.date)}"></div>
        </div>
        <label>Title</label><input data-f="title" value="${esc(n.title)}">
        <label style="margin-top:8px">Changes</label><textarea data-f="changes">${esc((n.changes || []).join("\n"))}</textarea>
        <div class="ne-actions">
          <button class="ghost" type="button" data-act="up" ${i === 0 ? "disabled" : ""}>Move up</button>
          <button class="ghost" type="button" data-act="down" ${i === draft.length - 1 ? "disabled" : ""}>Move down</button>
          <button class="ghost danger" type="button" data-act="del">Delete</button>
        </div>
      </div>`).join("")}`;
}
$("notesEditor").addEventListener("input", e => {
  const card = e.target.closest(".ne-card"), f = e.target.dataset.f; if (!card || !f) return;
  const n = draft[Number(card.dataset.i)];
  n[f] = f === "changes" ? e.target.value.split("\n").map(x => x.trim()).filter(Boolean) : e.target.value;
});
$("notesEditor").addEventListener("click", async e => {
  const act = e.target.closest("[data-act]")?.dataset.act; if (!act) return;
  const card = e.target.closest(".ne-card"), i = card ? Number(card.dataset.i) : -1;
  if (act === "add"){
    const today = new Date().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    draft.unshift({ version: nextVersion(draft[0]?.version), date: today, title: "", changes: [] });
    renderNotesEditor(); $("notesEditor").querySelector('[data-f="title"]')?.focus(); return;
  }
  if (act === "up" && i > 0){ [draft[i-1], draft[i]] = [draft[i], draft[i-1]]; renderNotesEditor(); return; }
  if (act === "down" && i < draft.length - 1){ [draft[i+1], draft[i]] = [draft[i], draft[i+1]]; renderNotesEditor(); return; }
  if (act === "del"){ if (confirm(`Delete ${draft[i].version || "this build"}?`)){ draft.splice(i, 1); renderNotesEditor(); } return; }
  if (act === "logout"){ try { localStorage.removeItem("fo_gh_token"); } catch(_){} closeNotesEditor(); return; }
  if (act === "save") await saveNotes();
});
async function saveNotes(){
  const st = $("neStatus"), tok = ghToken(), { owner, repo } = ghRepo();
  const clean = draft.map(n => ({ version: (n.version||"").trim(), date: (n.date||"").trim(), title: (n.title||"").trim(), changes: n.changes || [] }))
                     .filter(n => n.version || n.title || n.changes.length);
  if (!clean.length){ st.textContent = "Add at least one build before saving."; st.className = "status error"; return; }
  if (clean.some(n => !n.version)){ st.textContent = "Every build needs a version."; st.className = "status error"; return; }
  st.className = "status"; st.textContent = "Saving...";
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${NOTES_FILE}`;
  const headers = { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json" };
  try {
    const cur = await fetch(api + "?ref=main", { headers, cache: "no-store" });
    if (cur.status === 401) throw new Error("Your token has expired or was removed. Tap Forget token, then Edit to add a new one.");
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const text = JSON.stringify(clean, null, 2) + "\n";
    const content = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
    const put = await fetch(api, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message: `Update build notes (${clean[0].version})`, content, sha, branch: "main" }) });
    if (!put.ok) throw new Error(put.status === 409 ? "Someone else just saved. Reload the page and try again." : `GitHub didn't accept the save (error ${put.status}). Check the token's Contents permission.`);
    notes = clean; renderBuildNotes(); closeNotesEditor();
    $("notesVersion").textContent = notes[0].version;
    const msg = document.createElement("p"); msg.className = "status"; msg.textContent = "Saved. Everyone will see the update within about 2 minutes.";
    $("buildNotes").before(msg); setTimeout(() => msg.remove(), 8000);
  } catch(e){ st.textContent = e.message; st.className = "status error"; }
}


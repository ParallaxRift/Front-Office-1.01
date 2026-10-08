// ============================================================
// Front Office Rankings Desk (private editor)
//
// Pat keeps two ranked lists here, Superflex and 1QB, top 400 each. They're pre-filled from the
// FantasyPros dynasty consensus, which this repository's own GitHub Action downloads every morning
// into data/experts.json (private: the public site is only the docs/ folder). Other sources sit
// beside every player for comparison.
//
// "Publish" writes docs/rankings.json (your two lists, nothing else) using a GitHub access token
// kept only in this browser. Front Office reads that one public file; it has no other connection
// to this Desk or to FantasyPros.
// ============================================================
// This Desk's own (private) repository. On GitHub Pages it's read from the address itself
// (owner.github.io/repository-name/), so renaming the repository needs no code change.
const FO = (() => {
  const h = location.hostname, seg = location.pathname.split("/").filter(Boolean)[0];
  if (h.endsWith(".github.io") && seg) return { owner: h.split(".")[0], repo: decodeURIComponent(seg), branch: "main" };
  return { owner: "ParallaxRift", repo: "The-Desk---Rankings", branch: "main" };
})();
const FILE = "docs/rankings.json", STATE = "data/desk-state.json", EXPERTS = "data/experts.json";
const SLEEPER = "https://api.sleeper.app/v1";
const WEEK = 7 * 864e5;
const FMT = { sf: "Superflex", "1qb": "1QB" };
const TABS = { ...FMT, proj: "Projections" };
// Projection columns: season totals that Front Office scores under each league's own rules
const PJ = [["py", "Pass yds", "pass_yd"], ["ptd", "Pass TD", "pass_td"], ["int", "INT", "pass_int"], ["ry", "Rush yds", "rush_yd"], ["rtd", "Rush TD", "rush_td"],
  ["rec", "Rec", "rec"], ["recy", "Rec yds", "rec_yd"], ["rectd", "Rec TD", "rec_td"], ["fl", "Fumbles lost", "fum_lost"]];
const PJ_ROUND = [0, 1, 1, 0, 1, 0, 0, 1, 1];
const PAGE = 100;
const TEMPLATE_MIN = 500;   // the starting list tops up past FantasyPros with the other sources until it has this many
const SRC = { fp: "FantasyPros", fc: "FantasyCalc", dp: "DynastyProcess" };
const TOKEN_KEY = "fo_rk_token", DRAFT_KEY = "fo_rk_draft";

// ---------- small helpers ----------
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const normName = n => (n || "").toLowerCase().replace(/[.'’`]/g, "").replace(/-/g, " ")
  .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const nameKey = p => normName(p.name) + "|" + String(p.pos || "").toUpperCase();
const rowKey = p => p.id ? "id:" + p.id : "nm:" + nameKey(p);
const ls = { get: k => { try { return localStorage.getItem(k); } catch(_){ return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch(_){} }, del: k => { try { localStorage.removeItem(k); } catch(_){} } };
const token = () => ls.get(TOKEN_KEY);
const when = iso => iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";
function parseCSV(text){
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (q){ if (c === '"'){ if (text[i + 1] === '"'){ cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ","){ row.push(cell); cell = ""; }
    else if (c === "\n"){ row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length){ row.push(cell); rows.push(row); }
  return rows;
}
const api = path => `https://api.github.com/repos/${FO.owner}/${FO.repo}/contents/${path}`;
const ghHeaders = (raw) => ({ Authorization: `Bearer ${token()}`, Accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json" });
async function ghRaw(path){
  const r = await fetch(api(path) + "?ref=" + FO.branch, { headers: ghHeaders(true), cache: "no-store" });
  if (r.status === 401) throw new Error("Your token has expired or was removed. Forget it and unlock again.");
  if (!r.ok) throw new Error(`Couldn't read ${path} (error ${r.status}).`);
  return r.json();
}

// ---------- state ----------
const D = { file: null, sha: null, draft: null, fmt: "sf", pos: "ALL", q: "", dirty: false,
  fp: { sf: new Map(), "1qb": new Map() }, fpRows: { sf: [], "1qb": [] }, dp: { sf: new Map(), "1qb": new Map() },
  sources: {}, fc: { sf: new Map(), "1qb": new Map() }, sl: new Map(), tpl: { sf: [], "1qb": [] }, sp: {}, depth: new Map(), ppg: new Map(), idx: new Map(), fpUpdated: "", experts: {}, auto: new Map(), gp: new Map(), fpProj: new Map(), shown: PAGE };

// ---------- unlock ----------
function renderAuth(msg){
  $("topRight").innerHTML = "";
  $("app").innerHTML = `
    <section class="card auth">
      <h1>Unlock the Rankings Desk</h1>
      <p>Paste a GitHub access token that can save to your <b>${esc(FO.repo)}</b> repository. It's kept only in this browser.</p>
      <label for="tok">GitHub access token</label>
      <input id="tok" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_...">
      <button class="btn" type="button" id="tokGo">Unlock</button>
      <p class="status ${msg ? "error" : ""}" id="tokSt" role="status" aria-live="polite">${esc(msg || "")}</p>
      <details><summary>How to get a token (one time, about 3 minutes)</summary>
        <ol>
          <li>On GitHub, click your profile picture, then <b>Settings</b>.</li>
          <li>At the bottom of the left menu, click <b>Developer settings</b>, then <b>Personal access tokens</b>, then <b>Fine-grained tokens</b>.</li>
          <li>Click <b>Generate new token</b>. Name it <b>Rankings Desk</b> and pick an expiration (1 year is fine).</li>
          <li>Under <b>Repository access</b>, choose <b>Only select repositories</b> and pick <b>${esc(FO.repo)}</b>.</li>
          <li>Under <b>Permissions</b>, find <b>Contents</b> and set it to <b>Read and write</b>.</li>
          <li>Click <b>Generate token</b>, copy it, and paste it above.</li>
        </ol>
      </details>
    </section>`;
  $("tokGo").addEventListener("click", async () => {
    const t = $("tok").value.trim(), st = $("tokSt");
    if (!t){ st.textContent = "Paste your token first."; st.className = "status error"; return; }
    st.className = "status"; st.textContent = "Checking...";
    try {
      const r = await fetch(`https://api.github.com/repos/${FO.owner}/${FO.repo}`, { headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json" } });
      const d = r.ok ? await r.json() : null;
      if (!r.ok) throw new Error(r.status === 401 ? "That token isn't valid. Check it was copied completely, and that it hasn't expired." : `GitHub says this token can't see ${FO.owner}/${FO.repo} (error ${r.status}). Edit the token on GitHub, and under Repository access pick ${FO.repo}.`);
      if (d.permissions && !d.permissions.push) throw new Error("That token can read but not save. Set Contents to Read and write.");
      ls.set(TOKEN_KEY, t); load();
    } catch(e){ st.textContent = e.message; st.className = "status error"; }
  });
}

// ---------- loading ----------
async function ghJSONFile(path){
  const r = await fetch(api(path) + "?ref=" + FO.branch, { headers: ghHeaders(false), cache: "no-store" });
  if (r.status === 401) throw new Error("Your token has expired or was removed. Forget it and unlock again.");
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Couldn't read ${path} (error ${r.status}).`);
  const d = await r.json();
  const text = d.content ? new TextDecoder().decode(Uint8Array.from(atob(d.content.replace(/\n/g, "")), c => c.charCodeAt(0))) : await ghRawText(path);
  return { sha: d.sha, data: JSON.parse(text) };
}
async function load(){
  $("app").innerHTML = `<p class="loading">Loading your lists, the expert rankings and the NFL player list…</p>`;
  try {
    const nfl = await fetch(SLEEPER + "/state/nfl").then(r => r.json()).catch(() => ({}));
    const season = Number(nfl.season) || new Date().getFullYear();
    const [saved, state, experts, sleeper, stats, statsPrev] = await Promise.all([
      ghJSONFile(FILE), ghJSONFile(STATE),
      ghRaw(EXPERTS).catch(() => { throw new Error("The expert rankings haven't been downloaded yet. On GitHub, open this repository's Actions tab, click Update expert rankings, then Run workflow, and reload this page in a minute."); }),
      fetch(SLEEPER + "/players/nfl").then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch(`${SLEEPER}/stats/nfl/regular/${season}`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch(`${SLEEPER}/stats/nfl/regular/${season - 1}`).then(r => r.ok ? r.json() : {}).catch(() => ({}))
    ]);
    D.sp = sleeper || {};
    buildIndex(); buildDepth(); buildPPG(stats); buildAuto(stats, statsPrev); buildRefs(experts);
    D.sha = saved?.sha || null; D.stateSha = state?.sha || null;
    D.file = { updated: saved?.data?.updated || "", lists: saved?.data?.lists || { sf: [], "1qb": [] }, last_week: state?.data?.last_week || null, proj: state?.data?.proj_overrides || {} };
    for (const f of ["sf", "1qb"]) if (!(D.file.lists?.[f] || []).length) D.file.lists[f] = fromExperts(f);
    D.draft = JSON.parse(JSON.stringify(D.file));
    // unsaved work from an earlier visit on this device
    const local = JSON.parse(ls.get(DRAFT_KEY) || "null");
    if (local && local.base === (D.file.updated || "") && local.draft){ D.draft = local.draft; D.dirty = true; }
    D.draft.proj = D.draft.proj || {};
    render();
  } catch(e){
    $("app").innerHTML = `<section class="card"><p class="status error">${esc(e.message)}</p><button class="ghost" type="button" data-a="logout">Forget token on this device</button></section>`;
  }
}
async function ghRawText(path){
  const r = await fetch(api(path) + "?ref=" + FO.branch, { headers: ghHeaders(true), cache: "no-store" });
  return r.text();
}
function buildIndex(){
  for (const [pid, p] of Object.entries(D.sp)){
    if (!["QB", "RB", "WR", "TE"].includes(p.position)) continue;
    const k = normName(p.full_name || `${p.first_name || ""} ${p.last_name || ""}`) + "|" + p.position;
    if (!D.idx.has(k) || (p.team && !D.sp[D.idx.get(k)]?.team)) D.idx.set(k, pid);
  }
}
// Depth chart label for every player at once: RB1, QB2, WR3 · slot
function buildDepth(){
  const GRP = { LWR: "WR", RWR: "WR", SWR: "WR", WR: "WR", QB: "QB", RB: "RB", TE: "TE" }, groups = new Map();
  for (const [pid, p] of Object.entries(D.sp)){
    const g = GRP[p.depth_chart_position], o = Number(p.depth_chart_order);
    if (!p.team || !g || g !== p.position || !o) continue;
    const k = p.team + "|" + g; if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push([pid, o, p.search_rank || 1e9]);
  }
  for (const [k, arr] of groups){
    arr.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
    arr.forEach(([pid], i) => { const spot = { SWR: "slot", LWR: "outside", RWR: "outside" }[D.sp[pid].depth_chart_position]; D.depth.set(pid, `${k.split("|")[1]}${i + 1}${spot ? " · " + spot : ""}`); });
  }
}
function buildPPG(stats){
  for (const [pid, x] of Object.entries(stats || {})) if (x && x.gp) D.ppg.set(pid, ((x.pts_ppr || 0) / x.gp).toFixed(1));
}
// Projections from each player's own Sleeper stats: this season per game, blended with last
// season while games are few (a player with 4 games is half this season, half last), x 17 games
function buildAuto(now, prev){
  const ids = new Set([...Object.keys(now || {}), ...Object.keys(prev || {})]);
  for (const pid of ids){
    const a = now?.[pid], b = prev?.[pid];
    const pg = x => x && x.gp ? PJ.map(([, , k]) => (Number(x[k]) || 0) / x.gp) : null, pa = pg(a), pb = pg(b);
    if (!pa && !pb) continue;
    const w = pa && pb ? a.gp / (a.gp + 4) : pa ? 1 : 0;
    D.auto.set(pid, PJ.map((_, j) => +(17 * ((pa ? pa[j] : 0) * w + (pb ? pb[j] : 0) * (1 - w))).toFixed(PJ_ROUND[j])));
    if (a?.gp) D.gp.set(pid, a.gp);
  }
}
// A player's projection: your edit if you made one, otherwise the Sleeper-stats estimate
const projOf = p => D.draft.proj?.[nameKey(p)] || (p.id && D.auto.get(p.id)) || PJ.map(() => 0);
// Season PPR points from a projection, as a quick sanity check
const projPts = v => v[0] * 0.04 + v[1] * 4 - v[2] + v[3] * 0.1 + v[4] * 6 + v[5] + v[6] * 0.1 + v[7] * 6 - v[8] * 2;
function buildRefs(experts){
  D.fpUpdated = experts?.updated || ""; D.experts = experts?.experts || {}; D.sources = experts?.sources || {};
  for (const p of experts?.proj || []) if (!D.fpProj.has(nameKey(p))) D.fpProj.set(nameKey(p), p.pj);
  const into = (map, rows) => (rows || []).forEach(p => { const k = nameKey(p); if (!map.has(k)) map.set(k, map.size + 1); });
  for (const f of ["sf", "1qb"]){
    (experts?.[f] || []).forEach(p => { const k = nameKey(p); if (!D.fp[f].has(k)){ D.fp[f].set(k, D.fpRows[f].length + 1); D.fpRows[f].push(p); } });
    into(D.dp[f], experts?.dp?.[f]); into(D.fc[f], experts?.fc?.[f]);
    // The starting template: FantasyPros' order, topped up with FantasyCalc then DynastyProcess players
    const seen = new Set(), tpl = [];
    for (const p of [...(experts?.[f] || []), ...(experts?.fc?.[f] || []), ...(experts?.dp?.[f] || [])]){
      const k = nameKey(p); if (seen.has(k)) continue; seen.add(k);
      if (tpl.length >= TEMPLATE_MIN && !D.fp[f].has(k)) continue;
      tpl.push({ name: p.name, pos: p.pos, id: p.id || "" });
    }
    D.tpl[f] = tpl;
  }
  // Sleeper's own player order (the same for both formats)
  Object.entries(D.sp).filter(([, p]) => ["QB", "RB", "WR", "TE"].includes(p.position) && p.team && p.search_rank)
    .sort(([, a], [, b]) => a.search_rank - b.search_rank)
    .forEach(([, p]) => { const k = normName(p.full_name || `${p.first_name || ""} ${p.last_name || ""}`) + "|" + p.position; if (!D.sl.has(k)) D.sl.set(k, D.sl.size + 1); });
}
const fromExperts = f => D.tpl[f].map(p => ({ id: p.id || D.idx.get(nameKey(p)) || "", name: p.name, pos: p.pos }));

// ---------- drawing ----------
function render(){
  if (D.fmt === "proj") return renderProj();
  const d = D.draft, list = d.lists[D.fmt], q = normName(D.q);
  const lw = d.last_week?.lists?.[D.fmt] ? new Map(d.last_week.lists[D.fmt].map((k, i) => [k, i + 1])) : null;
  const xAt = d.last_week?.experts?.[D.fmt] || null;   // experts' ranks when last week's list was published
  const have = new Set(list.map(nameKey)), missing = D.tpl[D.fmt].filter(p => !have.has(nameKey(p)));
  const stale = D.file.updated && Date.now() - Date.parse(D.file.updated) > 6 * 864e5;
  const rows = list.map((p, i) => ({ p, i })).filter(({ p }) => (D.pos === "ALL" || p.pos === D.pos) && (!q || normName(p.name).includes(q)));
  $("topRight").innerHTML = `<span class="pill ${D.file.updated ? "on" : ""}">${D.file.updated ? "Live on Front Office" : "Not published yet"}</span>`;
  $("app").innerHTML = `
    <section class="bar">
      <div class="seg">${Object.entries(TABS).map(([f, l]) => `<button type="button" data-a="fmt" data-f="${f}" aria-pressed="${D.fmt === f}">${l}</button>`).join("")}</div>
      <button class="btn" type="button" data-a="publish" ${D.dirty ? "" : "disabled"}>Publish</button>
    </section>
    <p class="status" id="st" role="status" aria-live="polite">${statusText()}</p>
    ${stale ? `<div class="note">It's a new week. Sort by <b>Experts moved</b> to see who the experts moved since your last list, then publish.</div>` : ""}
    ${sourcesBar()}
    ${missing.length ? `<div class="warn"><b>${missing.length} player${missing.length === 1 ? "" : "s"} from this week's template ${missing.length === 1 ? "isn't" : "aren't"} on your ${FMT[D.fmt]} list</b> (they'd rank after your #${list.length} on Front Office). <button type="button" class="chip" data-a="addall">+ Add all at their template spot</button> ${missing.slice(0, 6).map(p => `<button type="button" class="chip" data-a="addfp" data-k="${esc(nameKey(p))}">+ ${esc(p.name)}</button>`).join(" ")}</div>` : ""}
    <section class="tools">
      <div class="seg">${["ALL", "QB", "RB", "WR", "TE"].map(x => `<button type="button" data-a="pos" data-p="${x}" aria-pressed="${D.pos === x}">${x === "ALL" ? "All" : x}</button>`).join("")}</div>
      <input type="search" id="find" placeholder="Find a player on your list" value="${esc(D.q)}">
      <div class="addbox"><input type="search" id="addQ" placeholder="Add a player" autocomplete="off"><div class="addlist" id="addList" hidden></div></div>
    </section>
    <p class="help">Drag a player by the <b>⠿</b> handle, type a new number in <b>Rank</b>, or use the arrows. On a position tab, the arrows swap him with the next player at that position. <b>FantasyPros</b>, <b>FantasyCalc</b>, <b>DynastyProcess</b> and <b>Sleeper</b> are each source's rank for reference; green beside FantasyPros means you rank him higher. <b>FP moved</b> is how far FantasyPros moved him since your last weekly list.</p>
    <div class="wrap"><table class="rk"><thead><tr><th></th><th class="c">Rank</th><th class="hide-sm"></th><th>Player</th><th class="c hide-sm">Vs my last week</th><th class="c">Fantasy&shy;Pros</th><th class="c hide-sm">FP moved</th><th class="c hide-sm">Fantasy&shy;Calc</th><th class="c hide-sm">Dynasty&shy;Process</th><th class="c hide-sm">Sleeper</th><th class="c hide-sm">Avg of sources</th><th class="hide-sm">Depth chart</th><th class="c hide-sm">Age</th><th class="c hide-sm">Pts/G</th><th></th></tr></thead>
    <tbody id="rows">${rows.map(({ p, i }) => {
      const k = nameKey(p), sp = D.sp[p.id], fp = D.fp[D.fmt].get(k), dp = D.dp[D.fmt].get(k), fc = D.fc[D.fmt].get(k), sl = D.sl.get(k);
      const srcs = [fp, fc, dp].filter(Boolean), avg = srcs.length ? Math.round(srcs.reduce((t, x) => t + x, 0) / srcs.length) : null;
      const diff = fp ? fp - (i + 1) : null, was = lw?.get(rowKey(p)), mv = was ? was - (i + 1) : null, xw = xAt?.[k], xm = xw && fp ? xw - fp : null;
      const age = sp?.birth_date ? ((Date.now() - Date.parse(sp.birth_date)) / 31557600000).toFixed(1) : sp?.age || "";
      return `<tr data-i="${i}">
        <td class="h" title="Drag to move">⠿</td>
        <td class="c"><input class="num" type="number" min="1" max="${list.length}" value="${i + 1}" aria-label="${esc(p.name)}'s rank"></td>
        <td class="ar hide-sm"><button type="button" data-a="up" aria-label="Move up" ${i === 0 ? "disabled" : ""}>▲</button><button type="button" data-a="down" aria-label="Move down" ${i === list.length - 1 ? "disabled" : ""}>▼</button></td>
        <td><b>${esc(p.name)}</b> <small>${esc(p.pos)}${sp?.team ? " · " + esc(sp.team) : ""}</small></td>
        <td class="c hide-sm">${mv == null ? (lw ? "New" : "–") : mv === 0 ? "–" : `<span class="${mv > 0 ? "up" : "down"}">${mv > 0 ? "▲" : "▼"}${Math.abs(mv)}</span>`}</td>
        <td class="c">${fp ? `${fp}${Math.abs(diff) >= 5 ? ` <span class="${diff > 0 ? "up" : "down"}">(${diff > 0 ? "+" : ""}${diff})</span>` : ""}` : "–"}</td>
        <td class="c hide-sm">${xm ? `<span class="${xm > 0 ? "up" : "down"}">${xm > 0 ? "▲" : "▼"}${Math.abs(xm)}</span>` : "–"}</td>
        <td class="c hide-sm">${fc || "–"}</td>
        <td class="c hide-sm">${dp || "–"}</td>
        <td class="c hide-sm">${sl || "–"}</td>
        <td class="c hide-sm">${avg ? `<b>${avg}</b>` : "–"}</td>
        <td class="hide-sm">${esc(p.id ? (D.depth.get(p.id) || (sp?.team ? "Not on depth chart" : "")) : "")}</td>
        <td class="c hide-sm">${esc(age)}</td>
        <td class="c hide-sm">${D.ppg.get(p.id) || ""}</td>
        <td><button type="button" class="x" data-a="remove" aria-label="Remove ${esc(p.name)}" title="Remove from your list">×</button></td></tr>`;
    }).join("") || `<tr><td colspan="15" class="empty">No players match.</td></tr>`}</tbody></table></div>
    <details class="more"><summary>More options</summary>
      <button class="ghost" type="button" data-a="reset">Start fresh from this week's template (${FMT[D.fmt]})</button>
      <button class="ghost" type="button" data-a="copy">Copy ${D.fmt === "sf" ? "Superflex order into 1QB" : "1QB order into Superflex"}</button>
      ${D.dirty ? `<button class="ghost" type="button" data-a="discard">Discard unsaved changes</button>` : ""}
      <button class="ghost" type="button" data-a="logout">Forget token on this device</button>
    </details>`;
}
// ---------- Projections tab ----------
function projPlayers(){
  const seen = new Set(), out = [];
  for (const p of [...D.draft.lists.sf, ...D.draft.lists["1qb"]]){ const k = nameKey(p); if (!seen.has(k)){ seen.add(k); out.push(p); } }
  return out;
}
function renderProj(){
  const q = normName(D.q), all = projPlayers().filter(p => (D.pos === "ALL" || p.pos === D.pos) && (!q || normName(p.name).includes(q)));
  const rows = all.slice(0, D.shown), edited = Object.keys(D.draft.proj || {}).length;
  $("topRight").innerHTML = `<span class="pill ${D.file.updated ? "on" : ""}">${D.file.updated ? "Live on Front Office" : "Not published yet"}</span>`;
  $("app").innerHTML = `
    <section class="bar">
      <div class="seg">${Object.entries(TABS).map(([f, l]) => `<button type="button" data-a="fmt" data-f="${f}" aria-pressed="${D.fmt === f}">${l}</button>`).join("")}</div>
      <button class="btn" type="button" data-a="publish" ${D.dirty ? "" : "disabled"}>Publish</button>
    </section>
    <p class="status" id="st" role="status" aria-live="polite">${statusText()}</p>
    ${sourcesBar()}
    <div class="note">Season projections decide how much each player gains or loses under a league's own scoring (TE premium, 6-point passing TDs, PPR and so on). They start from each player's Sleeper stats this season (blended with last season early on), scaled to 17 games. The small grey number under each box is the FantasyPros projection, for reference only. Type over any number to set your own, or tap <b>Use FP</b> to copy a player's FantasyPros line; edited players are highlighted. ${edited ? `<b>${edited}</b> player${edited === 1 ? "" : "s"} edited.` : ""}</div>
    <section class="tools">
      <div class="seg">${["ALL", "QB", "RB", "WR", "TE"].map(x => `<button type="button" data-a="pos" data-p="${x}" aria-pressed="${D.pos === x}">${x === "ALL" ? "All" : x}</button>`).join("")}</div>
      <input type="search" id="find" placeholder="Find a player" value="${esc(D.q)}">
      <span></span>
    </section>
    <div class="wrap scroll"><table class="rk pj"><thead><tr><th>Player</th><th class="c">Games</th>${PJ.map(([, l]) => `<th class="c">${l}</th>`).join("")}<th class="c">PPR pts</th><th></th></tr></thead>
    <tbody>${rows.map(p => {
      const k = nameKey(p), v = projOf(p), mine = !!D.draft.proj?.[k], sp = D.sp[p.id], fpv = D.fpProj.get(k);
      return `<tr data-k="${esc(k)}" class="${mine ? "edited" : ""}"><td><b>${esc(p.name)}</b> <small>${esc(p.pos)}${sp?.team ? " · " + esc(sp.team) : ""}</small></td>
        <td class="c">${D.gp.get(p.id) || "–"}</td>
        ${v.map((x, j) => `<td class="c"><input class="pjn" type="number" step="${PJ_ROUND[j] ? "0.5" : "1"}" min="0" data-j="${j}" value="${x}" aria-label="${esc(p.name)} ${PJ[j][1]}">${fpv ? `<small class="fpv">${fpv[j]}</small>` : ""}</td>`).join("")}
        <td class="c"><b class="pts">${projPts(v).toFixed(0)}</b>${fpv ? `<small class="fpv">${projPts(fpv).toFixed(0)}</small>` : ""}</td>
        <td class="pj-acts">${fpv ? `<button type="button" class="ghost sm" data-a="pjfp" title="Copy the FantasyPros projection into this row">Use FP</button>` : ""}${mine ? `<button type="button" class="ghost sm" data-a="pjreset" title="Go back to the Sleeper-stats estimate">Reset</button>` : ""}</td></tr>`;
    }).join("") || `<tr><td colspan="13" class="empty">No players match.</td></tr>`}</tbody></table></div>
    ${all.length > rows.length ? `<button class="ghost" type="button" data-a="moreproj">Show ${Math.min(PAGE, all.length - rows.length)} more (${all.length - rows.length} left)</button>` : ""}`;
}
function sourcesBar(){
  const items = Object.entries(SRC).map(([k, label]) => {
    const st = D.sources[k];
    if (!st) return `<span class="src off">${label}: not downloaded yet</span>`;
    return st.ok ? `<span class="src ok">${label} ✓ ${esc(when(st.updated))}</span>`
      : `<span class="src off" title="${esc(st.why || "")}">${label} ✗ ${esc(st.why || "failed")}${st.updated ? ` (showing the copy from ${esc(when(st.updated))})` : ""}</span>`;
  }).join("");
  const anyBad = Object.keys(SRC).some(k => !D.sources[k]?.ok);
  return `<div class="srcbar">${items}${anyBad ? `<span class="src-help">To retry: GitHub → this repository → Actions → Update expert rankings → Run workflow.</span>` : ""}</div>`;
}
function statusText(){
  return `${D.dirty ? "Unsaved changes (kept on this device until you publish)." : `Last published ${esc(when(D.file.updated))}.`} Sources checked ${esc(when(D.fpUpdated))}${D.experts[D.fmt] ? `; FantasyPros has ${D.experts[D.fmt]} experts` : ""}.`;
}
// A projection edit: save it without redrawing, so Tab moves straight to the next box
function changedQuiet(){
  D.dirty = true;
  ls.set(DRAFT_KEY, JSON.stringify({ base: D.file.updated || "", draft: D.draft }));
  const st = $("st"); if (st){ st.className = "status"; st.textContent = statusText(); }
  const b = document.querySelector('[data-a="publish"]'); if (b) b.disabled = false;
}
function changed(){
  D.dirty = true;
  ls.set(DRAFT_KEY, JSON.stringify({ base: D.file.updated || "", draft: D.draft }));
  render();
}
function move(from, to){
  const list = D.draft.lists[D.fmt];
  to = Math.max(0, Math.min(list.length - 1, to));
  if (from === to) return render();
  const [p] = list.splice(from, 1); list.splice(to, 0, p);
  changed();
  requestAnimationFrame(() => document.querySelector(`tr[data-i="${to}"]`)?.classList.add("flash"));
}
function step(i, dir){
  const list = D.draft.lists[D.fmt];
  if (D.pos === "ALL") return move(i, i + dir);
  for (let j = i + dir; j >= 0 && j < list.length; j += dir) if (list[j].pos === list[i].pos) return move(i, j);
}

// ---------- drag and drop (mouse and touch) ----------
let drag = null;
document.addEventListener("pointerdown", e => {
  const h = e.target.closest("td.h"); if (!h) return;
  const tr = h.closest("tr"); e.preventDefault();
  drag = { tr, from: Number(tr.dataset.i), y: e.clientY, timer: setInterval(autoScroll, 30) };
  tr.classList.add("dragging"); h.setPointerCapture(e.pointerId);
});
document.addEventListener("pointermove", e => {
  if (!drag) return;
  drag.y = e.clientY;
  const rows = [...$("rows").children].filter(r => r !== drag.tr);
  const after = rows.find(r => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
  if (after) $("rows").insertBefore(drag.tr, after); else $("rows").appendChild(drag.tr);
});
function autoScroll(){ if (!drag) return; if (drag.y < 70) window.scrollBy(0, -14); else if (drag.y > innerHeight - 70) window.scrollBy(0, 14); }
function endDrag(){
  if (!drag) return;
  const { tr, from, timer } = drag; clearInterval(timer); drag = null; tr.classList.remove("dragging");
  const next = tr.nextElementSibling, prev = tr.previousElementSibling;
  let to = from;
  if (next){ const n = Number(next.dataset.i); to = n > from ? n - 1 : n; }
  else if (prev){ const p = Number(prev.dataset.i); to = p > from ? p : p + 1; }
  move(from, to);
}
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);

// ---------- editing ----------
document.addEventListener("click", e => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  const a = b.dataset.a, tr = b.closest("tr[data-i]"), i = tr ? Number(tr.dataset.i) : -1, list = D.draft?.lists[D.fmt];
  if (a === "fmt"){ D.fmt = b.dataset.f; D.shown = PAGE; return render(); }
  if (a === "moreproj"){ D.shown += PAGE; return render(); }
  if (a === "pjfp"){ const k = b.closest("tr").dataset.k, fpv = D.fpProj.get(k); if (fpv){ D.draft.proj[k] = [...fpv]; changed(); } return; }
  if (a === "pjreset"){ delete D.draft.proj[b.closest("tr").dataset.k]; changed(); return; }
  if (a === "pos"){ D.pos = b.dataset.p; return render(); }
  if (a === "up") return step(i, -1);
  if (a === "down") return step(i, 1);
  if (a === "remove"){ list.splice(i, 1); return changed(); }
  if (a === "addfp"){
    const t = D.tpl[D.fmt], at = t.findIndex(x => nameKey(x) === b.dataset.k), p = t[at]; if (!p) return;
    list.splice(Math.min(list.length, at), 0, { id: p.id || D.idx.get(nameKey(p)) || "", name: p.name, pos: p.pos });
    return changed();
  }
  if (a === "addall"){
    const have = new Set(list.map(nameKey));
    D.tpl[D.fmt].forEach((p, at) => { if (!have.has(nameKey(p))){ list.splice(Math.min(list.length, at), 0, { id: p.id || D.idx.get(nameKey(p)) || "", name: p.name, pos: p.pos }); have.add(nameKey(p)); } });
    return changed();
  }
  if (a === "addsp"){
    const sp = D.sp[b.dataset.id]; if (!sp) return;
    const n = Number(prompt(`Add ${sp.full_name} at what rank? (1–${list.length + 1})`, String(list.length + 1)));
    if (!n) return;
    list.splice(Math.max(1, Math.min(list.length + 1, Math.round(n))) - 1, 0, { id: b.dataset.id, name: sp.full_name, pos: sp.position });
    return changed();
  }
  if (a === "reset"){ if (confirm(`Replace your whole ${FMT[D.fmt]} list with this week's template?`)){ D.draft.lists[D.fmt] = fromExperts(D.fmt); changed(); } return; }
  if (a === "copy"){ const o = D.fmt === "sf" ? "1qb" : "sf"; if (confirm(`Replace your ${FMT[o]} list with your ${FMT[D.fmt]} order?`)){ D.draft.lists[o] = JSON.parse(JSON.stringify(list)); changed(); } return; }
  if (a === "discard"){ if (confirm("Throw away your unsaved changes?")){ ls.del(DRAFT_KEY); D.draft = JSON.parse(JSON.stringify(D.file)); D.dirty = false; render(); } return; }
  if (a === "logout"){ ls.del(TOKEN_KEY); return renderAuth(); }
  if (a === "publish") return publish();
});
document.addEventListener("change", e => {
  if (e.target.classList.contains("pjn")){
    const tr = e.target.closest("tr"), k = tr.dataset.k, p = projPlayers().find(x => nameKey(x) === k); if (!p) return;
    const v = [...projOf(p)], j = Number(e.target.dataset.j); v[j] = Math.max(0, Number(e.target.value) || 0);
    D.draft.proj = D.draft.proj || {}; D.draft.proj[k] = v; tr.classList.add("edited");
    tr.querySelector(".pts").textContent = projPts(v).toFixed(0);
    return changedQuiet();
  }
  if (e.target.classList.contains("num")){
    const i = Number(e.target.closest("tr").dataset.i), to = Math.round(Number(e.target.value));
    if (to >= 1) move(i, to - 1); else e.target.value = i + 1;
  }
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList?.contains("num")) e.target.blur(); });
document.addEventListener("input", e => {
  if (e.target.id === "find"){ D.q = e.target.value; const c = e.target.selectionStart; render(); const f = $("find"); f.focus(); f.setSelectionRange(c, c); return; }
  if (e.target.id === "addQ"){
    const q = normName(e.target.value), box = $("addList");
    if (q.length < 2){ box.hidden = true; return; }
    const have = new Set(D.draft.lists[D.fmt].map(p => p.id).filter(Boolean));
    const hits = Object.entries(D.sp).filter(([pid, p]) => ["QB", "RB", "WR", "TE"].includes(p.position) && !have.has(pid) && normName(p.full_name || "").includes(q))
      .sort(([, a], [, b]) => (!!b.team - !!a.team) || (a.search_rank || 1e9) - (b.search_rank || 1e9)).slice(0, 8);
    box.innerHTML = hits.map(([pid, p]) => `<button type="button" data-a="addsp" data-id="${esc(pid)}">${esc(p.full_name)} <small>${esc(p.position)} · ${esc(p.team || "FA")}</small></button>`).join("") || `<p class="empty">No one found.</p>`;
    box.hidden = false;
  }
});
window.addEventListener("beforeunload", e => { if (D.dirty){ e.preventDefault(); e.returnValue = ""; } });

// ---------- publishing ----------
async function putFile(path, obj, sha, message){
  const text = JSON.stringify(obj) + "\n";
  const bytes = new TextEncoder().encode(text); let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const r = await fetch(api(path), { method: "PUT", headers: { ...ghHeaders(false), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: btoa(bin), sha: sha || undefined, branch: FO.branch }) });
  if (r.status === 401) throw new Error("Your token has expired or was removed. Forget it and unlock again.");
  if (!r.ok) throw new Error(r.status === 409 ? "These rankings were published from somewhere else since you opened this page. Reload and try again." : `GitHub didn't accept it (error ${r.status}). Check the token's Contents permission.`);
  return (await r.json()).content?.sha || sha;
}
async function publish(){
  const st = $("st");
  for (const f of ["sf", "1qb"]) if (D.draft.lists[f].length < 50){ st.textContent = `Your ${FMT[f]} list needs at least 50 players.`; st.className = "status error"; return; }
  st.className = "status"; st.textContent = "Publishing...";
  const now = new Date(), clean = l => l.map(p => ({ id: p.id || "", name: p.name, pos: p.pos }));
  // The public file Front Office reads: your two lists and the time, nothing else
  const pub = { updated: now.toISOString(), lists: { sf: clean(D.draft.lists.sf), "1qb": clean(D.draft.lists["1qb"]) },
    proj_fields: PJ.map(([k]) => k), proj: Object.fromEntries(projPlayers().map(p => [nameKey(p), projOf(p)]).filter(([, v]) => v.some(x => x > 0))) };
  // Private Desk notes: once a week, the list being replaced becomes "last week", with the experts' ranks at that time
  let last = D.draft.last_week || null;
  if (D.file.updated && (!last || now - Date.parse(last.saved || 0) >= WEEK - 864e5)){
    const xr = f => Object.fromEntries([...D.fp[f]]);
    last = { saved: now.toISOString(), lists: { sf: D.file.lists.sf.map(rowKey), "1qb": D.file.lists["1qb"].map(rowKey) }, experts: { sf: xr("sf"), "1qb": xr("1qb") } };
  }
  try {
    const day = now.toLocaleDateString();
    D.sha = await putFile(FILE, pub, D.sha, `Publish rankings (${day})`);
    D.stateSha = await putFile(STATE, { last_week: last, proj_overrides: D.draft.proj || {} }, D.stateSha, `Desk notes (${day})`);
    D.file = { updated: pub.updated, lists: JSON.parse(JSON.stringify(pub.lists)), last_week: last, proj: JSON.parse(JSON.stringify(D.draft.proj || {})) }; D.draft = JSON.parse(JSON.stringify(D.file)); D.dirty = false; ls.del(DRAFT_KEY);
    render();
    $("st").textContent = "Published. Front Office will use these rankings within about 2 minutes (reload any open league).";
  } catch(e){ st.textContent = e.message; st.className = "status error"; }
}

if (token()) load(); else renderAuth();

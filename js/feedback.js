// Front Office: Beta feedback form
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// BETA FEEDBACK
// Posts go to a Google Form, and the board reads the Form's response
// sheet (published as CSV). Fill in the four links below once.
// To hide a post: in the response sheet, type "yes" in a column
// named "Hidden" on that row.
// ============================================================
const FEEDBACK = {
  formAction: "https://docs.google.com/forms/d/e/1FAIpQLScj5WkSDhFYMweG58RTLak_TAIQ5TY2ChC7yHZJBvGFxRaUbw/formResponse",
  // Question IDs from the form's pre-filled link. Type and league are optional: when the form
  // has no Type/League questions, they're tucked into the feedback text as "[Bug | League] ..."
  fields: { name: "entry.475520917", type: "", message: "entry.154091632", league: "" },
  // Published response sheet as CSV (the same publish link, with /pubhtml swapped for /pub?output=csv)
  csv: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSPJxeizc9URJYgx-ssY4NB_uh0dejbrujggT7DOBfQaf0xAIx3pz1UK4uhG8oYxLoy22o3Qvvt57Sm/pub?output=csv"
};
const fbCanPost = () => !!(FEEDBACK.formAction && FEEDBACK.fields.message);
const fbReady = () => fbCanPost() && !!FEEDBACK.csv;
let fbPosts = null, fbPending = [], fbFilter = "All";

function setupFeedbackForm(){
  if (S.teams?.get && S.myRid != null && !$("fbName").value) $("fbName").value = S.teams.get(S.myRid)?.name || "";
}
$("fbType").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  for (const x of $("fbType").children) x.setAttribute("aria-checked", x === b);
});
$("fbMsg").addEventListener("input", () => { $("fbCount").textContent = `${$("fbMsg").value.length} / 1000`; });
$("fbFilter").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  fbFilter = b.dataset.type;
  for (const x of $("fbFilter").children) x.setAttribute("aria-pressed", x === b);
  renderFeedback();
});

async function loadFeedback(){
  setupFeedbackForm();
  $("fbSend").disabled = !fbCanPost();
  if (!fbReady()){
    $("fbList").innerHTML = fbPending.length ? "" : `<p class="empty">${fbCanPost() ? "The public board is coming soon. You can already post feedback, and it will show here once the board is switched on." : "The feedback board isn't connected yet."}</p>`;
    if (fbPending.length) renderFeedback();
    return;
  }
  try {
    const r = await fetch(FEEDBACK.csv + (FEEDBACK.csv.includes("?") ? "&" : "?") + "t=" + Date.now());
    if (!r.ok) throw new Error("csv " + r.status);
    const rows = parseCSV(await r.text());
    const h = (rows[0] || []).map(x => x.trim().toLowerCase());
    const col = (...names) => h.findIndex(x => names.some(n => x.includes(n)));
    const iTime = col("timestamp"), iName = col("name"), iType = col("type"), iMsg = col("feedback", "message"), iLeague = col("league"), iHide = col("hidden"), iOfficial = col("official");
    fbPosts = rows.slice(1).filter(r => r[iMsg] && !(iHide >= 0 && /^(y|yes|x|true|hide)/i.test((r[iHide] || "").trim())))
      .map(r => {
        let msg = r[iMsg], type = iType >= 0 ? (r[iType] || "").trim() : "", league = iLeague >= 0 ? r[iLeague] : "";
        // Unpack "[Bug | League name] message" written by Front Office
        const m = msg.match(/^\[(Update|Idea|Bug|Other|Question|Praise)(?: \| ([^\]]*))?\]\s*/);
        if (m){ type = type || m[1]; league = league || m[2] || ""; msg = msg.slice(m[0].length); }
        if (type === "Question" || type === "Praise") type = "Other";   // older posts
        // With an "Official" column in the sheet, only rows you mark "yes" there get the crown and count as
        // Updates, so nobody can pose as you by typing your name. Without that column, names decide (as before).
        const official = iOfficial >= 0 ? /^(y|yes|x|true)/i.test((r[iOfficial] || "").trim()) : null;
        if (official === false && type === "Update") type = "Other";
        return { time: r[iTime] || "", name: r[iName] || "", type: type || "Other", msg, league, official };
      });
    fbPosts.reverse(); // newest first
    // Drop local "just posted" items once they show up on the board
    fbPending = fbPending.filter(p => !fbPosts.some(q => q.msg === p.msg));
    renderFeedback();
  } catch(e){
    console.error(e);
    $("fbList").innerHTML = `<p class="empty">Couldn't load the feedback board. Check your connection and reopen this tab.</p>`;
  }
}
// Posts from these names get a crown (not case-sensitive)
const CROWN_NAMES = ["pat", "dev"];
const CROWN = `<svg class="crown" viewBox="0 0 24 24" width="17" height="17" fill="currentColor" role="img" aria-label="Front Office team"><title>Front Office team</title><path d="M3 7.5l4.6 3.6L12 4l4.4 7.1L21 7.5l-1.8 10.2H4.8L3 7.5zM5 19h14v2H5z"/></svg>`;
const isCrowned = (name, official) => official == null ? CROWN_NAMES.includes(String(name || "").trim().toLowerCase()) : official;
function renderFeedback(){
  const all = [...fbPending, ...(fbPosts || [])]
    .map(p => isCrowned(p.name, p.official) ? { ...p, type: "Update" } : p)     // your posts are always Updates
    .filter(p => fbFilter === "All" || p.type === fbFilter);
  if (!all.length){ $("fbList").innerHTML = `<p class="empty">${fbFilter === "All" ? "No feedback yet. Be the first to post." : "Nothing here yet."}</p>`; return; }
  const types = ["Update","Idea","Bug","Other"];
  $("fbList").innerHTML = all.slice(0, 200).map(p => {
    const type = types.includes(p.type) ? p.type : "Other";
    return `<article class="fb-item${p.pending ? " pending" : ""}">
      <div class="fb-meta"><span class="fb-type t-${type}">${type}</span><b class="fb-name">${esc(p.name || "Anonymous")}${isCrowned(p.name, p.official) ? CROWN : ""}</b>${p.league ? `<span>${esc(p.league)}</span>` : ""}<span>${esc(p.pending ? "Just posted, visible to everyone within a few minutes" : p.time)}</span></div>
      <p class="fb-msg">${esc(p.msg)}</p></article>`;
  }).join("");
}
$("fbForm").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("fbMsg").value.trim();
  const st = $("fbStatus");
  if (!fbCanPost()){ st.textContent = "The feedback board isn't connected yet."; st.className = "status error"; return; }
  if (msg.length < 3){ st.textContent = "Write a few words of feedback first."; st.className = "status error"; $("fbMsg").focus(); return; }
  const name = $("fbName").value.trim(), league = S.league?.name || "";
  const type = isCrowned(name) ? "Update"
    : [...$("fbType").children].find(x => x.getAttribute("aria-checked") === "true")?.dataset.type || "Other";
  const body = new URLSearchParams(); // standard form encoding, which Google Forms expects
  const tag = !FEEDBACK.fields.type ? `[${type}${league && !FEEDBACK.fields.league ? " | " + league.replace(/[\[\]]/g, "") : ""}] ` : "";
  body.append(FEEDBACK.fields.message, tag + msg);
  if (FEEDBACK.fields.name) body.append(FEEDBACK.fields.name, name);
  if (FEEDBACK.fields.type) body.append(FEEDBACK.fields.type, type);
  if (FEEDBACK.fields.league) body.append(FEEDBACK.fields.league, league);
  $("fbSend").disabled = true; st.className = "status"; st.textContent = "Posting...";
  try {
    // Google Forms doesn't allow reading the reply from another site, so "no-cors" sends it blind
    await fetch(FEEDBACK.formAction, { method: "POST", mode: "no-cors", body });
    fbPending.unshift({ name, type, msg, league, pending: true });
    $("fbMsg").value = ""; $("fbCount").textContent = "0 / 1000";
    st.textContent = "Thanks! Your feedback is posted.";
    renderFeedback();
  } catch(err){
    st.textContent = "Couldn't post. Check your connection and try again."; st.className = "status error";
  } finally { $("fbSend").disabled = false; }
});


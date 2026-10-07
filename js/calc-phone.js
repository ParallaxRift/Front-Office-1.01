// Front Office: phone trade calculator and Trade Finder helpers
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// PHONE CALCULATOR (KeepTradeCut-style)
// On phones the calculator is two stacked team boxes, then the result:
//   You send: team picker, an "Add a player or pick" search box, the pieces added, the total
//   You get:  the same, for the trade partner
//   Result:   the verdict, the bar, the math and the share buttons, right below
// Tapping the search box lists that team's roster; typing narrows it. Everything fits on one
// screen, so there's no switching sides and no scrolling back up for the result.
// It reuses the desktop board's own pieces (the same players, value adjustment and verdict),
// rearranged by the phone stylesheet. Desktop never shows any of this.
// ============================================================
const PK_SIDES = { A: { set: () => S.sendIds, sel: "teamA", faab: "send", col: 0 }, B: { set: () => S.getIds, sel: "teamB", faab: "get", col: 1 } };
const pkCols = [...document.querySelectorAll("#bPlayers .bcol")];
for (const [side, cfg] of Object.entries(PK_SIDES)){
  const col = pkCols[cfg.col];
  const top = document.createElement("div"); top.className = "kt-top";
  top.innerHTML = `<div class="kt-team"><span class="kt-av" id="ktAv${side}"></span><select id="ktTeam${side}" aria-label="${side === "A" ? "Your team" : "Trade partner"}"></select></div>
    <div class="kt-search"><input type="search" id="ktQ${side}" placeholder="Add a player or pick" autocomplete="off" aria-label="Add a player or pick to the ${side === "A" ? "send" : "get"} side"><div class="kt-drop" id="ktDrop${side}" hidden></div></div>`;
  col.querySelector(".bp-label").after(top);
  const tot = document.createElement("div"); tot.className = "kt-total"; tot.id = "ktTot" + side;
  col.appendChild(tot);
}
function ktTeams(){
  for (const side of ["A", "B"]){
    const src = $(PK_SIDES[side].sel), sel = $("ktTeam" + side);
    if (sel.innerHTML !== src.innerHTML) sel.innerHTML = src.innerHTML;
    if (sel.value !== src.value) sel.value = src.value;
    const rid = Number(src.value), av = rid ? teamPhoto(rid, "sm") : "";
    if ($("ktAv" + side).dataset.rid !== String(rid)){ $("ktAv" + side).innerHTML = av; $("ktAv" + side).dataset.rid = rid; }
  }
  const t = (id, txt) => { if ($(id).textContent !== txt) $(id).textContent = txt; };
  t("ktTotA", "Total " + $("sendNum").textContent); t("ktTotB", "Total " + $("getNum").textContent);
}
// the roster list under the search box
function ktDrop(side){
  const cfg = PK_SIDES[side], rid = Number($(cfg.sel).value), q = normName($("ktQ" + side).value), set = cfg.set();
  const items = teamAssets(rid).filter(a => a.value > 0 && (!q || normName(a.name).includes(q))).sort((a, b) => b.value - a.value).slice(0, 60);
  const faab = !q || "faab".includes(q) ? faabLeft(rid) : 0;
  $("ktDrop" + side).innerHTML = (faab > 0 ? `<button type="button" class="kt-opt${S.faabOn[cfg.faab] ? " on" : ""}" data-faab="${cfg.faab}"><span class="kt-pos">FAAB</span><span class="kt-nm"><b>FAAB</b><small>$${faab} left · tap to ${S.faabOn[cfg.faab] ? "remove" : "add"}</small></span><span class="kt-v">${fmt(faabValue(faab))}</span></button>` : "")
    + (items.map(a => `<button type="button" class="kt-opt${set.has(a.id) ? " on" : ""}" data-id="${esc(a.id)}"><span class="kt-pos">${esc(a.kind === "pick" ? "PICK" : a.pos)}</span><span class="kt-nm"><b>${esc(a.name)}${a.kind === "player" ? injTag(a.pid) : ""}</b><small>${esc(a.kind === "player" ? [a.nfl, a.age ? "age " + ageText(a.age) : ""].filter(Boolean).join(", ") : a.nfl || "")}</small></span><span class="kt-v">${fmt(a.value)}</span></button>`).join("")
    || `<p class="kt-none">No players match.</p>`);
  $("ktDrop" + side).hidden = false;
}
const ktClose = side => { $("ktDrop" + side).hidden = true; $("ktQ" + side).value = ""; };
for (const side of ["A", "B"]){
  const cfg = PK_SIDES[side];
  $("ktQ" + side).addEventListener("focus", () => { ktClose(side === "A" ? "B" : "A"); ktDrop(side); });
  $("ktQ" + side).addEventListener("input", () => ktDrop(side));
  $("ktDrop" + side).addEventListener("pointerdown", e => e.preventDefault());   // keep the keyboard steady while picking
  $("ktDrop" + side).addEventListener("click", e => {
    const f = e.target.closest("[data-faab]"), o = e.target.closest("[data-id]");
    if (f){ const rid = Number($(cfg.sel).value); S.faabOn[cfg.faab] = !S.faabOn[cfg.faab]; S.faab[cfg.faab] = S.faabOn[cfg.faab] ? faabLeft(rid) : 0; }
    else if (o){ const set = cfg.set(); set.has(o.dataset.id) ? set.delete(o.dataset.id) : set.add(o.dataset.id); }
    else return;
    renderCalc(); ktClose(side); $("ktQ" + side).blur();
  });
  $("ktTeam" + side).addEventListener("change", e => { const src = $(cfg.sel); src.value = e.target.value; src.dispatchEvent(new Event("change", { bubbles: true })); });
}
document.addEventListener("pointerdown", e => { for (const side of ["A", "B"]) if (!e.target.closest(`#ktDrop${side}, #ktQ${side}`) && !$("ktDrop" + side).hidden) ktClose(side); });
// FAAB on the board: tap the amount to change it
$("bPlayers").addEventListener("click", e => {
  if (!isPhoneView()) return;
  const it = e.target.closest(".bitem"), x = it?.querySelector(".bi-x[data-faab]");
  if (!x || e.target.closest(".bi-x")) return;
  const side = x.dataset.faab, rid = Number($(side === "send" ? "teamA" : "teamB").value), max = faabLeft(rid);
  const v = prompt(`How much FAAB? ($0–$${max})`, S.faab[side]); if (v == null) return;
  const n = Math.max(0, Math.min(max, Math.round(Number(String(v).replace(/[^0-9]/g, "")) || 0)));
  S.faab[side] = n; S.faabOn[side] = n > 0; renderCalc();
});
new MutationObserver(ktTeams).observe($("board"), { subtree: true, childList: true, characterData: true });
["teamA", "teamB"].forEach(id => $(id).addEventListener("change", () => setTimeout(ktTeams)));
ktTeams();

// ---------- Trade Finder on phones: pick players to trade away from a sheet ----------
// The "Player to Trade Away" roster is long, and the trade ideas used to sit below it. On phones the
// roster opens in a sheet instead (tap players, then Done), and the ideas show right under the button.
const tfOpen = document.createElement("button");
tfOpen.type = "button"; tfOpen.className = "tf-open-pick"; tfOpen.id = "tfOpenPick";
document.querySelector("#panel-finder .tf-main").prepend(tfOpen);
const tfSheet = document.createElement("div");
tfSheet.className = "more-sheet pick-sheet tf-sheet"; tfSheet.id = "tfSheet"; tfSheet.hidden = true;
tfSheet.innerHTML = `<div class="ms-backdrop" data-done></div>
  <div class="ms-panel pk-panel" role="dialog" aria-modal="true" aria-label="Players to trade away">
    <div class="tfs-head"><b>Players to trade away</b><small>Tap one or more of your players or picks.</small></div>
    <div class="pk-body" id="tfsBody"></div>
    <div class="pk-foot"><button type="button" class="btn" data-done id="tfsDone">Show trade ideas</button></div>
  </div>`;
document.body.appendChild(tfSheet);
const tfPickEl = document.querySelector("#panel-finder .tf-pick");
function tfOpenSync(){
  const names = [...tfSend].map(id => S.assets?.get(id)?.name).filter(Boolean);
  const label = names.length ? `<b>Trading away: ${esc(names.join(", "))}</b><small>Tap to change</small>` : `<b>+ Choose players to trade away</b><small>See what they could get you</small>`;
  if (tfOpen.innerHTML !== label) tfOpen.innerHTML = label;
  const done = names.length ? `Show trade ideas (${names.length})` : "Done";
  if ($("tfsDone").textContent !== done) $("tfsDone").textContent = done;
}
function openTfSheet(){
  $("tfsBody").replaceChildren(tfPickEl);
  tfSheet.hidden = false; document.body.classList.add("sheet-open");
  requestAnimationFrame(() => tfSheet.classList.add("open"));
}
function closeTfSheet(scroll = true){
  if (tfPickEl.parentElement !== $("tfsBody")) return;
  tfOpen.after(tfPickEl);
  document.body.classList.remove("sheet-open");
  tfSheet.classList.remove("open"); setTimeout(() => { tfSheet.hidden = true; }, 200);
  if (scroll && tfSend.size) $("tfHeading").scrollIntoView({ behavior: "smooth", block: "start" });
}
tfOpen.addEventListener("click", openTfSheet);
tfSheet.addEventListener("click", e => { if (e.target.closest("[data-done]")) closeTfSheet(); });
new MutationObserver(tfOpenSync).observe($("tfSending"), { subtree: true, childList: true, characterData: true });
new MutationObserver(() => { if (!$("panel-finder").classList.contains("on")) closeTfSheet(false); }).observe($("panel-finder"), { attributes: true, attributeFilter: ["class"] });
window.addEventListener("resize", () => { if (!isPhoneView()) closeTfSheet(false); });
tfOpenSync();

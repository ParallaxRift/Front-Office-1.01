// Front Office: phone trade calculator (pick players from a sheet that slides up)
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// PHONE CALCULATOR
// On phones the trade board stays at the top of the screen. Each side has an "Add" button that
// opens that team's roster in a sheet sliding up from the bottom, with a live result strip at the
// top, so you never switch sides or scroll back up to see the verdict. Tap Done to close it.
// The roster inside the sheet is the same one desktop shows (same search, filters, FAAB row);
// it's simply moved into the sheet while it's open and put back after. Desktop never sees any of this.
// ============================================================
const pkAdds = document.createElement("div");
pkAdds.className = "pk-adds"; pkAdds.id = "pkAdds";
pkAdds.innerHTML = `<button type="button" data-pick="A"><b>+ Your players</b><small id="pkNameA"></small></button><button type="button" data-pick="B"><b>+ Their players</b><small id="pkNameB"></small></button>`;
$("bPlayers").after(pkAdds);

const pickSheet = document.createElement("div");
pickSheet.className = "more-sheet pick-sheet"; pickSheet.id = "pickSheet"; pickSheet.hidden = true;
pickSheet.innerHTML = `<div class="ms-backdrop" data-done></div>
  <div class="ms-panel pk-panel" role="dialog" aria-modal="true" aria-label="Add players to the trade">
    <div class="pk-live" id="pkLive" aria-live="polite">
      <div class="pk-nums"><span class="s">Send <b id="pkSend">0</b></span><span class="g">Get <b id="pkGet">0</b></span></div>
      <div class="pk-verdict" id="pkVerdict"></div>
      <div class="pk-track"><i id="pkFill"></i><span></span></div>
    </div>
    <div class="pk-tabs" role="tablist"><button type="button" data-pick="A">You send</button><button type="button" data-pick="B">You get</button></div>
    <div class="pk-body" id="pkBody"></div>
    <div class="pk-foot"><button type="button" class="btn" data-done>Done, see the result</button></div>
  </div>`;
document.body.appendChild(pickSheet);

let pkSide = null;
const sideEl = s => document.querySelector(`.side[data-side="${s}"]`);
// (only writes when something changed: the team names sit on the board, which is being watched)
const pkSet = (id, txt) => { const e = $(id); if (e.textContent !== txt) e.textContent = txt; };
function pkSync(){
  pkSet("pkSend", $("sendNum").textContent); pkSet("pkGet", $("getNum").textContent);
  pkSet("pkVerdict", $("verdict").textContent);
  const f = $("fill"), pf = $("pkFill"), w = f.style.width || "50%";
  if (pf.style.width !== w) pf.style.width = w;
  if (pf.className !== f.className) pf.className = f.className;
  pkSet("pkNameA", S.teams?.get(Number($("teamA").value))?.name || "");
  pkSet("pkNameB", S.teams?.get(Number($("teamB").value))?.name || "");
}
function pkShow(side){
  if (pkSide && pkSide !== side) $("sides").insertBefore(sideEl(pkSide), pkSide === "A" ? $("sides").firstChild : null);   // put the other roster back
  pkSide = side;
  $("pkBody").replaceChildren(sideEl(side));
  for (const b of pickSheet.querySelectorAll(".pk-tabs button")) b.setAttribute("aria-selected", b.dataset.pick === side);
  $("pkBody").scrollTop = 0; pkSync();
}
function openPicker(side){
  pkShow(side);
  pickSheet.hidden = false; document.body.classList.add("sheet-open");
  requestAnimationFrame(() => pickSheet.classList.add("open"));
}
function closePicker(){
  if (!pkSide) return;
  $("sides").insertBefore(sideEl(pkSide), pkSide === "A" ? $("sides").firstChild : null);
  pkSide = null; document.body.classList.remove("sheet-open");
  pickSheet.classList.remove("open"); setTimeout(() => { pickSheet.hidden = true; }, 200);
  window.scrollTo({ top: Math.max(0, $("board").getBoundingClientRect().top + window.scrollY - 70), behavior: "smooth" });
}
pkAdds.addEventListener("click", e => { const b = e.target.closest("[data-pick]"); if (b) openPicker(b.dataset.pick); });
pickSheet.addEventListener("click", e => {
  if (e.target.closest("[data-done]")) return closePicker();
  const t = e.target.closest(".pk-tabs [data-pick]"); if (t) pkShow(t.dataset.pick);
});
// keep the strip in step with the board, whatever changes it
new MutationObserver(pkSync).observe($("board"), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["style", "class"] });
// leaving the calculator (or the phone turning into a wide screen) puts the rosters back
new MutationObserver(() => { if (pkSide && !$("panel-calc").classList.contains("on")) closePicker(); }).observe($("panel-calc"), { attributes: true, attributeFilter: ["class"] });
window.addEventListener("resize", () => { if (pkSide && !isPhoneView()) closePicker(); });

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

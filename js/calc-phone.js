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

// ---------- Trade Finder on phones (the same search-to-add idea as the calculator) ----------
// Top to bottom on phones:
//   1. Players to trade away: a search box listing your roster, the players you picked, a Filters row
//   2. Suggested trades: the first 3, then a button for up to 12 more
//   3. Recommended players to trade for: the first 3, then a button for more
// The filters and the "picked" list are the desktop elements themselves, moved here on phones and put
// back when the screen gets wide again, so everything keeps working the same way.
const tfBox = document.createElement("div");
tfBox.className = "tfp"; tfBox.id = "tfPhone";
tfBox.innerHTML = `<div class="tfp-head"><h3>Players to trade away</h3><button type="button" class="ghost tfp-reset" id="tfpReset">Reset</button></div>
  <div class="kt-search"><input type="search" id="tfpQ" placeholder="Add a player or pick" autocomplete="off" aria-label="Add a player or pick to trade away"><div class="kt-drop" id="tfpDrop" hidden></div></div>
  <div class="tfp-picked" id="tfpPicked"></div>
  <details class="tfp-filters" id="tfpFilters"><summary>Filters</summary><div id="tfpFilterSlot"></div></details>`;
const tfQ = tfBox.querySelector("#tfpQ"), tfDropEl = tfBox.querySelector("#tfpDrop"), tfPicked = tfBox.querySelector("#tfpPicked"), tfFilterSlot = tfBox.querySelector("#tfpFilterSlot");
const tfMore = document.createElement("button");
tfMore.type = "button"; tfMore.className = "ghost tf-more tfp-more"; tfMore.id = "tfResMore"; tfMore.hidden = true;
$("tfResults").after(tfMore);
const tfHome = { sending: [$("tfSending").parentElement, $("tfSending").nextSibling], filters: [document.querySelector(".tf-filters").parentElement, document.querySelector(".tf-filters").nextSibling] };
function tfPlace(){
  const phone = isPhoneView(), filters = document.querySelector(".tf-filters");
  if (phone && !tfBox.isConnected){
    document.querySelector("#panel-finder .tf-main").prepend(tfBox);
    tfPicked.appendChild($("tfSending"));
    tfFilterSlot.append(filters, $("tfPlan"));
  } else if (!phone && tfBox.isConnected){
    tfHome.sending[0].insertBefore($("tfSending"), tfHome.sending[1]);
    tfHome.filters[0].insertBefore(filters, tfHome.filters[1]);
    filters.after($("tfPlan"));
    tfBox.remove();
  }
}
function tfpDrop(){
  const me = Number($("tfTeam").value), q = normName(tfQ.value);
  const items = teamAssets(me).filter(a => a.value > 0 && (!q || normName(a.name).includes(q))).sort((a, b) => b.value - a.value).slice(0, 60);
  tfDropEl.innerHTML = items.map(a => `<button type="button" class="kt-opt${tfSend.has(a.id) ? " on" : ""}" data-id="${esc(a.id)}"><span class="kt-pos">${esc(a.kind === "pick" ? "PICK" : a.pos)}</span><span class="kt-nm"><b>${esc(a.name)}${a.kind === "player" ? injTag(a.pid) : ""}</b><small>${esc(a.kind === "player" ? [a.nfl, a.age ? "age " + ageText(a.age) : ""].filter(Boolean).join(", ") : a.nfl || "")}</small></span><span class="kt-v">${fmt(a.value)}</span></button>`).join("") || `<p class="kt-none">No players match.</p>`;
  tfDropEl.hidden = false;
}
const tfpClose = () => { tfDropEl.hidden = true; tfQ.value = ""; };
tfQ.addEventListener("focus", tfpDrop);
tfQ.addEventListener("input", tfpDrop);
tfDropEl.addEventListener("pointerdown", e => e.preventDefault());
tfDropEl.addEventListener("click", e => {
  const o = e.target.closest("[data-id]"); if (!o) return;
  tfTarget = null; tfSend.has(o.dataset.id) ? tfSend.delete(o.dataset.id) : tfSend.add(o.dataset.id);
  tfpClose(); tfQ.blur(); renderFinder();
  $("tfHeading").scrollIntoView({ behavior: "smooth", block: "start" });
});
document.addEventListener("pointerdown", e => { if (!tfDropEl.hidden && !e.target.closest("#tfpDrop, #tfpQ")) tfpClose(); });
tfBox.querySelector("#tfpReset").addEventListener("click", () => $("tfReset").click());
// Suggested trades: 3 at first, the rest behind "Show more"
function tfMoreSync(){
  const n = $("tfResults").querySelectorAll(":scope > article").length, open = $("tfResults").classList.contains("all");
  tfMore.hidden = n <= 3;
  const label = open ? "Show fewer" : `Show ${n - 3} more`;
  if (tfMore.textContent !== label) tfMore.textContent = label;
}
new MutationObserver(() => { $("tfResults").classList.remove("all"); tfMoreSync(); }).observe($("tfResults"), { childList: true });
tfMore.addEventListener("click", () => { $("tfResults").classList.toggle("all"); tfMoreSync(); if (!$("tfResults").classList.contains("all")) $("tfHeading").scrollIntoView({ behavior: "smooth", block: "start" }); });
tfPlace(); tfMoreSync();
window.matchMedia("(max-width:600px)").addEventListener("change", () => { tfPlace(); if (S.league) renderFinder(); });

// Front Office: Calculator: browse all players
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// ALL PLAYERS (calculator)
// Each side's team dropdown starts with "All Players". In that mode the list
// shows every player and pick in the league; tapping one adds it to that side
// and switches the side to the player's team (one team per side of a trade).
// ============================================================
const browseAll = { A: false, B: false };
function setBrowse(side, on){
  browseAll[side] = on;
  $("browse" + side).hidden = !on;
  if (!on) $("browse" + side).value = "";
  syncPicker(side === "A" ? "teamA" : "teamB");
  renderCalc();
  if (on) $("browse" + side).focus();
}
["A","B"].forEach(side => $("browse" + side).addEventListener("input", () => renderCalc()));
function browseClick(side, e){
  const b = e.target.closest(".asset"); if (!b) return;
  const a = S.assets.get(b.dataset.id); if (!a) return;
  const sel = $(side === "A" ? "teamA" : "teamB"), set = side === "A" ? S.sendIds : S.getIds;
  if (Number(sel.value) !== a.owner){ sel.value = a.owner; set.clear(); }
  const wasIn = set.has(a.id);
  wasIn ? set.delete(a.id) : set.add(a.id);
  renderCalc(); addedNote(set, a.id, wasIn);
}


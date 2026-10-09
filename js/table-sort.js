// Front Office: click-to-sort for the simpler tables
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// TABLE SORTING
// Tables that are drawn once and don't have their own sorting (Power Rankings, Trophy Room, the
// Season Simulator's projected standings, draft picks on My Roster, the waiver lists) get sortable
// column headings here: click a heading to sort by it, click again to flip. The table remembers the
// sort when it's redrawn. Numbers sort as numbers (1,234 · 64% · <1% · 3rd · 4-0 records), "–" goes last.
// ============================================================
const SORT_TABLES = ["#powerTable", "#hsTable", "#hsLeaders", ".sim-table", ".ros-picks", "#luWaivers .lu-table"];
const tableSortState = new Map();   // table key -> { col, dir }
function cellSortValue(td){
  const t = (td?.innerText || "").trim();
  if (!t || t === "–" || t === "-") return null;
  const rec = t.match(/^(\d+)[-–](\d+)(?:[-–](\d+))?$/);                       // a record: 4-0 or 3-1-1
  if (rec){ const w = +rec[1], l = +rec[2], ti = +(rec[3] || 0); return (w + ti / 2) / Math.max(1, w + l + ti) + w / 1000; }
  const m = t.replace(/,/g, "").match(/^([<>]?)\s*([+−-]?\d+(?:\.\d+)?)/);
  if (m){ let v = Number(m[2].replace("−", "-")); if (m[1] === "<") v -= 0.5; if (m[1] === ">") v += 0.5; return v; }
  return t.toLowerCase();
}
function tableKey(table){ return SORT_TABLES.find(sel => table.matches(sel)) || ""; }
function applyTableSort(table){
  const st = tableSortState.get(tableKey(table)), body = table.tBodies[0];
  const heads = [...(table.tHead?.rows[0]?.cells || [])];
  heads.forEach((th, i) => { th.classList.add("sortable"); th.setAttribute("aria-sort", st && st.col === i ? (st.dir > 0 ? "ascending" : "descending") : "none"); });
  if (!st || !body) return;
  const rows = [...body.rows].filter(r => r.cells.length > st.col && !r.querySelector("td[colspan]"));
  rows.map((r, i) => ({ r, i, v: cellSortValue(r.cells[st.col]) }))
    .sort((a, b) => a.v == null && b.v == null ? a.i - b.i : a.v == null ? 1 : b.v == null ? -1
      : (typeof a.v === "string" || typeof b.v === "string" ? String(a.v).localeCompare(String(b.v)) : a.v - b.v) * st.dir || a.i - b.i)
    .forEach(x => body.appendChild(x.r));
}
document.addEventListener("click", e => {
  const th = e.target.closest("th"); if (!th || e.target.closest(".info-btn, button, a, input, select")) return;
  const table = th.closest("table"); if (!table || !tableKey(table) || th.closest("tbody")) return;
  const col = [...th.parentElement.cells].indexOf(th), key = tableKey(table), cur = tableSortState.get(key);
  // numbers start high-to-low; names and the rank column start A-Z / 1 first
  const first = col === 0 || /team|player|manager|high scorer|^pick|standing|rank|week|status/i.test(th.innerText.trim()) ? 1 : -1;
  tableSortState.set(key, cur && cur.col === col ? { col, dir: -cur.dir } : { col, dir: first });
  applyTableSort(table);
});
// re-apply after a table is redrawn (and add the sort arrows to new ones)
(() => {
  const obs = new MutationObserver(muts => {
    const seen = new Set();
    for (const m of muts){
      const t = m.target instanceof Element ? m.target.closest("table") || m.target : null;
      if (t?.matches?.("table") && tableKey(t)) seen.add(t);
      if (t?.querySelectorAll) for (const x of t.querySelectorAll("table")) if (tableKey(x)) seen.add(x);
    }
    if (!seen.size) return;
    obs.disconnect();
    for (const t of seen) applyTableSort(t);
    obs.observe(document.getElementById("appView") || document.body, { childList: true, subtree: true });
  });
  obs.observe(document.getElementById("appView") || document.body, { childList: true, subtree: true });
})();

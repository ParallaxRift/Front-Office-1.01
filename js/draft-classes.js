// Front Office: draft class strength
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// DRAFT CLASS STRENGTH  (edit the ratings below; nothing else needs to change)
// Each rookie draft year is rated "strong", "average" or "weak". A strong class raises that year's
// picks and a weak one lowers them, most at the top of the draft, since a class's reputation is
// usually about its best few prospects:
//   1.01 ±12%, sliding down to 1.12 ±4%, every 2nd-round pick ±2%, later rounds unchanged.
// Years not listed count as "average". Update these a few times a year (after the college season,
// after the NFL Combine, and before the draft).
// ============================================================
const DRAFT_CLASSES = {
  2027: "strong",    // widely rated one of the best classes in years, led by a few elite prospects
  2028: "average",
  2029: "average"
};
const CLASS_SIGN = { strong: 1, average: 0, weak: -1 };
// p12 = the pick's slot on a 12-team scale (1 = 1.01, 13 = 2.01)
function classFactor(season, p12){
  const k = CLASS_SIGN[DRAFT_CLASSES[season]] || 0; if (!k) return 1;
  const pct = p12 <= 12 ? 0.12 - 0.08 * (Math.max(1, p12) - 1) / 11 : p12 <= 24 ? 0.02 : 0;
  return 1 + k * pct;
}
const classLabel = season => ({ strong: "Strong class", weak: "Weak class" })[DRAFT_CLASSES[season]] || "";

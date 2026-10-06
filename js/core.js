// Front Office: Settings and shared state
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// SETTINGS YOU CAN TWEAK
// ============================================================
const API = "https://api.sleeper.app/v1";
const MARKET_CSV = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-players.csv";
const STUD_EXPONENT = 1.3;   // higher = one great player beats several good ones by more
const FAIR_BAND = 0.05;      // within 5% counts as fair (matters for big trades)
const FAIR_POINTS = 1500;    // a gap of 1,500 or less always counts as fair
const LOPSIDED_BAND = 0.15;  // one side getting 15%+ more is called out as lopsided
// How a trade grades: "fair", "edge" (one side ahead, but a normal negotiation), or "lopsided"
// (one side is giving up too much: unlikely to be accepted, and a candidate for a league veto)
function tradeCall(gap, bigger){
  const a = Math.abs(gap), pct = a / Math.max(1, bigger);
  if (a <= FAIR_POINTS || pct <= FAIR_BAND) return "fair";
  return pct > LOPSIDED_BAND ? "lopsided" : "edge";
}

// ============================================================
// STATE
// ============================================================
const S = {
  faab: { send: 0, get: 0 },   // FAAB dollars in the trade being built
  user: null, season: null, leagues: [], sleeperPlayers: null, market: null,
  league: null, rosters: [], users: [], traded: [], cfg: null,
  assets: new Map(), teams: new Map(), myRid: null,
  sendIds: new Set(), getIds: new Set(), posFilter: "ALL"
};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = n => Math.round(n).toLocaleString();
function setStatus(msg, isError){ const el=$("status"); el.textContent=msg||""; el.classList.toggle("error", !!isError); }
async function getJSON(path){
  const r = await fetch(API + path);
  if (!r.ok) throw new Error("Sleeper returned " + r.status);
  return r.json();
}


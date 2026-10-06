// Front Office: Settings and shared state
// Part of the site; loaded in order by index.html. All files share one global scope.
// ============================================================
// SETTINGS YOU CAN TWEAK
// ============================================================
const API = "https://api.sleeper.app/v1";
const MARKET_CSV = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-players.csv";
const STUD_EXPONENT = 1.3;   // higher = one great player beats several good ones by more
const FAIR_BAND = 0.05;      // within 5% counts as fair

// ============================================================
// STATE
// ============================================================
const S = {
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


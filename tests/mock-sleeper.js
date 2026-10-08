// A fake 12-team Sleeper league so the site can be tested without touching Sleeper.
// Real player names and positions (from fixtures/players.json); rosters, records, scores and trades are made up.
const fs = require('fs');
const players = JSON.parse(fs.readFileSync(__dirname + '/fixtures/players.json'));
const ids = Object.keys(players);
const rosterOf = r => ids.filter((x, i) => i % 12 === r - 1);
const rosters = [];
for (let r = 1; r <= 12; r++) rosters.push({ settings: { wins: (r * 7) % 5, losses: 4 - ((r * 7) % 5), fpts: 400 + r * 13, waiver_budget_used: r * 4 }, roster_id: r, owner_id: 'u' + r, players: rosterOf(r) });
const users = rosters.map(r => ({ user_id: r.owner_id, display_name: 'Manager' + r.roster_id, metadata: { team_name: r.roster_id === 3 ? "Test Team" : '' } }));
const league = { league_id: 'L1', name: 'Test Dynasty', season: '2026', status: 'in_season', total_rosters: 12,
  roster_positions: ['QB','RB','RB','WR','WR','WR','TE','FLEX','FLEX','SUPER_FLEX','BN','BN'], scoring_settings: { rec: 1 }, settings: { type: 2, draft_rounds: 4, playoff_teams: 6, playoff_week_start: 15, waiver_budget: 100 } };

// Weeks 1-4 are played; each week everyone faces a rotating opponent
function matchups(w){
  const order = Array.from({ length: 12 }, (_, i) => i + 1), k = (w - 1) % 11;
  const rot = [order[0], ...order.slice(1).slice(-k || 11), ...order.slice(1).slice(0, k ? 11 - k : 0)].slice(0, 12);
  const ms = [];
  for (let i = 0; i < 6; i++) for (const rid of [rot[i], rot[11 - i]]){
    const pp = {}; let tot = 0;
    rosterOf(rid).forEach((pid, j) => { const p = w <= 4 ? Math.max(0, 18 - j * 1.2 + (rid % 5) + ((w * j) % 5)) : 0; pp[pid] = p; if (j < 9) tot += p; });
    ms.push({ roster_id: rid, matchup_id: i + 1, points: Math.round(tot * 10) / 10, players_points: pp });
  }
  return ms;
}
// Five two-team trades in each of weeks 1-4: 20 trades, enough to switch league tuning on (15+)
function transactions(w){
  if (w > 4) return [];
  return Array.from({ length: 5 }, (_, i) => { const a = 1 + i, c = 7 + i, x = ids[(w * 5 + i) % 30], y = ids[30 + (w * 5 + i) % 60];
    return { type: 'trade', status: 'complete', transaction_id: `${w}-${i}`, created: Date.now() - (w * 30 + i) * 864e5, roster_ids: [a, c], adds: { [x]: a, [y]: c }, drops: { [x]: c, [y]: a }, draft_picks: [] }; });
}

const skill = Object.entries(players).filter(([, p]) => ['QB', 'RB', 'WR', 'TE'].includes(p.position) && p.team)
  .sort(([, a], [, b]) => (a.search_rank || 1e9) - (b.search_rank || 1e9)).map(([id, p]) => ({ id, name: p.full_name || `${p.first_name} ${p.last_name}`, pos: p.position }));
const sfList = skill.slice(0, 400);
const oneList = [...sfList.filter(p => p.pos !== 'QB').slice(0, 30), ...sfList.filter(p => p.pos === 'QB').slice(0, 10), ...sfList.filter(p => p.pos !== 'QB').slice(30), ...sfList.filter(p => p.pos === 'QB').slice(10)].slice(0, 400);
const rankings = { updated: new Date().toISOString(), lists: { sf: sfList, '1qb': oneList } };

async function setup(page, { withHistory = true } = {}){
  await page.route('**/*', route => {
    const u = route.request().url();
    const j = d => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d), headers: { 'access-control-allow-origin': '*' } });
    // The test league uses made-up player IDs, so it must not pick up the real saved player list
    if (u.includes('/data/sleeper-players.json')) return route.fulfill({ status: 404, body: '' });
    if (u.startsWith('http://localhost:')) return route.continue();
    // Front Office Rankings from the Rankings Desk: the fixture players in Sleeper's order (1QB list puts QBs lower)
    if (u.includes('rankings.json')) return j(rankings);
    if (u.includes('/user/tester')) return j({ user_id: 'u3', display_name: 'Tester' });
    if (u.includes('/state/nfl')) return j({ season: '2026', league_season: '2026', season_type: 'regular', week: 5, display_week: 5 });
    if (u.includes('/leagues/nfl/')) return j([league]);
    if (u.endsWith('/league/L1')) return j(league);
    if (u.endsWith('/rosters')) return j(rosters);
    if (u.endsWith('/users')) return j(users);
    if (u.endsWith('/traded_picks')) return j([]);
    if (u.endsWith('/players/nfl')) return j(players);
    if (u.includes('/matchups/')) return j(withHistory ? matchups(Number(u.split('/').pop())) : []);
    if (u.includes('/transactions/')) return j(withHistory ? transactions(Number(u.split('/').pop())) : []);
    if (u.includes('/drafts') || u.includes('bracket')) return j([]);
    if (u.includes('docs.google.com')) return route.fulfill({ status: 200, body: 'Timestamp,Name,Message\n' });
    return route.abort();   // photos, ESPN, fonts: not needed for tests
  });
}
module.exports = { setup };

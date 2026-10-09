// Front Office automated checks. Run from this folder with:  npm install && npx playwright install chromium && npm test
// Starts a small local web server for the site (the folder above this one), opens a fake Sleeper league,
// and checks every tab and the core math. Exits with an error if anything fails, so GitHub marks the run red.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { setup } = require('./mock-sleeper.js');
const ROOT = path.resolve(__dirname, '..'), PORT = 8799;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.csv': 'text/csv', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!ok) failures++; };

async function openLeague(browser, viewport, opts){
  const page = await browser.newPage({ serviceWorkers: 'block', viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  page.errors = []; page.missing = [];
  page.on('pageerror', e => page.errors.push(e.message));
  const OPTIONAL = ['data/my-rankings.json', 'data/value-history.json'];
  page.on('response', r => { const u = r.url(); if (u.startsWith(`http://localhost:${PORT}`) && r.status() >= 400 && !OPTIONAL.some(o => u.includes(o))) page.missing.push(u); });
  await setup(page, opts);
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.fill('#username', 'tester'); await page.click('#loadUser');
  await page.waitForSelector('.lg'); await page.click('.lg');
  await page.waitForFunction(() => document.body.classList.contains('has-league'));
  await page.waitForFunction(() => window.S && S.history, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return page;
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  try {
    // 1) Every tab opens without errors, in both modes, on desktop and phone
    for (const vp of [{ name: 'desktop', width: 1300, height: 900 }, { name: 'phone', width: 390, height: 844 }]){
      const page = await openLeague(browser, vp);
      const info = await page.evaluate(() => ({ src: S.market?.kind, players: [...S.assets.values()].filter(a => a.kind === 'player').length, picks: [...S.assets.values()].filter(a => a.kind === 'pick').length }));
      check(`${vp.name}: values loaded`, info.players > 100 && info.picks > 0, `${info.src}, ${info.players} players, ${info.picks} picks`);
      for (const mode of ['basics', 'freakshow']){
        await page.evaluate(m => applyMode(m, true), mode); await page.waitForTimeout(150);
        // every tab this mode offers, opened the way a visitor would: section first, then the tab (Team Statuses is in the footer)
        const tabs = await page.$$eval('#tabs [data-tab]', x => x.filter(e => !e.hidden).map(e => e.dataset.tab));
        const bad = [];
        for (const t of tabs){
          const before = page.errors.length;
          const group = await page.evaluate(t => navGroupOf(t).id, t);
          {
            if (vp.width < 500){ // phones navigate with the bottom tab bar; Live Scores and Team Statuses live in the More sheet
              const bar = { trade: 'trade', values: 'values', team: 'team', league: 'league', scores: 'scores' }[group];
              if (bar) await page.tap(`#tabbar [data-go="${bar}"]`).catch(() => bad.push(`${t} tab bar button missing`));
              else { await page.tap('#tabbar [data-go="more"]'); await page.waitForTimeout(250); await page.tap(`#moreSheet [data-more="${t}"]`).catch(() => bad.push(`${t} More item missing`)); await page.waitForTimeout(250); }
            } else if (group === "statusGrp") await page.click('#footStatuses').catch(() => bad.push(`${t} footer link missing`));   // these open from the footer
            else await page.click(`#groups [data-group="${group}"]`).catch(() => bad.push(`${t} section button missing`));
            if (await page.$eval(`[data-tab="${t}"]`, e => e.offsetParent !== null)) await page.click(`[data-tab="${t}"]`);
          }
          await page.waitForTimeout(250);
          const shown = await page.$eval(`#panel-${t}`, e => e.offsetParent !== null).catch(() => false);
          const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
          if (!shown || page.errors.length > before || sideways) bad.push(`${t}${!shown ? ' not shown' : ''}${page.errors.length > before ? ' error' : ''}${sideways ? ' sideways scroll' : ''}`);
        }
        check(`${vp.name} ${mode}: all ${tabs.length} tabs open cleanly`, !bad.length, bad.join(', '));
      }
      const shell = await page.evaluate(() => ({ bar: getComputedStyle(document.getElementById('tabbar')).display !== 'none', head: getComputedStyle(document.getElementById('appbar')).display !== 'none' }));
      if (vp.width < 500) check('phone: app tab bar shown, desktop header hidden', shell.bar && !shell.head, JSON.stringify(shell));
      else check('desktop: unchanged header, no phone tab bar or app guide', !shell.bar && shell.head && await page.evaluate(() => getComputedStyle(document.querySelector('.home-app')).display === 'none'), JSON.stringify(shell));
      if (vp.width < 500){
        await page.tap('#tabbar [data-go=trade]'); await page.waitForTimeout(200);
        // Calculator (KeepTradeCut-style): two stacked team boxes with their own search, the result right below
        await page.tap('#ktQA'); await page.waitForTimeout(200); await page.tap('#ktDropA .kt-opt[data-id] >> nth=0'); await page.waitForTimeout(200);
        await page.tap('#ktQB'); await page.fill('#ktQB', 'a'); await page.waitForTimeout(150); await page.tap('#ktDropB .kt-opt[data-id] >> nth=1'); await page.waitForTimeout(250);
        const kt = await page.evaluate(() => { const top = id => document.querySelector(id).getBoundingClientRect().top;
          return { n: S.sendIds.size + S.getIds.size, closed: document.getElementById('ktDropB').hidden, resultBelowTeams: top('#verdict') > top('#getItems'), total: document.getElementById('ktTotB').textContent, opened: document.querySelector('#tabs .tab[aria-selected=true]').dataset.tab }; });
        check('phone: KeepTradeCut-style calculator adds from each team box, result below', kt.n === 2 && kt.closed && kt.resultBelowTeams && /Total [1-9]/.test(kt.total), JSON.stringify(kt));
        await page.evaluate(() => { S.sendIds.clear(); S.getIds.clear(); renderCalc(); });
        // Trade Finder: search to pick who to trade away; 3 ideas shown with more behind a button; 3 recommended players
        await page.evaluate(() => navTab('finder').click()); await page.waitForTimeout(300);
        await page.tap('#tfpQ'); await page.waitForTimeout(200); await page.tap('#tfpDrop .kt-opt >> nth=1'); await page.waitForTimeout(600);
        const tf = await page.evaluate(() => { const arts = [...document.querySelectorAll('#tfResults > article')];
          return { ideas: arts.length, shown: arts.filter(a => a.offsetParent).length, more: document.getElementById('tfResMore').textContent, recs: document.querySelectorAll('#tfRecs .tf-rec').length, picked: !!document.querySelector('#tfpPicked .tf-chip'), strayTab: document.querySelector('[data-tab=settings]').offsetParent !== null }; });
        check('phone: Trade Finder search picker, 3 ideas then more, 3 targets', tf.ideas > 3 && tf.shown === 3 && /Show \d+ more/.test(tf.more) && tf.recs === 3 && tf.picked && !tf.strayTab, JSON.stringify(tf));
        await page.evaluate(() => { tfSend.clear(); renderFinder(); });
        await page.tap('#tabbar [data-go=more]'); await page.waitForTimeout(300); await page.tap('#moreSheet [data-more=getapp]'); await page.waitForTimeout(500);
        const guide = await page.evaluate(() => { const g = document.getElementById('appGuide'); return !g.hidden && g.querySelectorAll('.ag-steps:not([hidden]) li').length === 4 && g.querySelectorAll('.agd-phone:not([hidden]) .agd-f.on').length === 1; });
        await page.tap('#appGuide .ag-done'); await page.waitForTimeout(300);
        check('phone: Get the app guide opens from More with steps and a walkthrough', guide, String(guide));
      }
      check(`${vp.name}: no script errors`, !page.errors.length, page.errors.slice(0, 3).join(' | '));
      const missing = page.missing.filter(u => !u.includes('data/sleeper-players.json'));   // optional: the site asks Sleeper when it's not there yet
      check(`${vp.name}: no missing site files`, !missing.length, missing.slice(0, 3).join(', '));
      await page.close();
    }

    // Home page preview before any username
    { const hp = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1300, height: 900 } }); await setup(hp, { withHistory: false });
      await hp.goto(`http://localhost:${PORT}/index.html`); await hp.waitForTimeout(800);
      const n = await hp.$$eval('#homeTop li', x => x.length), v = await hp.textContent('.ht-verdict').catch(() => '');
      check('home page shows a sample trade and top values', n === 10 && v.length > 0, `${n} values, "${v}"`); await hp.close(); }

    // 2) Core math on desktop
    const page = await openLeague(browser, { width: 1300, height: 900 });
    await page.evaluate(() => applyMode('freakshow', true));
    const mono = await page.evaluate(() => { const vals = [...S.assets.values()].map(a => a.value).filter(v => v > 0); let bad = 0;
      for (let n = 0; n < 20000; n++){ const pick = () => vals[Math.floor(Math.random() * vals.length)];
        const A = Array.from({ length: 1 + Math.floor(Math.random() * 5) }, pick), B = Array.from({ length: 1 + Math.floor(Math.random() * 5) }, pick);
        if (tradeValue(A.concat([pick()]), B) < tradeValue(A, B) - 1e-6) bad++; } return bad; });
    check('adding a piece never lowers a side (20,000 random trades)', mono === 0, `${mono} violations`);
    const top = await page.evaluate(() => Math.max(...[...S.assets.values()].map(a => a.value)));
    check('top value is on the 10,000 scale', top > 9000 && top < 10600, Math.round(top));
    const tuning = await page.evaluate(() => S.nudge && { n: S.nudge.n, w: S.nudge.weight, ok: ['QB','RB','WR','TE','PICK'].every(k => S.nudge[k] >= 0.925 && S.nudge[k] <= 1.075) });
    check('league tuning learns from trades within ±7.5%', tuning && tuning.ok && tuning.w > 0 && tuning.w < 0.75, tuning ? `${tuning.n} trades, weight ${Math.round(tuning.w * 100)}%` : 'not active');
    const age = await page.evaluate(() => S.ageStrength);
    check('age strength stays between none and double', age >= 0 && age <= 2, String(age));
    const picks = await page.evaluate(() => !!S.pickOdds && [...S.assets.values()].some(a => a.kind === 'pick' && /simulated: likely/.test(a.nfl || '')));
    check('next year\'s picks use simulated draft odds', picks);

    // 3) Calculator builds a trade and grades it
    await page.click('#groups [data-group=trade]'); await page.click('[data-tab=calc]');
    await page.click('#listA .asset .nm >> nth=0'); await page.click('#listB .asset .nm >> nth=1'); await page.click('#listB .asset .nm >> nth=3'); await page.waitForTimeout(300);
    const verdict = (await page.textContent('#verdict')).trim();
    check('calculator grades a trade', /win|fair|overpay|one-sided/i.test(verdict), verdict);
    // fairness rules: a gap of 600 or less (or within 5% on big trades) is fair; one side getting 15%+ more is lopsided
    const rules = await page.evaluate(() => [tradeCall(600, 6000), tradeCall(-700, 9000), tradeCall(1600, 9000), tradeCall(2000, 20000), tradeCall(-1600, 40000)].join(','));
    check('fair buffer of 600 and lopsided call-out', rules === 'fair,edge,lopsided,edge,fair', rules);

    // 4) Season simulator: title odds add to ~100%, playoff odds to ~(playoff teams x 100%)
    await page.click('#groups [data-group=league]'); await page.click('[data-tab=sim]'); await page.click('#simBtn'); await page.waitForSelector('.sim-champ', { timeout: 30000 });
    const sums = await page.$$eval('.sim-table tbody tr', rows => { const v = t => t.includes('>99') ? 100 : t.includes('<1') ? 0.3 : parseFloat(t) || 0;
      return rows.reduce((s, r) => ({ title: s.title + v(r.cells[7].textContent), po: s.po + v(r.cells[5].textContent) }), { title: 0, po: 0 }); });
    check('simulator title odds add to about 100%', Math.abs(sums.title - 100) <= 4, Math.round(sums.title) + '%');
    check('simulator playoff odds add to about 600%', Math.abs(sums.po - 600) <= 8, Math.round(sums.po) + '%');
    // re-simulating plays out a new season: the This sim records, champion or playoff games should change across a few clicks
    const sample = () => page.$eval('#simOut', o => [...o.querySelectorAll('.sim-table tbody tr')].map(r => r.cells[4].textContent).join(',') + '|' + o.querySelector('.sim-champ b').textContent + '|' + [...o.querySelectorAll('.sim-game em')].map(e => e.textContent).join(','));
    const seen = new Set([await sample()]);
    for (let i = 0; i < 3; i++){ await page.click('#simBtn'); await page.waitForFunction(() => !document.getElementById('simBtn').disabled); seen.add(await sample()); }
    check('simulator: Simulate Again plays out a different season', seen.size > 1, seen.size + ' different results in 4 runs');

    // Sleeper's player list comes from the daily saved copy when it's fresh, and from Sleeper when it's missing or stale
    const src = await page.evaluate(async () => {
      const realFetch = window.fetch, big = {}; for (let i = 0; i < 1600; i++) big['x' + i] = { position: 'WR' };
      const fake = body => async url => String(url).includes('data/sleeper-players.json') ? new Response(JSON.stringify(body), { status: 200 }) : realFetch(url);
      const out = [];
      window.fetch = fake({ updated: new Date().toISOString(), players: big }); const a = await loadSleeperPlayers(); out.push(S.sleeperPlayersSource + ':' + Object.keys(a).length);
      window.fetch = fake({ updated: '2020-01-01T00:00:00Z', players: big }); const b = await loadSleeperPlayers(); out.push(S.sleeperPlayersSource + ':' + Object.keys(b).length);
      window.fetch = realFetch; return out.join(',');
    });
    check('player list: saved copy when fresh, Sleeper when stale', /^copy:1600,sleeper:\d+$/.test(src) && !src.endsWith(':1600'), src);


    // Depth-chart floor: an unranked starting QB gets a real value; a 3rd-stringer doesn't; experts' ranks are never overridden
    const floor = await page.evaluate(() => {
      const keep = { ...S.sleeperPlayers };
      Object.assign(S.sleeperPlayers, { zz1: { player_id: 'zz1', full_name: 'Test Starter', position: 'QB', team: 'BAL', depth_chart_position: 'QB', depth_chart_order: 1, age: 28 },
        zz3: { player_id: 'zz3', full_name: 'Test Third', position: 'WR', team: 'CLE', depth_chart_position: 'SWR', depth_chart_order: 3, age: 26 } });
      const ranked = [...S.assets.values()].find(a => a.kind === 'player' && a.mRank != null); const before = ranked.value;
      buildValues();
      const qb = S.assets.get('p:zz1'), wr = S.assets.get('p:zz3'), same = Math.abs(S.assets.get(ranked.id).value - before) < 1;
      delete S.sleeperPlayers.zz1; delete S.sleeperPlayers.zz3; buildValues();
      return [qb && qb.value > 500 && qb.depthFloor, !wr, same].join(',');
    });
    check('depth-chart floor for unranked starters', floor === 'true,true,true', floor);

    // Starter lift: a cheap RB who takes over as his team's RB1 is lifted halfway to 2,000; off again when he isn't the starter
    const lift = await page.evaluate(() => {
      const rb = [...S.assets.values()].filter(a => a.kind === 'player' && a.pos === 'RB' && a.value > 300 && a.value < 1500 && a.depthOrder !== 1)[0];
      if (!rb) return 'no cheap RB';
      const sp = S.sleeperPlayers[rb.pid], keep = [sp.depth_chart_position, sp.depth_chart_order, sp.injury_status], before = rb.value;
      Object.assign(sp, { depth_chart_position: 'RB', depth_chart_order: 1, injury_status: null }); buildValues();
      const on = S.assets.get(rb.id), mid = on.value, expect = before + (2000 - before) / 2;
      [sp.depth_chart_position, sp.depth_chart_order, sp.injury_status] = keep; buildValues();
      const off = S.assets.get(rb.id).value;
      return [Math.abs(mid - expect) < expect * 0.06, /lifted/.test(roleText(on)), Math.abs(off - before) < 1, Math.round(before) + '->' + Math.round(mid)].join(',');
    });
    check('starter lift for cheap starting QBs and RBs', /^true,true,true,/.test(lift), lift);

    // Player card: depth chart spot (WR1/WR2/WR3 across left, right and slot) and the news list
    const card = await page.evaluate(() => {
      const keep = JSON.stringify(S.sleeperPlayers);
      const P = S.sleeperPlayers, put = (id, pos, dpos, ord) => P[id] = { ...(P[id] || {}), team: 'ZZZ', position: pos, depth_chart_position: dpos, depth_chart_order: ord };
      put('t1', 'WR', 'LWR', 1); put('t2', 'WR', 'RWR', 1); put('t3', 'WR', 'SWR', 1); put('t4', 'WR', 'LWR', 2); put('t5', 'RB', 'RB', 1); put('t6', 'RB', 'KR', 1);
      const d = ['t1','t2','t3','t4','t5','t6'].map(depthChartText).join('|');
      S.sleeperPlayers = JSON.parse(keep);
      const est = returnEstimate({ injury_status: 'Questionable' }, [['2026-10-07', 'Out for the season with a torn ACL', '', '', '']]);
      return [d, !est || est.lo < 99].join(';');
    });
    check('player card depth chart', card === 'WR1 · outside|WR2 · outside|WR3 · slot|WR4 · outside|RB1|Not on the depth chart;true', card);

    // Values come from Front Office Rankings: the list's #1 is the top player, and nothing from FantasyPros is loaded
    const fo = await page.evaluate(() => {
      const first = S.market.map && [...S.market.map.entries()].find(([, m]) => (S.cfg.superflex ? m.r2 : m.r1) === 1);
      const top = [...S.assets.values()].filter(a => a.kind === 'player').sort((x, y) => y.base - x.base)[0];
      const fpRequests = performance.getEntriesByType('resource').filter(r => /fantasypros|values\.json|dynastyprocess/i.test(r.name)).length;
      return [S.market.kind, !!first && first[0].startsWith(normName(top.name)), fpRequests].join(',');
    });
    check('values come from Front Office Rankings only', fo === 'fo,true,0', fo);

    // Publishing on the Desk reaches an open page: a changed rankings file rebuilds values in place
    const live = await page.evaluate(async () => {
      const d = await getRankingsFile(), fmt = S.cfg.superflex ? 'sf' : '1qb';
      const lists = JSON.parse(JSON.stringify(d.lists)); const [a, b] = lists[fmt]; lists[fmt][0] = b; lists[fmt][1] = a;
      const real = window.fetch;
      window.fetch = (u, o) => String(u).includes('rankings.json') ? Promise.resolve(new Response(JSON.stringify({ ...d, updated: new Date(Date.now() + 1000).toISOString(), lists }))) : real(u, o);
      const top = () => [...S.assets.values()].filter(x => x.kind === 'player').sort((x, y) => y.base - x.base)[0].name;
      const before = top(); await checkRankingsUpdate(); const after = top();
      // put the original rankings back so later checks see the normal values
      window.fetch = (u, o) => String(u).includes('rankings.json') ? Promise.resolve(new Response(JSON.stringify({ ...d, updated: new Date(Date.now() + 2000).toISOString() }))) : real(u, o);
      await checkRankingsUpdate();
      window.fetch = real;
      return [before !== after, normName(after) === normName(b.name)].join(',');
    });
    check('a new publish updates open pages', live === 'true,true', live);

    // Trending tag, usage table and depth-chart move text
    const sig = await page.evaluate(() => {
      const a = [...S.assets.values()].find(x => x.kind === 'player');
      S.trending = new Map([[String(a.pid), 1234]]);
      const tag = trendTag(a.pid), use = usageBlock([0.62, 0.50, 0.31, 0.22, 14.2, 3]);
      cardData = cardData || { players: {} }; cardData.players = cardData.players || {};
      const keep = cardData.players[a.pid]; cardData.players[a.pid] = { ...(keep || { s: [] }), dm: 'RB9' };
      const now = depthChartText(a.pid), mv = depthMoveText(a.pid);
      if (keep) cardData.players[a.pid] = keep; else delete cardData.players[a.pid];
      S.trending = new Map();
      return [/▲1\.2k/.test(tag), /▲ 12/.test(use) && /▲ 9/.test(use), !now.match(/\d/) || /from RB9 last week/.test(mv) || now.startsWith('RB9') || !/^RB/.test(now) ].join(',');
    });
    check('trending tag, usage table and depth moves', sig === 'true,true,true', sig);

    // Live Scores flips to the next week on Tuesday morning (6 a.m. Central), not Wednesday
    const flips = await page.evaluate(() => { const real = Date.now, st = { season_start_date: '2026-09-10' };
      const at = iso => { Date.now = () => new Date(iso).getTime(); const w = flipWeek(st); Date.now = real; return w; };
      return [at('2026-09-10T23:00:00Z'), at('2026-10-06T10:30:00Z'), at('2026-10-06T11:30:00Z'), at('2026-10-07T18:00:00Z')].join(','); });
    check('live scores: week flips Tuesday morning', flips === '1,4,5,5', flips + ' (want 1,4,5,5)');

    // 5) Explainer popups open
    await page.click('#groups [data-group=values]');
    let pops = 0; for (const k of ['col-league', 'col-market', 'col-change']){ await page.click(`.info-btn[data-info=${k}]`); await page.waitForTimeout(100); if (await page.$('.pop')) pops++; }
    check('column explainer popups open', pops === 3, `${pops} of 3`);
    // Player Values: 50 rows at a time, sortable
    const firstPage = await page.$$eval('#valuesBody tr', x => x.length);
    await page.click('#valuesMore'); const secondPage = await page.$$eval('#valuesBody tr', x => x.length);
    check('Player Values shows 50 rows, then 50 more', firstPage === 50 && secondPage === 100, `${firstPage} then ${secondPage}`);
    await page.click('th[data-sort=age]');
    const ages = await page.$$eval('#valuesBody tr', x => x.slice(0, 20).map(r => parseFloat(r.cells[4].textContent) || 0));
    check('sorting by a column works', ages.every((v, i) => !i || v <= ages[i - 1]), ages.slice(0, 3).join(', '));
    // Rookies filter shows exactly the marked player; My Players shows every player and pick on your team
    const flt = await page.evaluate(async () => {
      const ps = [...S.assets.values()].filter(a => a.kind === 'player' && a.owner != null).slice(5, 7), [r, i] = ps.map(a => S.sleeperPlayers[a.pid]);
      const keep = [r.years_exp]; r.years_exp = 0;
      const names = async f => { document.querySelector(`#posFilter [data-pos=${f}]`).click(); await new Promise(z => setTimeout(z, 50)); return [...document.querySelectorAll('#valuesBody tr')].map(t => t.textContent); };
      const rk = await names('ROOKIE'), mine = await names('MINE'), cnt = document.getElementById('valuesCount').textContent, want = [...S.assets.values()].filter(a => a.owner === S.myRid).length;
      r.years_exp = keep[0]; document.querySelector('#posFilter [data-pos=ALL]').click();
      return [rk.length === 1 && rk[0].includes(ps[0].name), S.myRid != null && want > 0 && mine.length === want && /total value/.test(cnt)].join(',');
    });
    check('Player Values: Rookies and My Players filters', flt === 'true,true', flt);
    // Trade Finder starts with suggestions
    await page.click('#groups [data-group=trade]'); await page.click('[data-tab=finder]'); await page.waitForTimeout(400);
    const sugg = await page.$$eval('#tfResults .tf-card', x => x.length), recs = await page.$$eval('#tfRecs .tf-rec', x => x.length);
    check('Trade Finder suggests trades before anything is picked', sugg > 0, `${sugg} suggestions, ${recs} recommendations`);
    // A player who's out for the season isn't pitched to a contender; one out a few weeks says when he's back
    const inj = await page.evaluate(() => {
      const me = S.myRid; renderRecs(me); const first = tfRecTop[0]?.a; if (!first) return 'no recs';
      const sp = S.sleeperPlayers[first.pid], keep = { ...sp };
      Object.assign(sp, { injury_status: 'IR', injury_notes: 'Placed on IR, out for the season', injury_body_part: 'Knee' });
      renderRecs(me); const gone = !tfRecTop.some(r => r.a.pid === first.pid);
      const done = seasonOutlook(first.pid)?.done;
      Object.assign(sp, { injury_status: 'Out', injury_notes: '', injury_body_part: 'Hamstring', injury_start_date: '' });
      const ol = seasonOutlook(first.pid);
      renderRecs(me); const r = tfRecTop.find(r => r.a.pid === first.pid);
      for (const k of Object.keys(sp)) delete sp[k]; Object.assign(sp, keep); renderRecs(me);
      return [gone, done, ol && !ol.done, !r || !/would start/i.test(r.why) || /once he's back/.test(r.why)].join(',');
    });
    check('Trade Finder: season-ending injuries left out for contenders', inj === 'true,true,true,true', inj);
    // Pick names follow one pattern
    const names = await page.evaluate(() => [...S.assets.values()].filter(a => a.kind === 'pick').map(a => a.name));
    check('pick names use one pattern (2027 1.08, 2028 Late 1st, 2029 1st)', names.every(n => /^\d{4} (\d\.\d{2}|(Early|Mid|Late) \d+(st|nd|rd|th)|\d+(st|nd|rd|th))$/.test(n)), names.find(n => !/^\d{4} (\d\.\d{2}|(Early|Mid|Late) \d+(st|nd|rd|th)|\d+(st|nd|rd|th))$/.test(n)) || '');
    // Team status counts playoff odds in season (4 weeks played in the test league)
    const st = await page.evaluate(() => ({ w: statusRecordWeight(), n: [...S.teams.values()].filter(t => t.status === 'contend').length, odds: !!S.playoffOdds }));
    check('team status blends in playoff odds after Week 3', st.odds && st.w > 0 && st.w <= 0.6 && st.n === 4, `record weight ${Math.round(st.w * 100)}%, ${st.n} contenders`);
    // No expert ranges or "too close to call" any more
    const rng = await page.evaluate(() => [...S.assets.values()].filter(a => a.lo != null).length);
    check('no value ranges (removed)', rng === 0, `${rng} players with ranges`);
    // Calculator shows the math under each total when there's a value adjustment
    await page.click('#groups [data-group=trade]'); await page.click('[data-tab=calc]');
    await page.evaluate(() => { const A = teamAssets(Number($("teamA").value)).filter(a => a.kind === 'player'), B = teamAssets(Number($("teamB").value)).filter(a => a.kind === 'player'); S.sendIds = new Set([A[0].id]); S.getIds = new Set([B[2].id, B[3].id, B[4].id]); renderCalc(); });
    const raw = (await page.textContent('#tradeMath')).replace(/\s+/g, ' ');
    check('calculator shows the trade math: players & picks, adjustment, total', /Players & picks.*Value adjustment.*Total/.test(raw), raw);
    // FAAB counts in the calculator
    await page.evaluate(() => { const A = teamAssets(Number($("teamA").value)).filter(a => a.kind === 'player'), B = teamAssets(Number($("teamB").value)).filter(a => a.kind === 'player'); S.sendIds = new Set([A[3].id]); S.getIds = new Set([B[2].id]); S.faab = { send: 0, get: 0 }; S.faabOn = { send: false, get: false }; renderCalc(); });
    const before = await page.evaluate(() => Number($("sendNum").textContent.replace(/,/g, '')));
    await page.click('#listA .faab-asset'); await page.waitForTimeout(150); await page.fill('#listA .faab-amt', '50'); await page.waitForTimeout(150);
    const after = await page.evaluate(() => Number($("sendNum").textContent.replace(/,/g, '')));
    check('FAAB adds value to a side', after > before, `${before} -> ${after}`);
    // Shared trade link reopens the same trade in a fresh browser
    const link = await page.evaluate(() => tradeLink()), want = await page.evaluate(() => [$("sendNum").textContent, $("getNum").textContent].join(' / '));
    const p2 = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1300, height: 900 } }); p2.errors = []; p2.on('pageerror', e => p2.errors.push(e.message));
    await setup(p2); await p2.goto(link); await p2.waitForFunction(() => document.body.classList.contains('has-league'), null, { timeout: 30000 }); await p2.waitForFunction(() => S.history, null, { timeout: 30000 }); await p2.waitForTimeout(1500);
    const got = await p2.evaluate(() => [$("sendNum").textContent, $("getNum").textContent].join(' / '));
    check('shared trade link reopens the same trade', got === want && !p2.errors.length, `${want} vs ${got}${p2.errors.length ? ' ' + p2.errors[0] : ''}`);
    await p2.close();
    // Trade image draws
    const img = await page.evaluate(() => { const c = drawTradeImage(); return `${c.width}x${c.height}`; });
    check('trade image draws', /^1200x\d+$/.test(img), img);
    // Manager habits are learned from trade history
    const habits = await page.evaluate(() => { const m = managerHabits(); return [...m.values()].filter(h => h.trades > 0).length; });
    check('manager trade habits are learned from history', habits > 0, `${habits} managers with trades`);
    // The value adjustment's depth settings fit to trades in the right direction
    const dir = await page.evaluate(() => { const ps = [...S.assets.values()].filter(a => a.kind === 'player').sort((x, y) => y.value - x.value);
      const fitFor = mult => { const trades = [];
        for (let i = 0; i < 40; i++){ const star = ps[i % 20], pool = ps.filter(a => a !== star && a.value < star.value * 0.8), target = star.value * mult / 2;
          const a = pool.reduce((b, c) => Math.abs(c.value - target) < Math.abs(b.value - target) ? c : b), rest = star.value * mult - a.value;
          const c2 = pool.filter(x => x !== a).reduce((b, c) => Math.abs(c.value - rest) < Math.abs(b.value - rest) ? c : b);
          trades.push({ created: Date.now() - i * 864e5, sides: [{ rid: 1, owner: 'x', gets: [{ kind: 'player', pid: star.pid, from: 2 }] }, { rid: 2, owner: 'y', gets: [{ kind: 'player', pid: a.pid, from: 1 }, { kind: 'player', pid: c2.pid, from: 1 }] }] }); }
        return fitDepth(trades).depth; };
      const lo = fitFor(1.05), hi = fitFor(1.45); return lo && hi && lo.floor > hi.floor ? 'ok' : JSON.stringify({ lo, hi }); });
    check('value adjustment fits to how a league prices depth vs. stars', dir === 'ok', dir);
    check('desktop: no script errors during checks', !page.errors.length, page.errors.slice(0, 3).join(' | '));
    await page.close();
  } catch (e){ check('test run finished', false, e.message.split('\n')[0]); }
  await browser.close(); server.close();
  console.log(results.join('\n'));
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();

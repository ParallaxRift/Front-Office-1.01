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
  const page = await browser.newPage({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  page.errors = []; page.missing = [];
  page.on('pageerror', e => page.errors.push(e.message));
  // data/build-notes.json is optional: it only exists after build notes are saved from the site
  const OPTIONAL = ['data/build-notes.json'];
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
        // every tab this mode offers, opened the way a visitor would: section first, then the tab (Feedback is in the footer)
        const tabs = await page.$$eval('#tabs [data-tab]', x => x.filter(e => !e.hidden).map(e => e.dataset.tab));
        const bad = [];
        for (const t of tabs){
          const before = page.errors.length;
          const group = await page.evaluate(t => navGroupOf(t).id, t);
          {
            if (vp.width < 500){ // phones navigate with the bottom tab bar; Live Scores and Feedback live in the More sheet
              const bar = { trade: 'trade', values: 'values', team: 'team', league: 'league' }[group];
              if (bar) await page.tap(`#tabbar [data-go="${bar}"]`).catch(() => bad.push(`${t} tab bar button missing`));
              else { await page.tap('#tabbar [data-go="more"]'); await page.waitForTimeout(250); await page.tap(`#moreSheet [data-more="${group === 'scores' ? 'scores' : 'feedback'}"]`).catch(() => bad.push(`${t} More item missing`)); await page.waitForTimeout(250); }
            } else await page.click(`#groups [data-group="${group}"]`).catch(() => bad.push(`${t} section button missing`));
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
      else check('desktop: unchanged header, no phone tab bar', !shell.bar && shell.head, JSON.stringify(shell));
      if (vp.width < 500){
        await page.tap('#tabbar [data-go=trade]'); await page.waitForTimeout(200);
        await page.tap('#listA .asset .nm >> nth=0'); await page.tap('#sideSwitch [data-side=B]'); await page.tap('#listB .asset .nm >> nth=2');
        await page.evaluate(() => window.scrollTo(0, 1600)); await page.waitForTimeout(400);
        const bar = await page.$eval('#miniBar', e => e.hidden ? '' : e.textContent);
        check('phone: trade summary bar stays pinned while scrolling', /Send.*Get/.test(bar), bar);
      }
      check(`${vp.name}: no script errors`, !page.errors.length, page.errors.slice(0, 3).join(' | '));
      check(`${vp.name}: no missing site files`, !page.missing.length, page.missing.slice(0, 3).join(', '));
      await page.close();
    }

    // Home page preview before any username
    { const hp = await browser.newPage({ viewport: { width: 1300, height: 900 } }); await setup(hp, { withHistory: false });
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
    // fairness rules: a gap of 1,500 or less is fair; one side getting 15%+ more is lopsided
    const rules = await page.evaluate(() => [tradeCall(1500, 6000), tradeCall(-1400, 9000), tradeCall(1600, 9000), tradeCall(2000, 20000), tradeCall(-1600, 40000)].join(','));
    check('fair buffer of 1,500 and lopsided call-out', rules === 'fair,fair,lopsided,edge,fair', rules);

    // 4) Season simulator: title odds add to ~100%, playoff odds to ~(playoff teams x 100%)
    await page.click('#groups [data-group=league]'); await page.click('[data-tab=standings]'); await page.click('#simBtn'); await page.waitForSelector('.sim-champ', { timeout: 30000 });
    const sums = await page.$$eval('.sim-table tbody tr', rows => { const v = t => t.includes('>99') ? 100 : t.includes('<1') ? 0.3 : parseFloat(t) || 0;
      return rows.reduce((s, r) => ({ title: s.title + v(r.cells[7].textContent), po: s.po + v(r.cells[4].textContent) }), { title: 0, po: 0 }); });
    check('simulator title odds add to about 100%', Math.abs(sums.title - 100) <= 4, Math.round(sums.title) + '%');
    check('simulator playoff odds add to about 600%', Math.abs(sums.po - 600) <= 8, Math.round(sums.po) + '%');

    // 5) Explainer popups open
    await page.click('#groups [data-group=values]');
    let pops = 0; for (const k of ['col-league', 'col-market', 'col-change']){ await page.click(`.info-btn[data-info=${k}]`); await page.waitForTimeout(100); if (await page.$('.pop')) pops++; }
    check('column explainer popups open', pops === 3, `${pops} of 3`);
    // Player Values: 50 rows at a time, sortable
    const firstPage = await page.$$eval('#valuesBody tr', x => x.length);
    await page.click('#valuesMore'); const secondPage = await page.$$eval('#valuesBody tr', x => x.length);
    check('Player Values shows 50 rows, then 50 more', firstPage === 50 && secondPage === 100, `${firstPage} then ${secondPage}`);
    await page.click('th[data-sort=age]');
    const ages = await page.$$eval('#valuesBody tr', x => x.slice(0, 20).map(r => parseFloat(r.cells[3].textContent) || 0));
    check('sorting by a column works', ages.every((v, i) => !i || v <= ages[i - 1]), ages.slice(0, 3).join(', '));
    // Trade Finder starts with suggestions
    await page.click('#groups [data-group=trade]'); await page.click('[data-tab=finder]'); await page.waitForTimeout(400);
    const sugg = await page.$$eval('#tfResults .tf-card', x => x.length), recs = await page.$$eval('#tfRecs .tf-rec', x => x.length);
    check('Trade Finder suggests trades before anything is picked', sugg > 0, `${sugg} suggestions, ${recs} recommendations`);
    // Pick names follow one pattern
    const names = await page.evaluate(() => [...S.assets.values()].filter(a => a.kind === 'pick').map(a => a.name));
    check('pick names use one pattern (2027 1.08, 2028 Late 1st, 2029 1st)', names.every(n => /^\d{4} (\d\.\d{2}|(Early|Mid|Late) \d+(st|nd|rd|th)|\d+(st|nd|rd|th))$/.test(n)), names.find(n => !/^\d{4} (\d\.\d{2}|(Early|Mid|Late) \d+(st|nd|rd|th)|\d+(st|nd|rd|th))$/.test(n)) || '');
    // Team status counts playoff odds in season (4 weeks played in the test league)
    const st = await page.evaluate(() => ({ w: statusRecordWeight(), n: [...S.teams.values()].filter(t => t.status === 'contend').length, odds: !!S.playoffOdds }));
    check('team status blends in playoff odds after Week 3', st.odds && st.w > 0 && st.w <= 0.6 && st.n === 4, `record weight ${Math.round(st.w * 100)}%, ${st.n} contenders`);
    // Value ranges from expert disagreement
    const rng = await page.evaluate(() => { const ps = [...S.assets.values()].filter(a => a.kind === 'player' && a.lo != null); return { n: ps.length, ok: ps.every(a => a.lo <= a.value + 1e-6 && a.hi >= a.value - 1e-6) }; });
    check('players have value ranges around their value', rng.n > 50 && rng.ok, `${rng.n} players with ranges`);
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
    const p2 = await browser.newPage({ viewport: { width: 1300, height: 900 } }); p2.errors = []; p2.on('pageerror', e => p2.errors.push(e.message));
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

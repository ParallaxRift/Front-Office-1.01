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
  await page.waitForSelector('#appbar:not([hidden])');
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
        const tabs = await page.$$eval('[data-tab]', x => [...new Set(x.filter(e => e.offsetParent !== null).map(e => e.dataset.tab))]);
        const bad = [];
        for (const t of tabs){
          const before = page.errors.length;
          await page.click(`[data-tab="${t}"]`).catch(() => {}); await page.waitForTimeout(250);
          const shown = await page.$eval(`#panel-${t}`, e => e.offsetParent !== null).catch(() => false);
          const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
          if (!shown || page.errors.length > before || sideways) bad.push(`${t}${!shown ? ' not shown' : ''}${page.errors.length > before ? ' error' : ''}${sideways ? ' sideways scroll' : ''}`);
        }
        check(`${vp.name} ${mode}: all ${tabs.length} tabs open cleanly`, !bad.length, bad.join(', '));
      }
      check(`${vp.name}: no script errors`, !page.errors.length, page.errors.slice(0, 3).join(' | '));
      check(`${vp.name}: no missing site files`, !page.missing.length, page.missing.slice(0, 3).join(', '));
      await page.close();
    }

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
    await page.click('[data-tab=calc]');
    await page.click('#listA .asset .nm >> nth=0'); await page.click('#listB .asset .nm >> nth=1'); await page.click('#listB .asset .nm >> nth=3'); await page.waitForTimeout(300);
    const verdict = (await page.textContent('#verdict')).trim();
    check('calculator grades a trade', /win|fair|lose|even/i.test(verdict), verdict);

    // 4) Season simulator: title odds add to ~100%, playoff odds to ~(playoff teams x 100%)
    await page.click('[data-tab=standings]'); await page.click('#simBtn'); await page.waitForSelector('.sim-champ', { timeout: 30000 });
    const sums = await page.$$eval('.sim-table tbody tr', rows => { const v = t => t.includes('>99') ? 100 : t.includes('<1') ? 0.3 : parseFloat(t) || 0;
      return rows.reduce((s, r) => ({ title: s.title + v(r.cells[7].textContent), po: s.po + v(r.cells[4].textContent) }), { title: 0, po: 0 }); });
    check('simulator title odds add to about 100%', Math.abs(sums.title - 100) <= 4, Math.round(sums.title) + '%');
    check('simulator playoff odds add to about 600%', Math.abs(sums.po - 600) <= 8, Math.round(sums.po) + '%');

    // 5) Explainer popups open
    await page.click('[data-tab=values]');
    let pops = 0; for (const k of ['col-league', 'col-market', 'col-change']){ await page.click(`.info-btn[data-info=${k}]`); await page.waitForTimeout(100); if (await page.$('.pop')) pops++; }
    check('column explainer popups open', pops === 3, `${pops} of 3`);
    check('desktop: no script errors during checks', !page.errors.length, page.errors.slice(0, 3).join(' | '));
    await page.close();
  } catch (e){ check('test run finished', false, e.message.split('\n')[0]); }
  await browser.close(); server.close();
  console.log(results.join('\n'));
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();

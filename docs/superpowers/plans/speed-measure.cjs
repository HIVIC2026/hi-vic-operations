const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  let inflight = 0, lastEnd = 0, js = 0;
  const isData = u => /_serverFn|\/rest\/v1|\/rpc\//.test(u);
  p.on('request', r => { if (isData(r.url())) inflight++; if (r.resourceType() === 'script') js++; });
  const done = r => { if (isData(r.url())) { inflight--; lastEnd = Date.now(); } };
  p.on('requestfinished', done); p.on('requestfailed', done);
  const quiet = async () => { const t = Date.now(); while (Date.now() - t < 60000) { await p.waitForTimeout(200); if (inflight <= 0 && Date.now() - lastEnd > 1500) return; } };
  let t = Date.now(); js = 0; await p.goto('https://portal.homeinsulationvictoria.com.au/auth', { waitUntil: 'networkidle', timeout: 90000 });
  console.log(`first open /auth: ${Date.now() - t}ms, ${js} code files`);
  await p.fill('#e', process.env.HIV_U); await p.fill('#p', process.env.HIV_P); await p.waitForTimeout(1500);
  t = Date.now(); lastEnd = t; await p.locator('button:has-text("Sign in")').click(); await p.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 90000 }); await quiet();
  console.log(`sign in → My work data: ${lastEnd - t}ms`);
  const job = await p.$$eval('a[href^="/field/"]', as => as.map(a => a.getAttribute('href')).find(h => /^\/field\/[0-9a-f-]{36}$/.test(h)));
  for (const href of ['/field/money', '/field/business', '/field', job]) {
    t = Date.now(); lastEnd = t; await p.locator(`a[href="${href}"]:visible`).first().click(); await quiet();
    console.log(`${href.replace(/[0-9a-f-]{36}/, ':job')}: data ${lastEnd - t}ms`);
  }
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

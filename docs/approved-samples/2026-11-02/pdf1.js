const { chromium } = require('playwright');
(async () => { const [,, src, out] = process.argv;
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + __dirname + '/' + src); await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: __dirname + '/' + out, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-family:sans-serif;font-size:7px;color:#5d6785;padding:0 40px;display:flex;justify-content:space-between"><span>Home Insulation Victoria · Accredited Person A003654 under the Victorian Energy Upgrades program</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>' });
  await b.close(); })();

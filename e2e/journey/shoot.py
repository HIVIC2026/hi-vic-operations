"""Browser half of the full-journey test. Reads the manifest written by scripts/journey.ts, opens every page
at 390px and 1280px as the right TEST person, saves screenshots and checks must-see / must-not-see text.
Sessions come from the manifest (TEST accounts only) and are written to localStorage on localhost only."""
import asyncio, json, re, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

PRICE = re.compile(r"\$\s?\d[\d,]*")

# Read rendered text outside the one explicitly marked record-value scope. The DOM is never changed.
TEXT_OUTSIDE_RECORDS = """(selector) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent || parent.closest(selector) || !parent.getClientRects().length) continue;
        const visibility = getComputedStyle(parent).visibility;
        if (visibility === 'hidden' || visibility === 'collapse') continue;
        parts.push(node.textContent);
    }
    return parts.join(' ');
}"""

async def main(manifest_path):
    m = json.loads(Path(manifest_path).read_text())
    out = Path(m["outDir"]); shots = out / "screens"; shots.mkdir(parents=True, exist_ok=True)
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        for i, s in enumerate(m["screens"]):
            for width, label in ((390, "phone"), (1280, "desktop")):
                if s.get('widths') and width not in s['widths']:
                    continue
                ctx = await browser.new_context(viewport={"width": width, "height": 844 if width == 390 else 1800})
                page = await ctx.new_page()
                page.set_default_timeout(10000)
                errors = []
                console_errors, failed_requests, http_errors, navigation_aborts = [], [], [], []
                page.on("pageerror", lambda e: errors.append(str(e)[:200]))
                page.on("console", lambda msg: console_errors.append(msg.text[:200]) if msg.type == 'error' else None)
                # Do not retain query strings, signed file URLs, credentials or response bodies.
                page.on("requestfailed", lambda req: (navigation_aborts if req.failure == 'net::ERR_ABORTED' else failed_requests).append({"kind": req.resource_type, "reason": req.failure}))
                page.on("response", lambda res: http_errors.append({"status": res.status, "kind": res.request.resource_type}) if res.status >= 400 else None)
                sess = m["sessions"].get(s["persona"])
                if sess:
                    await page.goto(m["base"] + "/privacy", wait_until="networkidle")
                    await page.evaluate("([k, v]) => window.localStorage.setItem(k, v)", [m["storageKey"], json.dumps(sess)])
                name = f'{i:02d}-{s["step"]}-{s["persona"]}-{label}.png'
                ok, detail = True, f'{s["persona"]} {s["path"]} at {width}px'
                started = time.monotonic()
                controls = []
                overflow = False
                landed_path = None
                page_ready_ms = None
                content_verified = False
                async def healthy_panel(scope):
                    await scope.wait_for(state='visible', timeout=15000)
                    for attempt in range(150):
                        pending = await scope.locator('p,[role=status]').evaluate_all('''es => es.some(e => e.getClientRects().length && /^(loading|checking|please wait)|loading .*…|updating…/i.test(e.textContent.trim()))''')
                        if not pending:
                            break
                        await page.wait_for_timeout(100)
                    else:
                        raise RuntimeError('Intended panel remained loading')
                    if not (await scope.inner_text()).strip():
                        raise RuntimeError('Intended panel has no loaded content')
                    if await scope.locator('[role=alert]:visible').evaluate_all('''es => es.some(e => /could not.*load|couldn.t.*load|failed.*load|error loading/i.test(e.textContent))'''):
                        raise RuntimeError('Intended panel reports a load failure')
                    if errors or console_errors or failed_requests or http_errors:
                        raise RuntimeError('Errors after interaction')
                    if await page.evaluate('document.documentElement.scrollWidth > innerWidth'):
                        raise RuntimeError('Horizontal overflow after interaction')
                    return True
                try:
                    await page.goto(m["base"] + s["path"], wait_until="domcontentloaded", timeout=15000)
                    # A painted heading alone can precede loaded data. Require visible controls/content
                    # and no pending status; this is browser page-ready, not backend timing.
                    await page.wait_for_function('''() => {
                        const body = document.body;
                        if (!body || !body.innerText.trim()) return false;
                        const busy = [...body.querySelectorAll('[role="status"]')].some(e => e.getClientRects().length && /loading|checking|please wait|opening|signing you in|saving|uploading/i.test(e.textContent));
                        return !busy && !!body.querySelector('h1,h2,main,input');
                    }''', timeout=15000)
                    if s.get('readinessSelector'):
                        await page.locator(s['readinessSelector']).wait_for(state='visible', timeout=15000)
                    if s.get('verifyContent'):
                        await healthy_panel(page.locator('main').first)
                        for marker in s.get('mustSee') or []:
                            await page.wait_for_function('''marker => [...document.querySelectorAll('main *')].some(e => e.getClientRects().length && e.textContent.includes(marker))''', arg=marker, timeout=15000)
                    page_ready_ms = round((time.monotonic()-started)*1000)
                    body = await page.inner_text("body")
                    if "/auth" in page.url and s["persona"] not in ("public", "owner_token"):
                        ok, detail = False, f"{detail}: bounced to sign-in"
                    landed = urlparse(page.url)
                    landed_path = landed.path
                    if s.get("expectedPath") and landed.path != s["expectedPath"]:
                        ok, detail = False, f'{detail}: landed on "{landed.path}", expected "{s["expectedPath"]}"'
                    for key, value in (s.get("expectedSearch") or {}).items():
                        if parse_qs(landed.query).get(key) != [value]:
                            ok, detail = False, f'{detail}: expected query {key}={value}'
                    for t in s.get("mustSee") or []:
                        if t.lower() not in body.lower(): ok, detail = False, f'{detail}: missing "{t}"'
                    for t in s.get("mustNotSee") or []:
                        if t.lower() in body.lower(): ok, detail = False, f'{detail}: should not show "{t}"'
                    for t in s.get("mustNotSeeExact") or []:
                        idx = body.find(t)
                        if idx >= 0: ok, detail = False, f'{detail}: shows "{t}" in "...{body[max(0, idx - 40):idx + 40]}..."'.replace("\n", " ")
                    for rule in s.get("mustNotSeeExactOutside") or []:
                        scoped = await page.evaluate(TEXT_OUTSIDE_RECORDS, rule["ignoreSelector"])
                        t = rule["text"]; idx = scoped.find(t)
                        if idx >= 0: ok, detail = False, f'{detail}: shows "{t}" outside recorded names in "...{scoped[max(0, idx - 40):idx + 40]}..."'.replace("\n", " ")
                    if s.get("noPrices") and PRICE.search(body): ok, detail = False, f"{detail}: shows a price ({PRICE.search(body).group(0)})"
                    if re.search(r"something went wrong|application error", body, re.I): ok, detail = False, f"{detail}: error page"
                    if errors: ok, detail = False, f"{detail}: page error {errors[0]}"
                    overflow = await page.evaluate('document.documentElement.scrollWidth > innerWidth')
                    if overflow: ok, detail = False, f'{detail}: horizontal overflow'
                    if console_errors or failed_requests or http_errors: ok, detail = False, f'{detail}: console/network failures ({len(console_errors)}/{len(failed_requests)}/{len(http_errors)})'
                    content_verified = bool(ok and s.get('verifyContent') and (s.get('readinessSelector') or s.get('mustSee')))
                    controls = await page.get_by_role('button').evaluate_all('''buttons => buttons.filter(b => b.getClientRects().length).map(b => {
                        const name = b.getAttribute('aria-label') || b.textContent.trim();
                        const excluded = /send|retry|resume|save|approve|decline|delete|restore|invite|download.*login|connect|sync|pay|confirm|submit|upload|start|requeue|run automated/i.test(name);
                        return {name, disabled: b.disabled, status: 'NOT_RUN', classification: excluded ? 'excluded potential mutation/outbound' : 'remaining unexecuted control requiring reviewed read-only proof', reason: excluded ? 'Excluded without invoking: may write, send or alter global/financial/account state; no permission/guard PASS inferred' : 'Remaining runbook item: review intended read-only state, click safely, then verify panel/data and errors/overflow; not blocked merely because inventoried'};
                    })''')
                    if s.get('safeTabs'):
                        links = await page.locator('nav[aria-label="Communications sections"] a').all_text_contents()
                        for link in links:
                            try:
                                await page.get_by_role('navigation', name='Communications sections').get_by_role('link', name=link, exact=True).click()
                                chosen = page.get_by_role('navigation', name='Communications sections').get_by_role('link', name=link, exact=True)
                                await page.wait_for_function('''name => [...document.querySelectorAll('nav[aria-label="Communications sections"] a')].some(e => e.textContent.trim() === name && e.getAttribute('aria-current') === 'page')''', arg=link, timeout=15000)
                                await healthy_panel(page.locator('main').first)
                                if link == 'Overview':
                                    await page.wait_for_function('''() => /The same [0-9,]+ open website enquiries/.test(document.querySelector('main')?.innerText || '')''', timeout=15000)
                                if link in ['Sent & history', 'Failed / attention']:
                                    await page.wait_for_function('''() => /[0-9,]+ matching/.test(document.querySelector('main')?.innerText || '')''', timeout=15000)
                                controls.append({'name': link, 'status': 'PASS', 'reason': 'Section selected; loaded panel content, errors and overflow verified', 'requestedURL': s['path'], 'finalURL': urlparse(page.url).path + ('?' + urlparse(page.url).query if urlparse(page.url).query else '')})
                            except Exception:
                                controls.append({'name': link, 'status': 'FAIL', 'reason': 'Communications section interaction failed'})
                                ok = False
                        tabs = await page.get_by_role('tab').all_text_contents()
                        for tab in tabs:
                            try:
                                await page.get_by_role('tab', name=tab, exact=True).click()
                                await healthy_panel(page.locator('[role=tabpanel]:visible').first)
                                controls.append({'name': tab, 'status': 'PASS', 'reason': 'Selected tab and loaded panel verified; overflow/errors rechecked'})
                            except Exception:
                                controls.append({'name': tab, 'status': 'FAIL', 'reason': 'tab interaction failed'})
                                ok = False
                    for control_name in s.get('safeButtons') or []:
                        target = page.get_by_role('button', name=re.compile('^' + re.escape(control_name) + '(?:\\s|$)')).and_(page.locator('[aria-controls]'))
                        try:
                            button = target.first
                            panel_id = await button.get_attribute('aria-controls')
                            if not panel_id:
                                raise RuntimeError('No intended panel relationship; click alone is not evidence')
                            if await button.get_attribute('aria-expanded') != 'true':
                                await button.click()
                            await page.wait_for_function('''id => document.getElementById(id)?.getAttribute('aria-expanded') === 'true' ''', arg=await button.get_attribute('id'), timeout=15000)
                            await healthy_panel(page.locator('[id="' + panel_id + '"]'))
                            interaction_shot = shots / (name.replace('.png', '-' + re.sub('[^a-zA-Z0-9]+', '-', control_name) + '.png'))
                            await page.locator('[id="' + panel_id + '"]').screenshot(path=str(interaction_shot))
                            controls.append({'name': control_name, 'status': 'PASS', 'reason': 'Expanded intended panel and loaded data verified; overflow/errors rechecked', 'panel': panel_id, 'screenshot': str(interaction_shot)})
                        except Exception as exc:
                            controls.append({'name': control_name, 'status': 'FAIL', 'reason': 'Intended panel/data or post-interaction checks failed: ' + str(exc)[:150]})
                            ok = False
                    if errors or console_errors or failed_requests or http_errors:
                        ok, detail = False, f'{detail}: errors after disclosure interaction'
                except Exception as e:
                    ok, detail = False, f"{detail}: {str(e)[:200]}"
                await page.screenshot(path=str(shots / name))
                results.append({"step": s["step"], "persona": s["persona"], "requested_path": s["path"], "landed_path": landed_path, "ok": ok, 'content_verified': content_verified and ok, "detail": detail if not ok else f"{detail} render checks ok; controls listed separately", "shots": [str(shots / name)], 'viewport': {'width': width, 'height': 844 if width == 390 else 1800}, 'page_ready_ms': page_ready_ms, 'elapsed_ms': round((time.monotonic()-started)*1000), 'page_errors': errors, 'console_errors': console_errors, 'failed_requests': failed_requests, 'navigation_aborts': navigation_aborts, 'http_errors': http_errors, 'overflow': overflow, 'controls': controls})
                partial = out / '.browser.tmp.json'
                partial.write_text(json.dumps(results))
                partial.replace(out / '.browser.json')
                await ctx.close()
        await browser.close()
    partial = out / '.browser.tmp.json'
    partial.write_text(json.dumps(results))
    partial.replace(out / '.browser.json')

asyncio.run(main(sys.argv[1]))

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
                try:
                    await page.goto(m["base"] + s["path"], wait_until="domcontentloaded", timeout=15000)
                    try:
                        await page.wait_for_load_state('networkidle', timeout=3000)
                    except Exception:
                        pass
                    await page.wait_for_timeout(500)
                    body = await page.inner_text("body")
                    if "/auth" in page.url and s["persona"] not in ("public", "owner_token"):
                        ok, detail = False, f"{detail}: bounced to sign-in"
                    landed = urlparse(page.url)
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
                    controls = await page.get_by_role('button').evaluate_all('(buttons) => buttons.filter(b => b.getClientRects().length).map(b => ({name: b.getAttribute("aria-label") || b.textContent.trim(), disabled: b.disabled, status: "NOT_RUN", reason: "inventoried only; no mutation/control execution implied"}))')
                    for control_name in s.get('safeButtons') or []:
                        await page.get_by_role('button', name=control_name, exact=True).click()
                        try:
                            await page.wait_for_load_state('networkidle', timeout=3000)
                        except Exception:
                            pass
                        controls.append({'name': control_name, 'status': 'PASS', 'reason': 'explicit read-only disclosure clicked'})
                    if errors or console_errors or failed_requests or http_errors:
                        ok, detail = False, f'{detail}: errors after disclosure interaction'
                except Exception as e:
                    ok, detail = False, f"{detail}: {str(e)[:200]}"
                await page.screenshot(path=str(shots / name))
                results.append({"step": s["step"], "ok": ok, "detail": detail if not ok else f"{detail} render checks ok; controls listed separately", "shots": [str(shots / name)], 'viewport': {'width': width, 'height': 844 if width == 390 else 1800}, 'elapsed_ms': round((time.monotonic()-started)*1000), 'page_errors': errors, 'console_errors': console_errors, 'failed_requests': failed_requests, 'navigation_aborts': navigation_aborts, 'http_errors': http_errors, 'overflow': overflow, 'controls': controls})
                partial = out / '.browser.tmp.json'
                partial.write_text(json.dumps(results))
                partial.replace(out / '.browser.json')
                await ctx.close()
        await browser.close()
    partial = out / '.browser.tmp.json'
    partial.write_text(json.dumps(results))
    partial.replace(out / '.browser.json')

asyncio.run(main(sys.argv[1]))

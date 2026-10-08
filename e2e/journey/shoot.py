"""Browser half of the full-journey test. Reads the manifest written by scripts/journey.ts, opens every page
at 390px and 1280px as the right TEST person, saves screenshots and checks must-see / must-not-see text.
Sessions come from the manifest (TEST accounts only) and are written to localStorage on localhost only."""
import asyncio, json, re, sys
from pathlib import Path
from playwright.async_api import async_playwright

PRICE = re.compile(r"\$\s?\d[\d,]*")

async def main(manifest_path):
    m = json.loads(Path(manifest_path).read_text())
    out = Path(m["outDir"]); shots = out / "screens"; shots.mkdir(parents=True, exist_ok=True)
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        for i, s in enumerate(m["screens"]):
            for width, label in ((390, "phone"), (1280, "desktop")):
                ctx = await browser.new_context(viewport={"width": width, "height": 1800})
                page = await ctx.new_page()
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)[:200]))
                sess = m["sessions"].get(s["persona"])
                if sess:
                    await page.goto(m["base"] + "/privacy", wait_until="domcontentloaded")
                    await page.evaluate("([k, v]) => window.localStorage.setItem(k, v)", [m["storageKey"], json.dumps(sess)])
                name = f'{i:02d}-{s["step"]}-{s["persona"]}-{label}.png'
                ok, detail = True, f'{s["persona"]} {s["path"]} at {width}px'
                try:
                    await page.goto(m["base"] + s["path"], wait_until="networkidle", timeout=45000)
                    await page.wait_for_timeout(1500)
                    body = await page.inner_text("body")
                    if "/auth" in page.url and s["persona"] not in ("public", "owner_token"):
                        ok, detail = False, f"{detail}: bounced to sign-in"
                    for t in s.get("mustSee") or []:
                        if t.lower() not in body.lower(): ok, detail = False, f'{detail}: missing "{t}"'
                    for t in s.get("mustNotSee") or []:
                        if t.lower() in body.lower(): ok, detail = False, f'{detail}: should not show "{t}"'
                    for t in s.get("mustNotSeeExact") or []:
                        idx = body.find(t)
                        if idx >= 0: ok, detail = False, f'{detail}: shows "{t}" in "...{body[max(0, idx - 40):idx + 40]}..."'.replace("\n", " ")
                    if s.get("noPrices") and PRICE.search(body): ok, detail = False, f"{detail}: shows a price ({PRICE.search(body).group(0)})"
                    if re.search(r"something went wrong|application error", body, re.I): ok, detail = False, f"{detail}: error page"
                    if errors: ok, detail = False, f"{detail}: page error {errors[0]}"
                except Exception as e:
                    ok, detail = False, f"{detail}: {str(e)[:200]}"
                await page.screenshot(path=str(shots / name))
                results.append({"step": s["step"], "ok": ok, "detail": detail if not ok else f"{detail} ok", "shots": [str(shots / name)]})
                await ctx.close()
        await browser.close()
    (out / ".browser.json").write_text(json.dumps(results))

asyncio.run(main(sys.argv[1]))

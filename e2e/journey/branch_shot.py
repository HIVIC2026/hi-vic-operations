"""Hard-case screenshots (Jo 27 Oct): open each page at 390x844 as the given TEST person, save a PNG and the visible
text so the report can show what that person actually saw. Sessions are TEST accounts only, written to localhost only;
the manifest is wiped by the caller after the run."""
import asyncio, json, sys
from pathlib import Path
from playwright.async_api import async_playwright

async def main(path):
    m = json.loads(Path(path).read_text())
    out = Path(m["outDir"]); out.mkdir(parents=True, exist_ok=True)
    res = []
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        for s in m["shots"]:
            ctx = await b.new_context(viewport={"width": 390, "height": 844})
            page = await ctx.new_page(); page.set_default_timeout(15000)
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)[:160]))
            try:
                if s.get("session"):
                    await page.goto(m["base"] + "/privacy", wait_until="domcontentloaded")
                    await page.evaluate("([k, v]) => window.localStorage.setItem(k, v)", [m["storageKey"], json.dumps(s["session"])])
                await page.goto(m["base"] + s["path"], wait_until="networkidle", timeout=45000)
                await page.wait_for_timeout(2500)
                for _ in range(10):  # a page still saying "Loading…" gets up to 10 more seconds
                    if "Loading" not in await page.inner_text("body"): break
                    await page.wait_for_timeout(1000)
                text = " ".join((await page.inner_text("body")).split())
                width = await page.evaluate("document.documentElement.scrollWidth")
                await page.screenshot(path=str(out / s["name"]))
                res.append({"name": s["name"], "path": s["path"].split("?")[0], "landed": page.url.replace(m["base"], "").split("?")[0], "text": text[:4000], "overflow": width > 392, "errors": errs})
            except Exception as e:
                res.append({"name": s["name"], "path": s["path"].split("?")[0], "landed": None, "text": "", "overflow": False, "errors": errs + [str(e)[:200]]})
            await ctx.close()
        await b.close()
    Path(m["resultFile"]).write_text(json.dumps(res))

asyncio.run(main(sys.argv[1]))

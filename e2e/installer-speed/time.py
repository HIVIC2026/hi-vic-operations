"""Browser half of the installer-screens timing tool. Reads the manifest written by scripts/installer-speed.ts.
For each screen and role: 5 cold loads on a 390x844 phone throttled like 4G (1.6 Mbps down, 750 kbps up, 150 ms latency),
timed from navigation start until the screen's main content is visible. Records every /_serverFn/ request and its duration.
Read-only: it only opens pages. Sessions are TEST accounts from the manifest, put in localStorage before the app loads."""
import asyncio, json, sys, time
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

RUNS = 5
DOWN_BPS, UP_BPS, LATENCY_MS = 1.6e6, 750e3, 150
READY = {
    "home": '[data-job-group="action"]',
    "job": "main h1",
    "day": "main h1",
    "business": 'main h1:has-text("My business")',
    "money": "[data-money-totals], [data-money-empty]",
}
PATH = {"home": "/field", "job": "/field/{job}", "day": "/field/day/{job}", "business": "/field/business", "money": "/field/money"}
# What the portal already shows when a page is not for that person.
REFUSAL = 'main p:has-text("isn\'t available to you"), main p:has-text("TEST sign-in can only"), main p:has-text("assigned to you"), main p:has-text("only shown to the business owner")'


def server_fn_name(url):
    tail = url.split("?")[0].split("/_serverFn/")[-1]
    tail = tail.split("--")[-1]
    return tail.removesuffix("_createServerFn_handler")


def refusal_expected(m, screen, role):
    if role != "staff":
        return False
    if screen == "money":
        return True
    return screen in ("job", "day") and not m.get("staffAssigned", False)


async def one_run(browser, m, screen, role):
    ctx = await browser.new_context(viewport={"width": 390, "height": 844})
    try:
        sess = m["sessions"][role]
        origin = "{u.scheme}://{u.netloc}".format(u=urlparse(m["base"]))
        # Only the portal's own page gets the TEST token (not other origins or frames).
        await ctx.add_init_script(f"try{{if(location.origin==={json.dumps(origin)})localStorage.setItem({json.dumps(m['storageKey'])},{json.dumps(json.dumps(sess))})}}catch(e){{}}")
        page = await ctx.new_page()
        page.set_default_timeout(45000)
        cdp = await ctx.new_cdp_session(page)
        await cdp.send("Network.enable")
        await cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": LATENCY_MS, "downloadThroughput": DOWN_BPS / 8, "uploadThroughput": UP_BPS / 8})
        started, calls = {}, []
        page.on("request", lambda r: started.__setitem__(r, time.monotonic()) if "/_serverFn/" in r.url else None)
        page.on("requestfinished", lambda r: calls.append({"name": server_fn_name(r.url), "ms": round((time.monotonic() - started[r]) * 1000)}) if r in started else None)
        url = m["base"] + PATH[screen].format(job=m.get("jobId", ""))
        t0 = time.monotonic()
        await page.goto(url, wait_until="commit")
        await page.wait_for_selector(f"{READY[screen]}, {REFUSAL}", state="visible")
        ms = round((time.monotonic() - t0) * 1000)
        ready = await page.locator(READY[screen]).first.is_visible()
        if not ready:  # a refusal text showed; give the real screen about 1 s to appear before calling it a refusal
            try:
                await page.locator(READY[screen]).first.wait_for(state="visible", timeout=1000)
                ready = True
            except Exception:
                pass
        landed = page.url
        await page.wait_for_timeout(300)  # let calls that were already in flight finish so they are counted
        if "/auth" in landed:
            return {"ms": ms, "calls": calls, "error": "bounced to sign-in"}
        if not ready:
            if refusal_expected(m, screen, role):
                return {"ms": ms, "calls": calls, "refused": True}
            text = (await page.locator(REFUSAL).first.inner_text())[:120]
            return {"ms": ms, "calls": calls, "error": f"unexpected refusal: {text}"}
        return {"ms": ms, "calls": calls}
    except Exception as e:  # a timeout or crash is a failed run, reported as such
        return {"ms": 0, "calls": [], "error": f"{type(e).__name__}: {str(e)[:100]}"}
    finally:
        await ctx.close()


async def main(manifest_path):
    m = json.loads(Path(manifest_path).read_text())
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        for screen in m["screens"]:
            for role in ("owner", "staff"):
                runs = []
                for _ in range(RUNS):
                    runs.append(await one_run(browser, m, screen, role))
                    if runs[-1].get("error"):
                        break  # no point repeating a broken page
                results.append({"screen": screen, "role": role, "runs": runs})
                print(f"{screen}/{role}: " + ", ".join(str(r["ms"]) for r in runs), flush=True)
        await browser.close()
    Path(m["resultPath"]).write_text(json.dumps(results))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))

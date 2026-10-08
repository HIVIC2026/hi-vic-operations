# Drives /installer-preview at phone width; asserts the payload the real form submits keeps manual amount + scope.
import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        pg = await (await b.new_context(viewport={"width": 390, "height": 1800})).new_page()
        reqs, errs = [], []
        pg.on("request", lambda r: reqs.append(r.url) if ("_serverFn" in r.url or "supabase" in r.url) else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(f"{BASE}/installer-preview", wait_until="networkidle")
        assert await pg.get_by_text("Preview only — sample job, nothing is saved or sent").is_visible()
        await pg.screenshot(path="/tmp/browser/ip1.png")
        await pg.get_by_role("checkbox").first.check()
        await pg.get_by_role("button", name="Next").click()
        await pg.get_by_label("Ceiling area (m²)").fill("120")
        await pg.get_by_role("radio", name="None").click()
        await pg.get_by_label("Your quote inc GST").fill("3,450")
        await pg.get_by_label("What the quote includes").fill("R5.0 batts supply and install")
        await pg.get_by_role("radio", name="I'll organise the job myself").click()
        await pg.screenshot(path="/tmp/browser/ip2.png")
        await pg.locator("[data-self-managed-ack] button").click()
        await pg.get_by_role("radio", name="Home Insulation Victoria manages").click()
        await pg.get_by_role("button", name="Next").click()
        await pg.locator("[data-evidence-ack] button").click()
        await pg.screenshot(path="/tmp/browser/ip3.png")
        await pg.get_by_role("button", name="Submit job").click()
        await pg.locator("[data-preview-received]").wait_for()
        await pg.screenshot(path="/tmp/browser/ip4.png")
        sub = await pg.evaluate("window.__previewSubmitted")
        inst = sub[0]["installer"]
        assert inst["quoted_price_inc_gst"] == 3450, inst
        assert inst["price_includes"] == "R5.0 batts supply and install", inst
        assert inst["quoted"] == "yes" and inst["site_check_date"] is None
        ow = await pg.evaluate("document.documentElement.scrollWidth")
        assert ow <= 390, ow
        assert not reqs, reqs
        assert not errs, errs
        print("OK", inst["quoted_price_inc_gst"], inst["price_includes"], inst["intake"]["coordination"])
        await b.close()
asyncio.run(main())

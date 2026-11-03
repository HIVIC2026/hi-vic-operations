"""Browser half of the installer app cache check (scripts/installer-app-cache-check.ts writes the manifest).
Read-only: opens /field three times as the TEST owner in one browser context — (1) online, until My work shows and the
service worker controls the page; (2) online again: what a repeat visit still downloads from the network; (3) with the
network off: is the HTML shell served by the worker and does the app's module script load. Writes a JSON result."""
import asyncio, json, sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

READY = '[data-job-group="action"]'


async def main(manifest_path):
    m = json.loads(Path(manifest_path).read_text())
    base = m["base"].rstrip("/")
    origin = "{u.scheme}://{u.netloc}".format(u=urlparse(base))
    out = {"base": base}
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844})
        await ctx.add_init_script(f"try{{if(location.origin==={json.dumps(origin)})localStorage.setItem({json.dumps(m['storageKey'])},{json.dumps(json.dumps(m['session']))})}}catch(e){{}}")
        try:
            # 1. First visit: My work shows, the worker installs and takes control.
            page = await ctx.new_page()
            page.set_default_timeout(60000)
            await page.goto(base + "/field", wait_until="commit")
            await page.wait_for_selector(READY, state="visible")
            out["first"] = {"url": page.url}
            try:
                out["first"]["controlled"] = await page.evaluate("navigator.serviceWorker.ready.then(r => !!r.active).then(a => new Promise(res => { if (navigator.serviceWorker.controller) return res(true); navigator.serviceWorker.addEventListener('controllerchange', () => res(true)); setTimeout(() => res(false), 15000); }))")
                out["first"]["cached"] = await page.evaluate("caches.keys().then(async ks => { const k = ks.find(x => x.startsWith('hiv-installer-app:')); if (!k) return 0; const c = await caches.open(k); return (await c.keys()).length; })")
            except Exception as e:
                out["first"]["controlled"] = False
                out["first"]["error"] = f"{type(e).__name__}: {str(e)[:160]}"
            await page.close()
            # 2. Repeat visit online: static files that still came from the network.
            page = await ctx.new_page()
            page.set_default_timeout(60000)
            network = []
            page.on("response", lambda r: network.append(r) if "/assets/" in r.url else None)
            await page.goto(base + "/field", wait_until="commit")
            await page.wait_for_selector(READY, state="visible")
            from_net = [r.url.split("/assets/")[-1] for r in network if not r.from_service_worker]
            out["repeat"] = {"url": page.url, "assetsFromNetwork": from_net, "assetsFromWorker": sum(1 for r in network if r.from_service_worker)}
            await page.close()
            # 3. Network off: the shell comes from the worker.
            await ctx.set_offline(True)
            page = await ctx.new_page()
            page.set_default_timeout(30000)
            try:
                resp = await page.goto(base + "/field", wait_until="domcontentloaded")
                scripts = await page.evaluate("[...document.scripts].map(s => s.src).filter(s => s.includes('/assets/'))")
                out["offline"] = {"status": resp.status if resp else None, "shellFromServiceWorker": bool(resp and resp.from_service_worker), "moduleScripts": scripts, "title": await page.title()}
                await page.wait_for_timeout(4000)
                out["offline"]["landed"] = page.url
                out["offline"]["myWorkShown"] = await page.locator(READY).first.is_visible()
            except Exception as e:
                out["offline"] = {"shellFromServiceWorker": False, "error": f"{type(e).__name__}: {str(e)[:160]}"}
            await page.close()
        finally:
            await ctx.close()
            await browser.close()
    Path(m["resultPath"]).write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))
    return 0 if out.get("offline", {}).get("shellFromServiceWorker") else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1])))

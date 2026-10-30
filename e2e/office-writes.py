# Browser half of scripts/qa-office-writes.ts — TEST office only, one qa_test job.
import asyncio, json, sys, re
from playwright.async_api import async_playwright

m = json.load(open(sys.argv[1]))
BASE, OUT, JOB, NUM = m["base"], m["outDir"], m["jobId"], m["jobNumber"]
res = []

def rec(step, ok, detail, shots):
    res.append({"step": step, "ok": bool(ok), "detail": detail, "shots": shots})
    print("PASS" if ok else "FAIL", step, detail)

async def run(p, w):
    tag = "phone" if w < 600 else "desktop"
    b = await p.chromium.launch(headless=True)
    ctx = await b.new_context(viewport={"width": w, "height": 1800})
    pg = await ctx.new_page()
    await pg.goto(BASE + "/auth", wait_until="domcontentloaded")
    await pg.evaluate("([k,v]) => localStorage.setItem(k, v)", [m["storageKey"], json.dumps(m["session"])])
    job_url = f"{BASE}/admin/jobs/{JOB}"
    shot = lambda n: f"{OUT}/screens/{tag}-{n}.png"
    async def snap(n):
        await pg.screenshot(path=shot(n)); return shot(n)
    async def body():
        return await pg.inner_text("body")
    try:
        # --- delete menu: More ▾ → "Delete (test jobs only)" → dialog "Reason" + "Delete". Gating only: the menu's Delete
        # became a restorable soft delete on 27 Oct 2026, but older published builds still delete PERMANENTLY, so it is
        # never confirmed on the QA fixture. The runner soft-deletes the
        # job through the deployed deleteJob endpoint before this journey starts (manifest softDeleted=true).
        await pg.goto(job_url, wait_until="networkidle"); await pg.wait_for_timeout(1500)
        t = await body()
        banner = "This job is deleted" in t
        menu_ok = False; empty_disabled = short_disabled = False
        await pg.get_by_role("button", name="More ▾").first.click(); await pg.wait_for_timeout(500)
        item = pg.get_by_role("menuitem", name="Delete (test jobs only)")
        if await item.count():
            await item.click()
            dlg = pg.get_by_role("dialog")
            confirm = dlg.get_by_role("button", name="Delete", exact=True)
            reason_box = dlg.get_by_label("Reason")
            empty_disabled = await confirm.is_disabled()
            await reason_box.fill("ab")
            short_disabled = await confirm.is_disabled()
            menu_ok = True
            await dlg.get_by_role("button", name="Close", exact=True).first.click()
        rec(f"delete job ({tag})", m.get("softDeleted") and banner and menu_ok and empty_disabled and short_disabled, f"deleted banner on job={banner}; menu item shown={menu_ok}; empty/2-char reason blocked={empty_disabled}/{short_disabled}; permanent Delete not confirmed", [await snap("1-deleted")])
        # --- Settings › Deleted lists it (old /admin/deleted only redirects here) ---
        deleted_url = BASE + "/admin/settings?tab=deleted"
        await pg.goto(deleted_url, wait_until="networkidle"); await pg.wait_for_timeout(2000)
        listed = NUM in await body()
        rec(f"deleted page lists job ({tag})", listed, f"on Settings › Deleted={listed}", [await snap("2-deleted-page")])
        # --- restore: "Restore ›" → "Reason for restoring HV-…" → "Restore" ---
        row = pg.locator("tr").filter(has_text=NUM)
        await row.get_by_role("button", name="Restore ›").click()
        btn = row.get_by_role("button", name="Restore", exact=True)
        rdis = await btn.is_disabled()
        await pg.fill(f'[aria-label="Reason for restoring {NUM}"]', f"QA retest {tag}: restore check")
        await btn.click(); await pg.wait_for_timeout(2500)
        await pg.goto(deleted_url, wait_until="networkidle"); await pg.wait_for_timeout(2000)
        gone = NUM not in await body()
        s2 = await snap("4-after-restore")
        await pg.goto(job_url, wait_until="networkidle"); await pg.wait_for_timeout(1500)
        rec(f"restore job ({tag})", rdis and gone and "This job is deleted" not in await body(), f"empty reason blocked={rdis}; gone from Deleted after reload={gone}", [s2, await snap("5-job-restored")])
        # --- classification: Enquiry stage workspace → "Eligibility" card → "Change result" ---
        async def open_change():
            # Full reload each time (a same-URL hash navigation would keep the old, already-open state).
            await pg.goto(job_url, wait_until="networkidle"); await pg.reload(wait_until="networkidle"); await pg.wait_for_timeout(2000)
            card = pg.locator("[data-eligibility-card]")
            if not await card.count():
                await pg.locator("#stage-enquiry").get_by_role("button", name="Open ›").click(); await pg.wait_for_timeout(2500)
            await card.get_by_role("button", name="Change result").click(); await pg.wait_for_timeout(1500)
            return card
        async def classify(label_re, reason):
            card = await open_change()
            await card.get_by_role("button", name=label_re).first.click()
            await card.get_by_placeholder(re.compile(r"^Reason \(e\.g\.")).fill(reason)
            await card.get_by_placeholder("Note (optional)").fill("QA check only")
            await card.get_by_role("button", name="Save outcome").click(); await pg.wait_for_timeout(3000)
            card = await open_change()
            try:
                await card.get_by_text("Current", exact=True).wait_for(timeout=20000)
            except Exception:
                pass
            t = await card.inner_text()
            return re.search(r"Current\s+" + label_re.pattern.strip("^$"), t, re.I) is not None, t
        ok1, _ = await classify(re.compile(r"^(Does not appear eligible|Not eligible)$", re.I), f"QA retest {tag}: classification check")
        s3 = await snap("6-ineligible")
        ok2, _ = await classify(re.compile(r"^Likely eligible$", re.I), f"QA retest {tag}: classification back")
        rec(f"classification ineligible -> likely ({tag})", ok1 and ok2, f"persisted after reload: ineligible={ok1}, likely={ok2}", [s3, await snap("7-likely")])
    except Exception as e:
        rec(f"journey ({tag})", False, f"error: {str(e)[:300]}", [await snap("error")])
    await b.close()

async def main():
    async with async_playwright() as p:
        # One viewport per call: the runner soft-deletes the job before each call (the UI restore undoes it).
        for w in ([int(sys.argv[2])] if len(sys.argv) > 2 else [1280, 390]):
            await run(p, w)
    json.dump(res, open(f"{OUT}/.browser.json", "w"))

asyncio.run(main())

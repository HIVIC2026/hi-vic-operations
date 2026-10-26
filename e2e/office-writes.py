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
        # --- delete: More ▾ → "Delete (test jobs only)" → dialog with "Reason" + "Delete" (office redesign, JobMoreMenu) ---
        await pg.goto(job_url, wait_until="networkidle"); await pg.wait_for_timeout(1500)
        await pg.get_by_role("button", name="More ▾").first.click()
        await pg.get_by_role("menuitem", name="Delete (test jobs only)").click()
        dlg = pg.get_by_role("dialog")
        confirm = dlg.get_by_role("button", name="Delete", exact=True)
        reason_box = dlg.get_by_label("Reason")
        empty_disabled = await confirm.is_disabled()
        await reason_box.fill("ab")
        short_disabled = await confirm.is_disabled()
        await reason_box.fill(f"QA retest {tag}: delete check on TEST job")
        await confirm.click()
        try:
            await pg.wait_for_url(re.compile(r"/admin/jobs/active"), timeout=10000)
        except Exception:
            pass
        landed = "/admin/jobs/active" in pg.url
        await pg.goto(job_url, wait_until="networkidle"); await pg.wait_for_timeout(2000)
        t = await body()
        rec(f"delete job ({tag})", empty_disabled and short_disabled and landed and "This job is deleted" in t, f"empty/2-char reason blocked={empty_disabled}/{short_disabled}; went to Jobs active={landed}; deleted banner on job={'This job is deleted' in t}", [await snap("1-deleted")])
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
            await pg.goto(job_url + "#stage-enquiry", wait_until="networkidle"); await pg.wait_for_timeout(2000)
            card = pg.locator("[data-eligibility-card]")
            if not await card.count():
                await pg.get_by_role("button", name=re.compile(r"^Enquiry")).first.click(); await pg.wait_for_timeout(2000)
            await card.get_by_role("button", name="Change result").click(); await pg.wait_for_timeout(1500)
            return card
        async def classify(label_re, reason):
            card = await open_change()
            await card.get_by_role("button", name=label_re).first.click()
            await card.get_by_placeholder(re.compile(r"^Reason \(e\.g\.")).fill(reason)
            await card.get_by_placeholder("Note (optional)").fill("QA check only")
            await card.get_by_role("button", name="Save outcome").click(); await pg.wait_for_timeout(3000)
            card = await open_change()
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
        for w in (1280, 390):
            await run(p, w)
    json.dump(res, open(f"{OUT}/.browser.json", "w"))

asyncio.run(main())

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
        # --- delete ---
        await pg.goto(job_url, wait_until="networkidle")
        await pg.get_by_role("button", name="Delete job").first.click()
        confirm = pg.locator("form").filter(has=pg.locator("#job-delete-reason")).get_by_role("button", name="Delete job")
        empty_disabled = await confirm.is_disabled()
        await pg.fill("#job-delete-reason", "ab")
        short_disabled = await confirm.is_disabled()
        await pg.fill("#job-delete-reason", f"QA afternoon {tag}: delete check on TEST job")
        await confirm.click()
        await pg.wait_for_timeout(2500)
        await pg.reload(wait_until="networkidle"); await pg.wait_for_timeout(1500)
        t = await body()
        rec(f"delete job ({tag})", empty_disabled and short_disabled and "This job is deleted" in t, f"empty/2-char reason blocked={empty_disabled}/{short_disabled}; deleted banner after reload={'This job is deleted' in t}", [await snap("1-deleted")])
        # --- deleted page + pipeline absence ---
        await pg.goto(BASE + "/admin/deleted", wait_until="networkidle"); await pg.wait_for_timeout(1500)
        listed = NUM in await body()
        s1 = await snap("2-deleted-page")
        await pg.goto(BASE + "/admin/pipeline", wait_until="networkidle"); await pg.wait_for_timeout(2500)
        in_pipe = NUM in await body()
        rec(f"deleted page lists, pipeline hides ({tag})", listed and not in_pipe, f"on Deleted jobs={listed}; on Pipeline={in_pipe}", [s1, await snap("3-pipeline")])
        # --- restore from deleted page ---
        await pg.goto(BASE + "/admin/deleted", wait_until="networkidle"); await pg.wait_for_timeout(1500)
        row = pg.locator("tr").filter(has_text=NUM)
        await row.get_by_role("button", name="Restore").click()
        btn = row.get_by_role("button", name="Restore")
        rdis = await btn.is_disabled()
        await pg.fill(f'[aria-label="Reason for restoring {NUM}"]', f"QA afternoon {tag}: restore check")
        await btn.click(); await pg.wait_for_timeout(2500)
        await pg.reload(wait_until="networkidle"); await pg.wait_for_timeout(1500)
        gone = NUM not in await body()
        s2 = await snap("4-after-restore")
        await pg.goto(job_url, wait_until="networkidle"); await pg.wait_for_timeout(1500)
        rec(f"restore job ({tag})", rdis and gone and "This job is deleted" not in await body(), f"empty reason blocked={rdis}; gone from Deleted after reload={gone}", [s2, await snap("5-job-restored")])
        # --- classification ---
        async def classify(label, reason):
            await pg.goto(job_url, wait_until="networkidle"); await pg.wait_for_timeout(1000)
            await pg.get_by_text("Eligibility evidence & verified decision").click(); await pg.wait_for_timeout(1500)
            await pg.get_by_text("Change result", exact=True).first.click(); await pg.wait_for_timeout(1000)
            await pg.get_by_role("button", name=label, exact=True).click()
            await pg.get_by_placeholder(re.compile("^Reason")).fill(reason)
            await pg.get_by_placeholder("NEXT ACTION").fill("QA check only")
            await pg.get_by_role("button", name="Save outcome").click(); await pg.wait_for_timeout(2500)
            await pg.reload(wait_until="networkidle"); await pg.wait_for_timeout(1000)
            await pg.get_by_text("Eligibility evidence & verified decision").click(); await pg.wait_for_timeout(1500)
            await pg.get_by_text("Change result", exact=True).first.click(); await pg.wait_for_timeout(2000)
            t = await body()
            return (f"Current\n{label}" in t or f"Current\t{label}" in t or re.search(r"Current\s+" + re.escape(label), t) is not None), t
        ok1, _ = await classify("Does Not Appear Eligible", f"QA afternoon {tag}: classification check")
        s3 = await snap("6-ineligible")
        ok2, _ = await classify("Likely Eligible", f"QA afternoon {tag}: classification back")
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

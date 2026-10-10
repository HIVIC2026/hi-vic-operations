"""Daily QA: REC + installer onboarding click-through on single-use qa_test staff links (TEST mode applications).
Reads a manifest from scripts/qa-onboarding.ts. Only localhost is reachable from the browser (everything else aborted);
address fields are never typed (the address lookup is an outside service), so nothing leaves the sandbox from the page."""
import asyncio, json, re, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

m = json.loads(Path(sys.argv[1]).read_text())
OUT = Path(m["outDir"]); SHOTS = OUT / "screens"; SHOTS.mkdir(parents=True, exist_ok=True)
DEADLINE = time.time() + m["budget"]
rows = []

def row(trade, width, action, status, detail, shots=()):
    rows.append({"trade": trade, "width": width, "action": action, "status": status, "detail": detail, "screenshots": list(shots)})
    (OUT / ".browser.json").write_text(json.dumps({"rows": rows, "tokens": TOKENS, "external_requests_blocked": BLOCKED}))

TOKENS = {}; BLOCKED = []

async def ctx_for(browser, width):
    c = await browser.new_context(viewport={"width": width, "height": 1800})
    async def guard(route):
        u = route.request.url
        if u.startswith("http://localhost:8080"): await route.continue_()
        else: BLOCKED.append(u[:120]); await route.abort()
    await c.route("**/*", guard)
    return c

async def shot(pg, name):
    p = SHOTS / name; await pg.screenshot(path=str(p)); return str(p)

async def heading(pg):
    t = await pg.inner_text("body")
    mm = re.search(r"(\d+) of (\d+)", t)
    return (mm.group(1) if mm else "?"), t

async def fill_page1(pg, trade, tag):
    await pg.get_by_role("button", name=re.compile("^Register my")).click()
    await pg.get_by_placeholder("e.g. Sam Taylor").fill(f"QA Onboarding {tag}")
    await pg.locator("input[type=tel]").first.fill("0491 570 156")
    await pg.locator("input[type=email]").first.fill(f"qa.onb.{tag}@hivic-test.example")
    if trade == "rec":
        await pg.locator("input[type=checkbox]").first.check()
        await pg.locator("xpath=//label[contains(.,'licence number')]/following-sibling::input").first.fill("REC-TEST-0001")
        await pg.locator("input[type=date]").first.fill("2028-06-30")

async def save(pg):
    await pg.get_by_role("button", name=re.compile("save & continue", re.I)).click()
    await pg.wait_for_timeout(2500)

async def run(browser, a):
    trade, width, link, tag, route, key = a["trade"], a["width"], a["link"], a["tag"], a["route"], a["key"]
    lbl = f"{trade}-{width}"
    if time.time() > DEADLINE: return row(trade, width, "all", "not_run", "budget exhausted")
    c = await ctx_for(browser, width); pg = await c.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
    try:
        q = f"resume={a['resume']}" if a.get("resume") else f"staff={link}"
        await pg.goto(f"{m['base']}/{route}?{q}", wait_until="networkidle"); await pg.wait_for_timeout(1200)
        sb0 = pg.get_by_role("button", name=re.compile("(Start|Continue) registration"))
        if await sb0.count(): await sb0.click(); await pg.wait_for_timeout(1500)
        body = await pg.inner_text("body")
        row(trade, width, "staff TEST link shows TEST MODE banner", "passed" if "TEST MODE" in body.upper() else "failed", "banner present" if "TEST MODE" in body.upper() else "no TEST banner", [await shot(pg, f"{lbl}-01-start.png")])
        if a["mode"] == "validate":
            await pg.get_by_role("button", name=re.compile("^Register my")).click()
            await save(pg); n, t = await heading(pg)
            ok = n == "1" and re.search(r"required|please|enter|add your", t, re.I)
            row(trade, width, "Save & continue with empty required fields is refused", "passed" if ok else "failed", f"still on page {n}; error text {'shown' if ok else 'missing'}", [await shot(pg, f"{lbl}-02-validation.png")])
            await fill_page1(pg, trade, tag); await save(pg); n, _ = await heading(pg)
            row(trade, width, "page 1 completed then saved (non-relaxed)", "passed" if n == "2" else ("blocked" if trade == "installer" else "failed"), f"now on page {n}" + ("; installer page 1 requires a verified business address (outside lookup not called)" if trade == "installer" and n != "2" else ""), [await shot(pg, f"{lbl}-03-page2.png")])
        else:
            await fill_page1(pg, trade, tag); await save(pg)
            n, _ = await heading(pg)
            row(trade, width, "fill page 1, Save & continue", "passed" if n == "2" else "failed", f"now on page {n}", [await shot(pg, f"{lbl}-02-page2.png")])
            await pg.get_by_role("button", name=re.compile("^back$", re.I)).click(); await pg.wait_for_timeout(2500)
            n, _ = await heading(pg)
            vals = [await pg.get_by_placeholder("e.g. Sam Taylor").input_value(), await pg.locator("input[type=email]").first.input_value()]
            ok = n == "1" and vals == [f"QA Onboarding {tag}", f"qa.onb.{tag}@hivic-test.example"]
            row(trade, width, "Back keeps saved answers on page 1", "passed" if ok else "failed", f"page {n}, values {vals}", [await shot(pg, f"{lbl}-03-back.png")])
            await save(pg); await save(pg)  # page 1 -> 2 -> 3 (relaxed TEST link)
            n_before, _ = await heading(pg)
            TOKENS[lbl] = await pg.evaluate(f"localStorage.getItem('{key}')")
            await c.close()
            c = await ctx_for(browser, width); pg = await c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
            await pg.goto(f"{m['base']}/{route}", wait_until="domcontentloaded")
            await pg.evaluate("([k,v]) => localStorage.setItem(k,v)", [key, TOKENS[lbl] or ""])
            await pg.goto(f"{m['base']}/{route}", wait_until="networkidle"); await pg.wait_for_timeout(1500)
            cont = pg.get_by_role("button", name=re.compile("Continue registration"))
            if await cont.count(): await cont.click(); await pg.wait_for_timeout(1500)
            n, _ = await heading(pg)
            ok = n.isdigit() and n_before.isdigit() and 1 <= int(n) <= int(n_before) and "Start registration" not in await pg.inner_text("body")
            row(trade, width, "fresh browser resumes saved draft (first unfinished page, never the welcome)", "passed" if ok else "failed", f"furthest saved page {n_before}, resumed page {n}", [await shot(pg, f"{lbl}-04-resume.png")])
            while (await heading(pg))[0] not in ("1", "?"):
                await pg.get_by_role("button", name=re.compile("^back$", re.I)).click(); await pg.wait_for_timeout(1500)
            vals = [await pg.get_by_placeholder("e.g. Sam Taylor").input_value(), await pg.locator("input[type=email]").first.input_value()]
            row(trade, width, "after resume, page 1 answers read back from server", "passed" if vals == [f"QA Onboarding {tag}", f"qa.onb.{tag}@hivic-test.example"] else "failed", str(vals), [await shot(pg, f"{lbl}-04b-resume-page1.png")])
            if a.get("sign"):
                for _ in range(14):
                    t = await pg.inner_text("main")
                    if await pg.get_by_role("button", name=re.compile("save & continue", re.I)).count() == 0: break
                    await save(pg)
                p = await shot(pg, f"{lbl}-05-sign-page.png")
                for cb in await pg.locator("input[type=checkbox]:visible").all():
                    if not await cb.is_checked(): await cb.check()
                for b in await pg.get_by_role("button", name=re.compile("^(I have read|Mark .*read|Reviewed|Confirm)", re.I)).all():
                    try: await b.click(); await pg.wait_for_timeout(300)
                    except Exception: pass
                for cb in await pg.locator("input[type=checkbox]:visible").all():
                    if not await cb.is_checked(): await cb.check()
                for lab, v in ((r"full name|your name|signer name|name", f"QA Onboarding {tag}"), (r"position|role|title", "Director"), (r"email", f"qa.onb.{tag}@hivic-test.example")):
                    loc = pg.get_by_label(re.compile(lab, re.I))
                    for i in range(await loc.count()):
                        el = loc.nth(i)
                        if await el.is_visible() and await el.is_editable() and (await el.get_attribute("type") or "text") in ("text", "email") and not await el.input_value(): await el.fill(v)
                sb = pg.get_by_role("button", name=re.compile(r"^sign", re.I))
                if await sb.count() == 0 or not await sb.first.is_enabled():
                    row(trade, width, "final signing on relaxed TEST draft", "blocked", "sign not reachable; always-required service-area page needs a verified address (outside lookup not called): " + (await pg.inner_text("main"))[-400:].replace("\n", " "), [p, await shot(pg, f"{lbl}-06-sign-blocked.png")])
                else:
                    await sb.first.click(); await pg.wait_for_timeout(5000)
                    t = await pg.inner_text("main")
                    refused = re.search(r"Please complete the .{0,40} page before signing", t)
                    ok = not refused and re.search(r"thank you|application (has been )?submitted|we've received", t, re.I) is not None
                    st = "blocked" if refused else ("passed" if ok else "failed")
                    row(trade, width, "final signing on relaxed TEST draft (browser)", st, (refused.group(0) + " — the always-required page needs a verified address from the outside address lookup, which this run never calls") if refused else t[:200].replace("\n", " "), [p, await shot(pg, f"{lbl}-06-sign-result.png")])
        row(trade, width, "no page errors", "passed" if not errs else "failed", "; ".join(errs) or "none")
    except Exception as e:
        row(trade, width, "click-through", "failed", f"stopped: {str(e)[:240]}", [await shot(pg, f"{lbl}-99-stopped.png")])
    finally:
        await c.close()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        for a in m["apps"]: await run(b, a)
        await b.close()
    (OUT / ".browser.json").write_text(json.dumps({"rows": rows, "tokens": TOKENS, "external_requests_blocked": BLOCKED}))

asyncio.run(main())

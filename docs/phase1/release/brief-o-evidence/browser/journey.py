"""Brief O — integrated real-browser journey for the Ready Check delivery path.

Runs against the local Vite dev server (:8080) and the disposable Supabase stack (:54331).
Phases are separate processes so a failure can be diagnosed without replaying the whole journey:

  owner          A. the homeowner picks 3 times on the real estimate link, incl. invalid input
  office_send    B. Office reviews the trade and sends the Ready Check offer
  offer          C. the installer sees the offer, address withheld
  accept         D. the installer accepts a time and gains access
  installer_rc   E. the installer completes the native Ready Check, uploads real evidence, submits
  office_review  F. Office sees the submission, the evidence and the next action
  security       negative / cross-business checks

Results append to results-<run>.json, screenshots to shots-<run>/.
"""
import asyncio, sys, json
from pathlib import Path
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
PREP = json.loads(Path("/tmp/brief-o-browser/prep.json").read_text())
JOB = PREP["jobId"]
JOB_NO = PREP["jobNumber"]
PW = "BriefN-Test-Pass-1"
RUN = sys.argv[1] if len(sys.argv) > 1 else "1"
PHASE = sys.argv[2]
OUT = Path(f"/tmp/brief-o-browser/shots-{RUN}")
OUT.mkdir(parents=True, exist_ok=True)
RESULTS = Path(f"/tmp/brief-o-browser/results-{RUN}.json")
TOKEN = Path("/tmp/brief-o-browser/token.txt").read_text().strip()
# Synthetic property point; the browser reports this as the device location.
LAT, LNG = -37.8183, 144.9986


def rec(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name + " | " + str(info)[:240], flush=True)
    data = json.loads(RESULTS.read_text()) if RESULTS.exists() else []
    data.append({"phase": PHASE, "name": name, "ok": bool(ok), "info": str(info)[:400]})
    RESULTS.write_text(json.dumps(data, indent=1))


async def signin(p, email):
    await p.goto(BASE + "/portal")
    await p.wait_for_selector("#e", timeout=30000)
    await p.fill("#e", email)
    await p.fill("#p", PW)
    await p.get_by_role("button", name="Sign in", exact=True).click()
    await p.wait_for_timeout(6000)


async def open_rc_panel(p):
    await p.goto(BASE + f"/admin/jobs/{JOB}")
    await p.wait_for_timeout(5000)
    await p.get_by_role("button", name="Ready Check", exact=False).first.click()
    await p.wait_for_timeout(2500)


def day_buttons(p):
    return p.locator("[data-testid=ready-check-times] button")


async def phase_owner(b):
    c = await b.new_context(viewport={"width": 900, "height": 1400})
    p = await c.new_page()
    await p.goto(f"{BASE}/estimate/{TOKEN}")
    await p.wait_for_timeout(5000)
    body = await p.locator("body").inner_text()
    rec("A1 the homeowner's secure link opens their own estimate",
        JOB_NO in body and "LIKELY ELIGIBLE" in body, p.url)
    await p.get_by_role("button", name="BOOK MY READY CHECK", exact=False).click()
    await p.wait_for_timeout(3000)
    rec("A2 the Ready Check time picker is offered", await p.locator("[data-testid=ready-check-times]").count() == 1, "")

    cta = p.get_by_role("button", name="Confirm my free measure-up", exact=False)
    ack = p.locator("input[type=checkbox]").first
    await ack.check()
    await p.wait_for_timeout(300)

    btns = day_buttons(p)
    # Invalid input 1: two times only — below the minimum of three.
    await btns.nth(1).click()
    await btns.nth(5).click()
    await p.wait_for_timeout(400)
    rec("A3 two times is rejected — the request cannot be sent", await cta.is_disabled(), "")
    # Invalid input 2: a third time on a day already used — still only two different days.
    await btns.nth(2).click()
    await p.wait_for_timeout(400)
    hint = await p.locator("[data-testid=ready-check-times]").inner_text()
    rec("A4 a third time on an already-used day is still rejected (needs 3 different days)",
        await cta.is_disabled(), hint.splitlines()[-1] if hint else "")
    # Valid input: three times across three different days.
    await btns.nth(8).click()
    await p.wait_for_timeout(400)
    rec("A5 three times on three different days enables the request", not await cta.is_disabled(), "")
    await p.screenshot(path=str(OUT / "A2-owner-picked.png"), full_page=True)
    await cta.click()
    await p.wait_for_timeout(6000)
    ok = await p.locator("[data-testid=ready-check-success]").count() == 1
    success = await p.locator("body").inner_text()
    rec("A6 the homeowner sees a confirmation of the request", ok and "received your request" in success.lower(), "")
    rec("A7 the homeowner is told what happens next", "installer" in success.lower(), "")
    await p.screenshot(path=str(OUT / "A3-owner-confirmed.png"), full_page=True)
    await c.close()


async def phase_office_send(b):
    c = await b.new_context(viewport={"width": 1400, "height": 1000})
    p = await c.new_page()
    await signin(p, "office@brief-n.test")
    await open_rc_panel(p)
    panel = p.locator("#choose-trade")
    rec("B1 Office sees the owner's times as the reason to dispatch", await panel.count() == 1, "")
    text = await panel.inner_text()
    rec("B2 installer A is a matching approved trade", "Brief N Installers A" in text, "")
    await panel.get_by_role("checkbox", name="Choose Brief N Installers A").check()
    await p.wait_for_timeout(400)
    btn = panel.get_by_role("button", name="Send offer to 1 trade")
    rec("B3 the send button counts only the ticked trade", await btn.count() == 1, "")
    await btn.click()
    await p.wait_for_timeout(4500)
    after = await panel.inner_text()
    rec("B4 the offer is recorded against installer A", "Already offered · pending" in after, "")
    await p.screenshot(path=str(OUT / "B-office-sent.png"), full_page=True)
    await c.close()


async def phase_offer(b):
    c = await b.new_context(viewport={"width": 420, "height": 900})
    p = await c.new_page()
    await signin(p, "installer-a@brief-n.test")
    rec("C1 installer sign-in lands on My work", p.url.endswith("/field"), p.url)
    body = await p.locator("body").inner_text()
    rec("C2 the Ready Check offer appears on the installer's phone", "Ready Check in Richmond" in body, "")
    href = await p.get_by_role("link", name="View offer").first.get_attribute("href")
    await p.goto(BASE + href)
    await p.wait_for_timeout(4000)
    offer = await p.locator("body").inner_text()
    rec("C3 the owner's three times are offered", offer.count("–") >= 3, "")
    rec("C4 the address is withheld until the installer accepts",
        "Address shows once you accept" in offer and "1 Brief N Street" not in offer, "")
    await p.screenshot(path=str(OUT / "C-offer.png"), full_page=True)
    await c.close()


async def phase_accept(b):
    c = await b.new_context(viewport={"width": 420, "height": 900})
    p = await c.new_page()
    await signin(p, "installer-a@brief-n.test")
    href = await p.get_by_role("link", name="View offer").first.get_attribute("href")
    await p.goto(BASE + href)
    await p.wait_for_timeout(3500)
    times = p.locator("button[aria-pressed], button").filter(has_text="–")
    await times.first.click()
    await p.wait_for_timeout(6000)
    after = await p.locator("body").inner_text()
    rec("D1 taking a time accepts the offer", "Job accepted" in after, "")
    rec("D2 the address and phone are released only after acceptance",
        "1 Brief N Street" in after, "")
    await p.screenshot(path=str(OUT / "D-accepted.png"), full_page=True)
    await c.close()


async def fill_rc(p):
    """Complete every required Ready Check answer through the rendered form."""
    async def text(key, value):
        await p.locator(f'[data-rc-field="{key}"] input').fill(value)

    async def pick(key, value):
        # Option values are the canonical answer keys; the visible labels are prettified.
        await p.locator(f'[data-rc-field="{key}"] select').select_option(value=value)

    await text("attendance.attended_at", "2026-10-17T09:30")
    await text("measure.eligible_area_m2", "118")
    await pick("measure.method", "laser")
    await pick("insulation.existing", "none")
    await pick("removal.required", "no")
    await pick("access.level", "standard")
    await text("elec.downlight_count", "6")
    await pick("elec.downlight_type", "led")


async def upload(p, label, path):
    """Drive the real evidence row: hidden file input -> signed upload -> confirmation."""
    row = p.locator(
        f"xpath=//div[contains(text(),\"{label}\")]/ancestor::div[contains(@class,'rounded-lg')][1]")
    await row.locator("input[type=file]").set_input_files(path)
    for _ in range(40):
        await p.wait_for_timeout(500)
        if "Upload confirmed" in await row.inner_text():
            return True
    return False


async def phase_installer_rc(b):
    c = await b.new_context(viewport={"width": 420, "height": 1000},
                            geolocation={"latitude": LAT, "longitude": LNG, "accuracy": 10},
                            permissions=["geolocation"])
    p = await c.new_page()
    await signin(p, "installer-a@brief-n.test")
    await p.goto(BASE + f"/field/day/{JOB}")
    await p.wait_for_timeout(4000)
    # The pre-start checks are the product's own gate: pricing acknowledgement plus three phone checks.
    cb = p.get_by_role("checkbox")
    if await cb.count():
        await cb.first.check()
        await p.wait_for_timeout(300)
    for label in ["Location on for your camera", "Battery over 50%", "Onsite form open on this job"]:
        await p.get_by_role("button", name=label, exact=False).first.click()
        await p.wait_for_timeout(300)
    await p.get_by_role("button", name="Start Ready Check", exact=False).first.click()
    await p.wait_for_timeout(4000)
    day = await p.locator("body").inner_text()
    rec("E1 the day page now offers the portal's Ready Check form instead of a dead end",
        await p.locator("[data-open-native-rc]").count() == 1 and "being set up" not in day, "")
    await p.locator("[data-open-native-rc]").click()
    await p.wait_for_timeout(5000)
    rec("E2 the native Ready Check form opens on the assigned job",
        await p.locator("[data-rc-draft]").count() == 1 and JOB in p.url, p.url)
    await p.screenshot(path=str(OUT / "E1-rc-form.png"), full_page=True)

    submit = p.locator("[data-rc-submit]")
    rec("E3 an empty form cannot be submitted", await submit.is_disabled(), "")
    outstanding = await p.locator("[data-rc-outstanding]").inner_text()
    low = outstanding.lower()
    rec("E4 the form names the missing answers and the missing photo",
        "answers still needed" in low and "photos or videos still needed" in low,
        outstanding.replace("\n", " ")[:160])

    await fill_rc(p)
    await p.wait_for_timeout(400)
    await p.get_by_role("button", name="Save Ready Check", exact=False).click()
    await p.wait_for_timeout(4000)
    saved = await p.locator("[data-rc-save-msg]").inner_text()
    rec("E5 progress saves without submitting", "Saved" in saved and "nothing has been submitted" in saved, saved)
    rec("E6 a saved draft is still not submittable while evidence is missing", await submit.is_disabled(), "")

    ok1 = await upload(p, "Ceiling measurement evidence", "/tmp/brief-o-browser/evidence-ceiling.jpg")
    rec("E7 a real photo uploads to private storage and is confirmed", ok1, "")
    ok2 = await upload(p, "Existing insulation / R-value evidence", "/tmp/brief-o-browser/evidence-insulation.jpg")
    rec("E8 the second required Ready Check photo is confirmed", ok2, "")
    await p.screenshot(path=str(OUT / "E2-rc-evidence.png"), full_page=True)

    await p.wait_for_timeout(1500)
    rec("E9 with answers and evidence complete the form can be submitted", not await submit.is_disabled(), "")
    await submit.click()
    await p.wait_for_timeout(6000)
    after = await p.locator("body").inner_text()
    rec("E10 the installer sees the submitted state", "Submitted to Home Insulation Victoria" in after, "")
    rec("E11 a submitted Ready Check can no longer be edited",
        await p.locator("[data-rc-submit]").count() == 0 and await p.locator('[data-rc-status="submitted"]').count() == 1, "")
    await p.screenshot(path=str(OUT / "E3-rc-submitted.png"), full_page=True)
    await c.close()


async def phase_office_review(b):
    c = await b.new_context(viewport={"width": 1400, "height": 1000})
    p = await c.new_page()
    await signin(p, "office@brief-n.test")
    await open_rc_panel(p)
    body = await p.locator("body").inner_text()
    rec("F1 Office sees the Ready Check as submitted", "Ready Check status: Submitted" in body, "")
    rec("F2 Office can now reopen it if the installer must correct something",
        await p.locator("[data-rc-reopen-open]").is_enabled(), "")
    rec("F3 the transition hint no longer claims everything is done",
        "Nothing blocking the move to" not in body and "Stage checks only" in body, "")
    rec("F4 Office can tell workflow availability from Ready Check completion",
        "Ready Check: submitted by the installer" in body, "")
    await p.screenshot(path=str(OUT / "F-office-after.png"), full_page=True)
    # The office opens the evidence the installer uploaded.
    # Assessment-gate evidence is reviewed in the office's "Evidence & AP review" record group.
    await p.goto(BASE + f"/admin/jobs/{JOB}?section=ap_veec")
    await p.wait_for_timeout(5000)
    # The evidence row lists the uploaded file by name; opening it goes through getEvidenceUrl (RLS-checked).
    filebtn = p.get_by_role("button", name="evidence-ceiling", exact=False).first
    rec("F5 Office can see the installer's uploaded evidence on the job", await filebtn.count() == 1, "")
    await filebtn.click()
    await p.wait_for_timeout(3000)
    body2 = await p.locator("body").inner_text()
    rec("F6 Office can open the installer's evidence file", "could not be opened" not in body2, "")
    Path(f"/tmp/brief-o-browser/office-after-{RUN}.txt").write_text(body)
    await c.close()


async def phase_security(b):
    c = await b.new_context(viewport={"width": 1200, "height": 900})
    p = await c.new_page()
    await p.goto(BASE + f"/admin/jobs/{JOB}")
    await p.wait_for_timeout(5000)
    body = await p.locator("body").inner_text()
    rec("N1 signed out cannot read the office job page",
        await p.locator("#e").count() == 1 and JOB_NO not in body, p.url)
    await c.close()

    c = await b.new_context(viewport={"width": 420, "height": 900})
    q = await c.new_page()
    await signin(q, "installer-b@brief-n.test")
    home = await q.locator("body").inner_text()
    rec("N2 the other business never sees this job or its offer",
        "Ready Check in Richmond" not in home and JOB_NO not in home, q.url)
    await q.goto(BASE + f"/field/{JOB}")
    await q.wait_for_timeout(4000)
    denied = await q.locator("body").inner_text()
    rec("N3 the other business cannot open the job page", JOB_NO not in denied, "")
    await q.screenshot(path=str(OUT / "N-installer-b.png"), full_page=True)
    await c.close()


PHASES = {
    "owner": phase_owner, "office_send": phase_office_send, "offer": phase_offer,
    "accept": phase_accept, "installer_rc": phase_installer_rc,
    "office_review": phase_office_review, "security": phase_security,
}


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(headless=True, channel="chrome")
        await PHASES[PHASE](b)
        await b.close()

asyncio.run(main())

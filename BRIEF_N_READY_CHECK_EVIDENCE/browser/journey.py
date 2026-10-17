"""Brief N — real-browser verification of the Ready Check success path (phases).

Runs against the local Vite dev server (:8080) and the disposable Supabase stack (:54331).
Phase "send"   : Office signs in, opens the job, expands the Ready Check panel, picks installer A, sends the offer.
Phase "accept" : Installer A signs in, opens the offer, checks the address is hidden, takes the owner's first time.
Phase "review" : Office re-opens the job and reads the Ready Check / next-step state after submission.
Results are appended to results-<run>.json and screenshots to shots-<run>/.
"""
import asyncio, sys, json
from pathlib import Path
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
JOB = "fa300000-0000-4000-8000-000000000001"
PW = "BriefN-Test-Pass-1"
RUN = sys.argv[1] if len(sys.argv) > 1 else "1"
PHASE = sys.argv[2]
OUT = Path(f"/tmp/brief-n-browser/shots-{RUN}")
OUT.mkdir(parents=True, exist_ok=True)
RESULTS = Path(f"/tmp/brief-n-browser/results-{RUN}.json")

CHROME = "chrome"

def rec(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name + " | " + str(info)[:220], flush=True)
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

async def phase_send(b):
    c = await b.new_context(viewport={"width": 1400, "height": 1000})
    p = await c.new_page()
    await signin(p, "office@brief-n.test")
    rec("B1 Office password sign-in lands in the operations app", "/admin" in p.url, p.url)
    await open_rc_panel(p)
    panel = p.locator("#choose-trade")
    rec("B2 the job page offers 'Choose trades for this job' for the Ready Check", await panel.count() == 1, "")
    text = await panel.inner_text()
    rec("B3 installer A is a matching approved trade and can be ticked",
        "Brief N Installers A" in text and await panel.get_by_role("checkbox", name="Choose Brief N Installers A").is_disabled() is False, "")
    await panel.get_by_role("checkbox", name="Choose Brief N Installers A").check()
    await p.wait_for_timeout(400)
    btn = panel.get_by_role("button", name="Send offer to 1 trade")
    rec("B4 the send button counts only the ticked trade", await btn.count() == 1, "")
    await btn.click()
    await p.wait_for_timeout(4000)
    await p.screenshot(path=str(OUT / "B-office-sent.png"), full_page=True)
    after = await panel.inner_text()
    rec("B5 the offer is recorded against installer A ('Already offered · pending')",
        "Brief N Installers A" in after and "Already offered · pending" in after, "")
    # installer B must still be tickable — only A was offered
    bcb = panel.get_by_role("checkbox", name="Choose Brief N Installers B")
    rec("B6 installer B was NOT offered", await bcb.is_disabled() is False, "")
    await c.close()

async def phase_accept(b):
    c = await b.new_context(viewport={"width": 420, "height": 900})
    p = await c.new_page()
    await signin(p, "installer-a@brief-n.test")
    rec("C1 Installer password sign-in lands on My work", p.url.endswith("/field"), p.url)
    body = await p.locator("body").inner_text()
    rec("C2 the Ready Check offer appears on the installer's phone", "Ready Check in Richmond" in body, "")
    link = p.get_by_role("link", name="View offer").first
    href = await link.get_attribute("href")
    await p.goto(BASE + href)
    await p.wait_for_timeout(4000)
    await p.screenshot(path=str(OUT / "C-offer.png"), full_page=True)
    offer = await p.locator("body").inner_text()
    rec("C3 the offer shows the owner's three times",
        offer.count("–") >= 3 and ("10am–12" in offer or "12–2pm" in offer or "8–10am" in offer), "")
    rec("C4 the address is withheld until the installer accepts", "Address shows once you accept" in offer
        and "1 Brief N Street" not in offer, "")
    first = p.get_by_role("button", name="TUE 20", exact=False).first
    await first.click()
    await p.wait_for_timeout(5000)
    await p.screenshot(path=str(OUT / "D-accepted.png"), full_page=True)
    after = await p.locator("body").inner_text()
    rec("D1 taking a time accepts the offer", "Job accepted" in after, "")
    rec("D2 the accepted time is confirmed to the installer", "Booked" in after and "10am–12" in after, "")
    rec("D3 the owner's address and phone are released only now",
        "1 Brief N Street" in after and ("Call owner" in after), "")
    await c.close()

async def office_state(b, shot, label):
    c = await b.new_context(viewport={"width": 1400, "height": 1000})
    p = await c.new_page()
    await signin(p, "office@brief-n.test")
    await open_rc_panel(p)
    await p.screenshot(path=str(OUT / shot), full_page=True)
    body = await p.locator("body").inner_text()
    Path(f"/tmp/brief-n-browser/{label}-{RUN}.txt").write_text(body)
    await c.close()
    return body

async def phase_booked(b):
    body = await office_state(b, "E1-office-booked.png", "office-booked")
    rec("F1 Office sees the accepted offer against installer A", "Already offered · accepted" in body, "")
    rec("F2 the assigned installer is named on the job", "Installer Brief N Installer A" in body, "")
    rec("F3 the Ready Check has not been submitted yet", "Ready Check status: Not started" in body, "")
    rec("F4 the office cannot reopen before a submission exists",
        "Reopening is only available once the installer has submitted" in body, "")

async def phase_review(b):
    body = await office_state(b, "F-office-after.png", "office-after")
    rec("F5 Office sees the Ready Check as submitted", "Ready Check status: Submitted" in body, "")
    rec("F6 the reopen control is now offered to the office", "Reopen Ready Check" in body, "")
    print("---- OFFICE BODY (first 1800) ----")
    print(body[:1800])


async def phase_security(b):
    # 1. Signed out: the office job page must ask for a sign-in, not render job data.
    c = await b.new_context(viewport={"width": 1200, "height": 900})
    p = await c.new_page()
    await p.goto(BASE + f"/admin/jobs/{JOB}")
    await p.wait_for_timeout(5000)
    body = await p.locator("body").inner_text()
    await p.screenshot(path=str(OUT / "N1-signed-out.png"), full_page=True)
    rec("N1 signed out cannot read the office job page",
        await p.locator("#e").count() == 1 and "BRIEF-N-FLOW-1" not in body, p.url)
    await c.close()
    # 2. The other installer business never sees this job or its offer.
    c = await b.new_context(viewport={"width": 420, "height": 900})
    q = await c.new_page()
    await signin(q, "installer-b@brief-n.test")
    home = await q.locator("body").inner_text()
    await q.screenshot(path=str(OUT / "N2-installer-b.png"), full_page=True)
    rec("N2 installer B has no Ready Check offer for this job",
        "Ready Check in Richmond" not in home and "BRIEF-N-FLOW-1" not in home, q.url)
    await q.goto(BASE + f"/field/{JOB}")
    await q.wait_for_timeout(4000)
    denied = await q.locator("body").inner_text()
    await q.screenshot(path=str(OUT / "N3-installer-b-job.png"), full_page=True)
    rec("N3 installer B cannot open the job page", "BRIEF-N-FLOW-1" not in denied, q.url + " | " + denied[:80].replace("\n", " "))
    await c.close()

PHASES = {"send": phase_send, "accept": phase_accept, "booked": phase_booked, "review": phase_review, "security": phase_security}

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(headless=True, channel=CHROME)
        PHASES[PHASE] and await PHASES[PHASE](b)
        await b.close()

asyncio.run(main())

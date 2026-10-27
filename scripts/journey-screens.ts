// Browser-first proof entrypoint. Does NOT call runServerJourney or prepare TEST trades.
// A preflight refusal is recorded before any unsafe UI mutation, never bypassed to reach later steps.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { SCREEN_PEOPLE, SCREEN_STEPS, screenMutationBlocker, screenTotals, type ScreenRow } from "./journey-screens.core";

const removed: string[] = [];
for (const key of Object.keys(process.env)) if (/RESEND|TWILIO|SMS.*(?:KEY|TOKEN)|EMAIL.*(?:KEY|TOKEN)|SMTP|SENDGRID|MAILGUN|POSTMARK|CUSTOMER_EMAIL|DELIVERY.*(?:KEY|SECRET)/i.test(key)) { delete process.env[key]; removed.push(key); }
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const temp = `/tmp/browser/journey-screens-${stamp}`;
const out = `/mnt/documents/journey/${stamp}-screens`;
mkdirSync(temp, { recursive: true }); mkdirSync(`${out}/screenshots`, { recursive: true });
const python = String.raw`
import asyncio, json, re, sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.async_api import async_playwright
async def main():
    out = Path(sys.argv[1]); results = []; refused = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width":390,"height":844})
        async def guard(route):
            r = route.request; u = urlsplit(r.url)
            # Read-only browser reconnaissance only: no POST, no external services, no token/signed URL logging.
            if r.method not in ("GET","HEAD") or (u.hostname not in ("localhost", "127.0.0.1")):
                refused.append({"method":r.method,"kind":r.resource_type}); await route.abort(); return
            await route.continue_()
        await context.route("**/*", guard)
        page = await context.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append(str(e)[:160]))
        await page.goto("http://localhost:8080/calculator", wait_until="domcontentloaded")
        await page.get_by_role("button", name="Register my interest", exact=True).first.wait_for(state="visible",timeout=20000)
        await page.screenshot(path=str(out / "01-homeowner-calculator.png"))
        # This real button only scrolls. Do not submit: source is not qa_test and no job is created here.
        await page.get_by_role("button", name="Register my interest", exact=True).first.click()
        form=page.locator("#register-interest"); await form.wait_for(state="visible")
        await form.scroll_into_view_if_needed()
        await page.screenshot(path=str(out / "02-homeowner-registration.png"))
        results.append({"name":"Calculator navigation","clicked":True,"loaded":await form.is_visible(),"path":urlsplit(page.url).path,"screenshots":["screenshots/01-homeowner-calculator.png","screenshots/02-homeowner-registration.png"],"errors":errors})
        await browser.close()
    (out / "browser-observations.json").write_text(json.dumps({"observations":results,"refusedRequests":refused},indent=2))
asyncio.run(main())
`;
writeFileSync(`${temp}/check_journey_screens.py`, python);
const browser = spawnSync("python3", [`${temp}/check_journey_screens.py`, out], { encoding: "utf8", timeout: 90_000 });
let observations: unknown = null;
try { observations = JSON.parse(readFileSync(`${out}/browser-observations.json`, "utf8")); } catch { observations = { error: "Browser reconnaissance failed; no workflow action was attempted.", exitCode: browser.status }; }
const blocker = screenMutationBlocker({ websiteSandbox: false, serverSendingKeysRemoved: false, serverMittiGuard: false, demoOnly: false, ownQaJob: false });
const rows: ScreenRow[] = SCREEN_STEPS.flatMap(step => SCREEN_PEOPLE.map(person => ({ step, person, status: "blocked", detail: step === "Website enquiry" ? blocker ?? "Website unavailable" : "Not executed: no safe website-created qa_test job; no downstream state was manufactured.", severity: null, screenshot: step === "Website enquiry" && person === "homeowner" && browser.status === 0 ? "screenshots/02-homeowner-registration.png" : null, database: null, emailRows: null })));
rows.push({ step: "Rule consistency: electrician payout", person: "electrician", status: "fail", detail: "Decision 410 requires 7 days after completed form approval without owner/HIV receipt waiting; electricianPayState still requires ownerPaidAt and uses the later completion/payment date. No rule or payout code changed to pass this check.", severity: "Stop launch", screenshot: null, database: null, emailRows: null });
rows.push({ step: "M: real Mitti guard", person: "safety", status: "blocked", detail: "Browser external requests were refused; zero Mitti forms created. The running portal's server-side simulated-Mitti guard is not verified, so workflow mutations were not attempted. Zero requests alone is not a tested guard PASS.", severity: null, screenshot: null, database: null, emailRows: null });
const totals = screenTotals(rows);
const report = { mode: "screens", startedAt: stamp, completedAllClearJourney: false, jobNumber: null, createdJobs: [], archivedJobs: [], protectedJobsUntouched: ["HV-3274", "HV-3239"], sendingKeysRemovedFromCommand: true, sendingKeyCountRemoved: removed.length, serverProcessKeysRemoved: "unverified", ruleChanges: false, switchesChanged: false, published: false, realMittiFormsCreated: 0, xeroInvoicesCreated: 0, screenshotsViewport: { width: 390, height: 844 }, totals, rows, observations,
  blockers: [blocker, "The legacy journey office identity admin@hivic.test is not on the required hivic-test.example domain; a suitable existing TEST-domain office persona must be verified.", "The command's process guard does not cover HTTP handlers in the already-running preview process. No unsafe browser mutation was attempted.", "Current TEST partners are paused; the existing preparation helper enables offer flags, which this no-switch-change proof must not call."] };
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
writeFileSync(`${out}/report.md`, ["# Full journey proof — Phases 1 and 2", "", "**BLOCKED: the all-clear screen journey was not completed.**", "", `PASS ${totals.pass} · FAIL ${totals.fail} · BLOCKED ${totals.blocked}`, "", "No TEST job created; no archive action required. HV-3274 and HV-3239 untouched. No email, invoice, Mitti form, switch change or publication.", "", "## Preflight blockers", ...report.blockers.map(b => `- ${b}`), "", "## Failures", "- **Stop launch:** current electrician payout code disagrees with decision 410. This was not changed to make the journey pass.", "", "## Browser observations (not workflow PASS)", browser.status === 0 ? "Opened the current calculator at 390px and clicked its real Register my interest scroll button. The visible registration saves calculator interest, not a qa_test job or Base44 enquiry. Submission deliberately not attempted." : "Browser reconnaissance failed; see browser-observations.json.", "", "## Step × person", "| Step | Person | Result | Evidence / reason |", "|---|---|---|---|", ...rows.map(r => `| ${r.step} | ${r.person} | ${r.status.toUpperCase()} | ${r.detail.replace(/\|/g, "\\|")} |`), "", "Database stage/events and email counts are **unverified/null**, not zero or passed, because no job reached these steps. Other roles' home screens were not impersonated with unsafe credentials or unrelated jobs. No snapshot is substituted for an unexecuted action.", "", "## Screenshots", ...(browser.status === 0 ? ["- screenshots/01-homeowner-calculator.png", "- screenshots/02-homeowner-registration.png"] : []), "", "## Deferred", "Phases 3 and 4 not run. A verified isolated website-to-preview boundary and server-wide provider guard are needed before extending the interactive route through acceptance, simulated onsite forms, Demo payments and payout.", ""].join("\n"));
console.log(`Screens journey: ${totals.pass} pass, ${totals.fail} fail, ${totals.blocked} blocked. No jobs created. Report: ${out}/report.md`);
process.exitCode = 1;
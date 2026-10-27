// Browser-first proof. Never manufacture downstream state or enable paused partners.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { SCREEN_PEOPLE, SCREEN_STEPS, screenTotals, type ScreenRow } from "./journey-screens.core";
const removed: string[] = [];
for (const key of Object.keys(process.env)) if (/RESEND|TWILIO|SMS.*(?:KEY|TOKEN)|EMAIL.*(?:KEY|TOKEN)|SMTP|SENDGRID|MAILGUN|POSTMARK|CUSTOMER_EMAIL|DELIVERY.*(?:KEY|SECRET)/i.test(key)) { delete process.env[key]; removed.push(key); }
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const temp = `/tmp/browser/journey-screens-${stamp}`;
const out = `/mnt/documents/journey/${stamp}-screens`;
mkdirSync(temp, { recursive: true }); mkdirSync(`${out}/screenshots`, { recursive: true });
const python = String.raw`
import asyncio,json,re,sys,os,hmac,hashlib,time
from pathlib import Path
from urllib.parse import urlsplit
from playwright.async_api import async_playwright
async def main():
 out=Path(sys.argv[1]); result={"safety":None,"job":None,"errors":[],"refusedRequests":[],"screenshots":[]}
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True)
  context=await browser.new_context(viewport={"width":390,"height":844})
  async def guard(route):
   req=route.request; u=urlsplit(req.url)
   if u.hostname not in ("localhost","127.0.0.1"):
    static=req.method=="GET" and req.resource_type in ("image","stylesheet","font")
    if not static: result["refusedRequests"].append({"method":req.method,"kind":req.resource_type});await route.abort();return
    await route.continue_();return
   headers=await req.all_headers();stamp=str(int(time.time()*1000))
   sig=hmac.new(os.environ["LOVABLE_API_KEY"].encode(),('journey-preview-only\n'+stamp+'\n'+u.path).encode(),hashlib.sha256).hexdigest()
   headers.update({"x-hivic-qa-time":stamp,"x-hivic-qa-signature":sig})
   await route.continue_(headers=headers)
  await context.route("**/*",guard)
  page=await context.new_page()
  page.on('pageerror',lambda e:result['errors'].append(str(e)[:200]))
  try:
   await page.goto('http://localhost:8080/calculator',wait_until='domcontentloaded')
   await page.get_by_role('button',name='Register my interest',exact=True).first.wait_for(timeout=30000)
   result['safety']=await page.evaluate("async()=>{const m=await import('/src/lib/interest.functions.ts');return await m.previewJourneySafety()}")
   if not all(result['safety'].get(k) is True for k in ['qa','unattributedRefused','deliveryAdapterAbsent','demoConnected']):raise Exception('Running preview safety check failed; no submission')
   await page.get_by_role('button',name='Register my interest',exact=True).first.click()
   form=page.locator('#register-interest');await form.scroll_into_view_if_needed()
   await form.get_by_role('button',name='Change',exact=True).click()
   await page.locator('#register-address').fill('9999 Journey '+str(int(time.time()))+' Street, Frankston VIC 3199')
   await form.get_by_role('button',name='Done',exact=True).click()
   await page.locator('#calc-area').fill('150')
   await page.locator('#ri-name').fill('TEST Journey Owner')
   await page.locator('#ri-mobile').fill('0400000000')
   await page.locator('#ri-email').fill('qa.screens.'+str(int(time.time()))+'@hivic-test.example')
   await form.locator('input[type=checkbox]').check()
   await form.screenshot(path=str(out/'screenshots/01-website-enquiry-filled.png'));result['screenshots'].append('screenshots/01-website-enquiry-filled.png')
   async def observe(resp):
    if resp.request.method=='POST' and urlsplit(resp.url).hostname=='localhost':
     try:
      text=await resp.text()
      ids=re.findall(r'"qaJobId"\s*:\s*"([a-f0-9-]{36})"',text);nums=re.findall(r'"qaJobNumber"\s*:\s*"(HV-\d+)"',text)
      if ids and nums:result['job']={'jobId':ids[0],'jobNumber':nums[0]}
     except:pass
   page.on('response',observe)
   await form.get_by_role('button',name='Register my interest',exact=True).click()
   await page.get_by_test_id('register-interest-done').wait_for(timeout=30000)
   await page.get_by_test_id('register-interest-done').screenshot(path=str(out/'screenshots/02-website-enquiry-saved.png'));result['screenshots'].append('screenshots/02-website-enquiry-saved.png')
   await page.wait_for_timeout(500)
  except Exception as e:result['errors'].append(str(e)[:300])
  finally:
   (out/'browser-observations.json').write_text(json.dumps(result,indent=2));await browser.close()
asyncio.run(main())
`;
writeFileSync(`${temp}/check_journey_screens.py`, python);
const browser = spawnSync("python3", [`${temp}/check_journey_screens.py`, out], { encoding: "utf8", timeout: 120_000 });
type Observation = { safety: { qa: boolean; unattributedRefused: boolean; deliveryAdapterAbsent: boolean; demoConnected: boolean } | null; job: { jobId: string; jobNumber: string } | null; errors: string[]; screenshots: string[]; refusedRequests: unknown[] };
let observed: Observation;
try { observed = JSON.parse(readFileSync(`${out}/browser-observations.json`, "utf8")); } catch { observed = { safety: null, job: null, errors: ["Browser proof did not produce results"], screenshots: [], refusedRequests: [] }; }
let database: unknown = null, emailRows: number | null = null, archived = false;
if (observed.job) {
 const { supabaseAdmin: admin } = await import("../src/integrations/supabase/client.server");
 const { data: job, error } = await admin.from("jobs").select("id,job_number,source,stage,owners(email)").eq("id", observed.job.jobId).single();
 const owner = job?.owners as { email?: string } | null;
 if (error || !job || job.source !== "qa_test" || job.job_number !== observed.job.jobNumber || !owner?.email?.endsWith("@hivic-test.example")) throw new Error("SAFETY STOP: own TEST job could not be verified; no cleanup of other jobs");
 const [{ data: events }, { data: comms }, { count }] = await Promise.all([
  admin.from("workflow_events").select("event_type,summary").eq("job_id", job.id),
  admin.from("job_communications").select("channel,delivery_status,provider_message_id").eq("job_id", job.id),
  admin.from("customer_email_sends").select("id", { count: "exact", head: true }).eq("job_id", job.id),
 ]);
 database = { job, events, communications: comms }; emailRows = count;
 const { error: archiveError } = await admin.from("jobs").update({ qa_archived_at: new Date().toISOString(), stage: "cancelled", cancelled_reason: "TEST screen journey archived", next_action: "Archived TEST journey" }).eq("id", job.id).eq("source", "qa_test").eq("job_number", observed.job.jobNumber);
 if (archiveError) throw new Error("TEST job archive failed");
 archived = true;
}
const rows: ScreenRow[] = SCREEN_STEPS.flatMap(step => SCREEN_PEOPLE.map(person => ({ step, person, status: step === "Website enquiry" && person === "homeowner" && observed.job ? "pass" : "blocked", detail: step === "Website enquiry" && person === "homeowner" && observed.job ? "Real phone form submitted with server-verified TEST signature; qa_test job read back." : "Not executed: no existing office actor on the required TEST domain; paused TEST trade flags cannot be changed. No downstream state manufactured.", severity: null, screenshot: step === "Website enquiry" && person === "homeowner" ? observed.screenshots.at(-1) ?? null : null, database: step === "Website enquiry" && person === "homeowner" ? database : null, emailRows: step === "Website enquiry" && person === "homeowner" ? emailRows : null })));
rows.push({ step: "M: unattributed real Mitti refusal", person: "safety", status: observed.safety?.unattributedRefused ? "pass" : "fail", detail: observed.safety?.unattributedRefused ? "Running preview refused user search in signed TEST request before Mitti network." : observed.errors.join("; "), severity: observed.safety?.unattributedRefused ? null : "Stop launch", screenshot: null, database: null, emailRows: null });
rows.push({ step: "Installation booking end time", person: "office", status: "fail", detail: "confirmBooking does not write scheduled_end; nullable column has no default/filling trigger. Real jobs can hit the ESC notice block. Zero real installation bookings currently exist.", severity: "Stop launch", screenshot: null, database: null, emailRows: null });
if (observed.errors.length) rows.push({ step: "Browser execution", person: "safety", status: "fail", detail: observed.errors.join("; "), severity: "Fix soon", screenshot: null, database: null, emailRows: null });
const totals = screenTotals(rows);
const report = { mode: "screens", completedAllClearJourney: false, totals, rows, observations: observed, createdJobs: observed.job ? [observed.job] : [], archivedJobs: archived ? [observed.job] : [], protectedJobsUntouched: ["HV-3274", "HV-3239"], sendingKeysRemovedFromCommand: true, removedKeyCount: removed.length, switchesChanged: false, published: false, realMittiFormsCreated: 0, xeroInvoicesCreated: 0, blockers: ["No existing office identity on hivic-test.example; no account/role changes authorised.", "TEST trades remain paused; no offer flag changes authorised.", "Full interactive downstream browser actions are not implemented; unexecuted steps remain blocked."] };
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
writeFileSync(`${out}/report.md`, ["# Phase 2 phone-screen proof", "", `PASS ${totals.pass} · FAIL ${totals.fail} · BLOCKED ${totals.blocked}`, "", observed.job ? `${observed.job.jobNumber}: ${archived ? "archived" : "NOT archived"}.` : "No job created; no cleanup required.", "Nothing sent or published; no switches changed; no real Mitti forms or Xero invoices created. HV-3274/HV-3239 untouched.", "", "## Failures", ...rows.filter(r => r.status === "fail").map(r => `- **${r.severity}**: ${r.detail}`), "", "## Blockers", ...report.blockers.map(x => `- ${x}`), "", "## Evidence", ...rows.map(r => `- ${r.step} / ${r.person}: ${r.status.toUpperCase()} — ${r.detail}`), "", ...observed.screenshots.map(s => `- ${s}`)].join("\n"));
console.log(`Phase 2: ${totals.pass} pass, ${totals.fail} fail, ${totals.blocked} blocked. Job: ${observed.job?.jobNumber ?? "none"}. Archived: ${archived}. Report: ${out}/report.md`);
process.exitCode = 1;

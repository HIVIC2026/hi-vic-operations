// Browser-first walk-through (Jo 27 Oct, 09:31). The website step is skipped (portal-qa covers the website form): the
// run starts from a fresh qa_test job made by the existing journey setup (s1_calculator, TEST-domain owner), probes the
// running preview's safeguards (b)–(d) for THAT job, then drives every later step through the real pages at 390px as
// the right TEST person. Failures are findings: every step is attempted or honestly marked BLOCKED / NOT RUN.
// Only the job this run created is archived; TEST trades are restored by cleanupJourney.
import { mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { acceptedTestEmail } from "./journey-email-evidence.core";

const removed: string[] = [];
for (const key of Object.keys(process.env)) if (/RESEND|TWILIO|SMS.*(?:KEY|TOKEN)|EMAIL.*(?:KEY|TOKEN)|SMTP|SENDGRID|MAILGUN|POSTMARK|CUSTOMER_EMAIL|DELIVERY.*(?:KEY|SECRET)|MITTI_API_TOKEN/i.test(key)) { delete process.env[key]; removed.push(key); }
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const temp = `/tmp/browser/journey-screens-${stamp}`;
const out = `/mnt/documents/journey/${stamp}-screens`;
mkdirSync(temp, { recursive: true }); mkdirSync(`${out}/screenshots`, { recursive: true });

type Status = "pass" | "fail" | "blocked" | "not_run" | "simulated" | "runner_error";
type Row = { step: string; person: string; status: Status; detail: string; severity: "Stop launch" | "Fix soon" | "Polish" | null; screenshot: string[]; stage: string | null; events: number | null; emailRows: number | null; nextVisible: boolean | null; leaks: string[] };
const rows: Row[] = [];
const add = (r: Partial<Row> & Pick<Row, "step" | "person" | "status" | "detail">) => rows.push({ severity: null, screenshot: [], stage: null, events: null, emailRows: null, nextVisible: null, leaks: [], ...r });

const J = await import("../src/lib/journey.server");
const { supabaseAdmin: admin } = await import("../src/integrations/supabase/client.server");
const ms = await import("../src/lib/mitti.server");
const installerEmail = "qa.installer.bravo@hivic-test.example";

// ---- setup: existing journey s1 (qa_test, TEST-domain owner), command process with real Mitti refused ----
ms.armJourneyMittiGuard(null);
let ctx: Awaited<ReturnType<typeof J.newJourneyCtx>> | null = null;
let setupError: string | null = null;
try {
  ctx = await J.newJourneyCtx({ installerEmail, preparePeople: false });
  ctx.notes["address_line"] = `${Date.now()} Journey Test Street`;
  const r = { key: "s1_calculator", label: "setup", passed: false, checks: [] as { name: string; ok: boolean; detail?: string }[] };
  await J.journeyInternals.s1(ctx, r as never);
  add({ step: "Setup: TEST job from journey s1 (website step skipped — covered by portal-qa)", person: "setup", status: "pass", detail: `${ctx.jobNumber} created as qa_test for a TEST-domain owner; ${r.checks.filter(c => c.ok).length} setup checks passed.` });
} catch (e) { setupError = e instanceof Error ? e.message : String(e); add({ step: "Setup: TEST job from journey s1", person: "setup", status: "fail", severity: "Stop launch", detail: setupError }); }
finally { ms.disarmJourneyMittiGuard(); }

async function jobState() {
  if (!ctx?.jobId) return { stage: null, events: null, emails: null };
  const [{ data: j }, { count: ev }, { count: em }] = await Promise.all([
    admin.from("jobs").select("stage").eq("id", ctx.jobId).single(),
    admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId),
    admin.from("customer_email_sends").select("id", { count: "exact", head: true }).eq("job_id", ctx.jobId),
  ]);
  return { stage: (j?.stage as string) ?? null, events: ev ?? 0, emails: em ?? 0 };
}

// ---- preflight (b)–(d) against THIS job ----
let safe = false;
if (ctx?.jobId) {
  const { data: sends } = await admin.from("customer_email_sends").select("status, provider_message_id").eq("job_id", ctx.jobId);
  const delivered = (sends ?? []).filter(s => s.provider_message_id || s.status === "sent");
  add({ step: "Preflight b: job messages held, not sent", person: "safety", status: delivered.length ? "fail" : "pass", severity: delivered.length ? "Stop launch" : null, detail: `${sends?.length ?? 0} email rows for the job; ${delivered.length} with a provider id or sent status.` });
  let net = 0; const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { net++; throw new Error("network refused in probe"); }) as never;
  let simOk = false, simDetail = "";
  try {
    const call = await ms.mittiCallFor(ms.realMittiCall, installerEmail);
    const users = await call("POST", "/users/search", { email: [installerEmail] }) as { id: string }[];
    const viaBoundary = await ms.realMittiCall("POST", "/users/search", { email: [installerEmail] }) as { id: string }[];
    simOk = net === 0 && !!users[0]?.id.startsWith("sim_") && !!viaBoundary[0]?.id.startsWith("sim_");
    simDetail = `TEST installer resolved to ${users[0]?.id ?? "nothing"}; ${net} network calls. Same source file the preview serves; the preview process itself is not separately instrumented.`;
  } catch (e) { simDetail = e instanceof Error ? e.message : String(e); }
  finally { globalThis.fetch = realFetch; }
  add({ step: "Preflight c: Mitti for this job goes to the simulator", person: "safety", status: simOk ? "pass" : "fail", severity: simOk ? null : "Stop launch", detail: simDetail });
  const xc = await import("../src/lib/xero.core");
  const { data: j } = await admin.from("jobs").select("source").eq("id", ctx.jobId).single();
  let demo = false; try { demo = /demo company/i.test(xc.pickXeroTenant([{ tenantId: "real", tenantName: "DC Construction Solutions" }, { tenantId: "demo", tenantName: "Demo Company (AU)" }] as never, j?.source === "qa_test" ? "test" : "live").tenantName ?? ""); } catch { demo = false; }
  add({ step: "Preflight d: Xero for this job resolves to Demo Company (AU)", person: "safety", status: demo ? "pass" : "fail", severity: demo ? null : "Stop launch", detail: `job source ${j?.source}; tenant chosen ${demo ? "Demo Company (AU)" : "not Demo"}.` });
  safe = rows.filter(r => r.step.startsWith("Preflight")).every(r => r.status === "pass");
}

// ---- browser steps ----
const ref = new URL(process.env["SUPABASE_URL"]!).hostname.split(".")[0];
const storageKey = `sb-${ref}-auth-token`;
const people: Record<string, string> = { office: "qa.office@hivic-test.example", "installer owner": installerEmail, electrician: J.TEST_ELECTRICIAN_EMAIL };
type Step = { step: string; person: string; path: () => string | null; wait: string; button?: string; scope?: Record<string, string>; expect?: () => Promise<string | null>; severity: Row["severity"]; next: string };
const offerId = async () => (await admin.from("partner_offers").select("id").eq("job_id", ctx!.jobId!).order("created_at", { ascending: false }).limit(1).maybeSingle()).data?.id as string | undefined;
const stageIs = (...s: string[]) => async () => { const st = (await jobState()).stage; return st && s.includes(st) ? null : `stage is ${st}, expected ${s.join(" or ")}`; };
let offer: string | undefined;
const STEPS: Step[] = [
  { step: "Save my spot", person: "homeowner", path: () => `/estimate/${ctx!.token}/campaign`, wait: "Save my spot", button: "Save my spot", severity: "Stop launch", next: "spot",
    expect: async () => (await admin.from("lead_campaign_responses").select("spot_saved_at").eq("job_id", ctx!.jobId!).maybeSingle()).data?.spot_saved_at ? null : "no saved spot recorded" },
  { step: "Office sees the job", person: "office", path: () => `/admin/jobs/${ctx!.jobId}`, wait: ctx?.jobNumber ?? "HV-", severity: "Stop launch", next: "Next" },
  { step: "Office release (Choose installer → Release)", person: "office", path: () => `/admin/jobs/${ctx!.jobId}`, wait: ctx?.jobNumber ?? "HV-", button: "Choose installer|Release", scope: { Release: "TEST Bravo Insulation" }, severity: "Stop launch", next: "Choose installer",
    expect: async () => (await admin.from("workflow_events").select("id").eq("job_id", ctx!.jobId!).eq("event_type", "spot_released").limit(1).maybeSingle()).data ? null : "no spot release recorded" },
  { step: "Owner confirms released spot", person: "homeowner", path: () => `/my-job/${ctx!.token}?screen=turn`, wait: "Ready Check", button: "Confirm my free Ready Check", severity: "Stop launch", next: "Ready Check", expect: async () => (offer = await offerId()) ? null : "no installer offer created after owner confirmation" },
  { step: "Installer acceptance", person: "installer owner", path: () => offer ? `/field/offer/${offer}` : null, wait: "Ready Check", button: "Accept this job", severity: "Stop launch", next: "Ready Check",
    expect: async () => (await admin.from("partner_offers").select("status").eq("id", offer!).single()).data?.status === "accepted" ? null : "offer not accepted" },
  { step: "Ready Check booking", person: "homeowner", path: () => `/my-job/${ctx!.token}`, wait: "Your progress", button: "Choose", severity: "Stop launch", next: "time", expect: stageIs("ready_check_booked") },
  { step: "Ready Check completion", person: "installer owner", path: () => `/field/day/${ctx!.jobId}`, wait: "Ready Check", severity: "Fix soon", next: "Mitti", expect: stageIs("ready_check_complete", "measured_estimate_ready", "quote_sent") },
];
const LATER = ["Office quote release", "Owner acceptance", "PIESA payment and booking", "PIESA completed form approval", "Install deposit and days", "Install day and evidence", "AP final check", "Final payout"];

const py = String.raw`
import asyncio, json, re, sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.async_api import async_playwright
async def main():
    cfg = json.loads(Path(sys.argv[1]).read_text()); out = Path(cfg["out"]); res = {"errors": [], "refused": []}
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        c = await b.new_context(viewport={"width":390,"height":844})
        async def guard(route):
            u = urlsplit(route.request.url)
            if u.hostname in ("localhost","127.0.0.1") or re.search(r"supabase\.co$", u.hostname or ""): await route.continue_(); return
            if route.request.resource_type in ("image","stylesheet","font") and not re.search(r"mitti|resend|twilio|xero|stripe", u.hostname or "", re.I): await route.continue_(); return
            res["refused"].append(route.request.method); await route.abort()
        await c.route("**/*", guard)
        page = await c.new_page(); page.on("pageerror", lambda e: res["errors"].append(str(e)[:160]))
        if cfg.get("session"):
            await page.goto("http://localhost:8080/auth", wait_until="domcontentloaded")
            await page.evaluate("([k,v]) => window.localStorage.setItem(k,v)", [cfg["key"], cfg["session"]])
        await page.goto("http://localhost:8080" + cfg["path"], wait_until="domcontentloaded")
        try: await page.get_by_text(re.compile(re.escape(cfg["wait"]), re.I)).first.wait_for(state="visible", timeout=25000); res["loaded"] = True
        except Exception: res["loaded"] = False
        await page.wait_for_timeout(800)
        s1 = f"screenshots/{cfg['n']:02d}-{cfg['slug']}-before.png"; await page.screenshot(path=str(out / s1)); res["shots"] = [s1]
        res["url"] = urlsplit(page.url).path
        text = await page.inner_text("body")
        res["next"] = bool(re.search(re.escape(cfg["next"]), text, re.I))
        res["leaks"] = [m for m in cfg.get("mustNot", []) if m and m.lower() in text.lower()]
        res["clicked"] = None
        async def find(name, scope):
            # Find a control the way a person would: its visible label, inside the card/row/item that shows the scope text, whatever the layout.
            rx = re.compile(re.escape(name), re.I)
            loc = page.get_by_role("button", name=rx).or_(page.get_by_role("link", name=rx))
            try: await loc.first.wait_for(state="visible", timeout=35000)
            except Exception: pass
            cands = [x for x in await loc.all() if await x.is_visible()]
            how = "role"
            if not cands:
                t = page.get_by_text(rx)
                cands = [x for x in await t.all() if await x.is_visible()]
                how = "text"
            if scope and cands:
                scored = []
                for x in cands:
                    d = await x.evaluate("(el, s) => { let n = el, d = 0; while (n && d < 12) { if ((n.innerText || '').includes(s)) return d; n = n.parentElement; d++; } return 99; }", scope)
                    scored.append((d, x))
                scored = [z for z in scored if z[0] < 99]; scored.sort(key=lambda z: z[0])
                cands = [z[1] for z in scored]
            return (cands[0] if cands else None), how
        res["runner_notes"] = []
        for i, name in enumerate([x for x in (cfg.get("button") or "").split("|") if x]):
            scope = (cfg.get("scope") or {}).get(name)
            if name == "Accept this job":
                form = page.locator("[data-ready-check-times-form]")
                if await form.count():
                    picked = 0
                    for day in await form.get_by_role("button").all():
                        if await day.is_enabled() and (await day.inner_text()) != "Accept this job":
                            await day.click(); picked += 1
                            if picked == 3: break
                    for select in await form.locator("select").all():
                        values = await select.locator("option").evaluate_all("xs => xs.map(x => x.value).filter(Boolean)")
                        if values: await select.select_option(values[0])
            el, how = await find(name, scope)
            label = name + (f" (in {scope})" if scope else "")
            if el is None:
                body = await page.inner_text("body")
                if re.search(re.escape(name), body, re.I): res["clicked"] = False; res["runner_error"] = f'"{label}" text is on screen but the runner could not locate a pressable control'
                else: res["clicked"] = False; res["missing"] = label
                break
            if how == "text": res["runner_notes"].append(f'"{label}" found by visible text, not as a button')
            if not await el.is_enabled(): res["clicked"] = False; res["missing"] = "enabled " + label; break
            try: await el.click(timeout=10000)
            except Exception as e: res["clicked"] = False; res["runner_error"] = f'"{label}" visible but click failed: {str(e)[:100]}'; break
            res["clicked"] = True
            try: await page.wait_for_load_state("networkidle", timeout=15000)
            except Exception: pass
            await page.wait_for_timeout(2000)
            s2 = f"screenshots/{cfg['n']:02d}-{cfg['slug']}-after{i+1}.png"; await page.screenshot(path=str(out / s2)); res["shots"].append(s2)
        await b.close()
    Path(cfg["result"]).write_text(json.dumps(res))
asyncio.run(main())
`;
writeFileSync(`${temp}/walk_step.py`, py);

const otherHomes = async (n: number, actor: string) => {
  // Other roles' home screens must not show this job's owner details before they are involved.
  const leaks: string[] = [];
  for (const [person, home] of [["electrician", "/field"]] as const) {
    if (person === actor) continue;
    const r = await browse({ n: 900 + n, slug: `home-${person.replace(/\s/g, "-")}`, path: home, wait: "", person, next: "", mustNot: [ctx!.ownerEmail, String(ctx!.notes["address_line"] ?? "")] });
    if (r?.leaks?.length) leaks.push(`${person} home shows ${r.leaks.length} owner detail(s)`);
  }
  return leaks;
};

async function browse(o: { n: number; slug: string; path: string; wait: string; button?: string; scope?: Record<string, string>; person: string; next: string; mustNot?: string[] }) {
  const email = people[o.person];
  const session = email ? JSON.stringify(await J.personaSession(email)) : null;
  const cfgFile = `${temp}/cfg-${o.n}.json`, result = `${temp}/res-${o.n}.json`;
  writeFileSync(cfgFile, JSON.stringify({ ...o, out, result, key: storageKey, session })); chmodSync(cfgFile, 0o600);
  spawnSync("python3", [`${temp}/walk_step.py`, cfgFile], { encoding: "utf8", timeout: 90_000 });
  rmSync(cfgFile, { force: true });
  return existsSync(result) ? JSON.parse(readFileSync(result, "utf8")) as { loaded: boolean; shots: string[]; next: boolean; clicked: boolean | null; leaks: string[]; errors: string[]; url: string; missing?: string; runner_error?: string; runner_notes?: string[] } : null;
}

if (!ctx?.jobId || !safe) {
  for (const s of [...STEPS.map(s => s.step), ...LATER]) add({ step: s, person: "-", status: "blocked", detail: setupError ? "Setup failed." : "A safeguard probe failed; no page actions taken." });
} else {
  let broken = false; let n = 1;
  for (const s of STEPS) {
    const path = s.path();
    if (!path) { add({ step: s.step, person: s.person, status: "blocked", detail: "Prerequisite record missing (no offer)." }); n++; continue; }
    const r = await browse({ n, slug: s.step.toLowerCase().replace(/[^a-z]+/g, "-"), path, wait: s.wait, button: s.button, scope: s.scope, person: s.person, next: s.next });
    const st = await jobState();
    const runnerErr = !r ? "browser step crashed" : r.runner_error ?? null;
    const why = runnerErr ? null : !r!.loaded ? `page content "${s.wait}" never appeared (${r!.url})` : r!.clicked === false ? `a person could not find "${r!.missing ?? s.button}" on the page (${r!.url})` : s.expect ? await s.expect() : null;
    const leaks = await otherHomes(n, s.person);
    if (runnerErr) { add({ step: s.step, person: s.person, status: "runner_error", detail: runnerErr, screenshot: r?.shots ?? [] }); broken = true; n++; continue; }
    if (r?.runner_notes?.length) add({ step: `${s.step}: runner note`, person: "runner", status: "runner_error", detail: r.runner_notes.join("; ") + " — runner fallback used, step continued." });
    add({ step: s.step, person: s.person, status: why ? "fail" : "pass", severity: why ? s.severity : null, detail: why ?? `loaded ${r!.url}${r!.clicked ? `, pressed "${s.button!.split("|").join('" then "')}"` : ""}`, screenshot: r?.shots ?? [], stage: st.stage, events: st.events, emailRows: st.emails, nextVisible: r?.next ?? null, leaks });
    if (leaks.length) add({ step: `${s.step}: other roles' homes`, person: "visibility", status: "fail", severity: "Stop launch", detail: leaks.join("; ") });
    if (why) broken = true;
    n++;
  }
  for (const s of LATER) {
    const person = /Owner|payment|deposit/i.test(s) ? "homeowner" : /Install day/i.test(s) ? "installer owner" : "office";
    const path = person === "homeowner" ? `/my-job/${ctx.token}` : person === "installer owner" ? `/field/day/${ctx.jobId}` : `/admin/jobs/${ctx.jobId}`;
    const r = await browse({ n: n++, slug: s.toLowerCase().replace(/[^a-z]+/g, "-"), path, wait: person === "office" ? ctx.jobNumber ?? "HV-" : person === "homeowner" ? "Your progress" : "Install", person, next: s });
    const st = await jobState();
    add({ step: s, person, status: broken ? "blocked" : "not_run", detail: `Page inspected (${r?.url ?? "browser failed"}); ${broken ? "required earlier workflow state not reached" : "this step's page controls are not implemented in the runner"}. No downstream state manufactured.`, screenshot: r?.shots ?? [], stage: st.stage, events: st.events, emailRows: st.emails });
  }
}

// ---- cleanup: archive only this run's job, restore TEST trades ----
let archived: string[] = [];
const { data: communications } = ctx?.jobId ? await admin.from("job_communications").select("subject,recipients,delivery_status,provider_message_id,source_event,source_reference,created_at").eq("job_id", ctx.jobId).eq("channel", "email").order("created_at") : { data: [] };
const sentEmails = (communications ?? []).filter(c => acceptedTestEmail(c));
if (ctx) { await J.cleanupJourney(ctx).catch((e) => add({ step: "Cleanup", person: "setup", status: "fail", severity: "Fix soon", detail: String(e) })); if (ctx.jobNumber) archived = [ctx.jobNumber]; }
rmSync(temp, { recursive: true, force: true });

const totals = { pass: rows.filter(r => r.status === "pass").length, fail: rows.filter(r => r.status === "fail").length, blocked: rows.filter(r => r.status === "blocked").length, not_run: rows.filter(r => r.status === "not_run").length, runner_error: rows.filter(r => r.status === "runner_error").length };
writeFileSync(`${out}/report.json`, JSON.stringify({ mode: "screens", startedAt: stamp, job: ctx?.jobNumber ?? null, archived, totals, rows, sentEmails, sendingKeysRemoved: removed.length, published: false, switchesChanged: false }, null, 2));
writeFileSync(`${out}/report.md`, [`# Phone walk-through ${stamp}`, "", `Job ${ctx?.jobNumber ?? "none"} (qa_test). PASS ${totals.pass} / FAIL ${totals.fail} / BLOCKED ${totals.blocked} / NOT RUN ${totals.not_run} / RUNNER ERROR ${totals.runner_error}`, "", "Website step skipped (covered by portal-qa). Viewport 390x844.", "", "| Step | Person | Result | Severity | Stage | Events | Email rows | Next visible | Detail | Screens |", "|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map(r => `| ${r.step} | ${r.person} | ${r.status.toUpperCase()} | ${r.severity ?? ""} | ${r.stage ?? ""} | ${r.events ?? ""} | ${r.emailRows ?? ""} | ${r.nextVisible ?? ""} | ${r.detail.replace(/\|/g, "\\|")} | ${r.screenshot.join(" ")} |`), "", "", "Data finding (Polish): HV-1554 is an old TEST import (installer_import, hivic-test.example owner, cancelled) not marked qa_test; left unchanged.", `Archived: ${archived.join(", ") || "nothing"}. TEST trades restored by journey cleanup.`].join("\n"));
console.log(`PASS ${totals.pass} / FAIL ${totals.fail} / BLOCKED ${totals.blocked} / NOT RUN ${totals.not_run}. Report: ${out}/report.md`);
process.exit(totals.fail ? 1 : 0);

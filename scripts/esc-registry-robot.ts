// ESC VEU Registry robot (decision 272, Jo 25 Oct 2026) – the runner. Run SEPARATELY from the portal:
//   bun scripts/esc-registry-robot.ts            (every notice/VEEC that is due)
//   bun scripts/esc-registry-robot.ts --job <id> (one job only, e.g. the first supervised run)
//   bun scripts/esc-registry-robot.ts --plan     (print the plan, open no browser)
// Why a script: the deployed portal is a Cloudflare-style worker (nitro) that cannot run a browser. This script needs
// Node/Bun + Playwright + Chromium on the machine that runs it (an office PC, a small VM or a scheduled job):
//   bun add -d playwright && bunx playwright install chromium     (not added to package.json: the worker must not pull it)
// plus the portal's SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY and the Registry login VEU_REGISTRY_USERNAME /
// VEU_REGISTRY_PASSWORD in the environment (never logged, never stored).
//
// Locks (all fail closed): Settings › Switches › ESC Registry robot (workflow_settings.esc_registry_robot_enabled,
// pending migration) AND ESC_REGISTRY_ROBOT_ENABLED=true. ESC_REGISTRY_ROBOT_MODE=live submits; anything else dry-runs
// (fill + screenshot, never Submit). Live is also refused until esc-registry-selectors SELECTOR_MAP_VERIFIED is true.
// TEST (qa_test) jobs are always dry-run. Idempotent: an attempt event is written BEFORE Submit; a sent notice / lodged
// VEEC / earlier failure / unfinished live attempt is never submitted again. Any failure → screenshot +
// esc_registry_robot_failed (needs_office) → Needs me row → the office copies the Registry block by hand.
import { INSTALL_NOTIFICATION, INSTALL_NOTIFICATION_UPDATE, VEEC_CREATION } from "../src/lib/esc-registry-selectors";
import { RobotStepError, fillInstallNotification, fillInstallNotificationUpdate, fillVeecCreation, login, submitAndReadReference, type RobotPage } from "../src/lib/esc-registry-robot.browser";
import { runSummary, type RobotMode, type RobotTask } from "../src/lib/esc-registry-robot.core";
import {
  noticeWork, recordRobotAttempt, recordRobotDryRun, recordRobotFailure, recordRobotNotificationSubmitted, recordRobotNotificationUpdated, recordRobotVeecSubmitted, robotSettings, storeRobotScreenshot, veecWork,
} from "../src/lib/esc-registry-robot.server";
import { melbourneToday } from "../src/lib/melbourne-time.core";

const args = process.argv.slice(2);
const onlyJob = args.includes("--job") ? args[args.indexOf("--job") + 1] ?? null : null;
const planOnly = args.includes("--plan");
const log = (...a: unknown[]) => console.log(`[esc-registry-robot ${new Date().toISOString()}]`, ...a);

const settings = await robotSettings();
log(`mode ${settings.mode}: ${settings.reason}`);
const counts = { notices: { planned: 0, submitted: 0, updated: 0, dryRuns: 0, failed: 0, skipped: 0 }, veecs: { planned: 0, submitted: 0, dryRuns: 0, failed: 0, skipped: 0 } };

if (settings.mode === "off") { log(runSummary({ mode: settings.mode, reason: settings.reason, ...counts })); process.exit(0); }

const notices = (await noticeWork(settings.mode)).filter((w) => !onlyJob || w.candidate.jobId === onlyJob);
const veecs = (await veecWork(settings.mode)).filter((w) => !onlyJob || w.candidate.jobId === onlyJob);
for (const w of notices) log(`notice job ${w.jobNumber} v${w.candidate.version} · ${w.effectiveMode} · ${w.plan.action}: ${w.plan.reason}`);
for (const w of veecs) log(`VEEC job ${w.jobNumber} · ${w.effectiveMode} · ${w.plan.action}: ${w.plan.reason}`);
counts.notices.skipped = notices.filter((w) => w.plan.action === "skip").length;
counts.veecs.skipped = veecs.filter((w) => w.plan.action === "skip").length;
const dueNotices = notices.filter((w) => w.plan.action !== "skip");
const dueVeecs = veecs.filter((w) => w.plan.action !== "skip");
counts.notices.planned = dueNotices.length; counts.veecs.planned = dueVeecs.length;

if (planOnly || (!dueNotices.length && !dueVeecs.length)) { log(runSummary({ mode: settings.mode, reason: settings.reason, ...counts })); process.exit(0); }

// Playwright is loaded here only, so the portal bundle never sees it.
let chromium: { launch(o?: { headless?: boolean }): Promise<{ newPage(): Promise<RobotPage & { close(): Promise<void> }>; close(): Promise<void> }> };
try { chromium = (await import("playwright")).chromium as unknown as typeof chromium; } catch {
  console.error("Playwright is not installed on this machine. Run: bun add -d playwright && bunx playwright install chromium");
  process.exit(2);
}
const browser = await chromium.launch({ headless: process.env["ESC_REGISTRY_ROBOT_HEADFUL"] !== "true" });
const page = await browser.newPage();
const shot = async () => { try { return await page.screenshot({ fullPage: true }); } catch { return null; } };

async function fail(p: { jobId: string; jobNumber: string; task: RobotTask; notificationId: string | null; mode: RobotMode; e: unknown }) {
  const step = p.e instanceof RobotStepError ? p.e.step : "unexpected";
  const message = String((p.e as Error)?.message ?? p.e);
  const png = await shot();
  const path = png ? await storeRobotScreenshot({ jobId: p.jobId, jobNumber: p.jobNumber, task: p.task, ref: p.notificationId, outcome: "failed", png }) : null;
  await recordRobotFailure({ jobId: p.jobId, task: p.task, notificationId: p.notificationId, mode: p.mode, step, error: message, screenshotPath: path, registryUrl: safeUrl() });
  log(`FAILED job ${p.jobNumber} ${p.task} at ${step}: ${message}`);
}
const safeUrl = () => { try { return page.url(); } catch { return null; } };

try {
  await login(page, settings.credentials!);
} catch (e) {
  // A login failure is one failure for every due item (each job gets its Needs me row), then stop.
  for (const w of dueNotices) { await fail({ jobId: w.candidate.jobId, jobNumber: w.jobNumber, task: "install_notification", notificationId: w.candidate.notificationId, mode: w.effectiveMode, e }); counts.notices.failed++; }
  for (const w of dueVeecs) { await fail({ jobId: w.candidate.jobId, jobNumber: w.jobNumber, task: "veec_creation", notificationId: null, mode: w.effectiveMode, e }); counts.veecs.failed++; }
  await browser.close();
  log(runSummary({ mode: settings.mode, reason: settings.reason, ...counts }));
  process.exit(1);
}

for (const w of dueNotices) {
  const { candidate: c, plan } = w;
  const mode = w.effectiveMode;
  try {
    await recordRobotAttempt({ jobId: c.jobId, task: "install_notification", notificationId: c.notificationId, mode, plan: `${plan.action}: ${plan.reason}` });
    const report = plan.action === "update_same_id"
      ? await fillInstallNotificationUpdate(page, plan.reference, w.values, plan.change.changed)
      : await fillInstallNotification(page, w.values);
    if (mode !== "live") {
      const png = await shot();
      const path = png ? await storeRobotScreenshot({ jobId: c.jobId, jobNumber: w.jobNumber, task: "install_notification", ref: c.notificationId, outcome: "dry_run", png }) : null;
      await recordRobotDryRun({ jobId: c.jobId, task: "install_notification", notificationId: c.notificationId, screenshotPath: path, ...report, registryUrl: safeUrl() });
      counts.notices.dryRuns++;
      log(`dry run job ${w.jobNumber}: filled ${report.filled.length}, blank ${report.blank.join(",") || "-"}, unmapped ${report.unmapped.join(",") || "-"}`);
      continue;
    }
    const now = new Date().toISOString();
    const { reference, url } = await submitAndReadReference(page, plan.action === "update_same_id" ? { submit: INSTALL_NOTIFICATION_UPDATE.submit, confirmation: INSTALL_NOTIFICATION_UPDATE.confirmation } : INSTALL_NOTIFICATION);
    const png = await shot();
    const path = png ? await storeRobotScreenshot({ jobId: c.jobId, jobNumber: w.jobNumber, task: "install_notification", ref: c.notificationId, outcome: "submitted", png, reference }) : null;
    if (plan.action === "update_same_id") { await recordRobotNotificationUpdated({ notificationId: c.notificationId, previousNotificationId: c.previousSent!.id, reference, updatedAt: now, screenshotPath: path, registryUrl: url }); counts.notices.updated++; }
    else { await recordRobotNotificationSubmitted({ notificationId: c.notificationId, reference, sentAt: now, screenshotPath: path, registryUrl: url }); counts.notices.submitted++; }
    log(`submitted job ${w.jobNumber}: ref ${reference}`);
  } catch (e) {
    await fail({ jobId: c.jobId, jobNumber: w.jobNumber, task: "install_notification", notificationId: c.notificationId, mode, e });
    counts.notices.failed++;
  }
}

for (const w of dueVeecs) {
  const { candidate: c, plan } = w;
  const mode = w.effectiveMode;
  try {
    await recordRobotAttempt({ jobId: c.jobId, task: "veec_creation", notificationId: null, mode, plan: `${plan.action}: ${plan.reason}` });
    const report = await fillVeecCreation(page, w.values);
    if (mode !== "live") {
      const png = await shot();
      const path = png ? await storeRobotScreenshot({ jobId: c.jobId, jobNumber: w.jobNumber, task: "veec_creation", ref: null, outcome: "dry_run", png }) : null;
      await recordRobotDryRun({ jobId: c.jobId, task: "veec_creation", notificationId: null, screenshotPath: path, ...report, registryUrl: safeUrl() });
      counts.veecs.dryRuns++;
      log(`dry run VEEC job ${w.jobNumber}: filled ${report.filled.length}, blank ${report.blank.join(",") || "-"}, unmapped ${report.unmapped.join(",") || "-"}`);
      continue;
    }
    const { reference, url } = await submitAndReadReference(page, VEEC_CREATION);
    const png = await shot();
    const path = png ? await storeRobotScreenshot({ jobId: c.jobId, jobNumber: w.jobNumber, task: "veec_creation", ref: null, outcome: "submitted", png, reference }) : null;
    await recordRobotVeecSubmitted({ jobId: c.jobId, reference, quantity: c.quantity!, submittedDate: melbourneToday(), screenshotPath: path, registryUrl: url });
    counts.veecs.submitted++;
    log(`VEEC created job ${w.jobNumber}: ref ${reference}`);
  } catch (e) {
    await fail({ jobId: c.jobId, jobNumber: w.jobNumber, task: "veec_creation", notificationId: null, mode, e });
    counts.veecs.failed++;
  }
}

await browser.close();
log(runSummary({ mode: settings.mode, reason: settings.reason, ...counts }));
process.exit(counts.notices.failed + counts.veecs.failed ? 1 : 0);

// Renders the decision 376 messages (Jo 25 Oct 2026 — the four moments F13 left record-only; Jo APPROVED all four as
// drafted in decision 384) into their who-folders in docs/templates (owner/, electrician/, installer/) with fixed sample
// data, prints every subject + text + SMS body, and with --jpg also saves a 640px-wide JPG preview of each design into
// docs/designs (Playwright Chromium, local files only). Pure renderers; nothing is sent. Flags (all true since decision
// 384): O74/O74b VISIT_NEW_TIMES_APPROVED + SMS type `visit_new_times`; O75 OWNER_PAPERWORK_COPY_APPROVED; E14
// PIESA_TIMES_REMINDER_APPROVED + `piesa_times_reminder`; I71 INSTALLER_PLANNING_NOTICE_APPROVED + `installer_planning_notice`.
// Run: bun scripts/render-decision-376-drafts.ts [--jpg]
import { mkdirSync, writeFileSync } from "node:fs";
import { renderVisitNewTimesEmail, visitNewTimesText } from "../src/lib/visit-new-times.core";
import { renderPaperworkCopyEmail } from "../src/lib/paperwork-copy-email.core";
import { piesaTimesReminderText, renderPiesaTimesReminderEmail } from "../src/lib/piesa-times-reminder.core";
import { installerPlanningText, renderInstallerPlanningEmail } from "../src/lib/installer-planning-notice.core";

const TEMPLATES = new URL("../docs/templates/", import.meta.url).pathname;
const DESIGNS = new URL("../docs/designs/", import.meta.url).pathname;
const MY_JOB = "https://estimate.homeinsulationvictoria.com.au/my-job/tok";
const FIELD = "https://estimate.homeinsulationvictoria.com.au/field/job-1";

export const O74_SAMPLE = { kind: "assessment" as const, wasIso: "2026-10-28T22:30:00.000Z", firstName: "Helen", unsubscribeUrl: null };
export const D376_FILES = {
  O74: "owner/O74-visit-new-times.html", O74b: "owner/O74b-visit-new-times-on-the-way.html", O75: "owner/O75-signed-paperwork-copy.html",
  E14: "electrician/E14-piesa-times-reminder.html", I71: "installer/I71-installer-planning-notice.html",
} as const;

const o74 = renderVisitNewTimesEmail({ ...O74_SAMPLE, ownerPicks: true, link: `${MY_JOB}?screen=book` });
const o74b = renderVisitNewTimesEmail({ ...O74_SAMPLE, kind: "installation", wasIso: "2026-11-03T21:00:00.000Z", ownerPicks: false, link: `${MY_JOB}?screen=book` });
const o75 = renderPaperworkCopyEmail({ firstName: "Helen", address: "12 Smith St, Frankston", titles: ["The agreement", "Payment", "Your rebate (VEEC assignment)"], attached: true, myJobUrl: MY_JOB, unsubscribeUrl: null });
const e14Facts = { jobNumber: "HV-3117", address: "12 Smith St, Frankston", link: FIELD };
const e14 = renderPiesaTimesReminderEmail({ ...e14Facts, firstName: "Sam" });
const i71Facts = { jobNumber: "HV-3117", address: "12 Smith St, Frankston", piesaStartIso: "2026-10-28T22:30:00.000Z", link: FIELD };
const i71 = renderInstallerPlanningEmail({ ...i71Facts, ownerFirstName: "Helen" });

const out: { code: keyof typeof D376_FILES; mail: { subject: string; html: string; text: string }; sms: string | null }[] = [
  { code: "O74", mail: o74, sms: visitNewTimesText({ kind: "assessment", wasIso: O74_SAMPLE.wasIso, ownerPicks: true, link: `${MY_JOB}?screen=book` }) },
  { code: "O74b", mail: o74b, sms: visitNewTimesText({ kind: "installation", wasIso: "2026-11-03T21:00:00.000Z", ownerPicks: false, link: `${MY_JOB}?screen=book` }) },
  { code: "O75", mail: o75, sms: null },
  { code: "E14", mail: e14, sms: piesaTimesReminderText(e14Facts) },
  { code: "I71", mail: i71, sms: installerPlanningText(i71Facts) },
];

for (const o of out) {
  writeFileSync(`${TEMPLATES}${D376_FILES[o.code]}`, o.mail.html);
  if (import.meta.main) console.log(`--- ${o.code} — subject: ${o.mail.subject}\n${o.mail.text}\n${o.sms ? `--- ${o.code} text: Home Insulation Victoria: ${o.sms}\n` : ""}`);
}

if (import.meta.main && process.argv.includes("--jpg")) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chromium } = require("playwright") as typeof import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 900 } });
  mkdirSync(DESIGNS, { recursive: true });
  for (const o of out) {
    await page.setContent(o.mail.html, { waitUntil: "load" });
    await page.screenshot({ path: `${DESIGNS}${o.code}.jpg`, type: "jpeg", quality: 85, fullPage: true });
    console.log(`JPG: docs/designs/${o.code}.jpg`);
  }
  await browser.close();
}

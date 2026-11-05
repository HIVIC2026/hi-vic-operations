// Part 7 Task 8 (Jo 2 Nov 2026): the replaced trade messages are gone — the "Add your usual electrician" text (decision
// 374: we always choose the electrician on our leads; decision 303 handles A1), the 2pm "Pick the crew for tomorrow" crew
// reminder (#110) and the in-house 2pm "Tomorrow’s installs — Lead Installer" office email. Deep Part 5a (Jo 4–5 Nov
// 2026) retired their replacement too — the 9am "Confirm or change your Lead Installer by 5pm today" email — in favour
// of the 3-day "Pick the Lead Installer" reminder + the 2-day red Needs me flag (lead-installer-reminder) and the GO /
// DON'T START email as the only day-before office email. Nothing retired may be referenced from src/ or scripts/.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { WORKFLOW_DECISIONS } from "../src/config/workflow-decisions";
import { SMS_MESSAGE_TYPES } from "../src/lib/sms.core";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n: string) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []; });
const SOURCES = [...walk("src"), ...walk("scripts")];
const grep = (needle: string) => SOURCES.filter((f) => readFileSync(f, "utf8").includes(needle));

describe("the retired senders are gone", () => {
  test("files deleted", () => {
    for (const f of ["src/lib/usual-electrician-reminder.server.ts", "src/lib/crew-reminder.core.ts", "src/lib/crew-reminder.server.ts", "src/lib/lead-installer-confirm.core.ts"]) expect({ f, exists: existsSync(f) }).toEqual({ f, exists: false });
  });
  test("no reference in src/ or scripts/ to the removed exports or the old email subjects", () => {
    for (const n of ["sweepCrewReminders", "maybeRemindUsualElectrician", "sweepInHouseInstallOfficeEmails", "tomorrowInstallDigest", "Tomorrow’s installs — Lead Installer", "crew-reminder.core", "crew-reminder.server", "usual-electrician-reminder", "usualElectricianReminderBody(",
      "sweepLeadInstallerConfirm", "lead-installer-confirm.core", "LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED", "leadConfirmDue(", "renderLeadInstallerConfirm("]) {
      expect({ n, in: grep(n) }).toEqual({ n, in: [] });
    }
  });
  test("the allocation tick calls the Lead Installer reminder sweep and none of the removed sweeps (no double email)", () => {
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    expect(tick).toContain("sweepLeadInstallerReminder()");
    expect(tick).toContain("sweepPrestart()"); // the GO / DON'T START email rides on the pre-start sweep
    for (const n of ["sweepCrewReminders", "sweepInHouseInstallOfficeEmails", "crew-reminder", "sweepLeadInstallerConfirm"]) expect(tick).not.toContain(n);
  });
  test("the usual-electrician text type is kept for history only: not approved, never sent, no Needs me row raised", () => {
    expect(SMS_MESSAGE_TYPES.usual_electrician_missing.wordingApproved).toBe(false);
    expect(SMS_MESSAGE_TYPES.usual_electrician_missing.label).toMatch(/^Retired 2 Nov 2026/);
    expect(grep('type: "usual_electrician_missing"')).toEqual([]);
    const needs = readFileSync("src/lib/needs.server.ts", "utf8");
    expect(needs).not.toContain('needsItem("installer_usual_electrician_missing"');
    const quote = readFileSync("src/lib/installer-quote.server.ts", "utf8");
    expect(quote).not.toContain("maybeRemindUsualElectrician");
  });
  test("workflow-decisions lists the retired messages; the Templates page no longer shows them", () => {
    const retired = (WORKFLOW_DECISIONS as unknown as { tradeMessages: { retired: string[] } }).tradeMessages.retired;
    for (const p of ["2pm day-before Lead Installer email", "Pick the crew for tomorrow", "We need your usual electrician", "Confirm or change your Lead Installer by 5pm today"]) expect(retired).toContain(p);
    const hub = readFileSync("src/lib/template-hub.core.ts", "utf8");
    for (const n of ["Add your usual electrician (text)", "crewReminderEmail", "Pick the crew for tomorrow", "sms-usual_electrician_missing", "installer:lead-installer-confirm", "Confirm or change your Lead Installer by 5pm today (email)"]) expect(hub).not.toContain(n);
    expect(hub).toContain("installer:lead-installer-reminder");
  });
  test("the old in-house-install-office:v1 claims are history only: nothing reads them any more", () => {
    expect(grep("in-house-install-office:v1:")).toEqual([]);
  });
});

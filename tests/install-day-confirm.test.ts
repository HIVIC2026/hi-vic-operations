// Decision 328 (Jo, 25 Oct 2026): the A5 Install day form confirmation — pure rules, Jo's wording, the SMS types and
// source pins for the sender, the tick and the "Check my form now" button (no database, no network).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  FINAL_TICK_MISSING, INSTALL_DAY_REMINDER_EVENT, INSTALL_DAY_REMINDER_SMS_TYPE, INSTALL_DAY_RESULT_EVENT, INSTALL_DAY_RESULT_SMS_TYPE,
  firstMissing, installDayAllFilledInText, installDayFormResult, installDayNotFinishedText, installDayReminderKey, installDayReminderText,
  installDayResultKey, installDayResultText, installDayScreenLine, isInstallDayToday, melbourneParts, reminderDue, resultTextDue,
} from "../src/lib/install-day-confirm.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES, smsBlocker } from "../src/lib/sms.core";

const read = (f: string) => readFileSync(f, "utf8");
const ok = { ok: true, message: "Declaration saved from the Mitti PIISA." };
const clean = { applies: true, blockers: [] as string[] };

describe("wording (verbatim, Jo 25 Oct 2026)", () => {
  test("all filled in / not finished / 5pm reminder", () => {
    expect(installDayAllFilledInText({ jobNumber: "HV-3100", address: "1 Test St, Box Hill" })).toBe("HV-3100 1 Test St, Box Hill: All filled in ✓ You can leave site.");
    expect(installDayNotFinishedText({ jobNumber: "HV-3100", missing: ["After videos: 1 of 2 uploaded", "Depth photos: 0 of 2 uploaded.", FINAL_TICK_MISSING, "fourth item"] }))
      .toBe(`HV-3100: Not finished — After videos: 1 of 2 uploaded; Depth photos: 0 of 2 uploaded; ${FINAL_TICK_MISSING}. Don't leave site. Open the Mitti form, finish it and press Complete again.`);
    expect(installDayReminderText({ jobNumber: "HV-3100" })).toBe('HV-3100: your install day form isn\'t complete yet. Don\'t leave site until it is and the portal texts you "All filled in".');
    expect(firstMissing(["x".repeat(200)])).toHaveLength(88);
  });
});

describe("the result", () => {
  test("not Complete = nothing to text; Complete + every check = all filled in", () => {
    expect(installDayFormResult({ formCompleted: false, installDayForm: true, finalTickTicked: false, declaration: ok, summary: clean })).toEqual({ state: "not_complete", missing: [] });
    const all = installDayFormResult({ formCompleted: true, installDayForm: true, finalTickTicked: true, declaration: ok, summary: clean });
    expect(all).toEqual({ state: "all_filled_in", missing: [] });
    expect(installDayResultText(all, { jobNumber: "HV-1", address: null })).toBe("HV-1: All filled in ✓ You can leave site.");
    expect(installDayResultText({ state: "not_complete", missing: [] }, { jobNumber: "HV-1", address: null })).toBeNull();
    expect(installDayScreenLine(all)).toEqual({ title: "All filled in ✓", body: "You can leave site.", good: true });
  });
  test("evidence first, then the declaration, then the final tick (deduped); old-rule installs skip the evidence list", () => {
    const r = installDayFormResult({ formCompleted: true, installDayForm: true, finalTickTicked: false, declaration: { ok: false, message: "A • B" }, summary: { applies: true, blockers: ["After videos: 1 of 2 uploaded", FINAL_TICK_MISSING] } });
    expect(r).toEqual({ state: "not_finished", missing: ["After videos: 1 of 2 uploaded", FINAL_TICK_MISSING, "A", "B"] });
    expect(installDayFormResult({ formCompleted: true, installDayForm: true, finalTickTicked: true, declaration: ok, summary: { applies: false, blockers: ["x"] } }).state).toBe("all_filled_in");
    expect(installDayFormResult({ formCompleted: true, installDayForm: true, finalTickTicked: false, declaration: ok, summary: { applies: false, blockers: [] } }).missing).toEqual([FINAL_TICK_MISSING]);
    expect(installDayFormResult({ formCompleted: true, installDayForm: false, finalTickTicked: false, declaration: ok, summary: clean }).state).toBe("all_filled_in"); // old A3: no final tick
    expect(installDayFormResult({ formCompleted: true, installDayForm: true, finalTickTicked: true, declaration: ok, summary: null }).state).toBe("not_finished");
  });
});

describe("keys and timing", () => {
  test("one result per audit revision; one reminder per job and day", () => {
    expect(installDayResultKey("j1", "a1", "2026-11-03T05:00:00Z")).toBe("install-day-form-result:v1:j1:a1:2026-11-03T05:00:00Z");
    expect(installDayResultKey("j1", "a1", null)).toBe("install-day-form-result:v1:j1:a1:complete");
    expect(installDayReminderKey("j1", "2026-11-03")).toBe("install-day-form-reminder:v1:j1:2026-11-03");
  });
  test("install days in Melbourne; the result text only on an install day and once per revision", () => {
    expect(melbourneParts(new Date("2026-11-03T06:30:00Z"))).toEqual({ ymd: "2026-11-03", hour: 17 }); // AEDT = UTC+11
    expect(isInstallDayToday("2026-11-03", "2026-11-03", null)).toBe(true);
    expect(isInstallDayToday("2026-11-04", "2026-11-03", "2026-11-04")).toBe(true);
    expect(isInstallDayToday("2026-11-05", "2026-11-03", "2026-11-04")).toBe(false);
    expect(isInstallDayToday("2026-11-03", null, null)).toBe(false);
    expect(resultTextDue({ formCompleted: true, installDayToday: true, alreadySentForRevision: false })).toBe(true);
    expect(resultTextDue({ formCompleted: true, installDayToday: false, alreadySentForRevision: false })).toBe(false);
    expect(resultTextDue({ formCompleted: true, installDayToday: true, alreadySentForRevision: true })).toBe(false);
    expect(resultTextDue({ formCompleted: false, installDayToday: true, alreadySentForRevision: false })).toBe(false);
  });
  test("5pm reminder: last install day, from 17:00 Melbourne, only while the form is not Complete, once", () => {
    const at = (iso: string) => new Date(iso);
    const base = { lastInstallDay: "2026-11-03", formCompleted: false, installationRecorded: false, alreadySent: false };
    expect(reminderDue({ ...base, now: at("2026-11-03T05:59:00Z") })).toBe(false); // 4:59pm
    expect(reminderDue({ ...base, now: at("2026-11-03T06:00:00Z") })).toBe(true); // 5pm
    expect(reminderDue({ ...base, now: at("2026-11-03T06:00:00Z"), formCompleted: true })).toBe(false);
    expect(reminderDue({ ...base, now: at("2026-11-03T06:00:00Z"), installationRecorded: true })).toBe(false);
    expect(reminderDue({ ...base, now: at("2026-11-03T06:00:00Z"), alreadySent: true })).toBe(false);
    expect(reminderDue({ ...base, now: at("2026-11-04T06:00:00Z") })).toBe(false); // not the install day
  });
});

describe("SMS types (audience partner, wording approved; result exempt from 8pm quiet hours but never before 7am)", () => {
  const gate = { to: "0466 777 888", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false };
  test("types and freshness", () => {
    expect(SMS_MESSAGE_TYPES[INSTALL_DAY_RESULT_SMS_TYPE]).toMatchObject({ audience: "partner", wordingApproved: true, quietHours: false, notBefore7am: true });
    expect(SMS_MESSAGE_TYPES[INSTALL_DAY_REMINDER_SMS_TYPE]).toMatchObject({ audience: "partner", wordingApproved: true, quietHours: true });
    expect(SMS_FRESHNESS[INSTALL_DAY_RESULT_SMS_TYPE]).toEqual({ kind: "window" });
    expect(SMS_FRESHNESS[INSTALL_DAY_REMINDER_SMS_TYPE]).toEqual({ kind: "window" });
  });
  test("result text: 9pm allowed, 6:30am held; reminder: 9pm held; switches respected", () => {
    expect(smsBlocker({ ...gate, type: INSTALL_DAY_RESULT_SMS_TYPE, nowIso: "2026-11-03T10:00:00Z" })).toBeNull(); // 9pm Melbourne
    expect(smsBlocker({ ...gate, type: INSTALL_DAY_RESULT_SMS_TYPE, nowIso: "2026-11-02T19:30:00Z" })).toBe("Not before 7am (Melbourne)"); // 6:30am
    expect(smsBlocker({ ...gate, type: INSTALL_DAY_REMINDER_SMS_TYPE, nowIso: "2026-11-03T10:00:00Z" })).not.toBeNull();
    expect(smsBlocker({ ...gate, type: INSTALL_DAY_REMINDER_SMS_TYPE, nowIso: "2026-11-03T06:00:00Z" })).toBeNull();
    expect(smsBlocker({ ...gate, type: INSTALL_DAY_RESULT_SMS_TYPE, typeSwitchOn: false, nowIso: "2026-11-03T06:00:00Z" })).toMatch(/switched off/);
    expect(smsBlocker({ ...gate, type: INSTALL_DAY_RESULT_SMS_TYPE, commsEnabled: false, nowIso: "2026-11-03T06:00:00Z" })).toMatch(/switched off/);
    expect(smsBlocker({ ...gate, type: INSTALL_DAY_RESULT_SMS_TYPE, isTestRecord: true, nowIso: "2026-11-03T06:00:00Z" })).toMatch(/TEST/);
  });
});

describe("source pins", () => {
  const s = read("src/lib/install-day-confirm.server.ts");
  test("sender: event recorded BEFORE any send; TEST → test-send; real → sendRealSms with the key; no raw gateway", () => {
    const resultEvent = s.indexOf("INSTALL_DAY_RESULT_EVENT, `Lead installer texted");
    expect(resultEvent).toBeGreaterThan(-1);
    expect(s.indexOf('deliver({ type: "install_day_form_result"')).toBeGreaterThan(resultEvent);
    const reminderEvent = s.indexOf("INSTALL_DAY_REMINDER_EVENT, `Lead installer texted at 5pm");
    expect(reminderEvent).toBeGreaterThan(-1);
    expect(s.indexOf('deliver({ type: "install_day_form_reminder"')).toBeGreaterThan(reminderEvent);
    expect(s).toContain('p.job.source === "qa_test" || isTestPartner(p.biz ?? {})');
    expect(s).toContain("sendTestSms(");
    expect(s).toContain("sendRealSms({ type: p.type, idempotencyKey: p.key, to: p.to, body: p.body, jobId: p.job.id, businessId: p.businessId })");
    expect(s).not.toMatch(/twilio|au1SendMessage/i);
    expect(s).toContain("syncPiisaDeclaration(jobId"); // the single-job A5 sync
    expect(s).not.toMatch(/transition\(|recordInstallationComplete/);
    expect([INSTALL_DAY_RESULT_EVENT, INSTALL_DAY_REMINDER_EVENT]).toEqual(["install_day_form_result_sent", "install_day_form_reminder_sent"]);
  });
  test("the 15-minute tick runs the sweep; the A5 sync reports what it read and passes the final tick to completion", () => {
    expect(read("src/routes/api/public/hooks/allocation-tick.ts")).toContain("sweepInstallDayForms()");
    const d = read("src/lib/piisa-declaration.server.ts");
    expect(d).toContain("opts.onA3({ auditId, completed: !!p.completed");
    expect(d).toContain("allFilledInTicked: installDay ? finalTickTicked : null");
  });
  test("Check my form now: installers only through trade-view.server; on the today page and the job page", () => {
    const tv = read("src/lib/trade-view.server.ts");
    const at = tv.indexOf("export async function tradeCheckInstallForm");
    expect(tv.slice(at, at + 600)).toContain("requireTradeJob(userId, jobId)");
    expect(tv.slice(at, at + 600)).toContain('c.kind !== "installer"');
    expect(read("src/lib/trade-view.functions.ts")).toContain("export const checkTradeInstallForm = createServerFn");
    expect(read("src/routes/_authenticated/field.day.$jobId.tsx")).toContain("<CheckMyFormButton jobId={jobId} />");
    expect(read("src/routes/_authenticated/field.$jobId.tsx")).toContain("<CheckMyFormButton jobId={jobId}");
    expect(read("src/components/trade/CheckMyFormButton.tsx")).toContain("Check my form now");
  });
});

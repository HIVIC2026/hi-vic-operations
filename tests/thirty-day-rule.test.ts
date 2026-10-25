// Decision 158 (Jo, 24 Oct 2026): 20/10-day reminders to owner + installer, and who pays the repeat PIESA when the window lapses.
import { describe, expect, test } from "bun:test";
import {
  INSTALL_WINDOW_EXPIRED_EVENT, INSTALL_WINDOW_REMINDER_EVENT, RESPONSE_DUE_DAYS, THIRTY_DAY_REMINDER_APPROVED, dueInstallWindowReminder, installerInstallWindowEmail, installerInstallWindowText,
  ownerInstallWindowEmail, ownerInstallWindowText, repeatPiesaCharge, repeatPiesaNextAction, repeatPiesaPayer, repeatPiesaPayerLine, type InstallWindowEvent,
} from "../src/lib/thirty-day-rule.core";
import { SMS_MESSAGE_TYPES, SMS_BRAND_PREFIX, brandSmsBody } from "../src/lib/sms.core";
import { shouldFlagTenDaysLeft, installWindowDeadline } from "../src/lib/install-days.core";
import { safetyCheckCentsFor } from "../src/lib/safety-check-amount.core";
import { readFileSync } from "node:fs";

const clearance = "2026-10-01";
const deadline = installWindowDeadline(clearance, null)!; // 2026-10-31
const ev = (type: string, day: string, details?: InstallWindowEvent["details"], summary?: string): InstallWindowEvent => ({ type, at: `${day}T02:00:00.000Z`, details: details ?? null, summary: summary ?? null });

describe("30-day reminders (decision 158)", () => {
  test("flags on since decision 167; real delivery still behind customer_comms_enabled", () => {
    expect(THIRTY_DAY_REMINDER_APPROVED).toBe(true); // decision 167
    expect(SMS_MESSAGE_TYPES.install_window_reminder.wordingApproved).toBe(true);
    expect(SMS_MESSAGE_TYPES.install_window_reminder.audience).toBe("owner");
    expect(SMS_MESSAGE_TYPES.install_window_reminder_installer.wordingApproved).toBe(true);
    expect(SMS_MESSAGE_TYPES.install_window_reminder_installer.audience).toBe("partner");
    expect(INSTALL_WINDOW_REMINDER_EVENT).toBe("install_window_reminder");
    expect(INSTALL_WINDOW_EXPIRED_EVENT).toBe("install_window_expired");
  });
  test("20-day then 10-day, once each, nothing when booked/expired; a short window still gets the 10-day one", () => {
    const at = (d: string) => new Date(`${d}T00:00:00Z`);
    expect(dueInstallWindowReminder({ deadline, booked: false, expired: false, done: [], now: at("2026-10-05") })).toBeNull(); // 26 left
    expect(dueInstallWindowReminder({ deadline, booked: false, expired: false, done: [], now: at("2026-10-11") })).toBe("reminder_20"); // 20 left
    expect(dueInstallWindowReminder({ deadline, booked: false, expired: false, done: ["reminder_20"], now: at("2026-10-15") })).toBeNull();
    expect(dueInstallWindowReminder({ deadline, booked: false, expired: false, done: ["reminder_20"], now: at("2026-10-21") })).toBe("reminder_10"); // 10 left
    expect(dueInstallWindowReminder({ deadline, booked: false, expired: false, done: ["reminder_20", "reminder_10"], now: at("2026-10-25") })).toBeNull();
    expect(dueInstallWindowReminder({ deadline, booked: true, expired: false, done: [], now: at("2026-10-21") })).toBeNull();
    expect(dueInstallWindowReminder({ deadline, booked: false, expired: true, done: [], now: at("2026-11-02") })).toBeNull();
    expect(dueInstallWindowReminder({ deadline: "2026-10-12", booked: false, expired: false, done: [], now: at("2026-10-05") })).toBe("reminder_10"); // only 7 left from the start
    // The existing single office alert is unchanged and separate.
    expect(shouldFlagTenDaysLeft({ deadline, booked: false, flaggedAt: null, now: at("2026-10-21") })).toBe(true);
  });
  test("texts: short, plain, deadline, link, STOP line; installer text has no owner details", () => {
    const f = { deadline, daysLeft: 20, link: "https://x.test/j/abc", jobNumber: "HV-3300", firstName: "Sam", installerName: "RAPID Insulation", ownerSuburb: "Reservoir" };
    for (const step of ["reminder_20", "reminder_10"] as const) {
      const o = ownerInstallWindowText({ ...f, step, daysLeft: step === "reminder_20" ? 20 : 10 });
      const i = installerInstallWindowText({ ...f, step, daysLeft: step === "reminder_20" ? 20 : 10 });
      for (const t of [o, i]) {
        expect(t.endsWith("Reply STOP to opt out.")).toBe(true);
        expect(t).toContain("Saturday 31 October");
        expect(t).toContain("https://x.test/j/abc");
        expect(brandSmsBody(t).length).toBeLessThanOrEqual(SMS_BRAND_PREFIX.length + 306);
      }
      expect(i).toContain("HV-3300");
      expect(i).not.toContain("Sam");
      expect(i).not.toContain("Reservoir");
    }
    expect(ownerInstallWindowText({ ...f, step: "reminder_10", daysLeft: 10 })).toContain("whoever caused the delay");
    expect(installerInstallWindowText({ ...f, step: "reminder_10", daysLeft: 10 })).toContain("whoever caused the delay");
  });
  test("emails: subject + link + rule line; TEST label only when test", () => {
    const f = { step: "reminder_10" as const, deadline, daysLeft: 10, link: "https://x.test/j/abc", jobNumber: "HV-3300", firstName: "Sam", installerName: "RAPID Insulation", ownerSuburb: "Reservoir" };
    const o = ownerInstallWindowEmail(f), i = installerInstallWindowEmail({ ...f, firstName: "Deep" }); // installer's own first name
    expect(o.subject).toBe("Sam, only 10 days left on your safety check");
    expect(o.html).toContain("https://x.test/j/abc");
    expect(o.text).toContain("charged to whoever caused the delay");
    expect(o.text).not.toContain("TEST");
    expect(ownerInstallWindowEmail({ ...f, test: true }).text).toContain("TEST");
    expect(i.subject).toBe("HV-3300: 10 days left in the 30-day install window");
    expect(i.text).toContain("Reservoir");
    expect(i.text).not.toContain("Sam");
    expect(i.text).toContain("partner agreement");
  });
});

describe("who pays the repeat PIESA (decision 158)", () => {
  const lapsed = (events: InstallWindowEvent[], c: string | null = clearance) => repeatPiesaPayer({ clearanceDate: c, deadline, expired: true, booked: false, events });
  test("not lapsed or booked → undetermined (nothing to charge)", () => {
    expect(repeatPiesaPayer({ clearanceDate: clearance, deadline, expired: false, booked: false, events: [] }).payer).toBe("undetermined");
    expect(repeatPiesaPayer({ clearanceDate: clearance, deadline, expired: true, booked: true, events: [] }).payer).toBe("undetermined");
    expect(repeatPiesaPayer({ clearanceDate: clearance, deadline: null, expired: true, booked: false, events: [] }).basis).toBe("no_deadline");
  });
  test("installer never offered days → installer", () => {
    const d = lapsed([]);
    expect(d.payer).toBe("installer");
    expect(d.basis).toBe("installer_never_offered");
    expect(d.reason).toContain(`within ${RESPONSE_DUE_DAYS} days`);
  });
  test("installer offered, owner never answered → owner", () => {
    const d = lapsed([ev("install_days_offered_by_installer", "2026-10-03")]);
    expect(d.payer).toBe("owner");
    expect(d.basis).toBe("owner_no_answer");
    expect(repeatPiesaPayerLine(d)).toMatch(/^30-day window lapsed — repeat PIESA payable by the owner: Owner did not take/);
  });
  test("owner suggested days, installer never answered → installer", () => {
    const d = lapsed([ev("install_days_offered_by_installer", "2026-10-03"), ev("install_days_offered", "2026-10-05", { days: ["2026-10-12", "2026-10-13"] })]);
    expect(d.payer).toBe("installer");
    expect(d.basis).toBe("installer_no_answer");
  });
  test("owner suggested only days outside the window → owner", () => {
    const d = lapsed([ev("install_days_offered_by_installer", "2026-10-03"), ev("install_days_offered", "2026-10-05", { days: ["2026-11-02", "2026-11-03"] })]);
    expect(d.payer).toBe("owner");
    expect(d.basis).toBe("owner_days_outside_window");
  });
  test("owner changed a booked day late and nothing re-agreed → owner; installer changed → installer", () => {
    const booked = [ev("install_days_offered_by_installer", "2026-10-03"), ev("install_day_taken", "2026-10-04")];
    const o = lapsed([...booked, ev("install_day_changed", "2026-10-28", { who: "owner" })]);
    expect(o.payer).toBe("owner");
    expect(o.basis).toBe("changed_booked_day");
    const i = lapsed([...booked, ev("install_day_changed", "2026-10-28", { who: "installer" }), ev("install_days_offered_by_installer", "2026-10-29")]);
    expect(i.payer).toBe("installer");
    // Older events without details.who: the summary prefix decides.
    expect(lapsed([...booked, ev("install_day_changed", "2026-10-28", null, "Installer changed the booked install day (27/10/2026)")]).payer).toBe("installer");
  });
  test("one side changed the booked day but the other then sat on its move for over the due days → undetermined (office decides)", () => {
    const d = lapsed([ev("install_days_offered_by_installer", "2026-10-03"), ev("install_day_taken", "2026-10-04"), ev("install_day_changed", "2026-10-10", { who: "installer" }), ev("install_days_offered_by_installer", "2026-10-11")]);
    expect(d.payer).toBe("undetermined");
    expect(d.basis).toBe("both_contributed");
    expect(d.reason).toContain("Both contributed");
  });
  test("a booking the system could not confirm as the last act → undetermined", () => {
    const d = lapsed([ev("install_days_offered_by_installer", "2026-10-03"), ev("install_day_taken", "2026-10-30"), ev("install_day_booking_blocked", "2026-10-30")]);
    expect(d.payer).toBe("undetermined");
    expect(d.basis).toBe("booking_blocked");
  });
  test("events after the deadline are ignored", () => {
    const d = lapsed([ev("install_days_offered_by_installer", "2026-11-05")]);
    expect(d.basis).toBe("installer_never_offered");
  });
});

describe("decision 342: owner pays the same amount as their first safety check", () => {
  const owner = { payer: "owner" as const, reason: "r", basis: "owner_no_answer" };
  test("our electrician: the $349 quote line", () => {
    const c = repeatPiesaCharge(owner, safetyCheckCentsFor({ lines: [{ code: "PIESA", line_total_inc_gst: 349 }] }));
    expect(c).toEqual({ payer: "owner", ownerChargeIncGst: 349, firstSafetyCheckIncGst: 349, firstSafetyCheckSource: "quote_line" });
    expect(repeatPiesaNextAction(c)).toBe("New PIESA needed: 30-day window lapsed — repeat PIESA payable by the owner ($349 inc GST, same as their first safety check)");
  });
  test("approved REC: that REC's rate on the quote (e.g. $220), never $349", () => {
    const c = repeatPiesaCharge(owner, safetyCheckCentsFor({ lines: [{ code: "PIESA", line_total_inc_gst: "220.00" }], settingIncGst: 349 }));
    expect(c.ownerChargeIncGst).toBe(220);
    expect(repeatPiesaNextAction(c)).toContain("($220 inc GST, same as their first safety check)");
  });
  test("installer-caused or undetermined: nothing charged to the owner; first amount kept for reference", () => {
    const first = { cents: 22_000, source: "quote_line" as const };
    const inst = repeatPiesaCharge({ payer: "installer", reason: "r", basis: "installer_never_offered" }, first);
    expect(inst).toEqual({ payer: "installer", ownerChargeIncGst: null, firstSafetyCheckIncGst: 220, firstSafetyCheckSource: "quote_line" });
    expect(repeatPiesaNextAction(inst)).toBe("New PIESA needed: 30-day window lapsed — repeat PIESA payable by the installer");
    const und = repeatPiesaCharge({ payer: "undetermined", reason: "r", basis: "both_contributed" }, first);
    expect(und.ownerChargeIncGst).toBeNull();
    expect(repeatPiesaNextAction(und)).toContain("office to decide");
  });
  test("no accepted quote amount known: owner still payer, office confirms the figure", () => {
    const c = repeatPiesaCharge(owner, null);
    expect(c.ownerChargeIncGst).toBeNull();
    expect(repeatPiesaNextAction(c)).toContain("office to confirm the figure");
  });
  test("the expiry record reads the accepted quote's PIESA line and stores the amount on the event", () => {
    const src = readFileSync("src/lib/thirty-day-rule.server.ts", "utf8");
    expect(src).toContain("quoteSafetyCheck(acc.id)");
    expect(src).toContain("owner_charge_inc_gst: charge.ownerChargeIncGst");
    expect(src).toContain("next_action: repeatPiesaNextAction(charge)");
  });
});

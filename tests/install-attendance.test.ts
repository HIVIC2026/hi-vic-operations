// Decision 327 (Jo 25 Oct 2026): electrician on site at the start of the install day, lined up automatically.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ATTENDANCE_CONFIRMED_EVENT, ATTENDANCE_DECLINED_EVENT, ATTENDANCE_INSTALLER_SMS_TYPE, ATTENDANCE_REMINDED_EVENT, ATTENDANCE_REQUESTED_EVENT, ATTENDANCE_SMS_TYPE,
  attendanceKey, attendanceLink, attendanceNeedsWhy, attendanceOfficeItems, attendancePageLine, attendanceReasonLabel, attendanceRequestBlocker, attendanceRequired,
  attendanceSmsText, attendanceState, attendanceReminderText, attendanceBookedText, autoConfirmOnBooking, canDoRestriction, dayAllowedByElectrician, declineBlockers,
  installerCantAttendText, reminderDue, restrictInstallDays, type AttendanceEv,
} from "../src/lib/install-attendance.core";
import { ELECTRICIAN_ATTENDANCE_CONFIRMED, ELECTRICIAN_ATTENDANCE_WAITING, installerAttendanceLine } from "../src/lib/trade-view.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import { NEEDS_TEXT } from "../src/lib/allocation.core";
import { FIXES_ONSITE_OPTION, RECTIFICATION_OUTCOMES } from "../src/lib/official-short.core";

// Tuesday 27 October 2026, 7:30am Melbourne (AEDT, UTC+11).
const START = "2026-10-26T20:30:00.000Z";
const ev = (event_type: string, created_at: string, details: Record<string, unknown> = {}, job_id = "j1"): AttendanceEv => ({ job_id, event_type, created_at, details });
const req = (at: string, booking = "b1", job = "j1") => ev(ATTENDANCE_REQUESTED_EVENT, at, { booking_id: booking }, job);

describe("when the electrician is needed", () => {
  test("the decision-314 tick, or the official third outcome", () => {
    expect(attendanceRequired({ fixesWork: FIXES_ONSITE_OPTION })).toBe(true);
    expect(attendanceRequired({ rectificationOutcome: RECTIFICATION_OUTCOMES[2] })).toBe(true);
    expect(attendanceRequired({ fixesWork: "Install RCD safety switches" })).toBe(false);
    expect(attendanceRequired({})).toBe(false);
  });
  test("asked once per booking; a moved day is a new booking", () => {
    const ok = { deleted: false, required: true, bookingConfirmed: true, startAhead: true, alreadyRequested: false, electricianAssigned: true };
    expect(attendanceRequestBlocker(ok)).toBeNull();
    expect(attendanceRequestBlocker({ ...ok, alreadyRequested: true })).toMatch(/already/);
    expect(attendanceRequestBlocker({ ...ok, required: false })).toMatch(/doesn't need/);
    expect(attendanceRequestBlocker({ ...ok, bookingConfirmed: false })).toMatch(/no confirmed/);
    expect(attendanceRequestBlocker({ ...ok, electricianAssigned: false })).toMatch(/no electrician/);
    expect(attendanceKey("j1", "b1")).not.toBe(attendanceKey("j1", "b2"));
  });
});

describe("wording (verbatim)", () => {
  test("page line, text, reminder, booked", () => {
    expect(attendancePageLine({ address: "12 Smith St, Frankston", startIso: START })).toBe("You're needed at the start of the install at 12 Smith St, Frankston on Tuesday 27 October at 7:30am.");
    const link = attendanceLink("https://x.test/", "j1");
    expect(link).toBe("https://x.test/field/j1#install-attendance");
    expect(attendanceSmsText({ address: "12 Smith St, Frankston", startIso: START, link })).toBe(`You're needed at the start of the install at 12 Smith St, Frankston on Tuesday 27 October at 7:30am. Please confirm on your job page: ${link}`);
    expect(attendanceReminderText({ address: null, startIso: START, link })).toMatch(/^Reminder: You're needed at the start of the install at the property/);
    expect(attendanceBookedText({ address: "12 Smith St, Frankston", startIso: START, link })).toMatch(/a day you said you can do/);
  });
  test("installer alert", () => {
    expect(installerCantAttendText({ wasStartIso: START, reason: attendanceReasonLabel("sick", null), days: ["2026-10-29", "2026-10-28"] }))
      .toBe("The electrician can't make Tuesday 27 October (Sick). Offer the owner new install days — they can do: Wednesday 28 October, Thursday 29 October.");
    expect(attendanceReasonLabel("other", " Van broke ")).toBe("Van broke");
    expect(attendanceReasonLabel("short_notice", null)).toBe("Too short notice");
  });
  test("installer line labels", () => {
    expect(installerAttendanceLine("confirmed")).toBe(ELECTRICIAN_ATTENDANCE_CONFIRMED);
    expect(ELECTRICIAN_ATTENDANCE_CONFIRMED).toBe("Electrician confirmed for the start of the install");
    expect(installerAttendanceLine("waiting")).toBe(ELECTRICIAN_ATTENDANCE_WAITING);
    expect(ELECTRICIAN_ATTENDANCE_WAITING).toBe("Waiting for the electrician to confirm");
    expect(installerAttendanceLine(null)).toBeNull();
  });
});

describe("Can't make it: reason + days", () => {
  const allowed = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
  const base = { reason: "sick", otherText: null, noDays: false, allowed, bookedDay: "2026-10-27" };
  test("needs a reason and 1–5 days inside the window, never the released day", () => {
    expect(declineBlockers({ ...base, days: ["2026-10-28"] })).toEqual([]);
    expect(declineBlockers({ ...base, reason: null, days: ["2026-10-28"] })).toContain("Please pick a reason.");
    expect(declineBlockers({ ...base, reason: "other", days: ["2026-10-28"] })).toContain("Please say why.");
    expect(declineBlockers({ ...base, days: [] })).toContain("Please pick at least 1 day you can do.");
    expect(declineBlockers({ ...base, days: ["2026-10-27"] }).join(" ")).toMatch(/other than the day/);
    expect(declineBlockers({ ...base, days: ["2026-12-01"] }).join(" ")).toMatch(/outside the 30-day window/);
    expect(declineBlockers({ ...base, days: ["a", "b", "c", "d", "e", "f"] }).join(" ")).toMatch(/no more than 5/);
    expect(declineBlockers({ ...base, days: [], noDays: true })).toEqual([]);
  });
  test("the job's days are limited to the electrician's until they confirm a later booking", () => {
    const decl = ev(ATTENDANCE_DECLINED_EVENT, "2026-10-25T02:00:00Z", { booking_id: "b1", can_do_days: ["2026-10-29", "2026-10-28"] });
    const r = canDoRestriction([req("2026-10-25T01:00:00Z"), decl]);
    expect(r?.days).toEqual(["2026-10-28", "2026-10-29"]);
    expect(restrictInstallDays(allowed, r)).toEqual(["2026-10-28", "2026-10-29"]);
    expect(restrictInstallDays(allowed, null)).toEqual(allowed);
    expect(dayAllowedByElectrician("2026-10-29T20:30:00Z", r)).toBe(false); // 30 Oct in Melbourne
    expect(dayAllowedByElectrician("2026-10-28T20:30:00Z", r)).toBe(true); // 29 Oct in Melbourne
    expect(autoConfirmOnBooking("2026-10-28T20:30:00Z", r)).toBe(true);
    expect(autoConfirmOnBooking("2026-10-28T20:30:00Z", null)).toBe(false);
    expect(canDoRestriction([decl, ev(ATTENDANCE_CONFIRMED_EVENT, "2026-10-25T05:00:00Z", { booking_id: "b2", auto: true })])).toBeNull();
    expect(canDoRestriction([ev(ATTENDANCE_DECLINED_EVENT, "2026-10-25T02:00:00Z", { booking_id: "b1", can_do_days: [], no_days: true })])).toBeNull();
  });
});

describe("answers, reminder and Needs me", () => {
  const now = (h: number) => new Date(Date.parse("2026-10-25T00:00:00Z") + h * 3_600_000);
  test("latest answer for the booking wins", () => {
    const evs = [req("2026-10-25T00:00:00Z"), ev(ATTENDANCE_DECLINED_EVENT, "2026-10-25T01:00:00Z", { booking_id: "b1" }), ev(ATTENDANCE_CONFIRMED_EVENT, "2026-10-25T02:00:00Z", { booking_id: "b1" })];
    expect(attendanceState(evs, "b1")?.state).toBe("confirmed");
    expect(attendanceState(evs, "b2")).toBeNull();
    expect(attendanceState([req("2026-10-25T00:00:00Z")], "b1")?.state).toBe("waiting");
  });
  test("one reminder at 24h", () => {
    const s = attendanceState([req("2026-10-25T00:00:00Z")], "b1");
    expect(reminderDue(s, now(23), true)).toBe(false);
    expect(reminderDue(s, now(24), true)).toBe(true);
    const s2 = attendanceState([req("2026-10-25T00:00:00Z"), ev(ATTENDANCE_REMINDED_EVENT, "2026-10-26T00:00:00Z", { booking_id: "b1" })], "b1");
    expect(reminderDue(s2, now(30), true)).toBe(false);
  });
  test("Needs me only at 48h with no answer, or when no day is possible; one row per job", () => {
    const cur = new Set(["b1"]);
    expect(attendanceOfficeItems([req("2026-10-25T00:00:00Z")], cur, now(47))).toEqual([]);
    const items = attendanceOfficeItems([req("2026-10-25T00:00:00Z"), ev(ATTENDANCE_REMINDED_EVENT, "2026-10-26T00:00:00Z", { booking_id: "b1" })], cur, now(48));
    expect(items.map((i) => [i.jobId, i.reason, i.key])).toEqual([["j1", "no_answer", "electrician_install_attendance:j1"]]);
    // A moved day (booking no longer current) or an answer drops it.
    expect(attendanceOfficeItems([req("2026-10-25T00:00:00Z")], new Set(), now(60))).toEqual([]);
    expect(attendanceOfficeItems([req("2026-10-25T00:00:00Z"), ev(ATTENDANCE_CONFIRMED_EVENT, "2026-10-25T10:00:00Z", { booking_id: "b1" })], cur, now(60))).toEqual([]);
    // "Can't make it" with days = no office row (the installer re-offers); with no day possible = one row until re-asked.
    const declDays = ev(ATTENDANCE_DECLINED_EVENT, "2026-10-25T01:00:00Z", { booking_id: "b1", can_do_days: ["2026-10-28"], no_days: false });
    expect(attendanceOfficeItems([req("2026-10-25T00:00:00Z"), declDays], new Set(), now(60))).toEqual([]);
    const declNone = ev(ATTENDANCE_DECLINED_EVENT, "2026-10-25T01:00:00Z", { booking_id: "b1", can_do_days: [], no_days: true });
    expect(attendanceOfficeItems([req("2026-10-25T00:00:00Z"), declNone], new Set(), now(2)).map((i) => i.reason)).toEqual(["no_days"]);
    expect(attendanceOfficeItems([req("2026-10-25T00:00:00Z"), declNone, req("2026-10-25T05:00:00Z", "b2")], new Set(["b2"]), now(6))).toEqual([]);
    expect(attendanceNeedsWhy("HV-1234")).toBe("Electrician can't attend / hasn't confirmed install-day attendance – HV-1234");
    expect(NEEDS_TEXT.electrician_install_attendance.why).toBe("Electrician can't attend / hasn't confirmed install-day attendance");
  });
});

describe("SMS types (route approved by Jo, decision 327)", () => {
  test("partner, approved, quiet hours, one-off event freshness", () => {
    for (const t of [ATTENDANCE_SMS_TYPE, ATTENDANCE_INSTALLER_SMS_TYPE]) {
      expect(SMS_MESSAGE_TYPES[t]).toMatchObject({ audience: "partner", wordingApproved: true, quietHours: true });
      expect(SMS_FRESHNESS[t]).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
    }
  });
});

describe("source pins", () => {
  const server = readFileSync("src/lib/install-attendance.server.ts", "utf8");
  test("request recorded before any send; TEST → test-send; real → sendRealSms; no raw gateway", () => {
    const onBooked = server.slice(server.indexOf("export async function onInstallBooked"), server.indexOf("async function previousStart"));
    expect(onBooked.indexOf("ATTENDANCE_REQUESTED_EVENT")).toBeLessThan(onBooked.indexOf("await text("));
    expect(server).toContain("sendTestSms");
    expect(server).toContain("sendRealSms");
    expect(server).not.toMatch(/twilio|fetch\(/i);
    const sweep = server.slice(server.indexOf("export async function sweepElectricianAttendance"));
    expect(sweep.indexOf("ATTENDANCE_REMINDED_EVENT")).toBeLessThan(sweep.indexOf("attendanceReminderText"));
    const tell = server.slice(server.indexOf("async function tellInstaller"));
    expect(tell.indexOf("ATTENDANCE_INSTALLER_TOLD_EVENT, `")).toBeLessThan(tell.indexOf("return text("));
  });
  test("Can't make it releases the day through the ONE install-day change path", () => {
    expect(server).toContain('changeInstallDay(jobId, userId, "electrician", { electricianCantAttend: reason })');
    const days = readFileSync("src/lib/install-days.server.ts", "utf8");
    expect(days).toContain('who: "installer" | "owner" | "electrician"');
    expect(days).toContain("windowDays(c)");
    expect(days.match(/dayAllowedByElectrician\(p\.starts_at, c\.limit\)/g)?.length).toBe(2);
    expect(days).not.toMatch(/from "\.\/install-attendance\.server"|import\("\.\/install-attendance\.server"\)/);
  });
  test("confirmBooking asks after an installation booking; the tick sweeps", () => {
    expect(readFileSync("src/lib/booking.server.ts", "utf8")).toContain('(await import("./install-attendance.server")).onInstallBooked(jobId, actorId)');
    expect(readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8")).toContain("sweepElectricianAttendance");
  });
  test("trade reads + answer through trade-view.server, electricians only; literal server-fn chains", () => {
    const tv = readFileSync("src/lib/trade-view.server.ts", "utf8");
    const fn = tv.slice(tv.indexOf("export async function tradeInstallAttendance"), tv.indexOf("// ---- Decision 317"));
    expect(fn.match(/requireJobElectrician\(jobId, userId\)/g)?.length).toBe(2);
    const f = readFileSync("src/lib/trade-view.functions.ts", "utf8");
    expect(f).toMatch(/export const getTradeInstallAttendance = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)\s*\.inputValidator/);
    expect(f).toMatch(/export const answerTradeInstallAttendance = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)\s*\.inputValidator/);
  });
  test("Needs me reads the pure rule; the decision-314 line is gone", () => {
    const needs = readFileSync("src/lib/needs.server.ts", "utf8");
    expect(needs).toContain("attendanceOfficeItems(");
    expect(needs).not.toContain('"electrician_onsite_install_start"');
    expect(readFileSync("src/lib/ready-check-chase.core.ts", "utf8")).not.toContain('code: "electrician_onsite_install_start"');
  });
});

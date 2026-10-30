// Decision 193 build: the four approved installer texts (decisions 79, 82, 83, 99) and the approved 6:30am wording.
// Pure wording (verbatim from docs/JO_DECISIONS_LOG.md after the brand prefix), keys, timing and the SMS registry, plus
// wiring checks on the server modules (triggers, tick, no provider calls). Nothing is sent. Run: bun test tests/installer-texts.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  INSTALLER_TEXT_EVENT, INSTALL_TOMORROW_FROM_HM, bookedStillCurrent, daysSuggestedStillCurrent, installTomorrowDue, installTomorrowKey, installTomorrowText, installerTextAddress,
  melbourneClock, melbourneDayDate, readyCheckBookedInstallerKey, readyCheckBookedInstallerText, readyCheckDaysSuggestedKey, readyCheckDaysSuggestedText, tomorrowMelbourneYmd,
  teamMemberInviteKey, teamMemberInviteText, teamMemberJoinLink,
} from "../src/lib/installer-texts.core";
import { readyCheckIncompleteText } from "../src/lib/ready-check-chase.core";
import { dailyText, type DayJob } from "../src/lib/daily-mitti-text.core";
import { SMS_BRAND_PREFIX, SMS_FRESHNESS, SMS_MESSAGE_TYPES, brandSmsBody, smsBlocker, smsStaleReason } from "../src/lib/sms.core";

const LINK = "https://estimate.homeinsulationvictoria.com.au/field/job-1";
const gsm = (s: string) => /^[\x20-\x7E]+$/.test(s);
const log = readFileSync("docs/JO_DECISIONS_LOG.md", "utf8");

describe("wording verbatim from the decisions log (brand prefix added by the sender)", () => {
  test("decision 79: owner suggested other Ready Check days", () => {
    const t = readyCheckDaysSuggestedText({ suburb: "Frankston", jobNumber: "HV-3117", link: LINK });
    expect(brandSmsBody(t)).toBe(`Home Insulation Victoria: The owner at Frankston (HV-3117) suggested other days for their Ready Check. Tap to pick one and set a time: ${LINK}`);
    expect(log).toContain('"Home Insulation Victoria: The owner at {Suburb} ({HV-number}) suggested other days for their Ready Check. Tap to pick one and set a time: {link}"');
    expect(gsm(brandSmsBody(t))).toBe(true);
    expect(readyCheckDaysSuggestedText({ suburb: null, jobNumber: "HV-1", link: LINK })).toStartWith("The owner at the property (HV-1)");
  });
  test("decision 82, installer booked (A)", () => {
    const t = readyCheckBookedInstallerText({ startIso: "2026-10-27T22:00:00.000Z", address: "12 Smith St, Frankston", jobNumber: "HV-3117", link: LINK }); // 9am Wed 28 Oct Melbourne (AEDT)
    expect(brandSmsBody(t)).toBe(`Home Insulation Victoria: Booked: Ready Check Wednesday 28 October 9am, 12 Smith St, Frankston (HV-3117). Owner details on the job: ${LINK}`);
    expect(log).toContain('Installer booked (A): "Home Insulation Victoria: Booked: Ready Check {Day Date} {time}, {address} ({HV-number}). Owner details on the job: {link}"');
    expect(gsm(brandSmsBody(t))).toBe(true);
  });
  test("decision 99, installer day before", () => {
    const t = installTomorrowText({ startIso: "2026-10-27T21:30:00.000Z", address: "12 Smith St, Frankston", jobNumber: "HV-3117", link: LINK });
    expect(brandSmsBody(t)).toBe(`Home Insulation Victoria: Install tomorrow 8:30am, 12 Smith St, Frankston (HV-3117). Job + forms: ${LINK}`);
    expect(log).toContain('Installer day before: "Home Insulation Victoria: Install tomorrow {time}, {address} ({HV}). Job + forms: {link}"');
    expect(gsm(brandSmsBody(t))).toBe(true);
  });
  test("decision 83, missing answers ('Nearly there')", () => {
    const t = readyCheckIncompleteText("HV-3117", "12 Smith St, Frankston", ["the ceiling area", "a photo of the hatch"]);
    expect(brandSmsBody(t)).toBe("Home Insulation Victoria: Nearly there! HV-3117 (12 Smith St, Frankston) still needs: the ceiling area; a photo of the hatch. Add them in Mitti and we'll prepare the owner's quote.");
    expect(log).toContain(`Missing answers: "Home Insulation Victoria: Nearly there! {HV} ({address}) still needs: {items}. Add them in Mitti and we'll prepare the owner's quote."`);
  });
  test("decision 83, 6:30am morning text", () => {
    const j = (id: string, start: string, street: string, suburb: string): DayJob => ({ jobId: id, bookingId: `b${id}`, start, end: null, street, suburb, status: "confirmed", link: `https://app.au.mitti.com/inspections/${id}` });
    const t = dailyText([j("2", "2026-10-28T00:00:00Z", "5 Hill Rd", "Werribee"), j("1", "2026-10-27T21:00:00Z", "12 Smith St", "Frankston")], "https://x/field");
    expect(brandSmsBody(t)).toBe("Home Insulation Victoria: Good morning! Your jobs today: 1) 8am, 12 Smith St Frankston: https://app.au.mitti.com/inspections/1 2) 11am, 5 Hill Rd Werribee: https://app.au.mitti.com/inspections/2 Tap a link to open its Mitti form.");
    expect(log).toContain('Morning (6:30am): "Home Insulation Victoria: Good morning! Your jobs today: 1) {time}, {short address}: {Mitti link} 2) … Tap a link to open its Mitti form."');
    expect(t).not.toMatch(/\bHIV\b|–\d|am–|pm–/); // no retired name, no two-hour windows
  });
  test("labels and address helper", () => {
    expect(melbourneDayDate("2026-10-27T22:00:00.000Z")).toBe("Wednesday 28 October");
    expect(melbourneClock("2026-10-27T22:00:00.000Z")).toBe("9am");
    expect(melbourneClock("2026-06-15T03:15:00.000Z")).toBe("1:15pm"); // AEST
    expect(installerTextAddress("12 Smith St, Frankston VIC 3199", "Frankston")).toBe("12 Smith St, Frankston");
    expect(installerTextAddress(null, " Werribee ")).toBe("Werribee");
    expect(installerTextAddress(null, null)).toBeNull();
    expect(readyCheckBookedInstallerText({ startIso: "2026-10-27T22:00:00.000Z", address: null, jobNumber: "HV-1", link: LINK })).toContain(", address on the job (HV-1).");
  });
});

describe("SMS registry (decisions 165/174): partner types, quiet hours, freshness", () => {
  test("three new partner types, approved, quiet hours on", () => {
    for (const t of ["ready_check_days_suggested", "ready_check_booked_installer", "install_tomorrow"] as const) {
      expect(SMS_MESSAGE_TYPES[t]).toMatchObject({ audience: "partner", wordingApproved: true, quietHours: true });
      const base = { type: t, to: "0412 345 678", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-10-26T02:00:00.000Z" };
      expect(smsBlocker(base)).toBeNull();
      expect(smsBlocker({ ...base, commsEnabled: false })).toContain("switched off");
      expect(smsBlocker({ ...base, typeSwitchOn: false })).toContain("switched off");
      expect(smsBlocker({ ...base, consent: false })).toBe("Partner is not approved and active");
      expect(smsBlocker({ ...base, isTestRecord: true })).toContain("TEST");
      expect(smsBlocker({ ...base, nowIso: "2026-10-26T11:30:00.000Z" })).toMatch(/quiet|8pm|7am/i); // 10:30pm Melbourne
    }
    expect(SMS_MESSAGE_TYPES.ready_check_incomplete.wordingApproved).toBe(true);
    expect(SMS_MESSAGE_TYPES.daily_mitti.wordingApproved).toBe(true);
  });
  test("79/82 are one-off event texts (24h, must still be current); 99 is a window text keyed by booking + date", () => {
    for (const t of ["ready_check_days_suggested", "ready_check_booked_installer"] as const) {
      expect(SMS_FRESHNESS[t]).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
      expect(smsStaleReason(t, { at: "2026-10-26T01:00:00.000Z" }, "2026-10-26T02:00:00.000Z")).toBeNull();
      expect(smsStaleReason(t, { at: "2026-10-24T01:00:00.000Z" }, "2026-10-26T02:00:00.000Z")).toMatch(/Too late/);
      expect(smsStaleReason(t, { at: "2026-10-26T01:00:00.000Z", current: false }, "2026-10-26T02:00:00.000Z")).toMatch(/no longer current/);
      expect(smsStaleReason(t, undefined, "2026-10-26T02:00:00.000Z")).toMatch(/No triggering event/);
    }
    expect(SMS_FRESHNESS.install_tomorrow).toEqual({ kind: "window" });
    expect(smsStaleReason("install_tomorrow", undefined, "2026-10-26T02:00:00.000Z")).toBeNull();
  });
  test("keys: one per trigger", () => {
    expect(readyCheckDaysSuggestedKey("j1", "ev1")).toBe("rc-days-suggested:v1:j1:ev1");
    expect(readyCheckDaysSuggestedKey("j1", "ev1")).not.toBe(readyCheckDaysSuggestedKey("j1", "ev2"));
    expect(readyCheckBookedInstallerKey("j1", "2026-10-27T22:00:00.000Z")).toBe("rc-booked-installer:v1:j1:2026-10-27T22:00:00.000Z");
    expect(installTomorrowKey("j1", "b1", "2026-10-27T22:00:00.000Z")).toBe("install-tomorrow:v1:j1:b1:2026-10-28"); // Melbourne date
    expect(installTomorrowKey("j1", "b1", "2026-10-27T22:00:00.000Z")).toBe(installTomorrowKey("j1", "b1", "2026-10-28T03:00:00.000Z"));
    expect(INSTALLER_TEXT_EVENT).toBe("installer_text_prepared");
  });
});

describe("timing and currency rules", () => {
  const start = "2026-10-27T22:00:00.000Z"; // Wed 28 Oct 9am Melbourne
  test("install tomorrow: due from 16:00 Melbourne the day before only", () => {
    expect(INSTALL_TOMORROW_FROM_HM).toBe("16:00");
    expect(installTomorrowDue(new Date("2026-10-27T04:59:00.000Z"), start)).toBe(false); // Tue 27 Oct 15:59
    expect(installTomorrowDue(new Date("2026-10-27T05:00:00.000Z"), start)).toBe(true); // Tue 27 Oct 16:00
    expect(installTomorrowDue(new Date("2026-10-27T10:00:00.000Z"), start)).toBe(true); // Tue 27 Oct 21:00 (the sender's quiet hours hold it)
    expect(installTomorrowDue(new Date("2026-10-26T05:00:00.000Z"), start)).toBe(false); // two days before
    expect(installTomorrowDue(new Date("2026-10-27T21:00:00.000Z"), start)).toBe(false); // the morning of the install
    expect(tomorrowMelbourneYmd(new Date("2026-10-27T13:30:00.000Z"))).toBe("2026-10-29"); // 00:30 Wed 28 Oct Melbourne → Thu
    expect(tomorrowMelbourneYmd(new Date("2026-10-27T05:00:00.000Z"))).toBe("2026-10-28"); // 16:00 Tue 27 Oct Melbourne → Wed
  });
  test("79 is current only while it is the installer's move on the owner's days; 82 only while that start is booked", () => {
    expect(daysSuggestedStillCurrent("installer_to_answer")).toBe(true);
    for (const t of ["booked", "owner_to_answer", "installer_to_offer", "no_installer"]) expect(daysSuggestedStillCurrent(t)).toBe(false);
    expect(bookedStillCurrent(start, start)).toBe(true);
    expect(bookedStillCurrent("2026-10-27T22:00:00+00:00", start)).toBe(true);
    expect(bookedStillCurrent(null, start)).toBe(false);
    expect(bookedStillCurrent("2026-10-28T22:00:00.000Z", start)).toBe(false);
  });
});

describe("wiring: triggers, tick, guarded senders only", () => {
  test("ready-check-times.server: 79 after the owner's suggestion, 82 on every our-lead booking path", () => {
    const s = readFileSync("src/lib/ready-check-times.server.ts", "utf8");
    const suggest = s.slice(s.indexOf("export async function ownerSuggestReadyCheckDays"), s.indexOf("export async function ownerChangeReadyCheck"));
    expect(suggest.indexOf('"ready_check_days_suggested"')).toBeGreaterThan(0);
    expect(suggest.indexOf("tellInstallerDaysSuggested(")).toBeGreaterThan(suggest.indexOf('"ready_check_days_suggested"'));
    const agreed = s.slice(s.indexOf("async function bookAgreedTime"), s.indexOf("async function claim"));
    expect(agreed.indexOf("tellBookedKeepGoing(jobId, startsAt)")).toBeGreaterThan(agreed.indexOf("confirmBooking(jobId"));
    expect(s.slice(s.indexOf("async function tellBookedKeepGoing"))).toMatch(/tellOwnerBooked\(jobId, startsAt\); await tellInstallerBooked\(jobId, startsAt\)[\s\S]*waitUntil/);
    const change = s.slice(s.indexOf("export async function installerChangeReadyCheck"), s.indexOf("export async function installerOpenReadyCheckDays"));
    expect(change).toContain("tellBookedKeepGoing(jobId, start)");
    expect(s).toContain("export const readyCheckTurnFor");
  });
  test("15-minute tick runs sweepInstallerTexts; the old Mitti-link booked text skips our leads", () => {
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    expect(tick).toContain('import("@/lib/installer-texts.server")');
    expect(tick).toContain("sweepInstallerTexts()");
    const dm = readFileSync("src/lib/daily-mitti-text.server.ts", "utf8");
    const old = dm.slice(dm.indexOf("export async function sweepReadyCheckBookedTexts"), dm.indexOf("async function refreshDelivery"));
    expect(old).toContain('if (job.channel === "hivic_sourced") { out.skipped++; continue; }');
  });
  test("server module: records the prepared event, uses only test-send / sendRealSms, never a provider; not on the auto-advance graph", () => {
    const srv = readFileSync("src/lib/installer-texts.server.ts", "utf8");
    expect(srv).not.toMatch(/resendSend\(|fetch\(|twilio/i);
    for (const t of ["sendTestSms", "sendRealSms", "INSTALLER_TEXT_EVENT", "alreadyPrepared(", "allocatedPersonFor(jobId, \"install\")", "dailyTextRecipient("]) expect(srv).toContain(t);
    // Each text records its event before deliver(): the event write precedes the send in every function.
    for (const fn of ["textInstallerOwnerSuggestedDays", "textInstallerReadyCheckBooked", "textInstallerInstallTomorrow"]) {
      const start = srv.indexOf(`export async function ${fn}`);
      const body = srv.slice(start, srv.indexOf("export async function", start + 10));
      expect(body.indexOf("logEvent(")).toBeGreaterThan(0);
      expect(body.indexOf("return deliver(")).toBeGreaterThan(body.indexOf("logEvent("));
    }
    expect(readFileSync("src/lib/autoadvance.server.ts", "utf8")).not.toContain("installer-texts");
    expect(readFileSync("src/lib/sms.server.ts", "utf8")).not.toMatch(/retry|fallback connection/i);
  });
  test("brand prefix constant unchanged", () => expect(SMS_BRAND_PREFIX).toBe("Home Insulation Victoria: "));
});

describe("decision 251: team member added → their single-use login link (wording approved as written, decision 252)", () => {
  const JOIN = "https://estimate.homeinsulationvictoria.com.au/join/abc123";
  test("wording verbatim from decision 251 (brand prefix added by the sender)", () => {
    const t = teamMemberInviteText({ business: "Singh Insulation", link: JOIN });
    expect(t).toBe(`Singh Insulation added you to Home Insulation Victoria. Set up your login: ${JOIN}`);
    expect(brandSmsBody(t)).toBe(`Home Insulation Victoria: Singh Insulation added you to Home Insulation Victoria. Set up your login: ${JOIN}`);
    expect(log).toContain('"{Business} added you to Home Insulation Victoria. Set up your login: {link}"');
    expect(gsm(brandSmsBody(t))).toBe(true);
    expect(teamMemberInviteText({ business: " ", link: JOIN })).toStartWith("Your business added you");
    expect(teamMemberJoinLink("https://estimate.homeinsulationvictoria.com.au/", "abc123")).toBe(JOIN);
  });
  test("registry: partner audience, approved, quiet hours, one-off event (24h, invite still active), key per link + mobile", () => {
    expect(SMS_MESSAGE_TYPES.team_member_invite).toMatchObject({ audience: "partner", wordingApproved: true, quietHours: true });
    const base = { type: "team_member_invite", to: "0466 777 888", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-10-26T02:00:00.000Z" };
    expect(smsBlocker(base)).toBeNull();
    expect(smsBlocker({ ...base, typeSwitchOn: false })).toContain("switched off");
    expect(smsBlocker({ ...base, commsEnabled: false })).toContain("switched off");
    expect(smsBlocker({ ...base, isTestRecord: true })).toContain("TEST");
    expect(SMS_FRESHNESS.team_member_invite).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
    expect(smsStaleReason("team_member_invite", { at: "2026-10-26T01:59:00.000Z", current: false }, "2026-10-26T02:00:00.000Z")).toMatch(/no longer current/);
    expect(teamMemberInviteKey("inv-1", "+61466777888")).toBe("team-member-invite:v1:inv-1:+61466777888");
    expect(teamMemberInviteKey("inv-1", "+61466777888")).not.toBe(teamMemberInviteKey("inv-2", "+61466777888"));
  });
  test("wiring: createWorkerInvite texts only when a mobile is given and still returns the token; TEST → test-send; guarded sender only", () => {
    const fn = readFileSync("src/lib/worker-invite.functions.ts", "utf8");
    const create = fn.slice(fn.indexOf("export const createWorkerInvite"), fn.indexOf("export const revokeWorkerInvite"));
    expect(create).toContain("data.mobile?.trim()");
    expect(create).toContain("textTeamMemberInvite(");
    expect(create).toContain("return { token, text }");
    expect(create.indexOf("requireMember(")).toBeLessThan(create.indexOf("textTeamMemberInvite("));
    const srv = readFileSync("src/lib/installer-texts.server.ts", "utf8");
    const body = srv.slice(srv.indexOf("export async function textTeamMemberInvite"), srv.indexOf("/** 15-minute tick"));
    expect(body.indexOf("isTestPartner(")).toBeLessThan(body.indexOf("sendRealSms("));
    expect(body).toContain("sendTestSms(");
    expect(body).toContain('type: "team_member_invite", idempotencyKey: teamMemberInviteKey(p.inviteId, to)');
    expect(body).not.toMatch(/fetch\(|twilio/i);
  });
});

// Deep Part 5a (Jo 4–5 Nov 2026): the GO / DON'T START email to every installer business's office (own customers and
// Home Insulation Victoria leads) lists EVERY pre-start blocker in plain words — one pure mapping (go-email.core
// tradeSafeFailureLine) from each office GO-check line to the line the trade reads. Jo's own GO / DON'T START wording
// ("GO for {address} tomorrow …", "DON'T START at {address} … Fix these first …") is built in as V2 behind
// GO_EMAIL_V2_APPROVED = false: the approved 4 Nov frame keeps sending until Jo approves the rendered V2. Nothing else
// changes: slots, keys, info@ copy, trade pause and TEST routing are the Part 9 Task 7 sender's.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { GO_EMAIL_PLAIN, GO_EMAIL_V2_APPROVED, GO_EMAIL_V2_TEXT, goEmail, tradeSafeFailureLine, tradeSafeFailures } from "../src/lib/go-email.core";
import { CERTIFICATE_NOT_IN_YET, ELECTRICIAN_NOT_CONFIRMED, GO_CHECK_NOT_COMPLETED, LEAD_NOT_ESC_REGISTERED, LIFE_SUPPORT_PLAN_MISSING, classifyPrestartFailures, prestartFailures, type PrestartFacts, type PrestartFailure } from "../src/lib/prestart.core";
import { COLLECTION_NOTICE_BLOCK_MESSAGE } from "../src/lib/esc-collection-notice.core";
import { SITE_HOLD_BLOCKER } from "../src/lib/site-conditions.core";
import { coesOfficeLine } from "../src/lib/coes-check.core";

const START = "2026-11-11T21:00:00Z"; // Thu 12 Nov 2026 8:00am Melbourne (AEDT)
const NOW = new Date("2026-11-11T03:00:00Z"); // Wed 11 Nov 2pm
const fx = (line: string): PrestartFailure => ({ line, cls: "fixable" });
const mv = (line: string): PrestartFailure => ({ line, cls: "must_move" });
const base = { jobNumber: "HV-1234", address: "12 Example St, Box Hill 3128", startIso: START, lead: "John Smith", crew: ["Sam Lee", "Ali Khan"], link: "https://p/field/J1" };

/** Facts that trip every line prestartFailures can produce (one run; the lead branch is one of several, so a second run covers the rest). */
function everything(): PrestartFacts {
  return {
    start: START,
    clearance: { cleared: false, blocker: "PIESA not complete" },
    deadline: "2026-11-01",
    esc: { status: "sent", sent_at: "2026-11-11T20:00:00Z", submission_reference: "R1", scheduled_start: START },
    lead: { found: true, status: "verified", level: "full", expiresOn: "2027-01-01", name: "Lee", noticeAcknowledged: false, whiteCard: "missing", escRegistered: false },
    consentBlockers: ["Owner ESC consent not generated – must be signed by 11/11/2026, 8:00:00 am (24h before start)"],
    piesaCompletedAt: null,
    readyCheckWorksBlockers: ["main ceiling"],
    siteHoldBlockers: [SITE_HOLD_BLOCKER],
    businessDocsBlocker: "Public liability insurance not on file. Upload it under My business.",
    swmsBlocker: "Safety plan not signed: Sam Lee",
    bookingCreatedAt: "2026-11-01T00:00:00Z",
    installDepositBlocker: "Install deposit not paid",
    piesaCopyBlockers: ["Signed PIESA copy delivery to owner must be recorded by 11/11/2026, 8:00:00 am", "Updated PIESA (with Part C) not delivered to the installer by 11/11/2026, 8:00:00 am"],
    piesaCopyReceiptBlocker: null,
    certificate: "unchecked",
    certificateWhy: "the AI couldn't read it",
    electricianAttendance: { required: true, state: "waiting" },
    lifeSupportPlanMissing: true,
  };
}

const OFFICE_VOICE = /office-verified|re-record|is recorded for this job|marked submitted|PIISA|\bHIV\b|[Ll]ead installer\b|\bfixes\b|could not be read|run it again/;

describe("every pre-start blocker reads plainly to the trade", () => {
  test("every line of a fully-failing check maps to a plain line (no office voice, Lead Installer in full), and a second run covers the other Lead branches", () => {
    const lines = [
      ...prestartFailures(everything()),
      ...prestartFailures({ ...everything(), lead: { found: false, status: null, level: null, expiresOn: null, name: null }, esc: null, piesaCompletedAt: "2026-09-01T00:00:00Z", certificate: "missing", consentBlockers: ["Owner ESC consent was completed less than 24h before start – reschedule", "Owner ESC consent is stale for the current booking – new consent required", "Owner ESC consent not complete (owner + AP representative) – must be signed by 11/11/2026, 8:00:00 am"] }),
      ...prestartFailures({ ...everything(), lead: { found: true, status: "pending", level: null, expiresOn: null, name: "Lee" }, esc: { status: "sent", sent_at: "2026-11-01T00:00:00Z", submission_reference: "R1", scheduled_start: START } }),
      ...prestartFailures({ ...everything(), lead: { found: true, status: "verified", level: null, expiresOn: null, name: "Lee" }, escReadError: "relation missing" }),
      ...prestartFailures({ ...everything(), lead: { found: true, status: "verified", level: "provisional", expiresOn: "2027-01-01", name: "Lee" }, deadline: null }),
      ...prestartFailures({ ...everything(), lead: { found: true, status: "verified", level: "full", expiresOn: "2026-01-01", name: "Lee" } }),
      GO_CHECK_NOT_COMPLETED("TypeError"),
      "Installer business: Couldn't read insurance records: boom",
    ];
    expect(lines.length).toBeGreaterThan(25);
    for (const line of lines) {
      const plain = tradeSafeFailureLine(line);
      expect({ line, plain }).toEqual({ line, plain: expect.not.stringMatching(OFFICE_VOICE) });
      expect(plain.length).toBeGreaterThan(10);
    }
    // The known office lines each get their own plain wording (not a pass-through).
    expect(tradeSafeFailureLine("Install deposit not paid")).toBe(GO_EMAIL_PLAIN.depositNotPaid);
    expect(tradeSafeFailureLine("Electrical clearance is not valid: PIESA not complete")).toBe(GO_EMAIL_PLAIN.notCleared("PIESA not complete"));
    expect(tradeSafeFailureLine("The 30-day window ended on 2026-11-01. New PIESA needed.")).toBe(GO_EMAIL_PLAIN.windowEnded("2026-11-01"));
    expect(tradeSafeFailureLine("No 30-day window date is recorded.")).toBe(GO_EMAIL_PLAIN.windowUnknown);
    expect(tradeSafeFailureLine("ESC notification was sent less than 24h before start – reschedule.")).toBe(GO_EMAIL_PLAIN.escTooLate);
    expect(tradeSafeFailureLine("ESC notification is too early – it may be sent no earlier than 5 days before work (6/11/2026, 8:00:00 am).")).toBe(GO_EMAIL_PLAIN.escTooEarly);
    expect(tradeSafeFailureLine("Lead installer Lee holds a provisional certification, not full.")).toBe(GO_EMAIL_PLAIN.leadCertProvisional("Lee"));
    expect(tradeSafeFailureLine("Lead installer's certification expired on 2026-01-01.")).toBe(GO_EMAIL_PLAIN.leadCertExpired("2026-01-01"));
    expect(tradeSafeFailureLine(`Lead installer Lee: ${COLLECTION_NOTICE_BLOCK_MESSAGE}`)).toBe(GO_EMAIL_PLAIN.leadNoticeNotAcknowledged("Lee"));
    expect(tradeSafeFailureLine("Lead installer Lee: White Card not verified")).toBe(GO_EMAIL_PLAIN.leadWhiteCard("Lee"));
    expect(tradeSafeFailureLine("Owner consent: Owner ESC consent not generated – must be signed by 11/11/2026, 8:00:00 am (24h before start)")).toBe(GO_EMAIL_PLAIN.consentNotSigned("11/11/2026, 8:00:00 am"));
    expect(tradeSafeFailureLine("Owner consent: Owner ESC consent not complete (owner + AP representative) – must be signed by 11/11/2026, 8:00:00 am")).toBe(GO_EMAIL_PLAIN.consentNotComplete("11/11/2026, 8:00:00 am"));
    expect(tradeSafeFailureLine("Owner consent: Owner ESC consent is stale for the current booking – new consent required")).toBe(GO_EMAIL_PLAIN.consentStale);
    expect(tradeSafeFailureLine("Owner consent: Owner ESC consent was completed less than 24h before start – reschedule")).toBe(GO_EMAIL_PLAIN.consentTooLate);
    expect(tradeSafeFailureLine("PIESA completion date is missing.")).toBe(GO_EMAIL_PLAIN.piesaDateMissing);
    expect(tradeSafeFailureLine("The installer safety form (PIISA) can only be done within 30 days of the PIESA.")).toBe(GO_EMAIL_PLAIN.piisaWindow);
    expect(tradeSafeFailureLine("Ready Check original condition not recorded: main ceiling.")).toBe(GO_EMAIL_PLAIN.readyCheckCondition("main ceiling"));
    expect(tradeSafeFailureLine(SITE_HOLD_BLOCKER)).toBe(GO_EMAIL_PLAIN.siteHold);
    expect(tradeSafeFailureLine("Installer business: Public liability insurance not on file. Upload it under My business.")).toBe(GO_EMAIL_PLAIN.business("Public liability insurance not on file. Upload it under My business."));
    expect(tradeSafeFailureLine("Safety plan not signed: Sam Lee")).toBe(GO_EMAIL_PLAIN.swms("Sam Lee"));
    expect(tradeSafeFailureLine("Signed PIESA copy delivery to owner must be recorded by 11/11/2026, 8:00:00 am")).toBe(GO_EMAIL_PLAIN.piesaCopy("owner", "11/11/2026, 8:00:00 am"));
    expect(tradeSafeFailureLine("Signed PIESA copy delivery to installer must be recorded by 11/11/2026, 8:00:00 am")).toBe(GO_EMAIL_PLAIN.piesaCopy("installer", "11/11/2026, 8:00:00 am"));
    expect(tradeSafeFailureLine("Updated PIESA (with Part C) not delivered to the owner by 11/11/2026, 8:00:00 am")).toBe(GO_EMAIL_PLAIN.piesaCopyUpdated("owner", "11/11/2026, 8:00:00 am"));
    expect(tradeSafeFailureLine(CERTIFICATE_NOT_IN_YET)).toBe(GO_EMAIL_PLAIN.certificateNotIn);
    expect(tradeSafeFailureLine(coesOfficeLine("the AI couldn't read it"))).toBe(GO_EMAIL_PLAIN.certificateNotChecked("the AI couldn't read it"));
    expect(tradeSafeFailureLine(LEAD_NOT_ESC_REGISTERED("Lee"))).toBe(GO_EMAIL_PLAIN.leadNotEscRegistered("Lee"));
    expect(tradeSafeFailureLine(ELECTRICIAN_NOT_CONFIRMED)).toBe(GO_EMAIL_PLAIN.electricianNotConfirmed);
    expect(tradeSafeFailureLine(LIFE_SUPPORT_PLAN_MISSING)).toBe(GO_EMAIL_PLAIN.lifeSupportPlan);
    // Unknown lines still pass through with "Lead Installer" capitalised (fail open on wording, never on the check).
    expect(tradeSafeFailureLine("Something new about the lead installer")).toBe("Something new about the Lead Installer");
  });
  test("the mapping never says 'fixes', always 'electrical upgrades'; the Part C copy line names them", () => {
    expect(GO_EMAIL_PLAIN.piesaCopyUpdated("owner", "x")).toContain("electrical upgrades");
    expect(GO_EMAIL_PLAIN.certificateNotIn).toContain("electrical upgrades");
    for (const v of Object.values(GO_EMAIL_PLAIN)) expect(typeof v === "function" ? v("x", "y") : v).not.toMatch(/\bfixes\b|\bHIV\b/);
  });
  test("tradeSafeFailures keeps the order and the must-move / fixable class, folding duplicates", () => {
    const out = tradeSafeFailures([mv("ESC notices could not be read (x) — check again"), mv(GO_CHECK_NOT_COMPLETED("y")), fx("Install deposit not paid"), fx("Install deposit not paid")]);
    expect(out).toEqual([{ line: GO_EMAIL_PLAIN.couldNotCheck, cls: "must_move" }, { line: GO_EMAIL_PLAIN.depositNotPaid, cls: "fixable" }]);
  });
});

describe("Jo's V2 wording (4–5 Nov 2026) is built in but OFF until she approves the rendered email", () => {
  test("the flag starts false; the approved 4 Nov frame still renders by default", () => {
    expect(GO_EMAIL_V2_APPROVED).toBe(false);
    expect(goEmail({ ...base, failures: [], slot: "day_before_2pm" }).subject).toBe("HV-1234: GO for tomorrow 8:00am");
  });
  test("V2 GO: subject '{HV} {address} – GO for {date}', body with the Lead Installer, the crew and the four facts", () => {
    const m = goEmail({ ...base, failures: [], slot: "day_before_2pm", v2: true });
    expect(m.subject).toBe("HV-1234 12 Example St, Box Hill 3128 – GO for Thu 12 Nov");
    expect(m.text).toContain("GO for 12 Example St, Box Hill 3128 tomorrow Thu 12 Nov 8:00am. Lead Installer: John Smith. Crew: Sam Lee, Ali Khan. Everything's in place: deposit paid, safety check clear, ESC notice lodged, safety plan signed.");
    expect(m.text).toContain("Open the job: https://p/field/J1");
    expect(goEmail({ ...base, failures: [], slot: "on_day_630am", v2: true }).text).toContain("GO for 12 Example St, Box Hill 3128 today Thu 12 Nov 8:00am.");
    expect(goEmail({ ...base, crew: [], lead: null, failures: [], slot: "day_before_2pm", v2: true }).text).toContain(`Lead Installer: ${GO_EMAIL_V2_TEXT.noLead}. Crew: ${GO_EMAIL_V2_TEXT.noCrew}.`);
  });
  test("V2 DON'T START: subject '{HV} {address} – DON'T START {date}', every blocker as a plain bullet, the phone line", () => {
    const failures = classifyPrestartFailures(["Install deposit not paid", "No lead installer is recorded for this job.", "Owner consent: Owner ESC consent was completed less than 24h before start – reschedule"], { start: START, now: NOW });
    const m = goEmail({ ...base, failures, slot: "day_before_2pm", v2: true });
    expect(m.subject).toBe("HV-1234 12 Example St, Box Hill 3128 – DON'T START Thu 12 Nov");
    expect(m.text).toContain("DON'T START at 12 Example St, Box Hill 3128 on Thu 12 Nov. Fix these first:");
    expect(m.text).toContain(`• ${GO_EMAIL_PLAIN.depositNotPaid}`);
    expect(m.text).toContain(`• ${GO_EMAIL_PLAIN.noLead}`);
    expect(m.text).toContain(`• ${GO_EMAIL_PLAIN.consentTooLate}`);
    expect(m.text).toContain("Call Home Insulation Victoria on 0477 511 901 if you need a hand.");
    expect(m.text).not.toMatch(/[Ll]ead installer\b|\bHIV\b|\bfixes\b/);
    expect(m.html).toContain("DON'T START");
  });
  test("the sender passes the crew it already reads for the Lead Installer and still writes no new switch (one flag in the core)", () => {
    const src = readFileSync("src/lib/go-email.server.ts", "utf8");
    expect(src).toContain("installCrewNames(");
    expect(src).not.toContain("GO_EMAIL_V2_APPROVED"); // the core decides; the server never flips wording
  });
});

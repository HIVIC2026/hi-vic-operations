// Installer screens M2/M4/M5/M6 (Jo 24 Oct 2026, decisions 196–203): pure "Next" / panel / label rules.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  arrivalPill, bankLine, dayNext, electricianOnSite, jobNext, moneyRowSub, moneyTotals, offerClosed, offerTopLines, payNote, quoteStatusRow, readyCheckRows, sourceLabel, thirtyDayLine, type JobNextFacts,
} from "../src/lib/installer-screens.core";

const base: JobNextFacts = {
  channel: "hivic_sourced", stage: "installation_scheduling", ownerFirstName: "Helen", formLinked: true, formCompleted: true, quoteLine: "Waiting on owner: quote accepted – waiting for owner's payment",
  needsFinishing: null, readyCheckTurn: "booked", readyCheckBookedAt: "2026-10-19T20:30:00Z", installTurn: "installer_to_offer", installBookedAt: null,
  installDeadline: "2026-11-21", installDaysLeft: 28, clearedOn: "2026-10-22T03:00:00Z", installFormComplete: false, installationRecorded: false, rebateSigned: false,
};

describe("M2 job page — one Next panel", () => {
  test("cleared → offer 3 install days with the window line (mock-up M2)", () => {
    // (21 Nov 2026 is a Saturday; the mock-up's "Fri" was a drafting slip — the real calendar wins.)
    expect(jobNext(base)).toEqual({ panel: "offer_install_days", title: "Offer Helen 3 install days", sub: "Safety check cleared 22 Oct · Install by Sat 21 Nov · 28 days left", yours: true });
  });
  test("install days back and forth via installDayTurn only", () => {
    expect(jobNext({ ...base, installTurn: "owner_to_answer" }).panel).toBe("install_waiting_owner");
    expect(jobNext({ ...base, installTurn: "installer_to_answer" }).panel).toBe("install_answer_owner");
    expect(jobNext({ ...base, installTurn: "booked", installBookedAt: "2026-10-26T21:00:00Z" })).toMatchObject({ panel: "install_booked", title: "Install booked · Tue 27 Oct at 8am", yours: false });
    expect(jobNext({ ...base, installTurn: "expired" }).panel).toBe("install_expired");
  });
  test("decision 196: nothing about the rebate form until the Mitti install form is Complete, then Sign the rebate form", () => {
    const booked = { ...base, stage: "installation_booked", installTurn: "booked" as const, installBookedAt: "2026-10-26T21:00:00Z" };
    expect(JSON.stringify(jobNext(booked))).not.toMatch(/rebate/i);
    expect(jobNext({ ...booked, installFormComplete: true })).toMatchObject({ panel: "sign_rebate", title: "Sign the rebate form", yours: true });
    expect(jobNext({ ...booked, installFormComplete: true, installationRecorded: true }).sub).toBe("Your part of the VEEC assignment form (Part B): you declare the install facts as the lead installer. Type your name and tap Sign.");
    expect(jobNext({ ...booked, installFormComplete: true, rebateSigned: true }).panel).toBe("install_done");
  });
  test("before clearance: Ready Check times (our leads), Mitti form, quote status — never install days", () => {
    const rc = { ...base, stage: "ready_check_ready_to_schedule", installTurn: "not_ready" as const, installDeadline: null, installDaysLeft: null, clearedOn: null, formLinked: false, formCompleted: false, quoteLine: null };
    expect(jobNext({ ...rc, readyCheckTurn: "installer_to_offer" })).toMatchObject({ panel: "ready_check_offer_times", title: "Offer Helen 3 Ready Check times", yours: true });
    expect(jobNext({ ...rc, readyCheckTurn: "owner_to_answer" }).yours).toBe(false);
    expect(jobNext({ ...rc, readyCheckTurn: "installer_to_answer" }).panel).toBe("ready_check_answer_owner");
    expect(jobNext({ ...rc, readyCheckTurn: "booked", formLinked: true })).toMatchObject({ panel: "mitti_form", title: "Ready Check Tue 20 Oct at 7:30am", yours: true });
    expect(jobNext({ ...rc, readyCheckTurn: "booked", formLinked: true, readyCheckBookedAt: "2026-10-19T20:30:00Z" }).title).toBe("Ready Check Tue 20 Oct at 7:30am");
    expect(jobNext({ ...rc, readyCheckTurn: "booked", formLinked: true, needsFinishing: "You: add the owner's phone and email in Mitti" })).toMatchObject({ panel: "mitti_form", title: "You: add the owner's phone and email in Mitti" });
    expect(jobNext({ ...rc, readyCheckTurn: "booked", formLinked: true, quoteLine: "You: when the Ready Check is finished, press Complete in Mitti — we then send the owner their quote" })).toMatchObject({ panel: "quote_status", yours: true });
    expect(jobNext({ ...rc, readyCheckTurn: "booked", formLinked: true, formCompleted: true, quoteLine: "Waiting on office: checking the quote" })).toMatchObject({ panel: "quote_status", yours: false });
    for (const t of [jobNext({ ...rc, readyCheckTurn: "installer_to_offer" }), jobNext({ ...rc, readyCheckTurn: "booked", formLinked: true })]) expect(JSON.stringify(t)).not.toMatch(/install day|rebate/i);
  });
  test("installer's own customer before the form: form coming (decisions 115/163), no 'Quoted?' or 'Site check?' questions", () => {
    const own = { ...base, channel: "installer_sourced", stage: "ready_check_ready_to_schedule", installTurn: "not_ready" as const, installDeadline: null, installDaysLeft: null, clearedOn: null, formLinked: false, formCompleted: false, quoteLine: null, readyCheckTurn: null, readyCheckBookedAt: null };
    expect(jobNext(own)).toMatchObject({ panel: "ready_check_set_time", yours: false });
    expect(jobNext({ ...own, readyCheckBookedAt: "2026-10-19T20:30:00Z" })).toMatchObject({ panel: "form_coming", title: "Ready Check Tue 20 Oct at 7:30am" });
    expect(JSON.stringify(jobNext(own))).not.toMatch(/Quoted\?|Site check\?|Check eligibility/);
  });
  test("30-day line is the installer's wording, never the owner's", () => {
    expect(thirtyDayLine("2026-11-21")).toBe("Install within 30 days of the safety check (by 21 Nov) or a new check is needed, and whoever's move it was pays for it.");
    expect(thirtyDayLine(null)).toBeNull();
    expect(thirtyDayLine("2026-11-21")).not.toMatch(/Your install must|as soon as the installer/);
  });
  test("quote row, pay note, Ready Check rows, source label", () => {
    expect(quoteStatusRow({ sent: true, accepted: true, declined: false, held: false, formCompleted: true, acceptedAt: "2026-10-22T01:00:00Z" })).toEqual({ label: "Accepted 22 Oct", tone: "green" });
    expect(quoteStatusRow({ sent: false, accepted: false, declined: false, held: true, formCompleted: false }).label).toBe("Being checked by the office");
    expect(quoteStatusRow(null).label).toBe("Not prepared yet");
    expect(payNote({ channel: "hivic_sourced", areaM2: 137.6, removalM2: 40 })).toBe("Your agreed rates × 137.6 m² measured at the Ready Check, incl. 40 m² removal. Paid within 7 days of our approval after the install.");
    expect(payNote({ channel: "installer_sourced", areaM2: 90, removalM2: null })).toBe("Your agreed rates × 90 m² measured at the Ready Check. Paid when the owner pays their balance.");
    expect(readyCheckRows({ bookedAt: "2026-10-19T20:30:00Z", done: true, formLinked: true, formCompleted: true, missing: 0 })).toEqual({ visit: "Done Tue 20 Oct at 7:30am", form: { label: "Complete · nothing missing", tone: "green" } });
    expect(readyCheckRows({ bookedAt: null, done: false, formLinked: true, formCompleted: false, missing: 2 }).form?.label).toBe("2 things still missing");
    expect(sourceLabel("installer_sourced")).toBe("Your customer");
    expect(sourceLabel("hivic_sourced")).toBe("Home Insulation Victoria lead");
  });
});

describe("M4 today's job", () => {
  test("exact arrival time pill, no two-hour window (decision 43)", () => {
    const now = new Date("2026-10-26T22:00:00Z");
    expect(arrivalPill("2026-10-26T21:00:00Z", now)).toBe("Today · Tue 27 Oct · 8am");
    expect(arrivalPill("2026-10-28T21:30:00Z", now)).toBe("Thu 29 Oct · 8:30am");
    expect(arrivalPill("2026-10-26T21:00:00Z", now)).not.toMatch(/8–10|–/);
    expect(arrivalPill(null)).toBeNull();
  });
  test("Next: open the install form; after Mitti Complete → sign the rebate form", () => {
    expect(dayNext({ kind: "install", channel: "hivic_sourced", installFormComplete: false, rebateSigned: false })).toMatchObject({ title: "Start the install in Mitti", button: "Open install form", signRebate: false });
    expect(dayNext({ kind: "install", channel: "hivic_sourced", installFormComplete: true, rebateSigned: false })).toMatchObject({ title: "Sign the rebate form", signRebate: true });
    expect(dayNext({ kind: "ready_check", channel: "hivic_sourced", installFormComplete: false, rebateSigned: false }).sub).toContain("We price the owner's quote from your agreed rates");
    // Decision 278: staff may do the Ready Check — the day page never mentions the price on A1 either.
    expect(dayNext({ kind: "ready_check", channel: "installer_sourced", installFormComplete: false, rebateSigned: false }).sub).not.toMatch(/price/i);
  });
  test("electrician-on-site card only when the PIESA requires one", () => {
    expect(electricianOnSite({ required: false, name: "Sam Lee", arrival: "8:00am", reason: null })).toBeNull();
    expect(electricianOnSite({ required: true, name: "Sam Lee", arrival: "8:00am", reason: "downlights to be fitted with covers" })).toEqual({
      title: "An electrician must be on site",
      body: "The safety check found downlights to be fitted with covers. Sam Lee (Home Insulation Victoria electrician) arrives 8:00am. Don't start in the roof until Sam says the power is off.",
      call: "Call Sam",
    });
    expect(electricianOnSite({ required: true, name: null, arrival: null, reason: null })?.call).toBeNull();
  });
});

describe("M5 job offer (decision 201)", () => {
  test("two plain lines; size omitted when there is none; no aerial, no job type", () => {
    expect(offerTopLines({ areaM2: 120, insulation: "some" })).toEqual(["Owner says ~120 m²", "Owner says some insulation"]);
    expect(offerTopLines({ areaM2: null, insulation: "none" })).toEqual(["Owner says no insulation"]);
    expect(offerTopLines({ areaM2: 0, insulation: "unknown" })).toEqual(["Owner isn't sure about existing insulation"]);
    expect(JSON.stringify(offerTopLines({ areaM2: 120, insulation: "some" }))).not.toMatch(/aerial|Measured|job type/i);
  });
  test("closed offer never claims another trade got it first (decision 49)", () => {
    expect(offerClosed("withdrawn").title).toBe("This offer has closed");
    expect(offerClosed("declined").title).toBe("Offer declined");
    expect(JSON.stringify([offerClosed("withdrawn"), offerClosed("superseded"), offerClosed("expired")])).not.toMatch(/another trade|first to accept|taken/i);
  });
  test("the aerial label is gone from the installer offer screen", () => {
    const page = readFileSync("src/routes/_authenticated/field.offer.$offerId.tsx", "utf8");
    expect(page).not.toMatch(/AREA_SOURCE_LABEL|From aerial photo|roughInstallValue|first trade to accept|Another trade accepted/);
  });
});

describe("M6 money (decision 203)", () => {
  const rows = [
    { amount: 2890, state: { kind: "checking" as const }, doneAt: "2026-10-26T21:00:00Z", channel: "hivic_sourced" },
    { amount: 3180, state: { kind: "coming" as const, on: "2026-10-30T20:00:00Z" }, doneAt: "2026-10-21T21:00:00Z", channel: "installer_sourced" },
    { amount: 1950, state: { kind: "coming" as const, on: "2026-10-27T20:00:00Z" }, doneAt: "2026-10-20T21:00:00Z", channel: "hivic_sourced" },
    { amount: 2420, state: { kind: "paid" as const, on: "2026-10-22T20:00:00Z" }, doneAt: "2026-10-13T21:00:00Z", channel: "installer_sourced" },
    { amount: 1760, state: { kind: "paid" as const, on: "2026-10-16T20:00:00Z" }, doneAt: "2026-10-07T21:00:00Z", channel: "hivic_sourced" },
    { amount: 9210, state: { kind: "paid" as const, on: "2026-09-16T20:00:00Z" }, doneAt: "2026-09-07T21:00:00Z", channel: "hivic_sourced" },
  ];
  test("Coming / Being checked / This month / Last month", () => {
    expect(moneyTotals(rows, new Date("2026-10-24T00:00:00Z"))).toEqual({
      coming: { total: 5130, next: "2026-10-27T20:00:00Z" }, checking: { total: 2890, jobs: 1 },
      thisMonth: { total: 4180, installs: 2 }, lastMonth: { total: 9210, installs: 1 },
    });
  });
  test("row sub line and bank line never show full numbers", () => {
    expect(moneyRowSub({ channel: "hivic_sourced", doneAt: "2026-10-26T21:00:00Z" })).toBe("Home Insulation Victoria lead · Install 27 Oct");
    expect(moneyRowSub({ channel: "installer_sourced", doneAt: null })).toBe("Your customer");
    expect(bankLine({ bsbStart: "063", accountEnding: "471" })).toBe("BSB 063-xxx · account ending 471");
    expect(bankLine({ bsbStart: null, accountEnding: null })).toBe("No bank account saved yet");
  });
});

describe("audit removals on the rebuilt screens", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  test("job page: no electrician choice, submit-for-review, pay-before-booking, owner-worded 30-day box or portal-only sentence", () => {
    // The electrician's visit flow shares the route file; the installer page is everything outside that block.
    const whole = read("src/routes/_authenticated/field.$jobId.tsx");
    const page = whole.split("// ---------- Electrician")[0]! + whole.split("// ---------- Installer")[1]!;
    for (const bad of ["<ElectricianChoicePanel", "submitForApReview", "Submit for Home Insulation Victoria review", "Booking opens once paid", "<ThirtyDayClock", "All contact happens here", "What's happened", "<MeasurementDetails", "Site summary"]) expect(page).not.toContain(bad);
    expect(read("src/components/portal/install-days.tsx")).not.toContain("ThirtyDayClock");
  });
  test("day page and offer page: no time windows, no 'first to accept'", () => {
    for (const f of ["src/routes/_authenticated/field.day.$jobId.tsx", "src/routes/_authenticated/field.offer.$offerId.tsx"]) {
      const s = read(f);
      expect(s).not.toMatch(/dayTile|8–10am|first trade to accept|Another trade accepted/);
    }
  });
});

import { expect, test } from "bun:test";
import { ageLabel, buildNeedsRows, needsCandidates, type NeedsFacts } from "../src/lib/office-needs.core";
import { nextAction } from "../src/lib/job-next-action.core";

const NOW = Date.parse("2026-10-24T03:00:00Z");
const job = (id: string, extra: Partial<NeedsFacts>): NeedsFacts => ({ jobId: id, jobNumber: `HV-${id}`, surname: "Smith", suburb: "Croydon", ...extra });

test("O1 groups: Today / This week / Watch with one button each", () => {
  const g = buildNeedsRows({ now: NOW, jobs: [
    job("3160", { offerLapsed: { role: "installer", name: null, declined: false, at: "2026-10-23T03:00:00Z" } }),
    job("3141", { quoteToCheck: { at: "2026-10-24T00:00:00Z", reason: "electrician rate to confirm", ready: false } }),
    job("3096", { consentToSign: { at: "2026-10-24T02:00:00Z", dueAt: "2026-10-24T22:40:00Z" } }),
    job("3088", { escWindow: { closesAt: "2026-10-27T20:30:00Z", opensAt: null } }),
    job("3044", { finalCheck: { at: "2026-10-21T00:00:00Z", flags: 0 } }),
    job("3150", { sendFailed: { at: "2026-10-24T02:20:00Z", text: "Text failed: Install days email, today" } }),
    job("3188", { spotSaved: { at: "2026-10-24T01:00:00Z" } }),
    job("3104", { electricianToChoose: { at: "2026-10-23T23:00:00Z", usual: "Volt Right Electrical" } }),
    job("3071", { veecApHeld: { at: "2026-10-22T00:00:00Z", reasons: ["Product warranty copy (minimum 5 years) given to the consumer is not recorded."] } }),
    job("3110", { paymentNotInXero: { at: "2026-10-22T00:00:00Z", text: "$349 owner says paid" } }),
    job("3057", { tenDaysLeft: { at: "2026-10-24T00:00:00Z", deadline: "2026-11-03" } }),
    job("3049", { secondNoAccess: { at: "2026-10-24T00:00:00Z", reason: null } }),
    job("3012", { veecDay10: { at: "2026-10-24T00:00:00Z" } }),
    job("3001", {}),
  ] });
  expect(g.today.map((r) => [r.jobNumber, r.kind, r.button.label])).toEqual([
    ["HV-3150", "send_failed", "Open job"], ["HV-3160", "choose_again", "Choose again"], ["HV-3096", "sign_consent", "Sign"],
    ["HV-3141", "quote_check", "Check & send"], ["HV-3044", "final_check", "Approve"],
  ]);
  expect(g.week.map((r) => [r.jobNumber, r.kind, r.button.label])).toEqual([
    ["HV-3188", "choose_installer", "Choose installer"], ["HV-3104", "choose_electrician", "Send offer"], ["HV-3088", "esc_window", "Open Registry block"], ["HV-3071", "veec_a_held", "Open job"],
  ]);
  expect(g.watch.map((r) => r.kind)).toEqual(["second_no_access", "ten_days_left", "veec_day_10", "payment_not_in_xero"]);
  // Payment rows are watch-only and never offer "Record payment" (decision 240).
  expect([...g.today, ...g.week, ...g.watch].some((r) => /record payment/i.test(r.button.label))).toBe(false);
});

test("one row per job: the most urgent action wins", () => {
  const f = job("1", { spotSaved: { at: "2026-10-20T00:00:00Z" }, sendFailed: { at: "2026-10-24T00:00:00Z", text: "Email failed" }, veecDay10: { at: "2026-10-24T00:00:00Z" } });
  const g = buildNeedsRows({ now: NOW, jobs: [f] });
  expect([...g.today, ...g.week, ...g.watch].map((r) => r.kind)).toEqual(["send_failed"]);
  expect(needsCandidates(f, NOW).map((c) => c.kind)).toEqual(["send_failed", "choose_installer", "veec_day_10"]);
});

test("consent due later than 48h sits in This week; ESC window closing within 48h is Today", () => {
  const g = buildNeedsRows({ now: NOW, jobs: [
    job("a", { consentToSign: { at: "2026-10-24T00:00:00Z", dueAt: "2026-10-30T00:00:00Z" } }),
    job("b", { escWindow: { closesAt: "2026-10-25T00:00:00Z", opensAt: null } }),
  ] });
  expect(g.week.map((r) => r.kind)).toEqual(["sign_consent"]);
  expect(g.today.map((r) => r.kind)).toEqual(["esc_window"]);
});

test("email rows: Apply / Ignore and Match / Not a customer on top of Today; nothing when no events", () => {
  expect(buildNeedsRows({ now: NOW, jobs: [], emails: [] })).toEqual({ today: [], week: [], watch: [] });
  const g = buildNeedsRows({ now: NOW, jobs: [job("q", { quoteToCheck: { at: "2026-10-20T00:00:00Z", reason: null, ready: true } })], emails: [
    { type: "change", eventId: "e1", jobId: "j1", jobNumber: "HV-1", surname: "Brennan", suburb: "Vermont South", line: "Owner asks to cancel", at: "2026-10-24T01:00:00Z" },
    { type: "unmatched", eventId: "e2", guessJobId: null, jobNumber: null, surname: "", suburb: null, line: "Email from pm@x.com", at: "2026-10-24T00:00:00Z" },
  ] });
  expect(g.today.map((r) => [r.kind, r.button.label, r.secondary?.label])).toEqual([
    ["email_unmatched", "Match", "Not a customer"], ["email_change", "Apply", "Ignore"], ["quote_check", "Check & send", undefined],
  ]);
});

test("age column", () => {
  expect(ageLabel("2026-10-24T02:20:00Z", NOW)).toBe("40m");
  expect(ageLabel("2026-10-23T22:00:00Z", NOW)).toBe("5h");
  expect(ageLabel("2026-10-21T00:00:00Z", NOW)).toBe("3d");
});

test("Next panel: same facts as Needs me, else who it waits on", () => {
  const facts = job("3104", { electricianToChoose: { at: "2026-10-23T23:00:00Z", usual: "Volt Right Electrical" } });
  expect(nextAction({ facts, status: null, stage: "piesa", closed: null, onHold: null }, NOW)).toEqual({
    who: "us", sentence: "Choose the electrician for the PIESA — Volt Right Electrical is the installer's usual electrician.", button: { label: "Send offer", section: "piesa" }, blocked: null,
  });
  expect(nextAction({ facts: job("x", {}), status: { label: "Quote sent", waitingOn: "Owner", detail: null, dueAt: null }, stage: "quote", closed: null, onHold: null }, NOW))
    .toEqual({ who: "owner", sentence: "Waiting for the owner: quote sent.", button: null, blocked: null });
  expect(nextAction({ facts: null, status: null, stage: null, closed: { kind: "cancelled", reason: "Owner changed mind" }, onHold: null }, NOW).sentence).toBe("Cancelled: Owner changed mind. Reopen it from Jobs › Closed if that was wrong.");
  expect(nextAction({ facts: null, status: null, stage: null, closed: null, onHold: { reason: "Owner overseas", until: "2026-11-10" } }, NOW).sentence).toBe("On hold: Owner overseas · until 2026-11-10. Reminders and texts are paused.");
});

test("Needs me 48h booking rule uses readyCheckOverdueApplies (Jo 28 Oct: installer jobs and done Ready Checks skip it)", () => {
  const src = require("node:fs").readFileSync("src/lib/office-needs.server.ts", "utf8") as string;
  expect(src).toContain("readyCheckOverdueApplies(");
});

import { describe, expect, test } from "bun:test";
import { escTask, prestartFailures, prestartLocked, prestartRunAt, type PrestartFacts } from "../src/lib/prestart.core";
import { buildNeedsHivic } from "../src/lib/allocation.core";

const START = "2026-10-15T21:00:00Z"; // Fri 16 Oct 8am Melbourne
const H = 3600_000, D = 24 * H;
const at = (ms: number) => new Date(Date.parse(START) - ms);
const sent = (sentAt: string, start = START) => ({ status: "sent", sent_at: sentAt, submission_reference: "REF-1", scheduled_start: start });

describe("ESC AP task", () => {
  test("nothing before the 5-day window; due when it opens; urgent at 2 days", () => {
    expect(escTask({ start: START, current: null, previousSent: null, now: at(6 * D) })).toBeNull();
    expect(escTask({ start: START, current: null, previousSent: null, now: at(4 * D) })!.code).toBe("esc_submit_due");
    expect(escTask({ start: START, current: null, previousSent: null, now: at(2 * D) })!.code).toBe("esc_submit_urgent");
  });
  test("submitted for this date clears it", () => {
    expect(escTask({ start: START, current: sent(at(3 * D).toISOString()), previousSent: null, now: at(2 * D) })).toBeNull();
  });
  test("date moved (Activity Guide v1.2 §3.3.3): new start within 5 days and original not passed → update; otherwise withdraw and resubmit", () => {
    const old = "2026-10-14T21:00:00Z";
    expect(escTask({ start: START, current: { status: "ready", sent_at: null, submission_reference: null, scheduled_start: START }, previousSent: sent(at(3 * D).toISOString(), old), now: at(2 * D) })!.code).toBe("esc_update_registry");
    // New start more than 5 days away → withdraw.
    expect(escTask({ start: START, current: null, previousSent: sent(at(7 * D).toISOString(), old), now: at(6 * D) })!.code).toBe("esc_withdraw_resubmit");
    // Original start already passed → withdraw (an update needs the original date not to have passed).
    expect(escTask({ start: START, current: null, previousSent: sent(at(5 * D).toISOString(), "2026-10-12T21:00:00Z"), now: at(2 * D) })!.code).toBe("esc_withdraw_resubmit");
  });
});

describe("pre-start check", () => {
  test("runs at 12pm Melbourne the day before", () => {
    expect(prestartRunAt(START)).toBe("2026-10-15T01:00:00.000Z"); // Thu 15 Oct 12pm AEDT
  });
  const ok: PrestartFacts = {
    start: START, clearance: { cleared: true, blocker: null }, deadline: "2026-10-30", esc: sent(at(3 * D).toISOString()),
    lead: { found: true, status: "verified", level: "full", expiresOn: "2027-01-01", name: "Lee" }, consentBlockers: [], piesaCompletedAt: "2026-10-01",
  };
  test("all good passes", () => expect(prestartFailures(ok)).toEqual([]));
  test("decision 367: an unpaid install deposit fails the pre-start check (so the existing lock stops the install)", () => {
    expect(prestartFailures({ ...ok, installDepositBlocker: "Install deposit not paid" })).toEqual(["Install deposit not paid"]);
    expect(prestartFailures({ ...ok, installDepositBlocker: null })).toEqual([]);
    expect(prestartLocked({ start: START, latest: { scheduled_start: START, passed: false, failures: ["Install deposit not paid"] }, now: new Date(Date.parse(START) - H) })).toEqual({ locked: true, reasons: ["Install deposit not paid"] });
  });
  test("each condition fails on its own", () => {
    const f = (p: Partial<PrestartFacts>) => prestartFailures({ ...ok, ...p });
    expect(f({ clearance: { cleared: false, blocker: "x" } }).length).toBe(1);
    expect(f({ deadline: "2026-10-15" })[0]).toMatch("New PIESA needed");
    expect(f({ esc: null })[0]).toMatch("ESC notification");
    expect(f({ esc: sent(at(6 * D).toISOString()) })[0]).toMatch("too early");
    expect(f({ lead: { ...ok.lead, level: null, expiresOn: null } })[0]).toMatch("re-record certification as Full with expiry date");
    expect(f({ lead: { ...ok.lead, level: "provisional" } })[0]).toMatch("provisional");
    expect(f({ lead: { ...ok.lead, expiresOn: "2026-10-15" } })[0]).toMatch("expired");
    expect(f({ consentBlockers: ["not signed"] })[0]).toMatch("Owner consent");
    expect(f({ piesaCompletedAt: "2026-09-10" })[0]).toMatch("within 30 days of the PIESA");
  });
  test("lock: failed check locks; no check after 12pm locks; before 12pm open", () => {
    expect(prestartLocked({ start: START, latest: { scheduled_start: START, passed: false, failures: ["x"] }, now: at(2 * D) }).locked).toBe(true);
    expect(prestartLocked({ start: START, latest: null, now: at(10 * H) }).locked).toBe(true);
    expect(prestartLocked({ start: START, latest: null, now: at(2 * D) }).locked).toBe(false);
    expect(prestartLocked({ start: START, latest: { scheduled_start: START, passed: true, failures: [] }, now: at(H) }).locked).toBe(false);
  });
  test("needs list: ESC task replaces the general ESC entry; failed check and certificate prompt listed", () => {
    const base = { now: new Date(), coverageExhausted: [], releases: [], failedComms: [], rectDeclined: [], rectPricing: [], installerUnavailable: [], piesaTiming: [], evidenceRejected: [], registryQueries: [], officeOverdue: [] };
    const items = buildNeedsHivic({ ...base, jobs: [{ id: "a", job_number: "A", stage: "installation_booked", suburb: null }], escTiming: [{ job_id: "a", created_at: null }],
      prestart: { esc: [{ job_id: "a", code: "esc_submit_urgent", detail: "d" }], failed: [{ job_id: "a", since: "x", detail: "r" }], certs: [{ job_id: "a", detail: "c" }] } } as never);
    expect(items.map((i) => i.code).sort()).toEqual(["cert_rerecord_needed", "esc_submit_urgent", "prestart_failed"]);
  });
});

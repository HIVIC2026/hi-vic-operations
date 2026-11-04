import { describe, expect, test } from "bun:test";
import { escTask, prestartFailures, prestartLocked, prestartRunAt, type PrestartFacts, classifyPrestartFailure } from "../src/lib/prestart.core";
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
  test("runs at 2pm Melbourne the day before (Part 9 Task 6)", () => {
    expect(prestartRunAt(START)).toBe("2026-10-15T03:00:00.000Z"); // Thu 15 Oct 2pm AEDT
  });
  const ok: PrestartFacts = {
    start: START, clearance: { cleared: true, blocker: null }, deadline: "2026-10-30", esc: sent(at(3 * D).toISOString()),
    lead: { found: true, status: "verified", level: "full", expiresOn: "2027-01-01", name: "Lee" }, consentBlockers: [], piesaCompletedAt: "2026-10-01",
  };
  test("all good passes", () => expect(prestartFailures(ok)).toEqual([]));
  test("J5: the ESC notices could not be read → the check fails CLOSED with its own line (must move), never 'not marked submitted' (fixable)", () => {
    const lines = prestartFailures({ ...ok, escReadError: "timeout" });
    expect(lines).toEqual(["ESC notices could not be read (timeout) — check again"]);
    expect(classifyPrestartFailure(lines[0]!, { start: START, now: at(-3 * D) })).toBe("must_move");
    expect(prestartFailures({ ...ok, esc: null, escReadError: null })).toEqual(["ESC notification is not marked submitted for this install date."]);
  });
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
  test("lock: failed check locks; no check after 2pm locks; before 2pm open", () => {
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

// Part 3 Task 4 (Jo 3 Nov 2026): the install can be BOOKED while the Certificate of Electrical Safety is outstanding; it
// can't START. The certificate is a pre-start fact; booking only carries a warning. On-site-only jobs are clear after the PIESA.
import { INSTALL_CERTIFICATE_UNCHECKED_WARNING, INSTALL_CERTIFICATE_WARNING, installCertificateWarning, prestartCertificate, prestartCertificateBlocker } from "../src/lib/certificate-later.core";
import { electricalClearance } from "../src/lib/allocation.core";

describe("Part 3 Task 4: certificate at pre-start", () => {
  const ok: PrestartFacts = {
    start: START, clearance: { cleared: true, blocker: null }, deadline: "2026-10-30", esc: sent(at(3 * D).toISOString()),
    lead: { found: true, status: "verified", level: "full", expiresOn: "2027-01-01", name: "Lee" }, consentBlockers: [], piesaCompletedAt: "2026-10-01",
  };
  test("missing → 'Certificate of Electrical Safety not in yet' (Review Focus 5)", () => {
    expect(prestartFailures({ ...ok, certificate: "missing" })).toEqual(["Certificate of Electrical Safety not in yet"]);
  });
  test("a file that isn't ticked → 'Check electrical certificate — {why}'", () => {
    expect(prestartFailures({ ...ok, certificate: "unchecked", certificateWhy: "not checked yet" })).toEqual(["Check electrical certificate — not checked yet"]);
    expect(prestartFailures({ ...ok, certificate: "unchecked", certificateWhy: null })).toEqual(["Check electrical certificate — not checked yet"]);
  });
  test("ticked, not needed, or not loaded → passes", () => {
    expect(prestartFailures({ ...ok, certificate: "ticked" })).toEqual([]);
    expect(prestartFailures({ ...ok, certificate: "not_needed" })).toEqual([]);
    expect(prestartFailures(ok)).toEqual([]);
  });
  test("prestartCertificate maps the job's certificate state", () => {
    const m = (p: Partial<Parameters<typeof prestartCertificate>[0]>) => prestartCertificate({ onsiteOnly: false, state: "none_needed", rejected: false, why: null, legacyWhy: null, ...p });
    expect(m({})).toEqual({ certificate: "not_needed", why: null });
    // The old certificate check still applies to an odd job the new facts call "none needed" (fail closed).
    expect(m({ legacyWhy: "not checked yet" })).toEqual({ certificate: "unchecked", why: "not checked yet" });
    expect(m({ state: "upgrades_pending" })).toEqual({ certificate: "missing", why: null });
    expect(m({ state: "waiting_for_certificate" })).toEqual({ certificate: "missing", why: null });
    expect(m({ state: "waiting_for_certificate", rejected: true, why: "you rejected it — waiting for a new certificate" })).toEqual({ certificate: "unchecked", why: "you rejected it — waiting for a new certificate" });
    expect(m({ state: "certificate_in", why: "the AI couldn't read it" })).toEqual({ certificate: "unchecked", why: "the AI couldn't read it" });
    expect(m({ state: "certificate_in" })).toEqual({ certificate: "unchecked", why: "not checked yet" });
    expect(m({ state: "clear" })).toEqual({ certificate: "ticked", why: null });
    // On-site-only (electrician at the start of the install day): clear after the PIESA, whatever else.
    expect(m({ onsiteOnly: true, state: "waiting_for_certificate" })).toEqual({ certificate: "not_needed", why: null });
  });
  test("the booking warning wording", () => {
    expect(INSTALL_CERTIFICATE_WARNING).toBe("Certificate of Electrical Safety still to come — the install can't start without it");
    expect(INSTALL_CERTIFICATE_UNCHECKED_WARNING).toBe("Certificate of Electrical Safety not checked yet — the install can't start until it's ticked.");
  });
  test("fix 1: the booking warning is picked from the fact — 'still to come' only with no file", () => {
    expect(installCertificateWarning("missing")).toBe(INSTALL_CERTIFICATE_WARNING);
    expect(installCertificateWarning("unchecked")).toBe(INSTALL_CERTIFICATE_UNCHECKED_WARNING);
    expect(installCertificateWarning("ticked")).toBeNull();
    expect(installCertificateWarning("not_needed")).toBeNull();
  });
  test("fix 1: the live start lock (requirePrestartClear) wording", () => {
    expect(prestartCertificateBlocker("missing", null)).toBe("Not cleared to start: Certificate of Electrical Safety not in yet.");
    expect(prestartCertificateBlocker("unchecked", "not checked yet")).toBe("Not cleared to start: check the electrical certificate — not checked yet.");
    expect(prestartCertificateBlocker("unchecked", null)).toBe("Not cleared to start: check the electrical certificate — not checked yet.");
    expect(prestartCertificateBlocker("ticked", null)).toBeNull();
    expect(prestartCertificateBlocker("not_needed", null)).toBeNull();
  });
});

describe("Part 3 Task 4: electrical clearance needs Part C, never the certificate", () => {
  const base = { piesaOutcome: "fail" as const, piesaCompletedAt: "2026-10-01", rectificationRequired: true, rectificationQuoteAccepted: false, rectificationCompletedAt: null, sectionCSignedAt: null };
  test("upgrades needed, Part C not recorded → not cleared", () => {
    expect(electricalClearance(base)).toMatchObject({ cleared: false });
  });
  test("Part C recorded on the A3 answers (same-day upgrades, no post-upgrades record) → cleared from the PIESA date", () => {
    expect(electricalClearance({ ...base, partCRecorded: true })).toMatchObject({ cleared: true, basis: "section_c", timingDate: "2026-10-01" });
  });
  test("a post-upgrades record with Section C → cleared (no certificate fact exists at all)", () => {
    expect(electricalClearance({ ...base, rectificationCompletedAt: "2026-10-05", sectionCSignedAt: "2026-10-05T00:00:00Z" })).toMatchObject({ cleared: true, basis: "section_c" });
  });
  test("on-site-only clears on the PIESA alone", () => {
    expect(electricalClearance({ ...base, onsiteStartOnly: true })).toMatchObject({ cleared: true, basis: "electrician_at_start" });
  });
});

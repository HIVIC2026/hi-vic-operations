// Decision 395 (Jo 26 Oct 2026, "Yes, check before start"): the day-before pre-start check also stops the install when the
// signed PIESA copies did not reach the owner AND the installer 24h before the start (the automatic send failed), or the
// owner has not ticked "I have received it" (Gate C piesa_copy_receipt). Same rules and wording as Installation complete;
// the office sees what is missing on Needs me the day before. Pure rules + the shared reader on a fake database.
import { describe, expect, mock, test } from "bun:test";
import { piesaCopyDeliveryBlockers, readyToInstall } from "../src/lib/esc.core";
import { prestartFailedFor, prestartFailures, type PrestartFacts } from "../src/lib/prestart.core";
import { evaluateOwnerGates, piesaCopyReceiptBlocker, type GateFacts } from "../src/lib/owner-gates.core";
import { buildNeedsRows, prestartFailedLine } from "../src/lib/office-needs.core";

const START = "2026-10-29T21:00:00Z"; // Fri 30 Oct 8am Melbourne
const H = 3_600_000;
const before = (h: number) => new Date(Date.parse(START) - h * H).toISOString();
const ok: PrestartFacts = {
  start: START, clearance: { cleared: true, blocker: null }, deadline: "2026-11-20", esc: { status: "sent", sent_at: before(72), submission_reference: "REF-1", scheduled_start: START },
  lead: { found: true, status: "verified", level: "full", expiresOn: "2027-01-01", name: "Lee" }, consentBlockers: [], piesaCompletedAt: "2026-10-22",
};
const gates = (o: Partial<GateFacts> = {}): GateFacts => ({ isTest: false, signed: [], approved: {}, tenant: false, lifeSupport: false, visitedByInstaller: false, hasQuote: true,
  agreementSigned: true, agreementWordingApproved: true, escConsentSigned: true, piesaCopyDelivered: true, piesaDeclarationMappingApproved: false, assignmentEffective: false, ...o });

describe("PIESA copies: one rule for Installation complete and the pre-start check", () => {
  test("both delivered 24h+ before the start → nothing", () => {
    expect(piesaCopyDeliveryBlockers(START, { owner: before(30), installer: before(25) })).toEqual([]);
  });
  test("the automatic send failed (nothing recorded) or was late → one line per recipient", () => {
    const none = piesaCopyDeliveryBlockers(START, { owner: null, installer: null });
    expect(none).toHaveLength(2);
    expect(none[0]).toMatch(/^Signed PIESA copy delivery to owner must be recorded by /);
    expect(none[1]).toMatch(/^Signed PIESA copy delivery to installer must be recorded by /);
    expect(piesaCopyDeliveryBlockers(START, { owner: before(30), installer: before(10) })).toEqual([none[1]]);
  });
  test("readyToInstall (completion) and prestartFailures (day before) say exactly the same thing", () => {
    const deliveries = { owner: null, installer: before(30) };
    const lines = piesaCopyDeliveryBlockers(START, deliveries);
    const ready = readyToInstall({ scheduledStart: START, consent: null, notification: null, deliveries, piesa: { date: "2026-10-22", deadline: "2026-11-20", outcome: "pass" } });
    for (const l of lines) expect(ready.blockers).toContain(l);
    expect(prestartFailures({ ...ok, piesaCopyBlockers: lines })).toEqual(lines);
  });
});

describe("Owner's safety check copy receipt (Gate C): one rule for both places", () => {
  test("not ticked → the Gate C line; ticked on approved wording → nothing", () => {
    const unsigned = piesaCopyReceiptBlocker(gates());
    expect(unsigned).toBeNull();
    expect(evaluateOwnerGates(gates()).find((g) => g.gate === "C")!.items.some(i=>i.key==='piesa_copy_receipt')).toBe(false);
    const signed = gates({ signed: [{ key: "piesa_copy_receipt", version: "v1", draft: false }], approved: { piesa_copy_receipt: "v1" } });
    expect(piesaCopyReceiptBlocker(signed)).toBeNull();
  });
  test("ticked on DRAFT wording: blocks a real job (as at completion), not a TEST job", () => {
    const draft = { signed: [{ key: "piesa_copy_receipt", version: "draft-1", draft: true }] };
    expect(piesaCopyReceiptBlocker(gates(draft))).toBeNull();
    expect(piesaCopyReceiptBlocker(gates({ ...draft, isTest: true }))).toBeNull();
  });
  test("the pre-start check fails on it; a cleared receipt and delivered copies pass", () => {
    expect(prestartFailures({ ...ok, piesaCopyReceiptBlocker: "Owner paperwork C: Your safety check copy not signed yet." })).toEqual(["Owner paperwork C: Your safety check copy not signed yet."]);
    expect(prestartFailures({ ...ok, piesaCopyBlockers: [], piesaCopyReceiptBlocker: null })).toEqual([]);
  });
});

describe("Needs me: the office sees what is missing the day before", () => {
  const b = [{ job_id: "j1", scheduled_start: START }, { job_id: "j2", scheduled_start: START }];
  test("latest check for the CURRENT start, failed → one row with its reasons; passed / moved / older → none", () => {
    const rows = prestartFailedFor(b, [
      { job_id: "j1", scheduled_start: START, passed: false, failures: ["Signed PIESA copy delivery to owner must be recorded by x", "Owner paperwork C: Your safety check copy not signed yet."], checked_at: "2026-10-29T01:00:00Z" },
      { job_id: "j2", scheduled_start: START, passed: false, failures: ["old"], checked_at: "2026-10-29T01:00:00Z" },
      { job_id: "j2", scheduled_start: START, passed: true, failures: [], checked_at: "2026-10-29T01:15:00Z" },
      { job_id: "j3", scheduled_start: START, passed: false, failures: ["no booking any more"], checked_at: "2026-10-29T01:00:00Z" },
    ]);
    expect([...rows.keys()]).toEqual(["j1"]);
    expect(rows.get("j1")!.reasons).toHaveLength(2);
    expect(prestartFailedFor([{ job_id: "j1", scheduled_start: "2026-10-31T21:00:00Z" }], [{ job_id: "j1", scheduled_start: START, passed: false, failures: ["x"], checked_at: "2026-10-29T01:00:00Z" }]).size).toBe(0);
  });
  test("row: Today, names the first missing thing and how many more, opens the job's install card", () => {
    const reasons = ["Signed PIESA copy delivery to owner must be recorded by 29/10/2026", "Owner paperwork C: Your safety check copy not signed yet."];
    expect(prestartFailedLine(reasons)).toBe("Pre-start check failed · Signed PIESA copy delivery to owner must be recorded by 29/10/2026 (+1 more)");
    const out = buildNeedsRows({ now: Date.parse("2026-10-29T02:00:00Z"), jobs: [{ jobId: "j1", jobNumber: "HV-1", surname: "Sample", suburb: "Frankston", prestartFailed: { at: "2026-10-29T01:00:00Z", reasons } }] });
    expect(out.today).toHaveLength(1);
    expect(out.today[0]).toMatchObject({ kind: "prestart_failed", button: { label: "Open job", to: "job", section: "install" } });
  });
});

// The shared reader: the CURRENT PIESA record's first delivery per recipient (fake database, no network).
type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  let rows = [...(tables[t] ?? [])];
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q, eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q; },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => res({ data: rows, error: null }),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) } }));
const { piesaCopyDeliveries } = await import("../src/lib/esc.server");

describe("piesaCopyDeliveries (esc.server — used by installReadiness and prestartFacts)", () => {
  test("reads only the current PIESA record; earliest delivery per recipient", async () => {
    tables = {
      piesa_records: [{ id: "old", job_id: "j1", is_current: false }, { id: "cur", job_id: "j1", is_current: true }],
      piesa_deliveries: [
        { piesa_record_id: "old", recipient: "owner", delivered_at: "2026-10-01T00:00:00Z" },
        { piesa_record_id: "cur", recipient: "owner", delivered_at: "2026-10-23T00:00:00Z" },
        { piesa_record_id: "cur", recipient: "owner", delivered_at: "2026-10-22T00:00:00Z" },
      ],
    };
    expect(await piesaCopyDeliveries("j1")).toEqual({ owner: "2026-10-22T00:00:00Z", installer: null });
  });
  test("no current PIESA → nothing delivered", async () => {
    tables = { piesa_records: [], piesa_deliveries: [] };
    expect(await piesaCopyDeliveries("j1")).toEqual({ owner: null, installer: null });
  });
});

// Part 9 Task 5: the GO / DON'T START check (prestartFailures) reads four more facts — Lead Installer ESC-registered,
// electrician booked at the install when the PIESA needs them, life support plan on file, and the UPDATED PIESA copy
// (with Part C) delivered ≥24h before — and the gates that were already right are pinned by trying to break them.
import { describe, expect, mock, test } from "bun:test";
import { partCSignedTime, piesaCopyDeliveryBlockers, readyToInstall } from "../src/lib/esc.core";
import { prestartFailures, type PrestartFacts } from "../src/lib/prestart.core";
import { consentValidityBlockers } from "../src/lib/consent.core";

const START = "2026-11-12T21:00:00Z"; // Fri 13 Nov 8am Melbourne (AEDT)
const H = 3_600_000, D = 24 * H;
const before = (h: number) => new Date(Date.parse(START) - h * H).toISOString();
const ok: PrestartFacts = {
  start: START, clearance: { cleared: true, blocker: null }, deadline: "2026-11-20",
  esc: { status: "sent", sent_at: before(72), submission_reference: "REF-1", scheduled_start: START },
  lead: { found: true, status: "verified", level: "full", expiresOn: "2027-01-01", name: "Lee", noticeAcknowledged: true, escRegistered: true },
  consentBlockers: [], piesaCompletedAt: "2026-10-22",
  readyCheckWorksBlockers: [], siteHoldBlockers: [], publicLiabilityBlocker: null, swmsBlocker: null, bookingCreatedAt: before(5 * 24),
  installDepositBlocker: null, piesaCopyBlockers: [], piesaCopyReceiptBlocker: null,
  electricianAttendance: { required: false, state: "waiting" }, lifeSupportPlanMissing: false,
};

describe("GO check — full fixture passes, then one break at a time", () => {
  test("everything in → GO", () => expect(prestartFailures(ok)).toEqual([]));

  test("Lead Installer not registered with the ESC → DON'T START (false blocks; undefined = not loaded, older callers)", () => {
    expect(prestartFailures({ ...ok, lead: { ...ok.lead, escRegistered: false } })).toEqual(["Lead Installer Lee is not registered with the ESC yet."]);
    expect(prestartFailures({ ...ok, lead: { ...ok.lead, escRegistered: undefined } })).toEqual([]);
    expect(prestartFailures({ ...ok, lead: { ...ok.lead, escRegistered: null } })).toEqual([]);
  });

  test("PIESA needs the electrician at the install: waiting or declined → DON'T START; confirmed → GO; not required → GO", () => {
    const line = "The PIESA needs an electrician at the install and they haven't confirmed.";
    expect(prestartFailures({ ...ok, electricianAttendance: { required: true, state: "waiting" } })).toEqual([line]);
    expect(prestartFailures({ ...ok, electricianAttendance: { required: true, state: "declined" } })).toEqual([line]);
    expect(prestartFailures({ ...ok, electricianAttendance: { required: true, state: "confirmed" } })).toEqual([]);
    expect(prestartFailures({ ...ok, electricianAttendance: { required: false, state: "declined" } })).toEqual([]);
    expect(prestartFailures({ ...ok, electricianAttendance: null })).toEqual([]);
  });

  test("life support at this home with no plan on file → DON'T START", () => {
    expect(prestartFailures({ ...ok, lifeSupportPlanMissing: true })).toEqual(["Life support at this home: the written consent or medical plan isn't on file."]);
  });

  test("Part C signed Wed 3pm, copies delivered Tue → two Part C lines; re-delivered Wed 4pm for the Fri 8am start → GO", () => {
    const partC = "2026-11-11T04:00:00Z"; // Wed 11 Nov 3pm Melbourne
    const tue = "2026-11-10T03:00:00Z"; // Tue 10 Nov 2pm
    const wed4 = "2026-11-11T05:00:00Z"; // Wed 11 Nov 4pm — 40h before the start
    const lines = piesaCopyDeliveryBlockers(START, { owner: [tue], installer: [tue] }, { partCSignedAt: partC });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Updated PIESA \(with Part C\) not delivered to the owner by /);
    expect(lines[1]).toMatch(/^Updated PIESA \(with Part C\) not delivered to the installer by /);
    expect(prestartFailures({ ...ok, piesaCopyBlockers: lines })).toEqual(lines);
    expect(piesaCopyDeliveryBlockers(START, { owner: [tue, wed4], installer: [tue, wed4] }, { partCSignedAt: partC })).toEqual([]);
    // No Part C on the job: the earlier copy still counts (the existing rule, unchanged).
    expect(piesaCopyDeliveryBlockers(START, { owner: [tue], installer: [tue] }, { partCSignedAt: null })).toEqual([]);
    expect(piesaCopyDeliveryBlockers(START, { owner: [tue], installer: [tue] })).toEqual([]);
  });

  test("5 Nov 2026: a DATE-ONLY Part C (piesa_records.section_c_signed_at = YYYY-MM-DDT00:00:00.000Z, i.e. 11am Melbourne) means the start of that Melbourne day — a copy sent that morning counts", () => {
    const partCDate = "2026-11-11T00:00:00.000Z"; // the Wed 11 Nov record, as piesa-record.server stores it
    expect(partCSignedTime(partCDate)).toBe(Date.parse("2026-11-10T13:00:00Z")); // Wed 11 Nov 00:00 Melbourne (AEDT)
    expect(partCSignedTime("2026-11-11T04:00:00Z")).toBe(Date.parse("2026-11-11T04:00:00Z")); // a real instant is used as is
    const wed9am = "2026-11-10T22:00:00Z"; // Wed 11 Nov 9am Melbourne — after the real Part C, before 11am
    expect(piesaCopyDeliveryBlockers(START, { owner: [wed9am], installer: [wed9am] }, { partCSignedAt: partCDate })).toEqual([]);
    const tue = "2026-11-10T03:00:00Z"; // Tue 10 Nov 2pm — the day before Part C: still not the updated PIESA
    expect(piesaCopyDeliveryBlockers(START, { owner: [tue], installer: [tue] }, { partCSignedAt: partCDate })).toHaveLength(2);
  });
  test("Part C copy re-delivered too late (inside 24h) → the Part C line, not the plain one; nothing delivered at all → the plain line", () => {
    const partC = "2026-11-11T04:00:00Z";
    const late = before(20);
    const lines = piesaCopyDeliveryBlockers(START, { owner: [before(60), late], installer: [before(60)] }, { partCSignedAt: partC });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Updated PIESA \(with Part C\) not delivered to the owner by /);
    const none = piesaCopyDeliveryBlockers(START, { owner: [], installer: null }, { partCSignedAt: partC });
    expect(none[0]).toMatch(/^Signed PIESA copy delivery to owner must be recorded by /);
    expect(none[1]).toMatch(/^Signed PIESA copy delivery to installer must be recorded by /);
  });

  test("readyToInstall (Installation complete) applies the same Part C rule when given the fact", () => {
    const partC = "2026-11-11T04:00:00Z", tue = "2026-11-10T03:00:00Z";
    const base = { scheduledStart: START, consent: null, notification: null, piesa: { date: "2026-10-22", deadline: "2026-11-20", outcome: "pass" } };
    const r = readyToInstall({ ...base, deliveries: { owner: [tue], installer: [tue] }, partCSignedAt: partC });
    expect(r.blockers.filter((b) => b.startsWith("Updated PIESA (with Part C)"))).toHaveLength(2);
    const r2 = readyToInstall({ ...base, deliveries: { owner: tue, installer: tue } });
    expect(r2.blockers.some((b) => b.startsWith("Updated PIESA"))).toBe(false);
  });
});

describe("GO check — pin the gates that are already right", () => {
  test("owner consent signed 23h before the start → DON'T START", () => {
    const c = { status: "valid", scheduled_start: START, owner_signed_at: before(23), ap_signed_at: before(23) };
    const consentBlockers = consentValidityBlockers(c as never, START);
    expect(prestartFailures({ ...ok, consentBlockers })).toEqual(["Owner consent: Owner ESC consent was completed less than 24h before start – reschedule"]);
  });
  test("PIESA copy to the owner 23h before → DON'T START", () => {
    const lines = piesaCopyDeliveryBlockers(START, { owner: before(23), installer: before(30) });
    expect(lines).toHaveLength(1);
    expect(prestartFailures({ ...ok, piesaCopyBlockers: lines })[0]).toMatch(/^Signed PIESA copy delivery to owner must be recorded by /);
  });
  test("install day 31 days after the PIESA → the 30-day window line", () => {
    expect(prestartFailures({ ...ok, deadline: "2026-11-12" })).toEqual(["The 30-day window ended on 2026-11-12. New PIESA needed."]);
  });
  test("missing SWMS signature → the SWMS line", () => {
    expect(prestartFailures({ ...ok, swmsBlocker: "Safety plan not signed: Lee" })).toEqual(["Safety plan not signed: Lee"]);
  });
  test("ESC notice sent 23h before → DON'T START", () => {
    expect(prestartFailures({ ...ok, esc: { ...ok.esc!, sent_at: before(23) } })).toEqual(["ESC notification was sent less than 24h before start – reschedule."]);
  });
  test("three breaks at once → three lines, new ones after the existing ones", () => {
    const out = prestartFailures({ ...ok, lead: { ...ok.lead, escRegistered: false }, lifeSupportPlanMissing: true, installDepositBlocker: "Install deposit not paid" });
    expect(out).toEqual(["Install deposit not paid", "Lead Installer Lee is not registered with the ESC yet.", "Life support at this home: the written consent or medical plan isn't on file."]);
  });
  const _d = D; void _d;
});

// The shared reader now returns EVERY delivery time per recipient (ascending) and the current record's Part C time.
type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let failTable: string | null = null; // J5: a table whose reads answer a database error
function from(t: string) {
  let rows = [...(tables[t] ?? [])];
  const q: Record<string, unknown> = {};
  const result = () => (failTable === t ? { data: null, error: { message: `read failed: ${t}` } } : { data: rows, error: null });
  Object.assign(q, {
    select: () => q, eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q; }, neq: () => q, order: () => q, limit: () => q,
    maybeSingle: async () => { const r = result(); return { data: r.error ? null : (rows[0] ?? null), error: r.error }; },
    then: (res: (v: unknown) => unknown) => res(result()),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) } }));
const { piesaCopyDeliveries } = await import("../src/lib/esc.server");

describe("piesaCopyDeliveries returns all delivery times per recipient and the Part C time", () => {
  test("current record only; every time, ascending; Part C from a post-rectification current record", async () => {
    tables = {
      piesa_records: [{ id: "old", job_id: "j1", is_current: false, kind: "initial", section_c_signed_at: null }, { id: "cur", job_id: "j1", is_current: true, kind: "post_rectification", section_c_signed_at: "2026-11-11T04:00:00Z" }],
      piesa_deliveries: [
        { piesa_record_id: "old", recipient: "owner", delivered_at: "2026-10-01T00:00:00Z" },
        { piesa_record_id: "cur", recipient: "owner", delivered_at: "2026-10-23T00:00:00Z" },
        { piesa_record_id: "cur", recipient: "owner", delivered_at: "2026-10-22T00:00:00Z" },
        { piesa_record_id: "cur", recipient: "installer", delivered_at: "2026-10-24T00:00:00Z" },
      ],
    };
    expect(await piesaCopyDeliveries("j1")).toEqual({ owner: ["2026-10-22T00:00:00Z", "2026-10-23T00:00:00Z"], installer: ["2026-10-24T00:00:00Z"], partCSignedAt: "2026-11-11T04:00:00Z" });
  });
  test("an initial record's Section C time is not a Part C; no current record → nothing", async () => {
    tables = { piesa_records: [{ id: "cur", job_id: "j1", is_current: true, kind: "initial", section_c_signed_at: "2026-11-11T04:00:00Z" }], piesa_deliveries: [] };
    expect(await piesaCopyDeliveries("j1")).toEqual({ owner: [], installer: [], partCSignedAt: null });
    tables = { piesa_records: [], piesa_deliveries: [] };
    expect(await piesaCopyDeliveries("j1")).toEqual({ owner: [], installer: [], partCSignedAt: null });
  });
});

describe("J5: the GO check fails CLOSED on a read error", () => {
  test("latestNotices: a read error is returned (no notice assumed) → prestartFailures gives the ESC read-failed line, classified must move", async () => {
    const { latestNotices } = await import("../src/lib/prestart.server");
    const { classifyPrestartFailure, ESC_READ_FAILED } = await import("../src/lib/prestart.core");
    tables = { esc_notifications: [{ id: "n1", job_id: "j1", status: "sent", sent_at: "2026-11-10T00:00:00Z", submission_reference: "R", scheduled_start: START, created_at: "2026-11-09T00:00:00Z", response: null, payload_json: null }] };
    failTable = null;
    expect((await latestNotices("j1")).readError).toBeNull();
    failTable = "esc_notifications";
    const n = await latestNotices("j1");
    expect(n).toEqual({ current: null, previousSent: null, readError: "read failed: esc_notifications" });
    const lines = prestartFailures({ ...ok, esc: n.current, escReadError: n.readError });
    expect(lines).toEqual([ESC_READ_FAILED("read failed: esc_notifications")]);
    expect(classifyPrestartFailure(lines[0]!, { start: START, now: new Date(Date.parse(START) - 3 * D) })).toBe("must_move");
    failTable = null;
  });
  test("attendanceRequiredFor throws on a read error (prestartFacts then records nothing; onInstallBooked catches it)", async () => {
    const att = await import("../src/lib/install-attendance.server");
    tables = { assessments: [{ job_id: "j1", mitti_raw_snapshot: [] }] };
    failTable = null;
    expect(await att.attendanceRequiredFor("j1")).toBe(false);
    failTable = "assessments";
    await expect(att.attendanceRequiredFor("j1")).rejects.toThrow("Couldn't read the safety check answers: read failed: assessments");
    failTable = null;
  });
});

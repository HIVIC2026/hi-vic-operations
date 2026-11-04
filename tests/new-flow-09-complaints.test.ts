// New job flow, Part 9, Task 12: complaints are acknowledged within 5 business days and resolved (aim) within 20.
// Office process only (no owner message). Pure rules in complaints.core; the office records the three events.
import { describe, expect, test } from "bun:test";
import {
  COMPLAINT_ACK_BUSINESS_DAYS, COMPLAINT_ACKNOWLEDGED_EVENT, COMPLAINT_RECEIVED_EVENT, COMPLAINT_RESOLVE_BUSINESS_DAYS, COMPLAINT_RESOLVED_EVENT,
  complaintDue, complaintNeeds, complaintState, type ComplaintEvent,
} from "../src/lib/complaints.core";
import { addMelbourneBusinessDays } from "../src/lib/melbourne-time.core";
import { NEEDS_TEXT } from "../src/lib/allocation.core";
import { buildNeedsRows } from "../src/lib/office-needs.core";

const RECEIVED = "2026-10-30T03:00:00.000Z"; // Fri 30 Oct 2026, 2pm Melbourne
const ev = (type: string, created_at: string, details: Record<string, unknown> = {}): ComplaintEvent => ({ event_type: type, created_at, details });
const received = ev(COMPLAINT_RECEIVED_EVENT, RECEIVED, { received_at: RECEIVED, channel: "phone", summary: "Install left a mess" });

describe("complaintDue: 5 and 20 business days on the Melbourne calendar", () => {
  test("received Fri 30 Oct 2026 → ack-by and resolve-by equal the helper (Melbourne Cup Tue 3 Nov counts only if the helper's calendar has it)", () => {
    const d = complaintDue(RECEIVED);
    expect(COMPLAINT_ACK_BUSINESS_DAYS).toBe(5);
    expect(COMPLAINT_RESOLVE_BUSINESS_DAYS).toBe(20);
    expect(d.ackBy).toBe(addMelbourneBusinessDays(RECEIVED, 5));
    expect(d.resolveBy).toBe(addMelbourneBusinessDays(RECEIVED, 20));
    // Never on a weekend, never earlier than 7 / 28 calendar days later.
    expect(Date.parse(d.ackBy)).toBeGreaterThanOrEqual(Date.parse(RECEIVED) + 7 * 86_400_000 - 1);
    expect(Date.parse(d.resolveBy)).toBeGreaterThanOrEqual(Date.parse(RECEIVED) + 28 * 86_400_000 - 1);
  });
});

describe("complaintState / complaintNeeds: the open complaint and its two office rows", () => {
  const d = complaintDue(RECEIVED);
  const ackFrom = Date.parse(addMelbourneBusinessDays(RECEIVED, 3)) + 1;     // start of business day 4 = 1 business day before ack-by (day 5)
  const resolveFrom = Date.parse(addMelbourneBusinessDays(RECEIVED, 16)) + 1; // start of business day 17 = 3 business days before resolve-by (day 20)
  test("no events → nothing", () => {
    expect(complaintState([])).toBeNull();
    expect(complaintNeeds([], Date.parse(RECEIVED))).toEqual([]);
  });
  test("just received → no row yet (the ack row opens 1 business day before ack-by)", () => {
    expect(complaintNeeds([received], Date.parse(RECEIVED) + 3_600_000)).toEqual([]);
  });
  test("1 business day before ack-by → complaint_ack_due (today); past ack-by → urgent", () => {
    const rows = complaintNeeds([received], ackFrom);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "complaint_ack_due", urgency: "today", dueBy: d.ackBy, since: RECEIVED });
    const late = complaintNeeds([received], Date.parse(d.ackBy) + 1);
    expect(late.find((r) => r.code === "complaint_ack_due")).toMatchObject({ urgency: "urgent" });
  });
  test("acknowledged → ack row gone; resolve row from 3 business days before resolve-by until resolved", () => {
    const acked = [received, ev(COMPLAINT_ACKNOWLEDGED_EVENT, "2026-11-02T00:00:00.000Z")];
    expect(complaintNeeds(acked, ackFrom)).toEqual([]);
    expect(complaintNeeds(acked, resolveFrom - 1)).toEqual([]);
    const rows = complaintNeeds(acked, resolveFrom);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "complaint_resolve_due", urgency: "today", dueBy: d.resolveBy });
    const resolved = [...acked, ev(COMPLAINT_RESOLVED_EVENT, "2026-11-20T00:00:00.000Z")];
    expect(complaintNeeds(resolved, resolveFrom)).toEqual([]);
    expect(complaintState(resolved)).toMatchObject({ acknowledgedAt: "2026-11-02T00:00:00.000Z", resolvedAt: "2026-11-20T00:00:00.000Z" });
  });
  test("not acknowledged but inside the resolve window → both rows", () => {
    const rows = complaintNeeds([received], resolveFrom);
    expect(rows.map((r) => r.code)).toEqual(["complaint_ack_due", "complaint_resolve_due"]);
  });
  test("an acknowledgement recorded BEFORE the latest complaint does not count for it", () => {
    const again = ev(COMPLAINT_RECEIVED_EVENT, "2026-11-10T00:00:00.000Z", { received_at: "2026-11-10T00:00:00.000Z", channel: "email", summary: "Still not fixed" });
    const events = [received, ev(COMPLAINT_ACKNOWLEDGED_EVENT, "2026-11-02T00:00:00.000Z"), ev(COMPLAINT_RESOLVED_EVENT, "2026-11-05T00:00:00.000Z"), again];
    const s = complaintState(events)!;
    expect(s.receivedAt).toBe("2026-11-10T00:00:00.000Z");
    expect(s.acknowledgedAt).toBeNull();
    expect(s.resolvedAt).toBeNull();
  });
  test("a received_at in the details wins over the event time (the office types when it came in)", () => {
    const typed = ev(COMPLAINT_RECEIVED_EVENT, "2026-11-01T00:00:00.000Z", { received_at: RECEIVED, channel: "phone", summary: "x" });
    expect(complaintState([typed])!.receivedAt).toBe(RECEIVED);
  });
});

describe("the office sees it: NEEDS_TEXT codes and Needs me rows", () => {
  test("allocation.core carries both codes", () => {
    expect(NEEDS_TEXT.complaint_ack_due.urgency).toBe("today");
    expect(NEEDS_TEXT.complaint_resolve_due.urgency).toBe("today");
    expect(NEEDS_TEXT.complaint_ack_due.why).toContain("5 business days");
    expect(NEEDS_TEXT.complaint_resolve_due.why).toContain("20 business days");
  });
  test("Needs me: one row per open complaint step, with the due day", () => {
    const g = buildNeedsRows({ now: Date.parse("2026-11-05T00:00:00Z"), jobs: [{ jobId: "j1", jobNumber: "HV-1", surname: "Smith", suburb: "Kew", complaints: [{ code: "complaint_ack_due", since: RECEIVED, dueBy: "2026-11-06T12:59:59.999Z", urgency: "today" }] }] });
    const row = g.today.find((r) => r.kind === "complaint_ack_due")!;
    expect(row.line).toBe("Complaint — acknowledge by Fri 6 Nov");
    expect(row.button).toEqual({ label: "Open job", to: "job", section: "contact" });
    const late = buildNeedsRows({ now: Date.parse("2026-11-09T00:00:00Z"), jobs: [{ jobId: "j1", jobNumber: "HV-1", surname: "Smith", suburb: "Kew", complaints: [{ code: "complaint_ack_due", since: RECEIVED, dueBy: "2026-11-06T12:59:59.999Z", urgency: "urgent" }] }] });
    expect(late.today.find((r) => r.kind === "complaint_ack_due")!.line).toBe("Complaint — acknowledgement overdue (was due Fri 6 Nov)");
    const res = buildNeedsRows({ now: Date.parse("2026-11-25T00:00:00Z"), jobs: [{ jobId: "j1", jobNumber: "HV-1", surname: "Smith", suburb: "Kew", complaints: [{ code: "complaint_resolve_due", since: RECEIVED, dueBy: "2026-11-27T12:59:59.999Z", urgency: "today" }] }] });
    expect(res.today.find((r) => r.kind === "complaint_resolve_due")!.line).toBe("Complaint — aim to resolve by Fri 27 Nov");
  });
});

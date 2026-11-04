// Part 9 Task 6: the GO / DON'T START check runs at 2pm Melbourne the day before and 6:30am on the day (spec "VEU and ESC
// timing rules"). Pure slots in prestart.core; the sweep asks dueGoSlot per upcoming install; a slot run always writes
// ONE pre_start_checks row per slot (other triggers keep "record only when changed").
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GO_SLOTS, dueGoSlot, goSlotTimes, prestartRunAt, type GoSlot } from "../src/lib/prestart.core";

const START = "2026-11-11T21:00:00Z"; // Thu 12 Nov 2026 8:00am Melbourne (AEDT)
const WED_1359 = "2026-11-11T02:59:00Z", WED_1400 = "2026-11-11T03:00:00Z", THU_0629 = "2026-11-11T19:29:00Z", THU_0630 = "2026-11-11T19:30:00Z", THU_0800 = START;
const at = (iso: string) => new Date(iso);

describe("GO slots (pure)", () => {
  test("two slots: 2pm the day before, 6:30am on the day", () => {
    expect(GO_SLOTS.map((s) => s.key)).toEqual(["day_before_2pm", "on_day_630am"]);
    expect(goSlotTimes(START)).toEqual({ day_before_2pm: "2026-11-11T03:00:00.000Z", on_day_630am: "2026-11-11T19:30:00.000Z" });
    // prestartRunAt is the 2pm slot (the lock time prestartLocked uses).
    expect(prestartRunAt(START)).toBe("2026-11-11T03:00:00.000Z");
  });
  test("across the 4 Oct 2026 DST change: install Sun 4 Oct 8am AEDT → 2pm Sat is AEST, 6:30am Sun is AEDT", () => {
    expect(goSlotTimes("2026-10-03T21:00:00Z")).toEqual({ day_before_2pm: "2026-10-03T04:00:00.000Z", on_day_630am: "2026-10-03T19:30:00.000Z" });
    expect(goSlotTimes("2026-10-05T21:00:00Z")).toEqual({ day_before_2pm: "2026-10-05T03:00:00.000Z", on_day_630am: "2026-10-05T19:30:00.000Z" }); // Tue 6 Oct 8am
  });
  test("dueGoSlot: latest passed slot not yet done, before the start", () => {
    expect(dueGoSlot(START, at(WED_1359), [])).toBeNull();
    expect(dueGoSlot(START, at(WED_1400), [])).toBe("day_before_2pm");
    expect(dueGoSlot(START, at(WED_1400), ["day_before_2pm"])).toBeNull();
    expect(dueGoSlot(START, at(THU_0629), ["day_before_2pm"])).toBeNull();
    expect(dueGoSlot(START, at(THU_0630), ["day_before_2pm"])).toBe("on_day_630am");
    expect(dueGoSlot(START, at(THU_0630), ["day_before_2pm", "on_day_630am"])).toBeNull();
    expect(dueGoSlot(START, at(THU_0800), ["day_before_2pm"])).toBeNull(); // the install has started
    // Booked late (after 2pm the day before): the latest passed slot is the one that runs, once.
    expect(dueGoSlot(START, at(THU_0630), [])).toBe("on_day_630am");
  });
});

// ── server: runPrestart / sweepPrestart against an in-memory PostgREST, facts readers mocked ─────────────────────
type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" = "select";
  let order: { col: string; asc: boolean } | null = null;
  let limit: number | null = null;
  const res = () => {
    if (op === "insert") return { data: null, error: null };
    let rows = (tables[t] ?? []).filter((x) => filters.every((f) => f(x)));
    if (order) rows = [...rows].sort((a, b) => String(a[order!.col] ?? "").localeCompare(String(b[order!.col] ?? "")) * (order!.asc ? 1 : -1));
    if (limit !== null) rows = rows.slice(0, limit);
    return { data: rows, error: null };
  };
  const one = async () => { const r = res(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
    neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return q; },
    gt: (k: string, v: string) => { filters.push((r) => String(r[k]) > v); return q; },
    lt: (k: string, v: string) => { filters.push((r) => String(r[k]) < v); return q; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q; },
    order: (col: string, o?: { ascending?: boolean }) => { order = { col, asc: o?.ascending !== false }; return q; },
    limit: (n: number) => { limit = n; return q; },
    not: () => q, or: () => q, contains: () => q, range: () => q,
    insert: (r: Row) => { op = "insert"; (tables[t] ??= []).push({ id: crypto.randomUUID(), checked_at: new Date().toISOString(), ...r }); return q; },
    maybeSingle: one, single: one,
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  piesaStatus: async () => null,
  logEvent: async (job_id: string, _a: unknown, event_type: string, summary: string, details: Row = {}) => { (tables["workflow_events"] ??= []).push({ id: crypto.randomUUID(), job_id, event_type, summary, details, created_at: new Date().toISOString() }); },
}));
// The facts readers: everything clear except what the test flips; the lead comes from the in-memory tables (none → fails).
mock.module("../src/lib/allocation.server", () => ({ clearanceFacts: async () => ({ piesaCompletedAt: "2026-11-01" }) }));
mock.module("../src/lib/allocation.core", () => ({ electricalClearance: () => ({ cleared: true, blocker: null, timingDate: "2026-11-01" }) }));
mock.module("../src/lib/install-days.core", () => ({ installWindowDeadline: () => "2026-12-01" }));
mock.module("../src/lib/consent.server", () => ({ currentConsent: async () => null }));
mock.module("../src/lib/consent.core", () => ({ consentValidityBlockers: () => [] }));
mock.module("../src/lib/ready-check-draft.server", () => ({ rcWorksBlockers: async () => [] }));
mock.module("../src/lib/installer-intake.server", () => ({ siteConditionsHoldFor: async () => ({ open: false }) }));
mock.module("../src/lib/swms.server", () => ({ swmsStatusFor: async () => null }));
mock.module("../src/lib/swms.core", () => ({ swmsBlocker: () => null }));
mock.module("../src/lib/payments.server", () => ({ jobPaymentView: async () => null }));
mock.module("../src/lib/esc.server", () => ({ piesaCopyDeliveries: async () => ({ owner: [], installer: [] }), activeEscConfig: async () => null }));
mock.module("../src/lib/in-house-booking.server", () => ({ leadNoticeBlocker: async () => null, latestLeadNotice: async () => null }));
mock.module("../src/lib/esc-collection-notice.server", () => ({ noticeAckMap: async () => new Map() }));
mock.module("../src/lib/business-insurance.server", () => ({ publicLiabilityExpiryFor: async () => new Map() }));
mock.module("../src/lib/go-email.server", () => ({ sendGoEmail: async () => "mocked" }));

const ps = await import("../src/lib/prestart.server");
const checks = () => (tables["pre_start_checks"] ?? []).map((r) => ({ trigger: r["trigger"], passed: r["passed"], start: r["scheduled_start"] }));

beforeEach(() => {
  tables = {
    bookings: [{ id: "BK1", job_id: "J1", kind: "installation", status: "confirmed", scheduled_start: START, assignment_id: "A1", created_at: "2026-11-05T00:00:00Z" }],
    jobs: [{ id: "J1", job_number: "HV-1234", source: "website" }],
    pre_start_checks: [],
    workflow_events: [],
  };
});

describe("runPrestart / sweepPrestart slots", () => {
  test("the sweep at 1:59pm the day before runs nothing; at 2pm it writes the 2pm slot row once; at 6:30am the on-day row once", async () => {
    expect(await ps.sweepPrestart(at(WED_1359))).toEqual({ ran: 0, failed: 0 });
    expect(checks()).toEqual([]);
    expect(await ps.sweepPrestart(at(WED_1400))).toEqual({ ran: 1, failed: 1 });
    expect(checks()).toEqual([{ trigger: "day_before_2pm", passed: false, start: START }]);
    // Same result at 2:15pm: the slot already ran, nothing new.
    expect(await ps.sweepPrestart(at("2026-11-11T03:15:00Z"))).toEqual({ ran: 0, failed: 0 });
    expect(checks()).toHaveLength(1);
    expect(await ps.sweepPrestart(at(THU_0629))).toEqual({ ran: 0, failed: 0 });
    expect(await ps.sweepPrestart(at(THU_0630))).toEqual({ ran: 1, failed: 1 });
    expect(checks().map((c) => c.trigger)).toEqual(["day_before_2pm", "on_day_630am"]);
    expect(await ps.sweepPrestart(at("2026-11-11T19:45:00Z"))).toEqual({ ran: 0, failed: 0 });
    expect(checks()).toHaveLength(2);
  });
  test("Review Focus #2: an old 12pm 'timer' row for tomorrow already exists — the 2pm slot still runs and writes one slot row, even with the same result", async () => {
    const old = (await ps.runPrestart("J1", "timer", at(WED_1400)))!; // the old flow's row (recorded by trigger name only)
    expect(old.changed).toBe(true);
    tables["pre_start_checks"]![0]!["trigger"] = "timer"; tables["pre_start_checks"]![0]!["checked_at"] = "2026-11-11T01:00:00Z"; // make it the old 12pm row
    expect(await ps.sweepPrestart(at(WED_1400))).toEqual({ ran: 1, failed: 1 });
    expect(checks().map((c) => c.trigger)).toEqual(["timer", "day_before_2pm"]);
    // The old row is not lost and nothing is duplicated: the next sweep adds nothing.
    expect(await ps.sweepPrestart(at("2026-11-11T04:00:00Z"))).toEqual({ ran: 0, failed: 0 });
    expect(checks()).toHaveLength(2);
  });
  test("other triggers keep 'record only when changed'; a slot run reports its slot", async () => {
    expect((await ps.runPrestart("J1", "office", at(WED_1400)))!.changed).toBe(true);
    expect((await ps.runPrestart("J1", "office", at("2026-11-11T03:10:00Z")))!.changed).toBe(false);
    expect(checks()).toHaveLength(1);
    const r = await ps.runPrestart("J1", "day_before_2pm", at("2026-11-11T03:20:00Z"));
    expect(r).toMatchObject({ changed: true, slot: "day_before_2pm" });
    expect(checks().map((c) => c.trigger)).toEqual(["office", "day_before_2pm"]);
    // The same slot a second time writes nothing more.
    expect((await ps.runPrestart("J1", "day_before_2pm", at("2026-11-11T03:30:00Z")))!.changed).toBe(false);
    expect(checks()).toHaveLength(2);
  });
  test("a moved install gets its own slot rows (done = slot keys for THAT start)", async () => {
    await ps.sweepPrestart(at(WED_1400));
    const MOVED = "2026-11-12T21:00:00Z"; // Fri 13 Nov 8am
    tables["bookings"]![0]!["scheduled_start"] = MOVED;
    expect(await ps.sweepPrestart(at("2026-11-12T03:00:00Z"))).toEqual({ ran: 1, failed: 1 }); // Thu 2pm
    expect(checks().map((c) => [c.trigger, c.start])).toEqual([["day_before_2pm", START], ["day_before_2pm", MOVED]]);
  });
  test("before 2pm the day before nothing runs; from the start nothing runs", async () => {
    expect(await ps.runPrestart("J1", "office", at("2026-11-10T03:00:00Z"))).toBeNull();
    expect(await ps.runPrestart("J1", "office", at(THU_0800))).toBeNull();
  });
  test("the slot type is closed", () => {
    const s: GoSlot[] = ["day_before_2pm", "on_day_630am"];
    expect(s).toHaveLength(2);
  });
});

// Booking-control gaps 1 and 4 against an in-memory fake database (no network, no real writes):
// - Gap 1: the PIESA Mitti form can only be created once a PIESA visit is confirmed in the portal
//   (Ready Check forms are unaffected — they come before any PIESA booking)
// - Gap 4: AP review / Ready for VEEC require the install booking recorded as unlocking the
//   installation to be the completed one
import { describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  let rows = [...(tables[t] ?? [])];
  let op = "select";
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { if (op === "select") rows = rows.filter((r) => r[k] === v); return q; },
    in: (k: string, v: unknown[]) => { if (op === "select" && rows.some((r) => k in r)) rows = rows.filter((r) => !(k in r) || v.includes(r[k])); return q; },
    neq: () => q, not: () => q, is: () => q, gt: () => q, lt: () => q,
    order: (k: string, o?: { ascending?: boolean }) => { rows.sort((a, b) => String(a[k] ?? "").localeCompare(String(b[k] ?? "")) * (o?.ascending === false ? -1 : 1)); return q; },
    limit: (n: number) => { rows = rows.slice(0, n); return q; },
    update: () => { op = "update"; return q; }, insert: () => { op = "insert"; return q; },
    maybeSingle: async () => ({ data: op === "select" ? rows[0] ?? null : null, error: null }),
    single: async () => ({ data: op === "select" ? rows[0] ?? null : null, error: rows[0] ? null : { message: "none" } }),
    then: (res: (v: unknown) => unknown) => res({ data: op === "select" ? rows : null, error: null }),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) } }));
// The official PIESA mapping approval is a separate launch gate; here we isolate the booking guard.
const realOfficial = await import("../src/lib/official-forms.core");
mock.module("../src/lib/official-forms.core", () => ({ ...realOfficial, officialFormUseBlocker: () => null }));

const { createAssignMittiAudit, PIESA_BOOKING_MISSING } = await import("../src/lib/mitti.server");
const { installBookingBlocker, INSTALL_BOOKING_BLOCKER } = await import("../src/lib/workflow.server");

const J = "job-1";
function seedJob(stage: string, bookings: Row[]) {
  tables = {
    jobs: [{ id: J, job_number: "HV-TEST", business_unit: "hivic", stage, property_id: "p1", owner_id: "o1", channel: "hivic_sourced", measure_up_responsibility: null, estimated_area_m2: null, life_support: false, life_support_status: null }],
    properties: [{ id: "p1", address_line: "1 Test St", suburb: "Bendigo", state: "VIC", postcode: "3550", occupancy: null, enrichment: null }],
    owners: [{ id: "o1", full_name: "Test Owner", email: null, phone: null }],
    job_assignments: [{ user_id: "u1", job_id: J, role: "electrician", active: true, profiles: { full_name: "Test Elec", email: "elec@example.test" } }],
    workflow_settings: [{ id: 1, mitti_piesa_template_id: "tpl-piesa", mitti_ready_check_template_id: "tpl-rc", mitti_ready_check_priced_template_id: "tpl-rcp" }],
    ceiling_measurements: [],
    assessments: [],
    workflow_events: [],
    bookings,
  };
}
const failCall = async () => { throw new Error("network stub"); };

describe("Gap 1 — PIESA form only after a confirmed booking", () => {
  test("no confirmed PIESA booking → form creation refused", async () => {
    seedJob("piesa_scheduled", []);
    await expect(createAssignMittiAudit(J, "office-1", failCall)).rejects.toThrow(PIESA_BOOKING_MISSING);
  });
  test("proposed (not confirmed) booking → still refused", async () => {
    seedJob("piesa_scheduled", [{ id: "b1", job_id: J, kind: "assessment", status: "proposed", scheduled_start: "2026-10-10" }]);
    await expect(createAssignMittiAudit(J, "office-1", failCall)).rejects.toThrow(PIESA_BOOKING_MISSING);
  });
  test("confirmed PIESA booking → booking guard passes (fails later only on the stubbed network)", async () => {
    seedJob("piesa_scheduled", [{ id: "b1", job_id: J, kind: "assessment", status: "confirmed", scheduled_start: "2026-10-10" }]);
    await expect(createAssignMittiAudit(J, "office-1", failCall)).rejects.not.toThrow(PIESA_BOOKING_MISSING);
  });
  test("Ready Check stage needs no booking (installer form comes first)", async () => {
    seedJob("ready_check_scheduled", []);
    await expect(createAssignMittiAudit(J, "office-1", failCall)).rejects.not.toThrow(PIESA_BOOKING_MISSING);
  });
});

describe("Gap 4 — install booking recorded and completed before AP review", () => {
  test("no recorded booking → blocked", async () => {
    tables = { workflow_events: [], bookings: [] };
    expect(await installBookingBlocker(J)).toBe(INSTALL_BOOKING_BLOCKER);
  });
  test("recorded booking not completed → blocked", async () => {
    tables = {
      workflow_events: [{ job_id: J, event_type: "install_unlocked_by_booking", details: { booking_id: "bk1" }, created_at: "2026-01-01" }],
      bookings: [{ id: "bk1", kind: "installation", status: "confirmed" }],
    };
    expect(await installBookingBlocker(J)).toBe(INSTALL_BOOKING_BLOCKER);
  });
  test("recorded booking completed → allowed", async () => {
    tables = {
      workflow_events: [{ job_id: J, event_type: "install_unlocked_by_booking", details: { booking_id: "bk1" }, created_at: "2026-01-01" }],
      bookings: [{ id: "bk1", kind: "installation", status: "completed" }],
    };
    expect(await installBookingBlocker(J)).toBeNull();
  });
});

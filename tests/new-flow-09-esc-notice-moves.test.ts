// Part 9 Task 1 (Review Focus #1): after the ESC notice is sent, the office task must follow the same rule as the robot
// (`registryChange`, Activity Guide v1.2 §3.3.3): an install moved inside 5 days = update on the same ID; moved further out,
// or the ADDRESS changed with the same start = withdraw and resubmit; the Lead Installer changed with the same start =
// update. And every notice change re-runs the GO check (`runPrestart(jobId, "esc_regenerated")`).
import { describe, expect, mock, test } from "bun:test";
import { registryChange, REGISTRY_FIELDS_VERSION } from "../src/lib/esc.core";
import { escReminder, escTask, type EscNotice } from "../src/lib/prestart.core";

// Melbourne (AEDT, +11): Thu 5 Nov 2026 10am, Sat 7 Nov 10am, Fri 13 Nov 10am (8 days after Thu); now = Tue 3 Nov 10am.
const THU = "2026-11-04T23:00:00Z", SAT = "2026-11-06T23:00:00Z", EIGHT_DAYS = "2026-11-12T23:00:00Z";
const NOW = new Date("2026-11-02T23:00:00Z");
const payload = (o: Record<string, string> = {}) => ({
  fields_version: REGISTRY_FIELDS_VERSION,
  additional: { installation_start: THU, premises_address: "1 Test St, Coburg VIC 3058", lead_installer: "Old Lead", ...o },
});
const sentPrev = (start = THU) => ({ scheduled_start: start, sent_at: "2026-11-01T23:00:00Z", submission_reference: "VEU-123", payload_json: payload({ installation_start: start }) });
const prev = (start = THU): EscNotice => ({ status: "sent", sent_at: "2026-11-01T23:00:00Z", submission_reference: "VEU-123", scheduled_start: start });
const current = (start: string): EscNotice => ({ status: "ready", sent_at: null, submission_reference: null, scheduled_start: start });
const task = (start: string, next: Record<string, string>) => {
  const change = registryChange(sentPrev(), { scheduled_start: start, payload_json: payload({ installation_start: start, ...next }) }, NOW.toISOString());
  return { change, task: escTask({ start, current: current(start), previousSent: prev(), change, now: NOW }) };
};

describe("ESC notice after it was sent: update on the same ID vs withdraw and resubmit", () => {
  test("start moves Thu 10am → Sat 10am (inside 5 days) → update on the same ID", () => {
    const { change, task: t } = task(SAT, {});
    expect(change.action).toBe("update_same_id");
    expect(t?.code).toBe("esc_update_registry");
  });
  test("start moves 8 days out → withdraw and resubmit, saying why", () => {
    const { change, task: t } = task(EIGHT_DAYS, {});
    expect(change.action).toBe("withdraw_and_resubmit");
    expect(t?.code).toBe("esc_withdraw_resubmit");
    expect(t?.detail).toContain("more than 5 days away");
  });
  test("same start, installation address changed → withdraw and resubmit (today's start-only task said Submit)", () => {
    const { change, task: t } = task(THU, { premises_address: "2 Other St, Coburg VIC 3058" });
    expect(change.action).toBe("withdraw_and_resubmit");
    expect(t?.code).toBe("esc_withdraw_resubmit");
    expect(t?.detail).toContain("Installation address");
  });
  test("same start, Lead Installer changed → update on the same ID", () => {
    const { change, task: t } = task(THU, { lead_installer: "New Lead" });
    expect(change.action).toBe("update_same_id");
    expect(t?.code).toBe("esc_update_registry");
  });
  test("no change payload (callers without one) keeps today's start-only rule", () => {
    expect(escTask({ start: SAT, current: current(SAT), previousSent: prev(), change: null, now: NOW })?.code).toBe("esc_update_registry");
    expect(escTask({ start: EIGHT_DAYS, current: current(EIGHT_DAYS), previousSent: prev(), change: null, now: NOW })?.code).toBe("esc_withdraw_resubmit");
    // Same start, nothing known about the payload: today's rule (Tue 10am → Thu 10am is 48h = urgent submit).
    expect(escTask({ start: THU, current: current(THU), previousSent: prev(), change: null, now: NOW })?.code).toBe("esc_submit_urgent");
  });
  test("the office reminder forwards the change: an address change with the same start is raised once, naming the address", () => {
    const change = registryChange(sentPrev(), { scheduled_start: THU, payload_json: payload({ premises_address: "2 Other St, Coburg VIC 3058" }) }, NOW.toISOString());
    const r = escReminder({ start: THU, current: current(THU), previousSent: prev(), change, now: NOW });
    expect(r?.code).toBe("esc_details_changed");
    expect(r?.detail).toContain("Installation address");
    expect(r?.key).toBe(`${new Date(THU).toISOString()}:esc_details_changed`);
  });
});

// ── Server: regenerateEscNotification ends with runPrestart(jobId, "esc_regenerated") on every path ──
const prestartCalls: [string, string][] = [];
const bookings: Record<string, unknown>[] = [];
const inserted: Record<string, unknown>[] = [];
function q(table: string) {
  const api: any = {};
  const chain = ["select", "eq", "neq", "in", "not", "is", "order", "limit", "update", "or"];
  for (const k of chain) api[k] = () => api;
  api.insert = (row: Record<string, unknown>) => { inserted.push({ table, ...row }); return api; };
  api.maybeSingle = async () => ({ data: table === "bookings" ? bookings[0] ?? null : null, error: null });
  api.single = async () => ({ data: table === "bookings" ? bookings[0] ?? null : table === "esc_notifications" && inserted.length ? { id: "n-new" } : table === "jobs" ? { job_number: "HV-9001", owners: { full_name: "Test Owner", email: null, phone: null }, properties: { address_line: "1 Test St", suburb: "Coburg", state: "VIC", postcode: "3058" } } : null, error: null });
  api.then = (res: any, rej: any) => Promise.resolve({ data: null, error: null }).then(res, rej);
  return api;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q } }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class extends Error {}, logEvent: async () => {}, piesaStatus: async () => null }));
mock.module("../src/lib/consent.server", () => ({ syncOwnerConsent: async () => {}, currentConsent: async () => null }));
mock.module("../src/lib/official-forms.server", () => ({ currentCopy: async () => ({ copy: null }) }));
mock.module("../src/lib/prestart.server", () => ({
  runPrestart: async (jobId: string, trigger: string) => { prestartCalls.push([jobId, trigger]); return null; },
  leadInstallerCert: async () => null,
  latestNotices: async () => ({ current: null, previousSent: null }),
}));

describe("every notice change re-runs the GO check", () => {
  test("no installation booking (nothing to prepare) → still runPrestart(jobId, 'esc_regenerated')", async () => {
    const { regenerateEscNotification } = await import("../src/lib/esc.server");
    bookings.length = 0; prestartCalls.length = 0;
    expect(await regenerateEscNotification("job-no-booking", null)).toBeNull();
    expect(prestartCalls).toEqual([["job-no-booking", "esc_regenerated"]]);
  });
  test("a booking: the notice is prepared, then runPrestart(jobId, 'esc_regenerated') once", async () => {
    const { regenerateEscNotification } = await import("../src/lib/esc.server");
    bookings.splice(0, bookings.length, { id: "b1", scheduled_start: THU, scheduled_end: null });
    prestartCalls.length = 0; inserted.length = 0;
    const id = await regenerateEscNotification("job-booked", null);
    expect(id).toBe("n-new");
    expect(inserted.some((r) => r["table"] === "esc_notifications")).toBe(true);
    expect(prestartCalls).toEqual([["job-booked", "esc_regenerated"]]);
  });
});

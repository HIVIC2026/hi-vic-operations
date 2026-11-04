// New job flow, Part 6, Task 3: booking the safety check and the upgrades day from the electrician's link. The REAL
// electrician-link.server runs against an in-memory database; the canonical booking path (validateBooking/confirmBooking)
// and the owner "You're booked" notice are replaced by recording fakes. Own file: it mocks modules for the whole process.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const J = "00000000-0000-4000-8000-0000000000a1", INST = "00000000-0000-4000-8000-0000000000b1", ELEC = "00000000-0000-4000-8000-0000000000b2";
const W = "00000000-0000-4000-8000-0000000000c1", USER = "00000000-0000-4000-8000-0000000000d1";
const NOW = Date.parse("2026-11-03T02:00:00.000Z");
const START = "2026-11-06T23:00:00.000Z"; // Sat 7 Nov 10:00am Melbourne
const START2 = "2026-11-09T23:00:00.000Z";

const tables: Tables = {};
class WorkflowError extends Error {}
const calls: { validate: unknown[][]; confirm: unknown[][]; notify: unknown[][] } = { validate: [], confirm: [], notify: [] };
let validateFails: string | null = null;

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: false, error: null }) } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  logEvent: async (jobId: string, actorId: string | null, eventType: string, summary: string, details: Record<string, unknown>) => {
    (tables["workflow_events"] ??= []).push({ id: `e${tables["workflow_events"]!.length}`, job_id: jobId, actor_id: actorId, event_type: eventType, summary, details, created_at: new Date(NOW).toISOString() });
  },
}));
mock.module("../src/lib/booking.server", () => ({
  validateBooking: async (...a: unknown[]) => {
    calls.validate.push(a);
    await new Promise((r) => setTimeout(r, 5));
    if (validateFails) throw new WorkflowError(validateFails);
    return { stage: "piesa_scheduled", target: "piesa_scheduled" };
  },
  confirmBooking: async (jobId: string, kind: string, start: string, actorId: string | null) => {
    calls.confirm.push([jobId, kind, start, actorId]);
    await new Promise((r) => setTimeout(r, 5));
    for (const b of tables["bookings"]!) if (b["kind"] === kind && b["status"] === "confirmed") b["status"] = "cancelled";
    tables["bookings"]!.push({ id: `b${tables["bookings"]!.length}`, job_id: jobId, kind, status: "confirmed", scheduled_start: start, booked_by: actorId });
    return { ok: true };
  },
}));
mock.module("../src/lib/in-house-booking.server", () => ({ notifyOwnerBooked: async (...a: unknown[]) => { calls.notify.push(a); return "sent"; } }));

const server = await import("../src/lib/electrician-link.server");

function seed(over: { piesaBookedBy?: string | null; outcome?: "pass" | "fail" | null; sameDay?: boolean } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  calls.validate.length = 0; calls.confirm.length = 0; calls.notify.length = 0; validateFails = null;
  tables["properties"] = [{ id: "p1", address_line: "12 Smith St, Kew", suburb: "Kew" }];
  // A failed PIESA (upgrades needed) puts the job at the upgrades-booking stage; the plain-reason rule (main #137, carried onto
  // this link) moves nothing from there, so the mocked booking path is what books.
  tables["jobs"] = [{ id: J, job_number: "HV-5001", source: "qa_test", stage: over.outcome === "fail" && !over.sameDay ? "rectification_scheduling" : "piesa_and_install_window_pending", property_id: "p1", deleted_at: null }];
  tables["businesses"] = [
    { id: INST, name: "Smith Insulation", trading_name: null, phone: "03 9000 0001", email: "office@smith.test", onboarding_notes: null, piesa_booked_by: "piesaBookedBy" in over ? over.piesaBookedBy : "electrician" },
    { id: ELEC, name: "Spark Co", trading_name: null, phone: "03 9000 0002", email: "office@spark.test", onboarding_notes: null },
  ];
  tables["job_assignments"] = [
    { id: "a1", job_id: J, business_id: INST, role: "installer", active: true, user_id: null },
    { id: "a2", job_id: J, business_id: ELEC, role: "electrician", active: true, user_id: USER },
  ];
  tables["partner_workers"] = [{ id: W, business_id: ELEC, full_legal_name: "Sam Spark", mobile: "0422 222 222", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: USER }];
  tables["worker_job_links"] = [];
  tables["contact_releases"] = [];
  tables["job_overview"] = [{ id: J, owner_name: "Helen Owner", owner_phone: "0411 111 111", property_address: "12 Smith St, Kew VIC 3101" }];
  tables["bookings"] = [];
  const done = over.outcome ?? null;
  tables["assessments"] = [{ id: "as1", job_id: J, external_mitti_id: "audit-a3", completed_at: done ? "2026-11-02T00:00:00Z" : null, piesa_outcome: done ?? "pending",
    mitti_raw_snapshot: over.sameDay ? [{ label: "Have you completed all of the repair work listed above, and is the ceiling now safe for insulation?", value: "Yes" }] : null }];
  tables["workflow_events"] = [];
  tables["documents"] = [];
}
beforeEach(() => seed());

async function token() { return (await server.mintElectricianLink(J, W, null, NOW)).token; }
const bookings = () => tables["bookings"]!.filter((b) => b["status"] === "confirmed");

describe("bookFromElectricianLink: who books", () => {
  test("office: refused with the plain message and no booking", async () => {
    seed({ piesaBookedBy: "office" });
    const r = await server.bookFromElectricianLink(await token(), "assessment", START, NOW);
    expect(r).toEqual({ ok: false, message: "Your installer books this one. Call them if the time needs to change." });
    expect(tables["bookings"]).toHaveLength(0);
    expect(calls.confirm).toHaveLength(0);
  });
  test("a missing setting counts as office", async () => {
    seed({ piesaBookedBy: null });
    expect((await server.bookFromElectricianLink(await token(), "assessment", START, NOW)).ok).toBe(false);
    expect(tables["bookings"]).toHaveLength(0);
  });
  test("electrician: books a confirmed safety check through the canonical path; the link then shows the safety check day", async () => {
    const t = await token();
    const r = await server.bookFromElectricianLink(t, "assessment", START, NOW);
    expect(r).toEqual({ ok: true, start: START });
    expect(bookings()).toHaveLength(1);
    expect(bookings()[0]).toMatchObject({ kind: "assessment", status: "confirmed", scheduled_start: START });
    expect(calls.validate[0]!.slice(0, 3)).toEqual([J, "assessment", START]);
    expect(calls.validate[0]![4]).toBe(W);
    expect(calls.confirm).toHaveLength(1);
    const v = await server.electricianLinkView(t, NOW);
    expect(v.view.step).toBe("piesa_day");
  });
  test("the owner's 'You're booked' notice is asked for through the existing in-house path, with this electrician", async () => {
    await server.bookFromElectricianLink(await token(), "assessment", START, NOW);
    expect(calls.notify).toHaveLength(1);
    expect(calls.notify[0]!.slice(0, 3)).toEqual([J, "piesa", START]);
    expect(calls.notify[0]![3]).toMatchObject({ id: W, name: "Sam Spark" });
  });
  test("records electrician_link_booked { kind, start, worker_id }", async () => {
    await server.bookFromElectricianLink(await token(), "assessment", START, NOW);
    const ev = tables["workflow_events"]!.find((e) => e["event_type"] === "electrician_link_booked")!;
    expect(ev["details"]).toEqual({ kind: "assessment", start: START, worker_id: W });
  });
  test("either: office booked first, so the link has no Book step and refuses with the day", async () => {
    seed({ piesaBookedBy: "either" });
    const t = await token();
    tables["bookings"]!.push({ id: "office1", job_id: J, kind: "assessment", status: "confirmed", scheduled_start: START });
    expect((await server.electricianLinkView(t, NOW)).view.step).toBe("piesa_day");
    const r = await server.bookFromElectricianLink(t, "assessment", START2, NOW);
    expect(r).toEqual({ ok: false, message: "Already booked for Sat 7 Nov, 10:00am." });
    expect(calls.confirm).toHaveLength(0);
    expect(bookings()).toHaveLength(1);
  });
  test("either: two calls at once never double-book — the lock runs them one after the other; the second (same person, new time) is a change of time, still ONE confirmed booking", async () => {
    seed({ piesaBookedBy: "either" });
    const t = await token();
    const [a, b] = await Promise.all([server.bookFromElectricianLink(t, "assessment", START, NOW), server.bookFromElectricianLink(t, "assessment", START2, NOW)]);
    expect(bookings()).toHaveLength(1);
    expect(bookings()[0]!["scheduled_start"]).toBe(START2);
    expect(calls.confirm).toHaveLength(2); // I6: the second press re-books through confirmBooking (which cancelled the first)
    expect([a.ok, b.ok]).toEqual([true, true]);
  });
  test("pressing the same time again is fine and books nothing more (the same instant in another timestamp format too)", async () => {
    const t = await token();
    await server.bookFromElectricianLink(t, "assessment", START, NOW);
    const r = await server.bookFromElectricianLink(t, "assessment", START, NOW);
    expect(r).toEqual({ ok: true, start: START });
    // I6: the stored booking time may come back in another format ("+00:00", no millis); it is the same instant.
    tables["bookings"]![0]!["scheduled_start"] = "2026-11-06T23:00:00+00:00";
    expect((await server.bookFromElectricianLink(t, "assessment", START, NOW)).ok).toBe(true);
    expect(calls.confirm).toHaveLength(1);
    expect(calls.notify).toHaveLength(1);
  });
  // I6: approved #39 wording says "Need to change the time? Call {owner}, then update it on the job."
  test("the SAME electrician changes the time on the job: re-booked through the canonical path (it cancels the earlier booking), a new event, the owner told again", async () => {
    const t = await token();
    await server.bookFromElectricianLink(t, "assessment", START, NOW);
    const r = await server.bookFromElectricianLink(t, "assessment", START2, NOW);
    expect(r).toEqual({ ok: true, start: START2 });
    expect(calls.confirm).toHaveLength(2);
    expect(bookings()).toHaveLength(1);
    expect(bookings()[0]!["scheduled_start"]).toBe(START2);
    expect(tables["workflow_events"]!.filter((e) => e["event_type"] === "electrician_link_booked").map((e) => (e["details"] as { start: string }).start)).toEqual([START, START2]);
    expect(calls.notify).toHaveLength(2);
  });
  test("R2: a change of time is only for the step that is still that visit — the upgrades day with the A4 already done is refused (a done A4 never gets a second form)", async () => {
    seed({ outcome: "fail" });
    const t = await token();
    expect((await server.bookFromElectricianLink(t, "rectification", START, NOW)).ok).toBe(true);
    tables["workflow_events"]!.push({ id: "fc", job_id: J, event_type: "fixes_form_created", summary: "", details: { audit_id: "a4" }, created_at: "2026-11-03T03:00:00Z" }, { id: "fd", job_id: J, event_type: "fixes_form_completed", summary: "", details: { audit_id: "a4" }, created_at: "2026-11-07T03:00:00Z" });
    expect(await server.bookFromElectricianLink(t, "rectification", START2, NOW)).toEqual({ ok: false, message: "There's nothing to book on this job right now." });
    expect(calls.confirm).toHaveLength(1);
  });
  test("a booking made by someone else (the office, or another electrician) is still 'Already booked…' for this link", async () => {
    seed({ piesaBookedBy: "either" });
    const t = await token();
    tables["bookings"]!.push({ id: "office1", job_id: J, kind: "assessment", status: "confirmed", scheduled_start: START });
    expect(await server.bookFromElectricianLink(t, "assessment", START2, NOW)).toEqual({ ok: false, message: "Already booked for Sat 7 Nov, 10:00am." });
    expect(calls.confirm).toHaveLength(0);
  });
});

describe("bookFromElectricianLink: upgrades day", () => {
  test("only after the safety check says upgrades, and not same day", async () => {
    const t = await token();
    expect((await server.bookFromElectricianLink(t, "rectification", START, NOW)).ok).toBe(false);
    seed({ outcome: "pass" });
    expect((await server.bookFromElectricianLink(await token(), "rectification", START, NOW)).ok).toBe(false);
    seed({ outcome: "fail", sameDay: true });
    expect((await server.bookFromElectricianLink(await token(), "rectification", START, NOW)).ok).toBe(false);
    expect(tables["bookings"]).toHaveLength(0);
    expect(calls.confirm).toHaveLength(0);
  });
  test("upgrades needed, not same day: books the rectification day and stores the date", async () => {
    seed({ outcome: "fail" });
    const t = await token();
    expect((await server.electricianLinkView(t, NOW)).view.step).toBe("set_upgrades_day");
    const r = await server.bookFromElectricianLink(t, "rectification", START, NOW);
    expect(r).toEqual({ ok: true, start: START });
    expect(bookings()[0]).toMatchObject({ kind: "rectification", scheduled_start: START });
    expect(calls.notify).toHaveLength(0);
    const v = await server.electricianLinkView(t, NOW);
    expect(v.view.step).toBe("upgrades_day");
    expect(v.upgradesDay).toBe(START);
  });
  test("office setting: the upgrades day is not bookable from the link either", async () => {
    seed({ outcome: "fail", piesaBookedBy: "office" });
    const r = await server.bookFromElectricianLink(await token(), "rectification", START, NOW);
    expect(r.ok).toBe(false);
    expect(tables["bookings"]).toHaveLength(0);
  });
});

describe("bookFromElectricianLink: existing guards and bad input", () => {
  test("a guard refusal comes back as its own plain message and nothing is booked", async () => {
    validateFails = "Installation must be on or before 2026-12-01 (30 days from the safety check (PIESA)).";
    const r = await server.bookFromElectricianLink(await token(), "assessment", START, NOW);
    expect(r).toEqual({ ok: false, message: validateFails });
    expect(tables["bookings"]).toHaveLength(0);
    expect(calls.confirm).toHaveLength(0);
  });
  test("the upgrades day: a guard refusal is the plain reason (main #137, carried onto this link), never the raw rule; nothing is booked", async () => {
    seed({ outcome: "fail" });
    validateFails = "A rectification booking can't be made at PIESA complete.";
    const r = await server.bookFromElectricianLink(await token(), "rectification", START, NOW);
    expect(r.ok).toBe(false);
    const msg = r.ok ? "" : r.message;
    expect(msg).toMatch(/^Home Insulation Victoria needs to check this job before the upgrades day can be saved\. Please call them/);
    expect(msg).not.toMatch(/can't be made at|Blocked:/);
    expect(tables["bookings"]).toHaveLength(0);
    expect(calls.confirm).toHaveLength(0);
  });
  test("a bad link books nothing", async () => {
    const r = await server.bookFromElectricianLink("short", "assessment", START, NOW);
    expect(r).toEqual({ ok: false, message: "This link isn't valid." });
    const r2 = await server.bookFromElectricianLink("a".repeat(43), "assessment", START, NOW);
    expect(r2.ok).toBe(false);
  });
  test("a switched-off link books nothing", async () => {
    const t = await token();
    tables["worker_job_links"]![0]!["revoked_at"] = "2026-11-02T00:00:00Z";
    const r = await server.bookFromElectricianLink(t, "assessment", START, NOW);
    expect(r.ok).toBe(false);
    expect(tables["bookings"]).toHaveLength(0);
  });
  test("a time that isn't a time, or has passed, is refused", async () => {
    const t = await token();
    expect((await server.bookFromElectricianLink(t, "assessment", "tomorrow", NOW)).ok).toBe(false);
    expect((await server.bookFromElectricianLink(t, "assessment", "2026-11-01T00:00:00.000Z", NOW)).ok).toBe(false);
    expect(tables["bookings"]).toHaveLength(0);
  });
  test("the job is never taken from the caller: only the token names it", async () => {
    expect(server.bookFromElectricianLink.length).toBeLessThanOrEqual(4);
  });
});

describe("the page and server function", () => {
  const { readFileSync } = require("node:fs");
  const fns = readFileSync("src/lib/electrician-link.functions.ts", "utf8");
  const route = readFileSync("src/routes/e.$token.tsx", "utf8");
  test("bookElectricianLinkVisit is a literal chain, no auth middleware, token + kind + start only", () => {
    const i = fns.indexOf("bookElectricianLinkVisit");
    const chunk = fns.slice(i);
    expect(chunk).toContain('createServerFn({ method: "POST" })');
    expect(chunk).toContain('kind: z.enum(["assessment", "rectification"])');
    expect(chunk).not.toMatch(/jobId|workerId|businessId/);
    expect(fns).not.toContain(".middleware(");
  });
  test("the route offers Book only when the server says the step can book", () => {
    expect(route).toContain("bookElectricianLinkVisit");
    // Fix wave I5: the prop is spread in only when the step can book (an explicit `undefined` fails exactOptionalPropertyTypes).
    expect(route).toContain("{...(d.view.canBook || d.view.canChange ? { onBook } : {})}"); // R1: a booked day may be changed too
  });
});

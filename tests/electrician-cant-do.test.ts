// New job flow, Part 6, Task 6: "Can't do this one" on the electrician's no-login link. The REAL electrician-link.server
// runs against an in-memory database; the existing guarded cancel writer (visit-events.server), Part 4's owner email and
// the senders are replaced by recording fakes. Own file: it mocks modules for the whole process.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const J = "00000000-0000-4000-8000-0000000000a1", INST = "00000000-0000-4000-8000-0000000000b1", ELEC = "00000000-0000-4000-8000-0000000000b2";
const W = "00000000-0000-4000-8000-0000000000c1", USER = "00000000-0000-4000-8000-0000000000d1";
const NOW = Date.parse("2026-11-03T02:00:00.000Z");
const START = "2026-11-06T23:00:00.000Z"; // Sat 7 Nov 10:00am Melbourne

const tables: Tables = {};
class WorkflowError extends Error {}
const calls: { cancel: unknown[][]; owner: unknown[][]; office: Record<string, unknown>[]; testMail: unknown[][] } = { cancel: [], owner: [], office: [], testMail: [] };

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: false, error: null }) } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  logEvent: async (jobId: string, actorId: string | null, eventType: string, summary: string, details: Record<string, unknown>) => {
    (tables["workflow_events"] ??= []).push({ id: `e${tables["workflow_events"]!.length}`, job_id: jobId, actor_id: actorId, event_type: eventType, summary, details, created_at: new Date(NOW).toISOString() });
  },
}));
// The existing guarded cancel writer: cancels the confirmed booking of that kind for that business, like the real one.
mock.module("../src/lib/visit-events.server", () => ({
  cancelVisitFromElectricianLink: async (jobId: string, kind: string, businessId: string, reason: string) => {
    calls.cancel.push([jobId, kind, businessId, reason]);
    const b = tables["bookings"]!.find((x) => x["job_id"] === jobId && x["kind"] === kind && x["status"] === "confirmed" && x["business_id"] === businessId);
    if (!b) return null;
    b["status"] = "cancelled";
    return { id: b["id"], scheduled_start: b["scheduled_start"] };
  },
}));
mock.module("../src/lib/visit-cancelled-owner.server", () => ({ queueVisitCancelledOwnerEmail: async (...a: unknown[]) => { calls.owner.push(a); return "email sent"; } }));
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: Record<string, unknown>) => { calls.office.push(p); return { channel: "email", to: p["to"], status: "sent", detail: "ok" }; } }));
mock.module("../src/lib/test-send.server", () => ({ sendTestEmail: async (...a: unknown[]) => { calls.testMail.push(a); return { channel: "email", to: a[1], status: "sent", detail: "test" }; } }));

const server = await import("../src/lib/electrician-link.server");
const core = await import("../src/lib/electrician-link.core");
const mail = await import("../src/lib/electrician-cant-do-email.core");

function seed(over: { source?: string; booked?: "assessment" | "rectification" | null; stage?: string } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  calls.cancel.length = 0; calls.owner.length = 0; calls.office.length = 0; calls.testMail.length = 0;
  tables["properties"] = [{ id: "p1", address_line: "12 Smith St, Kew", suburb: "Kew" }];
  tables["jobs"] = [{ id: J, job_number: "HV-5001", source: over.source ?? "qa_test", stage: over.stage ?? (over.booked ? "piesa_scheduled" : "piesa_and_install_window_pending"), property_id: "p1", deleted_at: null }];
  tables["businesses"] = [
    { id: INST, name: "Smith Insulation", trading_name: null, phone: "03 9000 0001", email: "office@smith.test", onboarding_notes: null, piesa_booked_by: "electrician" },
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
  tables["bookings"] = over.booked ? [{ id: "bk1", job_id: J, kind: over.booked, status: "confirmed", scheduled_start: START, business_id: ELEC, assignment_id: "a2" }] : [];
  tables["assessments"] = [{ id: "as1", job_id: J, external_mitti_id: "audit-a3", completed_at: null, piesa_outcome: "pending", mitti_raw_snapshot: null }];
  tables["workflow_events"] = [];
  tables["documents"] = [];
}
beforeEach(() => seed());

async function token() { return (await server.mintElectricianLink(J, W, null, NOW)).token; }
const events = (type: string) => tables["workflow_events"]!.filter((e) => e["event_type"] === type);
const asg = () => tables["job_assignments"]!.find((a) => a["id"] === "a2")!;

describe("electricianCantDo: the reason", () => {
  test("a reason under 3 characters is refused with the plain (DRAFT) message and nothing changes", async () => {
    const t = await token();
    for (const r of ["", "  ", "no", " a "]) expect(await server.electricianCantDo(t, r, NOW)).toEqual({ ok: false, message: "Tell us why in a few words." });
    expect(core.ELECTRICIAN_CANT_DO_REASON_NEEDED).toBe("Tell us why in a few words.");
    expect(asg()["active"]).toBe(true);
    expect(events("electrician_cant_do")).toHaveLength(0);
    expect(calls.cancel).toHaveLength(0);
  });
  test("a bad token is refused with the plain message", async () => {
    expect(await server.electricianCantDo("nope", "Sick that week", NOW)).toEqual({ ok: false, message: "This link isn't valid." });
  });
});

describe("electricianCantDo: the job goes back to the installer", () => {
  test("nothing booked: the assignment ends, every link is revoked, the event is written once, no booking cancel, no owner email", async () => {
    const t = await token();
    const r = await server.electricianCantDo(t, "Sick that week", NOW);
    expect(r).toEqual({ ok: true });
    expect(asg()["active"]).toBe(false);
    expect(asg()["ended_at"]).toBeTruthy();
    expect(tables["worker_job_links"]!.every((l) => l["revoked_at"])).toBe(true);
    const ev = events("electrician_cant_do");
    expect(ev).toHaveLength(1);
    expect(ev[0]!["details"]).toMatchObject({ worker_id: W, reason: "Sick that week", booking_cancelled: false });
    expect(calls.cancel).toHaveLength(0);
    expect(calls.owner).toHaveLength(0);
  });
  test("a confirmed safety check for them: cancelled through the existing cancel writer and the owner is emailed once with that booking", async () => {
    seed({ booked: "assessment" });
    const t = await token();
    expect(await server.electricianCantDo(t, "Double booked", NOW)).toEqual({ ok: true });
    expect(calls.cancel).toHaveLength(1);
    expect(calls.cancel[0]).toEqual([J, "assessment", ELEC, "Double booked"]);
    expect(tables["bookings"]![0]!["status"]).toBe("cancelled");
    expect(calls.owner).toHaveLength(1);
    expect(calls.owner[0]!.slice(0, 3)).toEqual([J, "bk1", "electrician"]);
    expect(events("electrician_cant_do")[0]!["details"]).toMatchObject({ worker_id: W, booking_cancelled: true });
    expect(asg()["active"]).toBe(false);
  });
  test("a confirmed upgrades day for them: the same, with the upgrades booking", async () => {
    seed({ booked: "rectification", stage: "rectification_booked" });
    const t = await token();
    expect(await server.electricianCantDo(t, "Van broke down", NOW)).toEqual({ ok: true });
    expect(calls.cancel.map((c) => c[1])).toEqual(["rectification"]);
    expect(calls.owner).toHaveLength(1);
    expect(calls.owner[0]![1]).toBe("bk1");
  });
  test("someone else's booking is left alone", async () => {
    seed();
    tables["bookings"]!.push({ id: "other", job_id: J, kind: "assessment", status: "confirmed", scheduled_start: START, business_id: "other-biz", assignment_id: "a9" });
    const t = await token();
    expect(await server.electricianCantDo(t, "Sick that week", NOW)).toEqual({ ok: true });
    expect(tables["bookings"]![0]!["status"]).toBe("confirmed");
    expect(calls.owner).toHaveLength(0);
    expect(events("electrician_cant_do")[0]!["details"]).toMatchObject({ booking_cancelled: false });
  });
  test("the hook for the owner email is the one on deps (the controller wires Part 4's function at join)", async () => {
    seed({ booked: "assessment" });
    const t = await token();
    const mine: unknown[][] = [];
    expect(await server.electricianCantDo(t, "Double booked", NOW, { ownerNotice: async (...a) => { mine.push(a); return "sent"; } })).toEqual({ ok: true });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toEqual([J, "bk1", "electrician"]);
    expect(calls.owner).toHaveLength(0);
    // Called after the booking was cancelled.
    expect(tables["bookings"]![0]!["status"]).toBe("cancelled");
  });
  test("a failed owner email never undoes the hand-back", async () => {
    seed({ booked: "assessment" });
    const t = await token();
    expect(await server.electricianCantDo(t, "Double booked", NOW, { ownerNotice: async () => { throw new Error("mail down"); } })).toEqual({ ok: true });
    expect(asg()["active"]).toBe(false);
    expect(events("electrician_cant_do")).toHaveLength(1);
  });
});

describe("electricianCantDo: idempotent", () => {
  test("a second press with the same link → the same { ok: true }, no second event, no second cancel, no second email", async () => {
    seed({ booked: "assessment" });
    const t = await token();
    expect(await server.electricianCantDo(t, "Double booked", NOW)).toEqual({ ok: true });
    expect(await server.electricianCantDo(t, "Double booked", NOW + 60_000)).toEqual({ ok: true });
    expect(events("electrician_cant_do")).toHaveLength(1);
    expect(calls.cancel).toHaveLength(1);
    expect(calls.owner).toHaveLength(1);
    expect(calls.testMail.length + calls.office.length).toBe(1);
  });
  test("the link then shows the switched-off message with no owner details", async () => {
    const t = await token();
    await server.electricianCantDo(t, "Sick that week", NOW);
    await expect(server.electricianLinkView(t, NOW)).rejects.toThrow("This link has been switched off. Ask Smith Insulation for a new one.");
  });
  test("a link revoked for another reason (the installer changed electrician) is just switched off", async () => {
    const t = await token();
    await server.mintElectricianLink(J, W, null, NOW + 1); // revokes the first link
    expect(await server.electricianCantDo(t, "Sick that week", NOW + 2)).toEqual({ ok: false, message: "This link has been switched off. Ask Smith Insulation for a new one." });
    expect(asg()["active"]).toBe(true);
    expect(events("electrician_cant_do")).toHaveLength(0);
  });
});

describe("electricianCantDo: the installer office email (DRAFT)", () => {
  test("the wording is DRAFT behind ELECTRICIAN_CANT_DO_EMAIL_APPROVED = false", () => {
    expect(core.ELECTRICIAN_CANT_DO_EMAIL_APPROVED).toBe(false);
    const m = mail.electricianCantDoEmail({ jobNumber: "HV-5001", electrician: "Spark Co", reason: "Sick that week", test: false });
    expect(m.subject).toBe("HV-5001: Spark Co can't do this one. Choose another electrician on the job.");
    expect(m.text).toContain("HV-5001: Spark Co can't do this one. Choose another electrician on the job.");
    expect(m.text).toContain("Sick that week");
    expect(m.html).toContain("Choose another electrician on the job.");
    expect(m.text).not.toMatch(/HIV\b/);
  });
  test("TEST job → test-send to the installer office address, recorded once", async () => {
    const t = await token();
    await server.electricianCantDo(t, "Sick that week", NOW);
    expect(calls.office).toHaveLength(0);
    expect(calls.testMail).toHaveLength(1);
    expect(calls.testMail[0]![1]).toBe("office@smith.test");
    expect(calls.testMail[0]![2]).toBe("HV-5001: Spark Co can't do this one. Choose another electrician on the job.");
    expect(events("electrician_cant_do_email")).toHaveLength(1);
  });
  test("real job, flag off → held: nothing sent, nothing recorded for the email; the hand-back still happens", async () => {
    seed({ source: "website" });
    const t = await token();
    expect(await server.electricianCantDo(t, "Sick that week", NOW)).toEqual({ ok: true });
    expect(calls.office).toHaveLength(0);
    expect(calls.testMail).toHaveLength(0);
    expect(events("electrician_cant_do_email")).toHaveLength(0);
    expect(asg()["active"]).toBe(false);
  });
  test("real job, flag on → the existing office sender (partner, installer business, once-only key)", async () => {
    seed({ source: "website" });
    const t = await token();
    await server.electricianCantDo(t, "Sick that week", NOW, { emailApproved: true });
    expect(calls.testMail).toHaveLength(0);
    expect(calls.office).toHaveLength(1);
    expect(calls.office[0]).toMatchObject({ recipient: "partner", to: "office@smith.test", record: { businessId: INST }, subject: "HV-5001: Spark Co can't do this one. Choose another electrician on the job." });
    expect(calls.office[0]!["idempotencyKey"]).toBe(`electrician-cant-do:v1:${J}:a2`);
    expect(events("electrician_cant_do_email")).toHaveLength(1);
  });
  test("no installer office email on file → held, nothing recorded", async () => {
    tables["businesses"]![0]!["email"] = null;
    const t = await token();
    expect(await server.electricianCantDo(t, "Sick that week", NOW)).toEqual({ ok: true });
    expect(calls.testMail).toHaveLength(0);
    expect(events("electrician_cant_do_email")).toHaveLength(0);
  });
});

describe("the page and the server function", () => {
  const route = readFileSync("src/routes/e.$token.tsx", "utf8");
  const fns = readFileSync("src/lib/electrician-link.functions.ts", "utf8");
  test("the server function takes only the token and the reason, no auth middleware", () => {
    expect(fns).toContain("export const electricianCantDoByLink");
    expect(fns).toMatch(/electricianCantDoByLink[\s\S]*token: z\.string\(\)\.max\(100\), reason: z\.string\(\)\.max\(480\)/);
    expect(fns).not.toContain(".middleware(");
  });
  test("the route wires it and reloads the step", () => {
    expect(route).toContain("electricianCantDoByLink");
    expect(route).toContain("onCantDo");
  });
});

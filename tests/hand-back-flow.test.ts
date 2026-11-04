// Task 6 fix round 1: "Can't do this one" must leave nothing booked — read the confirmed future visits, pull the job back,
// cancel every visit still booked (install / fixes, which pull_back_in_house_job leaves standing) the trade-cancel way,
// ask for the ESC withdrawal, then email the owner once per visit and log the helper's answer on the job.
import { expect, test } from "bun:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import * as visitEventsCore from "../src/lib/visit-events.core";
import { handBackJob, stillConfirmedBookings, type HandBackDeps } from "../src/lib/trade-view.server";

function deps() {
  const log: string[] = [];
  const events: unknown[] = [];
  const d: HandBackDeps = {
    bookingTeam: async () => { log.push("team"); },
    stillConfirmedBookings: async () => { log.push("read"); return [{ id: "bk-install", kind: "installation", scheduled_start: "2026-11-20T21:00:00Z" }, { id: "bk-rc", kind: "ready_check", scheduled_start: "2026-11-15T22:00:00Z" }]; },
    pullBackInHouseJob: async () => { log.push("pullback"); },
    finishInHouseHandback: async () => { log.push("cleanup"); },
    cancelBookingsAfterHandBack: async (_j, ids) => { log.push(`cancel:${ids.join(",")}`); return ["bk-install"]; },
    requireEscWithdrawal: async (_j, reason) => { log.push(`esc:${reason}`); return 1; },
    queueVisitCancelledOwnerEmail: async (_j, bookingId) => { log.push(`email:${bookingId}`); return bookingId === "bk-rc" ? "not sent — booking not found" : "sent"; },
    logEvent: async (_j, _a, type, _s, details) => { events.push({ type, details }); },
  };
  return { d, log, events };
}

test("hand-back: read → team check → pull back → cancel what is still booked → ESC withdrawal → owner email per visit, outcome logged", async () => {
  const { d, log, events } = deps();
  const r = await handBackJob("j", "actor", "truck broke down", d);
  expect(r).toEqual({ ok: true });
  expect(log).toEqual(["team", "read", "pullback", "cleanup", "cancel:bk-install,bk-rc", "esc:cant_do_this_one", "email:bk-install", "email:bk-rc"]);
  expect(log.filter((l) => l === "email:bk-install")).toHaveLength(1);
  expect(events).toEqual([
    { type: "trade_handback_owner_email", details: { booking_id: "bk-install", kind: "installation", result: "sent" } },
    { type: "trade_handback_owner_email", details: { booking_id: "bk-rc", kind: "ready_check", result: "not sent — booking not found" } },
  ]);
});

test("hand-back: a failed follow-up is logged on the job and never undoes the pull-back; the rest still runs", async () => {
  const { d, log, events } = deps();
  d.cancelBookingsAfterHandBack = async () => { throw new Error("db down"); };
  d.requireEscWithdrawal = null;
  const r = await handBackJob("j", "actor", "truck broke down", d);
  expect(r).toEqual({ ok: true });
  expect(log).toEqual(["team", "read", "pullback", "cleanup", "email:bk-install", "email:bk-rc"]);
  expect(events.map((e) => (e as { type: string }).type)).toEqual(["trade_followup_failed", "trade_handback_owner_email", "trade_handback_owner_email"]);
  expect((events[0] as { details: { step: string } }).details.step).toBe("cancel booked visits");
});

test("hand-back: the pull-back itself failing stops everything (nothing cancelled or emailed)", async () => {
  const { d, log } = deps();
  d.pullBackInHouseJob = async () => { throw new Error("Reason required"); };
  await expect(handBackJob("j", "actor", "x", d)).rejects.toThrow("Reason required");
  expect(log).toEqual(["team", "read"]);
});

// Fix wave minor 14: every still-confirmed booking is cancelled — including one earlier today — and the owner is emailed
// about visits from today on (a visit left confirmed from days ago is cancelled quietly: "can't go ahead" would be wrong).
test("hand-back: a booking earlier today is cancelled too; the owner email goes for today's and later visits only", async () => {
  const { d, log } = deps();
  const now = new Date("2026-11-20T04:00:00Z"); // Fri 20 Nov, 3pm Melbourne
  d.stillConfirmedBookings = async () => [
    { id: "bk-today-early", kind: "ready_check", scheduled_start: "2026-11-19T22:00:00Z" }, // 9am today, still confirmed
    { id: "bk-old", kind: "ready_check", scheduled_start: "2026-11-10T22:00:00Z" }, // last week, never marked done
    { id: "bk-later", kind: "installation", scheduled_start: "2026-11-25T21:00:00Z" },
  ];
  await handBackJob("j", "actor", "truck broke down", d, now);
  expect(log).toContain("cancel:bk-today-early,bk-old,bk-later");
  expect(log.filter((l) => l.startsWith("email:"))).toEqual(["email:bk-today-early", "email:bk-later"]);
});

test("stillConfirmedBookings reads every confirmed booking on the job, whatever its time", () => {
  const src = readFileSync("src/lib/trade-view.server.ts", "utf8");
  const body = src.slice(src.indexOf("export async function stillConfirmedBookings"), src.indexOf("\n}\n", src.indexOf("export async function stillConfirmedBookings")));
  expect(body).toContain('.eq("status", "confirmed")');
  expect(body).not.toContain(".gt(");
  expect(typeof stillConfirmedBookings).toBe("function");
});

// cancelBookingsAfterHandBack: the visit-events record + reopen path (same as tradeCancelVisit), per booking still confirmed.
function visitEventsFixture() {
  const rows: Tables = {
    bookings: [
      { id: "bk-install", job_id: "j", kind: "installation", status: "confirmed", scheduled_start: "2026-11-20T21:00:00Z", business_id: "biz", assignment_id: null, contractor_id: null },
      { id: "bk-rc", job_id: "j", kind: "ready_check", status: "cancelled", scheduled_start: "2026-11-15T22:00:00Z", business_id: "biz", assignment_id: null, contractor_id: null },
    ],
    visit_events: [], jobs: [{ id: "j", stage: "installation_booked", next_action: null }], job_assignments: [], partner_offers: [],
  };
  const calls: string[] = [];
  const shim = memoryPostgrest(rows);
  const mocks: Record<string, unknown> = {
    "@/integrations/supabase/client.server": { supabaseAdmin: shim },
    "./workflow.server": { WorkflowError: Error, logEvent: async (_j: string, _a: string, type: string) => { calls.push(`event:${type}`); }, transition: async (_j: string, to: string) => { calls.push(`transition:${to}`); } },
    "./visit-events.core": visitEventsCore,
    "./install-balance.server": { clearInstallDueDate: async () => { calls.push("due-date-cleared"); } },
    "./esc.server": { regenerateEscNotification: async () => { calls.push("esc-regenerated"); } },
    "./ready-check-booking-access.server": { readyCheckBookingAccess: async () => ({ allowed: true }) },
    "./visit-new-times.server": { notifyOwnerVisitNewTimes: async () => { calls.push("O74"); } },
    "./mitti-pickup.server": {},
  };
  const api: Record<string, unknown> = {};
  new Function("exports", "require", ts.transpile(readFileSync("src/lib/visit-events.server.ts", "utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(api, (p: string) => { if (!(p in mocks)) throw new Error(`Unmocked ${p}`); return mocks[p]; });
  return { api: api as { cancelBookingsAfterHandBack: (j: string, ids: string[], a: string, r: string) => Promise<string[]> }, rows, calls };
}

test("cancelBookingsAfterHandBack: cancels only bookings still confirmed, records trade_cancelled, reopens (ESC side for installs), no O74 here", async () => {
  const f = await visitEventsFixture();
  const cancelled = await f.api.cancelBookingsAfterHandBack("j", ["bk-install", "bk-rc", "bk-missing"], "actor", "handed back");
  expect(cancelled).toEqual(["bk-install"]);
  expect((f.rows["bookings"] as { id: string; status: string }[]).find((b) => b.id === "bk-install")?.status).toBe("cancelled");
  expect((f.rows["visit_events"] as { booking_id: string; event: string; counts_against: string }[]).map((e) => [e.booking_id, e.event, e.counts_against])).toEqual([["bk-install", "trade_cancelled", "trade"]]);
  expect(f.calls).toContain("esc-regenerated");
  expect(f.calls).toContain("due-date-cleared");
  expect(f.calls).toContain("transition:installation_scheduling");
  expect(f.calls).not.toContain("O74");
});

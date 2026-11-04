// Part 9 Task 2: a job that won't go ahead ("Owner cancelled", "Can't do this one") may still have a SENT ESC install
// notification live in the Registry. The robot never withdraws (no verified selector), so the office gets ONE Needs me
// item per live notice ("withdraw it in the Registry, then record the withdrawal"), cleared when `withdrawEscNotification`
// records that notice. Pure rules + the server paths on a fake database.
import { describe, expect, mock, test } from "bun:test";
import { escWithdrawalNeeded, openEscWithdrawals, ESC_WITHDRAW_REQUIRED_EVENT } from "../src/lib/esc.core";
import { NEEDS_TEXT } from "../src/lib/allocation.core";

const sent = { id: "n-sent", status: "sent", sent_at: "2026-11-01T23:00:00Z", submission_reference: "VEU-123", response: null };
const staleSent = { id: "n-stale-sent", status: "stale", sent_at: "2026-10-20T23:00:00Z", submission_reference: "VEU-100", response: null };
const withdrawn = { id: "n-withdrawn", status: "stale", sent_at: "2026-10-01T23:00:00Z", submission_reference: "VEU-50", response: { withdrawal: { withdrawn_at: "2026-10-02T00:00:00Z", reason: "moved", withdrawn_by: "u", registry_reference: null } } };
const unsent = { id: "n-ready", status: "ready", sent_at: null, submission_reference: null, response: null };

describe("escWithdrawalNeeded: sent + referenced + not withdrawn, whatever the status", () => {
  test("a sent notice and a staled-but-sent one need withdrawing; a withdrawn one and an unsent one do not", () => {
    expect(escWithdrawalNeeded([sent, withdrawn, unsent, staleSent])).toEqual([{ id: "n-sent", reference: "VEU-123" }, { id: "n-stale-sent", reference: "VEU-100" }]);
    expect(escWithdrawalNeeded([withdrawn, unsent])).toEqual([]);
  });
});

describe("openEscWithdrawals: one open item per notice, cleared by the recorded withdrawal of that notice", () => {
  const req = (notification_id: string, created_at: string, reason = "owner_cancelled") => ({ job_id: "j1", created_at, details: { notification_id, reference: "VEU-123", reason, needs_office: true } });
  test("required twice for the same notice = one item (earliest since); the withdrawal of that notice clears it", () => {
    const open = openEscWithdrawals([req("n-sent", "2026-11-03T00:00:00Z"), req("n-sent", "2026-11-03T01:00:00Z"), req("n-2", "2026-11-03T02:00:00Z", "cant_do_this_one")], []);
    expect(open).toEqual([
      { jobId: "j1", notificationId: "n-sent", reference: "VEU-123", reason: "owner_cancelled", at: "2026-11-03T00:00:00Z" },
      { jobId: "j1", notificationId: "n-2", reference: "VEU-123", reason: "cant_do_this_one", at: "2026-11-03T02:00:00Z" },
    ]);
    expect(openEscWithdrawals([req("n-sent", "2026-11-03T00:00:00Z")], [{ details: { notification_id: "n-sent" } }])).toEqual([]);
    expect(openEscWithdrawals([req("n-sent", "2026-11-03T00:00:00Z")], [{ details: { notification_id: "other" } }])).toHaveLength(1);
  });
  test("Needs me wording for the office", () => {
    expect(NEEDS_TEXT.esc_withdraw_required).toEqual({ why: "Install won't go ahead but the ESC notice is still live.", next: "Withdraw it in the Registry, then record the withdrawal on the job.", tab: "compliance", urgency: "urgent" });
    expect(ESC_WITHDRAW_REQUIRED_EVENT).toBe("esc_withdraw_required");
  });
});

// ── Server: a fake database with just enough of the supabase chain for cancelJobFully / requireEscWithdrawal / withdrawEscNotification ──
type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
let seq = 0;
const subset = (row: unknown, want: Record<string, unknown>) => !!row && typeof row === "object" && Object.entries(want).every(([k, v]) => (row as Row)[k] === v);
function q(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let patch: Row | null = null, ins: Row | null = null;
  const rows = () => (db[table] ??= []).filter((r) => filters.every((f) => f(r)));
  const exec = () => {
    if (ins) { const r = { id: `${table}-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), ...ins }; db[table]!.push(r); return { data: [r], error: null }; }
    if (patch) { const rs = rows(); rs.forEach((r) => Object.assign(r, patch)); return { data: rs, error: null }; }
    return { data: rows(), error: null };
  };
  const api: any = {
    select: () => api, order: () => api, limit: () => api, range: () => api, gt: () => api, lt: () => api, gte: () => api, or: () => api,
    not: (k: string, op: string, v: unknown) => { if (op === "in") { const set = String(v).replace(/^\(|\)$/g, "").split(","); filters.push((r) => !set.includes(String(r[k]))); } else if (op === "is") filters.push((r) => (r[k] ?? null) !== v); return api; },
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return api; },
    neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return api; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return api; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return api; },
    contains: (k: string, v: Record<string, unknown>) => { filters.push((r) => subset(r[k], v)); return api; },
    update: (p: Row) => { patch = p; return api; }, insert: (r: Row) => { ins = r; return api; },
    single: async () => ({ data: exec().data?.[0] ?? null, error: null }), maybeSingle: async () => ({ data: exec().data?.[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve(exec()).then(res, rej),
  };
  return api;
}
const reset = () => {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, {
    jobs: [{ id: "j1", stage: "installation_booked", job_number: "HV-9001", originating_installer_business_id: null, source: "website" }],
    esc_notifications: [{ id: "n-sent", job_id: "j1", status: "sent", sent_at: "2026-11-01T23:00:00Z", submission_reference: "VEU-123", response: null, scheduled_start: "2026-11-04T23:00:00Z" }, { id: "n-ready", job_id: "j1", status: "ready", sent_at: null, submission_reference: null, response: null, scheduled_start: "2026-11-04T23:00:00Z" }],
    workflow_events: [], bookings: [], appointment_proposals: [], partner_offers: [], job_assignments: [], install_holds: [],
  });
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class extends Error {},
  piesaStatus: async () => null,
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details: unknown) => { db["workflow_events"]!.push({ id: `ev-${++seq}`, job_id, actor_id, event_type, summary, details, created_at: new Date(Date.now() + seq).toISOString() }); },
}));
mock.module("../src/lib/job-disposition.server", () => ({ applyHoldOrCancel: async (jobId: string) => { db["jobs"]!.find((j) => j["id"] === jobId)!["stage"] = "cancelled"; } }));
mock.module("../src/lib/in-house-forms.server", () => ({ closeUnneededForms: async () => {} }));
mock.module("../src/lib/installer-run.server", () => ({ runOwnerCancelled: async () => {} }));
mock.module("../src/lib/consent.server", () => ({ syncOwnerConsent: async () => {}, currentConsent: async () => null }));
mock.module("../src/lib/prestart.server", () => ({ runPrestart: async () => null, leadInstallerCert: async () => null, latestNotices: async () => ({ current: null, previousSent: null }) }));

const required = () => db["workflow_events"]!.filter((e) => e["event_type"] === ESC_WITHDRAW_REQUIRED_EVENT);
const withdrawnEvents = () => db["workflow_events"]!.filter((e) => e["event_type"] === "esc_notification_withdrawn");

describe("cancelJobFully raises the withdrawal ask once per live notice; recording the withdrawal clears it", () => {
  test("owner cancelled → one esc_withdraw_required for the SENT notice only; a second cancel-path call adds nothing", async () => {
    reset();
    const { cancelJobFully } = await import("../src/lib/office-actions.server");
    const { requireEscWithdrawal } = await import("../src/lib/esc.server");
    await cancelJobFully("j1", "Owner cancelled: moving house", "office-user");
    expect(required()).toHaveLength(1);
    expect(required()[0]!["details"]).toMatchObject({ notification_id: "n-sent", reference: "VEU-123", reason: "owner_cancelled", needs_office: true });
    // The unsent one was cancelled by the release (never in the Registry), the sent one stays as history.
    expect(db["esc_notifications"]!.find((n) => n["id"] === "n-ready")!["status"]).toBe("cancelled");
    expect(db["esc_notifications"]!.find((n) => n["id"] === "n-sent")!["status"]).toBe("sent");
    expect(await requireEscWithdrawal("j1", "owner_cancelled", "office-user")).toBe(1);
    expect(await requireEscWithdrawal("j1", "cant_do_this_one", "trade-user")).toBe(1);
    expect(required()).toHaveLength(1);
    const { openEscWithdrawalRows } = await import("../src/lib/esc.server");
    expect(await openEscWithdrawalRows()).toEqual([{ jobId: "j1", notificationId: "n-sent", reference: "VEU-123", reason: "owner_cancelled", at: required()[0]!["created_at"] }]);
  });
  test("the office records the withdrawal → the item is gone, the notice is kept as history", async () => {
    const { withdrawEscNotification, openEscWithdrawalRows } = await import("../src/lib/esc.server");
    await withdrawEscNotification({ notificationId: "n-sent", reason: "Owner cancelled the install", withdrawnAt: "2026-11-03T05:00:00Z", actorId: "office-user" });
    expect(withdrawnEvents()).toHaveLength(1);
    expect(withdrawnEvents()[0]!["details"]).toMatchObject({ notification_id: "n-sent" });
    expect(db["esc_notifications"]!.find((n) => n["id"] === "n-sent")).toMatchObject({ status: "stale" });
    expect(await openEscWithdrawalRows()).toEqual([]);
    expect(await openEscWithdrawalRows(["j1"])).toEqual([]);
  });
  test("a job with no sent notice raises nothing", async () => {
    reset();
    db["esc_notifications"] = [{ id: "n-ready", job_id: "j1", status: "ready", sent_at: null, submission_reference: null, response: null, scheduled_start: "2026-11-04T23:00:00Z" }];
    const { requireEscWithdrawal } = await import("../src/lib/esc.server");
    expect(await requireEscWithdrawal("j1", "owner_cancelled", null)).toBe(0);
    expect(required()).toHaveLength(0);
  });
});

describe("Part 5 wiring: the trade's \"Can't do this one\" and \"Owner cancelled\" call the real requireEscWithdrawal", () => {
  test("no optional lookup is left; hand-back deps hold the real function and the cleanup that removes the returned Team's Mitti form access runs before it", async () => {
    const { readFileSync } = await import("node:fs");
    const srv = readFileSync("src/lib/trade-view.server.ts", "utf8");
    const fns = readFileSync("src/lib/trade-view.functions.ts", "utf8");
    expect(srv).not.toContain("escWithdrawalFn");
    expect(fns).not.toContain("escWithdrawalFn");
    expect(srv).toContain('requireEscWithdrawal: (await import("./esc.server")).requireEscWithdrawal');
    expect(fns).toContain(`(await import('./esc.server')).requireEscWithdrawal(data.jobId,"owner_cancelled",context.userId)`);
    // Join ruling (4 Nov): on "Can't do this one" the electrician's Mitti A3/A4 access goes too — finishInHouseHandback
    // removes every returned Team person (the Team electrician included) from every job form, fail-soft and logged.
    const cleanup = readFileSync("src/lib/in-house-handback-cleanup.server.ts", "utf8");
    expect(cleanup).toContain("removeInspectionUserAccess(audit,user)");
    expect(cleanup).toContain("in_house_form_sync_failed");
    const back = srv.slice(srv.indexOf("export async function handBackJob"));
    expect(back.indexOf("finishInHouseHandback(")).toBeLessThan(back.indexOf("requireEscWithdrawal("));
  });
});

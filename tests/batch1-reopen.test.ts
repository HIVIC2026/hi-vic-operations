// Batch 1 task 6 (Jo 28 Oct 2026): reopening a cancelled job goes to a safe stage. Ready Check booked → back to "choose
// installer"; at the safety check (PIESA) or later → a NEW safety check is needed and the old one no longer counts. The
// owner pays again only when a check was actually done (a PIESA record exists), at the accepted quote's PIESA line.
// The REAL reopenJob, repeatPiesaContext and requirements.server run against an in-memory database. Own file: it replaces
// workflow.server for the whole process.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const J = "00000000-0000-4000-8000-0000000000a1", Q = "00000000-0000-4000-8000-0000000000b1";
const tables: Tables = {};
let entryBlockers: string[] = [];
const transitions: string[] = [];
class WorkflowError extends Error {}
// piesa_records.is_current defaults to true in the schema (0000_hivic_core_schema.sql); the in-memory table has no defaults.
const withDefaults = (t: string) => { const q = memoryPostgrest(tables).from(t); if (t !== "piesa_records") return q; const ins = q.insert; q.insert = (p: Record<string, unknown>) => ins({ is_current: true, ...p }); return q; };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: withDefaults, rpc: async () => ({ data: null, error: null }) } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown, opts?: { from?: string; to?: string; internal?: boolean }) => {
    tables["workflow_events"]!.push({ id: `ev-${tables["workflow_events"]!.length + 1}`, job_id: job, actor_id: actor, event_type: type, summary, details: details ?? {}, from_stage: opts?.from ?? null, to_stage: opts?.to ?? null, created_at: new Date().toISOString() });
  },
  stageEntryBlockers: async () => entryBlockers,
  currentApprovedQuote: async () => ({ id: Q, status: "accepted", customer_total_inc_gst: 5000 }),
  getStage: async (id: string) => tables["jobs"]!.find((j) => j["id"] === id)!["stage"],
  piesaStatus: async (id: string) => { const r = tables["piesa_records"]!.find((p) => p["job_id"] === id && p["is_current"]); return r ? { piesa_date: r["completed_date"], piesa_outcome: r["outcome"], piesa_expired: false, install_deadline: null } : null; },
  transition: async (_id: string, to: string) => { transitions.push(to); },
}));
mock.module("../src/lib/install-days.server", () => ({ installDayContext: async () => ({ deadline: null, expired: false, booked: false }) }));
mock.module("../src/lib/quotes.server", () => ({ deriveRectificationItems: async () => 0, generateRectificationQuote: async () => undefined }));
mock.module("../src/lib/piesa-evidence.server", () => ({ piesaEvidenceHold: async () => [] }));
const xeroCalls: string[] = []; const offers: string[] = [];
mock.module("../src/lib/xero.server", () => ({ addRepeatPiesaToXeroInvoice: async (id: string) => { xeroCalls.push(id); return "not_linked"; } }));
mock.module("../src/lib/allocation.server", () => ({ startPiesaAllocation: async (id: string) => { offers.push(id); return { offered: 1, exhausted: false }; } }));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => null }));
mock.module("../src/lib/install-clearance.server", () => ({ notifyInstallerClearance: async () => undefined }));

const { reopenJob } = await import("../src/lib/office-actions.server");
const { reopenStageFor } = await import("../src/lib/office-jobs.core");
const rp = await import("../src/lib/repeat-piesa.core");
const { repeatPiesaContext } = await import("../src/lib/repeat-piesa.server");
const { electricalState, advanceSiteRequirements } = await import("../src/lib/requirements.server");
const { planStep } = await import("../src/lib/autoadvance.core");

function seed(priorStage: string, withPiesa: boolean) {
  for (const k of Object.keys(tables)) delete tables[k];
  Object.assign(tables, {
    jobs: [{ id: J, job_number: "HV-0601", stage: "cancelled", prior_stage: priorStage, cancelled_reason: "Owner changed their mind", source: "website", eligibility_outcome: "eligible" }],
    workflow_events: [{ id: "ev-0", job_id: J, event_type: "stage_changed", summary: "Cancelled", details: {}, from_stage: priorStage, to_stage: "cancelled", created_at: "2026-10-20T00:00:00.000Z" }],
    piesa_records: withPiesa ? [{ id: "pr-1", job_id: J, kind: "initial", outcome: "pass", completed_date: "2026-10-10", signed_off_by: "elec-1", is_current: true, created_at: "2026-10-10T03:00:00.000Z" }] : [],
    assessments: [{ id: "as-1", job_id: J, status: withPiesa ? "complete" : "in_progress", piesa_outcome: withPiesa ? "pass" : "pending" }],
    // The accepted quote's PIESA line is $220 (an installer's REC) — not the $349 default, not the repeat price setting.
    quote_items: [{ id: "qi-1", quote_id: Q, code: "PIESA", line_total_inc_gst: 220 }, { id: "qi-2", quote_id: Q, code: "INSUL", line_total_inc_gst: 4780 }],
    workflow_settings: [{ id: 1, safety_check_payment_inc_gst: 349 }],
    admin_config_events: [],
    office_job_list: [],
    ceiling_measurements: [],
  });
}
const job = () => tables["jobs"]![0]!;
const events = (t: string) => tables["workflow_events"]!.filter((e) => e["event_type"] === t);

beforeEach(() => { entryBlockers = []; transitions.length = 0; xeroCalls.length = 0; offers.length = 0; });

describe("reopenStageFor — where a reopened job goes", () => {
  const same = ["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_awaiting_acceptance", "ready_check_awaiting_payment", "ready_check_ready_to_schedule"];
  for (const s of same) test(`${s} → unchanged, no new safety check`, () => expect(reopenStageFor(s)).toEqual({ stage: s, needsNewPiesa: false }));
  for (const s of ["ready_check_scheduled", "ready_check_complete", "measured_estimate_ready"])
    test(`${s} → choose installer (Ready Check ready to schedule)`, () => expect(reopenStageFor(s)).toEqual({ stage: "ready_check_ready_to_schedule", needsNewPiesa: false }));
  test("measured_quote_accepted → unchanged, no new safety check", () => expect(reopenStageFor("measured_quote_accepted")).toEqual({ stage: "measured_quote_accepted", needsNewPiesa: false }));
  const later = ["piesa_and_install_window_pending", "piesa_scheduled", "piesa_complete", "electrical_variation_pending", "rectification_required", "awaiting_owner_rectification_approval",
    "awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked", "evidence_outstanding", "ap_review"];
  for (const s of later) test(`${s} → PIESA pending, new safety check needed`, () => expect(reopenStageFor(s)).toEqual({ stage: "piesa_and_install_window_pending", needsNewPiesa: true }));
});

describe("reopenJob (real, in-memory database)", () => {
  test("cancelled at installation_booked with a PIESA on file: back to PIESA pending, old check superseded, owner pays the quote's PIESA line again", async () => {
    seed("installation_booked", true);
    const r = await reopenJob(J, "Owner rang back – go ahead", "admin-1");
    expect(r.stage).toBe("piesa_and_install_window_pending");
    expect(job()).toMatchObject({ stage: "piesa_and_install_window_pending", prior_stage: null, cancelled_reason: null });
    const sup = events(rp.REPEAT_REOPEN_EVENT);
    expect(sup).toHaveLength(1);
    const d = sup[0]!["details"] as { key: string; had_check: boolean };
    expect(d.had_check).toBe(true);
    expect(d.key).toMatch(/^reopen:\d{4}-\d{2}-\d{2}T/);
    const chosen = events(rp.REPEAT_PIESA_CHOSEN_EVENT);
    expect(chosen).toHaveLength(1);
    expect(chosen[0]!["details"]).toMatchObject({ payer: "owner", price_inc_gst: 220, deadline: d.key });
    const { state } = await repeatPiesaContext(J);
    expect(state).toMatchObject({ stage: "owner_accept", payer: "owner", priceIncGst: 220, deadline: d.key });
    const view = rp.ownerRepeatView(state)!;
    expect(view.body).toBe(rp.REPEAT_REOPEN_WHY);
    expect(rp.REPEAT_REOPEN_WHY).toBe("Your job was reopened, so a new safety check is needed before your insulation can be installed.");
    expect(view.price).toMatch(/\$220 inc GST/);
    expect(rp.repeatPiesaGateBlocker(state)).toMatch(/Waiting for the owner to accept/);
  });

  test("cancelled at piesa_scheduled with no PIESA record: back to PIESA pending, no charge, nothing blocks the safety check", async () => {
    seed("piesa_scheduled", false);
    await reopenJob(J, "Owner rang back", "admin-1");
    expect(job()["stage"]).toBe("piesa_and_install_window_pending");
    const sup = events(rp.REPEAT_REOPEN_EVENT);
    expect(sup).toHaveLength(1);
    expect((sup[0]!["details"] as { had_check: boolean }).had_check).toBe(false);
    expect(events(rp.REPEAT_PIESA_CHOSEN_EVENT)).toHaveLength(0);
    const { state } = await repeatPiesaContext(J);
    expect(rp.repeatPiesaGateBlocker(state)).toBeNull();
    expect(rp.ownerRepeatView(state)).toBeNull();
  });

  test("Ready Check booked: back to choose installer, no safety check events", async () => {
    seed("ready_check_scheduled", false);
    await reopenJob(J, "Owner rang back", "admin-1");
    expect(job()["stage"]).toBe("ready_check_ready_to_schedule");
    expect(events(rp.REPEAT_REOPEN_EVENT)).toHaveLength(0);
  });

  test("no auto-advance on old PIESA: the reopened job stays at PIESA pending and the old record can't move it on", async () => {
    seed("installation_booked", true);
    await reopenJob(J, "Owner rang back", "admin-1");
    const allTrue = { eligibilityConfirmed: true, electricianAssigned: true, assessmentBookingConfirmed: true, openRectItems: 0, rectQuoteIssued: true, rectQuoteAccepted: true, installQuotesIssued: true, installQuoteAccepted: true, consumerSigned: true, invoiceExists: true, depositCleared: true, rectBookingConfirmed: true, installBookingConfirmed: true, installationCompleted: true, installerDeclarationSigned: true, veecLodged: true };
    expect(planStep("piesa_and_install_window_pending", allTrue).kind).toBe("stop");
    // The old PIESA record is still "current" in the table, but it was done before the reopen: it no longer counts.
    expect((await electricalState(J)).hasCurrentPiesa).toBe(false);
    job()["stage"] = "piesa_scheduled";
    const res = await advanceSiteRequirements(J, "admin-1");
    expect(res.advanced).toBe(false);
    expect(transitions).toEqual([]);
    // A NEW PIESA recorded after the reopen counts again, and the reopen lapse is over.
    tables["piesa_records"]![0]!["is_current"] = false;
    tables["piesa_records"]!.push({ id: "pr-2", job_id: J, kind: "reassessment", outcome: "pass", completed_date: "2026-10-28", signed_off_by: "elec-2", is_current: true, created_at: new Date(Date.now() + 1000).toISOString() });
    expect((await electricalState(J)).hasCurrentPiesa).toBe(true);
  });

  test("reopened twice with no new check in between: no second charge, the first reopen's payment state carries on", async () => {
    seed("installation_booked", true);
    await reopenJob(J, "Owner rang back", "admin-1");
    const first = (events(rp.REPEAT_REOPEN_EVENT)[0]!["details"] as { key: string }).key;
    const accepted = await (await import("../src/lib/repeat-piesa.server")).acceptRepeatPiesa(J);
    expect(accepted).toMatchObject({ stage: "owner_pay", payer: "owner", priceIncGst: 220, deadline: first });
    expect(xeroCalls).toEqual([J]);
    // Cancelled again before the new safety check, then reopened again a moment later.
    job()["stage"] = "cancelled"; job()["prior_stage"] = "piesa_and_install_window_pending";
    await new Promise((r) => setTimeout(r, 5));
    // The open repeat step (whatever it is now) is what the stage gate reports; reopen must not be refused by it.
    entryBlockers = [rp.repeatPiesaGateBlocker((await repeatPiesaContext(J)).state)!];
    expect(entryBlockers[0]).toBeTruthy();
    await reopenJob(J, "Owner rang back again", "admin-1");
    expect(job()["stage"]).toBe("piesa_and_install_window_pending");
    const sup = events(rp.REPEAT_REOPEN_EVENT);
    expect(sup).toHaveLength(2);
    expect((sup[1]!["details"] as { had_check: boolean }).had_check).toBe(false);
    expect(events(rp.REPEAT_PIESA_CHOSEN_EVENT)).toHaveLength(1);
    const { state } = await repeatPiesaContext(J);
    expect(state).toMatchObject({ deadline: first, payer: "owner", priceIncGst: 220 });
    expect(state.stage).not.toBe("owner_accept");
  });

  test("reopen inside the 30-day window: the new PIESA is recorded as a reassessment, the repeat gate clears and the job moves on", async () => {
    seed("installation_booked", true);
    await reopenJob(J, "Owner rang back", "admin-1");
    const rps = await import("../src/lib/repeat-piesa.server");
    expect((await rps.acceptRepeatPiesa(J)).stage).toBe("owner_pay");
    expect((await rps.recordRepeatPiesaPaid(J, "admin-1", "Xero payment 1")).stage).toBe("offer");
    expect(offers).toEqual([J]);
    const { reassessmentBlocker, applyPiesaRecord } = await import("../src/lib/piesa-record.server");
    // Before the electrician's visit is booked the reassessment can't be recorded; once booked it can.
    expect(await reassessmentBlocker(J, "piesa_and_install_window_pending")).toMatch(/once it is booked/);
    job()["stage"] = "piesa_scheduled";
    expect(await reassessmentBlocker(J, "piesa_scheduled")).toBeNull();
    // The old assessment is complete: Complete PIESA points to the reassessment instead of a dead end.
    const { completePiesaAssessment } = await import("../src/lib/piesa-complete.server");
    await expect(completePiesaAssessment({ jobId: J }, "elec-2")).rejects.toThrow(/reassessment/);
    await new Promise((r) => setTimeout(r, 5));
    await applyPiesaRecord({ jobId: J, actorId: "elec-2", kind: "reassessment", outcome: "pass", completedDate: "2026-10-28", source: { kind: "portal" } });
    expect(transitions).toContain("piesa_complete");
    expect(tables["bookings"] ?? []).toEqual([]);
    const { state } = await repeatPiesaContext(J);
    expect(rp.repeatPiesaGateBlocker(state)).toBeNull();
    expect((await electricalState(J)).hasCurrentPiesa).toBe(true);
    expect(await rps.currentPiesaSupersededByReopen(J)).toBe(false);
  });

  test("a job that was never reopened keeps today's reassessment rule", async () => {
    seed("installation_booked", true);
    job()["stage"] = "installation_scheduling";
    const { reassessmentBlocker } = await import("../src/lib/piesa-record.server");
    expect(await reassessmentBlocker(J, "installation_scheduling")).toBe("Reassessment is only needed when the PIESA window has expired.");
  });

  test("reopen refuses with the first stage-entry reason and writes nothing", async () => {
    seed("installation_booked", true);
    entryBlockers = ["Verified eligibility has not been recorded as eligible.", "Second reason"];
    await expect(reopenJob(J, "Owner rang back", "admin-1")).rejects.toThrow("Verified eligibility has not been recorded as eligible.");
    expect(job()["stage"]).toBe("cancelled");
    expect(events(rp.REPEAT_REOPEN_EVENT)).toHaveLength(0);
    expect(events(rp.REPEAT_PIESA_CHOSEN_EVENT)).toHaveLength(0);
  });

  test("reopen still refuses complete and retired stages as today", async () => {
    seed("installation_booked", true);
    job()["stage"] = "complete";
    await expect(reopenJob(J, "Owner rang back", "admin-1")).rejects.toThrow(/Completed jobs stay closed/);
    seed("assessment_booking", false);
    await expect(reopenJob(J, "Owner rang back", "admin-1")).rejects.toThrow(/retired/);
    expect(job()["stage"]).toBe("cancelled");
  });
});

describe("reopen wording on the Xero line, the office card and Needs me", () => {
  const key = "reopen:2026-10-27T22:15:00.000Z"; // 28 Oct in Melbourne
  test("Xero line for a reopen: no 30-day clause, plain-date tag; 30-day line unchanged", () => {
    expect(rp.repeatLineTag(key)).toBe("repeat PIESA 2026-10-28");
    expect(rp.repeatLineDescription("Home Insulation Victoria HV-1", key)).toBe("Home Insulation Victoria HV-1 – New safety check (PIESA) (repeat PIESA 2026-10-28)");
    expect(rp.repeatLineDescription("Home Insulation Victoria HV-1", "2026-11-20")).toBe("Home Insulation Victoria HV-1 – New safety check (PIESA), 30-day window lapsed (repeat PIESA 2026-11-20)");
    // A line already on the invoice is recognised by the new tag and by the raw-key tag it would have had before.
    expect(rp.repeatLineTags(key)).toEqual(["repeat PIESA 2026-10-28", `repeat PIESA ${key}`]);
    expect(rp.repeatLineTags("2026-11-20")).toEqual(["repeat PIESA 2026-11-20"]);
  });
  test("office card heading: Job reopened <date> for a reopen, 30-day text otherwise", () => {
    expect(rp.repeatOfficeHeading(key)).toBe("Job reopened 28 Oct — a new safety check (PIESA) is needed");
    expect(rp.repeatOfficeHeading("2026-11-20")).toBe("30-day window lapsed (2026-11-20) — a new safety check (PIESA) is needed");
    expect(rp.repeatOfficeHeading(null)).toBe("30-day window lapsed — a new safety check (PIESA) is needed");
    const { readFileSync } = require("node:fs");
    expect(readFileSync("src/components/portal/repeat-piesa.tsx", "utf8")).toContain("repeatOfficeHeading(s.deadline)");
  });
  test("Needs me: a held reopen Xero line gets one row, like the 30-day one", () => {
    const ev = [
      { job_id: "j1", event_type: "xero_invoice_repeat_piesa_held", created_at: "2026-10-28T02:00:00Z", details: { deadline: key, reason: "Xero refused the edit" } },
      { job_id: "j1", event_type: "repeat_piesa_payer_chosen", created_at: "2026-10-28T01:00:00Z", details: { deadline: key, payer: "owner" } },
      { job_id: "j2", event_type: "repeat_piesa_payer_chosen", created_at: "2026-10-28T01:00:00Z", details: { deadline: "2026-11-20", payer: "owner" } },
    ];
    expect([...rp.reopenRepeatDeadlines(ev)]).toEqual([["j1", key]]);
    expect(rp.repeatXeroHeldFor(ev.filter((e) => e.job_id === "j1"), key)).toEqual({ at: "2026-10-28T02:00:00Z", reason: "Xero refused the edit" });
    expect(rp.repeatXeroHeldFor([...ev, { job_id: "j1", event_type: "xero_invoice_repeat_piesa_added", created_at: "2026-10-28T03:00:00Z", details: { deadline: key } }], key)).toBeNull();
    const { readFileSync } = require("node:fs");
    const src = readFileSync("src/lib/office-needs.server.ts", "utf8");
    expect(src).toContain("reopenRepeatDeadlines(payRepeatEv)");
    expect(src).toContain("repeatXeroHeldFor(");
    const ns = readFileSync("src/lib/office-needs.core.ts", "utf8");
    expect(ns).toContain('kind: "repeat_piesa_xero_held"');
  });
});

// Visit allocation persistence (decision 161). Business-scoped: the signed-in business OWNER allocates a visit on a job
// assigned to their business to one of THEIR staff. Rules are pure (visit-allocation.core.ts); Mitti stays behind
// mitti.server.ts; the record is an append-only `visit_allocated` workflow event. Nothing here sends.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import type { MittiCall } from "./mitti.core";
import { melbourneToday } from "./worker-compliance.core";
import { CREW_CLEARANCE_REASON } from "./worker-compliance.core";
import { addInMittiFirst, allocationBlocker, allocationOptions, currentAllocation, visitsForStage, VISIT_ALLOCATED_EVENT, VISIT_LABEL, type AllocationCandidate, type VisitKind } from "./visit-allocation.core";

const db = admin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Every current staff row of the business, with derived clearance facts for installers (reuses the PIISA crew loader). */
export async function allocationCandidates(businessId: string): Promise<AllocationCandidate[]> {
  const { data: workers, error } = await db.from("partner_workers").select("id, full_legal_name, trade_role, email, mobile, removed_at").eq("business_id", businessId).is("removed_at", null);
  if (error) throw new WorkflowError(`Couldn't load your staff: ${error.message}`);
  const staff = await (await import("./piisa-a3.server")).crewStaff(businessId);
  const byId = new Map(staff.map((s) => [s.workerId, s]));
  return ((workers ?? []) as { id: string; full_legal_name: string; trade_role: string; email: string | null; mobile: string | null; removed_at: string | null }[]).map((w) => {
    const s = byId.get(w.id);
    return {
      workerId: w.id, name: w.full_legal_name.trim(), tradeRole: w.trade_role, email: w.email, mobile: w.mobile, removedAt: w.removed_at,
      clearance: s ? { certStatus: s.eecVerified ? "verified" : s.clearanceReason === CREW_CLEARANCE_REASON.withdrawn ? "rejected" : null, level: s.level ?? null, expiresOn: s.expiresOn ?? null } : null,
    };
  });
}

async function allocationEvents(jobId: string) {
  const { data } = await db.from("workflow_events").select("event_type, details, created_at").eq("job_id", jobId).eq("event_type", VISIT_ALLOCATED_EVENT).order("created_at", { ascending: false }).limit(20);
  return (data ?? []) as { event_type: string; details: unknown; created_at: string }[];
}

/** The job's Mitti form for a visit kind, if it exists yet (same lookups the 6:30am text uses). */
export async function visitFormAuditId(jobId: string, kind: VisitKind): Promise<string | null> {
  if (kind === "install") {
    const { data: ev } = await db.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_piisa_audit_created").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const id = (ev?.details as { audit_id?: unknown } | null)?.audit_id;
    return id ? String(id) : null;
  }
  const { data: f } = await db.from("ready_checks").select("external_mitti_id").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (f?.external_mitti_id) return String(f.external_mitti_id);
  const { data: m } = await db.from("ceiling_measurements").select("external_source, external_id").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  return m?.external_source === "mitti" && m.external_id ? String(m.external_id) : null;
}

/** Job screen: which visits this job shows, who is on each, and the picker list with grey-out reasons. */
export async function visitAllocationView(jobId: string, userId: string, pre?: import("./trade-view.server").TradeJobAccess) {
  const c = await (await import("./trade-view.server")).requireTradeJob(userId, jobId, pre);
  const { data: job } = await db.from("jobs").select("stage").eq("id", jobId).maybeSingle();
  const kinds = visitsForStage(job?.stage ?? null);
  if (!kinds.length || c.kind !== "installer") return { canAllocate: false, visits: [] as { kind: VisitKind; label: string; current: { workerId: string; name: string } | null; hasForm: boolean; options: ReturnType<typeof allocationOptions> }[] };
  const [events, candidates] = await Promise.all([allocationEvents(jobId), c.boss ? allocationCandidates(c.biz.id) : Promise.resolve([] as AllocationCandidate[])]);
  const today = melbourneToday();
  const visits = [];
  for (const kind of kinds) {
    const cur = currentAllocation(events, kind);
    visits.push({ kind, label: VISIT_LABEL[kind], current: cur ? { workerId: cur.worker_id, name: cur.worker_name } : null, hasForm: !!(await visitFormAuditId(jobId, kind)), options: c.boss ? allocationOptions(kind, candidates, today) : [] });
  }
  return { canAllocate: c.boss, visits };
}

/**
 * Allocate one visit to one staff member. Order: owner + business checks → eligibility (pure) → Mitti user lookup by
 * the staff row's email (TEST partners only ever reach the TEST Mitti account) → `visit_allocated` event → hand over the
 * existing form. A missing Mitti user refuses BEFORE anything is recorded ("Add them in Mitti first").
 */
export async function allocateVisit(jobId: string, userId: string, kind: VisitKind, workerId: string, call?: MittiCall) {
  const tv = await import("./trade-view.server");
  const c = await tv.requireTradeJob(userId, jobId);
  if (!c.boss) throw new WorkflowError("Only the business owner can allocate a visit.");
  if (c.kind !== "installer") throw new WorkflowError("Visits are allocated on installer jobs only.");
  const { data: job } = await db.from("jobs").select("stage, source").eq("id", jobId).maybeSingle();
  if (!visitsForStage(job?.stage ?? null).includes(kind)) throw new WorkflowError(`This job isn't at its ${VISIT_LABEL[kind]} yet.`);
  const cand = (await allocationCandidates(c.biz.id)).find((x) => x.workerId === workerId);
  if (!cand) throw new WorkflowError("That person isn't on your staff list.");
  const why = allocationBlocker(kind, cand, melbourneToday());
  if (why) throw new WorkflowError(`${cand.name} can't take this ${VISIT_LABEL[kind]}: ${why}`);
  const mitti = await import("./mitti.server");
  const useCall = call ?? mitti.realMittiCall;
  // TEST partners never reach a real installer's Mitti user; their forms live under the TEST Mitti account.
  const lookupEmail = c.isTest || job?.source === "qa_test" ? (await import("./onsite-ready-check.core")).TEST_MITTI_ASSIGNEE : (cand.email ?? "");
  const mittiUserId = await mitti.findMittiUserByEmail(lookupEmail, useCall);
  if (!mittiUserId) throw new WorkflowError(addInMittiFirst(cand.name, cand.email));
  const auditId = await visitFormAuditId(jobId, kind);
  await logEvent(jobId, userId, VISIT_ALLOCATED_EVENT, `${VISIT_LABEL[kind]} allocated to ${cand.name}${auditId ? "" : " (Mitti form not created yet)"}`,
    { visit: kind, worker_id: cand.workerId, worker_name: cand.name, by: userId, mitti_user_id: mittiUserId, audit_id: auditId, form: auditId ? "reassigned" : "none", business_id: c.biz.id });
  if (auditId) await mitti.reassignMittiFormTo({ jobId, auditId, kind, mittiUserId, email: lookupEmail, actorId: userId }, useCall);
  return { ok: true as const, workerId: cand.workerId, name: cand.name, form: auditId ? "reassigned" as const : "none" as const };
}

/** 6:30am text: the allocated person (if any) for one job + visit kind, with their mobile from the staff row. */
export async function allocatedPersonFor(jobId: string, kind: VisitKind): Promise<{ workerId: string; name: string; mobile: string | null } | null> {
  const cur = currentAllocation(await allocationEvents(jobId), kind);
  if (!cur) return null;
  const { data: w } = await db.from("partner_workers").select("id, full_legal_name, mobile, removed_at").eq("id", cur.worker_id).maybeSingle();
  if (!w || w.removed_at) return null;
  return { workerId: w.id, name: w.full_legal_name, mobile: w.mobile ?? null };
}

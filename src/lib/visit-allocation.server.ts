// Visit allocation persistence (decision 161). Business-scoped: the signed-in business OWNER allocates a visit on a job
// assigned to their business to one of THEIR staff. Rules are pure (visit-allocation.core.ts); Mitti stays behind
// mitti.server.ts; the record is an append-only `visit_allocated` workflow event. Nothing here sends.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import type { MittiCall } from "./mitti.core";
import { effectiveWorkerRole, mittiEmailFor } from "./worker-role.core";
import { melbourneToday } from "./worker-compliance.core";
import { CREW_CLEARANCE_REASON } from "./worker-compliance.core";
import { ALLOCATION_REASON, addInMittiFirst, allocationBlocker, allocationOptions, currentAllocation, leadNeedsHandover, visitsForStage, VISIT_ALLOCATED_EVENT, VISIT_LABEL, type AllocationCandidate, type VisitKind } from "./visit-allocation.core";
import { crewSelectionProblems, leadWorkerId, type CrewSelection } from "./piisa-a3.core";
import { early } from "./early-read";

const db = admin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Every current staff row of the business, with derived clearance facts for installers (reuses the PIISA crew loader). */
export async function allocationCandidates(businessId: string): Promise<AllocationCandidate[]> {
  const cols = "id, full_legal_name, trade_role, email, mobile, removed_at, worker_role";
  const load = (c: string) => db.from("partner_workers").select(c).eq("business_id", businessId).is("removed_at", null);
  // Speed (installer screens, Task 6): the business email and the crew clearance facts need only the business id — read
  // alongside the staff rows; a staff read error still throws first, then the crew facts' error, as before.
  const bizP = early(db.from("businesses").select("email").eq("id", businessId).maybeSingle() as PromiseLike<{ data: { email?: string | null } | null }>);
  const staffP = early(import("./piisa-a3.server").then((m) => m.crewStaff(businessId)));
  let { data: workers, error } = await load(`${cols}, declarations_due`);
  // Until 0230 is live the column is missing: re-read without it and treat everyone as signed (preflight ruling 10).
  if (error && (await import("./schema-compat.core")).isMissingDbObject(error)) ({ data: workers, error } = await load(cols));
  if (error) throw new WorkflowError(`Couldn't load your staff: ${error.message}`);
  const { data: biz } = await bizP;
  const businessEmail = (biz as { email?: string | null } | null)?.email ?? null;
  const staff = await staffP;
  const byId = new Map(staff.map((s) => [s.workerId, s]));
  return ((workers ?? []) as { id: string; full_legal_name: string; trade_role: string; email: string | null; mobile: string | null; removed_at: string | null; worker_role?: string | null; declarations_due?: boolean | null }[]).map((w) => {
    const s = byId.get(w.id);
    return {
      workerId: w.id, name: w.full_legal_name.trim(), tradeRole: w.trade_role, email: w.email, mobile: w.mobile, removedAt: w.removed_at, workerRole: s?.workerRole ?? effectiveWorkerRole({ tradeRole: w.trade_role, stored: w.worker_role }), businessEmail,
      clearance: s ? { certStatus: s.eecVerified ? "verified" : s.clearanceReason === CREW_CLEARANCE_REASON.withdrawn ? "rejected" : null, level: s.level ?? null, expiresOn: s.expiresOn ?? null } : null,
      whiteCard: s?.whiteCard ?? null,
      declarationsDue: w.declarations_due === true,
    };
  });
}

/** Decision 319: when the job's current installation booking was made (null = not booked yet → the White Card rule applies). */
async function installBookingCreatedAt(jobId: string): Promise<string | null> {
  const { data } = await db.from("bookings").select("created_at").eq("job_id", jobId).eq("kind", "installation").in("status", ["confirmed", "completed"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as { created_at?: string | null } | null)?.created_at ?? null;
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
  // Speed (installer screens, Task 6): the form record and the current measurement are read together; the form wins.
  const [{ data: f }, { data: m }] = await Promise.all([
    db.from("ready_checks").select("external_mitti_id").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("ceiling_measurements").select("external_source, external_id").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
  ]);
  if (f?.external_mitti_id) return String(f.external_mitti_id);
  return m?.external_source === "mitti" && m.external_id ? String(m.external_id) : null;
}

/** Job screen: which visits this job shows, who is on each, and the picker list with grey-out reasons. */
export async function visitAllocationView(jobId: string, userId: string, pre?: import("./trade-view.server").TradeJobAccess) {
  const c = await (await import("./trade-view.server")).requireTradeJob(userId, jobId, pre);
  const { data: job } = await db.from("jobs").select("stage").eq("id", jobId).maybeSingle();
  const kinds = visitsForStage(job?.stage ?? null);
  if (!kinds.length || c.kind !== "installer") return { canAllocate: false, visits: [] as { kind: VisitKind; label: string; current: { workerId: string; name: string } | null; hasForm: boolean; options: ReturnType<typeof allocationOptions> }[] };
  // Speed (installer screens, Task 6): the events, the staff list, the install booking date and each visit's form are
  // read together (they need only the job, the business and the visit kinds); the visits keep the stage's order.
  const [events, candidates, bookingCreatedAt, forms] = await Promise.all([
    allocationEvents(jobId),
    c.boss ? allocationCandidates(c.biz.id) : Promise.resolve([] as AllocationCandidate[]),
    // Decision 319: install days also need a verified White Card unless the installation was booked before the cutoff.
    kinds.includes("install") ? installBookingCreatedAt(jobId) : Promise.resolve(null),
    Promise.all(kinds.map((kind) => visitFormAuditId(jobId, kind))),
  ]);
  const today = melbourneToday();
  const install = kinds.includes("install") ? { bookingCreatedAt } : undefined;
  const visits = [];
  for (const [i, kind] of kinds.entries()) {
    const cur = currentAllocation(events, kind);
    visits.push({ kind, label: VISIT_LABEL[kind], current: cur ? { workerId: cur.worker_id, name: cur.worker_name } : null, hasForm: !!forms[i], options: c.boss ? allocationOptions(kind, candidates, today, kind === "install" ? install : undefined) : [] });
  }
  return { canAllocate: c.boss, visits };
}

/**
 * Allocate one visit to one staff member. Order: owner + business checks → eligibility (pure) → Mitti user lookup by
 * the staff row's email (TEST partners only ever reach the TEST Mitti account) → `visit_allocated` event → hand over the
 * existing form. A missing Mitti user refuses BEFORE anything is recorded ("Add them in Mitti first").
 */
export async function allocateVisit(jobId: string, userId: string, kind: VisitKind, workerId: string, call?: MittiCall, opts?: { crewPicker?: boolean }) {
  const tv = await import("./trade-view.server");
  const c = await tv.requireTradeJob(userId, jobId);
  // Jo 29 Oct 2026: staff can change the install Lead too, but only through the crew picker (saveCrewWithLead).
  const staffLeadChange = !c.boss && opts?.crewPicker === true && kind === "install";
  if (!c.boss && !staffLeadChange) throw new WorkflowError("Only the business owner can allocate a visit.");
  if (c.kind !== "installer") throw new WorkflowError("Visits are allocated on installer jobs only.");
  const { data: job } = await db.from("jobs").select("stage, source").eq("id", jobId).maybeSingle();
  if (!visitsForStage(job?.stage ?? null).includes(kind)) throw new WorkflowError(`This job isn't at its ${VISIT_LABEL[kind]} yet.`);
  const cand = (await allocationCandidates(c.biz.id)).find((x) => x.workerId === workerId);
  if (!cand) throw new WorkflowError("That person isn't on your staff list.");
  const why = allocationBlocker(kind, cand, melbourneToday(), kind === "install" ? { bookingCreatedAt: await installBookingCreatedAt(jobId) } : undefined);
  if (why) throw new WorkflowError(`${cand.name} can't take this ${VISIT_LABEL[kind]}: ${why}`);
  if (staffLeadChange && cand.workerRole !== "lead") throw new WorkflowError(`${cand.name} can't take this ${VISIT_LABEL[kind]}: ${ALLOCATION_REASON.crew}`);
  const mitti = await import("./mitti.server");
  const useCall = call ?? mitti.realMittiCall;
  // TEST partners never reach a real installer's Mitti user; their forms live under the TEST Mitti account.
  const lookupEmail = c.isTest || job?.source === "qa_test" ? (await import("./onsite-ready-check.core")).TEST_MITTI_ASSIGNEE : (mittiEmailFor({ role: cand.workerRole ?? null, ownEmail: cand.email, businessEmail: cand.businessEmail }).email ?? "");
  const mittiUserId = await mitti.findMittiUserByEmail(lookupEmail, useCall);
  if (!mittiUserId) throw new WorkflowError(addInMittiFirst(cand.name, cand.email));
  const auditId = await visitFormAuditId(jobId, kind);
  await logEvent(jobId, userId, VISIT_ALLOCATED_EVENT, `${VISIT_LABEL[kind]} allocated to ${cand.name}${auditId ? "" : " (Mitti form not created yet)"}`,
    { visit: kind, worker_id: cand.workerId, worker_name: cand.name, by: userId, mitti_user_id: mittiUserId, audit_id: auditId, form: auditId ? "reassigned" : "none", business_id: c.biz.id });
  if (auditId) await mitti.reassignMittiFormTo({ jobId, auditId, kind, mittiUserId, email: lookupEmail, actorId: userId }, useCall);
  return { ok: true as const, workerId: cand.workerId, name: cand.name, form: auditId ? "reassigned" as const : "none" as const };
}

/**
 * Jo 29 Oct 2026 (D6): ONE crew picker saves the install crew, and its Lead is the person who gets the Mitti install form.
 * Order: crew rules (refuse before anything is recorded) → if the Lead isn't already holding the form (current install
 * allocation, else the assigned installer's own staff row) hand it over through `allocateVisit` (owner or staff via the
 * crew picker / CII / "Add them in Mitti first" guards refuse before anything is recorded) → record `piisa_crew_selected` (the 2pm crew reminder reads it).
 */
export async function saveCrewWithLead(jobId: string, userId: string, sel: CrewSelection, call?: MittiCall): Promise<{ needsVerification: string[] }> {
  const held=await (await import('./in-house-suppression.server')).readInHouseDispatchState([jobId]);
  if(held.failed)throw new WorkflowError('Could not check the in-house partner. Please try again.');
  if(held.held.has(jobId)){
    const team=await (await import('./in-house-booking.server')).bookingTeam(jobId,userId);
    const why=(await import('./in-house-booking.core')).bookingWorkerBlocker('installation',team.workers.find(w=>w.id===leadWorkerId(sel))??null);
    if(why)throw new WorkflowError(why);
  }
  const piisa = await import("./piisa-a3.server");
  const { staff } = await piisa.loadCrew(jobId);
  const { problems } = crewSelectionProblems(sel, staff);
  if (problems.length) throw new WorkflowError(problems.join(" • "));
  const leadId = leadWorkerId(sel);
  const cur = currentAllocation(await allocationEvents(jobId), "install");
  const { data: asg } = await db.from("job_assignments").select("user_id, business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  const { data: own } = asg?.user_id
    ? await db.from("partner_workers").select("id").eq("profile_id", asg.user_id).eq("business_id", asg.business_id ?? "").is("removed_at", null).limit(1).maybeSingle()
    : { data: null };
  if (leadId && leadNeedsHandover({ leadWorkerId: leadId, allocatedWorkerId: cur?.worker_id ?? null, assigneeWorkerId: (own as { id?: string } | null)?.id ?? null })) {
    await allocateVisit(jobId, userId, "install", leadId, call, { crewPicker: true });
  }
  const result = await piisa.saveCrewSelection(jobId, userId, sel);
  const forms = await import("./in-house-forms.server");
  if (await forms.isInHouseFormJob(jobId).catch(e=>{ console.error("In-house crew form extension skipped", e instanceof Error ? e.message : "Partner read failed"); return false; })) {
    const { data: booked } = await db.from("bookings").select("id").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").limit(1).maybeSingle();
    if (booked) await forms.ensureInstallForm(jobId, userId, call);
    await forms.syncInHouseForms(jobId, "crew", userId, call);
    await (await import('./in-house-booking.server')).recordLeadChange(jobId,userId,cur?.worker_id??null,leadId??'');
  }
  return result;
}

/** 6:30am text: the allocated person (if any) for one job + visit kind, with their mobile from the staff row. */
export async function allocatedPersonFor(jobId: string, kind: VisitKind): Promise<{ workerId: string; name: string; mobile: string | null } | null> {
  const cur = currentAllocation(await allocationEvents(jobId), kind);
  if (!cur) return null;
  const { data: w } = await db.from("partner_workers").select("id, full_legal_name, mobile, removed_at").eq("id", cur.worker_id).maybeSingle();
  if (!w || w.removed_at) return null;
  return { workerId: w.id, name: w.full_legal_name, mobile: w.mobile ?? null };
}

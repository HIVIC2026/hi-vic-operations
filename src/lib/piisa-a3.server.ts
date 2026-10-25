/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
// A3 PIISA persistence: crew staff lookup/selection (scoped to the job's assigned installer business) and Ready Check
// area facts for prefill. Server-only; callers authorise first.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { WorkflowError, logEvent } from "./workflow.server";
import { certificationRef, crewSelectionProblems, leadWorkerId, rcAreasFromRecord, staffFromRecords, type CrewSelection, type RcArea, type StaffOption } from "./piisa-a3.core";

export async function assignedInstallerBusiness(jobId: string): Promise<string> {
  const { data } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (!data?.business_id) throw new WorkflowError("No installer business is assigned to this job.");
  return data.business_id;
}

/** Current installer staff of THIS business only. EEC counts only when office-verified; decision 153: cleared = verified + recorded level + not expired (approval_status shown, never a gate). */
export async function crewStaff(businessId: string, whiteCardFor?: { bookingCreatedAt: string | null }): Promise<StaffOption[]> {
  // All current installer workers of THIS business (approval shown, never changed), with their linked certification rows.
  const { data, error } = await admin.from("partner_workers").select("id, business_id, email, full_legal_name, certification, approval_status, removed_at, trade_role, licence_expires_on").eq("business_id", businessId).eq("trade_role", "installer").is("removed_at", null);
  if (error) throw new Error(`Couldn't load your staff: ${error.message}`);
  // Decision 130: a person who has not acknowledged the ESC collection notice can't be lead or crew.
  const noticeAck = await (await import("./esc-collection-notice.server")).noticeAckMap((data ?? []) as never);
  const ids = [...new Set((data ?? []).map((w) => certificationRef(w.certification)).filter((x): x is string => !!x))];
  const { data: certs, error: ce } = ids.length ? await admin.from("partner_worker_certifications").select("id, status, certificate_number, issuer, worker_id").in("id", ids) : { data: [], error: null };
  if (ce) throw new Error(`Couldn't load staff certifications: ${ce.message}`);
  const { data: lv, error: le } = ids.length ? await admin.from("worker_certification_levels").select("certification_id, level, expires_on, recorded_at").in("certification_id", ids) : { data: [], error: null };
  if (le) throw new Error(`Couldn't load certification levels: ${le.message}`);
  return staffFromRecords((data ?? []) as never, (certs ?? []) as never, (lv ?? []) as never, noticeAck, undefined, whiteCardFor);
}

/** Decision 319: when the job's current installation booking was made (null = not booked yet → the White Card rule applies). */
export async function installBookingCreatedAt(jobId: string): Promise<string | null> {
  const { data } = await admin.from("bookings").select("created_at").eq("job_id", jobId).eq("kind", "installation").in("status", ["confirmed", "completed"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as { created_at?: string | null } | null)?.created_at ?? null;
}

/** Crew staff for one job: the assigned installer business's people, with the White Card rule applied for this job's booking. */
async function crewStaffForJob(jobId: string): Promise<StaffOption[]> {
  const [biz, bookingCreatedAt] = await Promise.all([assignedInstallerBusiness(jobId), installBookingCreatedAt(jobId)]);
  return crewStaff(biz, { bookingCreatedAt });
}

export async function loadCrew(jobId: string): Promise<{ staff: StaffOption[]; selection: CrewSelection | null }> {
  const staff = await crewStaffForJob(jobId);
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "piisa_crew_selected").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return { staff, selection: ((data?.details as { selection?: CrewSelection } | null)?.selection) ?? null };
}

export async function saveCrewSelection(jobId: string, actorId: string, sel: CrewSelection) {
  const staff = await crewStaffForJob(jobId);
  const { problems, needsVerification } = crewSelectionProblems(sel, staff);
  if (problems.length) throw new WorkflowError(problems.join(" • "));
  await logEvent(jobId, actorId, "piisa_crew_selected", needsVerification.length ? `Install crew chosen — ${needsVerification.length} to verify` : "Install crew chosen from verified staff", { selection: sel as unknown as Json, needs_verification: needsVerification, staff_snapshot: staff.filter((s) => s.workerId === leadWorkerId(sel) || sel.additional.some((a) => "workerId" in a && a.workerId === s.workerId)) as unknown as Json }, { internal: true });
  return { needsVerification };
}

/** Same job's current Ready Check areas from the canonical persisted record (see rcAreasFromRecord). */
export async function readyCheckAreas(jobId: string): Promise<RcArea[]> {
  const { data: m } = await admin.from("ceiling_measurements").select("insulation_present, existing_r_value, removal_required, zones").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  if (!m) return [];
  const { data: a } = await admin.from("assessments").select("downlights_qty").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const dl = typeof a?.downlights_qty === "number" ? a.downlights_qty : null;
  return rcAreasFromRecord(m, dl);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
// A3 PIISA persistence: crew staff lookup/selection (scoped to the job's assigned installer business) and Ready Check
// area facts for prefill. Server-only; callers authorise first.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { WorkflowError, logEvent } from "./workflow.server";
import { crewSelectionProblems, type CrewSelection, type RcArea, type StaffOption } from "./piisa-a3.core";

export async function assignedInstallerBusiness(jobId: string): Promise<string> {
  const { data } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (!data?.business_id) throw new WorkflowError("No installer business is assigned to this job.");
  return data.business_id;
}

/** Approved, current installer staff of THIS business only. EEC counts only when office-verified. */
export async function crewStaff(businessId: string): Promise<StaffOption[]> {
  const { data, error } = await admin.from("partner_workers").select("id, full_legal_name, certification, certification_status, approval_status, removed_at, trade_role").eq("business_id", businessId).eq("trade_role", "installer").eq("approval_status", "approved").is("removed_at", null);
  if (error) throw new WorkflowError(`Staff could not be loaded: ${error.message}`);
  return (data ?? []).map((w) => ({ workerId: w.id, name: w.full_legal_name, eec: (w.certification as string | null)?.trim() || null, eecVerified: w.certification_status === "verified" && !!(w.certification as string | null)?.trim() }));
}

export async function loadCrew(jobId: string): Promise<{ staff: StaffOption[]; selection: CrewSelection | null }> {
  const staff = await crewStaff(await assignedInstallerBusiness(jobId));
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "piisa_crew_selected").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return { staff, selection: ((data?.details as { selection?: CrewSelection } | null)?.selection) ?? null };
}

export async function saveCrewSelection(jobId: string, actorId: string, sel: CrewSelection) {
  const staff = await crewStaff(await assignedInstallerBusiness(jobId));
  const { problems, needsVerification } = crewSelectionProblems(sel, staff);
  if (problems.length) throw new WorkflowError(problems.join(" • "));
  await logEvent(jobId, actorId, "piisa_crew_selected", needsVerification.length ? `Install crew chosen — ${needsVerification.length} to verify` : "Install crew chosen from verified staff", { selection: sel as unknown as Json, needs_verification: needsVerification, staff_snapshot: staff.filter((s) => s.workerId === sel.lead || sel.additional.some((a) => "workerId" in a && a.workerId === s.workerId)) as unknown as Json }, { internal: true });
  return { needsVerification };
}

/** Same job's current Ready Check areas (raw snapshot areas/zones when present; else the single measurement). */
export async function readyCheckAreas(jobId: string): Promise<RcArea[]> {
  const { data: m } = await admin.from("ceiling_measurements").select("insulation_present, existing_r_value, raw_snapshot, zones, status").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  if (!m) return [];
  const n = (v: unknown) => { const x = v == null || v === "" ? NaN : Number(v); return Number.isFinite(x) ? x : null; };
  const list = ((m.raw_snapshot as { areas?: unknown[] } | null)?.areas ?? (Array.isArray(m.zones) ? m.zones : [])) as Any[];
  if (list.length) return list.map((a) => ({ name: (a.name as string) ?? null, present: typeof a.present === "boolean" ? a.present : a.insulation_present == null ? null : !!a.insulation_present, depthMm: n(a.depthMm ?? a.depth_mm), rValue: n(a.rValue ?? a.r_value), downlights: n(a.downlights) }));
  return [{ present: m.insulation_present, depthMm: null, rValue: n(m.existing_r_value), downlights: null }];
}

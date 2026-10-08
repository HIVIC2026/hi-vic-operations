// Installer-supplied intake persistence/read model (Jo, 8 Oct 2026). Server-only; callers authorise first.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { installerQuoteReadiness, installerQuoteReleaseBlockers, insulationQualifies, readyCheckOutstanding, type EvidenceItem, type ExistingInsulation } from "./installer-intake.core";

const INSULATION_EVENTS = ["installer_existing_insulation_declared", "installer_intake_corrected"];

/** Latest insulation value: an office correction overrides the installer's declaration. Missing = null (never assumed). */
async function latestInsulation(jobId: string): Promise<{ value: ExistingInsulation | null; source: string | null }> {
  const { data } = await admin.from("workflow_events").select("event_type, details, created_at").eq("job_id", jobId).in("event_type", INSULATION_EVENTS).order("created_at", { ascending: false }).limit(10);
  for (const e of data ?? []) {
    const v = (e.details as { value?: unknown; insulation?: unknown } | null);
    const val = e.event_type === "installer_intake_corrected" ? v?.insulation : v?.value;
    if (val === "none" || val === "below_r2" || val === "unknown") return { value: val, source: e.event_type };
  }
  return { value: null, source: null };
}

/**
 * Route-specific office decision for installer-supplied jobs: owner/property eligibility checked by the office after
 * contact. Separate from the post-Ready-Check verified eligibility (which still needs full evidence). Any later
 * intake correction makes an earlier decision stale (unresolved) until the office decides again.
 */
async function commercialEligibility(jobId: string): Promise<"eligible" | "declined" | "unresolved"> {
  const { data } = await admin.from("workflow_events").select("event_type, details").eq("job_id", jobId).in("event_type", ["installer_commercial_eligibility", "installer_intake_corrected"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data || data.event_type !== "installer_commercial_eligibility") return "unresolved";
  const o = (data.details as { outcome?: string } | null)?.outcome;
  return o === "eligible" ? "eligible" : o === "not_eligible" ? "declined" : "unresolved";
}

export async function recordCommercialEligibility(jobId: string, actorId: string, outcome: "eligible" | "not_eligible", reason: string) {
  const { data: job } = await admin.from("jobs").select("channel").eq("id", jobId).single();
  if (job?.channel !== "installer_sourced") throw new WorkflowError("Only installer-supplied jobs use this check.");
  if (!reason.trim()) throw new WorkflowError("Add what was checked (owner, property, occupancy).");
  await logEvent(jobId, actorId, "installer_commercial_eligibility", outcome === "eligible" ? "Office checked owner and property eligibility for the installer quote" : "Office found the owner or property not eligible", { outcome, reason: reason.trim(), checked_at: new Date().toISOString(), note: "Owner quote eligibility only — Ready Check evidence and final AP verification still required" }, { internal: true });
}

export async function installerIntakeState(jobId: string) {
  const [{ data: job, error }, ins, { data: m }, decision, { data: consent }, { count: fee }, { data: ev }] = await Promise.all([
    admin.from("jobs").select("channel, installer_quoted_price_inc_gst, installer_price_includes").eq("id", jobId).single(),
    latestInsulation(jobId),
    admin.from("ceiling_measurements").select("measured_area_m2, verified_area_m2, existing_r_value").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    commercialEligibility(jobId),
    admin.from("owner_contact_consents").select("consent_status").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "installer_owner_fee_awareness"),
    admin.from("evidence_requirements").select("category, label, required, status").eq("job_id", jobId),
  ]);
  if (error) throw new WorkflowError(error.message);
  const area = m ? Number(m.verified_area_m2 ?? m.measured_area_m2) || null : null;
  const measuredR = m?.existing_r_value == null ? null : Number(m.existing_r_value);
  const officeEligibility = decision;
  const readiness = installerQuoteReadiness({ channel: job.channel, officeEligibility, insulation: ins.value, measuredR, areaM2: area, installerQuoteIncGst: job.installer_quoted_price_inc_gst == null ? null : Number(job.installer_quoted_price_inc_gst) });
  const release = installerQuoteReleaseBlockers({ consentStatus: consent?.consent_status ?? null, feeAwarenessRecorded: (fee ?? 0) > 0 });
  const rc = readyCheckOutstanding((ev ?? []).map((r) => ({ category: r.category, label: r.label, blocking: r.required, status: r.status })) as EvidenceItem[]);
  return {
    channel: job.channel, insulation: ins.value, insulationSource: ins.source, areaM2: area, measuredR,
    quoteIncGst: job.installer_quoted_price_inc_gst == null ? null : Number(job.installer_quoted_price_inc_gst), includes: job.installer_price_includes,
    officeEligibility, readiness, releaseBlockers: release,
    readyCheck: { outstandingCount: rc.count, outstanding: rc.outstanding.map((i) => ({ label: i.label, status: i.status })) },
  };
}

/** Route-specific commercial path: installer-supplied job may go to quote/PIESA with Ready Check evidence deferred. */
export async function installerIntakeQualified(jobId: string): Promise<boolean> {
  const { data: job } = await admin.from("jobs").select("channel").eq("id", jobId).maybeSingle();
  if (job?.channel !== "installer_sourced") return false;
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "installer_evidence_acknowledged");
  if (!count) return false; // only jobs that came through the approved intake
  const s = await installerIntakeState(jobId);
  return s.readiness.ready && insulationQualifies(s.insulation, s.measuredR);
}

/** Office correction of intake facts. Any change supersedes unsent draft quotes so stale figures can't be sent. */
export async function correctInstallerIntake(jobId: string, actorId: string, p: { insulation?: ExistingInsulation | undefined; quoteIncGst?: number | null | undefined; includes?: string | null | undefined; reason: string }) {
  const { data: job } = await admin.from("jobs").select("channel").eq("id", jobId).single();
  if (job?.channel !== "installer_sourced") throw new WorkflowError("Only installer-supplied jobs use this correction.");
  if (!p.reason.trim()) throw new WorkflowError("Give a reason for the correction.");
  const upd: { installer_quoted_price_inc_gst?: number | null; installer_price_includes?: string | null } = {};
  if (p.quoteIncGst !== undefined) upd.installer_quoted_price_inc_gst = p.quoteIncGst;
  if (p.includes !== undefined) upd.installer_price_includes = p.includes;
  if (Object.keys(upd).length) { const { error } = await admin.from("jobs").update(upd).eq("id", jobId); if (error) throw new WorkflowError(error.message); }
  const { data: sup } = await admin.from("quotes").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "installation").eq("status", "draft").select("id");
  await logEvent(jobId, actorId, "installer_intake_corrected", `Office corrected intake facts: ${p.reason.trim()}`, { insulation: p.insulation ?? null, quote_inc_gst: p.quoteIncGst ?? null, includes: p.includes ?? null, superseded_quotes: (sup ?? []).map((q) => q.id) }, { internal: true });
  return { superseded: (sup ?? []).length };
}

export async function recordOfficeFeeAwareness(jobId: string, actorId: string, note: string) {
  if (!note.trim()) throw new WorkflowError("Say how the owner was told about the fees.");
  const { OWNER_FEE_AWARENESS_TICK } = await import("./owner-confirm.core");
  await logEvent(jobId, actorId, "installer_owner_fee_awareness", "Office recorded that the owner is aware of the AP management and PIESA fees", { by: "office", note: note.trim(), wording: OWNER_FEE_AWARENESS_TICK, confirmed_at: new Date().toISOString() }, { internal: true });
}

/** Office "Prepare owner quote" from the intake facts. Always a held draft; dedups on identical figures. */
export async function draftQuoteFromIntake(jobId: string, actorId: string) {
  const s = await installerIntakeState(jobId);
  if (!s.readiness.ready) throw new WorkflowError(s.readiness.blockers.join(" • "));
  const { draftInstallerQuoteFromReadyCheck } = await import("./installer-quote.server");
  return draftInstallerQuoteFromReadyCheck(jobId, actorId, [], `intake:${jobId}`, { totalIncGst: s.quoteIncGst!, includes: s.includes ?? "As quoted by the installer" });
}

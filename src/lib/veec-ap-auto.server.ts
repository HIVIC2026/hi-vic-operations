// Decision 271 (Jo, 25 Oct 2026): Section 3 Part A of the official VEEC assignment form signs itself. Runs straight after
// the lead installer signs Part B (portal.functions signFinalAssignmentFn) and from the 15-minute tick (allocation-tick).
// Pure decision in veec-ap-auto.core.ts. Writes exactly what the manual office path writes (`writeApSignature`, conditional
// on ap_signed_at IS NULL so two runs can never sign twice) plus one append-only `veec_ap_signed_auto` event, then the
// usual evaluateAndApply/autoAdvance so the owner's Section 4 step opens at once (the day-0 owner email/text flow is
// already keyed to installation_completed_at in veec-reminders.server.ts and continues unchanged). Holds are recorded
// once per distinct set of reasons (`veec_ap_auto_held`, internal); Needs me shows them only after 24 hours.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { activeTemplate, sha256Hex, stableJson, type FinalFacts } from "./assignment.core";
import { consentValidityBlockers } from "./consent.core";
import {
  AP_AUTO_SIGNER, VEEC_AP_AUTO_EVENT, VEEC_AP_AUTO_HELD_EVENT, VEEC_AP_AUTO_METHOD, apAutoHeldSummary, apAutoSignedSummary, decideApAutoSignature, holdReasonsChanged,
} from "./veec-ap-auto.core";

export type ApAutoOutcome = { outcome: "signed"; signer: string } | { outcome: "held"; reasons: string[] } | { outcome: "skipped"; reason: string };

/** Owner ESC consent validity for the booked installation start (the fifth prerequisite in decision 271). */
async function ownerConsentBlockers(jobId: string): Promise<string[]> {
  const [{ data: b }, { data: c }] = await Promise.all([
    admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "installation").in("status", ["confirmed", "completed"]).order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
    admin.from("owner_esc_consents").select("status, scheduled_start, owner_signed_at, ap_signed_at").eq("job_id", jobId).not("status", "in", "(stale,cancelled)").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return consentValidityBlockers(c ?? null, b?.scheduled_start ?? null);
}

/** Every reason the automatic signature would hold on this job right now (prerequisites + owner consent). Read-only; office displays reuse it. */
export async function apAutoHoldReasons(jobId: string): Promise<string[]> {
  const { apPrerequisites } = await import("./assignment.server");
  const [pre, consent] = await Promise.all([apPrerequisites(jobId), ownerConsentBlockers(jobId)]);
  const d = decideApAutoSignature({ status: "awaiting_ap_signature", installerSignedAt: new Date(0).toISOString(), apSignedAt: null, prerequisiteBlockers: pre, ownerConsentBlockers: consent, openVariation: false, signerName: AP_AUTO_SIGNER.name });
  return d.action === "hold" ? d.reasons : [];
}

async function lastHeldReasons(jobId: string, assignmentId: string): Promise<string[] | null> {
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", VEEC_AP_AUTO_HELD_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const d = data?.details as { assignment_id?: string; reasons?: string[] } | null;
  return d && d.assignment_id === assignmentId && Array.isArray(d.reasons) ? d.reasons : null;
}

/** Signs Part A automatically when allowed; otherwise records why it is held. Idempotent per job. */
export async function tryAutoApSignature(jobId: string): Promise<ApAutoOutcome> {
  const { currentAssignment, apPrerequisites, loadTemplates, evaluateAndApply } = await import("./assignment.server");
  const a = await currentAssignment(jobId);
  if (!a) return { outcome: "skipped", reason: "no VEEC assignment form prepared yet" };
  const { count: openVar } = await admin.from("assignment_variations").select("id", { count: "exact", head: true }).eq("assignment_id", a.id).eq("status", "pending");
  const needsFacts = a.status === "awaiting_ap_signature" && !!a.installer_signed_at && !a.ap_signed_at;
  const [pre, consent] = needsFacts ? await Promise.all([apPrerequisites(jobId), ownerConsentBlockers(jobId)]) : [[], []];
  const d = decideApAutoSignature({ status: a.status, installerSignedAt: a.installer_signed_at, apSignedAt: a.ap_signed_at, prerequisiteBlockers: pre, ownerConsentBlockers: consent, openVariation: (openVar ?? 0) > 0, signerName: AP_AUTO_SIGNER.name });
  if (d.action === "skip") return { outcome: "skipped", reason: d.reason };
  if (d.action === "hold") {
    if (holdReasonsChanged(await lastHeldReasons(jobId, a.id), d.reasons)) await logEvent(jobId, null, VEEC_AP_AUTO_HELD_EVENT, apAutoHeldSummary(d.reasons), { assignment_id: a.id, reasons: d.reasons, installer_signed_at: a.installer_signed_at }, { internal: true });
    return { outcome: "held", reasons: d.reasons };
  }
  const templates = await loadTemplates();
  const official = activeTemplate(templates, "consumer_declaration");
  const preparedVersion = (a.final_facts as unknown as FinalFacts | null)?.template_version ?? a.consumer_declaration_version;
  if (!official || official.version !== preparedVersion) return { outcome: "held", reasons: ["The official assignment form version changed – Home Insulation Victoria must prepare the assignment again."] };
  const now = new Date().toISOString();
  const sig = { typed_name: d.signerName, at: now, ip: null, user_agent: null, user_id: null, facts_sha256: a.final_facts_sha256, form_version: official.version, method: VEEC_AP_AUTO_METHOD, signer_role: AP_AUTO_SIGNER.role };
  const hash = await sha256Hex(stableJson({ party: "ap", sig, facts: a.final_facts }));
  const { writeApSignature } = await import("./assignment.server");
  const written = await writeApSignature({ assignmentId: a.id, templates, officialVersion: official.version, sig, hash, signatureName: d.signerName, actorId: null, method: "automatic" });
  if (!written) return { outcome: "skipped", reason: "AP representative has already signed" };
  const { ASSIGNMENT_EVENTS } = await import("./assignment.core");
  await logEvent(jobId, null, ASSIGNMENT_EVENTS.FINAL_ASSIGNMENT_SIGNED, "VEEC assignment form signed by AP representative (Section 3 Part A)", { assignment_id: a.id, sha256: hash, party: "ap", method: VEEC_AP_AUTO_METHOD });
  await logEvent(jobId, null, VEEC_AP_AUTO_EVENT, apAutoSignedSummary(d.signerName), { assignment_id: a.id, sha256: hash, signer: d.signerName, signer_role: AP_AUTO_SIGNER.role, method: VEEC_AP_AUTO_METHOD, signed_at: now });
  await evaluateAndApply(jobId, null);
  const { autoAdvanceJob } = await import("./autoadvance.server");
  await autoAdvanceJob(jobId, null, "VEEC Part A signed automatically").catch((e: Error) => console.error("auto AP signature: auto-advance skipped", (e as Error).message));
  return { outcome: "signed", signer: d.signerName };
}

/** 15-minute tick: every form waiting on the AP signature. */
export async function sweepAutoApSignatures(): Promise<{ checked: number; signed: number; held: number }> {
  const { data: rows } = await admin.from("customer_assignments").select("job_id").eq("record_kind", "final_veec_assignment").eq("status", "awaiting_ap_signature").not("installer_signed_at", "is", null).is("ap_signed_at", null);
  let signed = 0, held = 0;
  for (const r of rows ?? []) {
    try {
      const o = await tryAutoApSignature(r.job_id);
      if (o.outcome === "signed") signed++; else if (o.outcome === "held") held++;
    } catch (e) { console.error("auto AP signature failed", r.job_id, (e as Error).message); }
  }
  return { checked: (rows ?? []).length, signed, held };
}

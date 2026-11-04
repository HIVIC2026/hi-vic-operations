// New job flow Part 8 Task 7: apply the Lead Installer's Mitti Part B signature to the VEEC assignment record, exactly like the
// portal signing does (same columns, same snapshot hash) so veec-ap-auto takes over unchanged. The image is fetched only for the
// audit linked to this job, kept in job-files, and the whole step is idempotent (one signature per assignment). Never sends.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import type { MittiMediaFetch } from "./mitti.server";
import { installDayPartB } from "./install-day.core";
import { INSTALLER_DECLARATION } from "./veec-assignment-form.core";
import { VEEC_PART_B_MITTI_HELD_EVENT, VEEC_PART_B_SIGNED_MITTI_EVENT, partBApplyDecision } from "./veec-part-b-mitti.core";
import type { Json } from "@/integrations/supabase/types";

async function hold(jobId: string, auditId: string, reason: string, needsOffice: boolean): Promise<"held"> {
  const { data: prev } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", VEEC_PART_B_MITTI_HELD_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const p = prev?.details as { audit_id?: string; reason?: string } | null;
  if (!(p?.audit_id === auditId && p?.reason === reason)) await logEvent(jobId, null, VEEC_PART_B_MITTI_HELD_EVENT, `VEEC Part B from Mitti not applied: ${reason}`, { audit_id: auditId, reason, needs_office: needsOffice }, { internal: true });
  return "held";
}

const FACTS_CHANGED = "Rebate form facts changed after the Lead Installer signed in Mitti — a new Part B signature is needed.";

async function evaluate(jobId: string, assignmentId: string) {
  try { await (await import("./assignment.server")).evaluateAndApply(jobId, null); }
  catch (e) { await logEvent(jobId, null, "veec_part_b_evaluate_failed", "VEEC assignment check after the Part B signature failed", { assignment_id: assignmentId, error: e instanceof Error ? e.message : "error" }, { internal: true }); }
}

export async function applyMittiPartB(jobId: string, auditId: string, audit: unknown, fetchMedia: MittiMediaFetch): Promise<"applied" | "skipped" | "held"> {
  // Only the audit linked to this job may supply a signature.
  const { data: ev } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_piisa_audit_created").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if ((ev?.details as { audit_id?: string } | null)?.audit_id !== auditId) return "skipped";
  const asg = await import("./assignment.server");
  const core = await import("./assignment.core");
  const partB = installDayPartB(audit);
  const { leadInstallerCert } = await import("./prestart.server");
  const leadName = (await leadInstallerCert(jobId)).name;
  let a = await asg.currentAssignment(jobId);
  // Signature already written but the record never moved on (an earlier evaluateAndApply failed): re-run it, never re-sign.
  if (a?.installer_signed_at && a.status === "awaiting_installer_signature") {
    await evaluate(jobId, a.id);
    return "skipped";
  }
  const d = partBApplyDecision({ partB, leadName, assignment: a ? { status: a.status, installerSignedAt: a.installer_signed_at } : null });
  if (d.action === "skip") return "skipped";
  if (d.action === "hold") return hold(jobId, auditId, d.reason, true);
  const sig = partB.signature;
  try {
    let preparedHere = false;
    if (!a) {
      const { data: inst } = await admin.from("job_assignments").select("user_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
      if (!inst?.user_id) return hold(jobId, auditId, "No installer is assigned to this job yet", false);
      try { await asg.prepareFinalAssignment(jobId, inst.user_id as string, {}); }
      catch (e) { return hold(jobId, auditId, `The VEEC assignment isn't ready yet: ${e instanceof Error ? e.message : "not ready"}`, false); }
      a = await asg.currentAssignment(jobId);
      if (!a) return hold(jobId, auditId, "The VEEC assignment isn't ready yet", false);
      if (a.installer_signed_at) return "skipped";
      preparedHere = true;
    }
    // Facts must be what the Lead Installer saw. An assignment prepared by this very call is built from this audit's completed facts, so it is
    // signable; so is the office's FIRST preparation after an earlier sync could not prepare (no earlier row: nothing was re-prepared, Part 8 final
    // review I1). Only a real re-preparation — an EARLIER final assignment row existed — prepared after the Mitti signature holds, and this image
    // must never have been used on an earlier row.
    const { data: rows } = await admin.from("customer_assignments").select("id, record_kind, installer_snapshot").eq("job_id", jobId);
    const earlier = (rows ?? []).filter((r) => r.id !== a!.id && r.record_kind !== "legacy_quote_time");
    const preparedAfterSignature = !a.prepared_at || Date.parse(a.prepared_at as string) >= Date.parse(sig.signedAt!);
    if (!preparedHere && earlier.length > 0 && preparedAfterSignature) return hold(jobId, auditId, FACTS_CHANGED, true);
    if ((rows ?? []).some((r) => r.id !== a!.id && (r.installer_snapshot as { media_id?: string } | null)?.media_id === sig.mediaId)) return hold(jobId, auditId, FACTS_CHANGED, true);
    const { count: openVar } = await admin.from("assignment_variations").select("id", { count: "exact", head: true }).eq("assignment_id", a.id).eq("status", "pending");
    const blocker = core.signingOrderBlocker({ status: a.status, installerSigned: false, apSigned: !!a.ap_signed_at, consumerSigned: !!a.consumer_signed_at, openVariation: (openVar ?? 0) > 0, consumerFinalRequired: a.consumer_final_required, consumerFinalSigned: !!a.consumer_final_signed_at }, "installer");
    if (blocker) return hold(jobId, auditId, blocker, false);
    const official = core.activeTemplate(await asg.loadTemplates(), "consumer_declaration");
    const preparedVersion = (a.final_facts as { template_version?: string } | null)?.template_version ?? a.consumer_declaration_version;
    if (!official || official.version !== preparedVersion) return hold(jobId, auditId, "The official assignment form version changed – the assignment must be prepared again", true);
    const { bytes, contentType } = await fetchMedia(auditId, sig.mediaId!);
    if (!bytes.length) throw new Error("empty signature image");
    const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
    const imagePath = `${jobId}/assignment/part-b-${sig.mediaId}.${ext}`;
    const up = await admin.storage.from("job-files").upload(imagePath, bytes, { contentType, upsert: false });
    if (up.error && !/exists/i.test(up.error.message)) throw new Error(`storage upload failed: ${up.error.message}`);
    const snap = { typed_name: sig.name, at: sig.signedAt, source: "mitti_install_form", audit_id: auditId, media_id: sig.mediaId, image_path: imagePath, facts_sha256: a.final_facts_sha256, form_version: official.version };
    const hash = await core.sha256Hex(core.stableJson({ party: "installer", sig: snap, facts: a.final_facts }));
    const { data: wrote } = await admin.from("customer_assignments").update({
      installer_signature_name: sig.name,
      installer_signed_at: sig.signedAt,
      installer_snapshot: { ...snap, part: "Section 3 Part B", declaration: INSTALLER_DECLARATION } as unknown as Json,
      installer_snapshot_sha256: hash,
    }).eq("id", a.id).is("installer_signed_at", null).select("id");
    if (!wrote?.length) return "skipped";
    await logEvent(jobId, null, VEEC_PART_B_SIGNED_MITTI_EVENT, "VEEC assignment form signed by the Lead Installer in Mitti (Section 3 Part B)", { assignment_id: a.id, audit_id: auditId, media_id: sig.mediaId, image_path: imagePath, signed_at: sig.signedAt }, { internal: true });
    await evaluate(jobId, a.id);
    return "applied";
  } catch (e) {
    return hold(jobId, auditId, `Could not apply the Part B signature: ${e instanceof Error ? e.message : "error"}`, false);
  }
}

// A3 PIISA prestart capture: reads the CURRENT (normally in-progress) audit via GET, stores the signature IMAGE itself and an
// immutable prestart snapshot BEFORE final completion. After-work media never block this check. No audit writes, no sends.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

import { mittiApi, parseAudit, type MittiCall } from "./mitti.core";
import { sha256Hex, stableJson } from "./assignment.core";
import { a3PrestartSnapshot, type A3EvidenceCtx, type A3PrestartSnapshot } from "./piisa-a3.core";
import { logEvent } from "./workflow.server";
import type { MittiMediaFetch } from "./mitti.server";

export type StoredSignature = { media_id: string; image_path: string; image_sha256: string; content_type: string; signed_at: string; signer_name: string | null };
export type StoredPrestart = { snapshot: A3PrestartSnapshot; signature_image: StoredSignature; sha256: string };

export async function latestPrestart(jobId: string, auditId: string): Promise<StoredPrestart | null> {
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "piisa_prestart_captured").order("created_at", { ascending: true }).limit(20);
  const hit = (data ?? []).map((r) => r.details as unknown as StoredPrestart & { audit_id?: string }).find((d) => d?.snapshot?.audit_id === auditId);
  return hit ?? null;
}

/** Context reused from the SAME job (life-support consent/plan on file, existing valid plan). */
export async function a3Ctx(jobId: string, audit: unknown): Promise<A3EvidenceCtx> {
  const { data: reqs } = await admin.from("evidence_requirements").select("category,status").eq("job_id", jobId);
  const ok = (c: string) => (reqs ?? []).some((r) => r.category === c && ["uploaded", "verified"].includes(String(r.status)));
  const { A3_NATIVE_IDS } = await import("./piisa-a3.core");
  const { flatten } = await import("./mitti.core");
  const ls = flatten(audit).find((e) => e.id === A3_NATIVE_IDS["lifeSupportAttachment"]![0]);
  const { isInstallDayDoc, installDayMedia } = await import("./install-day.core");
  const lsUpload = isInstallDayDoc(audit) && installDayMedia(audit).life_support.length > 0;
  const { data: lsDoc } = await admin.from("documents").select("id").eq("job_id", jobId).ilike("kind", "%life_support%").limit(1);
  // Signed PIESA B1 "rectification not possible" means an electrician must attend the start (official B1 wording).
  const { currentCopy } = await import("./official-forms.server");
  const { answersFromDocument, B1_OPTIONS } = await import("./official-forms.core");
  const pe = await currentCopy(jobId, "piesa");
  const b1 = pe.copy ? (answersFromDocument(pe.copy.snapshot.document) as Record<string, unknown>)["b1"] : null;
  const generatedFinalPlan = await (await import("./area-diagram.server")).hasGeneratedFinalPlan(jobId);
  return { crewCount: 1, electricianRequiredAtStart: b1 === B1_OPTIONS[2], existingPlanMatchesInstall: ok("final_zone_plan"), generatedFinalPlan, installDayForm: isInstallDayDoc(audit), lifeSupportConsentOnFile: !!ls?.value || lsUpload || (lsDoc ?? []).length > 0 };
}

/**
 * Decision 262: official answers the portal fills for the "A3 – Install day" form — Part 5 lights / cables / downlights
 * from the job's signed PIESA (piesaPart5Answers) and Part 6 existing insulation from the current Ready Check record
 * (readyCheckPart6Answers). `missing` lists every fact neither record establishes (pre-start blockers); `conductive`
 * feeds the official P6 foil rule as the portal-side conductivity record.
 */
export async function installDayPortalAnswers(jobId: string): Promise<{ answers: Record<string, string | string[]>; missing: string[]; conductive: boolean | null }> {
  const { currentCopy } = await import("./official-forms.server");
  const { answersFromDocument } = await import("./official-forms.core");
  const { piesaPart5Answers } = await import("./install-day.core");
  const { readyCheckPart6Answers } = await import("./piisa-a3.core");
  const { readyCheckAreas } = await import("./piisa-a3.server");
  const pe = await currentCopy(jobId, "piesa");
  const p5 = piesaPart5Answers(pe.copy ? (answersFromDocument(pe.copy.snapshot.document) as Record<string, unknown>) : null);
  // The Ready Check record holds no condition, reason or foil answer today: those stay missing until recorded.
  const p6 = readyCheckPart6Answers(await readyCheckAreas(jobId), { suitable: null, conductive: null, reason: null });
  return { answers: { ...p5.answers, ...p6.answers }, missing: [...p5.missing, ...p6.missing], conductive: p6.conductive };
}

export async function storeSignatureImage(jobId: string, auditId: string, sig: A3PrestartSnapshot["signature"], fetchMedia: MittiMediaFetch): Promise<StoredSignature> {
  const { bytes, contentType } = await fetchMedia(auditId, sig.media_id);
  if (!bytes.length) throw new Error("The signature image is empty.");
  const { createHash } = await import("node:crypto");
  const image_sha256 = createHash("sha256").update(bytes).digest("hex");
  const ext = contentType.includes("png") ? "png" : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "img";
  const image_path = `jobs/${jobId}/official/piisa-${auditId}.signature.${ext}`;
  const up = await admin.storage.from("job-files").upload(image_path, bytes, { contentType, upsert: false });
  if (up.error && !/exists/i.test(up.error.message)) throw new Error(`Signature image could not be stored: ${up.error.message}`);
  return { media_id: sig.media_id, image_path, image_sha256, content_type: contentType, signed_at: sig.signed_at, signer_name: sig.signer_name };
}

export type PrestartResult = { status: "captured" | "already" | "not_signed" | "error"; message: string; prestart?: StoredPrestart };

/** Capture once per audit; later calls return the stored immutable record. Signature changed after capture = error. */
export async function capturePiisaPrestart(jobId: string, actorId: string | null, auditId: string, audit: unknown, fetchMedia: MittiMediaFetch): Promise<PrestartResult> {
  const p = parseAudit(audit);
  const { isInstallDayDoc } = await import("./install-day.core");
  const portal = isInstallDayDoc(audit) ? await installDayPortalAnswers(jobId) : undefined;
  const built = a3PrestartSnapshot(auditId, audit, await a3Ctx(jobId, audit), { completed: p.completed, ...(portal ? { portal } : {}) });
  const existing = await latestPrestart(jobId, auditId);
  if (existing) {
    if (built.ok && built.snapshot.signature.media_id !== existing.snapshot.signature.media_id) return { status: "error", message: "The PIISA signature changed after the start-of-work check was captured — office review required." };
    return { status: "already", message: "Start-of-work check already captured.", prestart: existing };
  }
  if (!built.ok) return { status: "not_signed", message: built.reason };
  // Decisions 205/210/262: the before-work items on the same form (area before-videos, old-form ruler photos and foil
  // answer) join the start-of-work check. A read failure is recorded as a blocker, never as a pass.
  try {
    const core = await import("./install-evidence.core");
    const { installEvidenceContext } = await import("./install-evidence.server");
    const s = core.evaluateInstallEvidence(core.readInstallEvidence(audit), await installEvidenceContext(jobId, audit), built.snapshot.signature.signed_at);
    built.snapshot.blockers.push(...s.prestartBlockers.map((b) => `Install day: ${b}`));
  } catch (e) { built.snapshot.blockers.push(`Install day: before-work items could not be read (${e instanceof Error ? e.message : "error"}) — office review`); }
  let image: StoredSignature;
  try { image = await storeSignatureImage(jobId, auditId, built.snapshot.signature, fetchMedia); }
  catch (e) { return { status: "error", message: e instanceof Error ? e.message : "Signature image could not be stored." }; }
  const sha256 = await sha256Hex(stableJson(built.snapshot));
  const rec: StoredPrestart = { snapshot: built.snapshot, signature_image: image, sha256 };
  await logEvent(jobId, actorId, "piisa_prestart_captured", built.snapshot.blockers.length ? `PIISA start-of-work check captured — ${built.snapshot.blockers.length} item(s) need attention` : "PIISA start-of-work check captured", rec as unknown as Record<string, unknown>, { internal: true });
  return { status: "captured", message: "Start-of-work check captured.", prestart: rec };
}

/** GET the current audit and capture (used by sync before completion). */
export async function capturePrestartFromMitti(jobId: string, actorId: string | null, auditId: string, call: MittiCall, fetchMedia: MittiMediaFetch) {
  return capturePiisaPrestart(jobId, actorId, auditId, await mittiApi(call).getAudit(auditId), fetchMedia);
}

// Saves the installer declaration signed inside the Mitti PIISA form as the job's record.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { mittiApi, parseAudit, type MittiCall } from "./mitti.core";
import { activeTemplate, sha256Hex, stableJson, templateBlockers } from "./assignment.core";
import { declarationFromPiisa, MISSING_INSTALLER_DECLARATION } from "./piisa-declaration.core";
import { logEvent } from "./workflow.server";
import { piisaAssessmentDay } from "./piisa-assessment-date.core";

export type PiisaDeclSync = { status: "saved" | "already" | "pending" | "missing" | "no_form" | "error"; message: string };

export async function syncPiisaDeclaration(jobId: string, actorId: string | null, call?: MittiCall, opts: { testTemplateId?: string; fetchMedia?: import("./mitti.server").MittiMediaFetch } = {}): Promise<PiisaDeclSync> {
  const { data: existing } = await admin.from("installer_declarations").select("id,snapshot").eq("job_id", jobId).eq("status", "signed").maybeSingle();
  const { data: job } = await admin.from("jobs").select("job_number, source").eq("id", jobId).single();
  if (!job) return { status: "error", message: "Job not found." };
  const { data: ev } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_piisa_audit_created").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const auditId = (ev?.details as { audit_id?: string } | null)?.audit_id;
  if (!auditId) return { status: "no_form", message: "The installer safety form (PIISA) hasn't been sent in Mitti yet." };
  const { data: ws } = await admin.from("workflow_settings").select("mitti_piisa_template_id").eq("id", 1).maybeSingle();
  // A test template id is only accepted on TEST jobs (journey simulation).
  const expectedTpl = (job.source === "qa_test" && opts.testTemplateId) || ws?.mitti_piisa_template_id?.trim() || "";
  if (!expectedTpl) return { status: "no_form", message: "PIISA Mitti form is not configured." };
  const realCall = call ?? (await import("./mitti.server")).realMittiCall;
  const audit = await mittiApi(realCall).getAudit(auditId);
  const p = parseAudit(audit);
  if (p.auditId && p.auditId !== auditId) return { status: "error", message: "Mitti returned a different audit." };
  if (p.templateId !== expectedTpl) return { status: "error", message: "This Mitti audit is not the PIISA form." };
  if (!p.jobNumber || p.jobNumber.trim().toUpperCase() !== job.job_number.trim().toUpperCase()) return { status: "error", message: `Mitti Job Reference ID (${p.jobNumber ?? "missing"}) does not match ${job.job_number}.` };
  const { PIISA_A3_TEMPLATE_ID: A3_TPL } = await import("./piisa-a3.core");
  const isA3 = expectedTpl === A3_TPL;
  const fetchMedia = opts.fetchMedia ?? (isA3 ? (await import("./mitti.server")).realMittiMedia : undefined);
  const finalPostworkVersion = "a3-final-postwork-2026-10-08";
  const auditOwnedFinalPostwork = isA3 && ((ev?.details as { native_version?: string } | null)?.native_version === finalPostworkVersion || (await import("./mitti.core")).flatten(audit).some((e) => e.id === "d11eaa63-198b-471f-b57c-d3717bce551c"));
  if (existing) {
    if (auditOwnedFinalPostwork) {
      if (!fetchMedia) return { status: "error", message: "The original after-work evidence could not be read; the historical signed PIISA was not altered." };
      const problems = await (await import("./piisa-postwork.server")).syncVerifiedPiisaPostwork(jobId, auditId, audit, fetchMedia);
      if (problems.length) return { status: "error", message: problems.join(" • ") + " The historical signed PIISA was not altered." };
    }
    const saved = existing.snapshot as { official?: { a3_evidence?: { actual_product_answers?: unknown } } } | null;
    if (saved?.official?.a3_evidence?.actual_product_answers && fetchMedia) {
      const products = await import("./piisa-products.server");
      const problems = await products.syncNativeProductEvidence(jobId, auditId, audit, fetchMedia);
      const reviewed = await products.verifiedInstalledProductAnswers(jobId);
      if (problems.length || reviewed.blockers.length || JSON.stringify(reviewed.answers) !== JSON.stringify(saved.official.a3_evidence.actual_product_answers)) return { status: "error", message: "Product label evidence changed or needs review; the historical signed PIISA was not altered." };
    }
    return { status: "already", message: "Declaration already saved." };
  }
  // A3: the signed start-of-work check is captured from the CURRENT audit BEFORE completion (after-work media not needed).
  let prestart: import("./piisa-prestart.server").StoredPrestart | null = null;
  if (isA3) {
    const { capturePiisaPrestart } = await import("./piisa-prestart.server");
    if (!fetchMedia) return { status: "error", message: "The original PIISA media could not be read." };
    const pr = await capturePiisaPrestart(jobId, actorId, auditId, audit, fetchMedia);
    if (pr.status === "error") return { status: "error", message: pr.message };
    prestart = pr.prestart ?? null;
    if (!p.completed) return { status: "pending", message: prestart ? `PIISA start-of-work check captured; final completion not done in Mitti yet.` : `PIISA not completed in Mitti yet. ${pr.message}` };
  }
  if (!p.completed) return { status: "pending", message: "PIISA not completed in Mitti yet." };
  const native = await import("./piisa-native-version.core");
  const direct = isA3 && native.isDirectPiisaAudit(audit);
  const finalPostwork = direct && auditOwnedFinalPostwork;
  let actualProducts: Awaited<ReturnType<typeof import("./piisa-products.server").verifiedInstalledProductAnswers>> | null = null;
  let directCrew: ReturnType<typeof native.resolveDirectCrew> | null = null;
  let r = declarationFromPiisa(p.snapshot);
  if (direct) {
    const tplDef = await mittiApi(realCall).getTemplateDefinition(expectedTpl);
    const version = native.resolvePiisaNativeVersion(tplDef);
    if (!version.active || version.version !== native.PIISA_DIRECT_VERSION) return { status: "error", message: `PIISA mapping needs review: ${version.problems.join(" • ")}` };
    if (finalPostwork) {
      const postwork = await import("./piisa-postwork.server");
      if (!fetchMedia) return { status: "error", message: "The original after-work evidence could not be read." };
      const postworkProblems = await postwork.syncVerifiedPiisaPostwork(jobId, auditId, audit, fetchMedia);
      if (postworkProblems.length) return { status: "pending", message: postworkProblems.join(" • ") };
    }
    const { loadCrew } = await import("./piisa-a3.server");
    directCrew = native.resolveDirectCrew(audit, (await loadCrew(jobId)).staff);
    if (directCrew.blockers.length) return { status: "missing", message: directCrew.blockers.join(" • ") };
    const { directLeadSignatureProblem } = await import("./piisa-a3.core");
    const signerProblem = directLeadSignatureProblem(audit, directCrew.answers["p2.lead"] ?? null);
    if (signerProblem) return { status: "missing", message: signerProblem };
    const products = await import("./piisa-products.server");
    if (!fetchMedia) return { status: "error", message: "Original product label photos could not be read." };
    const photoProblems = await products.syncNativeProductEvidence(jobId, auditId, audit, fetchMedia);
    if (photoProblems.length) return { status: "missing", message: photoProblems.join(" • ") };
    actualProducts = await products.verifiedInstalledProductAnswers(jobId);
    if (actualProducts.blockers.length) return { status: "missing", message: actualProducts.blockers.join(" • ") };
    const { flatten } = await import("./mitti.core");
    const { a3Signature, A3_NATIVE_IDS } = await import("./piisa-a3.core");
    const sig = a3Signature(audit);
    const tick = flatten(audit).find((e) => e.id === A3_NATIVE_IDS["p8.declaration"]?.[0])?.value;
    const { declarationFromDirectPiisa } = await import("./piisa-declaration.core");
    r = declarationFromDirectPiisa({ tick, product: actualProducts.answers["p7.products"] ?? null, areaM2: actualProducts.installedAreaM2, name: directCrew.answers["p2.lead"] ?? null, signature: sig.mediaId, signedAt: sig.signedAt });
  }
  if (!r.ok) {
    await logEvent(jobId, actorId, "installer_declaration_missing", `${MISSING_INSTALLER_DECLARATION} – the completed PIISA has no signed declaration (${r.missing.join(", ")})`, { audit_id: auditId, missing: r.missing });
    return { status: "missing", message: `${MISSING_INSTALLER_DECLARATION} (${r.missing.join(", ")})` };
  }
  const { data: tpls } = await admin.from("compliance_templates").select("template_key, version, body, approved, is_active, required, form_fields, requires_final_consumer_signature").eq("is_active", true);
  const templates = (tpls ?? []) as never;
  const tb = templateBlockers(templates, "installer");
  const tpl = activeTemplate(templates, "installer_declaration");
  if (tb.length || !tpl) return { status: "error", message: tb.join(" ") || "Installer declaration wording is not approved." };
  const { data: a } = await admin.from("job_assignments").select("user_id, business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  const { data: b } = a?.business_id ? await admin.from("businesses").select("name, abn, licence_number").eq("id", a.business_id).maybeSingle() : { data: null };
  // The signature's OWN timestamp only — never the audit's modified/completed time, never "now".
  const { a3Signature, parseA3Answers, signatureAttachment, PIISA_A3_TEMPLATE_ID } = await import("./piisa-a3.core");
  const sig = a3Signature(audit);
  if (!sig.present || !sig.signedAt) {
    await logEvent(jobId, actorId, "installer_declaration_missing", "Completed PIISA has no signature timestamp — not saved", { audit_id: auditId }, { internal: true });
    return { status: "missing", message: sig.present ? "The PIISA signature has no time recorded, so it can't be used. Ask the installer to sign again in Mitti." : "The PIISA has no signature image, so it can't be used. Ask the installer to sign in Mitti." };
  }
  if (isA3 && (!prestart || prestart.snapshot.signature.media_id !== sig.mediaId)) return { status: "error", message: "The PIISA signature does not match the captured start-of-work check — office review required." };
  // A3: the prestart signature's OWN time, captured before completion and kept immutable.
  const signedAt = prestart ? prestart.snapshot.signature.signed_at : sig.signedAt;
  // A3: completed audit populates the OFFICIAL PIISA answers (Parts 1–8) and the original official DOCX.
  let crewBlockers: string[] = [];
  let official: { answers: Record<string, unknown>; docx?: { path: string; sha256: string; missed: string[] }; signature_attachment?: unknown; a3_evidence?: unknown } | null = null;
  if (expectedTpl === PIISA_A3_TEMPLATE_ID) {
    const { answers, crew } = parseA3Answers(audit);
    void crew;
    // Part 2 crew from the native choice list, resolved against CURRENT verified staff of the assigned company.
    const coreC = await import("./piisa-a3.core");
    const { crewStaff: cs } = await import("./piisa-a3.server");
    const { data: asgB } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
    const { data: bizB } = asgB?.business_id ? await admin.from("businesses").select("name").eq("id", asgB.business_id).maybeSingle() : { data: null };
    const tplDef = await mittiApi(realCall).getTemplateDefinition(expectedTpl).catch(() => null);
    if (!tplDef) return { status: "error", message: "The current PIISA field structure could not be checked. No signed official copy saved." };
    // Old audits keep their own historical schema; current master cannot reinterpret old response fields.
    const mappingProblems = direct ? native.resolvePiisaNativeVersion(tplDef).problems : [];
    if (mappingProblems.length) return { status: "error", message: `The PIISA field structure has changed and needs confirmed mapping: ${mappingProblems.join(" • ")}. No signed official copy saved.` };
    const crewRes = directCrew ?? coreC.a3ResolveCrewChoices(coreC.a3CrewChoices(audit), audit, asgB?.business_id ? await cs(asgB.business_id) : [], bizB?.name ?? "");
    Object.assign(answers, crewRes.answers, actualProducts?.answers ?? {});
    if (direct) {
      const assessmentDay = piisaAssessmentDay(signedAt);
      if (!assessmentDay) return { status: "missing", message: "The captured PIISA assessment/signing timestamp is missing or invalid; no expected completion date was invented." };
      answers["completionDate"] = assessmentDay;
    }
    crewBlockers = [...crewRes.blockers, ...crewRes.needsVerification];
    // Signature date in Melbourne from the signature's own timestamp (prestart snapshot kept independently of AP completion).
    const sigDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(signedAt));
    answers["p8.date"] = sigDate;
    const { data: asg } = await admin.from("job_assignments").select("user_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
    if (!asg?.user_id) return { status: "error", message: "No assigned installer to attribute the signed PIISA to." };
    // Stored as the job's current signed official PIISA; the canonical PIISA gate (piisaPanel / stageEntryBlockers)
    // then evaluates Parts 1–8, the 30-day PIESA window, install-day signing and electrician attendance. Never bypassed.
    const { storeSignedCopy, currentCopy, materialFacts } = await import("./official-forms.server");
    const piesa = (await currentCopy(jobId, "piesa")).copy;
    const { facts } = await materialFacts(jobId, piesa);
    const copyId = await storeSignedCopy({ jobId, key: "piisa", answers: answers as never, signer: { userId: asg.user_id, name: direct ? String(answers["p2.lead"] ?? "") : sig.name ?? String(answers["p8.name"] ?? ""), role: "installer" }, enteredDate: sigDate, jobFacts: facts as unknown as Record<string, string>, acknowledgementIds: [], signature: `mitti:${auditId}` });
    const { renderOfficialDocx } = await import("./official-docx.server");
    const r = renderOfficialDocx("piisa", answers as never);
    if (direct && (!r.filled.includes("p7.products") || r.missed.includes("p7.products"))) return { status: "error", message: "Verified actual products could not be placed in the original Part 7. No final declaration saved." };
    const path = `jobs/${jobId}/official/piisa-${auditId}.docx`;
    const up = await admin.storage.from("job-files").upload(path, r.bytes, { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", upsert: false });
    if (up.error && !/exists/i.test(up.error.message)) return { status: "error", message: `Official PIISA document could not be stored: ${up.error.message}` };
    // The Word form keeps its blank signature line; the signature is an explicit linked attachment record next to it.
    const { createHash } = await import("node:crypto");
    const docSha = createHash("sha256").update(r.bytes).digest("hex");
    const base = signatureAttachment(auditId, { ...sig, name: direct ? String(answers["p2.lead"] ?? "") : sig.name, signedAt }, { path, sha256: docSha });
    const att = base && prestart ? { ...base, image_path: prestart.signature_image.image_path, image_sha256: prestart.signature_image.image_sha256, image_content_type: prestart.signature_image.content_type } : null;
    if (!att) return { status: "missing", message: "The PIISA signature image or its time is missing, so it can't be used." };
    const sidecar = `jobs/${jobId}/official/piisa-${auditId}.signature.json`;
    const su = await admin.storage.from("job-files").upload(sidecar, new Blob([JSON.stringify(att)], { type: "application/json" }), { contentType: "application/json", upsert: false });
    if (su.error && !/exists/i.test(su.error.message)) return { status: "error", message: `PIISA signature record could not be stored: ${su.error.message}` };
    // Evidence checklist from the actual audit media metadata; crew resolved against CURRENT verified staff.
    const core = await import("./piisa-a3.core");
    const { a3Ctx } = await import("./piisa-prestart.server");
    const ctx = { ...(await a3Ctx(jobId, audit)), mandatoryCurrentPostwork: finalPostwork, crewCount: coreC.a3CrewChoices(audit).filter((c) => c.kind !== "none").length || 1 };
    const media = core.a3MediaSummary(core.a3MediaFiles(audit));
    const a3_evidence = {
      checklist: core.a3EvidenceChecklist(answers as never, ctx, media),
      prestart_blockers: prestart!.snapshot.blockers,
      prestart_captured_from: prestart!.snapshot.captured_from,
      completion_blockers: core.a3CompletionBlockers(answers as never, ctx, media),
      crew_blockers: crewBlockers,
      native_version: direct ? native.PIISA_DIRECT_VERSION : "a3-published-choice",
      actual_product_answers: actualProducts?.answers ?? null,
    };
    official = { answers: { ...answers, signed_copy_id: copyId }, docx: { path, sha256: r.sha256, missed: r.missed }, signature_attachment: { ...att, record_path: sidecar }, a3_evidence };
    await logEvent(jobId, actorId, "piisa_a3_evidence_synced", "PIISA evidence checklist read from the completed form", a3_evidence as unknown as Record<string, unknown>, { internal: true });
  }
  const d = r.decl;
  const snap = { official, prestart_signed_at: signedAt, source: "mitti_piisa", audit_id: auditId, declaration: { version: tpl.version, body: tpl.body }, installed_product: d.product, installed_r_value: d.rValue, installed_area_m2: d.areaM2, signature: { typed_name: d.signatureName, mitti_signature: d.signature, signed_on: d.signedOn, at: signedAt, user_id: a?.user_id ?? null }, piisa_answers: p.snapshot };
  const hash = await sha256Hex(stableJson(snap));
  const { data: row, error } = await admin.from("installer_declarations").insert({
    job_id: jobId, installer_user_id: a?.user_id ?? null, installer_business_id: a?.business_id ?? null, installer_name: d.signatureName, installer_business_name: b?.name ?? null, installer_abn: b?.abn ?? null, installer_licence: b?.licence_number ?? null,
    template_version: tpl.version, installed_product: d.product, installed_r_value: d.rValue, installed_area_m2: d.areaM2, field_values: { source: "mitti_piisa", audit_id: auditId } as unknown as Json,
    snapshot: snap as unknown as Json, snapshot_sha256: hash, signature_name: d.signatureName, signed_at: signedAt, signed_by: a?.user_id ?? null, ip: null, user_agent: "Mitti PIISA",
  }).select("id").single();
  if (error || !row) return { status: "error", message: error?.message ?? "Could not save the declaration." };
  await admin.from("declarations").upsert({ job_id: jobId, kind: "installer_declaration", declared_by: a?.user_id ?? null, statement: `${tpl.version}: ${tpl.body}`, declared_at: signedAt }, { onConflict: "job_id,kind" });
  await logEvent(jobId, actorId, "INSTALLER_DECLARATION_SIGNED", `Installer declaration signed in the Mitti PIISA (${tpl.version}) – ${d.product}, ${d.areaM2} m²`, { declaration_id: row.id, sha256: hash, audit_id: auditId });
  return { status: "saved", message: "Declaration saved from the Mitti PIISA." };
}

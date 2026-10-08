// The ONLY Mitti network boundary. Callers must already be authorised (see portal.functions.ts).
// Token is read per call, never logged or returned. Sync populates assessment / measure-up data only —
// never completes a requirement, approves compliance, moves stages or issues quotes.
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { MITTI_BASE_URL, MITTI_TEMPLATE_ID, MittiError, builtLast5YearsOption, createOrReuseAudit, mittiApi, planSync, propertyTypeOption, splitPatch, type MittiCall } from "./mitti.core";
import { planMeasurementUpdate, type MeasurementLike } from "./scope.core";
import { jobScope } from "./requirements.server";
import { readyCheckVariant } from "./mitti-forms.core";
import { officialFormUseBlocker, evaluatePiesa } from "./official-forms.core";
import { shortAnswersFromEntries } from "./official-short.core";
import { expandPiesa } from "./official-expand.core";
import { formatPropertyAddress } from "./address";
import { todayMelbourne } from "./eligibility.server";
import { officialPrefillContext } from "./official-forms.server";
import { draftInstallerQuoteFromReadyCheck } from "./installer-quote.server";
import { applyCobrand } from "./pilot.server";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export const realMittiCall: MittiCall = async (method, path, body) => {
  const token = process.env["MITTI_API_TOKEN"];
  if (!token) throw new MittiError("Mitti is not configured. Add the MITTI_API_TOKEN secret.");
  let res: Response;
  try {
    res = await fetch(`${MITTI_BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new MittiError("Mitti could not be reached. Try again shortly.");
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).replace(/[\w.+-]+@[\w.-]+/g, "[email]").slice(0, 300);
    console.error(`[mitti] ${method} ${path.split("/")[1]} -> ${res.status} ${detail}`); // no token, no PII
    throw new MittiError(
      res.status === 401 || res.status === 403 ? "Mitti rejected the API token."
      : res.status === 404 ? "Mitti record not found."
      : res.status === 400 ? "Mitti rejected the request (400) – check the assigned user's email is a real address registered in your Mitti account."
      : `Mitti request failed (${res.status}).`);
  }
  const t = await res.text();
  return t ? JSON.parse(t) : {};
};

/** Binary media download (supported audit media route). Used only to store the PIISA signature image itself. */
export type MittiMediaFetch = (auditId: string, mediaId: string) => Promise<{ bytes: Uint8Array; contentType: string }>;
export const realMittiMedia: MittiMediaFetch = async (auditId, mediaId) => {
  const token = process.env["MITTI_API_TOKEN"];
  if (!token) throw new MittiError("Mitti is not configured. Add the MITTI_API_TOKEN secret.");
  const res = await fetch(`${MITTI_BASE_URL}/audits/${encodeURIComponent(auditId)}/media/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res || !res.ok) throw new MittiError(`Mitti signature image could not be downloaded (${res?.status ?? "network"}).`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!/^image\//.test(contentType)) throw new MittiError("Mitti returned something that is not an image for the signature.");
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType };
};

const wrap = (e: unknown) => (e instanceof MittiError ? new WorkflowError(e.message) : e);

export const MEASUREUP_TEMPLATE_MISSING = "Measure-up-only Mitti template is not configured. An admin must add the measure-up template ID in workflow settings before a measure-up-only Mitti audit can be sent.";

export const PIESA_TEMPLATE_MISSING = "PIESA Mitti form is not configured. An admin must add the validated PIESA form ID in workflow settings before a PIESA audit can be sent.";

async function templateIds() {
  const { data } = await admin.from("workflow_settings").select("mitti_ready_check_template_id,mitti_ready_check_priced_template_id,mitti_piesa_template_id").eq("id", 1).maybeSingle();
  return { readyCheck: data?.mitti_ready_check_template_id?.trim() || null, readyCheckPriced: data?.mitti_ready_check_priced_template_id?.trim() || null, piesa: data?.mitti_piesa_template_id?.trim() || null };
}

export const PIESA_BOOKING_MISSING = "The PIESA form can only be created once a PIESA visit is confirmed in the portal.";

/** opts.assignee: hand the Ready Check to this specific approved worker (auto-assign); opts.readyCheck forces the installer Ready Check form. */
export async function createAssignMittiAudit(jobId: string, actorId: string | null, call: MittiCall = realMittiCall, opts: { assignee?: { userId: string; fullName: string | null; email: string }; readyCheck?: boolean } = {}) {
  const { data: job } = await admin.from("jobs").select("id,job_number,business_unit,stage,estimated_area_m2,life_support,life_support_status,property_id,owner_id,channel").eq("id", jobId).single();
  if (!job) throw new WorkflowError("Job not found.");
  const scope = await jobScope(jobId);
  if (scope.scope === "COMPLETE") throw new WorkflowError("Both site requirements are already complete – no Mitti audit needed.");
  // The Ready Check comes before any PIESA, so in Ready Check stages the installer form is sent even though no PIESA exists yet.
  const readyCheckStage = job.stage === "ready_check_ready_to_schedule" || job.stage === "ready_check_scheduled";
  const measureOnly = !!opts.readyCheck || readyCheckStage || scope.scope === "MEASURE_UP_ONLY";
  const role = measureOnly ? "installer" : "electrician";
  // Role-specific forms only; the old combined template is never used for new audits.
  // Ready Check variant: installer-sourced jobs get the priced form (A1), our leads the evidence-only form (A2).
  const ids = await templateIds();
  const templateId = measureOnly ? (readyCheckVariant(job.channel) === "ready_check_priced" ? ids.readyCheckPriced : ids.readyCheck) : ids.piesa;
  if (!templateId) throw new WorkflowError(measureOnly ? MEASUREUP_TEMPLATE_MISSING : PIESA_TEMPLATE_MISSING);
  // Official PIESA stays blocked from live use until its mapping is approved and its source confirmed.
  if (!measureOnly) { const b = officialFormUseBlocker("piesa"); if (b) throw new WorkflowError(b); }

  const [{ data: prop }, { data: owner }, { data: asgRow }, { data: booking }, { data: a }] = await Promise.all([
    admin.from("properties").select("address_line,suburb,state,postcode,occupancy,enrichment").eq("id", job.property_id).single(),
    admin.from("owners").select("full_name,email,phone").eq("id", job.owner_id).single(),
    admin.from("job_assignments").select("user_id, profiles:user_id(full_name,email)").eq("job_id", jobId).eq("role", role).eq("active", true).maybeSingle(),
    admin.from("bookings").select("scheduled_start,status").eq("job_id", jobId).eq("kind", "assessment").eq("status", "confirmed").order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
    admin.from("assessments").select("id,status,external_mitti_id").eq("job_id", jobId).maybeSingle(),
  ]);
  if (!measureOnly && a?.status === "complete") throw new WorkflowError("Electrical assessment is already complete and locked.");
  // Gap 1: no PIESA form until the PIESA visit is confirmed in the portal.
  if (!measureOnly && !booking) throw new WorkflowError(PIESA_BOOKING_MISSING);
  const asg = opts.assignee ? { user_id: opts.assignee.userId, profiles: { full_name: opts.assignee.fullName, email: opts.assignee.email } } : asgRow;
  if (!asg) throw new WorkflowError(`Assign an ${role} before creating the Mitti assessment.`);
  const m = scope.measurementRow;
  const existingAuditId = measureOnly ? (m?.external_source === "mitti" && m.status !== "complete" ? m.external_id : null) : a?.external_mitti_id ?? null;
  const prof = (asg as unknown as { profiles: { full_name: string | null; email: string | null } | null }).profiles;
  const address = formatPropertyAddress(prop);
  let r;
  try {
    r = await createOrReuseAudit(mittiApi(call), {
      businessUnit: job.business_unit, stage: job.stage, jobNumber: job.job_number, existingAuditId,
      electricianEmail: prof?.email ?? null, templateId, assigneeRole: role,
      prefill: {
        jobNumber: job.job_number, address, ownerName: owner?.full_name ?? "", ownerEmail: owner?.email ?? null, ownerPhone: owner?.phone ?? null,
        assessorName: prof?.full_name || prof?.email || "", assessmentAt: booking?.scheduled_start ?? null,
        estimatedAreaM2: job.estimated_area_m2 != null ? Number(job.estimated_area_m2) : null,
        occupancy: prop?.occupancy ? prop.occupancy.replace("_", " ") : null, lifeSupport: job.life_support ? "Yes – life support recorded" : "None recorded by office",
        inspectionDate: measureOnly ? null : todayMelbourne(),
        lifeSupportDeclared: measureOnly ? null : job.life_support_status === "yes" ? "Yes" : job.life_support_status === "no" ? "No" : null,
        builtLast5Years: measureOnly ? builtLast5YearsOption((prop?.enrichment as Any)?.base44?.declared?.over_five_years ?? null) : null,
        propertyType: propertyTypeOption((prop?.enrichment as Any)?.base44?.declared?.property_type ?? null),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Mitti error";
    if (!measureOnly) {
      if (a) await admin.from("assessments").update({ mitti_last_error: msg }).eq("id", a.id);
      else await admin.from("assessments").insert({ job_id: jobId, assessor_id: asg.user_id, mitti_last_error: msg, mitti_sync_status: "error", mitti_scope: scope.scope });
    }
    throw wrap(e);
  }
  const now = new Date().toISOString();
  if (measureOnly) {
    if (!r.reused) {
      if (m && m.status !== "complete") await admin.from("ceiling_measurements").update({ external_source: "mitti", external_id: r.auditId }).eq("id", m.id);
      else await admin.from("ceiling_measurements").insert({ job_id: jobId, status: "draft", is_current: true, source_role: "installer", created_by: actorId, external_source: "mitti", external_id: r.auditId });
    }
  } else {
    const fields = {
      external_mitti_id: r.auditId, mitti_template_id: templateId, mitti_assignee_email: r.assigneeEmail, mitti_assignee_user_id: r.mittiUserId,
      mitti_last_error: null, mitti_sync_status: "pending" as const, mitti_scope: scope.scope,
      ...(r.reused ? {} : { mitti_created_at: r.createdAt ?? now, mitti_prefill_count: r.prefillCount }),
    };
    if (a) await admin.from("assessments").update(fields).eq("id", a.id);
    else await admin.from("assessments").insert({ ...fields, job_id: jobId, assessor_id: asg.user_id });
  }
  await logEvent(jobId, actorId, r.reused ? "mitti_audit_reshared" : "mitti_audit_created",
    r.reused ? `Mitti ${measureOnly ? "measure-up" : "assessment"} re-shared with ${r.assigneeEmail}` : `Mitti ${measureOnly ? "measure-up" : "assessment"} created and assigned to ${r.assigneeEmail} (${scope.label})`,
    { audit_id: r.auditId, template_id: templateId, prefill_count: r.prefillCount, scope: scope.scope });
  return { auditId: r.auditId, reused: r.reused, scope: scope.scope };
}

/** Apply measure-up values from Mitti through the central plan (never overwrites an accepted measurement). */
async function applyMeasure(jobId: string, actorId: string | null, auditId: string, source: "electrician" | "installer", values: Record<string, unknown>, snapshot: unknown) {
  const s = await jobScope(jobId);
  const plan = planMeasurementUpdate({ scope: s.scope, current: s.measurementRow as MeasurementLike | null, incoming: values, source, external: { source: "mitti", id: auditId } });
  if (plan.action === "create")
    await admin.from("ceiling_measurements").insert({ ...plan.values, job_id: jobId, status: "draft", is_current: true, source_role: plan.source, created_by: actorId, external_source: "mitti", external_id: auditId, raw_snapshot: snapshot as Json });
  else if (plan.action === "update") {
    const cur = s.measurementRow!;
    await admin.from("ceiling_measurements").update({
      ...plan.values, raw_snapshot: snapshot as Json,
      ...(plan.supplemented.length ? { supplemented_by: actorId, supplemented_at: new Date().toISOString(), supplemented_fields: [...new Set([...((cur.supplemented_fields as string[]) ?? []), ...plan.supplemented])] as unknown as Json } : {}),
    }).eq("id", plan.id).neq("status", "complete");
  }
  return plan;
}

/** Save Mitti's finished PDF report to the job's private files, once per completed audit version. Never throws. */
async function saveMittiReport(jobId: string, actorId: string | null, auditId: string, modifiedAt: string | null, label: string, call: MittiCall) {
  const key = `${auditId}:${modifiedAt ?? "completed"}`;
  try {
    const { data: ex } = await admin.from("documents").select("id").eq("job_id", jobId).eq("source_system", "mitti").eq("external_id", key).maybeSingle();
    if (ex) return;
    const api = mittiApi(call);
    const req = await api.requestReport(auditId);
    let url: string | null = null;
    for (let i = 0; i < 6 && !url; i++) {
      const r = await api.getReport(auditId, String(req?.messageId ?? ""));
      if (typeof r?.url === "string" && r.url.startsWith("https://")) url = r.url;
      else await new Promise((res) => setTimeout(res, 2000));
    }
    if (!url) throw new Error("report not ready");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const buf = await res.arrayBuffer();
    const stamp = (modifiedAt ?? new Date().toISOString()).replace(/[^0-9]/g, "").slice(0, 14);
    const path = `${jobId}/mitti/${auditId}-${stamp}.pdf`;
    const up = await admin.storage.from("job-files").upload(path, buf, { contentType: "application/pdf", upsert: false });
    if (up.error) throw new Error("storage upload failed");
    await admin.from("documents").insert({ job_id: jobId, kind: "mitti_report", title: `Mitti ${label} report`, storage_path: path, mime_type: "application/pdf", uploaded_by: actorId, source_system: "mitti", external_id: key, original_name: `${label}.pdf`, size_bytes: buf.byteLength });
    await logEvent(jobId, actorId, "mitti_report_saved", `Mitti ${label} report saved to job files`, { audit_id: auditId, path });
  } catch (e) {
    await logEvent(jobId, actorId, "mitti_report_failed", `Mitti ${label} report could not be saved – sync again to retry`, { audit_id: auditId, reason: e instanceof Error ? e.message : "error" });
  }
}

/** Sync the STORED audit(s) only. Never completes a requirement. */
export async function syncMittiAssessment(jobId: string, actorId: string | null, call: MittiCall = realMittiCall) {
  const { data: job } = await admin.from("jobs").select("job_number,business_unit,channel").eq("id", jobId).single();
  if (!job) throw new WorkflowError("Job not found.");
  if (job.business_unit !== "hivic") throw new WorkflowError("Mitti automation is only available for Home Insulation Victoria jobs.");
  const { data: a } = await admin.from("assessments").select("id,status,external_mitti_id,mitti_template_id").eq("job_id", jobId).maybeSingle();
  const s = await jobScope(jobId);
  const m = s.measurementRow;
  const measureAudit = m?.external_source === "mitti" && m.external_id && m.external_id !== a?.external_mitti_id && m.status !== "complete" ? m.external_id : null;
  if (!a?.external_mitti_id && !measureAudit) throw new WorkflowError("No Mitti assessment has been created for this job.");
  const api = mittiApi(call);
  let issues: string[] = [];
  let completed = false;
  let locked = false;

  if (a?.external_mitti_id) {
    if (a.status === "complete") locked = true;
    else {
      let plan;
      try {
        plan = planSync(await api.getAudit(a.external_mitti_id), { storedAuditId: a.external_mitti_id, jobNumber: job.job_number, assessmentStatus: a.status, templateId: a.mitti_template_id ?? MITTI_TEMPLATE_ID });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Mitti error";
        await admin.from("assessments").update({ mitti_last_error: msg, ...(e instanceof MittiError && /match|template|different/.test(msg) ? { mitti_sync_status: "error" as const } : {}) }).eq("id", a.id);
        throw wrap(e);
      }
      if (plan.locked) locked = true;
      else {
        const { electrical } = splitPatch(plan.patch);
        const now = new Date().toISOString();
        await admin.from("assessments").update({
          ...electrical, mitti_sync_status: plan.syncStatus, mitti_completed: plan.completed, mitti_modified_at: plan.modifiedAt,
          mitti_raw_snapshot: plan.snapshot as unknown as Json, mitti_validation_issues: plan.issues as unknown as Json, mitti_last_error: null,
          ...(plan.completed ? { mitti_synced_at: now } : {}),
        }).eq("id", a.id).neq("status", "complete");
        // Printed PIESA rules, checked server-side on every sync (blockers stay as review issues; nothing is completed here).
        // The Mitti form is the short onsite version: answers are expanded into the official items first.
        const prefillCtx = await officialPrefillContext(jobId, todayMelbourne(), null);
        const expanded = expandPiesa(shortAnswersFromEntries("piesa", (plan.snapshot ?? []) as { label: string; value: string | null }[]), { lifeSupportDeclared: prefillCtx.lifeSupportDeclared, today: todayMelbourne() });
        const ev = evaluatePiesa(expanded.answers);
        issues = [...plan.issues, ...expanded.flagged.map((f) => `Official form: ${f}`), ...ev.blockers.map((b) => `Official form: ${b.message}${b.confirmation ? ` [${b.confirmation}]` : ""}`)];
        completed = plan.completed;
        for (const o of plan.others) {
          const { data: ex } = await admin.from("rectification_items").select("id,status").eq("job_id", jobId).eq("external_key", o.external_key).maybeSingle();
          const base = { description: o.description, quantity: o.quantity, explanation: o.explanation };
          if (ex) {
            if (ex.status === "removed") continue; // office decision wins
            await admin.from("rectification_items").update({ ...base, ...(o.unit_price_inc_gst != null ? { other_unit_price_inc_gst: o.unit_price_inc_gst, needs_office_pricing: false } : {}) }).eq("id", ex.id);
          } else {
            await admin.from("rectification_items").insert({ ...base, job_id: jobId, assessment_id: a.id, is_other: true, source: "mitti", external_key: o.external_key, other_unit_price_inc_gst: o.unit_price_inc_gst, needs_office_pricing: o.needs_office_pricing, added_by: actorId });
          }
        }
        if (plan.completed) await saveMittiReport(jobId, actorId, a.external_mitti_id, plan.modifiedAt ?? null, "PIESA", call);
        await logEvent(jobId, actorId, "mitti_synced", plan.completed ? "Mitti assessment synced (completed in Mitti)" : "Mitti partial data synced (audit not yet completed)",
          { audit_id: a.external_mitti_id, electrical_fields: Object.keys(electrical), measurement: "not_imported_from_piesa", measurement_fields: [], issues, other_items: plan.others.length });
      }
    }
  }

  if (measureAudit) {
    const ids = await templateIds();
    const tid = readyCheckVariant(job.channel) === "ready_check_priced" ? ids.readyCheckPriced : ids.readyCheck;
    if (!tid) throw new WorkflowError(MEASUREUP_TEMPLATE_MISSING);
    let plan;
    try {
      plan = planSync(await api.getAudit(measureAudit), { storedAuditId: measureAudit, jobNumber: job.job_number, assessmentStatus: null, templateId: tid });
    } catch (e) { throw wrap(e); }
    if (!plan.locked) {
      const mp = await applyMeasure(jobId, actorId, measureAudit, "installer", splitPatch(plan.patch).measure, plan.snapshot);
      const mIssues = plan.issues.filter((i) => !/PIESA|Switchboard/.test(i));
      issues = [...issues, ...mIssues, ...(mp.action === "skip" ? [mp.reason] : [])];
      completed = completed || plan.completed;
      if (plan.completed) await saveMittiReport(jobId, actorId, measureAudit, plan.modifiedAt ?? null, "Ready Check", call);
      // Installer-brought jobs: draft (never send) the co-branded owner quote from the installer's ticked price.
      if (plan.completed && readyCheckVariant(job.channel) === "ready_check_priced") {
        try {
          const d = await draftInstallerQuoteFromReadyCheck(jobId, actorId, (plan.snapshot ?? []) as { label: string; value: string | null }[], measureAudit);
          if (d && !d.ready) issues = [...issues, ...d.blockers.map((b) => `Owner quote: ${b}`)];
          if (d?.ready) await applyCobrand(jobId);
        } catch (e) { issues = [...issues, `Owner quote could not be drafted: ${e instanceof Error ? e.message : "error"}`]; }
      }
      await logEvent(jobId, actorId, "mitti_measureup_synced", plan.completed ? "Mitti measure-up synced (completed in Mitti)" : "Mitti measure-up partial data synced", { audit_id: measureAudit, measurement: mp.action, issues: mIssues });
    }
  }
  return { locked, completed, issues };
}

export async function syncPendingMitti(actorId: string | null, call: MittiCall = realMittiCall) {
  const [{ data: as }, { data: ms }] = await Promise.all([
    admin.from("assessments").select("job_id,jobs!inner(business_unit)").not("external_mitti_id", "is", null).neq("status", "complete").eq("jobs.business_unit", "hivic"),
    admin.from("ceiling_measurements").select("job_id,jobs!inner(business_unit)").eq("external_source", "mitti").eq("is_current", true).neq("status", "complete").eq("jobs.business_unit", "hivic"),
  ]);
  const ids = [...new Set([...(as ?? []), ...(ms ?? [])].map((r) => r.job_id))];
  const results: { jobId: string; ok: boolean; message: string }[] = [];
  for (const jobId of ids) {
    try {
      const r = await syncMittiAssessment(jobId, actorId, call);
      results.push({ jobId, ok: true, message: r.completed ? "synced" : "pending" });
    } catch (e) {
      results.push({ jobId, ok: false, message: e instanceof Error ? e.message : "error" });
    }
  }
  // Installer declarations signed inside the Mitti PIISA.
  const { data: pe } = await admin.from("workflow_events").select("job_id").eq("event_type", "mitti_piisa_audit_created");
  const { syncPiisaDeclaration } = await import("./piisa-declaration.server");
  for (const jobId of [...new Set((pe ?? []).map((e) => e.job_id as string))]) {
    try { const r = await syncPiisaDeclaration(jobId, actorId, call); if (r.status !== "already") results.push({ jobId, ok: r.status === "saved" || r.status === "pending", message: r.message }); }
    catch (e) { results.push({ jobId, ok: false, message: e instanceof Error ? e.message : "error" }); }
  }
  return results;
}

/** Sends the official PIISA to the assigned installer in Mitti with the LR-003 pre-fills (Installation Booked only).
 * Fails closed while the PIISA is locked or its Mitti form isn't configured. Reminders stay in the portal. */
export async function createPiisaMittiAudit(jobId: string, actorId: string, call: MittiCall = realMittiCall) {
  const { buildOfficialPrefill, missingKnownFields, PIISA_A3_TEMPLATE_ID } = await import("./mitti.core");
  const a3 = await import("./piisa-a3.core");
  const { OFFICIAL_ITEMS } = await import("./official-forms.core");
  const { piisaPrefill } = await import("./official-prefill.core");
  const { officialPrefillContext } = await import("./official-forms.server");
  const block = officialFormUseBlocker("piisa");
  if (block) throw new WorkflowError(block);
  const { data: ws } = await admin.from("workflow_settings").select("mitti_piisa_template_id").eq("id", 1).maybeSingle();
  const MITTI_PIISA_TEMPLATE_ID = ws?.mitti_piisa_template_id?.trim() ?? "";
  if (!MITTI_PIISA_TEMPLATE_ID) throw new WorkflowError("PIISA Mitti form is not configured. Add the validated PIISA form before it can be sent.");
  const { data: job } = await admin.from("jobs").select("job_number,business_unit,stage").eq("id", jobId).single();
  if (!job) throw new WorkflowError("Job not found.");
  if (job.business_unit !== "hivic") throw new WorkflowError("Mitti automation is only available for Home Insulation Victoria jobs.");
  if (job.stage !== "installation_booked") throw new WorkflowError("The installer safety form can only be sent once the installation is booked.");
  { const { requirePrestartClear } = await import("./prestart.server"); await requirePrestartClear(jobId); }
  // One PIISA per job, only after this same job's Ready Check is completed.
  { const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("to_stage", "ready_check_complete");
    if (!count) throw new WorkflowError("Complete this job's Ready Check before the installer safety form (PIISA) is sent."); }
  const { data: asg } = await admin.from("job_assignments").select("user_id, profiles:user_id(email)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  const email = (asg as unknown as { profiles: { email: string | null } | null } | null)?.profiles?.email?.trim();
  if (!asg || !email) throw new WorkflowError("Assign an installer with an email address before sending the safety form.");
  const { data: prev } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_piisa_audit_created").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const api = mittiApi(call);
  const users = (await api.searchUsers(email)) as { users?: { id?: string; user_id?: string; email?: string }[] } | { id?: string; user_id?: string; email?: string }[];
  const list = Array.isArray(users) ? users : users?.users ?? [];
  const u = list.find((x) => String(x.email ?? "").toLowerCase() === email.toLowerCase());
  const userId = u?.id ?? u?.user_id;
  if (!userId) throw new WorkflowError(`The assigned installer (${email}) was not found in Mitti. Invite them with that exact email, then retry.`);
  const prevId = (prev?.details as { audit_id?: string } | null)?.audit_id;
  if (prevId) {
    const previous = await api.getAudit(prevId);
    const parsed = (await import("./mitti.core")).parseAudit(previous);
    if (parsed.templateId !== MITTI_PIISA_TEMPLATE_ID || parsed.jobNumber?.trim() !== job.job_number.trim()) throw new WorkflowError("Stored PIISA does not match this job/template; office review is required.");
    const { ensurePiisaAp } = await import("./piisa-ap.core");
    await ensurePiisaAp(previous, (items) => api.updateAuditText(prevId, items), () => api.getAudit(prevId));
    await api.shareAudit(prevId, String(userId)); await api.setAuditOwner(prevId, String(userId));
    await logEvent(jobId, actorId, "mitti_piisa_audit_reshared", `Installer safety form re-shared with ${email}`, { audit_id: prevId });
    return { auditId: prevId, reused: true, skipped: [] as string[] };
  }
  const hints = piisaPrefill(await officialPrefillContext(jobId, todayMelbourne(), asg.user_id));
  const items = OFFICIAL_ITEMS.piisa;
  const isA3 = MITTI_PIISA_TEMPLATE_ID === PIISA_A3_TEMPLATE_ID;
  type Pre = { itemId: string; label: string; kind: string; value: string; occurrence: number; row: number };
  const toPre = (itemId: string, value: string, row = 0): Pre => {
    const it = items.find((i) => i.id === itemId);
    if (!it) throw new WorkflowError(`Unknown official prefill field: ${itemId}`);
    const occurrence = isA3 ? a3.a3Occurrence(itemId, row) : items.filter((i) => i.label === it.label && items.indexOf(i) < items.indexOf(it)).length + row;
    return { itemId, label: it.label, kind: it.kind, value, occurrence, row };
  };
  const preMap = new Map<string, Pre>();
  for (const h of hints) if (h.mode === "prefill" && h.value != null) preMap.set(`${h.itemId}#0`, toPre(h.itemId, h.value));
  const prefillNotes: string[] = [];
  if (isA3) {
    // Verified crew chosen in the portal (native form has no live staff lookup), then same-job Ready Check facts.
    const { loadCrew, readyCheckAreas } = await import("./piisa-a3.server");
    const { staff, selection } = await loadCrew(jobId);
    if (!selection) throw new WorkflowError("Choose the install crew (lead installer and any additional installers) before sending the safety form.");
    const cp = a3.crewSelectionProblems(selection, staff);
    if (cp.problems.length) throw new WorkflowError(cp.problems.join(" • "));
    if (cp.needsVerification.length) throw new WorkflowError(`Verify before work: ${cp.needsVerification.join("; ")}`);
    // Crew goes to the native single-choice list (real option ids / Other branch), never as plain text.
    for (const k of [...preMap.keys()]) if (/^p2\.(lead|leadEec|addName|addEec)#/.test(k)) preMap.delete(k);
    for (const c of a3.crewPrefill(selection, staff)) if (c.itemId === "p8.name") preMap.set("p8.name#0", toPre("p8.name", c.value));
    const rc = a3.readyCheckPartPrefill(await readyCheckAreas(jobId));
    for (const [id, v] of Object.entries(rc.values)) if (!preMap.has(`${id}#0`)) preMap.set(`${id}#0`, toPre(id, v));
    prefillNotes.push(...rc.notes);
    for (const id of a3.A3_NOT_ON_NATIVE) preMap.delete(`${id}#0`);
  }
  const template = await api.getTemplateDefinition(MITTI_PIISA_TEMPLATE_ID);
  const native = await import("./piisa-native-version.core");
  const resolved = isA3 ? native.resolvePiisaNativeVersion(template) : null;
  if (resolved && (!resolved.active || !resolved.mapping)) throw new WorkflowError(`The PIISA mapping needs review: ${resolved.problems.join("; ")}`);
  const direct = resolved?.version === native.PIISA_DIRECT_VERSION;
  if (direct) for (const key of [...preMap.keys()]) if (/^(p7\.products|completionDate|p8\.name|p8\.date|p2\.lead|p2\.leadEec|p2\.addName|p2\.addEec)#/.test(key)) preMap.delete(key);
  const pre = [...preMap.values()];
  const p = buildOfficialPrefill(template, pre, resolved?.mapping ?? {});
  const ap = await import("./piisa-ap.core");
  if (isA3) {
    const apPayload = [...p.header_items, ...p.items].find((item) => item.item_id === ap.PIISA_AP_ID);
    if (!apPayload || JSON.stringify(apPayload.responses) !== JSON.stringify(ap.piisaApItem().responses)) throw new WorkflowError("Authoritative Accredited Person prefill is missing; form was not created.");
  }
  if (isA3) {
    const { loadCrew, assignedInstallerBusiness } = await import("./piisa-a3.server");
    const { staff, selection } = await loadCrew(jobId);
    const { data: biz } = await admin.from("businesses").select("name").eq("id", await assignedInstallerBusiness(jobId)).maybeSingle();
    const bname = biz?.name ?? "";
    if (!selection) throw new WorkflowError("Choose the install crew before sending the safety form.");
    const prepared = direct ? native.stagedDirectCrewPrefill(selection, staff) : null;
    const crew = prepared ? { items: prepared.items, problems: [...prepared.problems, ...prepared.needsVerification], notes: [] as string[] } : a3.a3CrewNativeItems(template, selection, staff, bname);
    if (crew.problems.length) throw new WorkflowError(`Crew could not be filled in on the Mitti form: ${crew.problems.join("; ")}`);
    p.items.push(...crew.items); p.count += crew.items.length;
    prefillNotes.push(...crew.notes);
    const roster = direct ? { alert: null, missingOptions: [], staleOptions: [] } : a3.a3RosterStatus(template, staff, bname);
    if (roster.alert) { prefillNotes.push(roster.alert); await logEvent(jobId, actorId, "mitti_crew_shared_names", roster.alert, { missing: roster.missingOptions, stale_count: roster.staleOptions.length }, { internal: true }); }
  }
  for (const s of p.skipped) if (/single choice on the Mitti form/.test(s)) prefillNotes.push(`Removed and topped up are both recorded, but Mitti's question takes one answer — the installer chooses on site.`);
  const missing = missingKnownFields(p.skipped);
  if (missing.length) throw new WorkflowError(`The Mitti PIISA form is missing known fields, so it was not created: ${missing.join("; ")}`);
  // Validate returned prefill: every value we sent must be on the payload, at its own field.
  { const sent = new Set([...p.header_items, ...p.items].map((x: { item_id: string }) => x.item_id)); if (sent.size !== p.count) throw new WorkflowError("Two pre-fills resolved to the same Mitti field — not created."); }
  const audit = (await api.createAudit({ template_id: MITTI_PIISA_TEMPLATE_ID, header_items: p.header_items, items: p.items })) as { audit_id?: string; id?: string };
  const auditId = audit?.audit_id ?? audit?.id;
  if (!auditId) throw new WorkflowError("Mitti did not return an audit ID.");
  // Store identity before readback so a failed response check cannot cause duplicate creation on retry.
  await logEvent(jobId, actorId, "mitti_piisa_audit_created", "PIISA created; prefill verification pending", { audit_id: String(auditId), template: MITTI_PIISA_TEMPLATE_ID, native_version: resolved?.version ?? null });
  if (isA3) ap.assertPiisaAp(await api.getAudit(String(auditId)));
  await api.shareAudit(String(auditId), String(userId)); await api.setAuditOwner(String(auditId), String(userId));
  await logEvent(jobId, actorId, "mitti_piisa_audit_created", `Installer safety form sent to ${email} with ${p.count} pre-filled answers`, { audit_id: String(auditId), prefill_count: p.count, skipped: p.skipped, template: MITTI_PIISA_TEMPLATE_ID, prefill_notes: prefillNotes, native_version: resolved?.version ?? null });
  return { auditId: String(auditId), reused: false, skipped: p.skipped };
}

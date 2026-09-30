// The ONLY Mitti network boundary. Callers must already be authorised (see portal.functions.ts).
// Token is read per call, never logged or returned. Sync populates assessment / measure-up data only —
// never completes a requirement, approves compliance, moves stages or issues quotes.
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { MITTI_BASE_URL, MITTI_TEMPLATE_ID, MittiError, createOrReuseAudit, mittiApi, planSync, splitPatch, type MittiCall } from "./mitti.core";
import { planMeasurementUpdate, type MeasurementLike } from "./scope.core";
import { jobScope } from "./requirements.server";
import { formatPropertyAddress } from "./address";

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

const wrap = (e: unknown) => (e instanceof MittiError ? new WorkflowError(e.message) : e);

export const MEASUREUP_TEMPLATE_MISSING = "Measure-up-only Mitti template is not configured. An admin must add the measure-up template ID in workflow settings before a measure-up-only Mitti audit can be sent.";

export const PIESA_TEMPLATE_MISSING = "PIESA Mitti form is not configured. An admin must add the validated PIESA form ID in workflow settings before a PIESA audit can be sent.";

async function templateIds() {
  const { data } = await admin.from("workflow_settings").select("mitti_ready_check_template_id,mitti_piesa_template_id").eq("id", 1).maybeSingle();
  return { readyCheck: data?.mitti_ready_check_template_id?.trim() || null, piesa: data?.mitti_piesa_template_id?.trim() || null };
}

export async function createAssignMittiAudit(jobId: string, actorId: string, call: MittiCall = realMittiCall) {
  const { data: job } = await admin.from("jobs").select("id,job_number,business_unit,stage,estimated_area_m2,life_support,property_id,owner_id").eq("id", jobId).single();
  if (!job) throw new WorkflowError("Job not found.");
  const scope = await jobScope(jobId);
  if (scope.scope === "COMPLETE") throw new WorkflowError("Both site requirements are already complete – no Mitti audit needed.");
  const measureOnly = scope.scope === "MEASURE_UP_ONLY";
  const role = measureOnly ? "installer" : "electrician";
  // Role-specific forms only; the old combined template is never used for new audits.
  const ids = await templateIds();
  const templateId = measureOnly ? ids.readyCheck : ids.piesa;
  if (!templateId) throw new WorkflowError(measureOnly ? MEASUREUP_TEMPLATE_MISSING : PIESA_TEMPLATE_MISSING);

  const [{ data: prop }, { data: owner }, { data: asg }, { data: booking }, { data: a }] = await Promise.all([
    admin.from("properties").select("address_line,suburb,state,postcode,occupancy").eq("id", job.property_id).single(),
    admin.from("owners").select("full_name,email,phone").eq("id", job.owner_id).single(),
    admin.from("job_assignments").select("user_id, profiles:user_id(full_name,email)").eq("job_id", jobId).eq("role", role).eq("active", true).maybeSingle(),
    admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "assessment").neq("status", "cancelled").order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
    admin.from("assessments").select("id,status,external_mitti_id").eq("job_id", jobId).maybeSingle(),
  ]);
  if (!measureOnly && a?.status === "complete") throw new WorkflowError("Electrical assessment is already complete and locked.");
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
async function applyMeasure(jobId: string, actorId: string, auditId: string, source: "electrician" | "installer", values: Record<string, unknown>, snapshot: unknown) {
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

/** Sync the STORED audit(s) only. Never completes a requirement. */
export async function syncMittiAssessment(jobId: string, actorId: string, call: MittiCall = realMittiCall) {
  const { data: job } = await admin.from("jobs").select("job_number,business_unit").eq("id", jobId).single();
  if (!job) throw new WorkflowError("Job not found.");
  if (job.business_unit !== "hivic") throw new WorkflowError("Mitti automation is only available for HI VIC jobs.");
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
        issues = [...plan.issues];
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
        await logEvent(jobId, actorId, "mitti_synced", plan.completed ? "Mitti assessment synced (completed in Mitti)" : "Mitti partial data synced (audit not yet completed)",
          { audit_id: a.external_mitti_id, electrical_fields: Object.keys(electrical), measurement: "not_imported_from_piesa", measurement_fields: [], issues, other_items: plan.others.length });
      }
    }
  }

  if (measureAudit) {
    const tid = await measureUpTemplateId();
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
      await logEvent(jobId, actorId, "mitti_measureup_synced", plan.completed ? "Mitti measure-up synced (completed in Mitti)" : "Mitti measure-up partial data synced", { audit_id: measureAudit, measurement: mp.action, issues: mIssues });
    }
  }
  return { locked, completed, issues };
}

export async function syncPendingMitti(actorId: string, call: MittiCall = realMittiCall) {
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
  return results;
}

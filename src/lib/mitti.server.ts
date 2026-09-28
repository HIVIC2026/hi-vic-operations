// The ONLY Mitti network boundary. Callers must already be authorised (see portal.functions.ts).
// Token is read per call, never logged or returned. Sync populates assessment data only.
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { MITTI_BASE_URL, MITTI_TEMPLATE_ID, MittiError, createOrReuseAudit, mittiApi, planSync, type MittiCall } from "./mitti.core";

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
    console.error(`[mitti] ${method} ${path.split("/")[1]} -> ${res.status}`); // no token, no PII
    throw new MittiError(res.status === 401 || res.status === 403 ? "Mitti rejected the API token." : res.status === 404 ? "Mitti record not found." : `Mitti request failed (${res.status}).`);
  }
  const t = await res.text();
  return t ? JSON.parse(t) : {};
};

const wrap = (e: unknown) => (e instanceof MittiError ? new WorkflowError(e.message) : e);

export async function createAssignMittiAudit(jobId: string, actorId: string, call: MittiCall = realMittiCall) {
  const { data: job } = await admin.from("jobs").select("id,job_number,business_unit,stage,estimated_area_m2,life_support,property_id,owner_id").eq("id", jobId).single();
  if (!job) throw new WorkflowError("Job not found.");
  const [{ data: prop }, { data: owner }, { data: asg }, { data: booking }, { data: a }] = await Promise.all([
    admin.from("properties").select("address_line,suburb,postcode,occupancy").eq("id", job.property_id).single(),
    admin.from("owners").select("full_name,email,phone").eq("id", job.owner_id).single(),
    admin.from("job_assignments").select("user_id, profiles:user_id(full_name,email)").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle(),
    admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "assessment").neq("status", "cancelled").order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
    admin.from("assessments").select("id,status,external_mitti_id").eq("job_id", jobId).maybeSingle(),
  ]);
  if (a?.status === "complete") throw new WorkflowError("Assessment is already complete and locked.");
  if (!asg) throw new WorkflowError("Assign an electrician before creating the Mitti assessment.");
  const prof = (asg as unknown as { profiles: { full_name: string | null; email: string | null } | null }).profiles;
  const address = [prop?.address_line, prop?.suburb, prop?.postcode].filter(Boolean).join(", ");
  let r;
  try {
    r = await createOrReuseAudit(mittiApi(call), {
      businessUnit: job.business_unit, stage: job.stage, jobNumber: job.job_number, existingAuditId: a?.external_mitti_id ?? null,
      electricianEmail: prof?.email ?? null,
      prefill: {
        jobNumber: job.job_number, address, ownerName: owner?.full_name ?? "", ownerEmail: owner?.email ?? null, ownerPhone: owner?.phone ?? null,
        assessorName: prof?.full_name || prof?.email || "", assessmentAt: booking?.scheduled_start ?? null,
        estimatedAreaM2: job.estimated_area_m2 != null ? Number(job.estimated_area_m2) : null,
        occupancy: prop?.occupancy ? prop.occupancy.replace("_", " ") : null, lifeSupport: job.life_support ? "Yes – life support recorded" : "None recorded by office",
      },
    });
  } catch (e) {
    if (a) await admin.from("assessments").update({ mitti_last_error: e instanceof Error ? e.message : "Mitti error" }).eq("id", a.id);
    throw wrap(e);
  }
  const now = new Date().toISOString();
  const fields = {
    external_mitti_id: r.auditId, mitti_template_id: MITTI_TEMPLATE_ID, mitti_assignee_email: r.assigneeEmail, mitti_assignee_user_id: r.mittiUserId,
    mitti_last_error: null, mitti_sync_status: "pending" as const,
    ...(r.reused ? {} : { mitti_created_at: r.createdAt ?? now, mitti_prefill_count: r.prefillCount }),
  };
  if (a) await admin.from("assessments").update(fields).eq("id", a.id);
  else await admin.from("assessments").insert({ ...fields, job_id: jobId, assessor_id: asg.user_id });
  await logEvent(jobId, actorId, r.reused ? "mitti_audit_reshared" : "mitti_audit_created",
    r.reused ? `Mitti assessment re-shared with ${r.assigneeEmail}` : `Mitti assessment created and assigned to ${r.assigneeEmail}`,
    { audit_id: r.auditId, template_id: MITTI_TEMPLATE_ID, prefill_count: r.prefillCount });
  return { auditId: r.auditId, reused: r.reused };
}

/** Sync the STORED audit only. Never completes the assessment. */
export async function syncMittiAssessment(jobId: string, actorId: string, call: MittiCall = realMittiCall) {
  const { data: job } = await admin.from("jobs").select("job_number,business_unit").eq("id", jobId).single();
  if (!job) throw new WorkflowError("Job not found.");
  if (job.business_unit !== "hivic") throw new WorkflowError("Mitti automation is only available for HI VIC jobs.");
  const { data: a } = await admin.from("assessments").select("id,status,external_mitti_id").eq("job_id", jobId).maybeSingle();
  if (!a?.external_mitti_id) throw new WorkflowError("No Mitti assessment has been created for this job.");
  if (a.status === "complete") return { locked: true, completed: false, issues: [] as string[] };
  let plan;
  try {
    plan = planSync(await mittiApi(call).getAudit(a.external_mitti_id), { storedAuditId: a.external_mitti_id, jobNumber: job.job_number, assessmentStatus: a.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Mitti error";
    await admin.from("assessments").update({ mitti_last_error: msg, ...(e instanceof MittiError && /match|template|different/.test(msg) ? { mitti_sync_status: "error" as const } : {}) }).eq("id", a.id);
    throw wrap(e);
  }
  if (plan.locked) return { locked: true, completed: false, issues: [] as string[] };
  const now = new Date().toISOString();
  // Re-check lock atomically: only update while not complete.
  await admin.from("assessments").update({
    ...plan.patch, mitti_sync_status: plan.syncStatus, mitti_completed: plan.completed, mitti_modified_at: plan.modifiedAt,
    mitti_raw_snapshot: plan.snapshot as unknown as Json, mitti_validation_issues: plan.issues as unknown as Json, mitti_last_error: null,
    ...(plan.completed ? { mitti_synced_at: now } : {}),
  }).eq("id", a.id).neq("status", "complete");

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
    { audit_id: a.external_mitti_id, fields: Object.keys(plan.patch), issues: plan.issues, other_items: plan.others.length });
  return { locked: false, completed: plan.completed, issues: plan.issues };
}

export async function syncPendingMitti(actorId: string, call: MittiCall = realMittiCall) {
  const { data } = await admin.from("assessments").select("job_id,status,external_mitti_id,jobs!inner(business_unit)").not("external_mitti_id", "is", null).neq("status", "complete").eq("jobs.business_unit", "hivic");
  const results: { jobId: string; ok: boolean; message: string }[] = [];
  for (const row of data ?? []) {
    try {
      const r = await syncMittiAssessment(row.job_id, actorId, call);
      results.push({ jobId: row.job_id, ok: true, message: r.completed ? "synced" : "pending" });
    } catch (e) {
      results.push({ jobId: row.job_id, ok: false, message: e instanceof Error ? e.message : "error" });
    }
  }
  return results;
}

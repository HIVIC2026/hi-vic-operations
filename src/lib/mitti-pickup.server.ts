// Jo 22 Oct 2026: Mitti-first Ready Check pickup. Installers may start the A1 form straight in Mitti
// (Deep/Reinsulate style) or leave the Portal Job Number as their own Mitti reference. The office sees
// every recent Ready Check form that is not linked to a portal job and links it with one action.
// This module never creates jobs, never sends anything, and never completes a requirement: linking
// writes the HV job number into the form's Portal Job Number field and stores the measurement link,
// then the EXISTING guarded sync brings the answers in.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { mittiApi, parseAudit, validateStoredMittiAudit, type MittiCall } from "./mitti.core";
import { realMittiCall, syncMittiAssessment } from "./mitti.server";
import { jobScope } from "./requirements.server";
import {
  classifyPortalJobNumber, parsePickupAudit, pickupAddressKey, pickupDuplicates, portalJobNumberItem,
  propertyAddressKey, templateKindFor, type ReadyCheckPickup,
} from "./mitti-pickup.core";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const PICKUP_WINDOW_DAYS = 30;
const READY_CHECK_STAGES = ["ready_check_ready_to_schedule", "ready_check_scheduled"];

async function templateIds() {
  const { data } = await admin.from("workflow_settings").select("mitti_ready_check_template_id,mitti_ready_check_priced_template_id").eq("id", 1).maybeSingle();
  return { readyCheck: data?.mitti_ready_check_template_id?.trim() || null, readyCheckPriced: data?.mitti_ready_check_priced_template_id?.trim() || null };
}

/** Mitti user id → installer business, matched by each Mitti-invited business member's portal email. */
async function mittiBusinessMap(api: ReturnType<typeof mittiApi>) {
  const map = new Map<string, { id: string; name: string }>();
  const { data: biz } = await admin.from("businesses").select("id,name").eq("mitti_account_invited", true);
  const ids = (biz ?? []).map((b) => b.id);
  if (!ids.length) return map;
  const { data: profs } = await admin.from("profiles").select("id,business_id,email").in("business_id", ids);
  for (const p of profs ?? []) {
    const email = String(p.email ?? "").trim().toLowerCase();
    if (!email) continue;
    try {
      const res = (await api.searchUsers(email)) as { users?: { id?: string; user_id?: string; email?: string }[] };
      for (const u of res?.users ?? []) {
        if (String(u.email ?? "").toLowerCase() === email) {
          const uid = String(u.id ?? u.user_id ?? "");
          const b = (biz ?? []).find((x) => x.id === p.business_id);
          if (uid && b) map.set(uid, { id: b.id, name: b.name });
        }
      }
    } catch { /* one user lookup failing must not hide the other forms */ }
  }
  return map;
}

/** Office scan: recent Ready Check audits in Mitti that are not linked to a portal job. Read-only. */
export async function scanMittiReadyCheckPickups(actorId: string | null, call: MittiCall = realMittiCall): Promise<{ rows: ReadyCheckPickup[] }> {
  const ids = await templateIds();
  if (!ids.readyCheck && !ids.readyCheckPriced) throw new WorkflowError("No Ready Check Mitti template is configured in workflow settings.");
  const api = mittiApi(call);
  const after = new Date(Date.now() - PICKUP_WINDOW_DAYS * 86_400_000).toISOString();
  const res = (await api.searchAudits(after)) as { audits?: { audit_id?: string; template_id?: string }[] };
  const candidates = (res?.audits ?? []).filter((a) => {
    const t = String(a.template_id ?? "");
    return t && (t === ids.readyCheck || t === ids.readyCheckPriced);
  });
  if (!candidates.length) return { rows: [] };

  const { data: jobs } = await admin.from("jobs")
    .select("id, job_number, stage, owners(full_name), properties(address_line, suburb)")
    .eq("business_unit", "hivic").is("deleted_at", null).limit(3000);
  const dupJobs = (jobs ?? []).map((j) => ({
    id: j.id, job_number: j.job_number, stage: j.stage,
    owner: (j.owners as { full_name: string | null } | null)?.full_name ?? null,
    addressLine: (j.properties as { address_line: string | null } | null)?.address_line ?? null,
    suburb: (j.properties as { suburb: string | null } | null)?.suburb ?? null,
  }));

  const rows: ReadyCheckPickup[] = [];
  for (const c of candidates) {
    const auditId = String(c.audit_id ?? "");
    if (!auditId) continue;
    let audit: Any;
    try { audit = await api.getAudit(auditId); } catch { continue; } // one unreadable form must not hide the rest
    if (audit?.archived || audit?.audit_data?.date_completed) continue; // finished forms belong to normal sync
    const p = parsePickupAudit(audit);
    if (!p) continue;
    if (classifyPortalJobNumber(p.mittiRef) === "linked") continue; // already carries an HV number
    p.templateKind = templateKindFor(p.templateId, ids);
    const business = p.mittiOwnerUserId ? (await mittiBusinessMap(api)).get(p.mittiOwnerUserId) ?? null : null;
    rows.push({ ...p, business, duplicates: pickupDuplicates(p, dupJobs) });
  }
  rows.sort((a, b) => String(b.modifiedAt ?? "").localeCompare(String(a.modifiedAt ?? "")));
  return { rows };
}

/** Office action: link one Mitti Ready Check audit to a portal job, then run the existing guarded sync. */
export async function linkMittiReadyCheckToJob(actorId: string | null, input: { auditId: string; jobId: string }, call: MittiCall = realMittiCall) {
  const auditId = String(input.auditId ?? "").trim();
  const jobId = String(input.jobId ?? "").trim();
  if (!auditId || !jobId) throw new WorkflowError("Choose the Mitti form and the job to link it to.");
  const { data: job } = await admin.from("jobs").select("id,job_number,business_unit,stage,channel,deleted_at").eq("id", jobId).maybeSingle();
  if (!job || job.deleted_at) throw new WorkflowError("Job not found.");
  if (job.business_unit !== "hivic") throw new WorkflowError("Mitti linking is only available for Home Insulation Victoria jobs.");
  if (!READY_CHECK_STAGES.includes(job.stage)) throw new WorkflowError(`This job is at "${job.stage}". Only jobs waiting for or attending the Ready Check can take a Mitti form.`);

  const ids = await templateIds();
  const allowed = [ids.readyCheck, ids.readyCheckPriced].filter(Boolean) as string[];
  const api = mittiApi(call);
  const audit = await api.getAudit(auditId);
  if (audit?.archived) throw new WorkflowError("This Mitti form is archived and cannot be linked.");
  if (audit?.audit_data?.date_completed) throw new WorkflowError("This Mitti form is already completed in Mitti — office review is required before linking.");
  const parsed = parsePickupAudit(audit);
  if (!parsed || !allowed.includes(parsed.templateId)) throw new WorkflowError("This Mitti form is not a Ready Check form. Nothing was changed.");

  // Portal Job Number write-back: overwriting an installer's own Mitti reference is the point of linking.
  const pitem = portalJobNumberItem(audit);
  if (!pitem) throw new WorkflowError("This Ready Check form has no Portal Job Number field to write into.");
  const existing = classifyPortalJobNumber(pitem.current);
  if (existing === "linked" && String(pitem.current).trim().toUpperCase() !== job.job_number.trim().toUpperCase())
    throw new WorkflowError(`This form is already linked to ${pitem.current}. Nothing was changed.`);
  if (existing !== "linked" || String(pitem.current).trim().toUpperCase() !== job.job_number.trim().toUpperCase()) {
    const payload = [{ item_id: pitem.itemId, type: pitem.type, responses: { text: job.job_number } }];
    try { await api.updateAuditHeader(auditId, payload); }
    catch { await api.updateAuditText(auditId, payload); } // older Mitti route takes header items under "items"
  }
  const reread = await api.getAudit(auditId);
  validateStoredMittiAudit(reread, { storedAuditId: auditId, jobNumber: job.job_number, templateId: parsed.templateId });

  // Measurement link: same shape createAssignMittiAudit stores. Never replaces another source's record.
  const scope = await jobScope(jobId);
  const m = scope.measurementRow;
  if (!m) {
    await admin.from("ceiling_measurements").insert({ job_id: jobId, status: "draft", is_current: true, source_role: "installer", created_by: actorId, external_source: "mitti", external_id: auditId });
  } else if (m.external_source === "mitti" && m.external_id === auditId) {
    // already this audit
  } else if (m.status !== "complete" && !m.external_id) {
    await admin.from("ceiling_measurements").update({ external_source: "mitti", external_id: auditId }).eq("id", m.id);
  } else {
    throw new WorkflowError(`This job already has a measurement record (${m.external_source ?? "portal"}, status ${m.status}). Office review is required before replacing it; the Mitti form was still linked.`);
  }

  await logEvent(jobId, actorId, "mitti_audit_linked", `Mitti Ready Check form linked to ${job.job_number}`, { audit_id: auditId, template_id: parsed.templateId, mitti_ref: parsed.mittiRef });
  const sync = await syncMittiAssessment(jobId, actorId, call);
  return { linked: true as const, jobNumber: job.job_number, issues: sync.issues };
}

export type { ReadyCheckPickup };

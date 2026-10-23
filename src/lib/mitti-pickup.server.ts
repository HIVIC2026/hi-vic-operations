// Jo 22 Oct 2026: Mitti-first Ready Check pickup. Installers may start the A1 form straight in Mitti
// (Deep/Reinsulate style) or leave the Portal Job Number as their own Mitti reference. The office sees
// every recent Ready Check form that is not linked to a portal job and links it with one action.
// This module never creates jobs, never sends anything, and never completes a requirement: linking
// writes the HV job number into the form's Portal Job Number field and stores the measurement link,
// then the EXISTING guarded sync brings the answers in.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { mittiApi, norm, parseAudit, validateStoredMittiAudit, type MittiCall } from "./mitti.core";
import { realMittiCall, syncMittiAssessment } from "./mitti.server";
import { jobScope } from "./requirements.server";
import {
  classifyPortalJobNumber, parsePickupAudit, pickupAddressKey, pickupDuplicates, portalJobNumberItem,
  propertyAddressKey, templateKindFor, pickupTemplateMatches, type ReadyCheckPickup,
} from "./mitti-pickup.core";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const PICKUP_WINDOW_DAYS = 14;
// Jo 22 Oct 2026: "preliminary_estimate_ready" (Office wording: estimate sent) is allowed too — the Mitti-first
// flow has installers doing the Ready Check on jobs whose preliminary estimate already went out, and the visit
// has happened. Every other guard (template match, one-form rule, write-back validation, guarded sync) is unchanged.
// Jo 23 Oct 2026: every pre-quote stage where a Ready Check can sensibly be happening (enquiry, estimate,
// awaiting acceptance/payment, scheduling) plus a completed Ready Check awaiting the form. Closed/quoted/
// install stages stay refused.
export const READY_CHECK_STAGES = [
  "new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_awaiting_acceptance",
  "ready_check_awaiting_payment", "ready_check_ready_to_schedule", "ready_check_scheduled", "ready_check_complete",
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    return pickupTemplateMatches(t, ids.readyCheck) || pickupTemplateMatches(t, ids.readyCheckPriced);
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
    if (audit?.archived) continue; // completed-but-unlinked forms still need linking, so they stay listed
    const p = parsePickupAudit(audit);
    if (!p) continue;
    // Blank drafts (nothing typed yet) are not actionable — the office links forms with real content.
    if (!p.siteAddress?.trim() && !p.homeownerName?.trim()) continue;
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
  const jobRef = String(input.jobId ?? "").trim();
  if (!auditId || !jobRef) throw new WorkflowError("Choose the Mitti form and the job to link it to.");
  // The Office box takes the HV number; older callers pass the job id. Accept both.
  const sel = "id,job_number,business_unit,stage,channel,deleted_at";
  const { data: job } = UUID_RE.test(jobRef)
    ? await admin.from("jobs").select(sel).eq("id", jobRef).maybeSingle()
    : await admin.from("jobs").select(sel).ilike("job_number", jobRef.toUpperCase().replace(/^(\d)/, "HV-$1")).maybeSingle();
  if (!job) throw new WorkflowError(`No job found for "${jobRef}".`);
  const jobId = job.id;
  if (!job || job.deleted_at) throw new WorkflowError("Job not found.");
  if (job.business_unit !== "hivic") throw new WorkflowError("Mitti linking is only available for Home Insulation Victoria jobs.");
  if (!READY_CHECK_STAGES.includes(job.stage)) throw new WorkflowError(`This job is at "${job.stage}". Only jobs waiting for or attending the Ready Check can take a Mitti form.`);

  const ids = await templateIds();
  const allowed = [ids.readyCheck, ids.readyCheckPriced].filter(Boolean) as string[];
  const api = mittiApi(call);
  const audit = await api.getAudit(auditId);
  if (audit?.archived) throw new WorkflowError("This Mitti form is archived and cannot be linked.");
  const parsed = parsePickupAudit(audit);
  if (!parsed || !allowed.some((id) => pickupTemplateMatches(parsed.templateId, id))) throw new WorkflowError("This Mitti form is not a Ready Check form. Nothing was changed.");

  // Preflight the measurement record BEFORE touching Mitti, so any refusal leaves the form untouched.
  const scope = await jobScope(jobId);
  const m = scope.measurementRow;
  const action = !m
    ? { kind: "insert" as const }
    : m.external_source === "mitti" && m.external_id === auditId
      ? { kind: "already" as const }
      : m.status !== "complete" && !m.external_id
        ? { kind: "adopt" as const, id: m.id }
        : null;
  if (!action) throw new WorkflowError(`This job already has its own Ready Check form or measurement record (${m!.external_source ?? "portal"}, status ${m!.status}). Nothing was changed.`);

  // Portal Job Number write-back: overwriting an installer's own Mitti reference is the point of linking.
  const pitem = portalJobNumberItem(audit);
  // A1 no longer has a Portal Job Number question (Jo 23 Oct): link by the stored form ID, no write-back.
  const existing = pitem ? classifyPortalJobNumber(pitem.current) : null;
  if (pitem && existing === "linked" && String(pitem.current).trim().toUpperCase() !== job.job_number.trim().toUpperCase())
    throw new WorkflowError(`This form is already linked to ${pitem.current}. Nothing was changed.`);
  if (pitem && (existing !== "linked" || String(pitem.current).trim().toUpperCase() !== job.job_number.trim().toUpperCase())) {
    const payload = [{ item_id: pitem.itemId, type: pitem.type, responses: { text: job.job_number } }];
    try { await api.updateAuditHeader(auditId, payload); }
    catch { await api.updateAuditText(auditId, payload); } // older Mitti route takes header items under "items"
  }
  const reread = await api.getAudit(auditId);
  validateStoredMittiAudit(reread, { storedAuditId: auditId, jobNumber: job.job_number, templateId: parsed.templateId });

  // Apply the preflighted measurement action (re-read first: the job's own form may have appeared meanwhile).
  const { data: mNow } = await admin.from("ceiling_measurements").select("id,external_source,external_id,status").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  if (action.kind === "insert" && !mNow) {
    await admin.from("ceiling_measurements").insert({ job_id: jobId, status: "draft", is_current: true, source_role: "installer", created_by: actorId, external_source: "mitti", external_id: auditId });
  } else if (action.kind === "insert" && mNow && mNow.external_source === "mitti" && mNow.external_id === auditId) {
    // already this audit
  } else if (action.kind === "already" && mNow?.external_source === "mitti" && mNow.external_id === auditId) {
    // retry of an interrupted link: the measurement already points at this audit — nothing to change
  } else if (action.kind === "adopt" && mNow?.id === action.id) {
    await admin.from("ceiling_measurements").update({ external_source: "mitti", external_id: auditId }).eq("id", mNow.id);
  } else {
    throw new WorkflowError(`This job's own Ready Check form or measurement record appeared while linking (${mNow?.external_source ?? "portal"}). The Mitti form now carries ${job.job_number} but the portal kept its own record — office review is required.`);
  }

  await logEvent(jobId, actorId, "mitti_audit_linked", `Mitti Ready Check form linked to ${job.job_number}`, { audit_id: auditId, template_id: parsed.templateId, mitti_ref: parsed.mittiRef });
  const sync = await syncMittiAssessment(jobId, actorId, call);
  return { linked: true as const, jobNumber: job.job_number, issues: sync.issues };
}

export type { ReadyCheckPickup };

// ---------- Stage 5 (Jo 23 Oct): reschedule updates the form; cancel releases it ----------

/** The form's booked-date item, wherever it lives (header or body), for the in-place date write-back. */
function dateItemOf(audit: unknown): { itemId: string; type: string; header: boolean } | null {
  const list = (header: boolean) => ((audit as { header_items?: unknown[]; items?: unknown[] } | null)?.[header ? "header_items" : "items"] ?? []) as { item_id?: string; label?: string; type?: string }[];
  for (const header of [true, false]) {
    const it = list(header).find((i) => i.item_id && ["Assessment date/time", "Assessment date time", "Booked assessment date", "Date of inspection"].some((l) => norm(l) === norm(i.label)));
    if (it) return { itemId: String(it.item_id), type: String(it.type || "datetime"), header };
  }
  return null;
}

/** Reschedule write-back: the booked date on the job's Mitti form follows the new booking. Never creates or
 *  sends anything; a form without a date field is left untouched and reported. */
export async function updateMittiFormDate(jobId: string, start: string, actorId: string | null, call: MittiCall = realMittiCall): Promise<{ updated: boolean; reason?: string }> {
  const scope = await jobScope(jobId);
  const m = scope.measurementRow;
  const auditId = m?.external_source === "mitti" && m.status !== "complete" ? m.external_id : null;
  if (!auditId) return { updated: false, reason: "no open Mitti form for this job" };
  const api = mittiApi(call);
  const audit = await api.getAudit(auditId);
  if (audit?.archived) return { updated: false, reason: "form is archived in Mitti" };
  const item = dateItemOf(audit);
  if (!item) return { updated: false, reason: "form has no booked-date field" };
  const payload = [{ item_id: item.itemId, type: item.type, responses: { datetime: start } }];
  if (item.header) { try { await api.updateAuditHeader(auditId, payload); } catch { await api.updateAuditText(auditId, payload); } }
  else await api.updateAuditText(auditId, payload);
  await logEvent(jobId, actorId, "mitti_form_date_updated", "Mitti form's booked date updated to match the new Ready Check booking", { audit_id: auditId, scheduled_start: start }, { internal: true });
  return { updated: true };
}

/** Cancel releases the form: the job stops pointing at it so a rebooking creates a fresh form with the new
 *  date. Mitti's documented API has no archive call, so the form itself is left in Mitti and the office is
 *  told it may be archived there (Jo 23 Oct). Never touches a completed form. */
export async function releaseReadyCheckFormOnCancel(jobId: string, actorId: string | null, reason: string): Promise<{ released: boolean }> {
  const scope = await jobScope(jobId);
  const m = scope.measurementRow;
  if (!m || m.external_source !== "mitti" || !m.external_id || m.status === "complete") return { released: false };
  const auditId = m.external_id;
  await admin.from("ceiling_measurements").update({ external_source: null, external_id: null }).eq("id", m.id);
  await logEvent(jobId, actorId, "mitti_form_released", `Ready Check booking cancelled (${reason}) — the job no longer points at Mitti form ${auditId}; a new booking will create a fresh form. Mitti has no archive API, so the old form can be archived in Mitti if wanted.`, { audit_id: auditId, reason, needs_office: false }, { internal: true });
  return { released: true };
}

// ---------- Stage 2: recorded Mitti failures + office retry ----------

export type MittiSyncProblem = { jobId: string; jobNumber: string; owner: string | null; address: string | null; message: string; since: string | null };

/** Office list: jobs whose Mitti sync last failed (assessment error recorded on the row, or a Ready Check
 *  sync failure event with no later successful sync for the same audit). Read-only. */
export async function listMittiSyncProblems(): Promise<{ rows: MittiSyncProblem[] }> {
  const [{ data: aerr }, { data: fails }, { data: okays }] = await Promise.all([
    admin.from("assessments").select("job_id, mitti_last_error, mitti_synced_at, jobs!inner(job_number, business_unit, stage, deleted_at, owners(full_name), properties(address_line, suburb))")
      .not("mitti_last_error", "is", null).neq("status", "complete").eq("jobs.business_unit", "hivic").is("jobs.deleted_at", null).limit(100),
    admin.from("workflow_events").select("job_id, summary, created_at, details").eq("event_type", "mitti_measureup_sync_failed").order("created_at", { ascending: false }).limit(200),
    admin.from("workflow_events").select("job_id, created_at, details").eq("event_type", "mitti_measureup_synced").order("created_at", { ascending: false }).limit(500),
  ]);
  const jobInfo = async (ids: string[]) => {
    if (!ids.length) return new Map<string, { job_number: string; owner: string | null; address: string | null; skip: boolean }>();
    const { data } = await admin.from("jobs").select("id, job_number, stage, deleted_at, qa_archived_at, owners(full_name), properties(address_line, suburb)").in("id", ids);
    return new Map<string, { job_number: string; owner: string | null; address: string | null; skip: boolean }>((data ?? []).map((j) => [j.id, {
      job_number: j.job_number,
      owner: (j.owners as { full_name: string | null } | null)?.full_name ?? null,
      address: [(j.properties as { address_line: string | null } | null)?.address_line, (j.properties as { suburb: string | null } | null)?.suburb].filter(Boolean).join(", ") || null,
      skip: !!j.deleted_at || !!j.qa_archived_at || ["cancelled", "on_hold", "complete", "ready_for_veec"].includes(String(j.stage)),
    }]));
  };

  const rows: MittiSyncProblem[] = [];
  const seen = new Set<string>();
  const info = await jobInfo([...new Set([...(aerr ?? []).map((r) => r.job_id as string), ...(fails ?? []).map((r) => r.job_id as string)])]);
  for (const r of aerr ?? []) {
    const j = info.get(r.job_id as string);
    if (!j || j.skip) continue;
    seen.add(r.job_id as string);
    rows.push({ jobId: r.job_id as string, jobNumber: j.job_number, owner: j.owner, address: j.address, message: String(r.mitti_last_error), since: null });
  }
  // Measurement failures: only when no successful sync for the same audit came after.
  const latestFail = new Map<string, { audit: string; summary: string; created_at: string }>();
  for (const e of fails ?? []) {
    const key = e.job_id as string;
    if (latestFail.has(key)) continue;
    latestFail.set(key, { audit: String((e.details as { audit_id?: string } | null)?.audit_id ?? ""), summary: String(e.summary ?? ""), created_at: String(e.created_at) });
  }
  const latestOk = new Map<string, { audit: string; created_at: string }>();
  for (const e of okays ?? []) {
    const key = e.job_id as string;
    if (latestOk.has(key)) continue;
    latestOk.set(key, { audit: String((e.details as { audit_id?: string } | null)?.audit_id ?? ""), created_at: String(e.created_at) });
  }
  for (const [jobId, f] of latestFail) {
    if (seen.has(jobId)) continue;
    const j = info.get(jobId);
    if (!j || j.skip) continue;
    const ok = latestOk.get(jobId);
    if (ok && ok.audit === f.audit && ok.created_at > f.created_at) continue; // fixed since
    rows.push({ jobId, jobNumber: j.job_number, owner: j.owner, address: j.address, message: f.summary, since: f.created_at });
  }
  return { rows };
}

/** Office action: retry the stored Mitti sync for one job after a recorded failure. Same guarded sync —
 *  never completes a requirement, moves a stage or sends anything. */
export async function retryMittiSync(actorId: string | null, input: { jobId: string }, call: MittiCall = realMittiCall) {
  const jobId = String(input.jobId ?? "").trim();
  if (!UUID_RE.test(jobId)) throw new WorkflowError("Choose the job to retry.");
  const { data: job } = await admin.from("jobs").select("id, job_number, business_unit, deleted_at").eq("id", jobId).maybeSingle();
  if (!job || job.deleted_at) throw new WorkflowError("Job not found.");
  if (job.business_unit !== "hivic") throw new WorkflowError("Mitti sync is only available for Home Insulation Victoria jobs.");
  await admin.from("assessments").update({ mitti_last_error: null }).eq("job_id", jobId).neq("status", "complete");
  const sync = await syncMittiAssessment(jobId, actorId, call);
  await logEvent(jobId, actorId, "mitti_sync_retried", `Office retried the Mitti sync for ${job.job_number}`, { issues: sync.issues }, { internal: true });
  return { ok: true as const, jobNumber: job.job_number, issues: sync.issues };
}

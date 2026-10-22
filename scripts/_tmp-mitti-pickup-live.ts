// TEMP live test (Jo-approved): Mitti-first Ready Check pickup/link, TEST data only. Delete after run.
import { supabaseAdmin as admin } from "../src/integrations/supabase/client.server";
import { realMittiCall } from "../src/lib/mitti.server";
import { mittiApi } from "../src/lib/mitti.core";
import { startOnsiteReadyCheckFor } from "../src/lib/onsite-ready-check.server";
import { linkMittiReadyCheckToJob } from "../src/lib/mitti-pickup.server";
import { logEvent } from "../src/lib/workflow.server";

type Any = any;
const out: string[] = [];
const say = (s: string) => { out.push(s); console.log(s); };

async function main() {
  // 1. Reinsulate member + business
  const { data: prof } = await admin.from("profiles").select("id,business_id,full_name").ilike("email", "info@reinsulate.com.au").maybeSingle();
  if (!prof?.business_id) throw new Error("Reinsulate profile not found");
  const { data: biz } = await admin.from("businesses").select("id,name,onboarding_status,is_active,mitti_account_invited").eq("id", prof.business_id).maybeSingle();
  say(`Reinsulate: user=${prof.id} business=${biz?.name} status=${biz?.onboarding_status} active=${biz?.is_active} mitti_invited=${biz?.mitti_account_invited}`);

  // 2. Template ids
  const { data: ws } = await admin.from("workflow_settings").select("mitti_ready_check_template_id,mitti_ready_check_priced_template_id").eq("id", 1).maybeSingle();
  const a1 = ws?.mitti_ready_check_priced_template_id?.trim();
  if (!a1) throw new Error("A1 template not configured");
  say(`A1 template: ${a1}`);

  // 3. Create a Mitti-first TEST audit directly in Mitti (simulating Deep starting A1 in Mitti)
  const api = mittiApi(realMittiCall);
  const created = (await api.createAudit({ template_id: a1 })) as Any;
  const auditId = String(created?.audit_id ?? created?.id ?? "");
  if (!auditId) throw new Error(`audit create failed: ${JSON.stringify(created).slice(0, 200)}`);
  say(`Created TEST Mitti audit: ${auditId}`);
  const audit0 = (await api.getAudit(auditId)) as Any;
  const pick = (label: string) => (audit0.header_items as Any[]).find((i) => String(i.label ?? "").toLowerCase() === label.toLowerCase());
  const pjn = pick("Portal Job Number");
  const site = pick("Site address");
  const owner = pick("Homeowner name");
  const header = [
    { item_id: pjn.item_id, type: pjn.type, responses: { text: "Mitti-test-1" } },
    { item_id: site.item_id, type: site.type, responses: { text: "1 Test Street, Mulgrave, Victoria, 3170" } },
    { item_id: owner.item_id, type: owner.type, responses: { text: "TEST Jo Reinsulate check" } },
  ];
  await api.updateAuditHeader(auditId, header);
  const reread = (await api.getAudit(auditId)) as Any;
  const pjnNow = (reread.header_items as Any[]).find((i) => i.item_id === pjn.item_id)?.responses?.text;
  say(`PJN write-back check: "${pjnNow}" (expect Mitti-test-1)`);

  // 4. Add the TEST job as Reinsulate ("Add a job for later", appointment tomorrow 09:00 AEDT)
  const startsAt = "2026-10-23T09:00:00+11:00";
  const createdJob = await startOnsiteReadyCheckFor(prof.id, prof.business_id, {
    full_name: "TEST Jo Reinsulate check", address_line: "1 Test Street", suburb: "Mulgrave", postcode: "3170",
    phone: "0400000000", email: "jolowexo@hotmail.com", contact_permission: true, consent_by: "installer",
  }, { mode: "hivic" } as Any, realMittiCall, { startsAt });
  say(`Job created: ${createdJob.jobNumber} (${createdJob.jobId}) booking=${createdJob.booking}`);

  // 5. Link the Mitti-first TEST audit to that job (race with the background portal-first form creation)
  let linkRes: Any = null;
  let linkErr: string | null = null;
  try { linkRes = await linkMittiReadyCheckToJob(prof.id, { auditId, jobId: createdJob.jobId }); }
  catch (e) { linkErr = e instanceof Error ? e.message : String(e); }
  if (linkErr) say(`LINK FAILED: ${linkErr}`);
  else say(`LINKED: job=${linkRes.jobNumber} syncIssues=${JSON.stringify(linkRes.issues)}`);

  // 6. Verify state
  const audit2 = (await api.getAudit(auditId)) as Any;
  const pjn2 = (audit2.header_items as Any[]).find((i) => i.item_id === pjn.item_id)?.responses?.text;
  const { data: m } = await admin.from("ceiling_measurements").select("id,status,external_source,external_id,estimated_area").eq("job_id", createdJob.jobId).eq("is_current", true).maybeSingle();
  const { data: job } = await admin.from("jobs").select("stage,next_action").eq("id", createdJob.jobId).maybeSingle();
  const { data: shared } = await admin.from("ceiling_measurements").select("id", { count: "exact", head: true }).eq("job_id", createdJob.jobId);
  say(`VERIFY: mittiPJN=${pjn2} measurement=${JSON.stringify(m)} measurementRows=${shared} stage=${job?.stage} next_action=${job?.next_action}`);

  // 7. Cleanup: archive the TEST audit + soft-delete the TEST job
  try { await realMittiCall("PUT", `/audits/${encodeURIComponent(auditId)}`, { archived: true }); const a3 = (await api.getAudit(auditId)) as Any; say(`Cleanup: audit archived=${a3?.archived}`); }
  catch (e) { say(`Cleanup: archive failed — ${e instanceof Error ? e.message : e}`); }
  const now = new Date().toISOString();
  const reason = "Jo's live Mitti pickup test 22 Oct";
  const { error: delErr } = await supabaseAdmin.from("jobs").update({ deleted_at: now, deleted_by: prof.id, deleted_reason: reason }).eq("id", createdJob.jobId).is("deleted_at", null);
  if (delErr) say(`Cleanup: soft delete failed — ${delErr.message}`);
  else { await logEvent(createdJob.jobId, prof.id, "job_deleted", `Job deleted by office: ${reason}`, { reason, stage_at_delete: job?.stage, deleted_at: now }, { internal: true }); say(`Cleanup: job ${createdJob.jobNumber} soft-deleted`); }
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => { void import("fs").then((fs) => fs.writeFileSync("/tmp/pickup-live-test.log", out.join("\n"))); });

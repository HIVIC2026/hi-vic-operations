// TEMP live test (Jo-approved): Mitti-first Ready Check pickup/link, TEST data only. Delete after run.
// Usage: bun scripts/_tmp-mitti-pickup-live.ts <audit|job|link|cleanup> [auditId] [jobId]
import { supabaseAdmin as admin } from "../src/integrations/supabase/client.server";
import { realMittiCall } from "../src/lib/mitti.server";
import { mittiApi } from "../src/lib/mitti.core";
import { startOnsiteReadyCheckFor } from "../src/lib/onsite-ready-check.server";
import { linkMittiReadyCheckToJob } from "../src/lib/mitti-pickup.server";
import { logEvent } from "../src/lib/workflow.server";

type Any = any;
const out: string[] = [];
const say = (s: string) => { out.push(s); console.log(s); };
const step = process.argv[2];
const argA = process.argv[3] ?? "";
const argJ = process.argv[4] ?? "";

async function reinsulate() {
  const { data: prof } = await admin.from("profiles").select("id,business_id,full_name").ilike("email", "info@reinsulate.com.au").maybeSingle();
  if (!prof?.business_id) throw new Error("Reinsulate profile not found");
  return prof as { id: string; business_id: string };
}

async function main() {
  if (step === "audit") {
    const { data: ws } = await admin.from("workflow_settings").select("mitti_ready_check_priced_template_id").eq("id", 1).maybeSingle();
    const a1 = ws?.mitti_ready_check_priced_template_id?.trim();
    const api = mittiApi(realMittiCall);
    const created = (await api.createAudit({ template_id: a1 })) as Any;
    const auditId = String(created?.audit_id ?? created?.id ?? "");
    const audit0 = (await api.getAudit(auditId)) as Any;
    const pick = (label: string) => (audit0.header_items as Any[]).find((i) => String(i.label ?? "").toLowerCase() === label.toLowerCase());
    const header = [
      { item_id: pick("Portal Job Number").item_id, type: pick("Portal Job Number").type, responses: { text: "Mitti-test-1" } },
      { item_id: pick("Site address").item_id, type: pick("Site address").type, responses: { text: "1 Test Street, Mulgrave, Victoria, 3170" } },
      { item_id: pick("Homeowner name").item_id, type: pick("Homeowner name").type, responses: { text: "TEST Jo Reinsulate check" } },
    ];
    await api.updateAuditHeader(auditId, header);
    const reread = (await api.getAudit(auditId)) as Any;
    const pjnNow = (reread.header_items as Any[]).find((i) => i.item_id === header[0]!.item_id)?.responses?.text;
    say(`Created TEST Mitti audit: ${auditId} — PJN write-back check: "${pjnNow}"`);
    return;
  }
  if (step === "archive") {
    const api = mittiApi(realMittiCall);
    await realMittiCall("PUT", `/audits/${encodeURIComponent(argA)}`, { archived: true });
    const a3 = (await api.getAudit(argA)) as Any;
    say(`Cleanup: audit ${argA} archived=${a3?.archived}`);
    return;
  }
  if (step === "job") {
    const prof = await reinsulate();
    const { data: biz } = await admin.from("businesses").select("name,onboarding_status,is_active,mitti_account_invited").eq("id", prof.business_id).maybeSingle();
    say(`Reinsulate: user=${prof.id} business=${biz?.name} status=${biz?.onboarding_status} active=${biz?.is_active} mitti_invited=${biz?.mitti_account_invited}`);
    const startsAt = "2026-10-23T09:00:00+11:00";
    const created = await startOnsiteReadyCheckFor(prof.id, prof.business_id, {
      full_name: "TEST Jo Reinsulate check", address_line: "1 Test Street", suburb: "Mulgrave", postcode: "3170",
      phone: "0400000000", email: "test@homeinsulationvictoria.com.au", contact_permission: true, consent_by: "installer",
    }, { mode: "hivic" } as Any, realMittiCall, { startsAt });
    say(`Job created: ${created.jobNumber} (${created.jobId}) booking=${created.booking}`);
    return;
  }
  if (step === "link") {
    const prof = await reinsulate();
    try {
      const res = await linkMittiReadyCheckToJob(prof.id, { auditId: argA, jobId: argJ }) as Any;
      say(`LINKED: job=${res.jobNumber} syncIssues=${JSON.stringify(res.issues)}`);
    } catch (e) { say(`LINK FAILED: ${e instanceof Error ? e.message : e}`); }
    const { data: m } = await admin.from("ceiling_measurements").select("status,external_source,external_id,estimated_area").eq("job_id", argJ).eq("is_current", true).maybeSingle();
    const { data: job } = await admin.from("jobs").select("stage,next_action").eq("id", argJ).maybeSingle();
    say(`VERIFY: measurement=${JSON.stringify(m)} stage=${job?.stage} next_action=${job?.next_action}`);
    return;
  }
  if (step === "cleanup") {
    const prof = await reinsulate();
    const now = new Date().toISOString();
    const reason = "Jo's live Mitti pickup test 22 Oct";
    const { error: delErr } = await admin.from("jobs").update({ deleted_at: now, deleted_by: prof.id, deleted_reason: reason }).eq("id", argJ).is("deleted_at", null);
    if (delErr) say(`Cleanup: soft delete failed — ${delErr.message}`);
    else { await logEvent(argJ, prof.id, "job_deleted", `Job deleted by office: ${reason}`, { reason, deleted_at: now }, { internal: true }); say(`Cleanup: job soft-deleted`); }
    return;
  }
  throw new Error(`unknown step ${step}`);
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => { void import("fs").then((fs) => fs.writeFileSync("/tmp/pickup-live-test.log", out.join("\n"))); });

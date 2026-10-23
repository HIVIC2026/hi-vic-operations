// Jo-approved one-off (23 Oct 2026): adopt Deep's (Reinsulate) Mitti Ready Checks not yet in the portal,
// via the existing pickup path (upsertEnquiry installer_mitti + assignment + guarded link/sync). Sends nothing.
import { scanMittiReadyCheckPickups, linkMittiReadyCheckToJob } from "../src/lib/mitti-pickup.server";
import { pickupAddressParts, needsFinishingText } from "../src/lib/mitti-pickup.core";
import { logEvent } from "../src/lib/workflow.server";
import { supabaseAdmin as admin } from "../src/integrations/supabase/client.server";
const BIZ = "a8304d2d-339b-4cbf-bcf1-fb09ce7935b0"; const DEEP = "fa05a642-77da-4d09-9c3d-b2d5ef8e448a";
const ACTOR = "36b849de-1cde-425c-a05d-623f8985bbd6";
const WANT = ["audit_7016af7e", "audit_40813bd2", "audit_bd4e5d5f", "audit_8c375adc", "audit_ee4c3f06"];
const run = process.argv.includes("--run");
const { rows } = await scanMittiReadyCheckPickups(ACTOR);
const { data: biz } = await admin.from("businesses").select("id,name").eq("id", BIZ).single();
for (const p of WANT) {
  const r = rows.find((x) => x.auditId.startsWith(p));
  if (!r) { console.log(p, "NOT IN SCAN"); continue; }
  const info = { audit: r.auditId, owner: r.homeownerName, addr: r.siteAddress, phone: !!r.ownerPhone, email: !!r.ownerEmail, perm: r.contactPermission, kind: r.templateKind, biz: r.business?.name, dup: r.duplicates, linked: (r as any).linkedJobNumber ?? null };
  console.log(JSON.stringify(info));
  if (!run) continue;
  if (!r.siteAddress?.trim() && !r.homeownerName?.trim()) { console.log("  SKIP empty"); continue; }
  let jobId: string, jobNo: string;
  const dup = (r.duplicates ?? []) as any[];
  if (dup.length) {
    jobId = dup[0].jobId ?? dup[0].job_id; jobNo = dup[0].jobNumber ?? dup[0].job_number;
    await logEvent(jobId, ACTOR, "mitti_pickup_clash", `Mitti Ready Check ${r.auditId} by ${biz!.name} matches this existing job — linked, not duplicated; office to check`, { audit_id: r.auditId, needs_office: true, duplicates: dup }, { internal: true });
  } else {
    const m = { id: DEEP };
    const parts = pickupAddressParts(r.siteAddress);
    const { upsertEnquiry } = await import("../src/lib/enquiry.server");
    const c = await upsertEnquiry({ full_name: (r.homeownerName?.trim() || "Homeowner (name to confirm)"), email: r.ownerEmail?.trim() || null, phone: r.ownerPhone?.trim() || null,
      address_line: parts?.addressLine ?? r.siteAddress!.trim(), suburb: parts?.suburb ?? null, postcode: parts?.postcode ?? null, estimated_area_m2: null } as any,
      "installer_mitti", ACTOR, { channel: "installer_sourced", businessId: BIZ, userId: m!.id });
    jobId = c.job_id; jobNo = c.job_number;
    await admin.from("job_assignments").insert({ job_id: jobId, user_id: m!.id, role: "installer", business_id: BIZ, assigned_by: ACTOR, first_response_at: new Date().toISOString() });
    const missing = [!r.ownerPhone && "owner mobile", !r.ownerEmail && "owner email", r.contactPermission !== true && "contact permission"].filter(Boolean) as string[];
    if (missing.length) { const next = needsFinishingText(missing as any); await admin.from("jobs").update({ next_action: next }).eq("id", jobId); }
    if (r.templateKind !== "ready_check_priced") await logEvent(jobId, ACTOR, "mitti_pickup_installer_started_a2", "Installer-started A2 form — Reinsulate's own lead; office to review", { audit_id: r.auditId, needs_office: true }, { internal: true });
    await logEvent(jobId, ACTOR, "mitti_pickup_manual_adopt", `Jo-approved adoption of Mitti Ready Check ${r.auditId} for ${biz!.name}`, { audit_id: r.auditId }, { internal: true });
  }
  const l = await linkMittiReadyCheckToJob(ACTOR, { auditId: r.auditId, jobId });
  const { data: j } = await admin.from("jobs").select("job_number,next_action,stage").eq("id", jobId).single();
  const { data: cm } = await admin.from("ceiling_measurements").select("measured_ceiling_area_m2,removal_area_m2").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  console.log("  =>", dup.length ? "LINKED" : "NEW", jobNo, JSON.stringify({ j, cm, issues: (l as any).issues }));
}
process.exit(0);

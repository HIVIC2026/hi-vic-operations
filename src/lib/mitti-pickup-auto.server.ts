// Jo 23 Oct 2026: Mitti-first auto-pickup. After the read-only scan, forms that pass every check
// (installer A1 form, business matched, owner name/phone/email and contact permission, no duplicate
// owner/address in the portal) are adopted automatically: the portal creates the installer-sourced job,
// assigns the installer business, links the form (writes the HV number back) and runs the existing
// guarded sync. Anything off goes to office review — recorded once, never blocking.
//
// OFF by default: workflow_settings.mitti_pickup_auto_enabled (pending migration; not applied live).
// Nothing is sent to anyone, no stage is completed, and a dry run reports what would happen.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import type { MittiCall } from "./mitti.core";
import { realMittiCall } from "./mitti.server";
import { scanMittiReadyCheckPickups, linkMittiReadyCheckToJob } from "./mitti-pickup.server";
import { pickupAutoDecision, pickupAddressParts } from "./mitti-pickup.core";

export type PickupAutoResult = { auditId: string; action: "created" | "review" | "would_create" | "would_review" | "failed"; jobNumber?: string; reasons?: string[]; error?: string };

/** One review event per form (idempotent), so the office list never floods on every 15-minute tick. */
async function recordReview(auditId: string, businessName: string | null, reasons: string[]) {
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("event_type", "mitti_pickup_needs_review").contains("details", { audit_id: auditId });
  if (count) return;
  await admin.from("workflow_events").insert({
    job_id: null, actor_id: null, event_type: "mitti_pickup_needs_review",
    summary: `Ready Check started in Mitti needs office review (${businessName ?? "installer not matched"}): ${reasons.join("; ")}`,
    details: { audit_id: auditId, business: businessName, reasons, needs_office: true } as never, internal: true,
  });
}

/** First active member of a business, for the job's originating installer attribution. */
async function businessMember(businessId: string): Promise<string | null> {
  const { data } = await admin.from("profiles").select("id").eq("business_id", businessId).limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function sweepMittiPickupAuto(opts: { dryRun?: boolean; call?: MittiCall } = {}): Promise<{ enabled: boolean; results: PickupAutoResult[] }> {
  const { data: ws } = await admin.from("workflow_settings").select("mitti_pickup_auto_enabled").eq("id", 1).maybeSingle();
  if ((ws as { mitti_pickup_auto_enabled?: boolean } | null)?.mitti_pickup_auto_enabled !== true) return { enabled: false, results: [] };
  const call = opts.call ?? realMittiCall;
  const { rows } = await scanMittiReadyCheckPickups(null, call);
  const results: PickupAutoResult[] = [];
  for (const r of rows) {
    const decision = pickupAutoDecision({
      templateKind: r.templateKind, businessMatched: !!r.business,
      homeownerName: r.homeownerName, siteAddress: r.siteAddress,
      ownerPhone: r.ownerPhone, ownerEmail: r.ownerEmail, contactPermission: r.contactPermission,
      duplicates: r.duplicates,
    });
    if (decision.action === "office_review") {
      if (!opts.dryRun) await recordReview(r.auditId, r.business?.name ?? null, decision.reasons).catch(() => undefined);
      results.push({ auditId: r.auditId, action: opts.dryRun ? "would_review" : "review", reasons: decision.reasons });
      continue;
    }
    if (opts.dryRun) {
      results.push({ auditId: r.auditId, action: "would_create" });
      continue;
    }
    try {
      const member = await businessMember(r.business!.id);
      if (!member) {
        await recordReview(r.auditId, r.business!.name, ["No portal user found in that installer business"]);
        results.push({ auditId: r.auditId, action: "review", reasons: ["No portal user found in that installer business"] });
        continue;
      }
      const parts = pickupAddressParts(r.siteAddress);
      const { upsertEnquiry } = await import("./enquiry.server");
      const created = await upsertEnquiry({
        full_name: r.homeownerName!.trim(), email: r.ownerEmail!.trim(), phone: r.ownerPhone!.trim(),
        address_line: parts?.addressLine ?? r.siteAddress!.trim(), suburb: parts?.suburb ?? null, postcode: parts?.postcode ?? null,
        estimated_area_m2: null, area_unknown: true,
      }, "installer_mitti", null, { channel: "installer_sourced", businessId: r.business!.id, userId: member });
      const { error: ae } = await admin.from("job_assignments").insert({ job_id: created.job_id, user_id: member, role: "installer", business_id: r.business!.id, assigned_by: null, first_response_at: new Date().toISOString() });
      if (ae) await logEvent(created.job_id, null, "mitti_pickup_assign_failed", `Installer assignment failed after auto-pickup: ${ae.message}`, { audit_id: r.auditId }, { internal: true });
      // Factual record only — the owner's tick is a fact about contact, never a marketing consent record.
      await logEvent(created.job_id, null, "mitti_contact_permission", `Owner ticked contact permission on the Mitti Ready Check form (audit ${r.auditId})`, { audit_id: r.auditId, permission: true, source: "mitti_form" }, { internal: true });
      const link = await linkMittiReadyCheckToJob(null, { auditId: r.auditId, jobId: created.job_id }, call);
      await logEvent(created.job_id, null, "mitti_pickup_auto_created", `Ready Check started in Mitti adopted automatically — job created for ${r.business!.name} and form linked (${created.job_number})`, { audit_id: r.auditId, business_id: r.business!.id, business: r.business!.name, issues: link.issues }, { internal: true });
      results.push({ auditId: r.auditId, action: "created", jobNumber: created.job_number });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      await recordReview(r.auditId, r.business?.name ?? null, [`Automatic adoption failed: ${msg}`]).catch(() => undefined);
      results.push({ auditId: r.auditId, action: "failed", error: msg });
    }
  }
  return { enabled: true, results };
}

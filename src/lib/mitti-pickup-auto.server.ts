// Jo 23 Oct 2026: Mitti-first auto-pickup. Each 15-minute tick looks at A1/A2 Ready Check forms (14-day
// modified window) that carry no HV number and are not linked to any portal job. Forms whose Mitti author
// matches an installer business are adopted: the portal creates the installer-sourced job for that business
// and member, links the form (HV number written back where the form has a Portal Job Number), and runs the
// existing guarded sync (which drafts/holds the installer quote under its own guards). A form whose owner or
// address already exists is linked to that job and flagged — never blocked, never duplicated. Unmatched
// authors go to office review. Empty forms (no address, no owner) wait until they have one.
//
// Forms missing owner phone/email/permission are still created and keep "Needs finishing…" until complete.
// Switch: workflow_settings.mitti_pickup_auto_enabled. Nothing is sent to anyone, no stage is completed.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import type { MittiCall } from "./mitti.core";
import { realMittiCall } from "./mitti.server";
import { scanMittiReadyCheckPickups, linkMittiReadyCheckToJob, type PickupScanOpts } from "./mitti-pickup.server";
import { pickupAutoDecision, pickupAddressParts, needsFinishingText, pickupFormLabel } from "./mitti-pickup.core";

export type PickupAutoResult = { auditId: string; action: "created" | "linked" | "review" | "would_create" | "would_link" | "would_review" | "failed"; jobNumber?: string; reasons?: string[]; error?: string };

/** One review event per form (idempotent), so the office list never floods on every 15-minute tick. */
async function recordReview(auditId: string, businessName: string | null, reasons: string[]) {
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("event_type", "mitti_pickup_needs_review").contains("details", { audit_id: auditId });
  if (count) return;
  await admin.from("workflow_events").insert({
    job_id: null, actor_id: null, event_type: "mitti_pickup_needs_review",
    summary: `Ready Check started in Mitti needs office review (${businessName ?? "installer not matched"}): ${reasons.join("; ")}`,
    details: { audit_id: auditId, business: businessName, reasons, needs_office: true },
    internal: true,
  } as never);
}

/** Fallback member when the matched Mitti user has no own portal profile id. */
async function businessMember(businessId: string): Promise<string | null> {
  const { data } = await admin.from("profiles").select("id").eq("business_id", businessId).limit(1).maybeSingle();
  return data?.id ?? null;
}

import { PROTECT_EVENTS as PICKUP_EVENTS } from "./ready-check-basics.server";

/** Jo 23 Oct: picked-up jobs keep "Needs finishing…" until the owner's phone, email and permission are in.
 *  Re-applied each tick after any stage default overwrote it. Writes next_action only. */
export async function keepNeedsFinishing(): Promise<number> {
  const { data: ev } = await admin.from("workflow_events").select("job_id").in("event_type", PICKUP_EVENTS).not("job_id", "is", null).limit(1000);
  const jobIds = [...new Set((ev ?? []).map((e) => String(e.job_id)))];
  if (!jobIds.length) return 0;
  const [{ data: jobs }, { data: perms }] = await Promise.all([
    admin.from("jobs").select("id,next_action,stage,deleted_at,owners(phone,email)").in("id", jobIds),
    admin.from("workflow_events").select("job_id").eq("event_type", "mitti_contact_permission").in("job_id", jobIds),
  ]);
  const permitted = new Set((perms ?? []).map((p) => String(p.job_id)));
  const { READY_CHECK_STAGES } = await import("./mitti-pickup.server");
  let fixed = 0;
  for (const j of jobs ?? []) {
    if (j.deleted_at || !READY_CHECK_STAGES.includes(j.stage)) continue;
    const o = j.owners as { phone: string | null; email: string | null } | null;
    const missing = [!o?.phone?.trim() && "owner phone", !o?.email?.trim() && "owner email", !permitted.has(j.id) && "owner contact permission"].filter(Boolean) as string[];
    // Jo 23 Oct: once the sync has recorded the full basics check, that list (area, product, price, contact) wins.
    const { data: b } = await admin.from("workflow_events").select("details").eq("job_id", j.id).eq("event_type", "ready_check_basics").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const basicsMissing = (b?.details as { missing?: string[] } | null)?.missing;
    const next = basicsMissing ? (await import("./ready-check-basics.core")).needsFinishingFromMissing(basicsMissing) : missing.length ? needsFinishingText(missing) : null;
    if (!next || j.next_action === next) continue;
    await admin.from("jobs").update({ next_action: next }).eq("id", j.id);
    fixed++;
  }
  return fixed;
}

export async function sweepMittiPickupAuto(opts: { dryRun?: boolean; call?: MittiCall; force?: boolean } & PickupScanOpts = {}): Promise<{ enabled: boolean; results: PickupAutoResult[] }> {
  if (!opts.force) {
    const { data: ws } = await admin.from("workflow_settings").select("mitti_pickup_auto_enabled").eq("id", 1).maybeSingle();
    if ((ws as { mitti_pickup_auto_enabled?: boolean } | null)?.mitti_pickup_auto_enabled !== true) {
      // Next-step protection writes next_action only, so it runs even while auto-pickup is off (Jo 23 Oct).
      if (!opts.dryRun) await keepNeedsFinishing().catch(() => 0);
      return { enabled: false, results: [] };
    }
  }
  const call = opts.call ?? realMittiCall;
  const { rows } = await scanMittiReadyCheckPickups(null, call, { onlyAuditIds: opts.onlyAuditIds, businessOverride: opts.businessOverride });
  const results: PickupAutoResult[] = [];
  for (const r of rows) {
    const form = pickupFormLabel(r.templateKind);
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
      results.push({ auditId: r.auditId, action: decision.action === "link_existing" ? "would_link" : "would_create", reasons: [...(decision.action === "create_job_needs_finishing" ? [needsFinishingText(decision.missing)] : []), ...(decision.officeFlag ? [decision.officeFlag] : [])] });
      continue;
    }
    try {
      if (decision.action === "link_existing") {
        const dup = r.duplicates[0]!;
        try {
          const link = await linkMittiReadyCheckToJob(null, { auditId: r.auditId, jobId: dup.jobId }, call);
          await logEvent(dup.jobId, null, "mitti_pickup_clash", `${decision.officeFlag} (${form} form, ${r.business!.name})`, { audit_id: r.auditId, form, business_id: r.business!.id, matches: r.duplicates.map((d) => d.jobNumber), needs_office: true, issues: link.issues }, { internal: true });
          results.push({ auditId: r.auditId, action: "linked", jobNumber: dup.jobNumber });
        } catch (e) {
          const why = `Matches ${r.duplicates.map((d) => d.jobNumber).join(", ")} but could not link: ${e instanceof Error ? e.message : "error"}`;
          await recordReview(r.auditId, r.business!.name, [why]);
          results.push({ auditId: r.auditId, action: "review", reasons: [why] });
        }
        continue;
      }
      const member = r.business!.userId ?? await businessMember(r.business!.id);
      if (!member) {
        await recordReview(r.auditId, r.business!.name, ["No portal user found in that installer business"]);
        results.push({ auditId: r.auditId, action: "review", reasons: ["No portal user found in that installer business"] });
        continue;
      }
      const parts = pickupAddressParts(r.siteAddress);
      const { upsertEnquiry } = await import("./enquiry.server");
      // Ceiling size is unknown at pickup: installer-sourced jobs take a null estimate (no area_unknown flag, which is manual-portal-only).
      const created = await upsertEnquiry({
        full_name: r.homeownerName?.trim() || "Homeowner (name to confirm)", email: r.ownerEmail?.trim() || null, phone: r.ownerPhone?.trim() || null,
        address_line: parts?.addressLine ?? (r.siteAddress?.trim() || "Address to confirm"), suburb: parts?.suburb ?? null, postcode: parts?.postcode ?? null,
        estimated_area_m2: null,
      } as never, "installer_mitti", null, { channel: "installer_sourced", businessId: r.business!.id, userId: member });
      const { error: ae } = await admin.from("job_assignments").insert({ job_id: created.job_id, user_id: member, role: "installer", business_id: r.business!.id, assigned_by: null, first_response_at: new Date().toISOString() });
      if (ae) await logEvent(created.job_id, null, "mitti_pickup_assign_failed", `Installer assignment failed after auto-pickup: ${ae.message}`, { audit_id: r.auditId }, { internal: true });
      // Finish the initial checks now so their stage default cannot overwrite "Needs finishing…" afterwards.
      try { const { processPostIntakeWork } = await import("./postintake.server"); await processPostIntakeWork({ jobId: created.job_id }); } catch { /* scheduled worker retries */ }
      if (decision.officeFlag) {
        await logEvent(created.job_id, null, "mitti_pickup_installer_started_a2", decision.officeFlag, { audit_id: r.auditId, form, business_id: r.business!.id, needs_office: true }, { internal: true });
        await recordReview(r.auditId, r.business!.name, [decision.officeFlag, `Job ${created.job_number} created as ${r.business!.name}'s installer-led job`]);
      }
      // Factual record only — the owner's tick is a fact about contact, never a marketing consent record.
      if (r.contactPermission === true) await logEvent(created.job_id, null, "mitti_contact_permission", `Owner ticked contact permission on the Mitti Ready Check form (audit ${r.auditId})`, { audit_id: r.auditId, permission: true, source: "mitti_form" }, { internal: true });
      const link = await linkMittiReadyCheckToJob(null, { auditId: r.auditId, jobId: created.job_id }, call);
      // Safety net: if post-intake finished after the link, the job still lands at ready_check_scheduled.
      const { holdAtMittiReadyCheck } = await import("./mitti-pickup.server");
      await holdAtMittiReadyCheck(created.job_id, null);
      if (decision.action === "create_job_needs_finishing") {
        const next = needsFinishingText(decision.missing);
        await admin.from("jobs").update({ next_action: next }).eq("id", created.job_id);
        await logEvent(created.job_id, null, "mitti_pickup_needs_finishing", next, { audit_id: r.auditId, form, missing: decision.missing }, { internal: true });
      }
      await logEvent(created.job_id, null, "mitti_pickup_auto_created", `Ready Check started in Mitti (${form} form) adopted automatically — job created for ${r.business!.name} and form linked (${created.job_number})`, { audit_id: r.auditId, form, business_id: r.business!.id, business: r.business!.name, issues: link.issues }, { internal: true });
      results.push({ auditId: r.auditId, action: "created", jobNumber: created.job_number });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      await recordReview(r.auditId, r.business?.name ?? null, [`Automatic adoption failed: ${msg}`]).catch(() => undefined);
      results.push({ auditId: r.auditId, action: "failed", error: msg });
    }
  }
  if (!opts.dryRun && !opts.onlyAuditIds) await keepNeedsFinishing().catch(() => 0);
  return { enabled: true, results };
}

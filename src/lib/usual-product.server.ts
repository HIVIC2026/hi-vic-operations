// Business-scoped usual product + job-owned compliance record of the product used (declared, not verified).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { USUAL_PRODUCT_EVENT, usualProduct, resolveMittiProduct, type MittiProductResolution, type UsualProduct } from "./usual-product.core";
import { contactAnswersFromEntries } from "./mitti.core";
import { logEvent } from "./workflow.server";

export async function readUsualProduct(businessId: string) {
  const { data, error } = await admin.from("admin_config_events").select("id, details")
    .eq("event_type", USUAL_PRODUCT_EVENT).contains("details", { business_id: businessId })
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Could not load your usual product.");
  return { product: usualProduct((data?.details as { product?: unknown } | null)?.product), revision: data?.id ?? null };
}

export async function assignedInstallerBusiness(jobId: string): Promise<string | null> {
  const { data } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  return (data?.business_id as string | null) ?? null;
}

/** Product for an owner rate-card quote on our leads: the latest recorded form product, else the assigned installer's usual product. */
export async function productForHivQuote(jobId: string, businessId: string): Promise<{ product: UsualProduct | null; source: "mitti_form" | "installer_profile" | null }> {
  const { data: ev } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_product_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const d = ev?.details as { ready?: boolean; product?: unknown; source?: "mitti_form" | "installer_profile" } | null;
  const recorded = d?.ready ? usualProduct(d.product) : null;
  if (recorded) return { product: recorded, source: d?.source ?? "mitti_form" };
  const saved = await readUsualProduct(businessId);
  return { product: saved.product, source: saved.product ? "installer_profile" : null };
}

/** Null = the product question is not on this (older) form. */
export async function mittiProductForJob(jobId: string, actorId: string | null, entries: { label: string; value: string | null }[], auditId: string): Promise<MittiProductResolution | null> {
  const a = contactAnswersFromEntries(entries);
  if (!a.productChoice) return null;
  const { data: job, error } = await admin.from("jobs").select("channel, originating_installer_business_id").eq("id", jobId).maybeSingle();
  if (error) throw new Error("Could not check the installer for this job.");
  if (!job) return null;
  // Installer-brought jobs: the originating installer. Our leads (Jo 22 Oct): the assigned installer.
  const businessId = job.channel === "installer_sourced" ? job.originating_installer_business_id : await assignedInstallerBusiness(jobId);
  const saved = a.productChoice === "usual" && businessId ? await readUsualProduct(businessId) : null;
  const resolved = resolveMittiProduct({ choice: a.productChoice, usual: saved?.product ?? null, different: { brand: a.productBrand, productName: a.productName, rValue: a.productRValue } });
  const details = { audit_id: auditId, ...resolved, profile_revision: saved?.revision ?? null, declared_not_verified: true };
  const { data: prev, error: pe } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_product_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (pe) throw new Error("Could not check the job's product history.");
  if (JSON.stringify(prev?.details ?? null) !== JSON.stringify(details))
    await logEvent(jobId, actorId, "mitti_product_recorded", resolved.ready && resolved.product ? `Insulation product recorded for compliance (declared, not verified): ${resolved.product.brand === "Other" ? resolved.product.brandOther ?? "Other" : resolved.product.brand} ${resolved.product.productName} ${resolved.product.rValue}` : resolved.reasons.join(" · "), details, { internal: true });
  return resolved;
}

/** Dormant: default-OFF auto-quote switch AND unapproved wording (sms guard). TEST jobs never texted. */
export async function maybeRemindUsualProduct(jobId: string, auditId: string) {
  const { data: settings } = await admin.from("workflow_settings").select("mitti_auto_quote_enabled").eq("id", 1).maybeSingle();
  if ((settings as { mitti_auto_quote_enabled?: boolean } | null)?.mitti_auto_quote_enabled !== true) return { status: "off" };
  const { data: j } = await admin.from("jobs").select("source, originating_installer_business_id, job_number").eq("id", jobId).maybeSingle();
  if (!j || j.source === "qa_test" || !j.originating_installer_business_id) return { status: "test_or_missing" };
  const { data: b } = await admin.from("businesses").select("signer_mobile, phone").eq("id", j.originating_installer_business_id).maybeSingle();
  const { usualProductReminderBody } = await import("./usual-product.core");
  const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
  return (await import("./sms.server")).sendRealSms({ type: "usual_product_missing", jobId, businessId: j.originating_installer_business_id,
    idempotencyKey: `usual-product-missing:v1:${jobId}:${auditId}`, to: b?.signer_mobile ?? b?.phone,
    body: usualProductReminderBody(j.job_number, `${SET_PASSWORD_BASE}/field/business/details`) });
}

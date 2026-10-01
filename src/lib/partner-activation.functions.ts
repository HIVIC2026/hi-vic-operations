import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, WorkflowError } from "./workflow.server";
import { activationBlockers, activationWorkers, approvedRateItems, type PartnerType } from "./partner-activation.core";
import type { RecData } from "./rec-onboarding.core";
import type { InstData } from "./installer-onboarding.core";

const uuid = z.string().uuid();

export const activatePartnerApplication = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ applicationId: uuid, overrideReason: z.string().trim().min(10).max(2000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await admin.from("partner_activations").select("business_id, rate_card_id").eq("application_id", data.applicationId).maybeSingle();
    if (existing) return { ...existing, alreadyActivated: true as const };
    const { data: app, error } = await admin.from("rec_onboarding_applications").select("*").eq("id", data.applicationId).single();
    if (error || !app || app.status !== "submitted" || !app.partner_enquiry_id) throw new WorkflowError("A complete signed application is required.");
    const type = app.partner_type as PartnerType;
    const application = app.data as RecData | InstData;
    const blockers = activationBlockers(type, application, app.agreement_version, app.signed_at);
    if (blockers.length && !data.overrideReason) throw new WorkflowError(`${blockers.join(" ")} Enter an office override reason to proceed.`);
    const preflightWorkers = activationWorkers(type, application, "00000000-0000-0000-0000-000000000000", app.id);
    if (!preflightWorkers.length || preflightWorkers.some((worker) => !worker.full_legal_name || !worker.email)) throw new WorkflowError("Every nominated worker needs a complete profile before approval.");
    const proposedItems = approvedRateItems(type, application);
    if (!proposedItems.length) throw new WorkflowError("No valid agreed rates were found in the signed application.");
    if (!application.bank_account_name || !application.bank_bsb || !application.bank_account_number) throw new WorkflowError("Complete bank details are required in the signed onboarding application.");
    const abn = application.abn?.replace(/\s/g, "") ?? null;
    let { data: business } = abn ? await admin.from("businesses").select("id").eq("abn", abn).maybeSingle() : { data: null };
    if (!business) {
      const { data: created, error: createError } = await admin.from("businesses").insert({
        name: application.trading_name || application.legal_entity_name || "Partner business",
        legal_name: application.legal_entity_name ?? null, trading_name: application.trading_name ?? null, abn,
        business_type: type === "rec" ? "rec" : "eec_installer", capabilities: [type === "rec" ? "electrician" : "installer"],
        email: application.business_email ?? null, phone: application.business_phone ?? null, address: application.business_address ?? null,
        service_regions: [application.service_origin, application.travel_radius_km === 9999 ? "Anywhere in Victoria" : application.travel_radius_km ? `${application.travel_radius_km} km radius` : null].filter((x): x is string => !!x),
         declared_service_origin: application.service_origin ?? null, declared_travel_radius_km: application.travel_radius_km ?? null,
         declared_excluded_areas: application.excluded_areas ?? null,
         free_measureups_for_hivic_quote_leads: type === "installer" ? (application as InstData).free_measureups_for_hivic_quote_leads ?? null : null,
        weekly_capacity: Number.parseInt(application.capacity_band ?? "", 10) || null,
        rec_number: type === "rec" ? (application as RecData).rec_registration_number ?? null : null,
        installer_certification: type === "installer" ? { status: (application as InstData).cii_status, details: (application as InstData).cii_details } : {},
        gst_registered: application.gst_registered ?? null, onboarding_status: "approved", approved_by: context.userId, approved_at: new Date().toISOString(), is_active: true, xero_contact_status: "ready",
      } as never).select("id").single();
      if (createError || !created) throw new WorkflowError(createError?.message ?? "Could not create the partner business.");
      business = created;
    }
    const now = new Date().toISOString();
    const workers = activationWorkers(type, application, business.id, app.id);
    const { error: workersError } = await admin.from("partner_workers").upsert(workers as never, { onConflict: "business_id,email" });
    if (workersError) throw new WorkflowError(workersError.message);
    const { error: credentialError } = await admin.from("business_credentials").insert({ business_id: business.id, kind: "public_liability_insurance", label: "Public liability insurance", number: application.insurance_policy_number ?? null, issuer: application.insurer ?? null, expires_at: application.public_liability_expiry ?? null, critical: true, document_path: app.insurance_certificate_path, verification: "verified", verified_by: context.userId, verified_at: now, created_by: context.userId });
    if (credentialError) throw new WorkflowError(credentialError.message);
    const { data: latest } = await admin.from("rate_cards").select("version").eq("business_id", business.id).eq("kind", type === "rec" ? "electrical" : "installer").order("version", { ascending: false }).limit(1).maybeSingle();
    const version = (latest?.version ?? 0) + 1;
    await admin.from("rate_cards").update({ is_active: false }).eq("business_id", business.id).eq("kind", type === "rec" ? "electrical" : "installer").eq("is_active", true);
    const { data: card, error: cardError } = await admin.from("rate_cards").insert({ kind: type === "rec" ? "electrical" : "installer", business_id: business.id, name: `${application.trading_name || application.legal_entity_name} agreed rates`, version, is_active: true }).select("id").single();
    if (cardError || !card) throw new WorkflowError(cardError?.message ?? "Could not create the agreed rate card.");
    const items = proposedItems.map((item) => ({ ...item, rate_card_id: card.id }));
    const { error: itemError } = await admin.from("rate_card_items").insert(items as never);
    if (itemError) throw new WorkflowError(itemError.message);
    const { error: agreementError } = await admin.from("partner_agreements").insert({ business_id: business.id, version: app.agreement_version ?? "unknown", body: app.agreement_text ?? "", signer_name: app.signer_name ?? "Unknown", signed_at: app.signed_at ?? now, ip: app.signed_ip, user_agent: app.signed_user_agent, snapshot: { application_id: app.id, acknowledgements: app.acknowledgements } as Json, snapshot_sha256: app.agreement_sha256 ?? "" });
    if (agreementError) throw new WorkflowError(agreementError.message);
    const { error: bankError } = await admin.from("business_bank_details").upsert({ business_id: business.id, account_name: application.bank_account_name, bsb: application.bank_bsb, account_number: application.bank_account_number, updated_by: context.userId, updated_at: now, supplied_at: app.signed_at ?? now, supplied_by: context.userId, review_status: "pending", reviewed_by: null, reviewed_at: null });
    if (bankError) throw new WorkflowError(bankError.message);
    await admin.from("business_bank_detail_events").insert({ business_id: business.id, actor_id: context.userId, event_type: "supplied", details: { source: "signed_onboarding", application_id: app.id, bsb_last3: application.bank_bsb.replace(/\D/g, "").slice(-3), account_last3: application.bank_account_number.slice(-3) } as Json });
    const snapshot = { application_id: app.id, agreement_version: app.agreement_version, agreement_sha256: app.agreement_sha256, rates: items, bank_details_supplied: true, blockers } as unknown as Json;
    const { error: activationError } = await admin.from("partner_activations").insert({ application_id: app.id, partner_enquiry_id: app.partner_enquiry_id, business_id: business.id, partner_type: type, rate_card_id: card.id, activated_by: context.userId, override_reason: data.overrideReason ?? null, snapshot });
    if (activationError) throw new WorkflowError(activationError.message);
    await admin.from("partner_enquiries").update({ status: "approved", approved_at: now, status_changed_by: context.userId }).eq("id", app.partner_enquiry_id);
    return { business_id: business.id, rate_card_id: card.id, alreadyActivated: false as const };
  });
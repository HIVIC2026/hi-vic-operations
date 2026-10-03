import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, WorkflowError } from "./workflow.server";
import { activationBlockers, certificationRecordErrors, latestCertifications, mandatoryActivationBlockers, planActivation, type CertVerification, type PartnerType } from "./partner-activation.core";
import type { RecData } from "./rec-onboarding.core";
import type { InstData } from "./installer-onboarding.core";

const uuid = z.string().uuid();

type AdminDb = typeof import("@/integrations/supabase/client.server").supabaseAdmin;
async function loadCertifications(admin: AdminDb, applicationId: string) {
  const { data, error } = await admin.from("partner_worker_certifications").select("id, worker_email, status, recorded_at, certificate_number").eq("application_id", applicationId);
  if (error) throw new WorkflowError("Could not load certification checks.");
  return latestCertifications((data ?? []) as CertVerification[]);
}

export const activatePartnerApplication = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ applicationId: uuid, overrideReason: z.string().trim().min(10).max(2000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: app, error } = await admin.from("rec_onboarding_applications").select("*").eq("id", data.applicationId).single();
    if (error || !app) throw new WorkflowError("Application not found.");
    const { data: existing } = await admin.from("partner_activations").select("business_id, rate_card_id").eq("application_id", data.applicationId).maybeSingle();
    if (existing) return { ...existing, alreadyActivated: true as const };
    if (app.status !== "submitted" || !app.partner_enquiry_id) throw new WorkflowError("A complete signed application is required.");
    if (app.test_mode) throw new WorkflowError("Test applications can never be approved as real partners.");
    const type = app.partner_type as PartnerType;
    const application = app.data as RecData | InstData;
    const certs = await loadCertifications(admin, app.id);
    // Mandatory qualification can never be overridden.
    const mandatory = mandatoryActivationBlockers(type, application, certs);
    if (mandatory.length) throw new WorkflowError(mandatory.join(" "));
    const blockers = activationBlockers(type, application, app.agreement_version, app.signed_at);
    if (blockers.length && !data.overrideReason) throw new WorkflowError(`${blockers.join(" ")} Enter an office override reason to proceed.`);
    const plan = planActivation(type, app as never, application, certs, blockers);
    if (!plan.workers.length || plan.workers.some((w) => !w.full_legal_name || !w.email)) throw new WorkflowError("Every nominated worker needs a complete profile before approval.");
    if (!plan.items.length) throw new WorkflowError("No valid agreed rates were found in the signed application.");
    if (!plan.bank.account_name || !plan.bank.bsb || !plan.bank.account_number) throw new WorkflowError("Complete bank details are required in the signed onboarding application.");
    const { data: rows, error: rpcError } = await admin.rpc("activate_partner_application", { _app_id: app.id, _actor: context.userId, _override: data.overrideReason ?? null, _plan: plan as unknown as Json } as never);
    if (rpcError) throw new WorkflowError(`Activation did not complete; nothing was approved. (${rpcError.message})`);
    const r = (rows as unknown as { outcome: string; business_id: string; rate_card_id: string }[])[0]!;
    return { business_id: r.business_id, rate_card_id: r.rate_card_id, alreadyActivated: r.outcome === "already_activated" };
  });

/** Office records a CII certification check for one nominated installer. Append-only; latest decision wins. */
export const recordWorkerCertification = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    applicationId: uuid, workerEmail: z.string().trim().toLowerCase().email().max(320),
    status: z.enum(["verified", "rejected"]), evidenceSource: z.enum(["certificate_sighted", "issuer_register_checked"]),
    evidenceNote: z.string().trim().max(2000), certificateNumber: z.string().trim().max(80).optional(), issuer: z.string().trim().max(200).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const errs = certificationRecordErrors({ status: data.status, evidence_source: data.evidenceSource, evidence_note: data.evidenceNote, certificate_number: data.certificateNumber ?? null });
    if (errs.length) throw new WorkflowError(errs.join(" "));
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    // One transaction: append the office decision and keep any activated worker record in step.
    // A rejection of an already-approved installer moves them to rejected (never blocked by their prior approval).
    const { error } = await admin.rpc("record_worker_certification" as never, {
      _app_id: data.applicationId, _email: data.workerEmail, _status: data.status, _source: data.evidenceSource,
      _note: data.evidenceNote, _number: data.certificateNumber || null, _issuer: data.issuer || null, _actor: context.userId,
    } as never);
    if (error) {
      const m = error.message;
      if (m.includes("cert:not_nominated")) throw new WorkflowError("That person is not a nominated installer on this application.");
      if (m.includes("cert:not_found")) throw new WorkflowError("Installer application not found.");
      throw new WorkflowError(`Could not record the check; nothing was changed. (${m})`);
    }
    return { ok: true as const };
  });

export const listWorkerCertifications = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ applicationId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: rows, error } = await context.supabase.from("partner_worker_certifications").select("id, worker_email, status, certificate_number, issuer, evidence_source, evidence_note, recorded_at").eq("application_id", data.applicationId).order("recorded_at", { ascending: false });
    if (error) throw new WorkflowError("Could not load certification checks.");
    return rows ?? [];
  });

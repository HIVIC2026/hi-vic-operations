import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, WorkflowError } from "./workflow.server";
import { activationBlockers, certificationRecordErrors, latestCertifications, mandatoryActivationBlockers, planActivation, type CertVerification, type PartnerType } from "./partner-activation.core";
import type { RecData } from "./rec-onboarding.core";
import type { InstData } from "./installer-onboarding.core";

const uuid = z.string().uuid();

async function loadCertifications(admin: { from: (t: string) => unknown }, applicationId: string) {
  const { data, error } = await (admin as never as { from: (t: "partner_worker_certifications") => { select: (c: string) => { eq: (k: string, v: string) => Promise<{ data: CertVerification[] | null; error: unknown }> } } })
    .from("partner_worker_certifications").select("id, worker_email, status, recorded_at").eq("application_id", applicationId);
  if (error) throw new WorkflowError("Could not load certification checks.");
  return latestCertifications(data ?? []);
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
    const certs = await loadCertifications(admin as never, app.id);
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
    const errs = certificationRecordErrors({ status: data.status, evidence_source: data.evidenceSource, evidence_note: data.evidenceNote, certificate_number: data.certificateNumber });
    if (errs.length) throw new WorkflowError(errs.join(" "));
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: app } = await admin.from("rec_onboarding_applications").select("id, partner_type, data").eq("id", data.applicationId).single();
    if (!app || app.partner_type !== "installer") throw new WorkflowError("Installer application not found.");
    const worker = ((app.data as InstData).installers ?? []).find((w) => (w.email ?? "").trim().toLowerCase() === data.workerEmail);
    if (!worker) throw new WorkflowError("That person is not a nominated installer on this application.");
    const { data: pw } = await admin.from("partner_workers").select("id").eq("source_application_id", app.id).eq("email", data.workerEmail).maybeSingle();
    const { error } = await admin.from("partner_worker_certifications").insert({
      application_id: app.id, worker_id: pw?.id ?? null, worker_email: data.workerEmail, status: data.status,
      certificate_number: data.certificateNumber || null, issuer: data.issuer || null,
      evidence_source: data.evidenceSource, evidence_note: data.evidenceNote, recorded_by: context.userId,
    });
    if (error) throw new WorkflowError(`Could not record the check. (${error.message})`);
    // Keep an already-activated worker record in step (DB trigger blocks approval while unverified).
    if (pw) {
      const { error: wErr } = await admin.from("partner_workers").update({ certification_status: data.status, ...(data.status === "rejected" ? { approval_status: "pending" } : {}) }).eq("id", pw.id);
      if (wErr) throw new WorkflowError(`Check recorded, but the worker record was not updated. (${wErr.message})`);
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

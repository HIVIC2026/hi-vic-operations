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
    const { data: decided } = await admin.from("application_reviews" as never).select("decision").eq("application_id", data.applicationId).maybeSingle();
    if (decided) throw new WorkflowError((decided as { decision: string }).decision === "declined" ? "This application was declined." : "This application was sent back for changes — approve the re-signed one instead.");
    if (app.status !== "submitted" || !app.partner_enquiry_id) throw new WorkflowError("A complete signed application is required.");
    if (app.test_mode) throw new WorkflowError("Test applications can never be approved as real partners.");
    const { data: testMark } = await admin.from("onboarding_test_marks").select("application_id").eq("application_id", app.id).maybeSingle();
    const type = app.partner_type as PartnerType;
    const application = app.data as RecData | InstData;
    // Jo's own test applications (office test mark) are approved as TEST partners only, and only for her test address.
    const isTest = !!testMark;
    if (isTest) {
      const { testApprovalBlocker } = await import("./test-approval.core");
      const tb = testApprovalBlocker({ testMode: !!app.test_mode });
      if (tb) throw new WorkflowError(tb);
    }
    const certs = await loadCertifications(admin, app.id);
    // Mandatory qualification can never be overridden.
    const mandatory = mandatoryActivationBlockers(type, application, certs);
    if (mandatory.length) throw new WorkflowError(mandatory.join(" "));
    const blockers = activationBlockers(type, application, app.agreement_version, app.signed_at);
    if (blockers.length && !data.overrideReason) throw new WorkflowError(`${blockers.join(" ")} Enter an office override reason to proceed.`);
    const plan = planActivation(type, app as never, application, certs, blockers);
    if (!plan.workers.length || plan.workers.some((w) => !w.full_legal_name || !w.email)) throw new WorkflowError("Every nominated worker needs a complete profile before approval.");
    if (!plan.items.length) throw new WorkflowError("No valid agreed rates were found in the signed application.");
    // A counter-offer, once made, governs the rate card: never the original proposal.
    const { offerState, offerActivationBlocker, applyAgreedRates } = await import("./rate-offer.core");
    const { data: offerRows, error: offerErr } = await (admin as unknown as { from: (t: string) => any }).from("partner_rate_offers").select("id, round, status, items, note, gst_registered, created_at, responded_at, response").eq("application_id", app.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (offerErr) throw new WorkflowError("Could not check rate offers; nothing was approved.");
    const offer = offerState(offerRows ?? []);
    const offerBlock = offerActivationBlocker(offer);
    if (offerBlock) throw new WorkflowError(offerBlock);
    if (offer.kind === "accepted") {
      plan.items = applyAgreedRates(plan.items, offer.offer);
      (plan as unknown as { snapshot: Record<string, unknown> }).snapshot = { ...(plan as unknown as { snapshot: Record<string, unknown> }).snapshot, rates: plan.items, rate_offer_id: offer.offer.id, rate_offer_round: offer.offer.round, rate_source: "accepted_counter_offer" };
    }
    if (!plan.bank.account_name || !plan.bank.bsb || !plan.bank.account_number) throw new WorkflowError("Complete bank details are required in the signed onboarding application.");
    if (isTest) {
      // Never reconcile into a real business: fake 12-digit ABN on a business that is TEST-marked before approval.
      const { prepareTestBusiness } = await import("./test-approval.server");
      const { testBusinessName } = await import("./test-approval.core");
      (plan as { abn: string | null }).abn = await prepareTestBusiness(app.id, plan.business.name, plan.business.business_type);
      plan.business.name = testBusinessName(plan.business.name);
    }
    const { data: rows, error: rpcError } = await admin.rpc("activate_partner_application", { _app_id: app.id, _actor: context.userId, _override: data.overrideReason ?? null, _plan: plan as unknown as Json } as never);
    if (rpcError?.message.includes("activate:no_verified_installer")) throw new WorkflowError("No installer on this application has a current office-verified CII certification (a later check may have rejected it). Nothing was approved.");
    if (rpcError) throw new WorkflowError(`Activation did not complete; nothing was approved. (${rpcError.message})`);
    const r = (rows as unknown as { outcome: string; business_id: string; rate_card_id: string }[])[0]!;
    // One tidy profile on the same business row; the approval message is queued, never sent here.
    const { loadProfileInputs, applyPartnerProfile, queueApprovalMessage } = await import("./partner-profile.server");
    const { buildPartnerProfile } = await import("./partner-profile.core");
    const inputs = await loadProfileInputs(admin, app.id);
    await applyPartnerProfile(admin, r.business_id, buildPartnerProfile(inputs.meta, inputs.data, inputs.cii, inputs.existingCapabilities), context.userId);
    if (isTest) {
      const d = application as { primary_contact_name?: string };
      const { sendTestWelcome } = await import("./test-approval.server");
      const w = await sendTestWelcome({ businessId: r.business_id, name: d.primary_contact_name ?? app.signer_name ?? null, role: type === "installer" ? "installer" : "electrician", actorId: context.userId, appId: app.id });
      return { business_id: r.business_id, rate_card_id: r.rate_card_id, alreadyActivated: r.outcome === "already_activated", welcome: `TEST welcome email ${w.status === "sent" ? "sent" : `not sent (${w.detail})`} to ${w.to}` };
    }
    // Real partners: the approval message is queued for the office, never sent here (until Jo approves wording and turns sending on).
    await queueApprovalMessage(admin, r.business_id);
    return { business_id: r.business_id, rate_card_id: r.rate_card_id, alreadyActivated: r.outcome === "already_activated", welcome: null as string | null };
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
      if (m.includes("cert:worker_role_conflict")) throw new WorkflowError("That email belongs to a non-installer worker in this business; nothing was changed.");
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

/** Office records Full/Provisional + expiry for the latest verified certification. Append-only. */
export const recordCertificationLevel = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ applicationId: uuid, workerEmail: z.string().trim().toLowerCase().email().max(320), level: z.enum(["full", "provisional"]), expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { recordCertLevel } = await import("./prestart.server");
    return recordCertLevel({ ...data, actorId: context.userId });
  });

export const listCertificationLevels = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ applicationId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: certs } = await context.supabase.from("partner_worker_certifications").select("id").eq("application_id", data.applicationId);
    const ids = (certs ?? []).map((c) => c.id);
    if (!ids.length) return [];
    const { data: rows } = await context.supabase.from("worker_certification_levels").select("certification_id, level, expires_on, recorded_at").in("certification_id", ids).order("recorded_at", { ascending: false });
    return rows ?? [];
  });

/** Office creates the business boss's sign-in for an ACTIVATED partner. Sends nothing: returns a set-password link for the office to pass on. */
export const createPartnerLogin = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ applicationId: uuid, email: z.string().trim().toLowerCase().email().max(320) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: act } = await admin.from("partner_activations").select("business_id").eq("application_id", data.applicationId).maybeSingle();
    if (!act) throw new WorkflowError("Activate the partner first.");
    const { data: app } = await admin.from("rec_onboarding_applications").select("partner_type, test_mode, data").eq("id", data.applicationId).single();
    if (!app || app.test_mode) throw new WorkflowError("Not available for test applications.");
    const d = app.data as { business_email?: string; installers?: { email?: string; full_legal_name?: string }[]; primary_contact_name?: string };
    const allowed = [d.business_email, ...(d.installers ?? []).map((w) => w.email)].filter(Boolean).map((e) => e!.trim().toLowerCase());
    if (!allowed.includes(data.email)) throw new WorkflowError("Use the business email or a nominated worker's email from the signed application.");
    const role = app.partner_type === "installer" ? "installer" : "electrician";
    const name = (d.installers ?? []).find((w) => w.email?.trim().toLowerCase() === data.email)?.full_legal_name ?? d.primary_contact_name ?? null;
    const { data: existing } = await admin.from("profiles").select("id, business_id").eq("email", data.email).maybeSingle();
    if (existing?.business_id && existing.business_id !== act.business_id) throw new WorkflowError("That email already belongs to another business. Nothing was changed.");
    let uid = existing?.id;
    if (!uid) {
      // email_confirm avoids the confirmation email; createUser itself sends nothing.
      const { data: cu, error } = await admin.auth.admin.createUser({ email: data.email, email_confirm: true, password: crypto.randomUUID() + "Aa1!", user_metadata: { full_name: name } });
      if (error || !cu.user) throw new WorkflowError(`Could not create the login: ${error?.message}`);
      uid = cu.user.id;
    }
    const steps = [
      await admin.from("profiles").upsert({ id: uid, email: data.email, full_name: name, business_id: act.business_id }),
      await admin.from("user_roles").upsert({ user_id: uid, role }, { onConflict: "user_id,role" }),
      await admin.from("business_members").upsert({ business_id: act.business_id, user_id: uid, member_role: "business_admin", active: true, added_by: context.userId }, { onConflict: "business_id,user_id" }),
      await admin.from("partner_workers").update({ profile_id: uid, account_status: "linked", linked_by: context.userId, linked_at: new Date().toISOString() }).eq("business_id", act.business_id).ilike("email", data.email).is("profile_id", null),
    ];
    const bad = steps.find((s) => s.error);
    if (bad?.error) throw new WorkflowError(`Login made but linking failed: ${bad.error.message}`);
    // generateLink returns the link only; it never emails it.
    const link = await (await import("./set-password-link.server")).issueSetPasswordLink(data.email);
    await admin.from("admin_config_events").insert({ actor_id: context.userId, event_type: "partner_login_created", summary: `Office created partner login ${data.email} (nothing sent)`, details: { business_id: act.business_id, user_id: uid, application_id: data.applicationId } });
    return { email: data.email, link };
  });

/** Office: send a signed installer application back for changes, or decline it (Jo, 7 Oct). */
export const decidePartnerApplication = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ applicationId: uuid, decision: z.enum(["changes_requested", "declined"]), message: z.string().max(2000).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { decideApplication } = await import("./application-review.server");
    return decideApplication(context.userId, data.applicationId, data.decision, data.message);
  });

/** Office: the recorded decision (if any) for one application. */
export const getApplicationReview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ applicationId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: r } = await admin.from("application_reviews" as never).select("decision,message,email_status,email_detail,created_at,reopened_application_id").eq("application_id", data.applicationId).maybeSingle();
    return (r as { decision: string; message: string | null; email_status: string; email_detail: string | null; created_at: string; reopened_application_id: string | null } | null) ?? null;
  });

// No-login owner actions on the secure link (Jo-approved 5 Oct). Each signed action needs a fresh 6-digit code session.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta } from "./request-meta";

const token = z.string().max(200);
const session = z.string().min(40).max(80);
const picks = z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slot: z.enum(["8-10", "10-12", "12-14", "14-16"]) })).min(1).max(5);
const signer = { signatoryName: z.string().trim().min(2).max(200), authorityType: z.enum(["owner", "authorised_representative"]), signatureName: z.string().trim().min(2).max(200) };

export const ownerCodeOptionsFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token }).parse(d))
  .handler(async ({ data }) => (await import("./owner-verify.server")).ownerCodeOptions(data.token));

export const requestOwnerCodeFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, channel: z.enum(["sms", "email"]) }).parse(d))
  .handler(async ({ data }) => (await import("./owner-verify.server")).requestOwnerCode(data.token, data.channel));

export const verifyOwnerCodeFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, code: z.string().regex(/^\d{6}$/) }).parse(d))
  .handler(async ({ data }) => (await import("./owner-verify.server")).verifyOwnerCode(data.token, data.code));

/** Agreement wording + package for the owner's current quote (read-only; link token only). */
export const ownerAgreementFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, quoteId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { resolveOwnerJob } = await import("./owner-myjob.server");
    const v = await resolveOwnerJob(data.token);
    if (!v?.quote || v.quote.id !== data.quoteId) throw new Error("Quote not found");
    const { buildAcceptancePackage, loadTemplates } = await import("./assignment.server");
    const { templateBlockers } = await import("./assignment.core");
    const templates = await loadTemplates();
    const pick = (k: string) => { const t = templates.find((x) => x.template_key === k && x.approved); return t ? { version: t.version, body: t.body } : null; };
    const pkg = await buildAcceptancePackage(data.quoteId);
    return JSON.parse(JSON.stringify({ signatory: pkg.consumer?.name ?? null, paymentTerms: pkg.payment_terms, consumerRights: pick("consumer_rights"), agreementWording: pick("customer_agreement"), blockers: templateBlockers(templates, "agreement") }));
  });

export const ownerAcceptQuoteFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({
    token, session, quoteId: z.string().uuid(), expectedVersion: z.number().int(),
    signing: z.object({ ...signer, over18: z.boolean(), readConsumerInfo: z.boolean(), acceptAgreement: z.boolean(), assistance: z.enum(["none", "interpreter", "support_understanding", "both"]) }),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerSession } = await import("./owner-verify.server");
    const s = await ownerSession(data.token, data.session);
    const { respondToQuoteImpl } = await import("./portal.functions");
    const { WorkflowError } = await import("./workflow.server");
    return respondToQuoteImpl({ quoteId: data.quoteId, accept: true, consent: true, expectedVersion: data.expectedVersion, signing: data.signing }, {
      userId: s.userId, ip: context.ip, userAgent: context.userAgent,
      authorize: async (jobId) => { if (jobId !== s.jobId) throw new WorkflowError("This quote isn't on your job."); },
      isOwner: async (jobId) => jobId === s.jobId,
    });
  });

/** Jo 24 Oct: "Not for me" on the secure link — no 6-digit code (it signs nothing). Same quote/stage checks as accept. */
export const ownerDeclineQuoteFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, quoteId: z.string().uuid(), reason: z.enum(["price", "timing", "changed_mind", "other"]).nullable(), note: z.string().trim().max(800).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const jobId = await ownerJobId(data.token);
    const { WorkflowError } = await import("./workflow.server");
    if (!jobId) throw new WorkflowError("This link isn't working any more. Please reply to our email.");
    const { declineReasonText } = await import("./quote-decline.core");
    const { respondToQuoteImpl } = await import("./portal.functions");
    return respondToQuoteImpl({ quoteId: data.quoteId, accept: false, reason: declineReasonText(data.reason, data.note) ?? undefined }, {
      userId: null as unknown as string, ip: context.ip, userAgent: context.userAgent,
      authorize: async (j) => { if (j !== jobId) throw new WorkflowError("This quote isn't on your job."); },
      isOwner: async (j) => j === jobId,
    });
  });

export const ownerBookingStateFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token }).parse(d))
  .handler(async ({ data }) => {
    const jobId = await ownerJobId(data.token);
    if (!jobId) return null;
    const [{ ownerPiesaWindowState }, { ownerInstallDayState }] = await Promise.all([import("./allocation.server"), import("./install-days.server")]);
    const { ownerThirtyDayAckState } = await import("./thirty-day-ack.server");
    const { ownerPiesaBookingState } = await import("./visit-events.server");
    const [piesa, install, ack, piesaBooked] = await Promise.all([ownerPiesaWindowState(jobId), ownerInstallDayState(jobId), ownerThirtyDayAckState(jobId), ownerPiesaBookingState(jobId)]);
    return JSON.parse(JSON.stringify({ piesa: { canPick: piesa.canPick, windows: piesa.windows.map((w) => ({ starts_at: w.starts_at, ends_at: w.ends_at })), thirtyDayAck: { needed: ack.needed, wording: ack.wording }, booked: piesaBooked }, install: { turn: install.turn, days: install.days, deadline: install.deadline, daysLeft: install.daysLeft, open: install.open, bookedAt: install.bookedAt } }));
  });

/** Decision 337: the owner changes the booked safety check (PIESA) from My job → the electrician is told, new times go
 *  out as a new offer. Same 6-digit code session as the other booking actions. */
export const ownerChangePiesaFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, session }).parse(d))
  .handler(async ({ data }) => {
    const s = await (await import("./owner-verify.server")).ownerSession(data.token, data.session);
    const r = await (await import("./visit-events.server")).ownerChangeBookedPiesa(s.jobId, s.userId);
    return JSON.parse(JSON.stringify(r));
  });

/** Decision 307 (Jo 25 Oct 2026): the owner must tick the 30-day-rule box (`understandsThirtyDays: true`) before the
 *  first PIESA times of each PIESA cycle; refused otherwise, recorded once per cycle (thirty-day-ack.server). */
export const ownerChoosePiesaFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, session, picks, understandsThirtyDays: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const s = await (await import("./owner-verify.server")).ownerSession(data.token, data.session);
    await (await import("./thirty-day-ack.server")).requireOwnerThirtyDayAck({ jobId: s.jobId, userId: s.userId, understandsThirtyDays: data.understandsThirtyDays, ip: context.ip, userAgent: context.userAgent });
    return (await import("./allocation.server")).submitOwnerPiesaWindows(s.jobId, s.userId, data.picks);
  });

export const ownerTakeInstallDayFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, session, proposalId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await (await import("./owner-verify.server")).ownerSession(data.token, data.session);
    return (await import("./install-days.server")).ownerTakeDay(s.jobId, data.proposalId, s.userId);
  });

export const ownerChangeInstallDayFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, session }).parse(d))
  .handler(async ({ data }) => {
    const s = await (await import("./owner-verify.server")).ownerSession(data.token, data.session);
    return (await import("./install-days.server")).changeInstallDay(s.jobId, s.userId, "owner");
  });

export const ownerSuggestInstallDaysFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, session, days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(5) }).parse(d))
  .handler(async ({ data }) => {
    const s = await (await import("./owner-verify.server")).ownerSession(data.token, data.session);
    return (await import("./install-days.server")).ownerSuggestDays(s.jobId, s.userId, data.days);
  });

/** Jo 24 Oct 2026 (decision 52): our-lead Ready Check — the installer's 3 times (times only, no installer contact). */
export const ownerReadyCheckTimesFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token }).parse(d))
  .handler(async ({ data }) => {
    const jobId = await ownerJobId(data.token);
    if (!jobId) return null;
    return JSON.parse(JSON.stringify(await (await import("./ready-check-times.server")).ownerReadyCheckTimesState(jobId)));
  });

export const ownerTakeReadyCheckTimeFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, session, proposalId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await (await import("./owner-verify.server")).ownerSession(data.token, data.session);
    return (await import("./ready-check-times.server")).ownerTakeReadyCheckTime(s.jobId, data.proposalId, s.userId);
  });

export const ownerSuggestReadyCheckDaysFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, session, days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(5) }).parse(d))
  .handler(async ({ data }) => {
    const s = await (await import("./owner-verify.server")).ownerSession(data.token, data.session);
    return (await import("./ready-check-times.server")).ownerSuggestReadyCheckDays(s.jobId, s.userId, data.days);
  });

/** Decision 80: owner "Change time" on a booked our-lead Ready Check → back to the installer to offer new times. */
export const ownerChangeReadyCheckFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, session }).parse(d))
  .handler(async ({ data }) => {
    const s = await (await import("./owner-verify.server")).ownerSession(data.token, data.session);
    return (await import("./ready-check-times.server")).ownerChangeReadyCheck(s.jobId, s.userId);
  });

export const ownerSignConsentFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  // Approved P3 page (decision 128): the four Section 2 ticks travel with the signature; `signOwnerConsent` still enforces them.
  .inputValidator((d) => z.object({ token, session, ...signer, accept: z.boolean(), declarations: z.object({ owner_or_authorised: z.boolean(), details_accurate: z.boolean(), consent_ap_sends: z.boolean(), consent_commission_shares: z.boolean() }).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const s = await (await import("./owner-verify.server")).ownerSession(data.token, data.session);
    const { signOwnerConsent } = await import("./consent.server");
    await signOwnerConsent({ jobId: s.jobId, actorId: s.userId, input: { signatoryName: data.signatoryName, authorityType: data.authorityType, accept: data.accept, signatureName: data.signatureName, declarations: data.declarations }, ip: context.ip, userAgent: context.userAgent });
    return { ok: true };
  });

/** Official VEEC assignment form (decision 119): read-only Section 2 + declarations for the owner's job, with signing state. */
export const ownerVeecAssignmentFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token }).parse(d))
  .handler(async ({ data }) => {
    const jobId = await ownerJobId(data.token);
    if (!jobId) return null;
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: a } = await admin.from("customer_assignments").select("id, status, final_facts, installer_signed_at, ap_signed_at, consumer_signed_at, consumer_declaration_version, final_copy_path, copy_sent_at").eq("job_id", jobId).eq("record_kind", "final_veec_assignment").neq("status", "cancelled").maybeSingle();
    const { data: job } = await admin.from("jobs").select("installation_completed_at").eq("id", jobId).maybeSingle();
    if (!job?.installation_completed_at) return null;
    const F = await import("./veec-assignment-form.core");
    const facts = (a?.final_facts ?? null) as { form_values?: Record<string, string | number | boolean | null> } | null;
    return JSON.parse(JSON.stringify({
      status: a?.status ?? "not_prepared", canSign: a?.status === "awaiting_consumer_signature", signedAt: a?.consumer_signed_at ?? null, copyReady: !!a?.final_copy_path, copySentAt: a?.copy_sent_at ?? null,
      waitingOn: !a ? "installer" : !a.installer_signed_at ? "installer" : !a.ap_signed_at ? "ap" : null,
      version: a?.consumer_declaration_version ?? F.VEEC_FORM_VERSION, rows: facts?.form_values ? F.veecFormRows(facts.form_values) : [],
      rights: F.SECTION_1_CONSUMER_RIGHTS, apDeclaration: F.AP_DECLARATION, installerDeclaration: F.INSTALLER_DECLARATION, consumerDeclaration: F.CONSUMER_DECLARATION,
    }));
  });

/** Owner signs Section 4 Part B via the secure link after a fresh 6-digit code (the last signature; copy within 10 business days). */
export const ownerSignVeecAssignmentFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, session, ...signer, over18: z.boolean(), confirmsSection2: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const s = await (await import("./owner-verify.server")).ownerSession(data.token, data.session);
    const { signFinalAssignment } = await import("./assignment.server");
    await signFinalAssignment({ jobId: s.jobId, actorId: s.userId, party: "consumer", signatureName: data.signatureName, signatoryName: data.signatoryName, authorityType: data.authorityType, over18: data.over18, confirmsSection2: data.confirmsSection2, ip: context.ip, userAgent: context.userAgent });
    const { autoAdvanceJob } = await import("./autoadvance.server");
    await autoAdvanceJob(s.jobId, s.userId, "owner signed the VEEC assignment form");
    // Executed copy to the owner (within 10 business days): best-effort now, the 15-minute tick retries until sent.
    try { await (await import("./veec-copy-email.server")).sendVeecCopyEmail(s.jobId); } catch (e) { console.error("VEEC copy email failed", (e as Error).message); }
    return { ok: true };
  });

/** Decision 296: what the owner confirms about the electrician's PIESA (date, electrician, result, warning) — null when there is no PIESA yet. Link token only (read). */
export const ownerPiesaConfirmFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token }).parse(d))
  .handler(async ({ data }) => {
    const jobId = await ownerJobId(data.token);
    if (!jobId) return null;
    const { ownerPiesaConfirmFacts } = await import("./piesa-owner-confirm.server");
    const { piesaConfirmPage } = await import("./piesa-owner-confirm.core");
    const facts = await ownerPiesaConfirmFacts(jobId);
    return facts ? JSON.parse(JSON.stringify(piesaConfirmPage(facts))) as ReturnType<typeof piesaConfirmPage> : null;
  });

/** Decision 296: the owner confirms the PIESA via the secure link (typed full name = signature, one tick). Idempotent per PIESA.
 *  Decision 306 (Jo 25 Oct 2026): "Drop the code" — the secure link alone, no 6-digit code. */
export const ownerSignPiesaConfirmFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, ...signer, confirmed: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const jobId = await ownerJobId(data.token);
    const { WorkflowError } = await import("./workflow.server");
    if (!jobId) throw new WorkflowError("This link isn't working any more. Please reply to our email.");
    const { signOwnerPiesaConfirmation } = await import("./piesa-owner-confirm.server");
    return signOwnerPiesaConfirmation({ jobId, userId: null, codeId: null, fullName: data.signatoryName, signatureName: data.signatureName, authority: data.authorityType, confirmed: data.confirmed, ip: context.ip, userAgent: context.userAgent });
  });

/** Decision 330: what the owner confirms about the electrical fixes (date, electrician) — null when no fixes are recorded. Link token only (read). */
export const ownerFixesConfirmFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token }).parse(d))
  .handler(async ({ data }) => {
    const jobId = await ownerJobId(data.token);
    if (!jobId) return null;
    const { ownerFixesConfirmFacts } = await import("./piesa-fixes-confirm.server");
    const { piesaFixesConfirmPage } = await import("./piesa-fixes-confirm.core");
    const facts = await ownerFixesConfirmFacts(jobId);
    return facts ? JSON.parse(JSON.stringify(piesaFixesConfirmPage(facts))) as ReturnType<typeof piesaFixesConfirmPage> : null;
  });

/** Decision 330: the owner confirms the electrical fixes via the secure link (one tick + typed full name, no code). Idempotent per fixes record. */
export const ownerSignFixesConfirmFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, ...signer, confirmed: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const jobId = await ownerJobId(data.token);
    const { WorkflowError } = await import("./workflow.server");
    if (!jobId) throw new WorkflowError("This link isn't working any more. Please reply to our email.");
    const { signOwnerFixesConfirmation } = await import("./piesa-fixes-confirm.server");
    return signOwnerFixesConfirmation({ jobId, fullName: data.signatoryName, signatureName: data.signatureName, authority: data.authorityType, confirmed: data.confirmed, ip: context.ip, userAgent: context.userAgent });
  });

/** Decision 144: owner "Pay now by card" → Stripe Checkout for the step that is due ($349 safety check or electrical fixes only).
 *  Link token only: the page merely opens Stripe's own payment page for our exact amount; no money moves without Stripe's flow. */
export const ownerCardCheckoutFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token }).parse(d))
  .handler(async ({ data }) => {
    const jobId = await ownerJobId(data.token);
    if (!jobId) return { blocker: "Link not recognised." };
    const { CUSTOMER_BASE } = await import("./engagement.core");
    return (await import("./stripe.server")).createStepCheckout(jobId, `${CUSTOMER_BASE}/my-job/${data.token}`, null);
  });

async function ownerJobId(t: string): Promise<string | null> {
  const { isWellFormedToken, LINK_PURPOSE, linkUsable } = await import("./estimatelink.core");
  if (!isWellFormedToken(t)) return null;
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", t).eq("purpose", LINK_PURPOSE).maybeSingle();
  return l && linkUsable(l) ? l.job_id : null;
}

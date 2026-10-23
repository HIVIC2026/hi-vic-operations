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
    const [piesa, install] = await Promise.all([ownerPiesaWindowState(jobId), ownerInstallDayState(jobId)]);
    return JSON.parse(JSON.stringify({ piesa: { canPick: piesa.canPick, windows: piesa.windows.map((w) => ({ starts_at: w.starts_at, ends_at: w.ends_at })) }, install: { canPick: install.canPick, days: install.days, deadline: install.deadline, openDays: install.openDays } }));
  });

export const ownerChoosePiesaFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, session, picks }).parse(d))
  .handler(async ({ data }) => {
    const s = await (await import("./owner-verify.server")).ownerSession(data.token, data.session);
    return (await import("./allocation.server")).submitOwnerPiesaWindows(s.jobId, s.userId, data.picks);
  });

export const ownerChooseInstallDaysFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, session, days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(5) }).parse(d))
  .handler(async ({ data }) => {
    const s = await (await import("./owner-verify.server")).ownerSession(data.token, data.session);
    return (await import("./install-days.server")).submitOwnerInstallDays(s.jobId, s.userId, data.days);
  });

export const ownerSignConsentFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, session, ...signer, accept: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const s = await (await import("./owner-verify.server")).ownerSession(data.token, data.session);
    const { signOwnerConsent } = await import("./consent.server");
    await signOwnerConsent({ jobId: s.jobId, actorId: s.userId, input: { signatoryName: data.signatoryName, authorityType: data.authorityType, accept: data.accept, signatureName: data.signatureName }, ip: context.ip, userAgent: context.userAgent });
    return { ok: true };
  });

async function ownerJobId(t: string): Promise<string | null> {
  const { isWellFormedToken, LINK_PURPOSE, linkUsable } = await import("./estimatelink.core");
  if (!isWellFormedToken(t)) return null;
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", t).eq("purpose", LINK_PURPOSE).maybeSingle();
  return l && linkUsable(l) ? l.job_id : null;
}

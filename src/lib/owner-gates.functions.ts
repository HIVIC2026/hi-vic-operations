// Owner paperwork gates — RPC. Owner signs via secure link + code session, or signed in; office records landlord consent and approves wording.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withRequestMeta } from "./request-meta";

const DOC_KEYS = ["contact_privacy", "trade_contact_share", "details_confirmation", "life_support_answer", "tenancy_details", "landlord_consent", "visit_permission", "cooling_off_notice", "payment_terms", "life_support_plan", "piesa_owner_declaration"] as const;
const signBody = { key: z.enum(DOC_KEYS), signatoryName: z.string().trim().min(2).max(200), ticked: z.boolean(), answers: z.record(z.string(), z.string().max(300)).default({}) };

/** Link: what the owner still needs to sign (no session needed to read). */
export const ownerPaperworkFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { isWellFormedToken, LINK_PURPOSE, linkUsable } = await import("./estimatelink.core");
    if (!isWellFormedToken(data.token)) return null;
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", data.token).eq("purpose", LINK_PURPOSE).maybeSingle();
    if (!l || !linkUsable(l)) return null;
    return JSON.parse(JSON.stringify(await (await import("./owner-gates.server")).ownerPaperworkToSign(l.job_id)));
  });

export const ownerSignPaperworkFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200), session: z.string().min(40).max(80), ...signBody }).parse(d))
  .handler(async ({ data, context }) => {
    const s = await (await import("./owner-verify.server")).ownerSession(data.token, data.session);
    const { signGateDoc } = await import("./owner-gates.server");
    return signGateDoc({ jobId: s.jobId, key: data.key, signatoryName: data.signatoryName, ticked: data.ticked, answers: data.answers, method: "link_code", signedBy: s.userId, ip: context.ip, userAgent: context.userAgent, verified: { channel: s.channel, destination: s.destination, codeId: s.codeId } });
  });

/** Signed-in owner (portal login still works). */
export const signPaperworkFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth, withRequestMeta])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), ...signBody }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: own } = await context.supabase.rpc("is_job_owner", { _job: data.jobId, _user: context.userId });
    if (!own) throw new Error("Only the owner can sign this.");
    const { signGateDoc } = await import("./owner-gates.server");
    return signGateDoc({ jobId: data.jobId, key: data.key, signatoryName: data.signatoryName, ticked: data.ticked, answers: data.answers, method: "login", signedBy: context.userId, ip: context.ip, userAgent: context.userAgent });
  });

export const ownerPaperworkForOwnerFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: own } = await context.supabase.rpc("is_job_owner", { _job: data.jobId, _user: context.userId });
    if (!own) throw new Error("Not your job.");
    return JSON.parse(JSON.stringify(await (await import("./owner-gates.server")).ownerPaperworkToSign(data.jobId)));
  });

/** Office: A/B/C/D strip for a job. */
export const jobPaperworkFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await (await import("./workflow.server")).requireAdmin(context.supabase as never);
    const { gates, facts } = await (await import("./owner-gates.server")).ownerGates(data.jobId);
    return JSON.parse(JSON.stringify({ gates, isTest: facts.isTest, tenant: facts.tenant }));
  });

/** Office records the landlord's consent (tenant jobs). */
export const recordLandlordConsentFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth, withRequestMeta])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), recordedBy: z.string().trim().min(2).max(200), landlordName: z.string().trim().min(2).max(200), howReceived: z.string().trim().min(3).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    await (await import("./workflow.server")).requireAdmin(context.supabase as never);
    const { signGateDoc } = await import("./owner-gates.server");
    return signGateDoc({ jobId: data.jobId, key: "landlord_consent", signatoryName: data.recordedBy, ticked: true, answers: { landlord_name: data.landlordName, how_received: data.howReceived }, method: "office", signedBy: context.userId, ip: context.ip, userAgent: context.userAgent });
  });

export const paperworkCatalogueFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await (await import("./workflow.server")).requireAdmin(context.supabase as never);
    const { paperworkCatalogue } = await import("./owner-gates.server");
    const { GATE_DOCS } = await import("./owner-gates.core");
    return JSON.parse(JSON.stringify({ docs: await paperworkCatalogue(), bodies: Object.fromEntries(GATE_DOCS.map((d) => [d.key, d.body])) }));
  });

export const approvePaperworkFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ key: z.enum(DOC_KEYS), version: z.string().max(40), confirm: z.literal("APPROVE") }).parse(d))
  .handler(async ({ data, context }) => {
    await (await import("./workflow.server")).requireAdmin(context.supabase as never);
    await (await import("./owner-gates.server")).approvePaperwork(data.key, data.version, context.userId);
    return { ok: true };
  });

// Office counter-offers on signed partner applications, and the partner's single-purpose response link.
// Nothing here sends email or SMS; "Send by email" is refused while partner sending is off.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, WorkflowError } from "./workflow.server";
import { withRequestMeta } from "./request-meta";
import { baselineForNewRound, offerErrors, offerState, offerTermsText, proposedRates, RATE_OFFER_TERMS_VERSION, type OfferItem, type OfferRow } from "./rate-offer.core";
import type { PartnerType } from "./partner-activation.core";
import type { RecData } from "./rec-onboarding.core";
import type { InstData } from "./installer-onboarding.core";

/** Partner rate-offer emails stay off until Jo switches partner sending on. */
export const PARTNER_RATE_OFFER_EMAIL_ENABLED = false;

const uuid = z.string().uuid();
const tokenSchema = z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/);
async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function admin() { return (await import("@/integrations/supabase/client.server")).supabaseAdmin; }
type Db = Awaited<ReturnType<typeof admin>>;
const db_ = (d: Db) => d as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function loadApp(db: Db, id: string) {
  const { data, error } = await db.from("rec_onboarding_applications").select("id, partner_type, status, data, agreement_version, signer_name, test_mode").eq("id", id).maybeSingle();
  if (error || !data) throw new WorkflowError("Application not found.");
  return data;
}
async function loadOffers(db: Db, applicationId: string): Promise<OfferRow[]> {
  const { data, error } = await db_(db).from("partner_rate_offers").select("id, round, status, items, note, gst_registered, created_at, responded_at, response").eq("application_id", applicationId).order("round");
  if (error) throw new WorkflowError("Could not load rate offers.");
  return (data ?? []) as OfferRow[];
}
const partnerName = (d: { trading_name?: string; legal_entity_name?: string }) => d.trading_name || d.legal_entity_name || "your business";

export const getRateOffers = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ applicationId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const db = await admin();
    const app = await loadApp(db, data.applicationId);
    const offers = await loadOffers(db, app.id);
    const type = app.partner_type as PartnerType;
    return { offers, state: offerState(offers), baseline: baselineForNewRound(type, app.data as RecData | InstData, offers), gst_registered: (app.data as { gst_registered?: boolean }).gst_registered === true, emailEnabled: PARTNER_RATE_OFFER_EMAIL_ENABLED };
  });

const itemSchema = z.object({ code: z.string().max(60), description: z.string().max(300), unit: z.string().max(20), display_unit: z.string().max(40).optional(), partner_inc_gst: z.number().finite().min(0).max(100000), offer_inc_gst: z.number().finite().min(0).max(100000) });

export const createRateOffer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ applicationId: uuid, items: z.array(itemSchema).min(1).max(80), note: z.string().trim().max(2000).optional() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const db = await admin();
    const app = await loadApp(db, data.applicationId);
    if (app.status !== "submitted") throw new WorkflowError("Only signed applications can be counter-offered.");
    const { data: act } = await db.from("partner_activations").select("application_id").eq("application_id", app.id).maybeSingle();
    if (act) throw new WorkflowError("This partner is already activated; rates can no longer be counter-offered here.");
    const offers = await loadOffers(db, app.id);
    const state = offerState(offers);
    if (state.kind === "waiting") throw new WorkflowError("A counter-offer is already waiting for the partner.");
    if (state.kind === "accepted") throw new WorkflowError("The partner already accepted our offer. Activate with the agreed rates.");
    // Their figures always come from the server (application or their last counter), never from the browser.
    const baseline = baselineForNewRound(app.partner_type as PartnerType, app.data as RecData | InstData, offers);
    const byCode = new Map(data.items.map((i) => [i.code, i.offer_inc_gst]));
    const items: OfferItem[] = baseline.map((b) => ({ ...b, offer_inc_gst: Math.round((byCode.get(b.code) ?? b.offer_inc_gst) * 100) / 100 }));
    const errs = offerErrors(items, baseline.map((b) => b.code));
    if (errs.length) throw new WorkflowError(errs.join(" "));
    const token = newToken();
    const { error } = await db_(db).from("partner_rate_offers").insert({
      application_id: app.id, round: (offers.at(-1)?.round ?? 0) + 1, items, note: data.note || null,
      gst_registered: (app.data as { gst_registered?: boolean }).gst_registered === true, token_hash: await sha256(token), created_by: context.userId,
    });
    if (error) throw new WorkflowError(`Could not save the counter-offer. (${error.message})`);
    return { token, path: `/rate-offer/${token}` };
  });

export const sendRateOfferEmail = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ applicationId: uuid }).parse(d))
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    if (!PARTNER_RATE_OFFER_EMAIL_ENABLED) throw new WorkflowError("Partner sending is switched off. Nothing was sent — use \"Copy link for partner\" and contact them yourself.");
    throw new WorkflowError("Partner rate-offer email is not set up yet. Nothing was sent.");
  });

// ---------- Partner side (token link) ----------
async function findOffer(token: string) {
  const db = await admin();
  const { data, error } = await db_(db).from("partner_rate_offers").select("id, application_id, round, status, items, note, gst_registered, created_at, responded_at, response").eq("token_hash", await sha256(token)).maybeSingle();
  if (error) throw new Error("Could not load this rate offer.");
  if (!data) throw new Error("This rate offer link is not valid.");
  const app = await loadApp(db, (data as { application_id: string }).application_id);
  return { db, offer: data as OfferRow & { application_id: string }, app };
}
const publicOffer = (offer: OfferRow, app: { data: unknown; agreement_version: string | null; signer_name: string | null }) => {
  const text = offerTermsText(partnerName(app.data as never), app.agreement_version, offer);
  return { round: offer.round, status: offer.status, items: offer.items, note: offer.note, partner: partnerName(app.data as never), agreement_version: app.agreement_version, signer_name: app.signer_name, text, responded_at: offer.responded_at };
};

export const loadRateOffer = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema }).parse(d))
  .handler(async ({ data }) => {
    const { offer, app } = await findOffer(data.token);
    const p = publicOffer(offer, app);
    return { ...p, sha256: await sha256(p.text) };
  });

export const acceptRateOffer = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: tokenSchema, signer_name: z.string().trim().min(2).max(200), signer_position: z.string().trim().min(2).max(100), agreed: z.literal(true), terms_sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { db, offer, app } = await findOffer(data.token);
    if (offer.status !== "sent") throw new Error("This rate offer has already been answered.");
    const text = publicOffer(offer, app).text;
    if ((await sha256(text)) !== data.terms_sha256) throw new Error("This offer changed. Reload the page.");
    const response = { kind: "accepted", signer_name: data.signer_name, signer_position: data.signer_position, terms_version: RATE_OFFER_TERMS_VERSION, terms_sha256: data.terms_sha256, terms_text: text, agreement_version: app.agreement_version, ip: context.ip, user_agent: context.userAgent, signed_at: new Date().toISOString() };
    const { data: row, error } = await db_(db).from("partner_rate_offers").update({ status: "accepted", responded_at: response.signed_at, response }).eq("id", offer.id).eq("status", "sent").select("id").maybeSingle();
    if (error || !row) throw new Error("This rate offer has already been answered.");
    return { ok: true };
  });

export const declineRateOffer = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: tokenSchema, proposed: z.record(z.string().max(60), z.number().finite().min(0).max(100000)).optional(), message: z.string().trim().max(2000).optional() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { db, offer } = await findOffer(data.token);
    if (offer.status !== "sent") throw new Error("This rate offer has already been answered.");
    const codes = new Set(offer.items.map((i) => i.code));
    const proposed = Object.fromEntries(Object.entries(data.proposed ?? {}).filter(([k]) => codes.has(k)));
    const response = { kind: "declined", proposed, message: data.message || null, ip: context.ip, user_agent: context.userAgent, at: new Date().toISOString() };
    const { data: row, error } = await db_(db).from("partner_rate_offers").update({ status: "declined", responded_at: response.at, response }).eq("id", offer.id).eq("status", "sent").select("id").maybeSingle();
    if (error || !row) throw new Error("This rate offer has already been answered.");
    return { ok: true };
  });

export { proposedRates };

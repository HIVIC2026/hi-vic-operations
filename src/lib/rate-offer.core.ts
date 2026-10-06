// Pure rules for office counter-offers on a signed partner application's proposed rates.
// Figures are shown and agreed inc GST; the rate card stores ex GST (divided by 1.1 only when GST registered).
import { approvedRateItems, type PartnerType } from "./partner-activation.core";
import type { RecData } from "./rec-onboarding.core";
import type { InstData } from "./installer-onboarding.core";
import type { Json } from "@/integrations/supabase/types";

export type OfferItem = { code: string; description: string; unit: string; display_unit?: string; partner_inc_gst: number; offer_inc_gst: number };
export type OfferStatus = "sent" | "accepted" | "declined" | "superseded";
export type OfferRow = { id: string; round: number; status: OfferStatus; items: OfferItem[]; note: string | null; gst_registered: boolean; created_at: string; responded_at: string | null; response: { [k: string]: Json | undefined } | null };

export const RATE_OFFER_TERMS_VERSION = "rate-offer-v1";
const cents = (n: number) => Math.round(n * 100) / 100;

/** The partner's proposed rates (inc GST), one row per rated item on the application. */
export function proposedRates(type: PartnerType, data: RecData | InstData): OfferItem[] {
  const gst = (data as { gst_registered?: boolean | null }).gst_registered === true;
  return approvedRateItems(type, data).map((r) => {
    const inc = cents(gst ? r.unit_price_ex_gst * 1.1 : r.unit_price_ex_gst);
    return { code: r.code, description: r.description, unit: r.unit, ...("display_unit" in r && r.display_unit ? { display_unit: String(r.display_unit) } : {}), partner_inc_gst: inc, offer_inc_gst: inc };
  });
}

/** Their figure for a new round: the partner's last proposal if they declined with new figures, else the application. */
export function baselineForNewRound(type: PartnerType, data: RecData | InstData, offers: OfferRow[]): OfferItem[] {
  const base = proposedRates(type, data);
  const last = latestOffer(offers);
  const counter = last?.status === "declined" ? (last.response?.["proposed"] as unknown as Record<string, number> | undefined) : undefined;
  if (!last) return base;
  return last.items.map((i) => {
    const p = counter?.[i.code];
    const theirs = typeof p === "number" && Number.isFinite(p) && p >= 0 ? cents(p) : i.partner_inc_gst;
    return { ...i, partner_inc_gst: theirs, offer_inc_gst: i.offer_inc_gst };
  });
}

export function offerErrors(items: OfferItem[], expectedCodes: string[]): string[] {
  const errs: string[] = [];
  const codes = new Set(items.map((i) => i.code));
  if (codes.size !== items.length) errs.push("Each rate may appear once.");
  for (const c of expectedCodes) if (!codes.has(c)) errs.push(`Missing rate ${c}.`);
  for (const i of items) if (!Number.isFinite(i.offer_inc_gst) || i.offer_inc_gst < 0 || i.offer_inc_gst > 100000) errs.push(`Enter a valid offer for ${i.description}.`);
  if (items.length && items.every((i) => cents(i.offer_inc_gst) === cents(i.partner_inc_gst))) errs.push("The offer matches their rates exactly — use \"Accept rates and activate partner\" instead.");
  return errs;
}

export function latestOffer(offers: OfferRow[]): OfferRow | null {
  return [...offers].sort((a, b) => b.round - a.round)[0] ?? null;
}

export type OfferState = { kind: "none" } | { kind: "waiting"; offer: OfferRow } | { kind: "accepted"; offer: OfferRow } | { kind: "declined"; offer: OfferRow };
export function offerState(offers: OfferRow[]): OfferState {
  const o = latestOffer(offers);
  if (!o) return { kind: "none" };
  if (o.status === "sent") return { kind: "waiting", offer: o };
  if (o.status === "accepted") return { kind: "accepted", offer: o };
  return { kind: "declined", offer: o };
}

export const OFFER_STATE_LABEL: Record<OfferState["kind"], string> = {
  none: "No counter-offer",
  waiting: "Counter-offer sent – waiting for partner",
  accepted: "Partner accepted our rate offer – ready to activate with agreed rates",
  declined: "Partner declined our offer – start a new round",
};

/** Activation is blocked while an offer is open or declined; it never falls back to the original proposal. */
export function offerActivationBlocker(state: OfferState): string | null {
  if (state.kind === "waiting") return "A counter-offer is waiting for the partner. Activate only after they accept.";
  if (state.kind === "declined") return "The partner declined our counter-offer. Send a new offer, or accept their rates in a new round.";
  return null;
}

/** Rate card items with agreed figures substituted (ex GST). Every activation item must be covered by the accepted offer. */
export function applyAgreedRates<T extends { code: string; unit_price_ex_gst: number }>(items: T[], offer: OfferRow): T[] {
  const byCode = new Map(offer.items.map((i) => [i.code, i]));
  return items.map((it) => {
    const agreed = byCode.get(it.code);
    if (!agreed) throw new Error(`Agreed rate missing for ${it.code}.`);
    return { ...it, unit_price_ex_gst: cents(offer.gst_registered ? agreed.offer_inc_gst / 1.1 : agreed.offer_inc_gst) };
  });
}

/** The exact text the partner agrees to; its SHA-256 is recorded with the acceptance. */
export function offerTermsText(partnerName: string, agreementVersion: string | null, offer: Pick<OfferRow, "round" | "items" | "note">): string {
  const lines = offer.items.map((i) => `- ${i.description} (${i.display_unit ?? i.unit}): $${i.offer_inc_gst.toFixed(2)} inc GST (you proposed $${i.partner_inc_gst.toFixed(2)})`);
  return [
    `Rate offer from Home Insulation Victoria to ${partnerName} (round ${offer.round}).`,
    `These rates replace the rates in your signed partner agreement${agreementVersion ? ` (${agreementVersion})` : ""}. All other terms of that agreement stay the same.`,
    ...lines,
    ...(offer.note ? [`Note from the office: ${offer.note}`] : []),
  ].join("\n");
}

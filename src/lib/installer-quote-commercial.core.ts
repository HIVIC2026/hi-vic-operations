// Installer's own quoted works — commercial facts (Jo, 20 Oct 2026). Pure; no I/O.
// Physical removal facts (required yes/no/uncertain + m²) live in RemovalQuote; HOW removal/extras are priced lives here.
// Nothing here assumes gross, GST or a price: missing/unsure/net-of-discount values save for review and block a
// confirmed owner total at the guarded quote boundaries (installerIntakeState -> intakeSendBlockers / draft).
import type { RemovalQuote } from "./intake-quote-details.core";

export type PriceBasis = "before_discount" | "after_discount" | "unsure";
export type GstBasis = "inc_gst" | "ex_gst" | "unsure";
export type OriginalQuoteStatus = "prepared" | "sent" | "accepted_by_customer";
export type ChargePricing = "included" | "additional" | "not_priced";
export type QuoteExtra = { description: string; pricing: ChargePricing; amountIncGst: number | null };
export type QuoteCommercial = {
  basis: PriceBasis | null; gst: GstBasis | null; inclusions: string | null; exclusions: string | null;
  originalStatus: OriginalQuoteStatus | null; removalPricing: ChargePricing | null; removalAmountIncGst: number | null; extras: QuoteExtra[];
};
export const blankCommercial = (): QuoteCommercial => ({ basis: null, gst: null, inclusions: null, exclusions: null, originalStatus: null, removalPricing: null, removalAmountIncGst: null, extras: [] });

const pick = <T extends string>(v: unknown, ok: readonly T[]): T | null => (typeof v === "string" && (ok as readonly string[]).includes(v) ? v as T : null);
const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 2000) : null);
const PRICING = ["included", "additional", "not_priced"] as const;

/** Defensive read of a stored record. Unknown/historic values stay null (never assumed gross or inc GST). */
export function readCommercial(v: unknown): QuoteCommercial | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const extras = Array.isArray(r["extras"]) ? (r["extras"] as unknown[]).flatMap((e) => {
    const x = (e ?? {}) as Record<string, unknown>; const d = text(x["description"]); const p = pick(x["pricing"], PRICING);
    return d && p ? [{ description: d, pricing: p, amountIncGst: p === "additional" ? money(x["amountIncGst"]) : null }] : [];
  }).slice(0, 20) : [];
  const removalPricing = pick(r["removalPricing"], PRICING);
  return {
    basis: pick(r["basis"], ["before_discount", "after_discount", "unsure"] as const), gst: pick(r["gst"], ["inc_gst", "ex_gst", "unsure"] as const),
    inclusions: text(r["inclusions"]), exclusions: text(r["exclusions"]), originalStatus: pick(r["originalStatus"], ["prepared", "sent", "accepted_by_customer"] as const),
    removalPricing, removalAmountIncGst: removalPricing === "additional" ? money(r["removalAmountIncGst"]) : null, extras,
  };
}

const badMoney = (n: number | null) => n != null && (!Number.isFinite(n) || n < 0 || n > 1_000_000);
/** SAVE-time checks: only impossible/contradictory values. Missing information is allowed (draft registration). */
export function commercialInputProblems(c: QuoteCommercial, removal: RemovalQuote | null): string[] {
  const p: string[] = [];
  if (badMoney(c.removalAmountIncGst)) p.push("Enter the additional removal price as dollars inc GST.");
  if (removal?.answer === "no" && c.removalPricing === "additional") p.push("Removal is marked not required, so it can't have an additional price.");
  for (const e of c.extras) { if (!e.description.trim()) p.push("Describe each extra charge."); if (badMoney(e.amountIncGst)) p.push(`Enter the price of "${e.description}" as dollars inc GST.`); }
  return p;
}

/**
 * Quote-readiness blockers for a QUOTED intake job. Enforced only at the existing guarded draft/release/approve/accept
 * boundaries, never at job creation. A null record (historic job) needs clarification — never assumed gross.
 */
export function commercialBlockers(c: QuoteCommercial | null, removal: RemovalQuote | null): string[] {
  if (!c) return ["Clarify the installer quote: price basis (before VEU discount?), GST and removal pricing are not recorded"];
  const b: string[] = [];
  if (c.basis === "after_discount") b.push("The installer quote is already discounted — enter the price before the VEU discount so the discount is applied once");
  else if (c.basis !== "before_discount") b.push("Confirm the installer quote is the price before the VEU discount");
  if (c.gst === "ex_gst") b.push("The installer quote is ex GST — enter the amount including GST (GST is never calculated for you)");
  else if (c.gst !== "inc_gst") b.push("Confirm the installer quote amount includes GST");
  if (removal?.answer === "yes") {
    if (c.removalPricing == null || c.removalPricing === "not_priced") b.push("Removal is required but not priced — say whether it is in the works total or an additional agreed price");
    else if (c.removalPricing === "additional" && !(c.removalAmountIncGst != null && c.removalAmountIncGst > 0)) b.push("Enter the agreed additional removal price inc GST");
  }
  for (const e of c.extras) {
    if (e.pricing === "not_priced") b.push(`Extra "${e.description}" is not priced yet`);
    else if (e.pricing === "additional" && !(e.amountIncGst != null && e.amountIncGst > 0)) b.push(`Enter the agreed price for extra "${e.description}" inc GST`);
  }
  return b;
}

export type SeparateLine = { code: "INSTALLER_REMOVAL" | "INSTALLER_EXTRA"; description: string; amountIncGst: number };
/** Only separately agreed (additional) removal/extras become their own lines; "included" never adds money again. */
export function separatelyPricedLines(c: QuoteCommercial | null, removal: RemovalQuote | null): SeparateLine[] {
  if (!c) return [];
  const out: SeparateLine[] = [];
  if (removal?.answer === "yes" && c.removalPricing === "additional" && c.removalAmountIncGst != null && c.removalAmountIncGst > 0)
    out.push({ code: "INSTALLER_REMOVAL", description: `Removal of existing insulation${removal.areaM2 ? ` (${removal.areaM2} m²)` : ""} — agreed additional price`, amountIncGst: c.removalAmountIncGst });
  for (const e of c.extras) if (e.pricing === "additional" && e.amountIncGst != null && e.amountIncGst > 0) out.push({ code: "INSTALLER_EXTRA", description: e.description, amountIncGst: e.amountIncGst });
  return out;
}

/** Plain summary of removal: separates "not required" from pricing. Never says "included" for an unpriced removal. */
export function removalFactSummary(r: RemovalQuote | null, c: QuoteCommercial | null): string {
  if (!r || r.answer === "unknown") return "Removal: not yet known — office confirmation needed before quote release";
  if (r.answer === "no") return "Removal: not required";
  const area = `${r.areaM2 ?? "area unknown"}${r.areaM2 != null ? " m²" : ""}`;
  const priced = c?.removalPricing === "included" ? "included in the works total"
    : c?.removalPricing === "additional" ? (c.removalAmountIncGst != null ? `additional agreed price $${c.removalAmountIncGst} inc GST` : "additional price not entered yet")
    : "not priced yet";
  return `Removal required: ${area} — ${priced}`;
}

export const ORIGINAL_STATUS_LABEL: Record<OriginalQuoteStatus, string> = { prepared: "Prepared", sent: "Sent to their customer", accepted_by_customer: "Accepted by their customer" };
/** Installer-customer acceptance is history only — never HIVIC acceptance, statutory consent or a signature. */
export const ORIGINAL_STATUS_NOTE = "History only — this is not the owner's acceptance of the Home Insulation Victoria quote, consent or a signature.";

/** Wire shape (zod lives in the .functions files; this keeps the bounds in one place). */
export const COMMERCIAL_LIMITS = { text: 1000, extras: 20, money: 1_000_000 } as const;

/** Form state (strings for money so blank stays blank — never 0). */
export type CommercialInput = Omit<QuoteCommercial, "removalAmountIncGst" | "extras"> & { removalAmount: string; extras: { description: string; pricing: ChargePricing; amount: string }[] };
export const blankCommercialInput = (): CommercialInput => ({ basis: null, gst: null, inclusions: null, exclusions: null, originalStatus: null, removalPricing: null, removalAmount: "", extras: [] });
const num = (v: string) => (v.trim() ? Number(v.replace(/[$,\s]/g, "")) : null);
export function commercialPayload(i: CommercialInput, includes: string | null, removalRequired: boolean): QuoteCommercial {
  return {
    basis: i.basis, gst: i.gst, inclusions: includes?.trim() || null, exclusions: i.exclusions?.trim() || null, originalStatus: i.originalStatus,
    removalPricing: removalRequired ? i.removalPricing : null, removalAmountIncGst: removalRequired && i.removalPricing === "additional" ? num(i.removalAmount) : null,
    extras: i.extras.filter((e) => e.description.trim()).map((e) => ({ description: e.description.trim(), pricing: e.pricing, amountIncGst: e.pricing === "additional" ? num(e.amount) : null })),
  };
}
export function commercialInputFrom(c: QuoteCommercial | null | undefined): CommercialInput {
  if (!c) return blankCommercialInput();
  return { basis: c.basis, gst: c.gst, inclusions: c.inclusions, exclusions: c.exclusions, originalStatus: c.originalStatus, removalPricing: c.removalPricing, removalAmount: c.removalAmountIncGst == null ? "" : String(c.removalAmountIncGst), extras: c.extras.map((e) => ({ description: e.description, pricing: e.pricing, amount: e.amountIncGst == null ? "" : String(e.amountIncGst) })) };
}

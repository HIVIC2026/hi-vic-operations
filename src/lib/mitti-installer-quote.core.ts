import { buildInstallerQuoteDraft } from "./installer-led.core";
import { productQuoteDescription } from "./insulation-product.core";
import { IN_HOUSE_PIESA_HOLD_REASON } from "./installer-paid-electricians.core";
import { OWN_CUSTOMER_AP_FEE_INC_GST, OWN_CUSTOMER_LABELS } from "./own-customer-price.core";
import { MITTI_INSTALLER_FEE_INC_GST, type MittiElectricianResolution } from "./usual-electrician.core";

/**
 * Own customers (channel installer_sourced, Ready Check A1). Jo 4 Nov 2026 (final; supersedes the 2 Nov "$349 whatever
 * the rate"): owner's price = installer's price (+ separately agreed extras) + $349 Home Insulation Victoria fee + the
 * installer's own PIESA rate − rebate. `electrician.priceIncGst` on an own-customer job IS that rate (`mittiElectricianForJob`
 * → `withOwnerSafetyCheckPrice` puts the business's rate-card PIESA line there and holds when there is none), and the same
 * amount is paid through in full — Home Insulation Victoria keeps nothing on that line. Lines carry the approved labels
 * and order: Insulation · (extras) · Home Insulation Victoria fee · Electrical safety check (PIESA).
 * `electrician.reasons` (not onboarded, no PIESA rate, no usual electrician saved…) still hold the quote.
 */
export function buildMittiInstallerQuote(input: OwnCustomerDraftInput, electrician: MittiElectricianResolution) {
  const draft = buildOwnCustomerQuoteDraft(input, electrician.ready ? electrician.priceIncGst : null);
  for (const r of electrician.reasons) if (!draft.blockers.includes(r)) draft.blockers.push(r);
  draft.ready = draft.blockers.length === 0;
  return draft;
}

export type OwnCustomerDraftInput = Omit<Parameters<typeof buildInstallerQuoteDraft>[0], "piesaIncGst" | "apFeeIncGst">;

/**
 * The own-customer owner lines from the business's PIESA rate — the one builder behind both the Ready Check path
 * (`buildMittiInstallerQuote`) and the intake-price fallback in `installer-quote.server` (Task 2 review, judgement 4):
 * every `channel = installer_sourced` quote prices the $349 fee + the installer's PIESA rate (`piesaIncGst`, inc GST) with
 * the approved labels and order, whatever `jobs.electrician_choice` says. No rate (null / 0) → no PIESA line and the quote
 * holds with `IN_HOUSE_PIESA_HOLD_REASON` — never a default $349 (Jo 4 Nov 2026). Home Insulation Victoria leads never
 * come through here (`buildInstallerQuoteDraft` and `hiv-quote.core` are untouched).
 */
export function buildOwnCustomerQuoteDraft(input: OwnCustomerDraftInput, piesaIncGst: number | null) {
  const rate = piesaIncGst != null && Number.isFinite(piesaIncGst) && piesaIncGst > 0 ? Math.round(piesaIncGst * 100) / 100 : null;
  const draft = buildInstallerQuoteDraft({ ...input, piesaIncGst: rate, apFeeIncGst: OWN_CUSTOMER_AP_FEE_INC_GST });
  if (rate == null) {
    // The shared builder's generic "PIESA price not agreed" wording is replaced by the one rule everyone else reads.
    draft.blockers = [...draft.blockers.filter((b) => b !== "PIESA price not agreed for the chosen electrician."), IN_HOUSE_PIESA_HOLD_REASON];
    draft.ready = false;
  }
  const fee = draft.lines.find((l) => l.code === "AP_FEE");
  const piesa = draft.lines.find((l) => l.code === "PIESA");
  if (fee) { fee.description = OWN_CUSTOMER_LABELS.apFee; fee.sort = 1; }
  if (piesa) { piesa.description = OWN_CUSTOMER_LABELS.piesa; piesa.sort = 2; }
  // Stable: Insulation and extras keep their relative order (all sort 0) ahead of the fee and the PIESA.
  draft.lines = draft.lines.map((l, n) => [l, n] as const).sort((a, b) => a[0].sort - b[0].sort || a[1] - b[1]).map(([l]) => l);
  return draft;
}

/**
 * A snapshot-specific guard; never relaxes legacy payer checks or trusts a nomination as approval. Jo 4 Nov 2026: the
 * owner's PIESA line must be exactly one line at the business's CURRENT PIESA rate (`current.priceIncGst`): an older
 * held draft priced at a stale rate (or Part 10's fixed $349 when the rate is $275) holds and is never sent at that amount.
 * A changed electrician (identity or rate) still holds with "prepare a new quote" — the snapshot is the audit trail.
 */
export function mittiQuoteElectricalBlocker(lines: { code: string | null; line_total_inc_gst: number | string | null }[], saved: MittiElectricianResolution, current: MittiElectricianResolution | null) {
  if (!current?.ready || ["choice", "priceIncGst", "name", "licence", "source"].some((key) => saved[key as keyof MittiElectricianResolution] !== current[key as keyof MittiElectricianResolution])) return "Ready Check electrician details changed or are incomplete — prepare a new quote";
  const electrical = lines.filter((l) => l.code === "PIESA");
  const fees = lines.filter((l) => l.code === "AP_FEE");
  if (fees.length !== 1 || Number(fees[0]?.line_total_inc_gst) !== MITTI_INSTALLER_FEE_INC_GST) return "Ready Check quote must include the $349 Home Insulation Victoria fee";
  const rate = Number(current.priceIncGst);
  if (!(rate > 0) || electrical.length !== 1 || Math.abs(Number(electrical[0]?.line_total_inc_gst) - rate) > 0.005) return "Ready Check quote electrician price does not match the recorded choice";
  return null;
}
/** Jo 23 Oct: product description on the installer line; incomplete product holds the quote. */
export function applyMittiProduct(
  draft: { ready: boolean; blockers: string[]; lines: { code: string | null; description: string; explanation?: string | null }[] },
  product: import("./insulation-product.core").MittiProductResolution, areaM2: number | null,
) {
  if (!product.ready || !product.product) { draft.blockers.push(...product.reasons); draft.ready = false; return draft; }
  const line = draft.lines.find((l) => l.code === "INSTALLER_PRICE");
  if (line) line.description = productQuoteDescription(product.product, areaM2);
  return draft;
}

/** Jo 23 Oct: the removal total (sum of every area's removal m²) shows on the installer line; never priced twice. */
export function applyMittiRemoval(draft: { lines: { code: string | null; description: string }[] }, removalM2: number | null) {
  if (!(removalM2 && removalM2 > 0)) return draft;
  const line = draft.lines.find((l) => l.code === "INSTALLER_PRICE");
  if (line) line.description = `${line.description} · Removal of existing insulation – ${removalM2} m²`;
  return draft;
}

/** A1: a difficult access charge is INSIDE the installer's total (Jo 23 + 24 Oct) — shown on the line, never added. */
export function applyMittiAccessFeeIncluded(draft: { lines: { code: string | null; description: string }[] }, included: boolean, amountIncGst: number | null = null) {
  if (!included) return draft;
  const line = draft.lines.find((l) => l.code === "INSTALLER_PRICE");
  if (line) line.description = `${line.description} · Includes difficult access${amountIncGst ? ` ($${amountIncGst.toLocaleString("en-AU", { maximumFractionDigits: 2 })})` : " charge"}`;
  return draft;
}

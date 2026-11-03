import { buildInstallerQuoteDraft } from "./installer-led.core";
import { productQuoteDescription } from "./insulation-product.core";
import { OWN_CUSTOMER_AP_FEE_INC_GST, OWN_CUSTOMER_LABELS, OWN_CUSTOMER_PIESA_INC_GST } from "./own-customer-price.core";
import { MITTI_INSTALLER_FEE_INC_GST, type MittiElectricianResolution } from "./usual-electrician.core";

/**
 * Own customers (channel installer_sourced, Ready Check A1). Jo 2 Nov 2026 ("FEES … CORRECTION", Part 10):
 * owner's price = installer's price (+ separately agreed extras) + $349 Home Insulation Victoria fee + $349 PIESA − rebate.
 * The PIESA line is $349 whatever the electrician's own rate (`electrician.priceIncGst` is what the electrician is PAID;
 * Home Insulation Victoria keeps the difference — supersedes decisions 302/303 for the owner's price only). Lines carry
 * the approved labels and order: Insulation · (extras) · Home Insulation Victoria fee · Electrical safety check (PIESA).
 * `electrician.reasons` (not onboarded, no usual electrician saved…) still hold the quote.
 */
export function buildMittiInstallerQuote(input: OwnCustomerDraftInput, electrician: MittiElectricianResolution) {
  const draft = buildOwnCustomerQuoteDraft(input);
  draft.blockers.push(...electrician.reasons);
  draft.ready = draft.blockers.length === 0;
  return draft;
}

export type OwnCustomerDraftInput = Omit<Parameters<typeof buildInstallerQuoteDraft>[0], "piesaIncGst" | "apFeeIncGst">;

/**
 * The own-customer owner lines WITHOUT an electrician resolution — the one builder behind both the Ready Check path
 * (`buildMittiInstallerQuote`) and the intake-price fallback in `installer-quote.server` (Task 2 review, judgement 4):
 * every `channel = installer_sourced` quote prices the $349 fee + $349 PIESA with the approved labels and order, whatever
 * `jobs.electrician_choice` says. Home Insulation Victoria leads never come through here (`buildInstallerQuoteDraft` and
 * `hiv-quote.core` are untouched).
 */
export function buildOwnCustomerQuoteDraft(input: OwnCustomerDraftInput) {
  const draft = buildInstallerQuoteDraft({ ...input, piesaIncGst: OWN_CUSTOMER_PIESA_INC_GST, apFeeIncGst: OWN_CUSTOMER_AP_FEE_INC_GST });
  const fee = draft.lines.find((l) => l.code === "AP_FEE");
  const piesa = draft.lines.find((l) => l.code === "PIESA");
  if (fee) { fee.description = OWN_CUSTOMER_LABELS.apFee; fee.sort = 1; }
  if (piesa) { piesa.description = OWN_CUSTOMER_LABELS.piesa; piesa.sort = 2; }
  // Stable: Insulation and extras keep their relative order (all sort 0) ahead of the fee and the PIESA.
  draft.lines = draft.lines.map((l, n) => [l, n] as const).sort((a, b) => a[0].sort - b[0].sort || a[1] - b[1]).map(([l]) => l);
  return draft;
}

/**
 * A snapshot-specific guard; never relaxes legacy payer checks or trusts a nomination as approval. Since Part 10 the
 * owner's PIESA line must be exactly one line of $349 (`OWN_CUSTOMER_PIESA_INC_GST`), never the electrician's rate:
 * an older held draft still priced at the electrician's rate (e.g. $275) holds and is never sent at that amount.
 * A changed electrician (identity or pay rate) still holds with "prepare a new quote" — the snapshot is the audit trail.
 */
export function mittiQuoteElectricalBlocker(lines: { code: string | null; line_total_inc_gst: number | string | null }[], saved: MittiElectricianResolution, current: MittiElectricianResolution | null) {
  if (!current?.ready || ["choice", "priceIncGst", "name", "licence", "source"].some((key) => saved[key as keyof MittiElectricianResolution] !== current[key as keyof MittiElectricianResolution])) return "Ready Check electrician details changed or are incomplete — prepare a new quote";
  const electrical = lines.filter((l) => l.code === "PIESA");
  const fees = lines.filter((l) => l.code === "AP_FEE");
  if (fees.length !== 1 || Number(fees[0]?.line_total_inc_gst) !== MITTI_INSTALLER_FEE_INC_GST) return "Ready Check quote must include the $349 Home Insulation Victoria fee";
  if (electrical.length !== 1 || Number(electrical[0]?.line_total_inc_gst) !== OWN_CUSTOMER_PIESA_INC_GST) return "Ready Check quote electrician price does not match the recorded choice";
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

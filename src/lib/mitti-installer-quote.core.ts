import { buildInstallerQuoteDraft } from "./installer-led.core";
import { productQuoteDescription } from "./insulation-product.core";
import { MITTI_INSTALLER_FEE_INC_GST, type MittiElectricianResolution } from "./usual-electrician.core";

/** Jo 22 Oct: full installer amount + $349 AP fee + selected electrician − existing VEU rebate. */
export function buildMittiInstallerQuote(input: Omit<Parameters<typeof buildInstallerQuoteDraft>[0], "piesaIncGst" | "apFeeIncGst">, electrician: MittiElectricianResolution) {
  const draft = buildInstallerQuoteDraft({ ...input, piesaIncGst: electrician.priceIncGst, apFeeIncGst: MITTI_INSTALLER_FEE_INC_GST });
  draft.blockers.push(...electrician.reasons);
  draft.ready = draft.blockers.length === 0;
  return draft;
}

/** A snapshot-specific guard; never relaxes legacy payer checks or trusts a nomination as approval. */
export function mittiQuoteElectricalBlocker(lines: { code: string | null; line_total_inc_gst: number | string | null }[], saved: MittiElectricianResolution, current: MittiElectricianResolution | null) {
  if (!current?.ready || ["choice", "priceIncGst", "name", "licence", "source"].some((key) => saved[key as keyof MittiElectricianResolution] !== current[key as keyof MittiElectricianResolution])) return "Ready Check electrician details changed or are incomplete — prepare a new quote";
  const electrical = lines.filter((l) => l.code === "PIESA");
  const fees = lines.filter((l) => l.code === "AP_FEE");
  if (fees.length !== 1 || Number(fees[0]?.line_total_inc_gst) !== MITTI_INSTALLER_FEE_INC_GST) return "Ready Check quote must include the $349 Home Insulation Victoria fee";
  if (current.priceIncGst === 0 ? electrical.length !== 0 : electrical.length !== 1 || Number(electrical[0]?.line_total_inc_gst) !== current.priceIncGst) return "Ready Check quote electrician price does not match the recorded choice";
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

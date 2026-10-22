import { buildInstallerQuoteDraft } from "./installer-led.core";
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
  if (!current?.ready || JSON.stringify(saved) !== JSON.stringify(current)) return "Ready Check electrician details changed or are incomplete — prepare a new quote";
  const electrical = lines.filter((l) => l.code === "PIESA");
  const fees = lines.filter((l) => l.code === "AP_FEE");
  if (fees.length !== 1 || Number(fees[0]?.line_total_inc_gst) !== MITTI_INSTALLER_FEE_INC_GST) return "Ready Check quote must include the $349 Home Insulation Victoria fee";
  if (current.priceIncGst === 0 ? electrical.length !== 0 : electrical.length !== 1 || Number(electrical[0]?.line_total_inc_gst) !== current.priceIncGst) return "Ready Check quote electrician price does not match the recorded choice";
  return null;
}
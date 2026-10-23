// Jo 24 Oct 2026: the installer does NOT approve the quote. When the installer marks the Mitti Ready Check
// Complete and every check passes, the owner's quote (installer total, which includes any difficult access fee, + PIESA + $349
// AP fee − VEU rebate) goes to the owner automatically. Anything that fails a check is held for the office with the reason.
// A form edited after a quote was sent is flagged for the office; the sent quote is never changed. Pure rules only.

/** Jo 24 Oct: "manual for the first few weeks". Pressing Complete in Mitti prepares everything automatically
 *  (measurements, eligibility from the form, quote stage, quote) — this switch is ON — and the quote then waits on
 *  Quotes to check for the office to press Send. */
export const READY_CHECK_AUTO_PREP_ENABLED = true;
/** The automatic SEND to the owner: OFF for the first few weeks; Jo switches it on later. */
export const AUTO_QUOTE_SEND_ENABLED = false;

/** Jo 24 Oct: normal installer prices inc GST per m² (difficult access fee excluded). */
export const INSULATION_PER_M2 = { min: 15, max: 30 } as const;
export const REMOVAL_PER_M2 = { min: 5, max: 15 } as const;
/** Jo 24 Oct: difficult access fee limit inc GST. */
export const ACCESS_FEE_MAX = 500;

const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** The installer gives one total for insulation + removal (+ access fee, which the caller takes out first), checked
 *  against the combined normal range. */
export function installerPriceRangeHold(totalIncGst: number | null, areaM2: number | null, removalM2: number | null): string | null {
  if (!(totalIncGst && totalIncGst > 0) || !(areaM2 && areaM2 > 0)) return "Quote held: installer price or ceiling area missing, so the price can't be checked";
  const r = removalM2 && removalM2 > 0 ? removalM2 : 0;
  const min = INSULATION_PER_M2.min * areaM2 + REMOVAL_PER_M2.min * r;
  const max = INSULATION_PER_M2.max * areaM2 + REMOVAL_PER_M2.max * r;
  const range = `${money(min)}–${money(max)} for ${areaM2} m²${r ? ` + ${r} m² removal` : ""}`;
  if (totalIncGst < min) return `Quote held: installer price ${money(totalIncGst)} is below the normal range (${range})`;
  if (totalIncGst > max) return `Quote held: installer price ${money(totalIncGst)} is above the normal range (${range})`;
  return null;
}

export function accessFeeHold(fee: { amountIncGst: number | null; reason: string | null }): string | null {
  if (fee.reason) return fee.reason;
  if (fee.amountIncGst != null && fee.amountIncGst > ACCESS_FEE_MAX) return `Quote held: difficult access fee ${money(fee.amountIncGst)} is over the ${money(ACCESS_FEE_MAX)} limit`;
  return null;
}

export const CHANGED_AFTER_SEND = "Ready Check changed after the quote was sent — office to check; the sent quote was not changed";

export type AutoSendDecision = { send: true } | { send: false; reasons: string[]; quiet?: boolean };

/** quiet = nothing for the office to do yet (switch off, form not complete). */
export function autoSendDecision(i: { enabled: boolean; formCompleted: boolean; quoteReady: boolean; blockers: string[]; sentBefore: boolean }): AutoSendDecision {
  if (!i.enabled) return { send: false, reasons: ["Automatic quote sending is switched off"], quiet: true };
  if (!i.formCompleted) return { send: false, reasons: ["Ready Check not marked Complete in Mitti yet"], quiet: true };
  const reasons = [...i.blockers];
  if (i.sentBefore) reasons.unshift(CHANGED_AFTER_SEND);
  if (!i.quoteReady && !reasons.length) reasons.push("Owner quote could not be prepared");
  return reasons.length ? { send: false, reasons: [...new Set(reasons)] } : { send: true };
}

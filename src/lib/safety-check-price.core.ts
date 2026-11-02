// Safety check (PIESA) money rules — Jo 3 Nov 2026, 9:56am Sydney. Pure; shared by quotes, offers, payouts and profit.
// 1) The owner always pays the single standard safety-check setting ($349 inc GST) on every quote — installer price
//    lists, electrician rates and typed prices never change it.
// 2) Installer jobs: no Home Insulation Victoria markup — the whole owner price goes to the installer, who pays their
//    own electrician.
// 3) Home Insulation Victoria website-lead jobs: we pay the electrician one office setting ($275 inc GST), whoever does it.
// 4) A price already recorded (accepted/issued quote line, an offer's rate snapshot, a recorded payout) is never rewritten.

export const OWNER_SAFETY_CHECK_INC_GST = 349;
export const HIV_ELECTRICIAN_PAYOUT_INC_GST = 275;

const r2 = (n: number) => Math.round(n * 100) / 100;
const positive = (v: unknown): number | null => { const n = v == null || v === "" ? NaN : Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

/** Owner's safety-check price inc GST from the single standard setting ($349 when unset). */
export function ownerSafetyCheckIncGst(standardSettingIncGst: number | string | null | undefined): number {
  return r2(positive(standardSettingIncGst) ?? OWNER_SAFETY_CHECK_INC_GST);
}

/** What we pay the electrician on our own website-lead jobs, inc GST, from the office setting (stored ex GST); $275 when unset. */
export function hivElectricianPayoutIncGst(settingExGst: number | string | null | undefined, gstRate = 0.1): number {
  const ex = positive(settingExGst);
  return ex == null ? HIV_ELECTRICIAN_PAYOUT_INC_GST : r2(ex * (1 + gstRate));
}

/** Safety-check cost to us inc GST for one job. A recorded payout or offer snapshot wins (HV-3682's $349 offer stays);
 *  otherwise installer jobs pass the owner's price straight to the installer, and our leads pay the office setting. */
export function safetyCheckPayoutIncGst(i: {
  channel: string | null | undefined;
  paidOutInc?: number | null; offerRateInc?: number | null;
  ownerPriceIncGst: number; hivPayoutIncGst: number;
}): number {
  const recorded = positive(i.paidOutInc) ?? positive(i.offerRateInc);
  if (recorded != null) return r2(recorded);
  return i.channel === "installer_sourced" ? r2(i.ownerPriceIncGst) : r2(i.hivPayoutIncGst);
}

export const exGst = (inc: number, gstRate = 0.1) => r2(inc / (1 + gstRate));

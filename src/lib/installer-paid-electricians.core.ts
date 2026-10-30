// Jo 30 Oct 2026: the stored in_house flag controls this arrangement, not a business-name list.
// The flat PIESA amount comes from the business's active rate-card line. PURE: no I/O.
import { isInHousePartner } from "./in-house.core";

export type InstallerPaidElectricians = { businessId: string; name: string; piesaIncGst: number; release_hold_reason?: never };
export const IN_HOUSE_PIESA_HOLD_REASON = "In-house partner has no PIESA rate on its rate card";
export type InHousePiesaHold = { businessId: string; name: string; piesaIncGst: null; release_hold_reason: typeof IN_HOUSE_PIESA_HOLD_REASON };
export type InstallerPiesaResult = InstallerPaidElectricians | InHousePiesaHold;

export type InHousePiesaBusiness = { id: string; name: string; in_house: boolean; piesaIncGst?: number | null };

/** The arrangement for this installer business, or null when we pay its electricians directly (everyone else). */
export function installerPaysOwnElectricians(business: InHousePiesaBusiness | null | undefined): InstallerPiesaResult | null {
  if (!business || !isInHousePartner(business)) return null;
  if (business.piesaIncGst == null || !Number.isFinite(business.piesaIncGst) || business.piesaIncGst <= 0)
    return { businessId: business.id, name: business.name, piesaIncGst: null, release_hold_reason: IN_HOUSE_PIESA_HOLD_REASON };
  return { businessId: business.id, name: business.name, piesaIncGst: business.piesaIncGst };
}

/** Safety check payout for one job: who we pay and how much (inc GST). `electricianChoice` is the job's recorded Ready
 *  Check electrician choice; Home Insulation Victoria's own electrician is always paid directly. */
export function safetyCheckPayee(i: { business: InHousePiesaBusiness | null | undefined; electricianChoice: string | null | undefined }): InstallerPiesaResult | null {
  if (!i.electricianChoice || i.electricianChoice === "hivic") return null;
  return installerPaysOwnElectricians(i.business);
}

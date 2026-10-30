// Jo 30 Oct 2026: the stored in_house flag controls this arrangement, not a business-name list.
// The flat PIESA amount comes from the business's active rate-card line. PURE: no I/O.
import { isInHousePartner } from "./in-house.core";

export type InstallerPaidElectricians = { businessId: string; name: string; piesaIncGst: number };

export type InHousePiesaBusiness = { id: string; name: string; in_house: boolean; piesaIncGst: number | null };

/** The arrangement for this installer business, or null when we pay its electricians directly (everyone else). */
export function installerPaysOwnElectricians(business: InHousePiesaBusiness | null | undefined): InstallerPaidElectricians | null {
  if (!business || !isInHousePartner(business) || business.piesaIncGst == null || !Number.isFinite(business.piesaIncGst) || business.piesaIncGst <= 0) return null;
  return { businessId: business.id, name: business.name, piesaIncGst: business.piesaIncGst };
}

/** Safety check payout for one job: who we pay and how much (inc GST). `electricianChoice` is the job's recorded Ready
 *  Check electrician choice; Home Insulation Victoria's own electrician is always paid directly. */
export function safetyCheckPayee(i: { business: InHousePiesaBusiness | null | undefined; electricianChoice: string | null | undefined }): InstallerPaidElectricians | null {
  if (!i.electricianChoice || i.electricianChoice === "hivic") return null;
  return installerPaysOwnElectricians(i.business);
}

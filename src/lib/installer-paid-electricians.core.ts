// Electrician payee eligibility is separate from held in-house visits: either flag enables flat PIESA.
// The amount comes from this business's active rate-card PIESA line. PURE: no I/O.

export type InstallerPaidElectricians = { businessId: string; name: string; piesaIncGst: number; release_hold_reason?: never };
export const IN_HOUSE_PIESA_HOLD_REASON = "Installer business has no PIESA rate on its rate card";
export type InHousePiesaHold = { businessId: string; name: string; piesaIncGst: null; release_hold_reason: typeof IN_HOUSE_PIESA_HOLD_REASON };
export type InstallerPiesaResult = InstallerPaidElectricians | InHousePiesaHold;
/** Fix wave J1 (4), review 4 Nov 2026: on the office Payouts / Money and the installer's Money, an installer's own job whose
 *  business has no PIESA rate (and no recorded quote line) is ONE $0 row with this line — the rest of the list still renders. */
export const PIESA_RATE_NOT_SET_ROW = "No PIESA rate set — ask the office";

export type InHousePiesaBusiness = { id: string; name: string; in_house: boolean; pays_own_electricians?: boolean; piesaIncGst?: number | null };

export function paysOwnElectricians(b: { in_house?: boolean; pays_own_electricians?: boolean }): boolean {
  return b.pays_own_electricians === true || b.in_house === true;
}

/** The arrangement for this installer business, or null when we pay its electricians directly (everyone else). */
export function installerPaysOwnElectricians(business: InHousePiesaBusiness | null | undefined): InstallerPiesaResult | null {
  if (!business || !paysOwnElectricians(business)) return null;
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

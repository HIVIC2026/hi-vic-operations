/** Office-controlled partner configuration; no I/O or workflow progression. */
export type InHouseBusiness = { in_house: boolean; rectification_billed_by: "partner" | "hivic" };
export type InHouseFacts = { approvedElectricianWorkers: number; hasActiveRateCardWithPiesa: boolean; mittiElectricianLogins: number };

export function isInHousePartner(b: { in_house: boolean }): boolean { return b.in_house === true; }

export function jobHeldByInHousePartner(f: { activeInstallerBusiness: { in_house: boolean } | null }): boolean {
  return f.activeInstallerBusiness !== null && isInHousePartner(f.activeInstallerBusiness);
}

export function inHouseEnableBlockers(f: InHouseFacts): string[] {
  const blockers: string[] = [];
  if (f.approvedElectricianWorkers < 1) blockers.push("No approved electrician worker");
  if (!f.hasActiveRateCardWithPiesa) blockers.push("No active rate card with PIESA");
  if (f.mittiElectricianLogins < 1) blockers.push("No electrician Mitti login");
  return blockers;
}

export function partnerBillsRectification(b: InHouseBusiness): boolean {
  return isInHousePartner(b) && b.rectification_billed_by === "partner";
}
/** Held visits and partner-billed rectification use in_house ONLY, never pays_own_electricians. No I/O. */
export type InHouseBusiness = { in_house: boolean; rectification_billed_by: "partner" | "hivic" };
export type InHouseFacts = { approvedElectricianWorkers: number; hasActiveRateCardWithPiesa: boolean; mittiElectricianLogins: number; mittiAccountInvited: boolean };

export function isInHousePartner(b: { in_house: boolean }): boolean { return b.in_house === true; }

export function jobHeldByInHousePartner(f: { activeInstallerBusiness: { in_house: boolean } | null }): boolean {
  return f.activeInstallerBusiness !== null && isInHousePartner(f.activeInstallerBusiness);
}

export type InHouseSkip = "in_house" | "in_house_read_failed";
export function inHouseSkippedAction(skipped: InHouseSkip): { ok: false; skipped: InHouseSkip; message: string } {
  return { ok: false, skipped, message: skipped === "in_house_read_failed"
    ? "Couldn't check the job's partner — please try again."
    : "Your installer will contact you directly to book this visit." };
}

/** Scoped to these skipped actions, not a change to unrelated action result handling. */
export function assertInHouseActionSucceeded(result: unknown): void {
  if (!result || typeof result !== "object" || !("skipped" in result)) return;
  if (result.skipped === "in_house" || result.skipped === "in_house_read_failed") {
    throw new Error(inHouseSkippedAction(result.skipped).message);
  }
}

export function inHouseEnableBlockers(f: InHouseFacts): string[] {
  const blockers: string[] = [];
  if (f.approvedElectricianWorkers < 1) blockers.push("No approved electrician worker");
  if (!f.hasActiveRateCardWithPiesa) blockers.push("No active rate card with PIESA");
  if (f.mittiElectricianLogins < 1) blockers.push("No electrician Mitti login");
  if (!f.mittiAccountInvited) blockers.push("Mitti account not invited");
  return blockers;
}

export function partnerBillsRectification(b: InHouseBusiness): boolean {
  return isInHousePartner(b) && b.rectification_billed_by === "partner";
}
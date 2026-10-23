// PURE rules for installer-supplied (provisional) ceiling measurements and pilot dual verification.
// An imported installer figure is PROVISIONAL until Home Insulation Victoria accepts it under an approved AP measurement standard.
// Until then it only prefills; an independent onsite trade must measure the relevant ceiling area.

export type MeasureMethod = "laser" | "tape" | "floorplan" | "aerial_remote" | "other";
export type MeasurePurpose = "sales_estimate" | "onsite_measured" | "final_installed";
export const METHOD_LABEL: Record<MeasureMethod, string> = { laser: "Laser", tape: "Tape", floorplan: "Floor plan", aerial_remote: "Aerial / Google map / remote", other: "Other" };
export const PURPOSE_LABEL: Record<MeasurePurpose, string> = { sales_estimate: "Sales estimate", onsite_measured: "Onsite measured", final_installed: "Final installed area" };

export const PROVISIONAL_FLAG_REASON = "Installer-supplied figure – independent onsite measurement required (pilot)";

export function parseMethod(v: unknown): MeasureMethod | null {
  const s = String(v ?? "").toLowerCase();
  if (!s) return null;
  if (/laser/.test(s)) return "laser";
  if (/tape/.test(s)) return "tape";
  if (/floor ?plan|plan/.test(s)) return "floorplan";
  if (/aerial|google|nearmap|satellite|remote|map/.test(s)) return "aerial_remote";
  return "other";
}
export function parsePurpose(v: unknown): MeasurePurpose | null {
  const s = String(v ?? "").toLowerCase();
  if (!s) return null;
  if (/final|install/.test(s)) return "final_installed";
  if (/onsite|on-site|site|measured/.test(s)) return "onsite_measured";
  if (/sales|estimate|quote/.test(s)) return "sales_estimate";
  return null;
}

export type StandardState = { standardApproved: boolean; partnerMethodApproved: boolean };
export type ProvisionalRow = {
  provenance: string; measurement_method: string | null; measurement_purpose: string | null;
  supplied_area_m2: number | null; verified_area_m2: number | null; verified_at: string | null;
};

/**
 * Whether Home Insulation Victoria may accept a measurement as satisfying the ceiling-measurement requirement.
 * Returns blockers (empty = may accept). Remote/aerial never satisfies it alone.
 */
export function acceptanceBlockers(m: ProvisionalRow, s: StandardState): string[] {
  if (m.provenance !== "installer_supplied_provisional") {
    return m.measurement_method === "aerial_remote" ? ["An aerial / remote estimate can never satisfy the onsite measurement requirement."] : [];
  }
  if (m.verified_at && Number(m.verified_area_m2) > 0) return []; // independently verified onsite
  const b: string[] = [];
  if (m.measurement_method === "aerial_remote") b.push("An aerial / remote estimate can never satisfy the onsite measurement requirement – onsite measurement needed.");
  if (!s.standardApproved) b.push("Home Insulation Victoria's AP measurement standard is not approved yet – an independent onsite measurement is required.");
  else if (!s.partnerMethodApproved) b.push("This partner's measurement method has not been approved under the Home Insulation Victoria standard.");
  if (m.measurement_purpose !== "onsite_measured" && m.measurement_purpose !== "final_installed") b.push("Supplied figure is not recorded as an onsite measurement.");
  return b;
}

/** Variance between the installer-supplied figure and the independent onsite figure. */
export function measurementVariance(supplied: number | null, verified: number | null) {
  if (!(Number(supplied) > 0) || !(Number(verified) > 0)) return null;
  const m2 = Math.round((Number(supplied) - Number(verified)) * 100) / 100;
  const pct = Math.round((m2 / Number(verified)) * 10000) / 100;
  return { m2, pct };
}

/** Admin-configured calibration tolerance. Null tolerance = no judgement (pilot: admin reviews every variance). */
export function varianceWithinTolerance(pct: number | null, tolerancePct: number | null | undefined): boolean | null {
  if (pct == null || tolerancePct == null) return null;
  return Math.abs(pct) <= Number(tolerancePct);
}

/** Independent verification must come from a different party than the one who supplied the figure. */
export function verifierBlocker(i: { verifierRole: string; verifierBusinessId: string | null; suppliedBusinessId: string | null; standardApproved: boolean }): string | null {
  if (i.standardApproved) return null;
  if (i.verifierRole === "admin") return "The ceiling area must be measured by an onsite trade, not entered by the office.";
  if (i.verifierRole === "installer" && (!i.suppliedBusinessId || i.verifierBusinessId === i.suppliedBusinessId))
    return "During the pilot the ceiling area must be verified by an independent onsite trade, not the business that supplied the figure.";
  return null;
}

/** Jo 24 Oct: an installer's Add-job/bulk size (provisional, not yet tied to a Mitti form, never accepted) gives way
 *  to the job's Mitti Ready Check. The provisional row stays as history (is_current=false, supplied figures untouched)
 *  and the form gets a fresh record, so the Mitti answers are never read as the installer-supplied pilot figure. */
export function provisionalGivesWayToMitti(m: { provenance?: string | null; status?: string | null; external_source?: string | null; accepted_by?: string | null } | null | undefined): boolean {
  return !!m && m.provenance === "installer_supplied_provisional" && m.status !== "complete" && m.external_source !== "mitti" && !m.accepted_by;
}

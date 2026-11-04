// "Your old insulation stays" — Jo 4 Nov 2026 16:10 (ESC letter on Activity 48 R-value, 4 Nov): APPROVED owner notice when
// the Ready Check says the old insulation is KEPT (removal = no AND "good enough condition to lay new batts on top" = yes).
// Shown on the quote page, in the quote email, in the Customer Agreement section 1 (in place of "Remove your old
// insulation, if your quote says so.") and on My job — Home Insulation Victoria leads AND installers' own customers.
// The R-value rule is unchanged: the installed product is always ≥ R5.0 on its own. PURE: no I/O.

/** The approved paragraph. `installer` = the installer business's name; unknown → "Your installer". */
export function keptInsulationNotice(installer: string | null | undefined): string {
  const who = installer?.trim() || "Your installer";
  return `Your old insulation stays. ${who} checked it and found it's in good enough condition for new insulation to go over it. The new insulation will be laid on top to the Australian Standard (AS 3999) and the manufacturer's instructions.`;
}

/** The current Ready Check record (ceiling_measurements): whole-house facts + the per-area zones the Mitti sync writes
 *  (mitti.core: `present`, `removal` "yes"/"no", `suitable` = the decision-359 "good enough condition to lay over" answer). */
export type KeptInsulationFacts = {
  insulation_present?: boolean | null;
  removal_required?: boolean | null;
  zones?: unknown;
};

const yes = (v: unknown): boolean => v === true || v === "yes" || v === "Yes";
const no = (v: unknown): boolean => v === false || v === "no" || v === "No";

/**
 * True only when the Ready Check RECORDS that old insulation is present, none of it is removed, and every area with old
 * insulation was found in good enough condition to lay the new batts on top. Anything not recorded (older forms without
 * the per-area answer, no areas, a removal anywhere, a "No"/blank condition) = false: the notice never shows on a guess.
 */
export function oldInsulationKept(m: KeptInsulationFacts | null | undefined): boolean {
  if (!m || m.insulation_present !== true || m.removal_required === true) return false;
  const zones = Array.isArray(m.zones) ? (m.zones as unknown[]).filter((z): z is Record<string, unknown> => !!z && typeof z === "object" && !Array.isArray(z)) : [];
  const withOld = zones.filter((z) => yes(z["present"] ?? z["insulation_present"]) || z["existing"] === "present");
  if (!withOld.length) return false;
  for (const z of withOld) {
    if (yes(z["removal"] ?? z["removal_required"])) return false;
    if (!no(z["removal"] ?? z["removal_required"]) && m.removal_required !== false) return false; // removal not recorded anywhere
    if (!yes(z["suitable"])) return false;
  }
  return true;
}

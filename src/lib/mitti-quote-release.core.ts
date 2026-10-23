import type { MittiElectricianResolution } from "./usual-electrician.core";

/** Mitti fees are disclosed on the accepted quote; consent and electrical details remain mandatory. */
export function mittiQuoteReleaseBlockers(consentStatus: string | null, electrician: MittiElectricianResolution | null): string[] {
  return [
    ...(consentStatus === "granted" ? [] : ["No current owner contact consent on record"]),
    ...(electrician?.ready ? [] : electrician?.reasons ?? ["Electrician arrangement is not decided"]),
  ];
}

export function pickupJobSource(business: { onboarding_notes?: string | null } | null): "qa_test" | "installer_mitti" {
  return business?.onboarding_notes?.includes("[TEST PARTNER]") ? "qa_test" : "installer_mitti";
}

export function quoteListIncludes(source: string | null, showTestJobs: boolean): boolean {
  return showTestJobs ? source === "qa_test" : source !== "qa_test";
}

/** Preserve supplied spelling and acronyms; trim only surrounding whitespace. */
export const installerEnteredText = (value: string) => value.trim();
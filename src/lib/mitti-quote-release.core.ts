import type { MittiElectricianResolution } from "./usual-electrician.core";

/** Mitti fees are disclosed on the accepted quote; consent and electrical details remain mandatory.
 *  `ourLead` (our own leads, A2): the PIESA is always Home Insulation Victoria's electrician (decisions 246/289 — the
 *  electrician choice exists only on the installer's own jobs and is never recorded for our leads), so there is no
 *  electrician arrangement to decide. Night test run 25 Oct 2026: without this every A2 quote was refused at Send
 *  ("Electrician arrangement is not decided"). Owner consent is still required. */
export function mittiQuoteReleaseBlockers(consentStatus: string | null, electrician: MittiElectricianResolution | null, opts: { ourLead?: boolean } = {}): string[] {
  return [
    ...(consentStatus === "granted" ? [] : ["No current owner contact consent on record"]),
    ...(opts.ourLead || electrician?.ready ? [] : electrician?.reasons ?? ["Electrician arrangement is not decided"]),
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
// Test Centre "Open as …" (sign-in only): pure helpers. Opening a TEST role never provisions or resets anything.
export type QaPersona = "owner" | "installer_boss" | "electrician";
export const QA_PERSONA_LABEL: Record<QaPersona, string> = { owner: "owner", installer_boss: "installer boss", electrician: "electrician" };

/** Actionable message when an existing TEST persona is missing on this job (nothing is created to fix it). */
export function qaPersonaMissingMessage(persona: QaPersona): string {
  return persona === "owner"
    ? "This TEST job has no existing TEST owner sign-in. Nothing was changed. Use a TEST job that already has a TEST owner."
    : `This TEST job has no active TEST ${QA_PERSONA_LABEL[persona]} assigned. Nothing was changed. Assign an existing TEST ${persona === "electrician" ? "electrician" : "installer"} to this job first.`;
}

/** Same-origin single-use TEST sign-in path (opened by the admin's own click; never logged). */
export function qaAccessPath(link: { tokenHash: string; next: string }): string {
  return `/qa-access?token_hash=${encodeURIComponent(link.tokenHash)}&type=magiclink&next=${encodeURIComponent(link.next)}`;
}

// STEP 73 (W4, A4): who may record a regulated electrical result (electrical assessment completion / PIESA pass-fail).
// requireJobRole() accepts my_job_role = 'electrician', and since 0115 a partner BUSINESS ADMIN gets the assignment's role
// for its business's jobs even without the electrician app role (e.g. an office manager or FFS-style admin added with
// trade role "none"). Recording the regulated result additionally needs the licensed-electrician app role, the same
// rule that already applies to accepting a PIESA offer (allocation.server.ts). Office (admin) keeps its existing access.
// Pure, so the rule is unit-testable; the server functions call it with the caller's RLS-scoped has_role answer.
// STEP 80: the same rule now also covers saveAssessment (the draft holds the PIESA outcome and safety answers that
// completion signs off) and submitDeclaration("electrician_declaration") (an electrician attestation).
export const CLEARANCE_RECORDER_REFUSED = "Only a licensed electrician can record this electrical result.";

export function clearanceRecorderAllowed(i: { jobRole: string | null; hasElectricianRole: boolean }): boolean {
  if (i.jobRole === "admin") return true;
  return i.jobRole === "electrician" && i.hasElectricianRole;
}

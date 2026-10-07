// Pure: is a CII certificate issuer the Energy Efficiency Council (EEC)? Only EEC certificates are accepted.
export const EEC_ISSUER_LABEL = "Energy Efficiency Council (EEC)";

export function isEecIssuer(issuer: string | null | undefined): boolean {
  const s = (issuer ?? "").trim();
  if (!s) return false;
  return /energy\s+efficiency\s+council/i.test(s) || /(^|[^a-z])eec([^a-z]|$)/i.test(s);
}

/** Office warning for a known, non-EEC issuer. Blank issuer gives null (nothing typed to judge). */
export function nonEecWarning(issuer: string | null | undefined): string | null {
  const s = (issuer ?? "").trim();
  if (!s || isEecIssuer(s)) return null;
  return `Not EEC: issued by "${s}". Only Energy Efficiency Council (EEC) Certified Insulation Installer certificates are accepted.`;
}

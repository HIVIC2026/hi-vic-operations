export type RemovalQuote = { answer: "yes" | "no" | "unknown"; areaM2: number | null; chargeIncGst: number | null };
export type RemovalInput = { answer: RemovalQuote["answer"]; area: string; charge: string };
export const blankRemoval = (): RemovalInput => ({ answer: "unknown", area: "", charge: "" });
export function selectRemovalAnswer(value: RemovalInput, answer: RemovalInput["answer"]): RemovalInput {
  return answer === value.answer ? value : { answer, area: "", charge: "" };
}
export function parseProposedR(value: string): number | null {
  const text = value.trim().replace(/^r\s*/i, "");
  if (!text) return null;
  return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
}
const numeric = (value: string) => value.trim() ? Number(value.replace(/[$,\s]/g, "")) : null;
/**
 * Removal is a SITE fact (Jo 20 Oct): required yes/no/uncertain and m² are kept whatever the quote/attendance answer.
 * Only the optional legacy "amount already inside the works total" is commercial and kept only when quoted.
 * How removal is PRICED (included / additional / not priced) lives in installer-quote-commercial.core.
 */
export function removalPayload(input: RemovalInput, quoted: boolean, _visited = false): RemovalQuote {
  if (input.answer !== "yes") return { answer: input.answer, areaM2: null, chargeIncGst: null };
  return { answer: "yes", areaM2: numeric(input.area), chargeIncGst: quoted ? numeric(input.charge) : null };
}
/** strictArea=false at save: a draft may omit the removal m²; readiness re-checks with strictArea=true. */
export function removalProblems(r: RemovalQuote, insulation: string | null, ceiling: number | null, total: number | null, chargeRequired = false, strictArea = true): string[] {
  if (r.answer !== "yes") return [];
  const errors: string[] = [];
  if (insulation === "none") errors.push("Removal cannot be required when existing insulation is None. Correct one of these answers.");
  if (r.areaM2 == null ? strictArea : (!Number.isFinite(r.areaM2) || r.areaM2 <= 0 || r.areaM2 > 5000 || (ceiling != null && r.areaM2 > ceiling))) errors.push("Enter the removal area within the ceiling area (m²).");
  if (chargeRequired && r.chargeIncGst == null) errors.push("Enter the removal amount inside your works total inc GST, or 0 for none.");
  else if (r.chargeIncGst != null && (!Number.isFinite(r.chargeIncGst) || r.chargeIncGst < 0 || r.chargeIncGst > 1_000_000 || (total != null && r.chargeIncGst > total))) errors.push("The removal amount inside your works total must be between 0 and the works total (inc GST).");
  return errors;
}
/** Physical summary only (pricing-aware wording: removalFactSummary). "no" means NOT REQUIRED, never "not included". */
export function removalSummary(r: RemovalQuote): string {
  return r.answer === "yes" ? `Removal required: ${r.areaM2 ?? "area unknown"}${r.areaM2 != null ? " m²" : ""}` : r.answer === "no" ? "Removal: not required" : "Removal: not yet known — office confirmation needed before quote release";
}
export function readRemoval(value: unknown): RemovalQuote | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<RemovalQuote>;
  if (r.answer !== "yes" && r.answer !== "no" && r.answer !== "unknown") return null;
  return { answer: r.answer, areaM2: r.answer === "yes" && typeof r.areaM2 === "number" ? r.areaM2 : null, chargeIncGst: r.answer === "yes" && typeof r.chargeIncGst === "number" ? r.chargeIncGst : null };
}
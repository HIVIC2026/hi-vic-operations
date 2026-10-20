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
/** Removal is a SITE fact (Jo 20 Oct): an attended visit keeps the answer/area even with no quote; only the charge needs a quote. */
export function removalPayload(input: RemovalInput, quoted: boolean, visited = false): RemovalQuote {
  if (!quoted && visited) return input.answer === "yes" ? { answer: "yes", areaM2: numeric(input.area), chargeIncGst: null } : { answer: input.answer, areaM2: null, chargeIncGst: null };
  if (!quoted || input.answer !== "yes") return { answer: quoted ? input.answer : "unknown", areaM2: null, chargeIncGst: null };
  return { answer: "yes", areaM2: numeric(input.area), chargeIncGst: numeric(input.charge) };
}
export function removalProblems(r: RemovalQuote, insulation: string | null, ceiling: number | null, total: number | null, chargeRequired = true): string[] {
  if (r.answer !== "yes") return [];
  const errors: string[] = [];
  if (insulation === "none") errors.push("Removal cannot be included when existing insulation is None. Correct one of these answers.");
  if (r.areaM2 == null || !Number.isFinite(r.areaM2) || r.areaM2 <= 0 || r.areaM2 > 5000 || (ceiling != null && r.areaM2 > ceiling)) errors.push("Enter the removal area within the ceiling area (m²).");
  if (chargeRequired && r.chargeIncGst == null) errors.push("Enter the removal charge already included in your quote inc GST, or 0 for no separate charge.");
  else if (r.chargeIncGst != null && ( !Number.isFinite(r.chargeIncGst) || r.chargeIncGst < 0 || r.chargeIncGst > 1_000_000 || (total != null && r.chargeIncGst > total))) errors.push("Enter the removal charge already included in your quote inc GST, or 0 for no separate charge.");
  return errors;
}
export function removalSummary(r: RemovalQuote): string {
  return r.answer === "yes" ? `Removal: ${r.areaM2 ?? "unknown"} m²; $${r.chargeIncGst ?? "unknown"} inc GST already included in your quote total` : r.answer === "no" ? "Removal: not included" : "Removal: not assessed — office confirmation needed before quote release";
}
export function readRemoval(value: unknown): RemovalQuote | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<RemovalQuote>;
  if (r.answer !== "yes" && r.answer !== "no" && r.answer !== "unknown") return null;
  return { answer: r.answer, areaM2: r.answer === "yes" && typeof r.areaM2 === "number" ? r.areaM2 : null, chargeIncGst: r.answer === "yes" && typeof r.chargeIncGst === "number" ? r.chargeIncGst : null };
}
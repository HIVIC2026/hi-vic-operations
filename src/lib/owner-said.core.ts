// "What the owner told us" on a Home Insulation Victoria lead (Jo 5 Nov 2026: the installer's Give email shows it; the
// office job page's Enquiry card has shown the same line since 23 Oct). Declared by the owner on the website, never
// verified — the Ready Check confirms it. PURE.
import { declaredExtras, insulationDetailText, type InsulationDetail } from "./trade-shared-consts.core";
import { normaliseInsulation } from "./eligibility.core";

export type OwnerSaidFacts = {
  /** The website answer snapshot (properties.enrichment.base44.raw.answers), if any. */
  answers: Record<string, unknown> | null | undefined;
  /** jobs.estimated_area_m2 */
  estimatedAreaM2: number | string | null | undefined;
  /** properties.occupancy ("owner_occupied", "rental", …) */
  occupancy: string | null | undefined;
  /** Owner-declared insulation detail (type, thickness, coverage), if the website captured it. */
  detail?: Partial<InsulationDetail> | null;
};

/** "No insulation · about 120 m² · owner-occupied", or null when the owner told us nothing we can show. */
export function ownerSaidLine(f: OwnerSaidFacts): string | null {
  const ex = declaredExtras(f.answers ?? null);
  const declared = normaliseInsulation(ex.existing_insulation);
  const detail = insulationDetailText(f.detail ?? null);
  const area = f.estimatedAreaM2 != null && Number(f.estimatedAreaM2) > 0 ? `about ${Math.round(Number(f.estimatedAreaM2))} m²` : null;
  return [
    declared === "none" ? "No insulation" : declared === "present" ? `Some insulation${detail ? ` (${detail})` : ""}` : declared === "unknown" ? "Not sure about insulation" : null,
    area,
    ex.top_floor === "yes" ? "top floor" : ex.top_floor === "no" ? "not the top floor" : null,
    f.occupancy ? f.occupancy.replace(/_/g, "-") : null,
  ].filter(Boolean).join(" · ") || null;
}

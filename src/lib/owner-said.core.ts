// "What the owner told us" on a Home Insulation Victoria lead (Jo 5 Nov 2026: the installer's Give email shows the
// insulation they described — website answers plus whatever the quick taps filled in — and the ceiling size they typed;
// the office job page's Enquiry card has shown the one-line form since 23 Oct). Declared by the owner, never verified —
// the Ready Check confirms it. PURE.
import { declaredExtras, insulationDetailText, type InsulationDetail } from "./trade-shared-consts.core";
import { normaliseInsulation } from "./eligibility.core";

export type OwnerSaidFacts = {
  /** The website answer snapshot (properties.enrichment.base44.raw.answers), if any. */
  answers: Record<string, unknown> | null | undefined;
  /** The owner's quick-tap fills of blank website answers (properties.enrichment.base44.declared), if any. */
  declared?: Record<string, unknown> | null | undefined;
  /** lead_campaign_responses.saved_insulation (the Save my spot answer), if any. */
  savedInsulation?: string | null | undefined;
  /** jobs.estimated_area_m2 */
  estimatedAreaM2: number | string | null | undefined;
  /** properties.occupancy ("owner_occupied", "rental", …) — office line only. */
  occupancy?: string | null | undefined;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Website insulation detail (type / thickness / coverage) from the raw answers. */
function detailOf(answers: Record<string, unknown> | null | undefined): Partial<InsulationDetail> | null {
  if (!answers) return null;
  const d = { insulation_type: str(answers["insulation_type"]), insulation_thickness: str(answers["insulation_thickness"]), insulation_coverage: str(answers["insulation_coverage"]) };
  return Object.values(d).some(Boolean) ? (d as Partial<InsulationDetail>) : null;
}

/** "None" / "Some — batts, about a hand thick, patchy" / "Not sure", or null when nothing was answered.
 *  Quick-tap fill (declared) wins over the Save-my-spot answer, which wins over the website's own answer — the same order the
 *  quick taps use (quick-taps.server websiteFacts). */
export function ownerInsulationWords(f: OwnerSaidFacts): string | null {
  const ex = declaredExtras(f.answers ?? null);
  const declared = normaliseInsulation(str(f.declared?.["insulation"]) ?? f.savedInsulation ?? ex.existing_insulation);
  const detail = insulationDetailText(detailOf(f.answers));
  if (declared === "none") return "None";
  if (declared === "present") return detail ? `Some — ${detail}` : "Some";
  if (declared === "unknown") return "Not sure";
  return null;
}

/** "About 120 m²" or null. */
export const ownerAreaWords = (m2: number | string | null | undefined): string | null =>
  m2 != null && Number(m2) > 0 ? `About ${Math.round(Number(m2))} m²` : null;

/** The rows the installer's Give email shows per job (Jo 5 Nov 2026): insulation as the owner described it, the size they gave.
 *  Rows with nothing to say are left out (the caller skips empty values). */
export function ownerSaidRows(f: OwnerSaidFacts): [label: string, value: string | null][] {
  return [
    ["Insulation (owner said)", ownerInsulationWords(f)],
    ["Ceiling size (owner said)", ownerAreaWords(f.estimatedAreaM2)],
  ];
}

/** Office Enquiry card line: "No insulation · about 120 m² · owner-occupied", or null when the owner told us nothing we can show. */
export function ownerSaidLine(f: OwnerSaidFacts): string | null {
  const ins = ownerInsulationWords(f);
  const ex = declaredExtras(f.answers ?? null);
  return [
    ins === "None" ? "No insulation" : ins === "Not sure" ? "Not sure about insulation" : ins ? ins.replace(/^Some/, "Some insulation") : null,
    ownerAreaWords(f.estimatedAreaM2)?.replace(/^About/, "about") ?? null,
    (str(f.declared?.["top_floor"]) ?? ex.top_floor) === "yes" ? "top floor" : null,
    f.occupancy ? f.occupancy.replace(/_/g, "-") : null,
  ].filter(Boolean).join(" · ") || null;
}

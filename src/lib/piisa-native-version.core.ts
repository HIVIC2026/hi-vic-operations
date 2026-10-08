// Staged successor only. Runtime callers continue to use the published A3 mapping until a
// final definition is read back and this exact fingerprint is explicitly registered.
import { flatten, norm, type NativeMapping } from "./mitti.core";
import { A3_CREW_NAME_IDS, A3_CREW_OTHER_FIELDS, A3_MEDIA_IDS, A3_NATIVE_IDS, PIISA_A3_MAPPING, a3MissingFields, type StaffOption, type CrewSelection, crewSelectionProblems, crewPrefill, type CrewChoice } from "./piisa-a3.core";

export const PIISA_DIRECT_VERSION = "a3-direct-crew-products-review-2026-10-08";
/** Intentionally empty until Jo supplies the final published definition and readback passes. */
const VERIFIED_DIRECT_DEFINITIONS: readonly string[] = [];

export function directCrewLabels(row: number) {
  const prefix = row === 0 ? "Lead installer" : `Additional installer ${row}`;
  return { name: `${prefix} — full legal name${row ? " (leave blank if not applicable)" : ""}`, eec: `${prefix} — CII certification number (issued by the EEC)` };
}

// Whole-definition fingerprint: edited conditions/required flags/placement also invalidate approval.
export function nativeDefinitionFingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  return JSON.stringify(canonical(value));
}

export function stagedDirectSchemaProblems(template: unknown): string[] {
  const entries = flatten(template);
  const byId = new Map(entries.map((e) => [String(e.id), e]));
  const problems: string[] = [];
  // Reuse every unchanged answer/media check; only the explicitly retired crew/product fields differ.
  const removed = new Set<string>([...A3_CREW_NAME_IDS, ...(A3_NATIVE_IDS["p7.products"] ?? [])]);
  // Validate unchanged fields using the established schema checks.
  const legacy = a3MissingFields(template);
  const ignored = ["Lead installer", "Additional installer", "Crew choice list", "What insulation products are being installed?"];
  problems.push(...legacy.filter((p) => !ignored.some((x) => p.startsWith(x))));
  for (const id of removed) if (byId.has(id)) problems.push(`Retired native item is still present: ${id}`);
  A3_CREW_OTHER_FIELDS.forEach((pair, row) => {
    const labels = directCrewLabels(row);
    for (const key of ["name", "eec"] as const) {
      const entry = byId.get(pair[key]);
      if (!entry || entry.norm !== norm(labels[key])) problems.push(`Direct crew row ${row}: ${labels[key]} is missing or relabelled`);
    }
  });
  if (!byId.has(A3_MEDIA_IDS.product_photos)) problems.push("Pre-install product label photo missing");
  // Exact field type, conditional requirements and page order still need the final native schema.
  // No guessed condition shape can qualify this draft for activation.
  return problems;
}

export function resolvePiisaNativeVersion(template: unknown) {
  if (!a3MissingFields(template).length) return { version: "a3-published-choice", active: true, mapping: PIISA_A3_MAPPING, problems: [] };
  const problems = stagedDirectSchemaProblems(template);
  const approved = VERIFIED_DIRECT_DEFINITIONS.includes(nativeDefinitionFingerprint(template));
  return { version: PIISA_DIRECT_VERSION, active: approved && !problems.length, mapping: approved && !problems.length ? directMapping() : null,
    problems: [...problems, ...(!approved ? ["Final published direct-field definition has not been verified; mapping activation is paused."] : [])] };
}

function directMapping(): NativeMapping {
  const mapping = { ...PIISA_A3_MAPPING };
  delete mapping["p7.products"];
  return mapping; // crew written separately; official Part 7 supplied ONLY by the product review record
}

/** Historical audit responses own their crew schema; today's template cannot reinterpret an older audit. */
export function stagedDirectCrewChoices(audit: unknown): CrewChoice[] {
  const entries = flatten(audit);
  const text = (id: string) => entries.find((e) => String(e.id) === id)?.value?.trim() || null;
  return A3_CREW_OTHER_FIELDS.map((pair, row) => {
    const name = text(pair.name), eec = text(pair.eec);
    return name || eec ? { row, kind: "other", name, eec } : { row, kind: "none" };
  });
}

/** Prepared direct-field prefill, with the same company-scoped roster and verification rules. */
export function stagedDirectCrewPrefill(selection: CrewSelection, staff: StaffOption[]) {
  const checked = crewSelectionProblems(selection, staff);
  if (checked.problems.length) return { items: [], ...checked };
  const values = crewPrefill(selection, staff);
  const items = A3_CREW_OTHER_FIELDS.flatMap((pair, row) => {
    const name = values.find((v) => v.itemId === (row ? "p2.addName" : "p2.lead") && v.row === (row ? row - 1 : 0))?.value;
    const eec = values.find((v) => v.itemId === (row ? "p2.addEec" : "p2.leadEec") && v.row === (row ? row - 1 : 0))?.value;
    return name && eec ? [{ item_id: pair.name, type: "text", responses: { text: name } }, { item_id: pair.eec, type: "text", responses: { text: eec } }] : [];
  });
  return { items, ...checked };
}
// Published revision 18 read through the existing Mitti GET integration, 8 Oct 2026.
// The complete answer/condition/page structure is pinned; any structural change fails closed.
import published from "./piisa-direct-published.data.json";
import { flatten, norm, type NativeMapping } from "./mitti.core";
import { A3_CREW_NAME_IDS, A3_CREW_OTHER_FIELDS, A3_NATIVE_IDS, PIISA_A3_MAPPING, a3MissingFields, type StaffOption, type CrewSelection, crewSelectionProblems, crewPrefill, type CrewChoice } from "./piisa-a3.core";

export const PIISA_DIRECT_VERSION = "a3-direct-crew-products-review-2026-10-08";
export const PIISA_DIRECT_SIGNATURE_ID = "83caffa2-e9c8-4315-885f-5337a4389372";

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

/** Pin all published items, nested conditions, types, labels and ordering; ignore mutable access/use metadata. */
export function publishedStructure(template: unknown): unknown {
  const root = (template as { template?: unknown })?.template ?? template;
  const t = root as Record<string, unknown>;
  return { id: t?.["id"], items: t?.["items"], response_sets: t?.["response_sets"], global_response_sets: t?.["global_response_sets"], mandatory_mark_as_complete: t?.["mandatory_mark_as_complete"] };
}
export function stagedDirectSchemaProblems(template: unknown): string[] {
  const entries = flatten(template);
  const byId = new Map(entries.map((e) => [String(e.id), e]));
  const problems: string[] = [];
  for (const id of [...A3_CREW_NAME_IDS, ...(A3_NATIVE_IDS["p7.products"] ?? [])]) if (byId.has(id)) problems.push(`Retired native item is still present: ${id}`);
  A3_CREW_OTHER_FIELDS.forEach((pair, row) => {
    const labels = directCrewLabels(row);
    for (const key of ["name", "eec"] as const) {
      const entry = byId.get(pair[key]);
      if (!entry || entry.norm !== norm(labels[key])) problems.push(`Direct crew row ${row}: ${labels[key]} is missing or relabelled`);
    }
  });
  if (nativeDefinitionFingerprint(publishedStructure(template)) !== nativeDefinitionFingerprint(publishedStructure(published))) problems.push("The published PIISA types, conditions, labels or page order differ from verified revision 18.");
  return problems;
}

export function resolvePiisaNativeVersion(template: unknown) {
  if (!a3MissingFields(template).length) return { version: "a3-published-choice", active: true, mapping: PIISA_A3_MAPPING, problems: [] };
  const problems = stagedDirectSchemaProblems(template);
  const approved = !problems.length;
  return { version: PIISA_DIRECT_VERSION, active: approved && !problems.length, mapping: approved && !problems.length ? directMapping() : null,
    problems: [...problems, ...(!approved ? ["Final published direct-field definition has not been verified; mapping activation is paused."] : [])] };
}

function directMapping(): NativeMapping {
  const mapping = { ...PIISA_A3_MAPPING };
  for (const id of ["p7.products", "completionDate", "p8.name", "p8.date"]) delete mapping[id];
  mapping["startDate"] = { itemIds: A3_NATIVE_IDS["startDate"] ?? [], labels: ["Installation date"], byRow: true };
  mapping["p5.safeToCover"] = { itemIds: A3_NATIVE_IDS["p5.safeToCover"] ?? [], labels: ["Does the PIESA confirm that all recessed lights are safe to cover with insulation?"], byRow: true };
  mapping["p8.signature"] = { itemIds: [PIISA_DIRECT_SIGNATURE_ID], labels: ["Signature"], byRow: true };
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
/** Direct text entries must match BOTH current legal name and CII number in the assigned company. */
export function resolveDirectCrew(audit: unknown, staff: StaffOption[]) {
  const answers: Record<string, string> = {}, blockers: string[] = [];
  const choices = stagedDirectCrewChoices(audit), seen = new Set<string>();
  for (const c of choices) {
    if (c.kind === "none") { if (!c.row) blockers.push("Lead installer full legal name and CII certification number are required."); continue; }
    if (c.kind !== "other") continue;
    if (!c.name || !c.eec) { blockers.push(`Installer row ${c.row}: full legal name and CII certification number are required.`); continue; }
    const hit = staff.find((s) => s.approved === true && s.eecVerified && norm(s.name) === norm(c.name) && norm(s.eec) === norm(c.eec));
    if (!hit) { blockers.push(`${c.name}: name and CII number need matching verified company records or office verification.`); continue; }
    if (seen.has(hit.workerId)) { blockers.push(`${c.name} is listed twice.`); continue; } seen.add(hit.workerId);
    if (!c.row) { answers["p2.lead"] = hit.name; answers["p2.leadEec"] = hit.eec ?? ""; answers["p8.name"] = hit.name; }
    else { answers[`p2.addName#${c.row - 1}`] = hit.name; answers[`p2.addEec#${c.row - 1}`] = hit.eec ?? ""; }
  }
  return { answers, blockers, needsVerification: [] as string[], choices };
}
/** Audit shape, not today's master, determines historical crew/signature handling. */
export function isDirectPiisaAudit(audit: unknown): boolean {
  const es = flatten(audit);
  return es.some((e) => e.id === PIISA_DIRECT_SIGNATURE_ID) && !es.some((e) => (A3_CREW_NAME_IDS as readonly string[]).includes(e.id));
}

// Fixture of the A3 native template as SAVED in the editor (Jo, 8 Oct 2026 14:22 UTC). Test-only.
import { A3_ALIASES, A3_CREW_NAME_IDS, A3_CREW_OTHER_FIELDS, A3_CREW_OTHER_OPTION, A3_CREW_RESPONSE_SET, A3_MEDIA_IDS, A3_MEDIA_LABELS, A3_EVIDENCE_LABELS, A3_NATIVE_IDS } from "../../src/lib/piisa-a3.core";

export const OPT_BHAVDEEP = { id: "9716a976-8e88-4809-b23d-006dc7fb4a02", label: "Bhavdeep Singh — EEC CII-027 — Reinsulate" };
export const OPT_DOMINIC = { id: "af468f10-d9a3-49d3-a100-a51882f43d6f", label: "Dominic Doherty — EEC 4546 — Hic" };
export const OPT_OTHER = { id: A3_CREW_OTHER_OPTION, label: "Other" };
export const TREATMENT_SET = "rs-treatment";

export function a3Template(opts = [OPT_BHAVDEEP, OPT_DOMINIC, OPT_OTHER]) {
  const crew = new Set<string>(A3_CREW_NAME_IDS);
  const items: Record<string, unknown>[] = [];
  for (const [k, ids] of Object.entries(A3_NATIVE_IDS)) ids.forEach((id) => {
    const label = A3_ALIASES[k]?.[0] ?? (k === "p8.declaration" ? "I acknowledge" : "Life support document");
    if (crew.has(id)) items.push({ item_id: id, id, label, type: "question", question: { response_set_id: A3_CREW_RESPONSE_SET } });
    else if (k === "p6.treatment") items.push({ item_id: id, id, label, type: "question", question: { response_set_id: TREATMENT_SET } });
    else items.push({ item_id: id, id, label, type: "text" });
  });
  A3_CREW_OTHER_FIELDS.forEach((f) => items.push({ item_id: f.name, id: f.name, label: "Full legal name", type: "text" }, { item_id: f.eec, id: f.eec, label: "EEC certification number", type: "text" }));
  for (const [k, id] of Object.entries(A3_MEDIA_IDS)) items.push({ item_id: id, id, label: (A3_MEDIA_LABELS as Record<string, string>)[k] ?? (A3_EVIDENCE_LABELS as Record<string, string>)[k], type: "media" });
  return { items, response_sets: [
    { id: A3_CREW_RESPONSE_SET, responses: opts },
    { id: TREATMENT_SET, responses: [{ id: "t-rem", label: "Removed" }, { id: "t-top", label: "Topped up" }] },
  ] };
}

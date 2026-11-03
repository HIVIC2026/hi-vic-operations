// New job flow Part 8 Task 9: the records the ESC wants per job (VEET Guidelines v16), each pinned to the live form label that
// collects it. Labels are imported, never retyped, so a reworded question shows up as a gap here.
import { INSTALL_DAY_QUESTIONS, INSTALL_DAY_RULER_Q } from "./install-day.core";
import { LEAN_Q } from "./ready-check-lean.core";
import { PIESA_EVIDENCE_BY_ID } from "./piesa-evidence.core";

export type EscRecord = { record: string; form: "A1/A2" | "A3" | "A5" | "portal"; labels: readonly string[] };

const a5 = (n: number): string => {
  const q = INSTALL_DAY_QUESTIONS.find((x) => x.n === n);
  if (!q) throw new Error(`A5 Q${n} is missing`);
  return q.label;
};

export const ESC_RECORDS_CHECKLIST: readonly EscRecord[] = [
  { record: "Electrician at the PIESA", form: "A3", labels: [PIESA_EVIDENCE_BY_ID.onsite_photo.label] },
  { record: "Each installer on site", form: "A5", labels: [a5(8), a5(12), a5(16)] },
  { record: "Old R-values", form: "A1/A2", labels: [LEAN_Q.rValue, LEAN_Q.depthPhoto] },
  { record: "Old insulation depth photo", form: "A5", labels: [INSTALL_DAY_RULER_Q.existingDepth] },
  { record: "New R-values", form: "A5", labels: [a5(33), INSTALL_DAY_RULER_Q.newDepth] },
  { record: "Power isolated", form: "A5", labels: [a5(27)] },
  { record: "Products", form: "A5", labels: [a5(33)] },
  { record: "Before video", form: "A1/A2", labels: [LEAN_Q.beforeVideo] },
  { record: "After video incl. waste removed", form: "A5", labels: [a5(38)] },
  { record: "Floor plan with m² and products", form: "portal", labels: [LEAN_Q.areaName, LEAN_Q.lengthM, LEAN_Q.widthM] },
  { record: "Day-2+ PIISA re-check", form: "A5", labels: [a5(40), a5(41)] },
  { record: "Lead Installer whole install", form: "A5", labels: [a5(46)] },
  { record: "Premises type", form: "A1/A2", labels: [LEAN_Q.premisesType] },
];

const key = (s: string) => s.split("\n")[0].replace(/\s+/g, " ").trim().toLowerCase();

/** Checklist labels the given form definitions do not carry. "portal" records are read from the Ready Check (A1/A2) answers. */
export function recordsChecklistGaps(defs: { a1a2: string[]; a3: string[]; a5: string[] }): string[] {
  const have = {
    "A1/A2": new Set(defs.a1a2.map(key)), portal: new Set(defs.a1a2.map(key)),
    A3: new Set(defs.a3.map(key)), A5: new Set(defs.a5.map(key)),
  };
  const out: string[] = [];
  for (const r of ESC_RECORDS_CHECKLIST)
    for (const l of r.labels) if (!have[r.form].has(key(l))) out.push(`${r.record}: ${l}`);
  return out;
}

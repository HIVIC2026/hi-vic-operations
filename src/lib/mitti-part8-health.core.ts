// New job flow Part 8 Task 11: what the 2 Nov Mitti paste must have changed on the LIVE templates (pure; no I/O).
// Mitti labels are read by exact first-line text, so a renamed label is as bad as a missing one: it is reported with what
// was found instead. Every expected wording is imported from the constant the portal reads (never retyped here).
// Join step 5 (4 Nov 2026, ruling 5): the check expects the UNION of the pastes — Part 8 (adult question, photo-ID tick,
// A5 Nov-2 questions), main's Part 3 on the two electrician forms (A3 "Are electrical upgrades needed?" / "Are you doing
// the electrical upgrades today?", "Do you have the Certificate of Electrical Safety now?" on A3 and A4) and main's 4 Nov
// rebuild (A1 ready-to-price tick). A label counts when it is on the form under its own wording OR one of its read
// aliases (the rebuild alias layer `mittiLabelAliases` + the Part 3 legacy wordings), because the portal reads either.
import { definitionReadable } from "./mitti-forms.core";
import { INSTALL_DAY_NOV2_Q, INSTALL_DAY_PART_B_PAGE, INSTALL_DAY_PART_B_TEXT } from "./install-day.core";
import { A3_REPAIR_NEEDED_LABEL, A3_REPAIR_NEEDED_LEGACY_LABEL, A3_UPGRADES_TODAY_LABEL, A3_UPGRADES_TODAY_LEGACY_LABEL, ADULT_PRESENT_LABEL, ADULT_PRESENT_STOP_A3, CERTIFICATE_NOW_LABEL } from "./official-short.core";
import { A1_READY_TO_PRICE_TICK, LEAN_Q } from "./ready-check-lean.core";
import { mittiLabelAliases } from "./mitti-rebuild-labels.core";

export type Part8Template = {
  key: "A1" | "A2" | "A3" | "A4" | "A5";
  /** Mitti template ID (unchanged by the paste). */
  templateId: string;
  /** Question labels that must exist exactly. */
  labels: string[];
  /** Text items (stop line, Part B) that must appear somewhere in the template text. */
  texts: string[];
  /** Choice labels that must be gone. */
  absentChoices: string[];
  /** Other wordings the portal reads for a label (Part 3 legacy wordings); the rebuild aliases are added for every label. */
  aliases?: Record<string, string[]>;
};

/** The A4 – Electrical fixes template (mitti-fixes-template.sql; docs/MITTI_PART3_EDIT_PROMPT.md). */
export const A4_TEMPLATE_ID = "f600e485-5a3a-4a18-a7a5-ccaa82c3916f";

export const PART8_TEMPLATES: Part8Template[] = [
  // Part 8 photo-ID tick + main's 4 Nov rebuild: the ready-to-price tick on A1 only.
  { key: "A1", templateId: "01ee0428-be6d-4435-b34d-8b738935f099", labels: [LEAN_Q.photoIdShown, A1_READY_TO_PRICE_TICK], texts: [], absentChoices: ["ECOWOOL R5"] },
  { key: "A2", templateId: "dbaf67a2-c9c5-4120-8c69-0f4a43c5bd39", labels: [LEAN_Q.photoIdShown], texts: [], absentChoices: ["ECOWOOL R5"] },
  // Part 8 adult question + main's Part 3 (pasted FIRST): the upgrades questions and the certificate question.
  { key: "A3", templateId: "eb3bf3b6-17d3-4c59-9244-5892a0ec16f5", labels: [ADULT_PRESENT_LABEL, A3_REPAIR_NEEDED_LABEL, A3_UPGRADES_TODAY_LABEL, CERTIFICATE_NOW_LABEL], texts: [ADULT_PRESENT_STOP_A3], absentChoices: [],
    aliases: { [A3_REPAIR_NEEDED_LABEL]: [A3_REPAIR_NEEDED_LEGACY_LABEL], [A3_UPGRADES_TODAY_LABEL]: [A3_UPGRADES_TODAY_LEGACY_LABEL] } },
  { key: "A4", templateId: A4_TEMPLATE_ID, labels: [CERTIFICATE_NOW_LABEL], texts: [], absentChoices: [] },
  {
    key: "A5", templateId: "1f325828-3f71-4b1a-988f-083c83414f95",
    labels: Object.values(INSTALL_DAY_NOV2_Q),
    // Final review I3: the FULL Part B declaration (normalised: case, spacing and punctuation ignored), never just its first line.
    texts: [ADULT_PRESENT_STOP_A3, INSTALL_DAY_PART_B_PAGE, INSTALL_DAY_PART_B_TEXT],
    absentChoices: [],
  },
];

export type Part8Result = {
  key: Part8Template["key"];
  ok: boolean;
  /** True when Mitti's reply had no readable items: says nothing about what is missing. */
  unreadable: boolean;
  missing: string[];
  renamed: { expected: string; found: string }[];
  textMissing: string[];
  /** Choices that should have been deleted but are still offered. */
  unexpected: string[];
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
const firstLine = (s: string) => (s.split("\n")[0] ?? "").trim();

function collect(doc: unknown): { labels: string[]; strings: string[] } {
  const labels: string[] = [], strings: string[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (typeof x === "string") { strings.push(x); return; }
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    if (typeof o["label"] === "string") labels.push(firstLine(o["label"]));
    Object.values(o).forEach(walk);
  };
  walk(doc);
  return { labels, strings };
}

function similar(a: string, b: string): boolean {
  if (norm(a) === norm(b)) return true;
  const A = tokens(a), B = tokens(b);
  const both = [...A].filter((t) => B.has(t)).length;
  return both / (A.size + B.size - both) >= 0.6;
}

/** Compare one live template definition with what the Part 8 paste should have left on it. */
export function checkPart8Template(definition: unknown, spec: Part8Template): Part8Result {
  const base = { key: spec.key, missing: [], renamed: [], textMissing: [], unexpected: [] };
  if (!definitionReadable(definition)) return { ...base, ok: false, unreadable: true };
  const { labels, strings } = collect(definition);
  const exact = new Set(labels.map((l) => l.trim()));
  const present = (l: string) => exact.has(l) || [...(spec.aliases?.[l] ?? []), ...mittiLabelAliases(l)].some((a) => exact.has(a));
  const missing = spec.labels.filter((l) => !present(l));
  const wanted = new Set(spec.labels);
  const renamed: Part8Result["renamed"] = [];
  for (const expected of missing) {
    const found = [...new Set(labels)].find((l) => !wanted.has(l) && similar(expected, l));
    if (found) renamed.push({ expected, found });
  }
  const flat = strings.map(norm);
  const textMissing = spec.texts.filter((t) => !flat.some((s) => s.includes(norm(t))));
  const unexpected = spec.absentChoices.filter((c) => labels.some((l) => norm(l) === norm(c)));
  return { key: spec.key, ok: !missing.length && !textMissing.length && !unexpected.length, unreadable: false, missing, renamed, textMissing, unexpected };
}

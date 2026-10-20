// Three role-specific Mitti forms (Activity 48, ESC Guide V1.1 + Accreditation Conditions).
// Required items only. Mitti templates are built in the Mitti UI; this spec is the build sheet
// AND the validator that must pass before a template ID can be used. Labels are Home Insulation Victoria checklist
// wording for the Ready Check; PIESA and PIISA follow the official DEECA forms (uploaded 30 Sep 2026).
export type FormKey = "ready_check" | "ready_check_priced" | "piesa" | "piisa";
export type FieldType = "text" | "number" | "choice" | "multichoice" | "yesno" | "media" | "signature" | "datetime" | "date" | "tick" | "statement";
export type FormField = {
  label: string; type: FieldType; required: boolean; choices?: string[];
  when?: string; // human-readable condition; required only when it applies
  /** Other accepted item labels for the same question (e.g. the installer's own Mitti wording). */
  aliases?: string[];
  /** Extra accepted item types beyond `type` (a Mitti form may capture a choice as a text answer). */
  types?: FieldType[];
  /** Alternative question sets: the field passes when the primary label/alias is present OR every alternative is present. */
  anyOf?: { label: string; type: FieldType; required?: boolean }[];
  /** Required only when none of these labels exist in the form (the form captures the answer another way). */
  notRequiredIf?: string[];
  perArea?: boolean; perPriceLine?: boolean; prefill?: boolean; portalOnly?: boolean; source: string;
  /** Official item id (PIESA/PIISA). */ id?: string;
  /** Official repeating table row. */ row?: { group: string; rows: number };
  /** Printed heading/statement: reproduced verbatim, never answered. */ statement?: "heading" | "statement";
  /** Portal evidence kept outside the official form. */ supplemental?: boolean;
};
import { B1_OPTIONS, B2_OPTIONS, OFFICIAL_ITEMS, type ItemKind } from "./official-forms.core";
import { SHORT_PIESA_FIELDS, SHORT_PIISA_FIELDS } from "./official-short.core";
import { PIISA_DECLARATION_FIELDS } from "./piisa-declaration.core";
import { mittiItemType } from "./mitti.core";

const G = "ESC Guide V1.1";
const F1 = "DEECA PIESA form";
const F2 = "DEECA PIISA form";
const yn = (label: string, source: string, when?: string): FormField => ({ label, type: "yesno", required: true, choices: ["Yes", "No"], ...(when ? { when } : {}), source });
export const B2_ITEMS = [...B2_OPTIONS];
export const PIESA_OUTCOMES = [...B1_OPTIONS];
const KIND_TO_TYPE: Record<ItemKind, FieldType> = { heading: "statement", statement: "statement", text: "text", date: "date", number: "number", yesno: "yesno", yesno_na: "yesno", choice: "choice", ticks: "multichoice", tick: "tick", signature: "signature", attachment: "media" };
/** Official items in official order (verbatim labels). Statements are reproduced by the portal, not answered. */
function officialFields(key: "piesa" | "piisa"): FormField[] {
  const src = key === "piesa" ? F1 : F2;
  return OFFICIAL_ITEMS[key].map((i) => ({
    id: i.id, label: i.label, type: KIND_TO_TYPE[i.kind], required: i.required && i.kind !== "heading" && i.kind !== "statement",
    ...(i.options ? { choices: i.options } : {}), ...(i.when ? { when: i.when } : {}), ...(i.row ? { row: i.row } : {}), ...(i.prefill ? { prefill: true } : {}),
    ...(i.kind === "heading" || i.kind === "statement" ? { statement: i.kind } : {}), source: `${src} ${i.section}`,
  }));
}
const YN = ["Yes", "No"];
const SUPP = "Home Insulation Victoria evidence – not part of the official form";
const sup = (label: string, source: string, extra: Partial<FormField> = {}): FormField => ({ label, type: "media", required: true, supplemental: true, source: `${SUPP}: ${source}`, ...extra });
const PIESA_SUPPLEMENTAL: FormField[] = [
  sup("Electrician photo at front of premises with photo ID", `${G} Table 4`),
  sup("Switchboard cable photo", `${G} Table 4`),
];
const PIISA_SUPPLEMENTAL: FormField[] = [
  sup("SWMS", `${G} SWMS`),
  sup("Is the existing insulation foil backed or electrically conductive?", "HI VIC portal record (not on the official PIISA) — needed to apply the printed Part 6 note (NEEDS OFFICIAL/LEGAL CONFIRMATION)", { type: "choice", choices: ["Yes", "No"], when: "Existing insulation present", id: "supp.conductive" }),
  sup("HI VIC supporting evidence: photo of existing insulation showing whether it is foil backed or conductive", "HI VIC supporting evidence — separate from the official PIISA, which asks for no photo", { when: "Existing insulation present", id: "supp.conductiveEvidence" }),
  sup("Isolation photo – switchboard tagged and locked out, solar and battery isolators off", `${G} Table 4`),
  sup("Electrician photo at front of premises with photo ID on install day", `${G} Table 4`, { when: "Electrician required at installation" }),
  sup("Product packaging photo – brand, model, R-value", `${G} Table 4`),
  sup("Daily re-check completed", "portal record of Part 8 item i", { type: "yesno", choices: YN, when: "Multi-day install" }),
  sup("360 video of ceiling space after upgrade", `${G} Table 4`, { perArea: true }),
  sup("New insulation depth photo with vertical ruler", `${G} Table 4`, { perArea: true }),
  sup("Final floor plan – installed m² and products per area", "Industry Pack records 2 of 2"),
];

/** Pricing section — installer-sourced jobs only (Form A1). Tick what's included, describe Other, ONE total price. */
export const PRICE_ITEMS = ["R5.0 supply and install", "Removal of existing insulation", "Difficult access", "Other"] as const;
/** Retired by Jo (5 Oct) but still accepted so answers from the not-yet-updated live Mitti template keep parsing. */
export const LEGACY_PRICE_ITEMS = ["Tile lift", "Metal sheet access"] as const;
/** The installer's form may word an inclusion slightly differently; both mean the same line. */
const PRICE_ALIASES: Record<string, string> = { "r5.0 ceiling insulation - supply & install": "R5.0 supply and install" };
export const PRICING_FIELDS: FormField[] = [
  { label: "What's included in your quote?", type: "multichoice", required: true, choices: ["R5.0 ceiling insulation - supply & install", "Removal of existing insulation", "Difficult access", "Other"], source: "portal – 'R5.0 ceiling insulation - supply & install' must be ticked; Removal ticked only when an area says Remove" },
  { label: "What else is included?", type: "text", required: true, when: "Other is ticked", source: "portal – required only when Other is ticked" },
  { label: "Total quoted price (inc GST)", type: "number", required: true, source: "portal – one total incl GST; becomes the installer line on the owner's co-branded quote" },
];

const READY_CHECK_TITLE = "Home Insulation Victoria | Ready Check – Eligibility & Measure-up (Installer)";

/** Shared evidence fields for both Ready Check variants (A1 installer-sourced, A2 HI VIC-sourced).
 *  Aliases cover the exact wording of both live Mitti templates (A1 `template_01ee…`, A2 `template_aafa…`),
 *  so the validator accepts either real form without loosening anything. */
const READY_CHECK_FIELDS: FormField[] = [
      // 1. Check the job details (portal-prefilled; installer confirms)
      { label: "Portal Job Number", type: "text", required: true, prefill: true, source: "portal" },
      { label: "Site address", type: "text", required: true, prefill: true, source: "portal" },
      { label: "Owner name", type: "text", required: true, prefill: true, aliases: ["Homeowner name"], source: "portal" },
      { label: "Property type", type: "choice", required: true, prefill: true, choices: ["House", "Townhouse", "Unit or apartment"], types: ["text"], source: "portal – prefilled from enquiry; portal derives building class (House/Townhouse = Class 1, Unit = Class 2 sole-occupancy unit)" },
      { label: "Office life support result", type: "text", required: true, prefill: true, aliases: ["Life support equipment at property?"], source: "portal – office screening result; display only, never re-asked" },
      { label: "Are these details correct?", type: "choice", required: true, choices: ["Yes", "No"], aliases: ["Are the property details provided above correct?"], source: "portal – installer confirms prefilled details" },
      { label: "What needs correcting?", type: "text", required: true, when: "No", aliases: ["What needs to be corrected?"], source: "portal – corrections go to the office" },
      // 2. Getting into the ceiling
      { label: "Assessor", type: "text", required: true, prefill: true, source: "portal – person doing the measure-up" },
      { label: "Installer photo at front of premises with photo ID", type: "media", required: false, source: `${G} Table 4 – the installer-sourced A1 form collects it at installation instead` },
      { label: "Roof type", type: "choice", required: true, choices: ["Tiles", "Metal sheet", "Other"], aliases: ["What type of roof does the home have?"], source: "portal – site context for the install crew" },
      // A1 has no separate "Other" detail question for the roof; the office sees the parsed report on review.
      { label: "Describe the roof type", type: "text", required: true, when: "Other", notRequiredIf: ["What type of roof does the home have?"], source: "portal – quoting" },
      { label: "How easy is the ceiling access?", type: "choice", required: true, choices: ["Easy", "Moderate", "Difficult"], aliases: ["How would you rate the ceiling access?"], source: "portal – quoting: access difficulty" },
      { label: "Photo of the ceiling access point", type: "media", required: true, aliases: ["Upload a clear photo of the ceiling access point"], source: "portal – quoting + ESC Table 4 access evidence" },
      // 3. Ceiling areas
      { label: "How many separate ceiling areas are there?", type: "choice", required: true, choices: ["1", "2", "3", "4", "5", "6+"], aliases: ["How many ceiling areas need to be measured separately?"], source: "portal – opens that many repeating 'Ceiling area' sections" },
      { label: "Where is this area?", type: "text", required: true, perArea: true, aliases: ["Which part of the home does this ceiling area cover?"], source: `${G} Table 4 floor plan, e.g. Main house, Rear extension` },
      { label: "Length (m)", type: "number", required: true, perArea: true, notRequiredIf: ["Enter the measured ceiling area (m²)"], source: "portal – portal works out the m2; odd shapes are split into extra areas" },
      { label: "Width (m)", type: "number", required: true, perArea: true, notRequiredIf: ["Enter the measured ceiling area (m²)"], source: "portal – portal works out the m2; odd shapes are split into extra areas" },
      { label: "Is there existing insulation?", type: "choice", required: true, perArea: true, choices: ["Yes", "No"], aliases: ["Is there existing insulation in this ceiling area?"], source: `${G} eligibility` },
      { label: "Insulation type (tick all that apply)", type: "multichoice", required: true, perArea: true, choices: ["Batts", "Loose fill"], when: "Yes", aliases: ["What type of existing insulation is installed? Select all that apply"], anyOf: [{ label: "Batts", type: "tick" }, { label: "Loose fill", type: "tick" }], source: "portal – quoting: loose fill and batts price differently; choose all that apply" },
      { label: "Depth (mm)", type: "number", required: true, perArea: true, when: "Yes", aliases: ["What is the measured insulation depth (mm)?"], source: "Assignment form" },
      { label: "Photo with tape measure showing depth", type: "media", required: true, perArea: true, when: "Yes", aliases: ["Upload a photo clearly showing the measured insulation depth"], notRequiredIf: ["No photo? I confirm the existing insulation is below R2.0 and the home is eligible for the rebate"], source: `${G} Table 4` },
      { label: "No photo? I confirm the existing insulation is below R2.0 and the home is eligible for the rebate", type: "tick", required: true, perArea: true, when: "Yes", notRequiredIf: ["Photo with tape measure showing depth", "Upload a photo clearly showing the measured insulation depth"], source: "portal – Jo 8 Oct 2026: the installer may tick this confirmation instead of uploading the depth photo" },
      { label: "What needs to happen to it?", type: "choice", required: true, perArea: true, choices: ["Remove", "Top up", "Not sure"], when: "Yes", aliases: ["What is required for the existing insulation?"], source: `${G} removal criteria; Not sure goes to office review` },
      { label: "Area to remove (m2)", type: "number", required: true, perArea: true, when: "Remove", aliases: ["How much existing insulation needs to be removed? (m²)"], source: "portal – removal pricing" },
      { label: "Photo of the empty ceiling space", type: "media", required: true, perArea: true, when: "No", aliases: ["Upload an overview photo of this ceiling area"], source: `${G} Table 4` },
      { label: "Recessed downlights in this area?", type: "choice", required: true, perArea: true, choices: ["Yes", "No"], aliases: ["Are there recessed downlights in this ceiling area?"], source: "portal – observation only; electrician confirms ratings at PIESA" },
      { label: "How many?", type: "number", required: true, perArea: true, when: "Yes", aliases: ["How many recessed downlights?"], source: "portal – luminaire count" },
      { label: "Hazards in this area?", type: "choice", required: true, perArea: true, choices: ["Yes", "No"], aliases: ["Are there any issues that could affect the insulation installation?", "Are there any issues that could affect the insulation installation? Example: exposed wiring, vermin, restricted access or other hazards"], source: `${G} safety – installer observation, electrician confirms` },
      { label: "Describe them and add a photo", type: "media", required: true, perArea: true, when: "Yes", aliases: ["Describe the issue and add a photo"], source: `${G} safety` },
      // 4. Whole job
      { label: "How was the ceiling measured?", type: "choice", required: true, choices: ["Laser in the ceiling space", "Tape in the ceiling space", "Scaled from floor plan", "Other"], aliases: ["How was this ceiling area measured?"], perArea: true, source: "portal – measurement provenance; aerial/online estimates never accepted" },
      { label: "Explain the method", type: "text", required: true, when: "Scaled from floor plan or Other", aliases: ["Tell us how you measured it"], perArea: true, source: "portal – provenance" },
      { label: "Upgrade area diagram or floor plan", type: "media", required: true, perArea: true, aliases: ["Upload your area sketch or floor plan."], source: `${G} Table 4 – required regulator evidence: sketch of each area with its length and width; draw it in the form, photograph a paper sketch, mark up a plan photo, or upload a plan` },
      { label: "Was the ceiling or roof built or replaced in the last 5 years?", type: "choice", required: true, choices: ["Yes", "No", "Not sure"], types: ["text"], source: `${G} eligibility` },
      // 6. Extras (Jo 8 Oct 2026): the installer reports anything beyond the agreed install and removal rates
      // (e.g. tile lift, metal-sheet access, difficult access). The office prices these into the measured quote;
      // the installer never enters a price here.
      { label: "Are any extras needed beyond the standard install and removal?", type: "choice", required: true, choices: ["Yes", "No"], source: "portal – quoting: extras the office must price (Jo 8 Oct 2026)" },
      { label: "Describe each extra and why it is needed", type: "text", required: true, when: "Yes", source: "portal – quoting: extras detail for the office" },
      { label: "Photos of each extra", type: "media", required: true, when: "Yes", source: "portal – quoting: extras evidence" },
      // 7. Finish
      { label: "Anything else the office should know?", type: "text", required: false, source: "portal" },
      { label: "I confirm this information is accurate", type: "signature", required: true, aliases: ["I confirm the information, measurements, photos and quote provided in this Ready Check are accurate to the best of my knowledge.", "I confirm the information, measurements and photos provided in this Ready Check are accurate to the best of my knowledge."], source: `${G} – installer confirmation` },
];

export const FORMS: Record<FormKey, { title: string; role: "installer" | "electrician"; fields: FormField[] }> = {
  // Form A2 — we bring the customer: evidence only, no pricing (owner is quoted at our set price).
  ready_check: {
    title: READY_CHECK_TITLE,
    role: "installer",
    fields: READY_CHECK_FIELDS,
  },
  // Form A1 — installer brings the customer: identical evidence questions plus the quoted-price section.
  ready_check_priced: {
    title: `${READY_CHECK_TITLE} – with quoted price`,
    role: "installer",
    fields: [...READY_CHECK_FIELDS, ...PRICING_FIELDS],
  },
  // Short onsite forms (approved 3 Oct 2026): clear full-sentence questions. The portal expands the answers
  // into every official Word-form item (official-expand.core.ts) and fills the official document itself.
  piesa: { title: "VEU pre-installation electrical safety assessment form", role: "electrician", fields: [...SHORT_PIESA_FIELDS, ...PIESA_SUPPLEMENTAL] },
  piisa: { title: "VEU pre-installation installer safety assessment form", role: "installer", fields: [...SHORT_PIISA_FIELDS.slice(0, -3), ...PIISA_DECLARATION_FIELDS, ...SHORT_PIISA_FIELDS.slice(-3), ...PIISA_SUPPLEMENTAL] },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const TYPE_ALIASES: Record<FieldType, string[]> = {
  text: ["text", "textsingle"], number: ["number", "slider", "textsingle", "text"], choice: ["list", "question", "choice"],
  multichoice: ["list", "question", "choice", "multiselect", "checkbox"],
  yesno: ["question", "list", "yesno"], media: ["media", "attachment", "drawing"], signature: ["signature", "drawing"], datetime: ["datetime"],
  // Mitti has no date-only item; the portal keeps only the date part (see official-forms.core renderOfficialDocument).
  date: ["datetime", "date"], tick: ["checkbox", "question", "list"], statement: [],
};

export type TemplateItem = { label: string; type: string };
/** Validates a Mitti template's items against a form spec. Fails closed: any issue blocks use. */
export function validateTemplate(key: FormKey, items: TemplateItem[]): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const byLabel = new Map<string, TemplateItem[]>();
  for (const it of items) {
    const full = norm(it.label ?? "");
    if (!full) continue;
    byLabel.set(full, [...(byLabel.get(full) ?? []), it]);
    // Mitti appends help text after a line break (e.g. "How many ceiling areas need to be measured separately?\nCount areas...").
    // Index the first line too so the required wording still matches while the help text stays visible in Mitti.
    const first = norm(String(it.label ?? "").split("\n")[0] ?? "");
    if (first && first !== full) byLabel.set(first, [...(byLabel.get(first) ?? []), it]);
  }
  // Official forms repeat some labels (e.g. "Licence no:" in B3 and Section C): expect exactly that many.
  const expected = new Map<string, number>();
  const fields = FORMS[key].fields.filter((f) => !f.statement);
  for (const f of fields) if (!f.perArea && !f.perPriceLine && !f.row) expected.set(norm(f.label), (expected.get(norm(f.label)) ?? 0) + 1);
  const labelsOf = (f: FormField) => [norm(f.label), ...(f.aliases ?? []).map(norm)];
  const typeOk = (f: { type: FieldType; types?: FieldType[] }, t: string) => [f.type, ...(f.types ?? [])].some((ty) => TYPE_ALIASES[ty].includes(String(t).toLowerCase()));
  const optional = (f: FormField) => f.required === false || (f.notRequiredIf?.some((l) => (byLabel.get(norm(l)) ?? []).length > 0) ?? false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const checked = new Set<string>();
  for (const f of fields) {
    // anyOf: the question may appear as one multichoice OR as separate checkboxes (e.g. Batts / Loose fill).
    if (f.anyOf) {
      const primaryHits = labelsOf(f).flatMap((l) => byLabel.get(l) ?? []);
      const altOk = f.anyOf.every((a) => { const hits = byLabel.get(norm(a.label)) ?? []; return hits.length > 0 && hits.every((h) => typeOk(a, h.type)); });
      if (primaryHits.length === 0 && !altOk) { if (f.required) issues.push(`Missing: ${f.label}`); continue; }
      if (primaryHits.length > 0 && primaryHits.some((h) => !typeOk(f, h.type))) issues.push(`Wrong type: ${f.label} (expected ${f.type})`);
      continue;
    }
    const hits = labelsOf(f).flatMap((l) => byLabel.get(l) ?? []);
    if (hits.length === 0) { if (!optional(f)) issues.push(`Missing: ${f.label}`); continue; }
    const exp = expected.get(norm(f.label)) ?? 0;
    const rowCap = fields.filter((x) => x.row && norm(x.label) === norm(f.label)).reduce((s, x) => s + x.row!.rows, 0);
    if (!f.perArea && !f.perPriceLine && !f.row && hits.length > exp + rowCap) { if (!checked.has(norm(f.label))) issues.push(`Duplicate: ${f.label}`); checked.add(norm(f.label)); continue; }
    if (!f.perArea && !f.perPriceLine && !f.row && hits.length < exp && !optional(f)) { if (!checked.has(norm(f.label))) issues.push(`Missing: ${f.label} (expected ${exp})`); checked.add(norm(f.label)); continue; }
    if (hits.some((h) => !typeOk(f, h.type))) issues.push(`Wrong type: ${f.label} (expected ${f.type})`);
  }
  // Role guard: installer forms must never contain PIESA conclusions.
  if (FORMS[key].role === "installer" && [...byLabel.keys()].some((l) => l.includes("b1 assessment outcome") || l.includes("check one option only") || l.includes("certificate of electrical safety"))) {
    issues.push("Installer form must not contain PIESA outcome or CoES fields.");
  }
  return { ok: issues.length === 0, issues };
}

/** Plain-text build sheet for creating the form in the Mitti UI. */
export function buildSheet(key: FormKey): string {
  const f = FORMS[key];
  return [f.title, "", ...f.fields.map((x, i) =>
    `${i + 1}. ${x.label} — ${x.type}${x.choices ? ` [${x.choices.join(" | ")}]` : ""}${x.required ? " (required)" : ""}${x.when ? ` · only if: ${x.when}` : ""}${x.perArea ? " · repeat per area" : ""}${x.prefill ? " · prefilled" : ""}`)].join("\n");
}

/** Flattens a v1 template definition into {label,type}. The item type is its type-named key (e.g. "textsingle"). */
const NON_QUESTION = new Set(["section", "category", "instruction", "logicfield"]);
/**
 * Template questions from header_items + items (nested children or flat parent_id), typed deterministically by
 * mittiItemType (explicit `type`, else a known Mitti type key — never "first object-valued property", so
 * metadata/options can't win). Option/config objects are not walked, so they never appear as questions.
 */
type RawItem = Record<string, unknown> & { label?: unknown; children?: unknown; items?: unknown };
const structural = (it: RawItem) => [...NON_QUESTION].find((k) => it[k] != null) ?? null;
/** Same traversal as mitti.core flatten (header_items + items, nested children/items or flat parent_id). */
function rawItems(def: unknown): RawItem[] {
  const root = ((def as { template?: unknown })?.template ?? def) as { header_items?: unknown; items?: unknown } | null;
  const out: RawItem[] = [];
  const walk = (it: unknown, reference = false): void => {
    // Flat definitions may also list child IDs; the corresponding objects are read from the item arrays.
    if (reference && typeof it === "string") return;
    if (!it || typeof it !== "object" || Array.isArray(it)) throw new Error("Unsupported Mitti item structure");
    const r = it as RawItem; out.push(r);
    for (const key of ["children", "items"] as const) {
      const children = r[key];
      if (children == null) continue;
      if (!Array.isArray(children)) throw new Error("Unsupported Mitti child structure");
      // The shared native/prefill reader chooses children OR items. Do not diagnose absent questions
      // from a mixed tree whose second stream that reader cannot consume.
      if (key === "items" && children.length > 0 && r.children != null) throw new Error("Unsupported mixed Mitti child structure");
      children.forEach((child) => walk(child, true));
    }
  };
  for (const key of ["header_items", "items"] as const) {
    const items = root?.[key];
    if (items == null) continue;
    if (!Array.isArray(items)) throw new Error("Unsupported Mitti definition structure");
    items.forEach((it) => walk(it));
  }
  return out;
}
const itemType = (it: RawItem) => mittiItemType(it) || structural(it) || "";
// Keep every existing validator alias plus the other known Mitti question kinds. An arbitrary explicit
// `type` is not proof that this reader understands the definition (mittiItemType deliberately preserves it).
const SUPPORTED_QUESTION_TYPES = new Set([...Object.values(TYPE_ALIASES).flat(), "textmulti", "site", "switch"]);
export function flattenDefinition(def: unknown): TemplateItem[] {
  return rawItems(def).filter((it) => typeof it.label === "string" && it.label.trim()).map((it) => ({ label: it.label as string, type: itemType(it) })).filter((e) => !NON_QUESTION.has(e.type.toLowerCase()));
}
/** Readable = the envelope carries item arrays AND at least one item with a supported type. Otherwise the check
 *  can't prove anything (metadata-only/unsupported envelopes are "unreadable", never "questions missing"). */
export function definitionReadable(def: unknown): boolean {
  try {
    const items = rawItems(def);
    // A partly unreadable definition cannot prove the remaining questions are absent either.
    if (!items.every((it) => { const t = itemType(it).toLowerCase(); return NON_QUESTION.has(t) || SUPPORTED_QUESTION_TYPES.has(t); })) return false;
    return items.some((it) => typeof it.label === "string" && it.label.trim() !== "" && SUPPORTED_QUESTION_TYPES.has(itemType(it).toLowerCase()));
  } catch {
    return false;
  }
}

const MITTI_TYPE: Record<FieldType, string> = {
  text: "Text answer", number: "Number answer", choice: "Multiple choice (single answer)", multichoice: "Multiple choice (choose ALL that apply)", yesno: "Question (response set)",
  media: "Media (photo/video, camera allowed)", signature: "Signature", datetime: "Date & time",
  date: "Date & time (the portal keeps the date only)", tick: "Checkbox (single tick)", statement: "Instruction (text only, copy verbatim)",
};
/** Exact brief to paste into Mitti's AI template builder. Labels must be copied verbatim — the portal matches on them. */
export function mittiAiPrompt(key: FormKey): string {
  const f = FORMS[key];
  const fields = f.fields.filter((x) => !x.portalOnly);
  const rowGroups = [...new Set(fields.filter((x) => x.row).map((x) => x.row!.group))];
  const perArea = fields.filter((x) => x.perArea);
  const perPriceLine = fields.filter((x) => x.perPriceLine);
  const lines = fields.map((x, i) => {
    const bits = [MITTI_TYPE[x.type]];
    if (x.choices) bits.push(`options exactly: ${x.choices.map((c) => `"${c}"`).join(" / ")}`);
    bits.push(x.required ? (x.when ? `MANDATORY only when: ${x.when} (use logic to show it; hidden otherwise)` : "MANDATORY") : "optional");
    if (x.perArea) bits.push("inside the repeating 'Ceiling area' section");
    if (x.perPriceLine) bits.push("inside the repeating 'Quoted price line' section");
    if (x.row) bits.push(`column of the repeating table "${x.row.group}" (up to ${x.row.rows} rows)`);
    if (x.supplemental) bits.push("put in the separate final section \"Home Insulation Victoria evidence (not part of the official form)\"");
    if (x.statement) return `${i + 1}. INSTRUCTION, verbatim: "${x.label}"`;
    if (x.prefill) bits.push("header field, prefilled by the portal – keep editable but do not rename");
    return `${i + 1}. "${x.label}" — ${bits.join("; ")}`;
  });
  return [
    `Build a Mitti inspection template titled exactly: "${f.title}"`,
    "",
    "STRICT RULES:",
    "- Use every field label EXACTLY as written between quotes (same words, capitals and punctuation). Do not rephrase, merge, split, shorten or add numbering to labels. Our system reads answers by label.",
    "- Do not add any extra questions, scoring, default answers or pre-ticked boxes.",
    "- Every field marked MANDATORY must be set to required so the inspection cannot be completed without it.",
    "- Fields marked 'MANDATORY only when' must be built with Mitti logic on the named trigger question: shown and required when the condition is met, hidden and not required otherwise.",
    "- Yes/No questions use a response set with exactly the listed options, no N/A unless listed.",
    "- Photo/video fields must allow the camera and multiple files.",
    "- Signature fields must capture the signer's name.",
    perArea.length ? `- Ask "How many separate ceiling areas are there?" first, then open that many repeating sections called "Ceiling area" (Area 1, Area 2, ...). These fields go inside the repeating section: ${perArea.map((x) => `"${x.label}"`).join(", ")}. All other fields are NOT repeated.` : "",
    perPriceLine.length ? `- Put these fields in a repeatable section called "Quoted price line": ${perPriceLine.map((x) => `"${x.label}"`).join(", ")}.` : "",
    key === "ready_check_priced" ? `- Price section: ONE multiple-choice question where the installer ticks everything included ("What's included in your quote?" with the options: "R5.0 ceiling insulation - supply & install" / "Removal of existing insulation" / "Other"), then ONE total price "Total quoted price (inc GST)". Do NOT add a price box per item and do NOT repeat the price section. All prices incl GST.` : "",
    key === "ready_check" || key === "ready_check_priced" ? `- For "Upgrade area diagram or floor plan": allow the installer to DRAW the diagram inside the form (sketch/drawing input), photograph a paper sketch, or upload a plan. Help text: "Rough is fine. Draw the house shape, split it into the areas you measured, write the length and width on each, take a photo, done."` : "",
    key === "ready_check" || key === "ready_check_priced" ? `- Extras section: "Are any extras needed beyond the standard install and removal?" is a Yes/No question. When Yes, show and require "Describe each extra and why it is needed" and "Photos of each extra" (Mitti logic on the Yes answer). Help text on the Yes/No: "Anything beyond your agreed install and removal rates - for example tile lift, metal-sheet access or difficult access. The office prices these; do not add a price here."` : "",
    rowGroups.length ? `- Build each repeating table (${rowGroups.join(", ")}) as a repeatable section with exactly the listed columns, limited to the listed number of rows.` : "",
    key === "piesa" ? "- Section C fields are completed after rectification and are shown only when the B1 answer is \"Electrical rectification work is required before insulation is installed or upgraded.\"" : "",
    key === "piesa" || key === "piisa" ? "- If \"Is anyone at this property dependent on life support?\" is Yes, the consent/medical-plan question and attachment are required; if neither was received, the assessment must not proceed (add an instruction saying: STOP – do not start the assessment. Call the Home Insulation Victoria office.)." : "",
    "- Order the fields exactly as listed.",
    "",
    "FIELDS:",
    ...lines,
  ].filter((l) => l !== "").join("\n");
}

// ---- Ready Check variants + quoted-price parsing (pure, tested) ----

/** Which Ready Check variant a job uses. Installer-sourced jobs get the priced form (A1); our leads get evidence-only (A2). */
export function readyCheckVariant(channel: string | null | undefined): "ready_check" | "ready_check_priced" {
  return channel === "installer_sourced" ? "ready_check_priced" : "ready_check";
}

export type QuotedPrice = {
  included: string[];
  otherDescription: string;
  totalIncGst: number;
  agreedWithOwner: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Validates an installer's quoted price from the priced Ready Check (Form A1). Fails closed:
 * any problem returns an issue list and the quote goes to office review — a price is never guessed.
 * Checks: R5.0 ticked; Removal ticked iff any ceiling area says Remove; Other needs a description; one positive total.
 */
export function validateQuotedPrice(input: {
  included: (string | null | undefined)[];
  otherDescription?: string | null;
  totalIncGst?: number | null;
  agreedWithOwner?: boolean | null;
  removalRequired?: boolean | null;
}): { ok: boolean; issues: string[]; price: QuotedPrice | null } {
  const issues: string[] = [];
  const included: string[] = [];
  for (const raw of input.included) {
    const v = (raw ?? "").trim().toLowerCase();
    if (!v) continue;
    const key = (PRICE_ALIASES[v] ?? v).toLowerCase();
    const m = ([...PRICE_ITEMS, ...LEGACY_PRICE_ITEMS] as readonly string[]).find((p) => p.toLowerCase() === key);
    if (!m) issues.push(`Unknown included item "${raw}".`);
    else if (!included.includes(m)) included.push(m);
  }
  if (!included.includes("R5.0 supply and install")) issues.push("'R5.0 supply and install' must be ticked as included.");
  const removal = included.includes("Removal of existing insulation");
  if (input.removalRequired === true && !removal) issues.push("A ceiling area is marked Remove, but removal isn't ticked as included in the price.");
  if (input.removalRequired === false && removal) issues.push("Removal is ticked as included, but no ceiling area is marked Remove — office must review.");
  const otherDescription = (input.otherDescription ?? "").trim();
  if (included.includes("Other") && !otherDescription) issues.push("Other is ticked — describe the other item.");
  const totalIncGst = Number(input.totalIncGst);
  if (!Number.isFinite(totalIncGst) || totalIncGst <= 0) issues.push("Total quoted price is missing or not a positive number.");
  // "Price already agreed with the owner?" is optional: the office reviews every quote draft before sending,
  // so no draft is ever sent without a human look. A Yes/No answer is still recorded when the form has it.
  if (issues.length) return { ok: false, issues, price: null };
  return { ok: true, issues: [], price: { included, otherDescription, totalIncGst: r2(totalIncGst), agreedWithOwner: input.agreedWithOwner === true } };
}

// Three role-specific Mitti forms (Activity 48, ESC Guide V1.1 + Accreditation Conditions).
// Required items only. Mitti templates are built in the Mitti UI; this spec is the build sheet
// AND the validator that must pass before a template ID can be used. Labels are Home Insulation Victoria checklist
// wording for the Ready Check; PIESA and PIISA follow the official DEECA forms (uploaded 30 Sep 2026).
export type FormKey = "ready_check" | "ready_check_priced" | "piesa" | "piisa";
export type FieldType = "text" | "number" | "choice" | "multichoice" | "yesno" | "media" | "signature" | "datetime" | "date" | "tick" | "statement";
export type FormField = {
  label: string; type: FieldType; required: boolean; choices?: string[];
  when?: string; // human-readable condition; required only when it applies
  perArea?: boolean; perPriceLine?: boolean; prefill?: boolean; portalOnly?: boolean; source: string;
  /** Official item id (PIESA/PIISA). */ id?: string;
  /** Official repeating table row. */ row?: { group: string; rows: number };
  /** Printed heading/statement: reproduced verbatim, never answered. */ statement?: "heading" | "statement";
  /** Portal evidence kept outside the official form. */ supplemental?: boolean;
};
import { B1_OPTIONS, B2_OPTIONS, OFFICIAL_ITEMS, type ItemKind } from "./official-forms.core";

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
  sup("Isolation photo – switchboard tagged and locked out, solar and battery isolators off", `${G} Table 4`),
  sup("Electrician photo at front of premises with photo ID on install day", `${G} Table 4`, { when: "Electrician required at installation" }),
  sup("Product packaging photo – brand, model, R-value", `${G} Table 4`),
  sup("Daily re-check completed", "portal record of Part 8 item i", { type: "yesno", choices: YN, when: "Multi-day install" }),
  sup("360 video of ceiling space after upgrade", `${G} Table 4`, { perArea: true }),
  sup("New insulation depth photo with vertical ruler", `${G} Table 4`, { perArea: true }),
  sup("Final floor plan – installed m² and products per area", "Industry Pack records 2 of 2"),
];

/** Pricing section — installer-sourced jobs only (Form A1). Tick what's included, describe Other, ONE total price. */
export const PRICE_ITEMS = ["R5.0 supply and install", "Removal of existing insulation", "Difficult access", "Tile lift", "Metal sheet access", "Other"] as const;
export const PRICING_FIELDS: FormField[] = [
  { label: "What's included in your price (tick all that apply)", type: "multichoice", required: true, choices: [...PRICE_ITEMS], source: "portal – 'R5.0 supply and install' must be ticked; Removal ticked only when an area says Remove" },
  { label: "Describe the other item", type: "text", required: true, when: "Other is ticked", source: "portal – required only when Other is ticked" },
  { label: "Total quoted price $", type: "number", required: true, source: "portal – one total incl GST; becomes the installer line on the owner's co-branded quote" },
  { label: "Price already agreed with the owner?", type: "choice", required: true, choices: ["Yes", "No"], source: "portal – if Yes, their price stays and our fees go on top, less the VEU discount" },
];

const READY_CHECK_TITLE = "Home Insulation Victoria | Ready Check – Eligibility & Measure-up (Installer)";

/** Shared evidence fields for both Ready Check variants (A1 installer-sourced, A2 HI VIC-sourced). */
const READY_CHECK_FIELDS: FormField[] = [
      // 1. Check the job details (portal-prefilled; installer confirms)
      { label: "Portal Job Number", type: "text", required: true, prefill: true, source: "portal" },
      { label: "Site address", type: "text", required: true, prefill: true, source: "portal" },
      { label: "Owner name", type: "text", required: true, prefill: true, source: "portal" },
      { label: "Property type", type: "choice", required: true, prefill: true, choices: ["House", "Townhouse", "Unit or apartment"], source: "portal – prefilled from enquiry; portal derives building class (House/Townhouse = Class 1, Unit = Class 2 sole-occupancy unit)" },
      { label: "Office life support result", type: "text", required: true, prefill: true, source: "portal – office screening result; display only, never re-asked" },
      { label: "Are these details correct?", type: "choice", required: true, choices: ["Yes", "No"], source: "portal – installer confirms prefilled details" },
      { label: "What needs correcting?", type: "text", required: true, when: "No", source: "portal – corrections go to the office" },
      // 2. Getting into the ceiling
      { label: "Assessor", type: "text", required: true, prefill: true, source: "portal – person doing the measure-up" },
      { label: "Installer photo at front of premises with photo ID", type: "media", required: true, source: `${G} Table 4` },
      { label: "Roof type", type: "choice", required: true, choices: ["Tiles", "Metal sheet", "Other"], source: "portal – quoting: tile lift / metal-sheet access extras" },
      { label: "Describe the roof type", type: "text", required: true, when: "Other", source: "portal – quoting" },
      { label: "How easy is the ceiling access?", type: "choice", required: true, choices: ["Easy", "Moderate", "Difficult"], source: "portal – quoting: access difficulty" },
      { label: "Photo of the ceiling access point", type: "media", required: true, source: "portal – quoting + ESC Table 4 access evidence" },
      // 3. Ceiling areas
      { label: "How many separate ceiling areas are there?", type: "choice", required: true, choices: ["1", "2", "3", "4", "5", "6+"], source: "portal – opens that many repeating 'Ceiling area' sections" },
      { label: "Where is this area?", type: "text", required: true, perArea: true, source: `${G} Table 4 floor plan, e.g. Main house, Rear extension` },
      { label: "Length (m)", type: "number", required: true, perArea: true, source: "portal – portal works out the m2; odd shapes are split into extra areas" },
      { label: "Width (m)", type: "number", required: true, perArea: true, source: "portal – portal works out the m2" },
      { label: "Is there existing insulation?", type: "choice", required: true, perArea: true, choices: ["Yes", "No"], source: `${G} eligibility` },
      { label: "Insulation type (tick all that apply)", type: "multichoice", required: true, perArea: true, choices: ["Batts", "Loose fill"], when: "Yes", source: "portal – quoting: loose fill and batts price differently; choose all that apply" },
      { label: "Depth (mm)", type: "number", required: true, perArea: true, when: "Yes", source: "Assignment form" },
      { label: "Photo with tape measure showing depth", type: "media", required: true, perArea: true, when: "Yes", source: `${G} Table 4` },
      { label: "What needs to happen to it?", type: "choice", required: true, perArea: true, choices: ["Remove", "Top up", "Not sure"], when: "Yes", source: `${G} removal criteria; Not sure goes to office review` },
      { label: "Area to remove (m2)", type: "number", required: true, perArea: true, when: "Remove", source: "portal – removal pricing" },
      { label: "Photo of the empty ceiling space", type: "media", required: true, perArea: true, when: "No", source: `${G} Table 4` },
      { label: "Recessed downlights in this area?", type: "choice", required: true, perArea: true, choices: ["Yes", "No"], source: "portal – observation only; electrician confirms ratings at PIESA" },
      { label: "How many?", type: "number", required: true, perArea: true, when: "Yes", source: "portal – luminaire count" },
      { label: "Hazards in this area?", type: "choice", required: true, perArea: true, choices: ["Yes", "No"], source: `${G} safety – installer observation, electrician confirms` },
      { label: "Describe them and add a photo", type: "media", required: true, perArea: true, when: "Yes", source: `${G} safety` },
      // 4. Whole job
      { label: "How was the ceiling measured?", type: "choice", required: true, choices: ["Laser in the ceiling space", "Tape in the ceiling space", "Scaled from floor plan", "Other"], source: "portal – measurement provenance; aerial/online estimates never accepted" },
      { label: "Explain the method", type: "text", required: true, when: "Scaled from floor plan or Other", source: "portal – provenance" },
      { label: "Upgrade area diagram or floor plan", type: "media", required: true, source: `${G} Table 4 – required regulator evidence: sketch of each area with its length and width; draw it in the form, photograph a paper sketch, mark up a plan photo, or upload a plan` },
      { label: "Was the ceiling or roof built or replaced in the last 5 years?", type: "choice", required: true, choices: ["Yes", "No", "Not sure"], source: `${G} eligibility` },
      // 6. Finish
      { label: "Anything else the office should know?", type: "text", required: false, source: "portal" },
      { label: "I confirm this information is accurate", type: "signature", required: true, source: `${G} – installer confirmation` },
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
  piesa: { title: "VEU pre-installation electrical safety assessment form", role: "electrician", fields: [...officialFields("piesa"), ...PIESA_SUPPLEMENTAL] },
  piisa: { title: "VEU pre-installation installer safety assessment form", role: "installer", fields: [...officialFields("piisa"), ...PIISA_SUPPLEMENTAL] },
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
  for (const it of items) { const n = norm(it.label ?? ""); if (!n) continue; byLabel.set(n, [...(byLabel.get(n) ?? []), it]); }
  // Official forms repeat some labels (e.g. "Licence no:" in B3 and Section C): expect exactly that many.
  const expected = new Map<string, number>();
  const fields = FORMS[key].fields.filter((f) => !f.statement);
  for (const f of fields) if (!f.perArea && !f.perPriceLine && !f.row) expected.set(norm(f.label), (expected.get(norm(f.label)) ?? 0) + 1);
  const checked = new Set<string>();
  for (const f of fields) {
    const hits = byLabel.get(norm(f.label)) ?? [];
    if (hits.length === 0) { if (f.required) issues.push(`Missing: ${f.label}`); continue; }
    const exp = expected.get(norm(f.label)) ?? 0;
    const rowCap = fields.filter((x) => x.row && norm(x.label) === norm(f.label)).reduce((s, x) => s + x.row!.rows, 0);
    if (!f.perArea && !f.perPriceLine && !f.row && hits.length > exp + rowCap) { if (!checked.has(norm(f.label))) issues.push(`Duplicate: ${f.label}`); checked.add(norm(f.label)); continue; }
    if (!f.perArea && !f.perPriceLine && !f.row && hits.length < exp && f.required) { if (!checked.has(norm(f.label))) issues.push(`Missing: ${f.label} (expected ${exp})`); checked.add(norm(f.label)); continue; }
    if (hits.some((h) => !TYPE_ALIASES[f.type].includes(String(h.type).toLowerCase()))) issues.push(`Wrong type: ${f.label} (expected ${f.type})`);
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
export function flattenDefinition(def: unknown): TemplateItem[] {
  const out: TemplateItem[] = [];
  const skip = new Set(["label", "id", "children", "parent_id", "item_id"]);
  const walk = (o: unknown) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== "object") return;
    const r = o as Record<string, unknown>;
    if (typeof r["label"] === "string" && r["label"].trim()) {
      const type = typeof r["type"] === "string" ? (r["type"] as string) : Object.keys(r).find((k) => !skip.has(k) && r[k] && typeof r[k] === "object") ?? "";
      if (!["section", "category", "instruction", "logicfield"].includes(type)) out.push({ label: r["label"] as string, type });
    }
    Object.values(r).forEach(walk);
  };
  const root = (def as { template?: unknown })?.template ?? def;
  walk((root as { items?: unknown })?.items ?? []);
  return out;
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
    key === "ready_check_priced" ? `- Price section: ONE multiple-choice question where the installer ticks everything included, then ONE total price. Do NOT add a price box per item and do NOT repeat the price section. Build "What's included in your price (tick all that apply)" as a SINGLE question with all 6 options (not separate checkboxes). Show "Describe the other item" only when "Other" is ticked. All prices incl GST.` : "",
    key === "ready_check" || key === "ready_check_priced" ? `- For "Upgrade area diagram or floor plan": allow the installer to DRAW the diagram inside the form (sketch/drawing input), photograph a paper sketch, or upload a plan. Help text: "Rough is fine. Draw the house shape, split it into the areas you measured, write the length and width on each, take a photo, done."` : "",
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
    const m = (PRICE_ITEMS as readonly string[]).find((p) => p.toLowerCase() === v);
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
  if (input.agreedWithOwner == null) issues.push("'Price already agreed with the owner?' was not answered.");
  if (issues.length) return { ok: false, issues, price: null };
  return { ok: true, issues: [], price: { included, otherDescription, totalIncGst: r2(totalIncGst), agreedWithOwner: input.agreedWithOwner === true } };
}

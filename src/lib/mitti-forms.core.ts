// Three role-specific Mitti forms (Activity 48, ESC Guide V1.1 + Accreditation Conditions).
// Required items only. Mitti templates are built in the Mitti UI; this spec is the build sheet
// AND the validator that must pass before a template ID can be used. Labels are HI VIC checklist
// wording, not official DEECA form wording.
export type FormKey = "ready_check" | "piesa" | "piisa";
export type FieldType = "text" | "number" | "choice" | "yesno" | "media" | "signature" | "datetime";
export type FormField = {
  label: string; type: FieldType; required: boolean; choices?: string[];
  when?: string; // human-readable condition; required only when it applies
  perArea?: boolean; prefill?: boolean; portalOnly?: boolean; source: string;
};

const G = "ESC Guide V1.1";
const YN = ["Yes", "No"];
export const PIESA_OUTCOMES = [
  "Completed: no electrical issues identified",
  "Completed: electrical issues identified and all rectified",
  "Completed: electrical issues identified, rectification not possible, electrician will be required at installation",
];

export const FORMS: Record<FormKey, { title: string; role: "installer" | "electrician"; fields: FormField[] }> = {
  ready_check: {
    title: "HI VIC | Ready Check – Eligibility & Measure-up (Installer)",
    role: "installer",
    fields: [
      { label: "Portal Job Number", type: "text", required: true, prefill: true, source: "portal" },
      { label: "Site address", type: "text", required: true, prefill: true, source: "portal" },
      { label: "Installer photo at front of premises with photo ID", type: "media", required: true, source: `${G} Table 4` },
      { label: "Building class", type: "choice", required: true, choices: ["Class 1", "Class 2 sole-occupancy unit"], source: `${G} eligibility` },
      { label: "Relevant ceiling or roof built in the last 5 years", type: "yesno", required: true, choices: YN, source: `${G} eligibility` },
      { label: "Area name", type: "text", required: true, perArea: true, source: `${G} Table 4 floor plan` },
      { label: "Existing insulation", type: "choice", required: true, perArea: true, choices: ["Uninsulated", "Under-insulated"], source: `${G} eligibility` },
      { label: "Existing insulation depth photo with vertical ruler", type: "media", required: true, perArea: true, when: "Under-insulated", source: `${G} Table 4` },
      { label: "Estimated existing R-value", type: "number", required: true, perArea: true, when: "Under-insulated", source: "Assignment form" },
      { label: "Removal required", type: "yesno", required: true, perArea: true, choices: YN, when: "Under-insulated", source: `${G} removal criteria` },
      { label: "Measured area m2", type: "number", required: true, perArea: true, source: "VEEC creation form" },
      { label: "360 video of ceiling space before upgrade", type: "media", required: true, perArea: true, source: `${G} Table 4` },
      { label: "Floor plan with dimensions", type: "media", required: true, source: `${G} Table 4` },
      { label: "Luminaires appear IC or IC-4 (observation only)", type: "yesno", required: true, choices: YN, source: "portal – electrician confirms" },
      { label: "Quote extras", type: "text", required: false, portalOnly: true, source: "portal – tile lift, metal roof, access" },
    ],
  },
  piesa: {
    title: "HI VIC | PIESA – Pre-installation Electrical Safety Assessment (Electrician)",
    role: "electrician",
    fields: [
      { label: "Portal Job Number", type: "text", required: true, prefill: true, source: "portal" },
      { label: "Site address", type: "text", required: true, prefill: true, source: "portal" },
      { label: "Electrician licence number", type: "text", required: true, prefill: true, source: "Assignment form Part B" },
      { label: "REC registration number", type: "text", required: true, prefill: true, source: "Assignment form Part B" },
      { label: "Electrician photo at front of premises with photo ID", type: "media", required: true, source: `${G} Table 4` },
      { label: "Life support written consent or medical plan attached", type: "media", required: true, when: "Life support = Yes", source: `${G} life support` },
      { label: "Mains cables RCD protected where required", type: "yesno", required: true, choices: YN, source: "Reg 23A / Guide" },
      { label: "Mains cables TPS or equivalent", type: "yesno", required: true, choices: YN, source: "Reg 23A / Guide" },
      { label: "Mains cables meet basic protection", type: "yesno", required: true, choices: YN, source: "Reg 23A / Guide" },
      { label: "Switchboard cable photo", type: "media", required: true, source: `${G} Table 4` },
      { label: "All luminaires IC or IC-4", type: "yesno", required: true, choices: YN, source: "Reg 23A / Guide" },
      { label: "Space above ceiling can be de-energised", type: "yesno", required: true, choices: YN, source: "Reg 23A / Guide" },
      { label: "Rectification required", type: "yesno", required: true, choices: YN, source: "Reg 23A / Guide" },
      { label: "Rectification items", type: "text", required: true, when: "Rectification required = Yes", source: "Reg 23A / Guide" },
      { label: "Electrician required at installation", type: "yesno", required: true, choices: YN, source: "Reg 23A / Guide" },
      { label: "Downlights replaced before installation", type: "yesno", required: true, choices: YN, source: "VEEC creation form" },
      { label: "PIESA outcome", type: "choice", required: true, choices: PIESA_OUTCOMES, source: G },
      { label: "Certificate of Electrical Safety number", type: "text", required: true, when: "Rectification done", source: `${G} Table 4` },
      { label: "Rectification description", type: "text", required: true, when: "Rectification done", source: `${G} Table 4` },
      { label: "Assessment date", type: "datetime", required: true, source: "Conditions 3.1" },
      { label: "Electrician signature", type: "signature", required: true, source: `${G} Table 4` },
      { label: "Property owner signature", type: "signature", required: true, source: `${G} Table 4` },
    ],
  },
  piisa: {
    title: "HI VIC | PIISA – Pre-installation Installer Safety Assessment (Lead installer)",
    role: "installer",
    fields: [
      { label: "Portal Job Number", type: "text", required: true, prefill: true, source: "portal" },
      { label: "Lead installer EEC certification number", type: "text", required: true, prefill: true, source: "Assignment form Part C" },
      { label: "Signed PIESA copy held", type: "yesno", required: true, choices: YN, source: `${G} PIISA` },
      { label: "Worksite safe and PIESA conditions will be followed", type: "yesno", required: true, choices: YN, source: "Conditions 4.1" },
      { label: "Only IC or IC-4 luminaires in ceiling area", type: "yesno", required: true, choices: YN, source: `${G} Table 4` },
      { label: "Life support consent or plan held", type: "yesno", required: true, choices: YN, when: "Life support = Yes", source: `${G} life support` },
      { label: "SWMS", type: "media", required: true, source: `${G} SWMS` },
      { label: "Electrician photo at front of premises with photo ID on install day", type: "media", required: true, when: "Electrician required at installation", source: `${G} Table 4` },
      { label: "Isolation photo – switchboard tagged and locked out", type: "media", required: true, source: `${G} Table 4` },
      { label: "Product packaging photo – brand, model, R-value", type: "media", required: true, source: `${G} Table 4` },
      { label: "Daily re-check completed", type: "yesno", required: true, choices: YN, when: "Multi-day install", source: `${G} daily check` },
      { label: "360 video of ceiling space after upgrade", type: "media", required: true, perArea: true, source: `${G} Table 4` },
      { label: "New insulation depth photo with vertical ruler", type: "media", required: true, perArea: true, source: `${G} Table 4` },
      { label: "Lead installer signature", type: "signature", required: true, source: `${G} Table 4` },
      { label: "Assessment date", type: "datetime", required: true, source: "Conditions 4.1" },
    ],
  },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const TYPE_ALIASES: Record<FieldType, string[]> = {
  text: ["text", "textsingle", "question", "list"], number: ["number", "slider", "text"], choice: ["list", "question", "choice"],
  yesno: ["question", "list", "yesno"], media: ["media", "attachment"], signature: ["signature"], datetime: ["datetime"],
};

export type TemplateItem = { label: string; type: string };
/** Validates a Mitti template's items against a form spec. Fails closed: any issue blocks use. */
export function validateTemplate(key: FormKey, items: TemplateItem[]): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const byLabel = new Map<string, TemplateItem[]>();
  for (const it of items) { const n = norm(it.label ?? ""); if (!n) continue; byLabel.set(n, [...(byLabel.get(n) ?? []), it]); }
  for (const f of FORMS[key].fields) {
    const hits = byLabel.get(norm(f.label)) ?? [];
    if (hits.length === 0) { if (f.required) issues.push(`Missing: ${f.label}`); continue; }
    if (hits.length > 1 && !f.perArea) { issues.push(`Duplicate: ${f.label}`); continue; }
    if (hits.some((h) => !TYPE_ALIASES[f.type].includes(String(h.type).toLowerCase()))) issues.push(`Wrong type: ${f.label} (expected ${f.type})`);
  }
  // Role guard: installer forms must never contain PIESA conclusions.
  if (FORMS[key].role === "installer" && [...byLabel.keys()].some((l) => l.includes("piesa outcome") || l.includes("certificate of electrical safety"))) {
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

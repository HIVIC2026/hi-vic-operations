// Three role-specific Mitti forms (Activity 48, ESC Guide V1.1 + Accreditation Conditions).
// Required items only. Mitti templates are built in the Mitti UI; this spec is the build sheet
// AND the validator that must pass before a template ID can be used. Labels are Home Insulation Victoria checklist
// wording for the Ready Check; PIESA and PIISA follow the official DEECA forms (uploaded 30 Sep 2026).
export type FormKey = "ready_check" | "piesa" | "piisa";
export type FieldType = "text" | "number" | "choice" | "yesno" | "media" | "signature" | "datetime";
export type FormField = {
  label: string; type: FieldType; required: boolean; choices?: string[];
  when?: string; // human-readable condition; required only when it applies
  perArea?: boolean; prefill?: boolean; portalOnly?: boolean; source: string;
};

const G = "ESC Guide V1.1";
const F1 = "DEECA PIESA form";
const F2 = "DEECA PIISA form";
const yn = (label: string, source: string, when?: string): FormField => ({ label, type: "yesno", required: true, choices: ["Yes", "No"], ...(when ? { when } : {}), source });
export const B2_ITEMS = [
  "Prohibited luminaires present – replace with IC and/or IC4 rated LED lights",
  "Circuit protection rating needs to be upgraded (derated)",
  "RCDs need to be installed for circuit/s within the ceiling insulation area",
  "Cables need to be replaced with TPS (or equivalent)",
  "Cables and wiring need to be altered or repaired to meet Basic Protection",
  "Other",
];
const SECTION_C = [
  "I confirm all identified rectification works have been completed in accordance with the requirements detailed in the Observations, Conditions and Required Rectifications section",
  "I confirm that all luminaires present in the ceiling area are IC and/or IC-4 rated (i.e. classified and marked)",
  "I confirm that all mains connected cables in the ceiling space are appropriately protected by an RCD where required",
  "I confirm that all mains connected cables in the ceiling space are TPS or an equivalent cable type",
  "I confirm that all mains connected cables in the ceiling space meet Basic Protection Requirements",
  "I confirm that an electrical safety assessment has been completed and the ceiling space is either free from electrical hazards or the remaining hazards and controls have been documented and provided to the insulation installer",
  "I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission",
];
const OWNER_DECL = [
  "I acknowledge that access to the ceiling space between now and the installation of insulation may void this assessment",
  "I confirm that the electrical safety assessment works were completed on the above date",
  "I confirm that any electrical rectification works were completed on the above date",
  "I understand that information contained within this form will be provided to the person undertaking the installation work and may be provided upon request to ESC",
];
const YN = ["Yes", "No"];
// Exact B1 options from the official DEECA form.
export const PIESA_OUTCOMES = [
  "Electrical rectification work is not required before insulation is installed or upgraded.",
  "Electrical rectification work is required before insulation is installed or upgraded.",
  "Electrical rectification work is not possible prior to insulation being installed or upgraded under parts 2 and 3",
];

export const FORMS: Record<FormKey, { title: string; role: "installer" | "electrician"; fields: FormField[] }> = {
  ready_check: {
    title: "Home Insulation Victoria | Ready Check – Eligibility & Measure-up (Installer)",
    role: "installer",
    fields: [
      { label: "Portal Job Number", type: "text", required: true, prefill: true, source: "portal" },
      { label: "Site address", type: "text", required: true, prefill: true, source: "portal" },
      { label: "Owner name", type: "text", required: true, prefill: true, source: "portal" },
      { label: "Assessor", type: "text", required: true, prefill: true, source: "portal – person doing the measure-up" },
      { label: "Installer photo at front of premises with photo ID", type: "media", required: true, source: `${G} Table 4` },
      { label: "Property type", type: "choice", required: true, prefill: true, choices: ["House", "Townhouse", "Unit or apartment"], source: "portal – prefilled from enquiry; portal derives building class (House/Townhouse = Class 1, Unit = Class 2 sole-occupancy unit)" },
      { label: "Relevant ceiling or roof built in the last 5 years", type: "yesno", required: true, choices: YN, source: `${G} eligibility` },
      { label: "Area name", type: "text", required: true, perArea: true, source: `${G} Table 4 floor plan` },
      { label: "Existing insulation", type: "choice", required: true, perArea: true, choices: ["Uninsulated", "Under-insulated"], source: `${G} eligibility` },
      { label: "Existing insulation depth photo with vertical ruler", type: "media", required: true, perArea: true, when: "Under-insulated", source: `${G} Table 4` },
      { label: "Estimated existing R-value", type: "number", required: true, perArea: true, when: "Under-insulated", source: "Assignment form" },
      { label: "Removal required", type: "yesno", required: true, perArea: true, choices: YN, when: "Under-insulated", source: `${G} removal criteria` },
      { label: "Insulation type to remove", type: "choice", required: true, perArea: true, choices: ["Batts or blankets", "Loose fill", "Mixed (batts and loose fill)", "Not sure"], when: "Removal required = Yes", source: "portal – quoting: loose fill and batts price differently" },
      { label: "Measured area m2", type: "number", required: true, perArea: true, source: "VEEC creation form" },
      { label: "360 video of ceiling space before upgrade", type: "media", required: true, perArea: true, source: `${G} Table 4` },
      { label: "Total measured ceiling area m2", type: "number", required: true, source: "VEEC creation form – sum of all areas" },
      { label: "How the ceiling was measured", type: "choice", required: true, choices: ["Laser measure in the ceiling space", "Tape measure in the ceiling space", "Scaled from the floor plan", "Other (explain in notes)"], source: "portal – measurement provenance; aerial/online estimates never accepted" },
      { label: "Measurement notes", type: "text", required: false, source: "portal – explain Other, obstacles, partial access" },
      { label: "Any existing insulation present", type: "yesno", required: true, choices: YN, source: "portal – whole-house summary" },
      { label: "Total removal area m2", type: "number", required: true, when: "Any area Removal required = Yes", source: "portal – quoting" },
      { label: "Floor plan with dimensions", type: "media", required: true, source: `${G} Table 4` },
      { label: "Luminaires appear IC or IC-4 (observation only)", type: "yesno", required: true, choices: YN, source: "portal – electrician confirms" },
      { label: "Quote extras", type: "text", required: false, portalOnly: true, source: "portal – tile lift, metal roof, access" },
    ],
  },
  piesa: {
    title: "VEU Pre-installation electrical safety assessment (Insulation)",
    role: "electrician",
    fields: [
      ...[["Portal Job Number", "text", true], ["Site address", "text", true], ["Property owner name", "text", true], ["Date of inspection", "datetime", false]].map(([l, t, p]) => ({ label: l as string, type: t as FieldType, required: true, prefill: p as boolean, source: `${F1} Part 1` })),
      yn("Is anyone at this property dependent on life support?", `${F1} Part 1`),
      { label: "If yes, has written consent or a medical plan been received prior to this assessment commencing?", type: "choice", required: true, choices: ["Yes – received Consent", "Yes – received Medical Plan"], when: "Life support = Yes", source: `${F1} Part 1` },
      { label: "Life support consent or medical plan attachment", type: "media", required: true, when: "Life support = Yes", source: `${F1} Part 1` },
      yn("Has the presence of any consumer mains cable in the ceiling space been identified and marked?", `${F1} Part 2`),
      yn("Is the main switch for the premises accessible and operational?", `${F1} Part 2`),
      yn("Is the main switch able to isolate all cables running through the ceiling space safely (excluding the mains cables)?", `${F1} Part 2`),
      yn("Is the main switch able to be secured in the off position?", `${F1} Part 2`),
      yn("Has testing been carried out to ensure all cables and equipment within the ceiling area are de-energised when the main switch is isolated?", `${F1} Part 2`),
      yn("Are Residual Current Devices (RCDs) (safety switches) present for circuit/s within the ceiling insulation area, as per the most current version of AS/NZS 3000?", `${F1} Part 2`),
      yn("Have all RCD's been tested for operation?", `${F1} Part 2`),
      yn("Is there a Solar PV, Battery system and/or alternative supply, such as a fuel driven generator present?", `${F1} Part 3`),
      yn("Are instructions provided on the safe shutdown/isolation, and re-energisation of the solar, battery or alternative supply system?", `${F1} Part 3`, "Alternative supply = Yes"),
      yn("Is the ground level system AC and/or DC (may be part of the inverter) isolator accessible, operational and can be isolated safely?", `${F1} Part 3`, "Alternative supply = Yes"),
      yn("Are all system cable(s) in the ceiling space in conduit and clearly labelled?", `${F1} Part 3`, "Alternative supply = Yes"),
      yn("Are the system cables within the ceiling space protected and/or supported in accessible areas to prevent damage?", `${F1} Part 3`, "Alternative supply = Yes"),
      yn("Is the premises clear of any electrically conductive conduit?", `${F1} Part 4`),
      yn("Are the electrical cables present in the ceiling space supported or run in a way to reduce the risk of damage or strain during insulation installation work?", `${F1} Part 4`),
      yn("Do electrical cables that are or will be completely or partially surrounded by thermal insulation meet the treatment requirements of AS 3999:2015 section 2.6 or AS/NZS 3000:2018 clause 3.3.2.13?", `${F1} Part 4`),
      { label: "Have thermoplastic insulated and sheathed (TPS) cables present in the ceiling space been visually inspected and deemed safe?", type: "yesno", required: true, choices: ["Yes", "No", "N/A"], source: `${F1} Part 4` },
      yn("Do all the electrical terminations and connections within the ceiling space meet basic protection requirements?", `${F1} Part 4`),
      yn("Are all plug bases within the ceiling space securely fixed?", `${F1} Part 4`),
      yn("If electrically conductive insulation (e.g. foil backed) is present in the ceiling space, it has been confirmed that it is not live?", `${F1} Part 4`),
      yn("Are there any mains connected cables which are not TPS in the ceiling?", `${F1} Part 5`),
      yn("Is there split metal conduit wiring present in the ceiling space?", `${F1} Part 5`),
      yn("Are there damaged or deteriorated cables present in the ceiling space?", `${F1} Part 5`),
      yn("Are there recessed luminaires present in the ceiling?", `${F1} Part 6`),
      { label: "Total number of luminaires", type: "number", required: true, when: "Recessed luminaires = Yes", source: `${F1} Part 6` },
      yn("Are there prohibited luminaires that are not IC and/or IC-4 rated (i.e. classified and marked) installed at the premises?", `${F1} Part 6`, "Recessed luminaires = Yes"),
      yn("Are there any electrical appliances present in the ceiling space (e.g. water heaters, air conditioning units, radiant heating panels, heat lamps or similar)?", `${F1} Part 7`),
      yn("Are there any exhaust fans or heating flues that vent into or through the ceiling space?", `${F1} Part 7`),
      { label: "Appliance, location and hazard", type: "text", required: true, when: "Any Part 7 answer = Yes", source: `${F1} Part 7` },
      { label: "Actions undertaken or to be undertaken by the insulation installer to eliminate or minimise the risks", type: "text", required: true, when: "Hazard identified", source: `${F1} Part 7` },
      yn("Does this action effectively reduce the risk associated with the identified hazard/s?", `${F1} Part 7`, "Hazard identified"),
      { label: "Other electrical or other hazards identified and action taken", type: "text", required: false, source: `${F1} Part 7` },
      { label: "B1 Assessment outcome", type: "choice", required: true, choices: PIESA_OUTCOMES, source: `${F1} B1` },
      { label: "B2 Required rectifications", type: "choice", required: true, choices: B2_ITEMS, when: "B1 = rectification required", source: `${F1} B2` },
      { label: "B2 Other rectification details", type: "text", required: true, when: "B2 includes Other", source: `${F1} B2` },
      { label: "Electrician photo at front of premises with photo ID", type: "media", required: true, source: `${G} Table 4` },
      { label: "Switchboard cable photo", type: "media", required: true, source: `${G} Table 4` },
      ...["Licence no (initial assessment)", "Full Name (initial assessment)", "REC Name (initial assessment)", "REC registration no (initial assessment)", "Telephone no (initial assessment)"].map((l) => ({ label: l, type: "text" as FieldType, required: true, prefill: true, source: `${F1} B3` })),
      { label: "B3 Electrician declaration – initial assessment", type: "signature", required: true, source: `${F1} B3` },
      ...["Licence no (rectification)", "Full Name (rectification)", "REC Name (rectification)", "REC registration no (rectification)", "Telephone no (rectification)"].map((l) => ({ label: l, type: "text" as FieldType, required: true, when: "Rectification done", source: `${F1} Section C` })),
      ...SECTION_C.map((l) => ({ label: l, type: "yesno" as FieldType, required: true, choices: ["Yes"], when: "Rectification done", source: `${F1} Section C` })),
      { label: "Section C signature", type: "signature", required: true, when: "Rectification done", source: `${F1} Section C` },
      { label: "Date of completion", type: "datetime", required: true, when: "Rectification done", source: `${F1} Section C` },
      { label: "Certificate of Electrical Safety number", type: "text", required: true, when: "Rectification done", source: `${F1} Section C` },
      { label: "Date of Certification", type: "datetime", required: true, when: "Rectification done", source: `${F1} Section C` },
      ...OWNER_DECL.map((l) => ({ label: l, type: "yesno" as FieldType, required: true, choices: ["Yes"], source: `${F1} Owner declaration` })),
      { label: "Property owner / owner's representative signature", type: "signature", required: true, source: `${F1} Owner declaration` },
    ],
  },
  piisa: {
    title: "VEU Pre-installation installer safety assessment (Insulation)",
    role: "installer",
    fields: [
      ...["Portal Job Number", "Site address", "Property owner name", "Installation start date", "Predicted installation completion date"].map((l, i) => ({ label: l, type: (i > 2 ? "datetime" : "text") as FieldType, required: true, prefill: i < 3, source: `${F2} Part 1` })),
      yn("Has the household/tenant been informed that the power will be turned off/isolated for the duration of the installation?", `${F2} Part 1`),
      yn("Is anyone at this property dependent on life support?", `${F2} Part 1`),
      { label: "If yes, has written consent or a medical plan been received prior to this assessment commencing?", type: "choice", required: true, choices: ["Yes – received Consent", "Yes – received Medical Plan"], when: "Life support = Yes", source: `${F2} Part 1` },
      ...["Installation date", "Accredited person name", "Installer company name", "Lead installer name", "Lead installer EEC certification number"].map((l, i) => ({ label: l, type: (i === 0 ? "datetime" : "text") as FieldType, required: true, prefill: i > 0, source: `${F2} Part 2` })),
      { label: "Additional installer name and EEC certification number", type: "text", required: false, source: `${F2} Part 2` },
      yn("Has a Safe Work Method Statement (SWMS) for the insulation upgrade at the listed address been completed and all risks identified?", `${F2} Part 3`),
      yn("Have all hazards listed in Table 1: Common hazards when installing insulation been considered, and control measures been implemented when developing the SWMS for this job?", `${F2} Part 3`),
      yn("Has the main and/or alternate power supply been isolated, locked out, tagged and has the roof cavity been confirmed as electrically safe to enter?", `${F2} Part 3`),
      { label: "SWMS", type: "media", required: true, source: `${G} SWMS` },
      { label: "Isolation photo – switchboard tagged and locked out, solar and battery isolators off", type: "media", required: true, source: `${G} Table 4` },
      yn("Is there a Solar PV, Battery system and/or alternative supply, such as a fuel driven generator present?", `${F2} Part 4`),
      yn("Are instructions provided on the safe shutdown/isolation, and re-energisation of the solar, battery or alternative supply system?", `${F2} Part 4`, "Alternative supply = Yes"),
      yn("Is the ground level system AC and/or DC (may be part of the inverter) isolator accessible, operational and can be isolated safely?", `${F2} Part 4`, "Alternative supply = Yes"),
      yn("Has the Pre-installation electrical safety assessment been reviewed by the lead installer and has the site been confirmed as safe to commence works?", `${F2} Part 5`),
      { label: "If the Pre-installation electrical safety assessment recommends an electrician is present at the start of the installation to ensure the area is electrically safe, has this occurred?", type: "yesno", required: true, choices: ["Yes", "No", "N/A"], source: `${F2} Part 5` },
      { label: "Electrician photo at front of premises with photo ID on install day", type: "media", required: true, when: "Electrician required at installation", source: `${G} Table 4` },
      yn("Are there recessed luminaires present in the ceiling?", `${F2} Part 5`),
      { label: "Total number of luminaires", type: "number", required: true, when: "Recessed luminaires = Yes", source: `${F2} Part 5` },
      yn("Did the pre-installation electrical safety assessment confirm that all luminaires present in the ceiling have been upgraded to IC and/or IC-4 rated (i.e. classified and marked)?", `${F2} Part 5`),
      yn("Are all recessed luminaires deemed safe to cover with insulation?", `${F2} Part 5`),
      yn("Did the pre-installation electrical safety assessment confirm that all mains connected cables in the ceiling space are appropriately protected by an RCD where required?", `${F2} Part 5`),
      yn("Did the pre-installation electrical safety assessment confirm that all mains connected cables in the ceiling space are thermoplastic insulated and sheathed (TPS) or an equivalent cable type?", `${F2} Part 5`),
      yn("Did the pre-installation electrical safety assessment confirm that all mains connected cables in the ceiling space meet Basic Protection Requirements?", `${F2} Part 5`),
      yn("Has the owner/occupier confirmed that no one has accessed or carried out any works in the ceiling space since the completion of the Pre-installation electrical safety assessment?", `${F2} Part 5`),
      yn("Is there insulation present in the ceiling?", `${F2} Part 6`),
      { label: "What is the average height of the existing insulation? (mm)", type: "number", required: true, when: "Insulation present", source: `${F2} Part 6` },
      { label: "What is the R-Value of existing insulation (if known)?", type: "number", required: false, when: "Insulation present", source: `${F2} Part 6` },
      { label: "Will the existing ceiling insulation be removed completely or topped up?", type: "choice", required: true, choices: ["Removed", "Topped Up"], when: "Insulation present", source: `${F2} Part 6` },
      yn("Is the existing insulation in a suitable condition for new insulation to be laid over?", `${F2} Part 6`, "Insulation present"),
      { label: "If the existing insulation is not removed, what is the reason?", type: "text", required: true, when: "Topped Up", source: `${F2} Part 6` },
      { label: "Insulation product(s) brand, model and R-value being installed", type: "text", required: true, source: `${F2} Part 7` },
      { label: "Product packaging photo – brand, model, R-value", type: "media", required: true, source: `${G} Table 4` },
      { label: "Daily re-check completed", type: "yesno", required: true, choices: YN, when: "Multi-day install", source: `${F2} Part 8 d.iii` },
      { label: "360 video of ceiling space after upgrade", type: "media", required: true, perArea: true, source: `${G} Table 4` },
      { label: "New insulation depth photo with vertical ruler", type: "media", required: true, perArea: true, source: `${G} Table 4` },
      { label: "Final floor plan – installed m² and products per area", type: "media", required: true, source: "Industry Pack records 2 of 2" },
      { label: "Part 8 Installer declaration", type: "signature", required: true, source: `${F2} Part 8` },
      { label: "Installer full name", type: "text", required: true, prefill: true, source: `${F2} Part 8` },
      { label: "Date", type: "datetime", required: true, source: `${F2} Part 8` },
    ],
  },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const TYPE_ALIASES: Record<FieldType, string[]> = {
  text: ["text", "textsingle"], number: ["number", "slider", "textsingle", "text"], choice: ["list", "question", "choice"],
  yesno: ["question", "list", "yesno"], media: ["media", "attachment"], signature: ["signature", "drawing"], datetime: ["datetime"],
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
  if (FORMS[key].role === "installer" && [...byLabel.keys()].some((l) => l.includes("b1 assessment outcome") || l.includes("certificate of electrical safety"))) {
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
  text: "Text answer", number: "Number answer", choice: "Multiple choice (single answer)", yesno: "Question (response set)",
  media: "Media (photo/video, camera allowed)", signature: "Signature", datetime: "Date & time",
};
/** Exact brief to paste into Mitti's AI template builder. Labels must be copied verbatim — the portal matches on them. */
export function mittiAiPrompt(key: FormKey): string {
  const f = FORMS[key];
  const fields = f.fields.filter((x) => !x.portalOnly);
  const perArea = fields.filter((x) => x.perArea);
  const lines = fields.map((x, i) => {
    const bits = [MITTI_TYPE[x.type]];
    if (x.choices) bits.push(`options exactly: ${x.choices.map((c) => `"${c}"`).join(" / ")}`);
    bits.push(x.required ? (x.when ? `MANDATORY only when: ${x.when} (use logic to show it; hidden otherwise)` : "MANDATORY") : "optional");
    if (x.perArea) bits.push("inside the repeating 'Ceiling area' section");
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
    perArea.length ? `- Put these fields in a repeatable section called "Ceiling area" (one repeat per room/zone): ${perArea.map((x) => `"${x.label}"`).join(", ")}. All other fields are NOT repeated.` : "",
    key === "piesa" ? "- Section C and the rectification electrician fields are completed on the return visit after rectification. Put them in a section called \"Section C – Rectification completion\" shown only when \"B1 Assessment outcome\" is \"Electrical rectification work is required before insulation is installed or upgraded.\"" : "",
    key === "piesa" || key === "piisa" ? "- If \"Is anyone at this property dependent on life support?\" is Yes, the consent/medical-plan question and attachment are required; if neither was received, the assessment must not proceed (add an instruction saying: STOP – do not start the assessment. Call the Home Insulation Victoria office.)." : "",
    "- Order the fields exactly as listed.",
    "",
    "FIELDS:",
    ...lines,
  ].filter((l) => l !== "").join("\n");
}

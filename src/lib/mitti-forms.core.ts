// Three role-specific Mitti forms (Activity 48, ESC Guide V1.1 + Accreditation Conditions).
// Required items only. Mitti templates are built in the Mitti UI; this spec is the build sheet
// AND the validator that must pass before a template ID can be used. Labels are Home Insulation Victoria checklist
// wording for the Ready Check; PIESA and PIISA follow the official DEECA forms (uploaded 30 Sep 2026).
export type FormKey = "ready_check" | "ready_check_priced" | "piesa" | "piisa";
export type FieldType = "text" | "phone" | "number" | "choice" | "multichoice" | "yesno" | "media" | "signature" | "datetime" | "date" | "tick" | "statement";
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
import { PIESA_EVIDENCE } from "./piesa-evidence.core";
import { ACCESS_OPTIONS, AREA_GROUP_BUTTON, ELECTRICIAN_OPTIONS, EXISTING_ACTION_OPTIONS, EXISTING_TYPE_OPTIONS, FAIL_REASON_OPTIONS, INCLUDED_OPTIONS, LEAN_ALIASES, LEAN_Q, MEASURED_HOW_OPTIONS, OUTCOME_FAILED, OUTCOME_OPTIONS, PREMISES_TYPE_OPTIONS, PRODUCT_OPTIONS, PROPERTY_TYPE_OPTIONS, R_ABOVE_LEGACY, R_AT_OR_ABOVE, R_VALUE_OPTIONS, ROOF_OPTIONS, YES_NO } from "./ready-check-lean.core";

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
// Decision 178 (Jo 24 Oct 2026): the four AP evidence items (docs/MITTI_PIESA_FORM_SPEC.md q42–q45). Wording and
// accepted earlier wordings come from piesa-evidence.core.ts so the form check and the completion gate never drift.
const PIESA_SUPPLEMENTAL: FormField[] = PIESA_EVIDENCE.map((e) => sup(e.label, e.id === "ces_file" ? "ESC CES record after rectification (decision 178)" : `${G} Table 4 / ESC 30 Jul 2026 update (decision 178)`, {
  aliases: e.aliases,
  ...(e.id === "hazard_photos" ? { when: "Any hazard answered Yes" } : e.id === "ces_file" ? { when: "Repair work was completed (Section C answered)" } : {}),
}));
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
  // Decision 211: the final plan is generated by the portal from the install-day per-zone confirmations; an upload is legacy/optional.
  sup("Final floor plan – installed m² and products per area", "Industry Pack records 2 of 2 – LEGACY (decision 211): generated by the portal", { required: false }),
];

/** Pricing items the OLD A1 quote page offered and the portal "Your price" card still offers (decision 278). */
export const PRICE_ITEMS = ["R5.0 supply and install", "Removal of existing insulation", "Difficult access", "Other"] as const;
/** Retired by Jo (5 Oct) but still accepted so answers from the not-yet-updated live Mitti template keep parsing. */
export const LEGACY_PRICE_ITEMS = ["Tile lift", "Metal sheet access"] as const;
/** The installer's form may word an inclusion slightly differently; both mean the same line. */
const PRICE_ALIASES: Record<string, string> = {
  "r5.0 ceiling insulation - supply & install": "R5.0 supply and install",
  // Jo 23 Oct A1 labels: first option renamed, new difficult-access option.
  "ceiling insulation - supply & install": "R5.0 supply and install",
  "difficult access charge": "Difficult access",
};
const al = (k: keyof typeof LEAN_Q) => [...(LEAN_ALIASES[k] ?? [])];
/** Decision 278 (Jo 25 Oct 2026): the "Your quote to the homeowner" page is DELETED from A1. The business owner enters the
 *  price, what is included and the electrician on the job page in the portal (installer-price.core). These field specs are
 *  kept ONLY so old A1 forms that still carry the questions keep parsing; they are no longer on the A1 build sheet. */
export const PRICING_FIELDS: FormField[] = [
  // Decision 222: "Difficult access" is NOT an option any more — it is the charge/fee pair on the Roof and access page.
  { label: LEAN_Q.included, type: "multichoice", required: true, choices: [...INCLUDED_OPTIONS], aliases: al("included"), source: "portal – 'Ceiling insulation - supply & install' must be ticked; Removal ticked only when an area says Remove" },
  { label: LEAN_Q.includedOther, type: "text", required: true, when: "Other is ticked", source: "portal – required only when Other is ticked" },
  { label: LEAN_Q.totalPrice, type: "number", required: true, source: "portal – one total incl GST; becomes the installer line on the owner's co-branded quote" },
];
/** Old A1 forms only (decision 278): who does the PIESA; name / licence / price only for a different electrician. */
export const ELECTRICIAN_FIELDS: FormField[] = [
  { label: LEAN_Q.electrician, type: "choice", required: true, choices: [...ELECTRICIAN_OPTIONS], source: "portal – Jo 22 Oct" },
  { label: LEAN_Q.electricianName, type: "text", required: true, when: `${LEAN_Q.electrician} = A different electrician`, source: "portal – compliance" },
  { label: LEAN_Q.electricianLicence, type: "text", required: true, when: `${LEAN_Q.electrician} = A different electrician`, source: "portal – compliance" },
  { label: LEAN_Q.electricianPrice, type: "number", required: true, when: `${LEAN_Q.electrician} = A different electrician`, source: "portal – electrical price inc GST" },
];

const READY_CHECK_TITLE = "Home Insulation Victoria | Ready Check – Eligibility & Measure-up (Installer)";
const WHEN_EXISTING = `${LEAN_Q.existing} = Yes`;

/**
 * Decision 222 (Jo 24 Oct 2026): the LEAN Ready Check — docs/MITTI_READY_CHECK_LIVE_AUDIT_2026-10-24.md §6 with
 * Length (m) + Width (m) per area. Shared by A1 (installer-supplied customer, priced) and A2 (our lead). Labels are
 * exactly what the lean templates show and what the readers match; `aliases` keep the 22–24 Oct live wording and the
 * older spec labels validating, so forms in progress on the old templates still pass and parse. The per-area block is
 * ONE repeating group ("Add a ceiling area"): no "how many areas" question, no fixed copies, no sketch upload (211).
 */
const READY_CHECK_FIELDS: FormField[] = [
  // Page 1 — Job (prefilled by the portal; the installer only corrects)
  { label: LEAN_Q.jobNumber, type: "text", required: true, prefill: true, source: "portal – job link (exact match when present)" },
  { label: LEAN_Q.siteAddress, type: "text", required: true, prefill: true, aliases: al("siteAddress"), source: "portal" },
  { label: LEAN_Q.ownerName, type: "text", required: true, prefill: true, aliases: al("ownerName"), source: "portal" },
  { label: LEAN_Q.ownerPhone, type: "phone", required: true, prefill: true, aliases: al("ownerPhone"), source: "portal – owner mobile (quote basic); A2 prefilled from the job" },
  { label: LEAN_Q.ownerEmail, type: "text", required: true, prefill: true, aliases: al("ownerEmail"), source: "portal – owner email (quote basic); A2 prefilled from the job" },
  { label: LEAN_Q.propertyType, type: "choice", required: true, prefill: true, choices: [...PROPERTY_TYPE_OPTIONS], types: ["text"], source: "portal – prefilled from the enquiry (House/Townhouse = Class 1, Unit = Class 2 sole-occupancy unit); no Other text" },
  // Page 2 — Before you go up
  { label: LEAN_Q.contactPermission, type: "yesno", required: true, choices: [...YES_NO], source: "portal – contact permission (quote basic); No = hard stop (STOP_NO_CONTACT)" },
  { label: LEAN_Q.lifeSupport, type: "yesno", required: true, prefill: true, choices: [...YES_NO], types: ["text"], aliases: al("lifeSupport"), source: "portal – prefilled from the office record; A1 Yes = office stop; A2 uses the owner's website answer" },
  { label: LEAN_Q.builtLast5, type: "yesno", required: true, prefill: true, choices: [...YES_NO], types: ["text"], source: `${G} eligibility – prefilled from the owner's declared answer; A1 Yes = office stop; A2 uses the website answer` },
  { label: LEAN_Q.premisesType, type: "choice", required: true, prefill: true, choices: [...PREMISES_TYPE_OPTIONS], source: "Activity Guide v1.2 Appendix C premises type (decision 222) – recorded as the mitti_premises_type event" },
  // Page 3 — Roof and access
  { label: LEAN_Q.roofType, type: "choice", required: true, choices: [...ROOF_OPTIONS], aliases: al("roofType"), source: "portal – notes for the install crew (no describe box)" },
  { label: LEAN_Q.access, type: "choice", required: true, choices: [...ACCESS_OPTIONS], aliases: al("access"), source: "portal – access_difficulty; No safe access = difficult + hard stop (decision 222). Mitti: note required on Difficult and No safe access" },
  { label: LEAN_Q.accessCharge, type: "yesno", required: true, choices: [...YES_NO], when: `${LEAN_Q.access} = Difficult`, source: "portal – difficultAccessFee" },
  { label: LEAN_Q.accessFee, type: "number", required: true, when: `${LEAN_Q.accessCharge} = Yes`, types: ["text"], source: "portal – A1: inside the installer total (shown on the owner line); A2: the installer's charge to Home Insulation Victoria, becomes the owner's DIFFICULT_ACCESS line" },
  { label: LEAN_Q.accessPhoto, type: "media", required: false, aliases: al("accessPhoto"), source: `${G} Table 4 access evidence – optional on the form (Jo 23 Oct); missing = install-day photo lock` },
  // Page 4 — Ceiling areas: ONE repeating group "Add a ceiling area"
  { label: LEAN_Q.areaName, type: "text", required: true, perArea: true, aliases: al("areaName"), source: `${G} Table 4 diagram box label + install-day zone name (decisions 211/222)` },
  { label: LEAN_Q.lengthM, type: "number", required: true, perArea: true, notRequiredIf: [LEAN_Q.measuredM2], source: "portal – the portal works out the m² and draws the diagram (decision 222: Length + Width per area)" },
  { label: LEAN_Q.widthM, type: "number", required: true, perArea: true, notRequiredIf: [LEAN_Q.measuredM2], source: "portal – the portal works out the m² and draws the diagram (decision 222: Length + Width per area)" },
  // 22–24 Oct forms: the single m² entry. Legacy only (portalOnly = never asked for on a new build), still read as the fallback.
  { label: LEAN_Q.measuredM2, type: "number", required: false, perArea: true, portalOnly: true, types: ["text"], aliases: al("measuredM2"), source: "portal – LEGACY (22–24 Oct forms): single m² entry, read when no Length/Width" },
  { label: LEAN_Q.measuredHow, type: "choice", required: true, perArea: true, choices: [...MEASURED_HOW_OPTIONS], aliases: al("measuredHow"), source: "portal – measurement provenance; aerial/online estimates never accepted" },
  { label: LEAN_Q.measuredHowOther, type: "text", required: true, perArea: true, when: `${LEAN_Q.measuredHow} = Other`, aliases: al("measuredHowOther"), source: "portal – provenance" },
  { label: LEAN_Q.existing, type: "yesno", required: true, perArea: true, choices: [...YES_NO], aliases: al("existing"), source: `${G} eligibility – insulation_present` },
  { label: LEAN_Q.existingType, type: "multichoice", required: true, perArea: true, choices: [...EXISTING_TYPE_OPTIONS], when: WHEN_EXISTING, aliases: al("existingType"), anyOf: [{ label: "Batts", type: "tick" }, { label: "Loose fill", type: "tick" }], source: "portal – removal pricing (loose fill and batts price differently); Other raises an office note" },
  { label: LEAN_Q.rValue, type: "choice", required: true, perArea: true, choices: [...R_VALUE_OPTIONS], when: WHEN_EXISTING, types: ["text"], source: `${G} eligibility – R2.0 exactly counts as "${R_AT_OR_ABOVE}" (STOP_R2); "${R_ABOVE_LEGACY}" on 22–24 Oct forms reads the same` },
  { label: LEAN_Q.depthPhoto, type: "media", required: false, perArea: true, when: WHEN_EXISTING, aliases: al("depthPhoto"), source: `${G} Table 4 – optional on the form; missing = install-day photo lock` },
  { label: LEAN_Q.existingAction, type: "choice", required: true, perArea: true, choices: [...EXISTING_ACTION_OPTIONS], when: WHEN_EXISTING, aliases: al("existingAction"), source: `${G} removal criteria; Not sure goes to office review` },
  { label: LEAN_Q.removeM2, type: "number", required: true, perArea: true, when: `${LEAN_Q.existingAction} = Remove`, types: ["text"], aliases: al("removeM2"), source: "portal – removal pricing (summed over areas)" },
  { label: LEAN_Q.beforeVideo, type: "media", required: true, perArea: true, aliases: al("beforeVideo"), source: `${G} Table 4 – the before video of this area (decision 264); counts as the install's before-work video` },
  { label: LEAN_Q.downlights, type: "yesno", required: true, perArea: true, choices: [...YES_NO], aliases: al("downlights"), source: "portal – observation only; electrician confirms ratings at PIESA" },
  { label: LEAN_Q.downlightsCount, type: "number", required: true, perArea: true, when: `${LEAN_Q.downlights} = Yes`, types: ["text"], aliases: al("downlightsCount"), source: "portal – luminaire count (PIISA P5 prefill)" },
  { label: LEAN_Q.issues, type: "yesno", required: true, perArea: true, choices: [...YES_NO], aliases: al("issues"), source: `${G} safety – installer observation; Yes = office review` },
  // Lean (Jo 24 Oct): Mitti cannot require a note on a media item, so the hazard is TWO questions — the note (text) then the
  // photo (media). 24 Oct live forms asked a text "Please explain" (accepted as the note); only a photo counts as evidence.
  { label: LEAN_Q.issueNote, type: "text", required: true, perArea: true, when: `${LEAN_Q.issues} = Yes`, aliases: al("issueNote"), source: `${G} safety – hazard description and where it is in the area (kept on the area record)` },
  { label: LEAN_Q.issuePhoto, type: "media", required: true, perArea: true, when: `${LEAN_Q.issues} = Yes`, aliases: al("issuePhoto"), source: `${G} safety – SWMS hazard evidence (restored, decision 222); the only hazard evidence` },
  // Page 5 — Product and result
  { label: LEAN_Q.product, type: "choice", required: true, choices: [...PRODUCT_OPTIONS], aliases: al("product"), source: "portal – quote basic; exactly one of the 8 approved options (decision 150); always shown, not only on passed (decision 222)" },
  { label: LEAN_Q.outcome, type: "choice", required: true, choices: [...OUTCOME_OPTIONS], source: "portal – installer's overall call (failed = office review, never an auto-rejection); the portal applies the rules from the answers" },
  { label: LEAN_Q.failReasons, type: "multichoice", required: true, choices: [...FAIL_REASON_OPTIONS], when: `${LEAN_Q.outcome} = ${OUTCOME_FAILED}`, types: ["text"], source: "portal – notes for the office" },
];
/** A2 only (decision 28): the installer confirms no pricing was discussed. Recorded on the Ready Check record. */
const A2_NO_PRICING_TICK: FormField = { label: LEAN_Q.noPricingTick, type: "tick", required: true, aliases: ["I confirm I have not discussed or agreed pricing with the homeowner during this Ready Check. All quotes and pricing discussions will be handled directly by Home Insulation Victoria"], source: "portal – decision 28 (our leads are priced by Home Insulation Victoria)" };
const SIGNATURE_A1: FormField = { label: LEAN_Q.signatureA1, type: "signature", required: true, aliases: [...al("signatureA1"), "I confirm this information is accurate"], source: `${G} – installer confirmation` };
const SIGNATURE_A2: FormField = { label: LEAN_Q.signatureA2, type: "signature", required: true, aliases: [...al("signatureA2"), "I confirm this information is accurate"], source: `${G} – installer confirmation` };

export const FORMS: Record<FormKey, { title: string; role: "installer" | "electrician"; fields: FormField[] }> = {
  // Form A2 — we bring the customer: evidence only, no pricing (owner is quoted at our set price) + the no-pricing tick.
  ready_check: {
    title: READY_CHECK_TITLE,
    role: "installer",
    fields: [...READY_CHECK_FIELDS, A2_NO_PRICING_TICK, SIGNATURE_A2],
  },
  // Form A1 — installer brings the customer: the same evidence questions, no pricing tick and NO quote page (decision 278:
  // the business owner enters the price in the portal; staff doing the Ready Check never see or set it).
  ready_check_priced: {
    title: `${READY_CHECK_TITLE} – installer-supplied customer`,
    role: "installer",
    fields: [...READY_CHECK_FIELDS, SIGNATURE_A1],
  },
  // Short onsite forms (approved 3 Oct 2026): clear full-sentence questions. The portal expands the answers
  // into every official Word-form item (official-expand.core.ts) and fills the official document itself.
  piesa: { title: "VEU pre-installation electrical safety assessment form", role: "electrician", fields: [...SHORT_PIESA_FIELDS, ...PIESA_SUPPLEMENTAL] },
  piisa: { title: "VEU pre-installation installer safety assessment form", role: "installer", fields: [...SHORT_PIISA_FIELDS.slice(0, -3), ...PIISA_DECLARATION_FIELDS, ...SHORT_PIISA_FIELDS.slice(-3), ...PIISA_SUPPLEMENTAL] },
};

/** Distinct questions an installer can be asked on a lean Ready Check (per-area group counted once; legacy-only items excluded). */
export function leanQuestionCount(key: "ready_check" | "ready_check_priced"): number {
  return FORMS[key].fields.filter((f) => !f.portalOnly).length;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const TYPE_ALIASES: Record<FieldType, string[]> = {
  text: ["text", "textsingle", "textmulti", "address"], phone: ["phone", "phone_number", "phonenumber", "textsingle", "text"], number: ["number", "slider", "textsingle", "text"], choice: ["list", "question", "choice"],
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
  // Deduplicated: a curly/straight apostrophe alias normalises to the same key and must not count the item twice.
  const labelsOf = (f: FormField) => [...new Set([norm(f.label), ...(f.aliases ?? []).map(norm)])];
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
  text: "Text answer", phone: "Phone number answer", number: "Number answer", choice: "Multiple choice (single answer)", multichoice: "Multiple choice (choose ALL that apply)", yesno: "Question (response set)",
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
    perArea.length ? `- Build ONE repeating section the installer adds with a button labelled "${AREA_GROUP_BUTTON}" (decision 222). Do NOT ask how many areas there are and do NOT paste copies of the section into logic branches. These fields go inside the repeating section: ${perArea.map((x) => `"${x.label}"`).join(", ")}. All other fields are NOT repeated.` : "",
    perPriceLine.length ? `- Put these fields in a repeatable section called "Quoted price line": ${perPriceLine.map((x) => `"${x.label}"`).join(", ")}.` : "",
    key === "ready_check_priced" ? `- Do NOT add a price, quote or electrician section (no "${LEAN_Q.included}", "${LEAN_Q.totalPrice}" or "${LEAN_Q.electrician}" questions): the business owner enters the price in the portal, not on the form (decision 278).` : "",
    key === "ready_check" || key === "ready_check_priced" ? `- Do NOT add a diagram, sketch or floor plan question: the portal draws the upgrade area diagram from each area's "${LEAN_Q.areaName}", "${LEAN_Q.lengthM}" and "${LEAN_Q.widthM}" answers (decisions 211/222).` : "",
    key === "ready_check" || key === "ready_check_priced" ? `- Do NOT add an extras section, an "Assessor" question, an "are these details correct" pair, a depth (mm) question, any "describe"/"explain" text box or a "how many areas" question (decision 222 lean form).` : "",
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

// Short onsite PIESA / PIISA (approved plan, 3 Oct 2026): clear full-sentence questions for Mitti.
// The electrician/installer answers these onsite; the portal expands them into every official
// March 2026 Word-form answer (official-expand.core.ts) and fills the official document
// (official-docx.core.ts). PURE: no I/O. Questions are full plain sentences — never shorthand.
import type { FormField } from "./mitti-forms.core";
import { B2_OPTIONS } from "./official-forms.core";

const yn = (id: string, label: string, when?: string): FormField => ({ id, label, type: "yesno", required: true, choices: ["Yes", "No"], ...(when ? { when } : {}), source: "short onsite form" });
const pre = (id: string, label: string, type: FormField["type"] = "text", when?: string): FormField => ({ id, label, type, required: true, prefill: true, ...(when ? { when } : {}), source: "portal prefill — signer confirms" });

// ---------- PIESA problem tick-lists (each a full sentence; mapped to official items in official-expand.core.ts) ----------
export const MAINS_PROBLEMS = [
  "The mains cable in the ceiling has not been identified and marked.",
  "The main switch is not accessible or does not work.",
  "The main switch cannot isolate all of the cables in the ceiling space safely.",
  "The main switch cannot be secured in the off position.",
  "Testing has not confirmed that the ceiling is dead when the main switch is off.",
  "Safety switches (RCDs) are missing for the circuits in the ceiling area.",
  "The safety switches (RCDs) have not been tested.",
] as const;
export const SOLAR_PROBLEMS = [
  "There are no instructions for safely shutting down and restarting the system.",
  "The isolator is not accessible, not working, or cannot be switched off safely.",
  "The system cables in the ceiling are not in conduit or are not clearly labelled.",
  "The system cables in the ceiling are not protected or supported where they could be damaged.",
] as const;
export const CEILING_PROBLEMS = [
  "There is electrically conductive conduit in the ceiling.",
  "The cables are not supported, or are run in a way that risks damage during the installation.",
  "Cables that will be surrounded by insulation do not meet the wiring rules for that situation.",
  "Thermoplastic (TPS) cables in the ceiling are deteriorated or damaged.",
  "Connections or terminations in the ceiling are exposed or not securely enclosed.",
  "Plug bases for lights or fans are loose in the ceiling.",
  "Foil-backed or electrically conductive insulation is present and has not been confirmed as not live.",
  "There are mains-connected cables in the ceiling that are not TPS.",
  "There is split metal conduit wiring in the ceiling.",
  "There are damaged or deteriorated cables in the ceiling.",
] as const;
export const RECTIFICATION_OUTCOMES = [
  "No repair work is needed",
  "Yes, repair work is needed",
  "Repair work is not possible, so an electrician must be present on installation day",
] as const;

const LIFE_SUPPORT_RECORD = "Office life support record";
const LIFE_SUPPORT_CONFIRM = "Is the life support record shown above still correct?";
const LIFE_SUPPORT_WHEN = "Life support confirmed Yes";
/** Decision 294 (Jo 25 Oct 2026): the PIESA asks the fact directly; consent only when life support is present. */
export const LIFE_SUPPORT_PRESENT = "Is there life support equipment at the property?";
export const LIFE_SUPPORT_NOT_RECEIVED = "No – not received";
const LIFE_SUPPORT_PRESENT_WHEN = "Life support = Yes";
const LIFE_SUPPORT_CONSENT_WHEN = "Consent or medical plan received";

/** Short PIESA (electrician). Life support is confirmed against the enquiry record, never re-asked from scratch. */
/** Exact Mitti wording of the official Part 7 question (decision 210; docs/MITTI_PIESA_CHATGPT_PROMPT.md addendum). */
export const PIESA_EFFECTIVE_QUESTION = "Does the action you described effectively reduce the risk from each hazard listed?";
export const SHORT_PIESA_FIELDS: FormField[] = [
  pre("jobRef", "Job Reference ID"),
  pre("address", "Address including postcode"),
  { id: "inspectionDate", label: "Date of inspection", type: "date", required: true, source: "short onsite form" },
  pre("lifeSupportRecord", LIFE_SUPPORT_RECORD),
  yn("lifeSupportPresent", LIFE_SUPPORT_PRESENT),
  { id: "lifeSupportConsent", label: "Have you received written consent or a medical plan? Please attach a photo of it.", type: "choice", required: true, choices: ["Yes – received Consent", "Yes – received Medical Plan", LIFE_SUPPORT_NOT_RECEIVED], when: LIFE_SUPPORT_PRESENT_WHEN, source: "short onsite form" },
  { id: "lifeSupportAttachment", label: "Written consent or medical plan (kept as an attachment to this assessment)", type: "media", required: true, when: LIFE_SUPPORT_CONSENT_WHEN, source: "short onsite form" },
  yn("mainsSafe", "Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and safety switches (RCDs) are fitted and tested."),
  { id: "mainsProblems", label: "Please tick each item that is not right.", type: "multichoice", required: true, choices: [...MAINS_PROBLEMS], when: "mainsSafe = No", source: "short onsite form" },
  yn("solarPresent", "Is there solar, a battery or a generator at the property?"),
  yn("solarSafe", "Can it be safely shut down, and are its cables in the ceiling labelled, in conduit and protected?", "solarPresent = Yes"),
  { id: "solarProblems", label: "Please tick each item that is not right.", type: "multichoice", required: true, choices: [...SOLAR_PROBLEMS], when: "solarSafe = No", source: "short onsite form" },
  yn("ceilingSafe", "Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation?"),
  { id: "ceilingProblems", label: "Please tick each problem you found.", type: "multichoice", required: true, choices: [...CEILING_PROBLEMS], when: "ceilingSafe = No", source: "short onsite form" },
  yn("downlightsPresent", "Are there any downlights or other recessed lights in the ceiling?"),
  { id: "downlightCount", label: "How many are there?", type: "number", required: true, when: "downlightsPresent = Yes", source: "short onsite form" },
  yn("downlightsNonIc", "Are any of them not IC or IC-4 rated?", "downlightsPresent = Yes"),
  // Jo 25 Oct 2026: the fixes quote needs the number of fittings to replace, not just that some are not IC rated.
  { id: "downlightsNonIcCount", label: "How many are not IC or IC-4 rated?", type: "number", required: true, when: "downlightsNonIc = Yes", source: "short onsite form" },
  yn("appliancesPresent", "Are there any appliances, exhaust fans or flues in the ceiling space?"),
  { id: "applianceDetails", label: "Please describe each one, where it is, the hazard it creates, and what was done or needs to be done about it.", type: "text", required: true, when: "appliancesPresent = Yes", source: "short onsite form" },
  // Decision 210 (audit P-1): the official Part 7 "effective" question, asked on site so the printed P7 rule can pass.
  yn("appliancesEffective", PIESA_EFFECTIVE_QUESTION, "appliancesPresent = Yes"),
  { id: "rectificationOutcome", label: "Is any electrical repair work needed before insulation can be installed?", type: "choice", required: true, choices: [...RECTIFICATION_OUTCOMES], source: "short onsite form" },
  { id: "rectificationWork", label: "Please tick the repair work that is required.", type: "multichoice", required: true, choices: [...B2_OPTIONS], when: "rectificationOutcome = Yes, repair work is needed", source: "short onsite form" },
  { id: "rectificationOther", label: "Please describe the other repair work.", type: "text", required: true, when: "Other is ticked", source: "short onsite form" },
  pre("b3.licence", "Licence no:"),
  pre("b3.name", "Full Name:"),
  pre("b3.recName", "Name:"),
  pre("b3.recNo", "REC registration no:"),
  pre("b3.phone", "Telephone no:"),
  { id: "b3.declaration", label: "I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission", type: "tick", required: true, source: "DEECA PIESA form B3" },
  { id: "electricianSignature", label: "Electrician signature", type: "signature", required: true, source: "short onsite form" },
  yn("rectificationComplete", "Have you completed all of the repair work listed above, and is the ceiling now safe for insulation?", "rectificationOutcome = Yes, repair work is needed"),
  { id: "coesNumber", label: "Certificate of Electrical Safety number (required for any electrical works completed):", type: "text", required: true, when: "rectificationOutcome = Yes, repair work is needed", source: "DEECA PIESA form C" },
  { id: "certDate", label: "Date of Certification:", type: "date", required: true, when: "rectificationOutcome = Yes, repair work is needed", source: "DEECA PIESA form C" },
  pre("c.licence", "Licence no:", "text", "rectificationOutcome = Yes, repair work is needed"),
  pre("c.name", "Full Name:", "text", "rectificationOutcome = Yes, repair work is needed"),
  pre("c.recName", "Name:", "text", "rectificationOutcome = Yes, repair work is needed"),
  pre("c.recNo", "REC registration no:", "text", "rectificationOutcome = Yes, repair work is needed"),
  pre("c.phone", "Telephone no:", "text", "rectificationOutcome = Yes, repair work is needed"),
  yn("ownerConfirm", "Please confirm that the assessment was completed today, and that you understand that anyone going into the ceiling before installation may cancel this assessment."),
  pre("o.name", "Name:"),
  { id: "o.date", label: "Date:", type: "date", required: true, source: "short onsite form" },
  { id: "ownerSignature", label: "Owner signature", type: "signature", required: true, source: "short onsite form" },
];

/** Short PIISA (installer, installation day). PIESA answers are carried over from the signed PIESA, never re-asked. */
export const SHORT_PIISA_FIELDS: FormField[] = [
  pre("jobRef", "Job Reference ID"),
  pre("address", "Address including postcode"),
  pre("startDate", "Installation start date:", "date"),
  pre("completionDate", "Predicted installation completion date:", "date"),
  yn("powerInformed", "Has the household been told the power will be off during the installation?"),
  pre("lifeSupportRecord", LIFE_SUPPORT_RECORD),
  yn("lifeSupportConfirm", LIFE_SUPPORT_CONFIRM),
  { id: "lifeSupportConsent", label: "Have you received written consent or a medical plan? Please attach a photo of it.", type: "choice", required: true, choices: ["Yes – received Consent", "Yes – received Medical Plan"], when: LIFE_SUPPORT_WHEN, source: "short onsite form" },
  { id: "lifeSupportAttachment", label: "Written consent or medical plan (kept as an attachment to this assessment)", type: "media", required: true, when: LIFE_SUPPORT_WHEN, source: "short onsite form" },
  pre("p2.installDate", "Installation date:", "date"),
  pre("p2.ap", "Accredited person name:"),
  pre("p2.company", "Installer company name:"),
  pre("p2.lead", "Lead installer name:"),
  pre("p2.leadEec", "EEC certification number:"),
  ...[1, 2, 3].flatMap((n): FormField[] => [
    { id: `crewName${n}`, label: `Additional installer ${n} – full name`, type: "text", required: false, source: "short onsite form" },
    { id: `crewEec${n}`, label: `Additional installer ${n} – EEC certification number`, type: "text", required: false, when: `Additional installer ${n} named`, source: "short onsite form" },
  ]),
  yn("swmsComplete", "Has the Safe Work Method Statement been completed, have the common hazards been considered, and has the power been isolated, locked out and tagged?"),
  yn("piesaReviewed", "Have you read the Pre Insulation Electrical Safety Assessment (PIESA), and has nobody worked in the ceiling since it was done?"),
  yn("electricianHere", "The Pre Insulation Electrical Safety Assessment (PIESA) requires an electrician here at the start today. Is the electrician here?", "PIESA requires an electrician at the start"),
  yn("existingInsulation", "Is there existing insulation in the ceiling?"),
  { id: "insulationTreatment", label: "Will it be removed or topped up?", type: "choice", required: true, choices: ["Removed", "Topped Up"], when: "existingInsulation = Yes", source: "short onsite form" },
  { id: "insulationHeight", label: "What is its average height in millimetres?", type: "number", required: true, when: "existingInsulation = Yes", source: "short onsite form" },
  { id: "insulationRValue", label: "What is its R-value, if you know it?", type: "number", required: false, when: "existingInsulation = Yes", source: "short onsite form" },
  { id: "insulationReason", label: "Why is the existing insulation not being removed?", type: "text", required: true, when: "Topped Up", source: "short onsite form" },
  pre("p7.products", "List the insulation product(s) brand, model and R-value being installed"),
  { id: "p8.declaration", label: "All information contained in and attached to this form is correct and not misleading by inclusion or omission", type: "tick", required: true, source: "DEECA PIISA form Part 8" },
  { id: "installerSignature", label: "Installer signature", type: "signature", required: true, source: "short onsite form" },
  pre("p8.name", "Installer full name:"),
  { id: "p8.date", label: "Date:", type: "date", required: true, source: "short onsite form" },
];

export const SHORT_FIELDS: Record<"piesa" | "piisa", FormField[]> = { piesa: SHORT_PIESA_FIELDS, piisa: SHORT_PIISA_FIELDS };

/** Maps Mitti entries (by label) onto short-form ids. Duplicate labels are assigned in form order. */
export function shortAnswersFromEntries(key: "piesa" | "piisa", entries: { label: string; value: string | null }[]): Record<string, string> {
  const nrm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const fields = SHORT_FIELDS[key];
  const used = new Map<string, number>();
  const out: Record<string, string> = {};
  for (const e of entries) {
    const k = nrm(e.label ?? "");
    if (!k) continue;
    const cands = fields.filter((f) => nrm(f.label) === k);
    if (!cands.length) continue;
    const seen = used.get(k) ?? 0;
    used.set(k, seen + 1);
    const slot = cands[seen];
    if (slot && e.value != null && e.value !== "") out[slot.id!] = e.value;
  }
  return out;
}

// Maps completed form answers (keyed by the exact FORMS labels in mitti-forms.core.ts) onto the
// official DEECA AcroForm fields. Pure: no I/O. Field names were read from the official PDFs
// (30 Sep 2026); radio Choice1 = left column (Yes), Choice2 = No, Choice3 = N/A.
// Nothing is invented: a field with no answer is left blank and reported as missing.
import { B2_ITEMS, FORMS, PIESA_OUTCOMES, type FormKey } from "./mitti-forms.core";

export type OfficialFormKey = Exclude<FormKey, "ready_check">;
export type Answers = Record<string, string | number | boolean | string[] | null | undefined>;
type M =
  | { kind: "text"; pdf: string; label: string }
  | { kind: "yn"; pdf: string; label: string; na?: boolean }
  | { kind: "choice"; pdf: string; label: string; options: string[] }
  | { kind: "tick"; pdf: string; label: string; match?: string };

const L = (k: OfficialFormKey) => FORMS[k].fields.map((f) => f.label);
const P = L("piesa"), I = L("piisa");
const at = (arr: string[], s: string) => { const x = arr.find((l) => l.startsWith(s)); if (!x) throw new Error(`official-pdf: no label ${s}`); return x; };
const ynSeq = (labels: string[], names: string[]): M[] => labels.map((label, i) => ({ kind: "yn", pdf: names[i]!, label }));

const piesaYn = P.filter((l, i) => FORMS.piesa.fields[i]!.type === "yesno" && FORMS.piesa.fields[i]!.source.match(/Part [2-7]/));
// Official radio order on pages 1–4 (Part 2 → Part 7 action effectiveness).
const PIESA_RADIOS = ["4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30"].map((n) => `Radio Button ${n}`);
const SECTION_C_BOXES = ["Check Box 18", "Check Box 19", "Check Box 33", "Check Box 32", "Check Box 31", "Check Box 20", "Check Box 21"];
const B2_BOXES = ["Check Box 6", "Check Box 7", "Check Box 8", "Check Box 9", "Check Box 30", "Check Box 10"];
const OWNER_BOXES = ["Check Box 26", "Check Box 27", "Check Box 28", "Check Box 29"];
const sectionC = P.filter((l) => l.startsWith("I confirm all identified") || (l.startsWith("I confirm that") && !l.includes("above date")) || l.startsWith("I declare"));
const owner = P.filter((l) => l.startsWith("I acknowledge") || l.includes("above date") || l.startsWith("I understand"));

export const PDF_MAP: Record<OfficialFormKey, M[]> = {
  piesa: [
    { kind: "text", pdf: "Job reference ID", label: "Job Reference ID" },
    { kind: "text", pdf: "Address", label: "Address including postcode" },
    { kind: "text", pdf: "Date of inspection", label: "Date of inspection" },
    { kind: "yn", pdf: "Life support", label: "Is anyone at this property dependent on life support?" },
    { kind: "tick", pdf: "Radio Button 2", label: at(P, "If yes, has written consent"), match: "Consent" },
    { kind: "tick", pdf: "Radio Button 3", label: at(P, "If yes, has written consent"), match: "Medical Plan" },
    ...piesaYn.map((label, i): M => ({ kind: "yn", pdf: PIESA_RADIOS[i]!, label, na: label.startsWith("Have thermoplastic") })),
    { kind: "text", pdf: "Number of luminaries", label: "Total number of luminaires" },
    { kind: "text", pdf: "Appliance 1", label: "Appliance, location and hazard" },
    { kind: "text", pdf: "Actions undertaken to minimise risk", label: at(P, "Actions undertaken") },
    { kind: "text", pdf: "Actions undertaken to minimise risk 2", label: "Other electrical or other hazards identified and action taken" },
    { kind: "choice", pdf: "Radio Button 31", label: "B1 Assessment outcome", options: PIESA_OUTCOMES },
    ...B2_ITEMS.map((item, i): M => ({ kind: "tick", pdf: B2_BOXES[i]!, label: "B2 Required rectifications", match: item })),
    { kind: "tick", pdf: "Check Box 12", label: "B3 Electrician declaration – initial assessment" },
    ...([["LE - IA - Licence no", "Licence no (initial assessment)"], ["LE - IA- Full name", "Full Name (initial assessment)"], ["REC - IA - Name", "REC Name (initial assessment)"], ["REC - IA - Reg no", "REC registration no (initial assessment)"], ["REC - IA - Phone", "Telephone no (initial assessment)"],
      ["LE - R - Licence no", "Licence no (rectification)"], ["LE - R - Full name", "Full Name (rectification)"], ["REC - R - Name 2", "REC Name (rectification)"], ["REC - R - Reg no 2", "REC registration no (rectification)"], ["REC - R - Phone 2", "Telephone no (rectification)"],
      ["Date of completion", "Date of completion"], ["Certificate of Electrical Safety number", "Certificate of Electrical Safety number"], ["Date of certification", "Date of Certification"]] as const)
      .map(([pdf, label]): M => ({ kind: "text", pdf, label })),
    ...sectionC.map((label, i): M => ({ kind: "tick", pdf: SECTION_C_BOXES[i]!, label })),
    ...owner.map((label, i): M => ({ kind: "tick", pdf: OWNER_BOXES[i]!, label })),
    { kind: "text", pdf: "Property owner name", label: "Property owner name" },
  ],
  piisa: [
    { kind: "text", pdf: "Job reference ID", label: "Job Reference ID" },
    { kind: "text", pdf: "Address", label: "Address including postcode" },
    { kind: "text", pdf: "Installation start date", label: "Installation start date" },
    { kind: "text", pdf: "Predicted intall date", label: "Predicted installation completion date" },
    { kind: "yn", pdf: "Radio Button 32", label: at(I, "Has the household/tenant") },
    { kind: "yn", pdf: "Life support", label: "Is anyone at this property dependent on life support?" },
    { kind: "tick", pdf: "Radio Button 2", label: at(I, "If yes, has written consent"), match: "Consent" },
    { kind: "tick", pdf: "Radio Button 3", label: at(I, "If yes, has written consent"), match: "Medical Plan" },
    ...([["Installation date", "Installation date"], ["Name of accredited person", "Accredited person name"], ["Installaer company name", "Installer company name"], ["Lead installer name", "Lead installer name"], ["EEC number", "Lead installer EEC certification number"], ["Add. installer 1", "Additional installer name and EEC certification number"]] as const)
      .map(([pdf, label]): M => ({ kind: "text", pdf, label })),
    ...ynSeq([at(I, "Has a Safe Work"), at(I, "Have all hazards listed"), at(I, "Has the main and/or alternate"), I.filter((l) => l.startsWith("Is there a Solar"))[0]!, I.filter((l) => l.startsWith("Are instructions"))[0]!, I.filter((l) => l.startsWith("Is the ground level"))[0]!, at(I, "Has the Pre-installation")],
      ["Radio Button 33", "Radio Button 34", "Radio Button 18", "Radio Button 11", "Radio Button 12", "Radio Button 13", "Radio Button 16"]),
    { kind: "yn", pdf: "Radio Button 19", label: at(I, "If the Pre-installation electrical safety assessment recommends"), na: true },
    ...ynSeq([I.filter((l) => l.startsWith("Are there recessed"))[0]!, at(I, "Did the pre-installation electrical safety assessment confirm that all luminaires"), at(I, "Are all recessed luminaires"), at(I, "Did the pre-installation electrical safety assessment confirm that all mains connected cables in the ceiling space are appropriately"), at(I, "Did the pre-installation electrical safety assessment confirm that all mains connected cables in the ceiling space are thermoplastic"), at(I, "Did the pre-installation electrical safety assessment confirm that all mains connected cables in the ceiling space meet"), at(I, "Has the owner/occupier"), at(I, "Is there insulation present")],
      ["Radio Button 26", "Radio Button 21", "Radio Button 22", "Radio Button 35", "Radio Button 36", "Radio Button 37", "Radio Button 38", "Radio Button 39"]),
    { kind: "text", pdf: "Number of luminaries", label: "Total number of luminaires" },
    { kind: "text", pdf: "Av. height in mm", label: at(I, "What is the average height") },
    { kind: "text", pdf: "Av. RV", label: at(I, "What is the R-Value") },
    { kind: "tick", pdf: "Check Box 44", label: at(I, "Will the existing ceiling insulation"), match: "Removed" },
    { kind: "tick", pdf: "Check Box 45", label: at(I, "Will the existing ceiling insulation"), match: "Topped Up" },
    { kind: "yn", pdf: "Radio Button 41", label: at(I, "Is the existing insulation in a suitable") },
    { kind: "text", pdf: "Reason for insulation removal", label: at(I, "If the existing insulation is not removed") },
    { kind: "text", pdf: "List insulation products", label: at(I, "Insulation product(s)") },
    { kind: "tick", pdf: "Check Box 43", label: "Part 8 Installer declaration" },
    { kind: "text", pdf: "Installer full name", label: "Installer full name" },
    { kind: "text", pdf: "Date", label: "Date" },
  ],
};

export type FillPlan = { text: Record<string, string>; radio: Record<string, string>; check: string[]; missing: string[] };
const str = (v: Answers[string]) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)).trim();
const has = (v: Answers[string], m: string) => (Array.isArray(v) ? v : [str(v)]).some((x) => String(x).toLowerCase().includes(m.toLowerCase()));

/** Builds the exact field values for the official PDF. Unrecognised answers are left blank, never guessed. */
export function planOfficialFill(key: OfficialFormKey, answers: Answers): FillPlan {
  const plan: FillPlan = { text: {}, radio: {}, check: [], missing: [] };
  for (const m of PDF_MAP[key]) {
    const v = answers[m.label]; const s = str(v);
    if (m.kind === "text") { if (s) plan.text[m.pdf] = s; continue; }
    if (m.kind === "tick") { if (m.match ? has(v, m.match) : /^(yes|true)$/i.test(s)) (m.pdf.startsWith("Radio") ? (plan.radio[m.pdf] = "Choice1") : plan.check.push(m.pdf)); continue; }
    if (m.kind === "yn") {
      const c = /^yes$/i.test(s) ? "Choice1" : /^no$/i.test(s) ? "Choice2" : m.na && /^n\/?a$/i.test(s) ? "Choice3" : null;
      if (c) plan.radio[m.pdf] = c; else if (!s) plan.missing.push(m.label); else plan.missing.push(`${m.label} (unrecognised answer)`);
      continue;
    }
    const i = m.options.findIndex((o) => o.toLowerCase() === s.toLowerCase());
    if (i >= 0) plan.radio[m.pdf] = `Choice${i + 1}`; else plan.missing.push(m.label);
  }
  return plan;
}

/** Official PDFs are stored privately; these are the decrypted-for-filling copies (form filling is permitted by the PDF). */
export const TEMPLATE_PATH: Record<OfficialFormKey, string> = { piesa: "_templates/deeca-piesa.pdf", piisa: "_templates/deeca-piisa.pdf" };

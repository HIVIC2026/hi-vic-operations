// Realistic, fully answered DEECA PIESA / PIISA answers (TEST names and numbers only) for the official-form PDF tests and
// samples (`bun scripts/render-pdf-samples.ts piesa piisa`). Every item the form can print is answered: yes/no items get a
// mix of Yes/No, and the PIESA takes the "rectification required" path so Section B2 + Section C print. Pure.
import { B1_OPTIONS, B2_OPTIONS, OFFICIAL_ITEMS, type OfficialAnswers, type OfficialKey } from "../src/lib/official-forms.core";

const NO: Record<OfficialKey, string[]> = {
  piesa: ["lifeSupport", "p3.present", "p5.nonTps", "p5.splitConduit", "p5.damaged", "p6.prohibited", "p7.flues"],
  piisa: ["lifeSupport", "p4.present"],
};

const PIESA_TEXT: OfficialAnswers = {
  jobRef: "HV-1234",
  address: "12 Example Street, Box Hill VIC 3128",
  inspectionDate: "2026-11-07",
  "p6.count": 6,
  "p7.appliance#0": "Ducted heating unit", "p7.location#0": "Centre of the roof, above the hallway", "p7.hazard#0": "Hot flue within 150 mm of the work area",
  "p7.appliance#1": "Bathroom exhaust fan", "p7.location#1": "Above the main bathroom", "p7.hazard#1": "Must stay clear of insulation (do-not-cover)",
  "p7.actions": "Installer to keep a 50 mm clearance around the heater flue and the exhaust fan, fit guards where needed and leave the fan housing uncovered.",
  "p7.otherHazard#0": "Rotten joist near the manhole", "p7.otherAction#0": "Do not stand on it; use crawl boards in that bay until the joist is replaced.",
  b1: B1_OPTIONS[1],
  b2: [B2_OPTIONS[0], B2_OPTIONS[2], B2_OPTIONS[5]],
  "b2.other": "Junction box above the kitchen to be enclosed and fixed to a joist.",
  "b3.licence": "A12345", "b3.name": "Sam Sparks", "b3.recName": "Sparks Electrical Pty Ltd", "b3.recNo": "REC 23456", "b3.phone": "0400 000 000",
  "c.licence": "A12345", "c.name": "Sam Sparks", "c.recName": "Sparks Electrical Pty Ltd", "c.recNo": "REC 23456", "c.phone": "0400 000 000",
  "c.signature": "Sam Sparks (signed electronically on 12/11/2026)",
  "c.completionDate": "2026-11-12", "c.coes": "CoES 1234567", "c.certDate": "2026-11-12",
  "o.signature": "Sarah Brown (signed electronically on 13/11/2026)", "o.name": "Sarah Brown", "o.date": "2026-11-13",
};
const PIISA_TEXT: OfficialAnswers = {
  jobRef: "HV-1234",
  address: "12 Example Street, Box Hill VIC 3128",
  startDate: "2026-11-20", completionDate: "2026-11-20",
  "p2.installDate": "2026-11-20", "p2.ap": "DC Construction Solutions Pty Ltd", "p2.company": "Rapid Insulation",
  "p2.lead": "Will Casdorff", "p2.leadEec": "EEC-10001",
  "p2.addName#0": "Jo Tester", "p2.addEec#0": "EEC-10002",
  "p5.count": 6,
  "p6.height": 50, "p6.rValue": 1.5, "p6.treatment": ["Topped Up"],
  "p6.reason": "Existing batts are in good condition and dry, so they are kept and topped up.",
  "p7.products": "Bradford Gold Hi-Performance ceiling batts R5.0 (430 mm wide)",
  "p8.signature": "Will Casdorff (signed electronically on 20/11/2026)", "p8.name": "Will Casdorff", "p8.date": "2026-11-20",
};

/** Every printable item answered for `key`. */
export function fullAnswers(key: OfficialKey): OfficialAnswers {
  const a: OfficialAnswers = {};
  for (const i of OFFICIAL_ITEMS[key]) {
    if (i.kind === "yesno") a[i.id] = NO[key].includes(i.id) ? "No" : "Yes";
    else if (i.kind === "yesno_na") a[i.id] = "Yes";
    else if (i.kind === "tick") a[i.id] = true;
  }
  return { ...a, ...(key === "piesa" ? PIESA_TEXT : PIISA_TEXT) };
}

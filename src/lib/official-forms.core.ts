// Official DEECA PIESA / PIISA (March 2026 Word forms) — the locked item-by-item mapping, template records,
// printed-rule enforcement and signed-snapshot hashing. PURE: no I/O.
// Every label/statement below is copied verbatim from the uploaded Word forms and is checked against the
// stored originals (docs/official-forms/) by tests/official-forms.test.ts. Nothing here approves a mapping.
import { sha256Hex } from "./sha256.core";

export type OfficialKey = "piesa" | "piisa";
export type ItemKind = "heading" | "statement" | "text" | "date" | "number" | "yesno" | "yesno_na" | "choice" | "ticks" | "tick" | "signature" | "attachment";
export type OfficialItem = {
  id: string; kind: ItemKind; label: string; section: string;
  options?: string[]; required: boolean; when?: string;
  /** Repeating table row: the official table has `rows` rows of these columns. */
  row?: { group: string; rows: number };
  /** Letter printed by the form's list numbering (not part of the text). */
  letter?: string; unit?: string; prefill?: boolean;
  /** Derived from a printed instruction rather than a printed field (e.g. "keep this record as an attachment"). */
  derivedFrom?: string;
};

// ---------- template records (Part 4) ----------
export type TemplateRecord = {
  key: OfficialKey; title: string; issuingAuthority: string;
  sourceUrl: string | null; sourceUrlStatus: "NEEDS CONFIRMATION" | "confirmed";
  /** Official download date. UNKNOWN until confirmed — never the upload or asset timestamp. */ retrievalDate: string | null; retrievalDateStatus: "UNKNOWN" | "confirmed";
  /** Date the uploaded original was inspected here — NOT official provenance. */ dateInspected: string; publication: string;
  /** Printed in the document: no separate version number or effective date is printed. */ formVersion: "not printed"; effectiveDatePrinted: "not printed";
  sha256: string; originalFile: string; mappingVersion: string;
  approved: false | { by: string; at: string }; superseded: boolean; effectiveFrom: string | null;
};

export const OFFICIAL_TEMPLATES: Record<OfficialKey, TemplateRecord> = {
  piesa: {
    key: "piesa", title: "VEU pre-installation electrical safety assessment form", issuingAuthority: "Department of Energy, Environment and Climate Action (DEECA), State of Victoria",
    sourceUrl: "https://www.energy.vic.gov.au/__data/assets/word_doc/0039/788394/VEU-pre-installation-electrical-safety-assessment-form.docx", sourceUrlStatus: "confirmed", retrievalDate: "2026-10-02", retrievalDateStatus: "confirmed",
    dateInspected: "2026-10-02", publication: "© DEECA March 2026", formVersion: "not printed", effectiveDatePrinted: "not printed",
    sha256: "2a89d21c1f2c8fef916954d070449bd3175590d90b9a514d4a8d7625f3a299ac",
    originalFile: "docs/official-forms/VEU-pre-installation-electrical-safety-assessment-form_1.docx",
    // Jo 25 Oct 2026 (decision 350): "The PIESA sample forms approved" — mapping approved for live use.
    mappingVersion: "piesa-map-2.0.0", approved: { by: "Jo (Home Insulation Victoria)", at: "2026-10-25" }, superseded: false, effectiveFrom: "2026-10-25",
  },
  piisa: {
    key: "piisa", title: "VEU pre-installation installer safety assessment form", issuingAuthority: "Department of Energy, Environment and Climate Action (DEECA), State of Victoria",
    sourceUrl: "https://www.energy.vic.gov.au/__data/assets/word_doc/0042/788397/VEU-pre-installation-installer-safety-assessment-form-.docx", sourceUrlStatus: "confirmed", retrievalDate: "2026-10-02", retrievalDateStatus: "confirmed",
    dateInspected: "2026-10-02", publication: "© DEECA March 2026", formVersion: "not printed", effectiveDatePrinted: "not printed",
    sha256: "bea62330fa766d3da29137a494d01f9e3e80a883cb5126b2fffb6fa07ad46dea",
    originalFile: "docs/official-forms/VEU-pre-installation-installer-safety-assessment-form-_3.docx",
    // Jo 24 Oct 2026: "PIISA is ready" — mapping approved for live use (the A3 native Mitti form is connected).
    mappingVersion: "piisa-map-2.0.0", approved: { by: "Jo (Home Insulation Victoria)", at: "2026-10-24" }, superseded: false, effectiveFrom: "2026-10-24",
  },
};
/** Earlier mapping (old PDFs, 30 Sep 2026) — superseded and never usable. */
export const SUPERSEDED_MAPPINGS = [{ key: "piesa", mappingVersion: "piesa-pdf-map-1", superseded: true }, { key: "piisa", mappingVersion: "piisa-pdf-map-1", superseded: true }] as const;

/** Fails closed: an official form may be used live only when its mapping is approved, its source is confirmed and it isn't superseded. */
export function officialFormUseBlocker(key: OfficialKey, t: TemplateRecord = OFFICIAL_TEMPLATES[key]): string | null {
  if (t.superseded) return `The ${key.toUpperCase()} mapping ${t.mappingVersion} is superseded.`;
  if (t.sourceUrlStatus !== "confirmed" || !t.sourceUrl) return `The official ${key.toUpperCase()} source web address hasn't been confirmed, so this form can't be used yet.`;
  if (t.retrievalDateStatus !== "confirmed") return `The official ${key.toUpperCase()} download date hasn't been confirmed, so this form can't be used yet.`;
  if (!t.approved) return `The ${key.toUpperCase()} mapping ${t.mappingVersion} hasn't been approved, so this form can't be used yet.`;
  return null;
}

// ---------- shared official text ----------
const PRIVACY = [
  "Privacy Collection Statement",
  "The Department of Energy, Environment, and Climate Action (DEECA) is committed to protecting personal information provided by you in accordance with the privacy principles in the Privacy and Data Protection Act 2014 (Vic). The personal information in this assessment form may be collected by the Essential Services Commission (the commission) to administer, monitor and enforce compliance with the Victorian Energy Upgrades program.",
  "The commission deals with personal information in accordance with the Privacy and Data Protection Act 2014 (Vic) and other applicable legislation.",
  "The commission may use and disclose your information as authorised or required by law, including for verification, audit, and program monitoring. This may include disclosure to external service providers, other regulators, law enforcement agencies, courts and other government bodies where relevant to the commission’s functions.",
  "Providing the requested information is voluntary. However, if you do not provide it, Victorian energy efficiency certificates may not be able to be created for insulation installation work undertaken.",
  "You may request access to, or correction of, your information by contacting the commission at privacy@esc.vic.gov.au",
  "or referring to its Privacy Policy. For more information about how the commission handles personal information, refer to its Privacy Policy.",
  "You may lodge a privacy complaint with the Office of the Victorian Information Commissioner at ovic.vic.gov.au.",
];
const LS_Q = "Is anyone at this property dependent on life support?";
const LS_CONSENT = "If yes, has written consent or a medical plan been received prior to this assessment commencing? You will need to keep this record as an attachment to this assessment.";
const LS_OPTIONS = ["Yes – received Consent", "Yes – received Medical Plan"];
const LS_STOP = "If anyone at this property relies on life support and you don’t have a written consent or a medical plan, the installation CANNOT proceed.";
const LS_ATTACH = "Written consent or medical plan (kept as an attachment to this assessment)";
const IC_INTRO = "Under the VEU program, eligible premises must only have IC and/or IC-4 light fittings in the ceiling area to be upgraded*. Any other lights (e.g. CA-class luminaires, non-IC luminaires, or ‘do-not-cover’ light fittings) need to be replaced with the required IC and/or IC-4 fittings that can be safely covered by insulation before the property can qualify for VEU incentives under the ceiling insulation activity.";
const SOLAR_Q = "Is there a Solar PV, Battery system and/or alternative supply, such as a fuel driven generator present?";
const SOLAR_INSTR = "Are instructions provided on the safe shutdown/isolation, and re-energisation of the solar, battery or alternative supply system?";
const SOLAR_ISO = "Is the ground level system AC and/or DC (may be part of the inverter) isolator accessible, operational and can be isolated safely?";
const RECESSED = "Are there recessed luminaires present in the ceiling?";
const LUM_COUNT = "If ’Yes’, specify total number of luminaries:";

let n = 0;
const st = (section: string, label: string, kind: "heading" | "statement" = "statement"): OfficialItem => ({ id: `${kind}.${section}.${++n}`, kind, label, section, required: false });
const f = (id: string, section: string, kind: ItemKind, label: string, extra: Partial<OfficialItem> = {}): OfficialItem => ({ id, kind, label, section, required: true, ...extra });
const yn = (id: string, section: string, label: string, extra: Partial<OfficialItem> = {}) => f(id, section, "yesno", label, { options: ["Yes", "No"], ...extra });

export const B1_OPTIONS = [
  "Electrical rectification work is not required before insulation is installed or upgraded.",
  "Electrical rectification work is required before insulation is installed or upgraded.",
  "Electrical rectification work is not possible prior to insulation being installed or upgraded under parts 2 and 3",
] as const;
export const B2_OPTIONS = [
  "Prohibited luminaires (e.g. CA-class luminaires, non-IC luminaires, or ‘do-not-cover’ light fittings) are present and need to be replaced with IC and/or IC4 rated LED lights.",
  "Circuit protection rating needs to be upgraded to allow for effects of thermal insulation on the wiring system (derated)",
  "Residual Current Devices (RCDs) need to be installed for circuit/s within the ceiling insulation area, as per the most current version of AS/NZS 3000",
  "Cables in the ceiling or at the switchboard need to be replaced with ThermoPlastic Sheathed (TPS) cables, (or an equivalent cable) as per the most current version of AS/NZS 3000",
  "Cables and wiring in the ceiling space need to be altered or repaired to meet Basic Protection requirements, as per the most current version of AS/NZS 3000.",
  "Other (indicate below):",
] as const;
const SECTION_C_TICKS = [
  "I confirm all identified rectification works have been completed in accordance with the requirements detailed in the Observations, Conditions and Required Rectifications section of this pre-installation electrical safety check assessment.",
  "I confirm that all luminaires present in the ceiling area are IC and/or IC-4 rated (i.e. classified and marked).",
  "I confirm that all mains connected cables in the ceiling space are appropriately protected by an RCD where required, as per the most current version of AS/NZS 3000.",
  "I confirm that all mains connected cables in the ceiling space are thermoplastic insulated and sheathed (TPS) or an equivalent cable type as per the most current version of AS/NZS 3000.",
  "I confirm that all mains connected cables in the ceiling space meet Basic Protection Requirements, as per the most current version of AS/NZS 3000.",
  "I confirm that an electrical safety assessment has been completed and the ceiling space is either: free from electrical hazards; or the remaining electrical hazards and required controls have been documented and provided to the insulation installer to implement; so that the installation of insulation can proceed safely.",
  "I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission",
];
const OWNER_TICKS = [
  "I acknowledge that access to the ceiling space between now and the installation of insulation may void this assessment.",
  "I confirm that the electrical safety assessment works were completed on the above date.",
  "I confirm that any electrical rectification works were completed on the above date.",
  "I understand that information contained within this form will be provided to the person undertaking the installation work and may be provided upon request to Essential Services Commission (ESC) for the purposes of monitoring compliance with the Victorian Energy Efficiency Target Act 2007.",
];
const RECT = "B1 = rectification required";

export const PIESA_ITEMS: OfficialItem[] = [
  st("intro", "Completion of this form is mandatory prior to commencement of ceiling insulation installation work to comply with the requirements of the Victorian Energy Efficiency Target Regulations 2018."),
  st("intro", "This form can also be used for the installation requiring a pre-installation electrical safety assessment under the Residential Tenancies Amendment (Minimum Energy Efficiency Standards) Regulations 2025."),
  st("intro", "Sections A, B and C (as needed) of the report must be completed by a licensed electrician engaged by a registered electrical contractor. A copy of the completed form must be provided to the person installing the insulation product and the property owner/owner’s representative no less than 24 hours prior to the install commencing."),
  st("A", "Section A – Initial electrical safety assessment", "heading"),
  f("jobRef", "A", "text", "Job Reference ID", { prefill: true }),
  st("P1", "Part 1 – PROPERTY DETAILS", "heading"),
  f("address", "P1", "text", "Address including postcode", { prefill: true }),
  f("inspectionDate", "P1", "date", "Date of inspection"),
  yn("lifeSupport", "P1", LS_Q),
  f("lifeSupportConsent", "P1", "choice", LS_CONSENT, { options: LS_OPTIONS, when: "lifeSupport = Yes" }),
  f("lifeSupportAttachment", "P1", "attachment", LS_ATTACH, { when: "lifeSupport = Yes", derivedFrom: LS_CONSENT }),
  st("P1", LS_STOP),
  st("P2", "Part 2 – MAINS POWER (Please inform the occupant of the home if power is to be isolated during this assessment)", "heading"),
  yn("p2.mains", "P2", "Has the presence of any consumer mains cable in the ceiling space been identified and marked?"),
  yn("p2.switch", "P2", "Is the main switch for the premises:"),
  yn("p2.switchAccessible", "P2", "accessible and operational"),
  yn("p2.switchIsolates", "P2", "able to isolate all cables running through the ceiling space safely (excluding the mains cables)"),
  yn("p2.switchSecured", "P2", "able to be secured in the off position"),
  st("P2", "Note: If any of the above items are marked NO, the overall question will be marked as NO."),
  yn("p2.tested", "P2", "Has testing been carried out to ensure all cables and equipment within the ceiling area are de-energised when the main switch is isolated?"),
  yn("p2.rcdPresent", "P2", "Are Residual Current Devices (RCDs) (safety switches) present for circuit/s within the ceiling insulation area, as per the most current version of AS/NZS 3000?"),
  yn("p2.rcdTested", "P2", "Have all RCD’s been tested for operation?"),
  st("P2", "If you have answered NO to any of the questions in PART 2 – MAINS POWER, either"),
  st("P2", "rectification will be required prior to installation work commencing, OR"),
  st("P2", "where rectification is not possible, an electrician must be present at the start of the installation to isolate the mains, lock out and tag the switchboard and confirm the work area is electrically safe for anyone entering the roof cavity."),
  st("P3", "Part 3 – SOLAR POWER, BATTERY AND/OR ALTERNATIVE SUPPLY", "heading"),
  yn("p3.present", "P3", SOLAR_Q),
  st("P3", "If you have answered NO, go to PART 4 – ELECTRICAL HAZARD IDENTIFICATION"),
  yn("p3.instructions", "P3", SOLAR_INSTR, { when: "p3.present = Yes" }),
  yn("p3.isolator", "P3", SOLAR_ISO, { when: "p3.present = Yes" }),
  yn("p3.conduit", "P3", "Are all system cable(s) in the ceiling space in conduit and clearly labelled?", { when: "p3.present = Yes" }),
  yn("p3.protected", "P3", "Are the system cables within the ceiling space protected and/or supported in accessible areas to prevent damage?", { when: "p3.present = Yes" }),
  st("P3", "If you have answered NO to any of the questions (aside from the first question) in PART 3 – SOLAR POWER, BATTERY AND/OR ALTERNATIVE POWER SUPPLIES, either"),
  st("P3", "rectification will be required prior to installation work commencing, OR"),
  st("P3", "where rectification is not possible, an electrician must be present at the start of the installation to isolate the alternative power supply lock out, tag and confirm the work area is electrically safe for anyone entering the roof cavity."),
  st("P4", "Part 4 – ELECTRICAL HAZARD IDENTIFICATION", "heading"),
  yn("p4.conduit", "P4", "Is the premises clear of any electrically conductive conduit?"),
  yn("p4.supported", "P4", "Are the electrical cables present in the ceiling space supported or run in a way to reduce the risk of damage or strain during insulation installation work?"),
  yn("p4.treatment", "P4", "Do electrical cables that are or will be completely or partially surrounded by thermal insulation meet the treatment requirements of AS 3999:2015 section 2.6 or AS/NZS 3000:2018 clause 3.3.2.13?"),
  f("p4.tps", "P4", "yesno_na", "Have thermoplastic insulated and sheathed (TPS) cables present in the ceiling space been visually inspected and deemed safe? (i.e. free from deterioration or damage)", { options: ["Yes", "No", "N/A"] }),
  yn("p4.terminations", "P4", "Do all the electrical terminations and connections within the ceiling space meet basic protection requirements? (i.e. enclosed securely in junction boxes or enclosures, no exposed conductors or connectors, IP2X maintained including exposed wiring joints or terminations present)"),
  yn("p4.plugBases", "P4", "Are all plug bases within the ceiling space securely fixed. (i.e. lighting or fan plug bases not free to be moved around causing stress on cables and connections)."),
  yn("p4.foil", "P4", "If electrically conductive insulation (e.g. foil backed) is present in the ceiling space, it has been confirmed that it is not live?"),
  st("P4", "If you have answered NO to any of the questions in PART 4 - ELECTRICAL HAZARD IDENTIFICATION,"),
  st("P4", "rectification is required before ceiling insulation work can commence."),
  st("P5", "Part 5 – CABLE TYPES PRESENT IN CEILING SPACE", "heading"),
  yn("p5.nonTps", "P5", "Are there any mains connected cables which are not TPS in the ceiling?"),
  st("P5", "Note: All mains connected cables that are not TPS in the ceiling space must be replaced with TPS or an equivalent cable type that meets the most current version of AS/NZS 3000 - Wiring rules."),
  yn("p5.splitConduit", "P5", "Is there split metal conduit wiring present in the ceiling space?"),
  yn("p5.damaged", "P5", "Are there damaged or deteriorated cables present in the ceiling space?"),
  st("P5", "If you have answered YES to any of the questions in PART 5 – CABLE TYPES PRESENT IN CEILING SPACE,"),
  st("P5", "rectification is required before ceiling insulation work can commence."),
  st("P6", "Part 6 – PROHIBITED LUMINAIRES", "heading"),
  st("P6", IC_INTRO),
  st("P6", "* Note: Downlight replacement does not need to occur in ceilings of rooms that have another room or sole occupancy unit above the subject portion of the ceiling, provided insulation is not being installed there."),
  yn("p6.recessed", "P6", RECESSED),
  st("P6", "If you have answered NO, go to PART 7 – IDENTIFYING POTENTIAL HAZARDS IN CEILING SPACE"),
  f("p6.count", "P6", "number", LUM_COUNT, { when: "p6.recessed = Yes" }),
  yn("p6.prohibited", "P6", "Are there prohibited luminaires that are not IC and/or IC-4 rated (i.e. classified and marked) installed at the premises (see AS/NZS 3000: Wiring Rules – section 4)?", { when: "p6.recessed = Yes" }),
  st("P6", "If you have answered YES to this question, rectification is required before ceiling insulation work can commence."),
  st("P7", "Part 7 – IDENTIFYING POTENTIAL HAZARDS IN CEILING SPACE", "heading"),
  yn("p7.appliances", "P7", "Are there any electrical appliances present in the ceiling space (e.g. water heaters, air conditioning units, radiant heating panels, heat lamps or similar)?"),
  yn("p7.flues", "P7", "Are there any exhaust fans or heating flues that vent into or through the ceiling space?"),
  st("P7", "If you answered ‘Yes’ to any of the above questions, please describe the appliance, its location and associated hazards:"),
  f("p7.appliance", "P7", "text", "Appliance", { row: { group: "p7.applianceTable", rows: 10 }, when: "p7.appliances = Yes or p7.flues = Yes" }),
  f("p7.location", "P7", "text", "Location", { row: { group: "p7.applianceTable", rows: 10 }, when: "p7.appliances = Yes or p7.flues = Yes" }),
  f("p7.hazard", "P7", "text", "Hazard", { row: { group: "p7.applianceTable", rows: 10 }, when: "p7.appliances = Yes or p7.flues = Yes" }),
  f("p7.actions", "P7", "text", "If a hazard was identified, what actions were undertaken, or should be undertaken by the insulation installer, to eliminate or minimize any associated risks?", { when: "hazard identified" }),
  yn("p7.effective", "P7", "Does this action effectively reduce the risk associated with the identified hazard/s?", { when: "hazard identified" }),
  st("P7", "List any other electrical or other hazards identified in the ceiling space and actions taken to mitigate against the hazard/s:"),
  f("p7.otherHazard", "P7", "text", "Other electrical or other hazards identified in the ceiling space (e.g. rotten joist)", { required: false, row: { group: "p7.otherTable", rows: 14 } }),
  f("p7.otherAction", "P7", "text", "Action taken, or should be taken, to mitigate against hazard prior to insulation install (e.g. joist should be replaced).", { required: false, row: { group: "p7.otherTable", rows: 14 } }),
  st("B", "Section B – Required Rectification Work Identified in the Pre-Installation Electrical Safety Assessment", "heading"),
  st("B1", "B1 – ASSESSMENT OUTCOME", "heading"),
  f("b1", "B1", "choice", "Check ONE option only", { options: [...B1_OPTIONS] }),
  st("B1", "Selection of this option means that no electrical defects were identified during the assessment, and no electrical rectification work is required prior to ceiling insulation installation commencing."),
  st("B1", "Selection of this option requires that electrical defects are rectified prior to any ceiling insulation installation work. Record actions, conditions and required rectifications in B2. Section C of this document must be completed before ceiling insulation work may commence."),
  st("B1", "Selection of this option requires an electrician to be present at the start of the installation to isolate the main and/or alternative power supply, lock out and tag, and confirm that the work area is electrically safe for anyone entering the roof cavity."),
  st("B2", "B2 – Observations, Conditions and Required Rectifications", "heading"),
  f("b2", "B2", "ticks", "The following electrical work is required before insulation is installed or upgraded:", { options: [...B2_OPTIONS], when: RECT }),
  f("b2.other", "B2", "text", "Other (indicate below) – details", { when: "b2 includes Other", derivedFrom: "Other (indicate below):" }),
  st("B2", "NOTE: If a serious electrical hazard is identified in Victoria, electricians are obligated to notify Energy Safe Victoria (ESV). This is especially crucial for serious non-compliances related to electrical work. For less serious situations, the electrician should first inform the occupier, agent, or owner and attempt to make the situation safe if possible. If the hazard remains unaddressed, ESV should be contacted for further investigation."),
  st("B3", "B3 – ELECTRICIAN DECLARATION – INITIAL ASSESSMENT", "heading"),
  st("B3", "I, the below named licensed electrician, have carried out a pre-installation electrical safety assessment of this residential property per the requirements of the Victorian Energy Efficiency Target Regulations 2018 and/or the Residential Tenancies Amendment (Minimum Energy Efficiency Standards) Regulations 2025 and set out in the Australian/New Zealand Standard AS/NZS 3019, Electrical installations—Periodic assessment, and have recorded my observations, condition and required rectifications."),
  st("B3", "Licensed Electrician – Initial Assessment", "heading"),
  f("b3.licence", "B3", "text", "Licence no:"),
  f("b3.name", "B3", "text", "Full Name:"),
  st("B3", "Registered Electrical Contractor – Initial Assessment", "heading"),
  f("b3.recName", "B3", "text", "Name:"),
  f("b3.recNo", "B3", "text", "REC registration no:"),
  f("b3.phone", "B3", "text", "Telephone no:"),
  f("b3.declaration", "B3", "tick", "I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission"),
  st("C", "Section C – Completed Pre-Installation Electrical Safety Assessment", "heading"),
  st("C", "This section is to be completed after all required electrical work specified above in Section B (and in any attached reports) has been undertaken."),
  st("C", "Licensed Electrician – Rectification", "heading"),
  f("c.licence", "C", "text", "Licence no:", { when: RECT }),
  f("c.name", "C", "text", "Full Name:", { when: RECT }),
  st("C", "Registered Electrical Contractor – Rectification", "heading"),
  f("c.recName", "C", "text", "Name:", { when: RECT }),
  f("c.recNo", "C", "text", "REC registration no:", { when: RECT }),
  f("c.phone", "C", "text", "Telephone no:", { when: RECT }),
  ...SECTION_C_TICKS.map((label, i) => f(`c.tick${i + 1}`, "C", "tick", label, { when: RECT })),
  ...PRIVACY.map((t) => st("C", t)),
  f("c.signature", "C", "signature", "Signature", { when: RECT }),
  f("c.completionDate", "C", "date", "Date of completion:", { when: RECT }),
  f("c.coes", "C", "text", "Certificate of Electrical Safety number (required for any electrical works completed):", { when: RECT }),
  f("c.certDate", "C", "date", "Date of Certification:", { when: RECT }),
  st("O", "Property Owner / Owner’s Representative Declaration", "heading"),
  st("O", "I am the property owner or owner’s representative and:"),
  ...OWNER_TICKS.map((label, i) => f(`o.tick${i + 1}`, "O", "tick", label)),
  ...PRIVACY.map((t) => st("O", t)),
  f("o.signature", "O", "signature", "Signature"),
  f("o.name", "O", "text", "Name:", { prefill: true }),
  f("o.date", "O", "date", "Date:"),
];

const PART8 = [
  ["a", "I have received a completed copy of the Pre-installation electrical safety assessment for the premises; and"],
  ["b", "I have completed the current Pre-installation installer safety assessment, as published on the department’s Internet site within 30 days of the completion of the pre-installation electrical safety assessment; and"],
  ["c", "the Pre-installation installer safety assessment confirms"],
  ["d", "the worksite is safe and the installation or upgrade will proceed in accordance with any recommendations or conditions from the Pre-installation electrical safety assessment including, if required, that a licensed electrician must be present during the insulation upgrade; and"],
  ["e", "that safe work methods are in place as per Occupational Health and Safety Regulations 2017 (Vic); and"],
  ["f", "I will ensure that:"],
  ["g", "all applicable occupation health and safety laws and requirements are complied with; and"],
  ["h", "the insulation will be installed in compliance with the effective version of AS 3999; and"],
  ["i", "if the installation is carried out on multiple days, that I will check that all items remain compliant with this assessment form at the start of each day prior to undertaking the work; and"],
  ["j", "the insulation product/s being installed are listed on the ESC Register of Products."],
] as const;
const SEE_C = " (See Section C of the completed Pre-installation electrical safety assessment)";

export const PIISA_ITEMS: OfficialItem[] = [
  st("intro", "Completion of this form is mandatory prior to commencement of ceiling insulation installation work to comply with the requirements and conditions of the Victorian Energy Efficiency Target Regulations 2018."),
  st("intro", "This form does not replace the need to undertake a Safe Work Method Statements (SWMS) that outlines the hazards associated with high-risk construction work (HRCW) and the control measures that will be used to eliminate or minimize those risks."),
  st("intro", "Each ceiling insulation installation must be undertaken by an accredited person, or person contracted by an accredited person with consideration of the Occupational Health and Safety Act 2004, and Occupational Health and Safety Regulations 2017 which require employers and self-employed persons to prepare a SWMS before starting HRCW."),
  st("intro", "The Pre-installation installer safety assessment must be completed within 30 days of the pre-installation electrical safety assessment completion date."),
  f("jobRef", "P1", "text", "Job Reference ID", { prefill: true }),
  st("P1", "PART 1 – PROPERTY DETAILS", "heading"),
  f("address", "P1", "text", "Address including postcode", { prefill: true }),
  f("startDate", "P1", "date", "Installation start date:"),
  f("completionDate", "P1", "date", "Predicted installation completion date:"),
  yn("p1.powerInformed", "P1", "Has the household/tenant been informed that the power will be turned off/ isolated for the duration of the installation?"),
  yn("lifeSupport", "P1", LS_Q),
  f("lifeSupportConsent", "P1", "choice", LS_CONSENT, { options: LS_OPTIONS, when: "lifeSupport = Yes" }),
  f("lifeSupportAttachment", "P1", "attachment", LS_ATTACH, { when: "lifeSupport = Yes", derivedFrom: LS_CONSENT }),
  st("P1", LS_STOP),
  st("P2", "PART 2 - INSTALLATION DETAILS", "heading"),
  f("p2.installDate", "P2", "date", "Installation date:"),
  f("p2.ap", "P2", "text", "Accredited person name:", { prefill: true }),
  f("p2.company", "P2", "text", "Installer company name:", { prefill: true }),
  f("p2.lead", "P2", "text", "Lead installer name:", { prefill: true }),
  f("p2.leadEec", "P2", "text", "EEC certification number:", { prefill: true }),
  f("p2.addName", "P2", "text", "Additional installer/s Name/s:", { required: false, row: { group: "p2.additional", rows: 3 } }),
  f("p2.addEec", "P2", "text", "EEC certification number:", { required: false, row: { group: "p2.additional", rows: 3 } }),
  st("P3", "PART 3 – SAFE SYSTEM OF WORK", "heading"),
  yn("p3.swms", "P3", "Has a Safe Work Method Statement (SWMS) for the insulation upgrade at the listed address been completed and all risks identified?"),
  yn("p3.table1", "P3", "Have all hazards listed in Table 1: Common hazards when installing insulation been considered, and control measures been implemented when developing the SWMS for this job?"),
  yn("p3.isolated", "P3", "Has the main and/or alternate power supply been isolated, locked out, tagged and has the roof cavity been confirmed as electrically safe to enter?"),
  st("P3", "If you’ve answered NO to any of the question in PART 3 – SAFE SYSTEM OF WORK, the installation CANNOT proceed."),
  st("P4", "PART 4 – SOLAR POWER, BATTERY AND/OR ALTERNATIVE SUPPLY", "heading"),
  yn("p4.present", "P4", SOLAR_Q),
  st("P4", "If you have answered NO, go to PART 5 – PRE-INSTALLATION ELECTRICAL SAFETY ASSESSMENT"),
  yn("p4.instructions", "P4", SOLAR_INSTR, { when: "p4.present = Yes" }),
  yn("p4.isolator", "P4", SOLAR_ISO, { when: "p4.present = Yes" }),
  st("P4", "If you’ve answered NO to the second question in PART 4 - SOLAR, an electrician must be present at the start of the installation to isolate the mains/alternative power supply, lock out, tag and confirm the work area is electrically safe for anyone entering the roof cavity."),
  st("P5", "PART 5 – PRE-INSTALLATION ELECTRICAL SAFETY ASSESSMENT", "heading"),
  yn("p5.reviewed", "P5", "Has the Pre-installation electrical safety assessment been reviewed by the lead installer and has the site been confirmed as safe to commence works?"),
  f("p5.electricianPresent", "P5", "yesno_na", "If the Pre-installation electrical safety assessment recommends an electrician is present at the start of the installation to ensure the area is electrically safe, has this occurred?", { options: ["Yes", "No", "N/A"] }),
  st("P5", IC_INTRO),
  st("P5", "*Note: Downlight replacement does not need to occur in ceilings of rooms that have another room or sole occupancy unit above the subject portion of the ceiling, provided insulation is not being installed there. The VEU does not incentivise insulation being installed between floors."),
  yn("p5.recessed", "P5", RECESSED),
  f("p5.count", "P5", "number", LUM_COUNT, { when: "p5.recessed = Yes" }),
  yn("p5.icConfirmed", "P5", `Did the Pre-installation electrical safety assessment confirm that all luminaires present in the ceiling have been upgraded to IC and/or IC-4 rated (i.e. classified and marked)?${SEE_C}`),
  yn("p5.safeToCover", "P5", `Are all recessed luminaires deemed safe to cover with insulation?${SEE_C}`),
  yn("p5.rcd", "P5", `Did the pre-installation electrical safety assessment confirm that all mains connected cables in the ceiling space are appropriately protected by an RCD where required?${SEE_C}`),
  yn("p5.tps", "P5", `Did the Pre-installation electrical safety assessment confirm that all mains connected cables in the ceiling space are thermoplastic insulated and sheathed (TPS) or an equivalent cable type?${SEE_C}`),
  yn("p5.basic", "P5", `Did the Pre-installation electrical safety assessment confirm that all mains connected cables in the ceiling space meet Basic Protection Requirements?${SEE_C}`),
  yn("p5.noAccess", "P5", "Has the owner/occupier confirmed that no one has accessed or carried out any works in the ceiling space since the completion of the Pre-installation electrical safety assessment?"),
  st("P5", "If you’ve answered NO to questions in PART 5 - PRE-INSTALLATION ELECTRICAL SAFETY ASSESSMENT (other than are there recessed luminaries present in the ceiling?), the activity CANNOT commence."),
  st("P6", "PART 6 – EXISTING INSULATION", "heading"),
  yn("p6.present", "P6", "Is there insulation present in the ceiling."),
  st("P6", "If NO, go to Part 7 – PRODUCT DETAILS"),
  f("p6.height", "P6", "number", "What is the average height of the existing insulation?", { unit: "mm", when: "p6.present = Yes" }),
  f("p6.rValue", "P6", "number", "What is the R-Value of existing insulation (if known)?", { unit: "RV", required: false, when: "p6.present = Yes" }),
  f("p6.treatment", "P6", "ticks", "Will the existing ceiling insulation be removed completely or topped up?", { options: ["Removed", "Topped Up"], when: "p6.present = Yes" }),
  st("P6", "Note: any foil backed or electrically conductive insulation cannot be topped up and must be removed prior to installation."),
  yn("p6.suitable", "P6", "Is the existing insulation in a suitable condition for new insulation to be laid over?", { when: "p6.present = Yes" }),
  f("p6.reason", "P6", "text", "If the existing insulation is not removed, what is the reason?", { when: "p6.treatment includes Topped Up" }),
  st("P7", "PART 7 – PRODUCT DETAILS", "heading"),
  f("p7.products", "P7", "text", "List the insulation product(s) brand, model and R-value being installed"),
  st("P8", "PART 8 – INSTALLER DECLARATION", "heading"),
  st("P8", "As the lead EEC Certified installer responsible for this installation, I confirm that:"),
  ...PART8.map(([letter, t]) => ({ ...st("P8", t), letter })),
  f("p8.declaration", "P8", "tick", "All information contained in and attached to this form is correct and not misleading by inclusion or omission"),
  ...PRIVACY.map((t) => st("P8", t)),
  f("p8.signature", "P8", "signature", "Signature"),
  f("p8.name", "P8", "text", "Installer full name:", { prefill: true }),
  f("p8.date", "P8", "date", "Date:"),
  st("T1", "Table 1: Common hazards and guidance resources when installing insulation", "heading"),
];

export const OFFICIAL_ITEMS: Record<OfficialKey, OfficialItem[]> = { piesa: PIESA_ITEMS, piisa: PIISA_ITEMS };
export const answerItems = (key: OfficialKey) => OFFICIAL_ITEMS[key].filter((i) => i.kind !== "heading" && i.kind !== "statement");

// ---------- answers ----------
export type Value = string | number | boolean | string[] | null | undefined;
/** Answers keyed by item id; row cells are `${id}#${rowIndex}` (0-based). */
export type OfficialAnswers = Record<string, Value>;
const s = (v: Value) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v)).trim();
const isYes = (v: Value) => /^yes$/i.test(s(v));
const isNo = (v: Value) => /^no$/i.test(s(v));
const ticked = (v: Value) => v === true || /^(yes|true|ticked|checked)$/i.test(s(v));
const list = (v: Value, options?: readonly string[]) => (Array.isArray(v) ? v.map(String) : !s(v) ? [] : options ? splitSelections(v, options).selected : s(v).split(/\s*,\s*(?=[A-Z])/));

// ---------- multi-select answers (decision 329) ----------
const selNorm = (x: string) => x.replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
const selCore = (x: string) => selNorm(x).replace(/[.:]+$/, "");
/**
 * The ticked options of a multi-select answer. Mitti joins the selected labels with ", " (mitti.core responseValue) and the
 * option labels THEMSELVES contain commas ("Prohibited luminaires (e.g. CA-class luminaires, non-IC luminaires, …)"), so a
 * plain comma split is wrong. An array is taken as it is (each element still matched); a string is split on " | " / new
 * lines and then read left to right against the known options, longest first. Anything that matches no option comes back in
 * `unknown` (so the caller can flag it) — it is never guessed into an option. `selected` is in the options' own order, once each.
 */
export function splitSelections(v: Value, options: readonly string[]): { selected: string[]; unknown: string[] } {
  const raw = Array.isArray(v) ? v.map(String) : v == null || v === "" ? [] : [String(v)];
  const parts = raw.flatMap((x) => x.split(/\s*\|\s*|\s*\n\s*/)).map((x) => x.trim()).filter(Boolean);
  const opts = [...new Set(options)].map((o) => ({ o, core: selCore(o) })).filter((x) => x.core).sort((a, b) => b.core.length - a.core.length);
  const hit = new Set<string>();
  const unknown: string[] = [];
  const matchAt = (rest: string) => {
    for (const x of opts) {
      if (!rest.startsWith(x.core)) continue;
      const after = rest.slice(x.core.length);
      const m = /^[.:]*\s*(?:,|$)/.exec(after);
      if (m) return { o: x.o, rest: after.slice(m[0].length) };
    }
    return null;
  };
  for (const part of parts) {
    let rest = selNorm(part);
    while ((rest = rest.replace(/^[\s,]+/, ""))) {
      const m = matchAt(rest);
      if (m) { hit.add(m.o); rest = m.rest; continue; }
      // Not a known option: the unknown piece runs to the next ", " that starts a known option (or the end).
      let cut = rest.length;
      for (let i = rest.indexOf(","); i >= 0; i = rest.indexOf(",", i + 1)) if (matchAt(rest.slice(i + 1).trimStart())) { cut = i; break; }
      unknown.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut);
    }
  }
  return { selected: options.filter((o, i) => hit.has(o) && options.indexOf(o) === i), unknown };
}

// ---------- typed electronic signatures (decision 329) ----------
const ddmmyyyy = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.trim()); return m ? `${m[3]}/${m[2]}/${m[1]}` : d.trim(); };
/** The text written into an official form's "Signature" box: the signer's typed name, signed electronically on a date. */
export const electronicSignature = (name: string, date: string) => `${name.trim().replace(/\s+/g, " ")} (signed electronically on ${ddmmyyyy(date)})`;
/** True for a value built by `electronicSignature` (a typed name + the electronic-signing date). */
export const isElectronicSignature = (v: Value) => /^\S.* \(signed electronically on \d{2}\/\d{2}\/\d{4}\)$/.test(s(v));
const isDate = (v: Value) => /^\d{4}-\d{2}-\d{2}$/.test(s(v));
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Maps Mitti entries (label order) onto item ids. Duplicate official labels are assigned in form order; table cells by row. */
export function answersFromEntries(key: OfficialKey, entries: { label: string; value: string | null }[]): OfficialAnswers {
  const nrm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const items = answerItems(key);
  const used = new Map<string, number>();
  const out: OfficialAnswers = {};
  for (const e of entries) {
    const k = nrm(e.label ?? "");
    const cands = items.filter((i) => nrm(i.label) === k);
    if (!cands.length) continue;
    const seen = used.get(k) ?? 0;
    const flat = cands.flatMap((i) => (i.row ? Array.from({ length: i.row.rows }, (_, r) => `${i.id}#${r}`) : [i.id]));
    // Table cells come after the non-row duplicates in form order only when they share a label (EEC certification number).
    const ordered = cands.length > 1 ? cands.flatMap((i) => (i.row ? Array.from({ length: i.row.rows }, (_, r) => `${i.id}#${r}`) : [i.id])) : flat;
    const slot = ordered[seen];
    used.set(k, seen + 1);
    if (slot) out[slot] = e.value;
  }
  return out;
}

// ---------- printed-rule enforcement (Part 3) ----------
export type RuleResult = { rule: string; message: string; confirmation?: "NEEDS OFFICIAL/LEGAL CONFIRMATION" };
export type Evaluation = { blockers: RuleResult[]; nextActions: RuleResult[] };
/** How an ineffective Part 7 action was resolved. Only a verified rectification record counts today. */
/** Built only by `evaluateHazardRectifications` (hazard-rectification.core.ts): the PIESA hazard keys that a current,
 * verified rectification record on the same job and same signed PIESA resolves. */
export type HazardResolution = { kind: "verified_rectification"; resolvedHazards: string[] } | { kind: "authorised_review"; reviewId: string } | null;
export type PiesaHazard = { key: string; text: string };
/** Every hazard recorded in PIESA Part 7 (appliance rows and other-hazard rows), with a stable key. */
export function piesaHazards(a: OfficialAnswers): PiesaHazard[] {
  const out: PiesaHazard[] = [];
  for (let r = 0; r < 10; r++) {
    const c = ["p7.appliance", "p7.location", "p7.hazard"].map((id) => s(a[`${id}#${r}`]));
    if (c.some(Boolean)) out.push({ key: `appliance#${r}`, text: `${c[0]} (${c[1]}): ${c[2]}` });
  }
  for (let r = 0; r < 14; r++) {
    const h = s(a[`p7.otherHazard#${r}`]);
    if (h) out.push({ key: `other#${r}`, text: h });
  }
  return out;
}
/** Audited authorised review may resolve an ineffective hazard action only once official guidance is confirmed. */
export const HAZARD_REVIEW_GUIDANCE_CONFIRMED = false;
export const HAZARD_UNRESOLVED = "Hazard remains unresolved - office/electrical review required.";
export const CONDUCTIVITY_UNCONFIRMED = "Existing insulation conductivity must be confirmed.";
/** Home Insulation Victoria supporting evidence — not part of the official PIISA. */
export const CONDUCTIVITY_PHOTO_MISSING = "Home Insulation Victoria supporting evidence: add a photo of the existing insulation (separate from the official PIISA).";
export type PiesaContext = { installStart?: string | null; deliveredToInstallerAt?: string | null; deliveredToOwnerAt?: string | null; hazardResolution?: HazardResolution };
export type PiisaContext = { piesaCompletionDate?: string | null; piesaReceivedAt?: string | null; electricianRequiredAtStart?: boolean | null;
  /** Explicit recorded answer only — a blank is never treated as "No". */ conductiveExistingInsulation?: boolean | null;
  /** Home Insulation Victoria supporting evidence (photo/file id), outside the official form. */ conductivityEvidence?: string | null };

function requiredMissing(key: OfficialKey, a: OfficialAnswers, active: (i: OfficialItem) => boolean): RuleResult[] {
  const out: RuleResult[] = [];
  for (const i of answerItems(key)) {
    if (!i.required || i.row || !active(i)) continue;
    const v = a[i.id];
    const bad = i.kind === "tick" ? !ticked(v) : i.kind === "date" ? !isDate(v) : i.kind === "ticks" ? list(v, i.options).length === 0 : !s(v);
    if (bad) out.push({ rule: `REQ:${i.id}`, message: i.kind === "date" && s(v) ? `"${i.label}" must be a date only (YYYY-MM-DD), not a date and time.` : `Required: "${i.label}"${i.kind === "tick" ? " must be ticked" : ""}.` });
  }
  return out;
}
const rows = (a: OfficialAnswers, ids: string[], count: number) =>
  Array.from({ length: count }, (_, r) => ids.map((id) => s(a[`${id}#${r}`]))).filter((cells) => cells.some(Boolean));

/** PIESA printed rules. Every rule quotes the form; unclear points block with NEEDS OFFICIAL/LEGAL CONFIRMATION. */
export function evaluatePiesa(a: OfficialAnswers, ctx: PiesaContext = {}): Evaluation {
  const blockers: RuleResult[] = [], nextActions: RuleResult[] = [];
  const b1 = s(a["b1"]);
  const rect = b1 === B1_OPTIONS[1], notPossible = b1 === B1_OPTIONS[2], notRequired = b1 === B1_OPTIONS[0];
  const solar = isYes(a["p3.present"]);
  const recessed = isYes(a["p6.recessed"]);
  const hazardAsked = isYes(a["p7.appliances"]) || isYes(a["p7.flues"]);
  const applianceRows = rows(a, ["p7.appliance", "p7.location", "p7.hazard"], 10);
  const hazardIdentified = applianceRows.length > 0;
  const b2 = list(a["b2"], B2_OPTIONS);
  const active = (i: OfficialItem) => {
    switch (i.when) {
      case undefined: return true;
      case "lifeSupport = Yes": return isYes(a["lifeSupport"]);
      case "p3.present = Yes": return solar;
      case "p6.recessed = Yes": return recessed;
      case "hazard identified": return hazardIdentified;
      case RECT: return rect;
      case "b2 includes Other": return b2.includes(B2_OPTIONS[5]);
      default: return true;
    }
  };
  blockers.push(...requiredMissing("piesa", a, active));
  if (b1 && !(B1_OPTIONS as readonly string[]).includes(b1)) blockers.push({ rule: "B1-ONE", message: "B1: \"Check ONE option only\" — the answer must be exactly one of the three printed options." });

  // Life support: "If anyone at this property relies on life support and you don’t have a written consent or a medical plan, the installation CANNOT proceed."
  if (isYes(a["lifeSupport"]) && (!LS_OPTIONS.includes(s(a["lifeSupportConsent"])) || !s(a["lifeSupportAttachment"])))
    blockers.push({ rule: "P1-LIFE-SUPPORT", message: LS_STOP });
  // "Note: If any of the above items are marked NO, the overall question will be marked as NO."
  const subs = ["p2.switchAccessible", "p2.switchIsolates", "p2.switchSecured"];
  if (subs.some((k) => isNo(a[k])) && isYes(a["p2.switch"])) blockers.push({ rule: "P2-SWITCH-OVERALL", message: "Part 2: \"If any of the above items are marked NO, the overall question will be marked as NO.\" The main-switch answer must be NO." });
  // Part 2 / Part 3: any NO → rectification OR electrician present at start.
  const p2No = ["p2.mains", "p2.switch", ...subs, "p2.tested", "p2.rcdPresent", "p2.rcdTested"].some((k) => isNo(a[k]));
  const p3No = solar && ["p3.instructions", "p3.isolator", "p3.conduit", "p3.protected"].some((k) => isNo(a[k]));
  if ((p2No || p3No) && notRequired) blockers.push({ rule: "P2P3-NO", message: "A NO in Part 2 or Part 3 means \"rectification will be required prior to installation work commencing, OR where rectification is not possible, an electrician must be present at the start of the installation\". B1 can't be \"not required\"." });
  // Part 4 any NO / Part 5 any YES / Part 6 prohibited YES → "rectification is required before ceiling insulation work can commence."
  const p4No = ["p4.conduit", "p4.supported", "p4.treatment", "p4.tps", "p4.terminations", "p4.plugBases", "p4.foil"].some((k) => isNo(a[k]));
  const p5Yes = ["p5.nonTps", "p5.splitConduit", "p5.damaged"].some((k) => isYes(a[k]));
  const p6Yes = recessed && isYes(a["p6.prohibited"]);
  for (const [hit, part] of [[p4No, "a NO in Part 4"], [p5Yes, "a YES in Part 5"], [p6Yes, "a YES to prohibited luminaires in Part 6"]] as const)
    if (hit && b1 && !rect) blockers.push({ rule: `RECT-REQUIRED:${part}`, message: `Because of ${part}, "rectification is required before ceiling insulation work can commence." B1 must be "Electrical rectification work is required before insulation is installed or upgraded."` });
  // Part 7: "If you answered ‘Yes’ to any of the above questions, please describe the appliance, its location and associated hazards"
  if (hazardAsked && applianceRows.length === 0) blockers.push({ rule: "P7-DESCRIBE", message: "Part 7: a Yes answer needs at least one appliance row (Appliance, Location, Hazard)." });
  if (applianceRows.some((r) => r.some((c) => !c))) blockers.push({ rule: "P7-ROW-INCOMPLETE", message: "Part 7: every started appliance row needs Appliance, Location and Hazard." });
  if (rows(a, ["p7.otherHazard", "p7.otherAction"], 14).some((r) => r.some((c) => !c))) blockers.push({ rule: "P7-OTHER-INCOMPLETE", message: "Part 7: every listed other hazard needs its action, and every action its hazard." });
  // Ineffective action: the form prints no next step. Fail closed; an attempted action is never treated as risk reduction.
  const hazards = piesaHazards(a);
  if (hazards.length > 0 && !isYes(a["p7.effective"])) {
    const r = ctx.hazardResolution;
    const resolved = r?.kind === "verified_rectification" ? hazards.every((h) => r.resolvedHazards.includes(h.key)) : r?.kind === "authorised_review" ? HAZARD_REVIEW_GUIDANCE_CONFIRMED && !!r.reviewId : false;
    if (!resolved) blockers.push({ rule: "P7-NOT-EFFECTIVE", message: HAZARD_UNRESOLVED, confirmation: "NEEDS OFFICIAL/LEGAL CONFIRMATION" });
  }
  // B1 rectification: "Record actions, conditions and required rectifications in B2. Section C of this document must be completed before ceiling insulation work may commence."
  if (rect && b2.length === 0) blockers.push({ rule: "B1-B2", message: "B1: \"Record actions, conditions and required rectifications in B2.\"" });
  if (b2.length && !rect) blockers.push({ rule: "B2-ONLY-IF-RECT", message: "B2 lists required electrical work, but B1 does not say rectification is required." });
  if (rect) nextActions.push({ rule: "B1-SECTION-C", message: "\"Section C of this document must be completed before ceiling insulation work may commence.\"" });
  if (notPossible) nextActions.push({ rule: "B1-ELECTRICIAN-AT-START", message: "\"Selection of this option requires an electrician to be present at the start of the installation to isolate the main and/or alternative power supply, lock out and tag, and confirm that the work area is electrically safe for anyone entering the roof cavity.\"" });
  if (notPossible && !(p2No || p3No)) blockers.push({ rule: "B1-NOT-POSSIBLE-SCOPE", message: "B1 \"not possible … under parts 2 and 3\" was chosen, but no Part 2 or Part 3 answer is NO." });
  if (notPossible && (p4No || p5Yes || p6Yes)) blockers.push({ rule: "B1-NOT-POSSIBLE-PART4-6", message: "B1 \"not possible\" only covers parts 2 and 3; the Part 4–6 answers still require rectification." });
  // Section C dates: certification date requires the CoES number; dates only.
  // 24h copy rule.
  if (ctx.installStart) {
    for (const [who, at] of [["the person installing the insulation product", ctx.deliveredToInstallerAt], ["the property owner/owner’s representative", ctx.deliveredToOwnerAt]] as const) {
      if (!at || Date.parse(ctx.installStart) - Date.parse(at) < 24 * 3_600_000)
        blockers.push({ rule: "COPY-24H", message: `"A copy of the completed form must be provided to ${who} … no less than 24 hours prior to the install commencing."` });
    }
  }
  return { blockers, nextActions };
}

/** PIISA printed rules. */
export function evaluatePiisa(a: OfficialAnswers, ctx: PiisaContext = {}): Evaluation {
  const blockers: RuleResult[] = [], nextActions: RuleResult[] = [];
  const solar = isYes(a["p4.present"]), present = isYes(a["p6.present"]), recessed = isYes(a["p5.recessed"]);
  const treatment = list(a["p6.treatment"]);
  const active = (i: OfficialItem) => {
    switch (i.when) {
      case undefined: return true;
      case "lifeSupport = Yes": return isYes(a["lifeSupport"]);
      case "p4.present = Yes": return solar;
      case "p5.recessed = Yes": return recessed;
      case "p6.present = Yes": return present;
      case "p6.treatment excludes Removed": return present && !treatment.includes("Removed");
      case "p6.treatment includes Topped Up": return present && treatment.includes("Topped Up");
      default: return true;
    }
  };
  blockers.push(...requiredMissing("piisa", a, active));
  if (isYes(a["lifeSupport"]) && (!LS_OPTIONS.includes(s(a["lifeSupportConsent"])) || !s(a["lifeSupportAttachment"])))
    blockers.push({ rule: "P1-LIFE-SUPPORT", message: LS_STOP });
  if (["p3.swms", "p3.table1", "p3.isolated"].some((k) => isNo(a[k]))) blockers.push({ rule: "P3-CANNOT-PROCEED", message: "\"If you’ve answered NO to any of the question in PART 3 – SAFE SYSTEM OF WORK, the installation CANNOT proceed.\"" });
  // Trigger (Jo, 8 Oct 2026): "No" to the solar instructions question, or the signed PIESA requiring attendance.
  if (solar && isNo(a["p4.instructions"])) nextActions.push({ rule: "P4-ELECTRICIAN", message: "\"If you’ve answered NO to the second question in PART 4 - SOLAR, an electrician must be present at the start of the installation …\"" });
  if ((solar && isNo(a["p4.instructions"])) || ctx.electricianRequiredAtStart) {
    if (s(a["p5.electricianPresent"]) === "N/A") blockers.push({ rule: "ELECTRICIAN-NA-INVALID", message: "An electrician must attend the start, so \"N/A\" is not a valid answer." });
    if (!isYes(a["p5.electricianPresent"])) blockers.push({ rule: "ELECTRICIAN-AT-START", message: "An electrician must be present at the start of the installation, and \"has this occurred?\" is not Yes." });
  }
  const p5 = ["p5.reviewed", "p5.electricianPresent", "p5.icConfirmed", "p5.safeToCover", "p5.rcd", "p5.tps", "p5.basic", "p5.noAccess"];
  if (p5.some((k) => isNo(a[k]))) blockers.push({ rule: "P5-CANNOT-COMMENCE", message: "\"If you’ve answered NO to questions in PART 5 - PRE-INSTALLATION ELECTRICAL SAFETY ASSESSMENT (other than are there recessed luminaries present in the ceiling?), the activity CANNOT commence.\"" });
  // Unsuitable condition only stops laying new insulation over retained insulation; complete removal is fine.
  if (present && isNo(a["p6.suitable"]) && treatment.includes("Topped Up")) blockers.push({ rule: "P6-UNSUITABLE-TOPUP", message: "Part 6: the existing insulation is not in a suitable condition for new insulation to be laid over, so it cannot be topped up." });
  if (treatment.some((t) => !["Removed", "Topped Up"].includes(t))) blockers.push({ rule: "P6-OPTIONS", message: "Part 6: existing insulation can only be \"Removed and/or Topped Up\"." });
  if (present) {
    // The form has no conductivity field: an explicit recorded answer plus evidence is required; blank never means "No".
    // Authority: the printed Part 6 note ("foil backed or electrically conductive insulation cannot be topped up and must be
    // removed") can't be applied without knowing the answer, so an explicit Yes/No is a Home Insulation Victoria operational rule implementing it.
    if (ctx.conductiveExistingInsulation !== true && ctx.conductiveExistingInsulation !== false)
      blockers.push({ rule: "P6-FOIL-UNKNOWN", message: CONDUCTIVITY_UNCONFIRMED, confirmation: "NEEDS OFFICIAL/LEGAL CONFIRMATION" });
    // Authority: Home Insulation Victoria operational requirement only. The official PIISA asks for no photo; this is separate supporting evidence.
    if (!ctx.conductivityEvidence) blockers.push({ rule: "HIVIC-CONDUCTIVITY-PHOTO", message: CONDUCTIVITY_PHOTO_MISSING });
    if (ctx.conductiveExistingInsulation === true && treatment.includes("Topped Up")) blockers.push({ rule: "P6-FOIL", message: "\"Note: any foil backed or electrically conductive insulation cannot be topped up and must be removed prior to installation.\"" });
    if (ctx.conductiveExistingInsulation === true && !treatment.includes("Removed")) blockers.push({ rule: "P6-FOIL", message: "\"…must be removed prior to installation.\" Removed is not ticked." });
  }
  if (rows(a, ["p2.addName", "p2.addEec"], 3).some((r) => r.some((c) => !c))) blockers.push({ rule: "P2-ADDITIONAL-ROW", message: "Part 2: each additional installer needs both a name and an EEC certification number." });
  // 30-day rule: intro + Part 8(b).
  const done = s(a["p8.date"]);
  if (!ctx.piesaCompletionDate) blockers.push({ rule: "PIISA-30D", message: "\"The Pre-installation installer safety assessment must be completed within 30 days of the pre-installation electrical safety assessment completion date.\" No PIESA completion date is on record." });
  else if (isDate(done)) {
    const d = dayDiff(ctx.piesaCompletionDate, done);
    if (d < 0 || d > 30) blockers.push({ rule: "PIISA-30D", message: `"…must be completed within 30 days of the pre-installation electrical safety assessment completion date." It is ${d} days.` });
  }
  if (!ctx.piesaReceivedAt) blockers.push({ rule: "P8-A", message: "Part 8(a): \"I have received a completed copy of the Pre-installation electrical safety assessment for the premises\" — no record of the copy being received." });
  return { blockers, nextActions };
}

export function evaluateOfficialForm(key: OfficialKey, a: OfficialAnswers, ctx: PiesaContext & PiisaContext = {}): Evaluation {
  return key === "piesa" ? evaluatePiesa(a, ctx) : evaluatePiisa(a, ctx);
}

// ---------- generated / signed snapshot (Part 4) ----------
export type Signer = { userId: string; name: string; role: "electrician" | "installer" | "owner" | "office" };
export type SignedSnapshot = {
  key: OfficialKey; templateSha256: string; mappingVersion: string;
  signer: Signer; enteredDate: string; serverTimestamp: string;
  acknowledgement: { itemId: string; ticked: true }[]; signature: string;
  jobFacts: Record<string, string>; document: { id: string; kind: ItemKind; label: string; value: Value; letter?: string }[];
  delivery: { to: string; at: string; evidence: string }[];
  attachments: { itemId: string; fileId: string; sha256: string }[];
  /** SHA-256 of the completed official document (form order). */ documentSha256: string;
  hash: string;
};
const canon = (o: unknown): string => JSON.stringify(o, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
const sha = (x: string) => sha256Hex(x);
/** Plain record test — a stored snapshot is JSON, so arrays/nulls/primitives are all malformed. */
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Builds the official document in the form's own order (statements verbatim, owner name at the end). */
export function renderOfficialDocument(key: OfficialKey, a: OfficialAnswers) {
  return OFFICIAL_ITEMS[key].flatMap((i) => {
    if (i.row) return Array.from({ length: i.row.rows }, (_, r) => ({ id: `${i.id}#${r}`, kind: i.kind, label: i.label, value: a[`${i.id}#${r}`] ?? null }));
    const v = i.kind === "heading" || i.kind === "statement" ? null : i.kind === "date" ? (isDate(a[i.id]) ? s(a[i.id]) : null) : a[i.id] ?? null;
    return [{ id: i.id, kind: i.kind, label: i.label, value: v, ...(i.letter ? { letter: i.letter } : {}) }];
  });
}

export function buildSignedSnapshot(input: {
  key: OfficialKey; answers: OfficialAnswers; signer: Signer; enteredDate: string; serverTimestamp: string;
  jobFacts: Record<string, string>; acknowledgementIds: string[]; signature: string; delivery?: SignedSnapshot["delivery"];
  attachments?: SignedSnapshot["attachments"];
}): SignedSnapshot {
  if (!isDate(input.enteredDate)) throw new Error("Entered date must be a date only (YYYY-MM-DD).");
  const t = OFFICIAL_TEMPLATES[input.key];
  for (const id of input.acknowledgementIds) if (!ticked(input.answers[id])) throw new Error(`Acknowledgement ${id} is not ticked.`);
  const body = {
    key: input.key, templateSha256: t.sha256, mappingVersion: t.mappingVersion, signer: input.signer, enteredDate: input.enteredDate,
    serverTimestamp: input.serverTimestamp, acknowledgement: input.acknowledgementIds.map((itemId) => ({ itemId, ticked: true as const })),
    signature: input.signature, jobFacts: input.jobFacts, document: renderOfficialDocument(input.key, input.answers), delivery: input.delivery ?? [],
    attachments: input.attachments ?? [], documentSha256: "",
  };
  body.documentSha256 = sha(canon(body.document));
  return { ...body, hash: sha(canon(body)) };
}

/**
 * S74 / DEF-07: a stored snapshot is data, so it can be missing, truncated or tampered with. Report that
 * as an invalid signed copy instead of throwing — a throw here would turn "this copy is not valid" into a
 * crashed compliance gate, which is worse for the customer and tells Office nothing.
 */
function snapshotShapeProblem(snap: unknown): string | null {
  if (!isRecord(snap)) return "Signed copy is missing or malformed.";
  const key = snap["key"];
  if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(OFFICIAL_TEMPLATES, key)) return "Signed copy uses an unknown form.";
  if (!Array.isArray(snap["document"])) return "Signed copy has no completed document.";
  return null;
}

/** A signed snapshot stays valid only if untampered, on the current mapping, and the answers haven't changed since. */
export function snapshotProblems(snap: SignedSnapshot, current?: OfficialAnswers): string[] {
  const shape = snapshotShapeProblem(snap);
  if (shape) return [shape];
  const out: string[] = [];
  const { hash, ...body } = snap;
  if (sha(canon(body)) !== hash) out.push("Signed copy has been altered since it was signed.");
  const t = OFFICIAL_TEMPLATES[snap.key];
  if (snap.mappingVersion !== t.mappingVersion || snap.templateSha256 !== t.sha256) out.push("Signed copy uses a different template or mapping version.");
  if (sha(canon(snap.document)) !== snap.documentSha256) out.push("Completed document hash does not match.");
  if (current && canon(renderOfficialDocument(snap.key, current)) !== canon(snap.document)) out.push("Form answers changed after signing — the signed copy is no longer valid.");
  return out;
}

/**
 * Rebuilds answers from a signed document (item id → value).
 * S74 / DEF-07: malformed rows are dropped and a missing/non-array document yields `{}` — never a throw.
 * `{}` is the fail-closed answer: evaluatePiesa/evaluatePiisa then report every required answer as missing,
 * so a damaged copy can neither satisfy statutory compliance nor advance a job.
 */
export const answersFromDocument = (doc: SignedSnapshot["document"]): OfficialAnswers =>
  Object.fromEntries(
    (Array.isArray(doc) ? doc : [])
      .filter((d) => isRecord(d) && typeof d["id"] === "string" && d["value"] != null)
      .map((d) => [d["id"] as string, d["value"]]),
  );
export const documentSha = (doc: SignedSnapshot["document"]) => sha(canon(doc));

export const PRINTED_RULE_IDS = {
  piesa: ["P1-LIFE-SUPPORT", "P2-SWITCH-OVERALL", "P2P3-NO", "RECT-REQUIRED", "P7-DESCRIBE", "P7-ROW-INCOMPLETE", "P7-OTHER-INCOMPLETE", "P7-NOT-EFFECTIVE", "B1-ONE", "B1-B2", "B2-ONLY-IF-RECT", "B1-SECTION-C", "B1-ELECTRICIAN-AT-START", "B1-NOT-POSSIBLE-SCOPE", "B1-NOT-POSSIBLE-PART4-6", "COPY-24H", "REQ"],
  piisa: ["P1-LIFE-SUPPORT", "P3-CANNOT-PROCEED", "P4-ELECTRICIAN", "ELECTRICIAN-AT-START", "P5-CANNOT-COMMENCE", "P6-OPTIONS", "P6-FOIL", "P6-FOIL-UNKNOWN", "P2-ADDITIONAL-ROW", "PIISA-30D", "P8-A", "REQ"],
} as const;

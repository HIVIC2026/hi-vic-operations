// The Essential Services Commission Owner's Consent Form (Template V1, 14 April 2026) as a website-look PDF
// (approved sample: docs/approved-samples/2026-11-02/esc-consent-final.pdf). Wording comes straight from consent.core.ts.
// Server-only, no database. Each section is one group, so a section is never split across pages.
import { AP_DETAILS } from "./veec-assignment-form.core";
import { ESC_AP_FULL_NAME, OWNER_DECLARATIONS, section1FromFacts, splitFullName, type ConsentFacts } from "./consent.core";
import type { PdfBlock, PdfLayoutReport } from "./pdf-look.core";
import { renderPdf } from "./pdf-look.server";
import { veecFormDate } from "./veec-form-pdf.server";

const OFFICE_EMAIL = "info@homeinsulationvictoria.com.au";
const FORM_TITLE = "Owner's Consent Form – to Share Information with the Essential Services Commission";
/** As the approved sample prints it: no "(VEU Accredited Person …)" tail in the declarations; Part A adds the plain "(A003654)". */
const AP_NAME = ESC_AP_FULL_NAME.replace(" (VEU Accredited Person A003654)", "");
const DASH = "—";
const or = (v: string | null | undefined) => (v ?? "").trim() || DASH;

/** Who has signed so far. `phone`/`email` default to the Accredited Person contact on the other approved forms. */
export type EscConsentSignatures = {
  owner?: { name: string; at: string };
  ap?: { name: string; role: string; at: string; phone?: string | null; email?: string | null };
};

const heading = (id: string, text: string): PdfBlock => ({ id, kind: "heading", text, compact: true });
const sub = (id: string, text: string): PdfBlock => ({ id, kind: "subheading", text, compact: true });
/** The approved sample's spacing is CSS-collapsed margins; the kit adds its gaps, so these pull the next block up (pt). */
const pull = (id: string, height: number): PdfBlock => ({ id, kind: "spacer", height: -height });
const para = (id: string, text: string): PdfBlock => ({ id, kind: "para", text, compact: true });

export function escConsentBlocks(facts: ConsentFacts, signed: EscConsentSignatures | null, o: { jobNumber?: string | null } = {}): PdfBlock[] {
  const s1 = section1FromFacts(facts);
  const owner = signed?.owner;
  const ap = signed?.ap;
  // The pre-filled copy and a copy awaiting the AP show the Accredited Person's usual representative.
  const rep = ap?.name ?? AP_DETAILS.fullName ?? "";
  const repName = splitFullName(rep);
  const role = ap?.role ?? "Director";
  const phone = ap?.phone ?? AP_DETAILS.phone;
  const email = ap?.email ?? OFFICE_EMAIL;
  const dateCell = (s?: { at: string }) => ({ label: "Date", weight: 0.5, ...(s ? { text: veecFormDate(s.at) } : {}) });
  return [
    { id: "head", kind: "header", eyebrow: `OFFICIAL FORM${o.jobNumber ? ` · JOB ${o.jobNumber}` : ""}`, compact: true },
    { id: "title", kind: "title", text: FORM_TITLE, sub: "Essential Services Commission template, Version 1 – 14 April 2026", compact: true },
    pull("pull-title", 7.5),
    { id: "s1", kind: "group", children: [
      heading("s1-h", "Section 1: Information to be shared"),
      { id: "s1-f", kind: "facts", compact: true, fullAt: [2], rows: [["First Name", or(s1.first_name)], ["Last name", or(s1.last_name)], ["Installation address", or(s1.installation_address)], ["Phone number", or(s1.phone)], ["Email address", or(s1.email)]] },
    ] },
    { id: "s2", kind: "group", children: [
      pull("pull-s2", 3.3),
      heading("s2-h", "Section 2: Declaration by owner"),
      para("s2-i", "I declare that:"),
      { id: "s2-b", kind: "bullets", compact: true, items: OWNER_DECLARATIONS.map((d) => d.text.replace(ESC_AP_FULL_NAME, AP_NAME)) },
      { id: "s2-sig", kind: "sigRow", compact: true, cells: [
        { label: owner ? "Owner signature (typed online)" : "Owner signature", weight: 1, ...(owner ? { name: owner.name } : {}) },
        dateCell(owner),
      ] },
    ] },
    { id: "s3", kind: "group", children: [
      heading("s3-h", "Section 3 – Accredited person details and declaration"),
      sub("s3a-h", "Part A: Accredited person details"),
      { id: "s3a-f", kind: "facts", compact: true, fullAt: [0, 3], rows: [
        ["Accredited person name", `${AP_NAME} (A003654)`], ["First name", or(repName.first)], ["Last name", or(repName.last)], ["Role", or(role)], ["Phone number", or(phone)], ["Email address", or(email)],
      ] },
      pull("pull-s3b", 4.5),
      sub("s3b-h", "Part B: Declaration by accredited person"),
      para("s3b-i", `I ${rep.trim() || "<insert name>"}, am the authorised representative of ${AP_NAME} and declare that I have explained to the property owner the purpose for which this written consent is being obtained.`),
      pull("pull-sig", 3.75),
      { id: "s3b-sig", kind: "sigRow", compact: true, cells: [
        { label: "Accredited person signature", weight: 1, ...(ap ? { name: ap.name } : {}) },
        dateCell(ap),
      ] },
    ] },
  ];
}

/** `signed` null = the pre-filled unsigned copy; otherwise whoever has signed so far is printed. */
export async function escConsentPdf(facts: ConsentFacts, signed: EscConsentSignatures | null, o: { jobNumber?: string | null } = {}): Promise<{ bytes: Uint8Array; layout: PdfLayoutReport }> {
  return renderPdf({ title: FORM_TITLE, blocks: escConsentBlocks(facts, signed, o) });
}

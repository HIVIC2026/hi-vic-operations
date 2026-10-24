// O2 File list (6-year ESC record): the documents every job builds up, each shown as on file (with its date) or as
// "— when it arrives". Area diagram (219), Ready Check form, quote, acceptance agreement, tax invoice, PIESA (19),
// ESC owner consent (123), PIISA · SWMS · install day form (205/206), final area diagram (219), VEEC form (119).
// PURE: reads the job's document index (jobfile.core DocItem) — files are indexed in place, never copied.
import type { DocItem } from "./jobfile.core";

export type FileSlot = { key: string; label: string; when: string; match: (d: DocItem) => boolean };

const t = (d: DocItem) => `${d.docType} ${d.title}`.toLowerCase();
export const FILE_SLOTS: FileSlot[] = [
  { key: "area_diagram", label: "Area diagram", when: "After the Ready Check", match: (d) => d.docType === "area_diagram" },
  { key: "ready_check_form", label: "Ready Check form (Mitti)", when: "After the Ready Check", match: (d) => d.docType === "mitti_report" && /ready check/i.test(d.title) },
  { key: "quote", label: "Quote", when: "When the quote is sent", match: (d) => d.docType === "quote" && /installation/i.test(d.title) && !["draft", "superseded"].includes(d.status) },
  { key: "agreement", label: "Acceptance agreement", when: "When the owner accepts", match: (d) => (d.docType === "veec_assignment" && d.status === "signed") || /customer_agreement|acceptance agreement/.test(t(d)) },
  { key: "invoice", label: "Tax invoice", when: "When the owner accepts", match: (d) => d.docType === "invoice_reference" },
  { key: "piesa", label: "PIESA report", when: "After the electrician's visit", match: (d) => d.docType === "piesa_record" || (d.docType === "mitti_report" && /piesa/i.test(d.title)) || d.docType === "piesa_evidence" },
  { key: "esc_consent", label: "ESC owner consent", when: "When the install day is booked", match: (d) => d.docType === "esc_consent" },
  { key: "piisa", label: "PIISA", when: "Install day", match: (d) => /piisa/.test(t(d)) },
  { key: "swms", label: "SWMS · install day form", when: "Install day", match: (d) => d.docType === "swms" },
  { key: "final_area_diagram", label: "Final area diagram", when: "After the install", match: (d) => d.docType === "final_area_diagram" },
  { key: "veec", label: "VEEC assignment form", when: "After the install", match: (d) => d.docType === "veec_assignment_final" || (d.docType === "veec_assignment" && d.status === "final") || /final activity 48 veec assignment/i.test(d.title) },
];

export type FileChecklistRow = { key: string; label: string; doc: DocItem | null; when: string };

/** One row per slot: the newest matching current document, else the "when it arrives" line. */
export function fileChecklist(docs: DocItem[]): FileChecklistRow[] {
  return FILE_SLOTS.map((slot) => {
    const hits = docs.filter((d) => !["superseded", "historical", "rejected"].includes(d.status) && slot.match(d)).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
    return { key: slot.key, label: slot.label, doc: hits[0] ?? null, when: slot.when };
  });
}

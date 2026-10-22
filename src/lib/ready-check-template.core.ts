/**
 * Printable Ready Check sheet for an installer who has not been on site (C02, Jo, 2 Oct 2026:
 * "if they havent been on site at all to measure or gather info they can upload job and our system
 * provides ready check template for them to use").
 *
 * Built only from the live form definition in `mitti-forms.core.ts`, so the sheet can never drift
 * from what the portal actually needs. Pure: no network, no storage, no writes.
 */
import { FORMS, type FormField, type FormKey } from "./mitti-forms.core";

export type ReadyCheckTemplateJob = { jobNumber?: string | null; address?: string | null; ownerName?: string | null; propertyType?: string | null };

export const READY_CHECK_TEMPLATE_INTRO = [
  "Fill this in while you are at the property, then send it back with the photos.",
  "Every item below is what Home Insulation Victoria needs to confirm eligibility and prepare the quote.",
  "If something can't be collected today, write why next to it — the office will add it to the installation-day PIISA list.",
].join("\n");

/** C02: the installer prices their own customer; we add our two set fees and nothing else. */
export const READY_CHECK_TEMPLATE_PRICING = [
  "YOUR PRICE TO THE OWNER",
  "Enter your own price. Home Insulation Victoria does not mark this figure up: the owner's",
  "invoice is your full price plus our $349 Accredited Person fee and the chosen electrician's",
  "price (Home Insulation Victoria electrician: $349; usual electrician: saved price; different electrician: form price), less the VEU discount.",
].join("\n");

const HINTS: Record<FormField["type"], string> = {
  text: "write", phone: "phone number", number: "number", choice: "circle one", multichoice: "tick all that apply", yesno: "Yes / No",
  media: "photo or video", signature: "sign here", datetime: "date and time", date: "date", tick: "tick", statement: "",
};

/** The sheet itself. `ready_check_priced` (installer-sourced) is the only variant with a price section. */
export function readyCheckTemplateText(key: Extract<FormKey, "ready_check" | "ready_check_priced">, job: ReadyCheckTemplateJob = {}): string {
  const form = FORMS[key];
  const lines: string[] = ["HOME INSULATION VICTORIA — READY CHECK SHEET", form.title, "", READY_CHECK_TEMPLATE_INTRO, ""];
  if (job.jobNumber || job.address || job.ownerName || job.propertyType) {
    lines.push("JOB DETAILS WE ALREADY HAVE — check them and note anything wrong");
    if (job.jobNumber) lines.push(`   Portal Job Number: ${job.jobNumber}`);
    if (job.address) lines.push(`   Site address: ${job.address}`);
    if (job.ownerName) lines.push(`   Owner name: ${job.ownerName}`);
    if (job.propertyType) lines.push(`   Property type: ${job.propertyType}`);
    lines.push("");
  }
  lines.push("CHECKLIST", "");
  form.fields.forEach((f, i) => {
    if (f.statement) { lines.push(f.label, ""); return; }
    const notes = [
      f.perArea ? "repeat for each ceiling area" : null,
      f.when ? `only if ${f.when}` : null,
      f.prefill ? "we've filled this in — just check it" : null,
      f.required ? null : "optional",
    ].filter(Boolean).join(" · ");
    const hint = HINTS[f.type];
    lines.push(`[  ] ${String(i + 1).padStart(2, "0")}. ${f.label}${notes ? ` — ${notes}` : ""}${hint ? ` (${hint})` : ""}`);
  });
  if (key === "ready_check_priced") lines.push("", READY_CHECK_TEMPLATE_PRICING, "");
  return `${lines.join("\n")}\n`;
}

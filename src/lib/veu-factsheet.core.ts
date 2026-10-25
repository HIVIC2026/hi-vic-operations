// VEU consumer factsheet with the "You're in" acceptance email (decision 320, Jo 25 Oct 2026; VEU compliance checklist H6).
// The ESC's "Victorian Energy Upgrades consumer factsheet" PDF is attached to O22 and recorded on the job (one
// `veu_factsheet_provided` workflow event + one documents row kind `veu_consumer_factsheet`) so H6 can read it.
// The PDF is NEVER invented: it must be downloaded from the ESC website into `VEU_FACTSHEET_PATH` and bundled with
// `bun scripts/embed-veu-factsheet.ts` (→ `veu-factsheet.data.ts`). While it is not on file, O22 sends without it and
// nothing is recorded. PURE: no I/O.
import { looksLikePdf } from "./product-warranty.core";

/** Repo path Jo saves the current ESC factsheet to (download from the ESC website — not in the repo yet). */
export const VEU_FACTSHEET_PATH = "docs/esc-forms/veu-consumer-factsheet.pdf";
export const VEU_FACTSHEET_ATTACHMENT_NAME = "VEU-consumer-factsheet.pdf";
export const VEU_FACTSHEET_DOC_KIND = "veu_consumer_factsheet";
export const VEU_FACTSHEET_PROVIDED_EVENT = "veu_factsheet_provided";
export const VEU_FACTSHEET_TITLE = "Victorian Energy Upgrades consumer factsheet (ESC)";
/** Where Jo gets the current copy (named for the report and the missing-file note only; nothing is fetched). */
export const VEU_FACTSHEET_SOURCE = "Essential Services Commission website — Victorian Energy Upgrades consumer factsheet (current version)";

export type FactsheetDecision = { attach: true } | { attach: false; reason: string };

/** Attach only a real PDF; a missing or non-PDF file means "send without it and record nothing". */
export function factsheetDecision(bytes: Uint8Array | null | undefined): FactsheetDecision {
  if (!bytes || !bytes.length) return { attach: false, reason: `VEU consumer factsheet not on file (${VEU_FACTSHEET_PATH}).` };
  if (!looksLikePdf(bytes)) return { attach: false, reason: `VEU consumer factsheet at ${VEU_FACTSHEET_PATH} is not a PDF.` };
  return { attach: true };
}

/** Record the factsheet as given only when the email actually went with it attached and it is not already recorded. */
export function shouldRecordFactsheet(x: { sent: boolean; attached: boolean; alreadyRecorded: boolean }): boolean {
  return x.sent && x.attached && !x.alreadyRecorded;
}

export const factsheetProvidedSummary = (via: string) => `VEU consumer factsheet given to the owner (attached to the ${via})`;

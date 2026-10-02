// The earlier PDF field mapping (read from the old PDFs on 30 Sep 2026) is SUPERSEDED by the March 2026 Word
// forms and their item mapping in official-forms.core.ts. Filling an official form is blocked until that
// mapping is approved and its source is confirmed; nothing here can produce a filled official form.
import { officialFormUseBlocker, type OfficialKey } from "./official-forms.core";

export type OfficialFormKey = OfficialKey;
export const OLD_PDF_MAPPING_SUPERSEDED = "The old PDF field mapping is superseded by the March 2026 official Word forms and can't be used.";

/** Always returns a reason while any official form is unapproved; the old PDF mapping never fills a form. */
export function officialFillBlocker(key: OfficialFormKey): string {
  return officialFormUseBlocker(key) ?? OLD_PDF_MAPPING_SUPERSEDED;
}

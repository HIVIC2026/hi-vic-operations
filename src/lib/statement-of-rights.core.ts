// The ESC "Consumer Statement of Rights – VEU program" (v1.2, 1 May 2024), the ESC's 2-page PDF, cleaned (see below), embedded byte for byte.
// Source: https://www.esc.vic.gov.au/sites/default/files/documents/PBL%20-%20Consumer%20Statement%20of%20Rights%20%E2%80%93%20VEU%20program%20-%20v%201.2%20-%2020240501.pdf
// (supplied by Jo, 2 Nov 2026; original docs/esc-forms/veu-statement-of-rights.pdf, sha256 6af6ff4d…df6e, kept untouched).
// Cleaned on Jo's instruction 3 Nov 2026: the hidden template placeholder "xx" on page 1 was removed, nothing else
// (scripts/clean-statement-of-rights.py → docs/esc-forms/veu-statement-of-rights-clean.pdf, sha256 1b131870…28144a1).
// Bundled with `bun scripts/embed-statement-of-rights.ts` → `statement-of-rights.data.ts`. null = not on file.
import { STATEMENT_OF_RIGHTS_PDF } from "./statement-of-rights.data";
import { looksLikePdf } from "./product-warranty.core";

export const STATEMENT_OF_RIGHTS_PATH = "docs/esc-forms/veu-statement-of-rights-clean.pdf";
export const STATEMENT_OF_RIGHTS_FILENAME = "VEU-Statement-of-rights.pdf";

/** The real ESC PDF bytes, or null when it is not on file (or not a PDF). */
export function statementOfRightsPdf(): Uint8Array | null {
  if (!STATEMENT_OF_RIGHTS_PDF) return null;
  const bytes = new Uint8Array(Buffer.from(STATEMENT_OF_RIGHTS_PDF.replace(/^data:application\/pdf;base64,/, ""), "base64"));
  return looksLikePdf(bytes) ? bytes : null;
}

// Decision 371(b) (Jo, 25 Oct 2026): format checks on the Victorian electrical licence and REC numbers typed at
// onboarding. PURE. Deliberately lenient (shape only, never a claim that the number is real or current): spaces, dashes
// and dots are ignored, a "REC" prefix is optional, and a licence may carry a one- or two-letter class prefix (A12345).
// Whether the number is on the Energy Safe Victoria register is a separate lookup (esv-register.*) and the office still
// gives the final Approve.

const squash = (v: string | null | undefined) => String(v ?? "").toUpperCase().replace(/[\s\-.\/]/g, "");

/** Licence: optional 1–2 letter class prefix + 3–7 digits (e.g. "A12345", "A 123456"). */
export const LICENCE_NUMBER_PATTERN = /^[A-Z]{0,2}\d{3,7}$/;
/** REC: optional "REC" prefix + 3–6 digits (e.g. "REC 12345", "12345"). */
export const REC_NUMBER_PATTERN = /^(REC)?\d{3,6}$/;

export const LICENCE_FORMAT_MESSAGE = "That doesn't look like a Victorian electrical licence number (a letter then digits, e.g. A12345). Check it and type it again.";
export const REC_FORMAT_MESSAGE = "That doesn't look like a REC number (digits, e.g. REC 12345). Check it and type it again.";

export const normaliseLicenceNumber = (v: string | null | undefined) => squash(v);
export const normaliseRecNumber = (v: string | null | undefined) => squash(v).replace(/^REC/, "");

/** Null when blank (the "required" rule is separate) or well-formed; otherwise the plain-words problem. */
export function licenceNumberProblem(v: string | null | undefined): string | null {
  const s = squash(v);
  if (!s) return null;
  return LICENCE_NUMBER_PATTERN.test(s) ? null : LICENCE_FORMAT_MESSAGE;
}
export function recNumberProblem(v: string | null | undefined): string | null {
  const s = squash(v);
  if (!s) return null;
  return REC_NUMBER_PATTERN.test(s) ? null : REC_FORMAT_MESSAGE;
}

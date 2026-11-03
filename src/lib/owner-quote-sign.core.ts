export const OWNER_EMAIL_DOCUMENT_CONSENT = 'I agree to receive my documents by email.';
/** Quote page (touchpoint #33 + Q8): tick 1 (accept + 18+/owner + documents by email), tick 2 (30-day rule), typed name. */
export function quoteSittingBlockers(i: { tick1: boolean; tick2: boolean; typedName: string }): string[] {
 return [
  ...(i.tick1 ? [] : ['Please accept the quote, agreement and payment terms.']),
  ...(i.tick2 ? [] : ['Please confirm you understand the 30-day rule.']),
  ...(i.typedName.trim().length >= 2 ? [] : ['Please type your full name to sign.']),
 ];
}

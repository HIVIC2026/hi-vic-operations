import { ownerDeclarationBlockers, type OwnerDeclarations } from "./consent.core";
export const OWNER_EMAIL_DOCUMENT_CONSENT = "I agree to receive my documents by email.";
export function quoteSittingBlockers(i: { ownerTick: boolean; declarations: OwnerDeclarations }): string[] {
  return [...(i.ownerTick ? [] : ["Please accept the quote, agreement and payment terms."]), ...ownerDeclarationBlockers(i.declarations)];
}
export const quoteSittingDocuments = () => ["quote_acceptance", "customer_agreement", "payment_terms", "esc_consent"] as const;
// What accepting a quote records besides the gate signatures: the owner's typed name, Chris Lowe's counter-signature
// (the same moment, so the acceptance is fully signed) and the documents-by-email consent (clause 7, tick 1). PURE.
import { P2 } from "./owner-pages.core";

export const AP_COUNTERSIGNER = { name: "Chris Lowe", role: "Director", phone: "0416 252 406", email: "info@homeinsulationvictoria.com.au" } as const;
export const ACCEPTANCE_COUNTERSIGNED_EVENT = "acceptance_countersigned";
export const DOCUMENTS_BY_EMAIL_CONSENT_EVENT = "owner_documents_by_email_consent";

export const tidyTypedName = (s: string) => s.trim().replace(/\s+/g, " ");

export function acceptanceSignatureRecord(i: { quoteId: string; version: number; typedName: string; signedAt: string }) {
  return {
    countersigned: {
      quote_id: i.quoteId, version: i.version, owner_typed_name: tidyTypedName(i.typedName),
      signed_at: i.signedAt, countersigner: AP_COUNTERSIGNER, at: i.signedAt,
    },
    documentsConsent: { quote_id: i.quoteId, version: i.version, wording: P2.tick1, at: i.signedAt },
  };
}

// Which documents have been approved to move to the website-look PDF kit (pdf-look.*). A flag is flipped to true ONLY after
// Jo approves that document's sample (docs/approved-samples/2026-11-02/). PURE.
export type PdfLookKey = "signedAcceptance" | "receipts" | "taxInvoice" | "veecForm" | "officialFormPdf" | "escConsent";

export const PDF_LOOK_APPROVED: Record<PdfLookKey, boolean> = {
  signedAcceptance: false,
  receipts: false,
  taxInvoice: false,
  veecForm: false,
  officialFormPdf: false,
  escConsent: false,
};

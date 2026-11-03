// Which documents have been approved to move to the website-look PDF kit (pdf-look.*). A flag is flipped to true ONLY after
// Jo approves that document's sample (docs/approved-samples/2026-11-02/). PURE.
export type PdfLookKey = "signedAcceptance" | "receipts" | "taxInvoice" | "veecForm" | "officialFormPdf" | "escConsent" | "swms";

export const PDF_LOOK_APPROVED: Record<PdfLookKey, boolean> = {
  signedAcceptance: false,
  receipts: false,
  taxInvoice: false,
  veecForm: false,
  officialFormPdf: false,
  escConsent: false,
  /** Part 7 Task 2: the SWMS in the website look (swms-sample.pdf); off = the WorkSafe landscape layout stays. */
  swms: false,
};

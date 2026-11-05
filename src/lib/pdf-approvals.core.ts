// Which documents have been approved to move to the website-look PDF kit (pdf-look.*). A flag is flipped to true ONLY after
// Jo approves that document's sample (docs/approved-samples/2026-11-02/). PURE.
export type PdfLookKey = "signedAcceptance" | "receipts" | "taxInvoice" | "veecForm" | "officialFormPdf" | "escConsent" | "swms";

export const PDF_LOOK_APPROVED: Record<PdfLookKey, boolean> = {
  signedAcceptance: true, // ON 5 Nov 2026 (Jo: all designed templates on)
  receipts: true, // ON 5 Nov 2026
  taxInvoice: true, // ON 5 Nov 2026
  veecForm: true, // ON 5 Nov 2026
  officialFormPdf: false,
  escConsent: true, // ON 5 Nov 2026
  /** Part 7 Task 2: the SWMS in the website look (swms-sample.pdf); off = the WorkSafe landscape layout stays. */
  swms: true, // ON at go-live 5 Nov 2026 with SWMS_NOV2_WORDING_ON
};

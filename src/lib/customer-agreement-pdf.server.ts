// Customer Agreement + payment terms PDF in the website look: the stored template body, filled, parsed, rendered.
import { fillAgreement, parseAgreement, type AgreementFacts } from "./customer-agreement.core";
import type { PdfBlock, PdfLayoutReport } from "./pdf-look.core";
import { renderPdf } from "./pdf-look.server";

export const PAYMENT_TERMS_BLOCK_ID = "payment-terms";

/** A value with " | " or a line break would be read as markup by parseAgreement, so it stops the document. */
function assertSafeFacts(facts: AgreementFacts): void {
  for (const [k, v] of Object.entries(facts)) {
    if (typeof v === "string" && (v.includes(" | ") || v.includes("\\n") || /[\r\n]/.test(v))) {
      throw new Error(`Agreement detail "${k}" must not contain " | " or a line break`);
    }
  }
}

export async function customerAgreementPdf(
  t: { version: string; body: string },
  facts: AgreementFacts,
): Promise<{ bytes: Uint8Array; layout: PdfLayoutReport; fileName: string }> {
  assertSafeFacts(facts);
  const blocks: PdfBlock[] = parseAgreement(fillAgreement(t.body, facts, t.version));
  // The first header after the page break is the payment terms page.
  const br = blocks.findIndex((b) => b.kind === "pageBreak");
  const head = br < 0 ? undefined : blocks.slice(br + 1).find((b) => b.kind === "header");
  if (head) head.id = PAYMENT_TERMS_BLOCK_ID;
  const { bytes, layout } = await renderPdf({ title: "Customer Agreement and payment terms", blocks });
  return { bytes, layout, fileName: `Customer-Agreement-and-payment-terms-v${t.version}.pdf` };
}

// Customer Agreement + payment terms PDF in the website look: the stored template body, filled, parsed, rendered.
import { applyKeptInsulation, applyPiesaAmount, applyUpgradesLineB, fillAgreement, parseAgreement, type AgreementFacts } from "./customer-agreement.core";
import type { PdfBlock, PdfLayoutReport } from "./pdf-look.core";
import { renderPdf } from "./pdf-look.server";

export const PAYMENT_TERMS_BLOCK_ID = "payment-terms";

/** Lead-ins the approved sample prints in bold. The stored body stays plain; a line that starts with one gets it in bold. */
export const AGREEMENT_BOLD_LEADS: readonly string[] = [
  "Electrical safety check (PIESA):", "Electrical upgrades (only if needed):", "Install:", "The 30-day rule:", "Cooling-off:",
  "If your home isn't eligible:", "The insulation:", "The workmanship:", "$349 electrical safety check:", "50% deposit:" /* signed v1.4 copies */, "10% deposit:" /* signed v1.3 copies */,
  "Now:", "Before your install:", "After your install:", "$349:", "Deposit:" /* payment terms refunds; v1.5 section 8 too */,
];
/** Jo 4 Nov 2026 21:25: the two "$349…" lead-ins carry the quote's own PIESA amount after `applyPiesaAmount`, so they match by shape. */
const AMOUNT_LEADS = [/^(\$[\d,]+(?:\.\d{2})? electrical safety check:) /, /^(\$[\d,]+(?:\.\d{2})?:) /];
const leadOf = (line: string) => AGREEMENT_BOLD_LEADS.find((l) => line.startsWith(`${l} `)) ?? AMOUNT_LEADS.map((re) => line.match(re)?.[1]).find((m): m is string => !!m);

function boldLeads(blocks: PdfBlock[]): void {
  for (const b of blocks) {
    if (b.kind === "section") boldLeads(b.children);
    else if (b.kind === "para") {
      const l = leadOf(b.text);
      if (l) { b.lead = l; b.text = b.text.slice(l.length + 1); }
    } else if (b.kind === "bullets") {
      const leads = b.items.map((t) => leadOf(t) ?? "");
      if (leads.some(Boolean)) { b.leads = leads; b.items = b.items.map((t, i) => (leads[i] ? t.slice(leads[i]!.length + 1) : t)); }
    }
  }
}

/** A value with " | " or a line break would be read as markup by parseAgreement, so it stops the document. */
function assertSafeFacts(facts: AgreementFacts): void {
  for (const [k, v] of Object.entries(facts)) {
    if (typeof v === "string" && (v.includes(" | ") || v.includes("\\n") || /[\r\n]/.test(v))) {
      throw new Error(`Agreement detail "${k}" must not contain " | " or a line break`);
    }
  }
}

/** Jo 4 Nov 2026 16:10: `keptInsulation` = the Ready Check says the old insulation stays → section 1 carries the approved
 *  notice instead of the removal bullet. Off/absent = the approved v1.3 body byte for byte. */
export type AgreementRenderOptions = { keptInsulation?: boolean };

/** The filled, parsed agreement blocks (bold lead-ins set, payment terms header tagged). Shared with the signed acceptance PDF. */
export function agreementBlocks(t: { version: string; body: string }, facts: AgreementFacts, opts: AgreementRenderOptions = {}): PdfBlock[] {
  assertSafeFacts(facts);
  // Jo 4 Nov 2026 (21:05 / 21:25): section 2 = wording B and every PIESA "$349" = the quote's own amount, on every agreement;
  // a Home Insulation Victoria lead ($349) renders byte for byte as before apart from section 2.
  const body = applyPiesaAmount(applyUpgradesLineB(opts.keptInsulation ? applyKeptInsulation(t.body) : t.body), facts.safety_check);
  const blocks: PdfBlock[] = parseAgreement(fillAgreement(body, facts, t.version));
  boldLeads(blocks);
  // The first header after the page break is the payment terms page.
  const br = blocks.findIndex((b) => b.kind === "pageBreak");
  const head = br < 0 ? undefined : blocks.slice(br + 1).find((b) => b.kind === "header");
  if (head) head.id = PAYMENT_TERMS_BLOCK_ID;
  return blocks;
}

export async function customerAgreementPdf(
  t: { version: string; body: string },
  facts: AgreementFacts,
  opts: AgreementRenderOptions = {},
): Promise<{ bytes: Uint8Array; layout: PdfLayoutReport; fileName: string }> {
  const { bytes, layout } = await renderPdf({ title: "Customer Agreement and payment terms", blocks: agreementBlocks(t, facts, opts) });
  return { bytes, layout, fileName: `Customer-Agreement-and-payment-terms-v${t.version}.pdf` };
}

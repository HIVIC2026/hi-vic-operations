// Tax invoice wording and maths (ESC Ceiling Insulation Activity Guide v1.2, Table 4). PURE (no pdf-lib, no database).
// GST is one eleventh of the FULL price before the VEEC rebate (accountant, decision 391); nothing is guessed: a missing fact
// returns `{ held }`.
import { aud } from "./payments.core";

/** GST inside a GST-inclusive price (one eleventh), rounded half up to the cent. */
export const gstOnFullPriceCents = (priceBeforeRebateCents: number) => Math.round(priceBeforeRebateCents / 11);

export type TaxInvoiceFacts = {
  invoiceNumber: string | null; invoiceDate: string; /** Printed in the heading; omitted when unknown. */ jobNumber?: string | null;
  ownerName: string; installAddress: string; installerName: string; installedOn: string;
  /** "{brand} {model} · R{value} · {m²} m² · supplied and installed"; null while the installed product is unconfirmed. */
  productLine: string | null; productCents: number; piesaCents: number;
  /** Extra price lines before the rebate (a later part adds "Home Insulation Victoria fee $349" for installers' own customers). */
  extraLines?: { label: string; cents: number }[];
  rebateCents: number; payments: { label: string; paidOn: string; cents: number }[];
};
export type TaxInvoiceModel = {
  rows: { label: string; amount: string }[]; priceBeforeRebate: string; rebate: string; payable: string; gstLine: string; balance: string;
  payments: { label: string; amount: string }[];
};

export const PIESA_LINE_LABEL = "Electrical safety check (PIESA)";
export const REBATE_LABEL = "Victorian Energy Upgrades rebate (price reduction)";
/** The contracting business as printed on the tax invoice (name, ABN, address, Accredited Person number). */
export const BUSINESS_NAME_LINE = "DC Construction Solutions Pty Ltd trading as Home Insulation Victoria · ABN 44 671 613 979 · 1/33 Altree Court, Phillip ACT 2606 · VEU Accredited Person A003654";
const held = (why: string) => ({ held: `Tax invoice not made: ${why}` });

export function taxInvoiceModel(f: TaxInvoiceFacts): { held: string } | TaxInvoiceModel {
  if (!(f.invoiceNumber ?? "").trim()) return held("no invoice number yet");
  if (!(f.productLine ?? "").trim()) return held("installed product not confirmed");
  for (const [v, what] of [[f.ownerName, "the owner's name"], [f.installAddress, "the installation address"], [f.installerName, "who installed it"], [f.installedOn, "the install date"], [f.invoiceDate, "the invoice date"]] as const)
    if (!(v ?? "").trim()) return held(`${what} is missing`);
  const extras = f.extraLines ?? [];
  const price = f.productCents + f.piesaCents + extras.reduce((s, e) => s + e.cents, 0);
  if (!(f.productCents > 0) || !(price > 0)) return held("the price is missing");
  if (f.rebateCents < 0 || f.rebateCents > price) return held("the rebate is more than the price");
  const payable = price - f.rebateCents;
  const paid = f.payments.reduce((s, p) => s + p.cents, 0);
  if (paid > payable) return held("payments are more than the amount payable");
  const left = payable - paid;
  return {
    rows: [
      { label: f.productLine!, amount: aud(f.productCents) },
      ...(f.piesaCents > 0 ? [{ label: PIESA_LINE_LABEL, amount: aud(f.piesaCents) }] : []),
      ...extras.map((e) => ({ label: e.label, amount: aud(e.cents) })),
    ],
    priceBeforeRebate: aud(price),
    rebate: `– ${aud(f.rebateCents)}`,
    payable: aud(payable),
    gstLine: `Includes GST of ${aud(gstOnFullPriceCents(price))}, worked out on the price before the rebate (ATO rule for certificate rebates)`,
    balance: left === 0 ? "$0.00 · Paid in full ✓" : `${aud(left)} still to pay`,
    payments: f.payments.map((p) => ({ label: `${p.label}, ${p.paidOn}`, amount: `– ${aud(p.cents)}` })),
  };
}

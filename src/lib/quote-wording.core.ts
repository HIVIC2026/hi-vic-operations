// Jo 4 Nov 2026 (pack 2 batches 8 and 9, 21:05 / 21:20 / 21:25): owner quote wording shared by the quote page, the quote
// email, the Customer Agreement (render time) and the signed acceptance PDF, so none of them can drift. PURE.

/** Wording B (Jo 21:05): replaces "Not included: electrical upgrades, only if…" on the quote page, the quote email and
 *  Customer Agreement section 2. */
export const UPGRADES_LINE_B = "If the safety check finds electrical work is needed before insulation can go in, your electrician quotes that separately and you pay them direct. Nothing happens without your OK. This price and your rebate don't change.";

/** The quote page's second tick (Jo 21:20), with the quote's own PIESA amount (Jo 21:25): "$349" on a Home Insulation
 *  Victoria lead, the installer's rate (e.g. "$275") on their own customer. */
export const thirtyDayTick = (piesaAmount: string) =>
  `I understand my install must be done within 30 days of my electrical safety check (PIESA). If it isn't, the check has to be done again — and if the delay is mine, I pay for the new check (${piesaAmount}).`;

/** Quote item label as the owner sees it (Jo 21:05): display only — stored quote lines keep their description. */
export const PIESA_ITEM_LABEL_STORED = "Mandatory Pre Insulation Electrical Safety Assessment (PIESA)";
export const PIESA_ITEM_LABEL_SHOWN = "Electrical safety check (PIESA)";
export const piesaItemLabel = (description: string) => description.replace(PIESA_ITEM_LABEL_STORED, PIESA_ITEM_LABEL_SHOWN);

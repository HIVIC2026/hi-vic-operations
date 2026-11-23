/** Mates Rates: a non-VEU, separately priced retail installation. Pure calculations only.
 * A minimum CHARGE is not an instruction to install extra insulation or claim VEECs.
 */
export const NO_GAP_BUSINESS_ID = "f4e375cf-61ea-4864-8618-4f2f3999d0be";
export const NO_GAP_MINIMUM_BILLABLE_M2 = 100;
export const GARAGE_SCOPE_REQUOTE_MESSAGE = "You asked for the garage only. We are preparing a revised quote. Please don't pay the earlier whole-house quote.";
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const positive = (value: number, name: string) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(name + " must be greater than zero.");
  return value;
};
export type MatesRateProduct = "R5" | "R6" | "R7";
export type GarageRetailPricingInput = {
  scope: "garage_only";
  product: MatesRateProduct;
  actualInstallM2: number;
  minimumBillableM2: number;
  ownerRateIncGstPerM2: number;
  installerRateExGstPerM2: number;
  gstRate: number;
  removeM2: number;
};
export type MatesLine = { code: "INSTALL_ACTUAL" | "MINIMUM_JOB_CHARGE"; description: string; quantity: number; unit: "m²"; unitPriceIncGst: number; totalIncGst: number };
export function priceGarageMatesRates(i: GarageRetailPricingInput) {
  if (i.scope !== "garage_only") throw new Error("This pricing route is garage only.");
  const actual = positive(i.actualInstallM2, "Actual installation area");
  const ownerRate = positive(i.ownerRateIncGstPerM2, "Owner price");
  const installerRate = positive(i.installerRateExGstPerM2, "Installer rate");
  if (!Number.isFinite(i.minimumBillableM2) || i.minimumBillableM2 < 0)
    throw new Error("Minimum billable area must not be negative.");
  if (!Number.isFinite(i.gstRate) || i.gstRate < 0 || i.gstRate > 1)
    throw new Error("GST rate is invalid.");
  if (i.removeM2 !== 0) throw new Error("Garage-only no-removal quotes need removal separately reviewed.");
  const billed = Math.max(actual, i.minimumBillableM2);
  const topup = cents(billed - actual);
  const lines: MatesLine[] = [
    { code: "INSTALL_ACTUAL", description: `Supply and install ${i.product} insulation — actual garage area`, quantity: actual, unit: "m²", unitPriceIncGst: ownerRate, totalIncGst: cents(actual * ownerRate) },
  ];
  if (topup > 0) lines.push({ code: "MINIMUM_JOB_CHARGE", description: "Small job minimum charge (no extra m² installed)", quantity: topup, unit: "m²", unitPriceIncGst: ownerRate, totalIncGst: cents(topup * ownerRate) });
  const totalIncGst = cents(lines.reduce((n, l) => n + l.totalIncGst, 0));
  const installerCostIncGst = cents(billed * installerRate * (1 + i.gstRate));
  return {
    scope: i.scope, product: i.product, actualInstallM2: actual, minimumBillableM2: i.minimumBillableM2,
    chargeableM2: billed, lines, totalIncGst, installerCostIncGst,
    indicativeMarginBeforeOtherCostsIncGst: cents(totalIncGst - installerCostIncGst),
    requiresCommercialApproval: totalIncGst <= installerCostIncGst,
    // This is NOT a VEU job. Safety and consumer obligations still require separate review.
    veecCount: 0, veecDiscountIncGst: 0, requestEscNotification: false,
    rebateCopyAllowed: false, mandatoryVeuPiesaCharge: false,
    nonVeuSafetyReviewRequired: true,
  } as const;
}
/** Only block clearly stated garage-only changes, not questions that merely mention a garage. */
export function isGarageOnlyRequoteRequest(body: unknown): boolean {
  if (typeof body !== "string") return false;
  const first = body.split(/(?:\r?\n){2,}(?:from:|on .{4,120} wrote:)|(?:\r?\n)from:/i)[0]?.slice(0, 1800) ?? "";
  return /\bgarage\b/i.test(first)
    && /\b(insulat(?:e|ed|ion|ing)?|ceiling|roof|quote|job)\b/i.test(first)
    && /(?:\b(?:only|just|instead|rather than)\b|\bnot\s+(?:the\s+)?(?:whole|entire)\b|\bdon['’]?t\s+want\s+(?:the\s+)?(?:whole|entire)\b)/i.test(first);
}
/** Scope-change guard, extracted so the owner identity and mail dates can be tested without the database. */
export function garageOnlyScopeChangeAfterQuote(i: {
  quoteSentAt: string;
  ownerEmail: string;
  messages: readonly { sender_text?: string | null; body?: string | null; received_at?: string | null; created_at?: string | null }[];
}): boolean {
  const email = i.ownerEmail.trim().toLowerCase();
  const sentMs = Date.parse(i.quoteSentAt);
  if (!email || !Number.isFinite(sentMs)) throw new Error("A valid owner email and quote send date are required.");
  return i.messages.some((m) => {
    const from = (m.sender_text ?? "").trim().toLowerCase();
    const senderEmail = (/<([^<>\s]+@[^<>\s]+)>/.exec(from)?.[1] ?? from).trim();
    const receivedMs = Date.parse(m.received_at ?? m.created_at ?? "");
    return senderEmail === email && Number.isFinite(receivedMs) && receivedMs > sentMs
      && isGarageOnlyRequoteRequest(m.body);
  });
}
export function installerGarageRequoteMessage(i: { jobNumber: string; actualInstallM2: number; product: MatesRateProduct; minimumBillableM2: number }): string {
  if (!/^HV-\d+$/.test(i.jobNumber) || i.actualInstallM2 <= 0 || i.minimumBillableM2 < 0)
    throw new Error("A valid job and area are required.");
  return `${i.jobNumber}: The owner has changed the scope to the garage ceiling ONLY. Actual installation: ${i.actualInstallM2} m² ${i.product}, no removal. Your minimum chargeable area is ${i.minimumBillableM2} m²; this does NOT increase the area to install. This is a non-VEU retail job with no rebate or VEEC claim. Please confirm you accept this small job, your minimum charge, any access or safety costs, and supply a replacement quote. Do not schedule or proceed under the old whole-house quote.`;
}

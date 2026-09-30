/** Canonical customer-facing Home Insulation Victoria quote language and brand. Pure. */
export const CUSTOMER_BRAND = {
  name: "Home Insulation Victoria",
  logoUrl: "https://homeinsulationvictoria.com.au/home-insulation-victoria-logo.png",
  colors: {
    blue: "#3C51C4",
    green: "#07BF61",
    accent: "#52C875",
    offWhite: "#FBFCFA",
    navy: "#22376B",
    white: "#FFFFFF",
  },
  font: "'Open Sans',Arial,Helvetica,sans-serif",
} as const;

/** Shared visual measurements for every customer-facing estimate surface. */
export const CUSTOMER_VISUAL_SYSTEM = {
  quoteRadiusPx: 20,
  secondaryRadiusPx: 16,
  secondaryPaddingPx: 20,
  actionRadiusPx: 16,
  actionPaddingPx: 16,
  softBlueBorder: "#D4DAF5",
  softGreenBorder: "#BEE8CE",
  paleGreen: "#ECF9F1",
  footer: "#F1F8F3",
} as const;

export const CUSTOMER_CALCULATOR_COPY = "Try another ceiling size and instantly see how your preliminary project total, VEU / VEEC discount and estimated cost after discount could change.";

export const CUSTOMER_QUOTE_LABELS = {
  piesa: "Mandatory Pre-Installation Electrical Safety Assessment (PIESA) + onsite ceiling measure-up",
  insulation: "R5.0 ceiling insulation — supply & install",
  apManagement: "Home Insulation Victoria — Accredited Person Management",
  projectTotal: "Estimated project total",
  discount: "Estimated VEU / VEEC discount",
  finalCost: "YOUR ESTIMATED COST AFTER DISCOUNT",
  payableNow: "$349 payable now for the Measure + PIESA",
  remainingBalance: "Estimated remaining balance",
} as const;

export const CUSTOMER_QUOTE_ORDER = [
  CUSTOMER_QUOTE_LABELS.piesa,
  CUSTOMER_QUOTE_LABELS.insulation,
  CUSTOMER_QUOTE_LABELS.apManagement,
  CUSTOMER_QUOTE_LABELS.projectTotal,
  CUSTOMER_QUOTE_LABELS.discount,
  CUSTOMER_QUOTE_LABELS.finalCost,
  CUSTOMER_QUOTE_LABELS.payableNow,
  CUSTOMER_QUOTE_LABELS.remainingBalance,
] as const;

export const CUSTOMER_PAYMENT_COPY = {
  included: "Already included in your estimated total — not an extra fee.",
  notAgain: "If you proceed, you do not pay the $349 again.",
  noSilentAdditions: "Nothing additional is simply added without being shown to you first.",
} as const;

export const CUSTOMER_ASSESSMENT_ACTION = {
  cta: "LET’S GET STARTED →",
  paragraphs: [
    "Your $349 assessment payment is already included in your estimated total — it is not an extra fee added on top.",
    "To keep the process simple and cost-effective, we combine your onsite ceiling measure-up and mandatory Pre-Installation Electrical Safety Assessment (PIESA) into one visit, helping minimise the cost, time and inconvenience of arranging multiple appointments.",
    "That single visit lets us confirm the actual eligible ceiling area, existing insulation, access conditions and electrical safety requirements so we can finalise your scope and price.",
    "If the assessment identifies something that wasn’t known beforehand — such as existing insulation that needs removal, difficult access, or electrical work such as downlight upgrades, RCDs or switchboard work — we’ll show you exactly what is required and the revised price before you decide whether to proceed.",
    "Nothing additional is simply added without being shown to you first.",
  ],
} as const;

export const CUSTOMER_WHAT_COULD_CHANGE = {
  heading: "WHAT COULD CHANGE AFTER THE ONSITE ASSESSMENT?",
  items: [
    "Final measured eligible ceiling area",
    "Existing insulation / removal if required",
    "Access difficulty",
    "Electrical rectification if required, including downlights, RCDs or switchboard work",
    "Final VEU / VEEC discount",
    "Final installation price",
  ],
  closing: "Nothing additional is simply added without being shown to you first. If anything changes, we’ll show you the scope and price before you decide whether to proceed.",
} as const;

export const CUSTOMER_EXISTING_INSULATION_NOTE = "Existing insulation: removal MAY be required. It is not included unless shown in the quote. The onsite assessment confirms whether removal is required and, if so, the price before you proceed.";

export function customerQuoteRows(values: { piesa: number; installation: number; apManagement: number }) {
  return [
    { key: "piesa", label: CUSTOMER_QUOTE_LABELS.piesa, amount: values.piesa },
    { key: "insulation", label: CUSTOMER_QUOTE_LABELS.insulation, amount: values.installation },
    { key: "apManagement", label: CUSTOMER_QUOTE_LABELS.apManagement, amount: values.apManagement },
  ] as const;
}
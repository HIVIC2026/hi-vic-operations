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

/** Pre-Ready-Check preliminary estimate labels. No electrical allowance appears before the Ready Check. */
export const CUSTOMER_QUOTE_LABELS = {
  insulation: "R5.0 ceiling insulation — supply & install",
  piesa: "Mandatory Pre-Installation Electrical Safety Assessment (PIESA)",
  apManagement: "Home Insulation Victoria — Accredited Person Management",
  projectTotal: "Estimated project total",
  discount: "Estimated VEU / VEEC discount",
  finalCost: "YOUR ESTIMATED COST AFTER DISCOUNT",
  payableNow: "$99 Home Insulation Ready Check — payable now",
  remainingBalance: "Estimated remaining project balance after Ready Check",
} as const;

export const CUSTOMER_PIESA_NOTE = "Completed later by a licensed electrician, close to installation.";

export const CUSTOMER_QUOTE_ORDER = [
  CUSTOMER_QUOTE_LABELS.insulation,
  CUSTOMER_QUOTE_LABELS.piesa,
  CUSTOMER_QUOTE_LABELS.apManagement,
  CUSTOMER_QUOTE_LABELS.projectTotal,
  CUSTOMER_QUOTE_LABELS.discount,
  CUSTOMER_QUOTE_LABELS.finalCost,
  CUSTOMER_QUOTE_LABELS.payableNow,
  CUSTOMER_QUOTE_LABELS.remainingBalance,
] as const;

export const CUSTOMER_PAYMENT_COPY = {
  credited: "Your $99 Home Insulation Ready Check is credited toward your project if you proceed.",
  notPiesa: "It is not the PIESA.",
  purpose: "The Ready Check gives us the measured site information needed to prepare a more accurate project estimate before you commit to the full upgrade.",
} as const;

export const CUSTOMER_READY_CHECK = {
  name: "Home Insulation Ready Check",
  short: "Ready Check",
  fee: 99,
  cta: "BOOK MY READY CHECK →",
  paragraphs: [
    "Your $99 Home Insulation Ready Check is credited toward your project if you proceed.",
    "One of our insulation partners visits to measure the ceiling space and collect the site information needed to prepare a more accurate project estimate.",
    "The Ready Check is not the mandatory electrical safety assessment. Your PIESA is completed later by a licensed electrician, close to installation.",
    "If the Ready Check identifies something that wasn’t known beforehand — such as existing insulation that needs removal or difficult access — we’ll show you your measured project estimate before you decide whether to proceed.",
  ],
} as const;

/** Concise email invitation; the secure confirmation page carries the full service explanation. */
export const CUSTOMER_READY_CHECK_EMAIL_ACTION = {
  eyebrow: "NEXT STEP",
  heading: "BOOK YOUR HOME INSULATION READY CHECK",
  sentence: "For $99, we’ll arrange your onsite Ready Check so we can measure your ceiling and prepare a more accurate project estimate.",
  credit: "The $99 is credited toward your project if you proceed.",
  helper: "See exactly what’s included on the next page.",
} as const;

/** Back-compat alias used by renderers: the only next paid step is the Ready Check. */
export const CUSTOMER_ASSESSMENT_ACTION = { cta: CUSTOMER_READY_CHECK.cta, paragraphs: CUSTOMER_READY_CHECK.paragraphs } as const;

export const CUSTOMER_WHAT_COULD_CHANGE = {
  heading: "WHAT COULD CHANGE MY ESTIMATE?",
  intro: "Your preliminary estimate is based on the ceiling size and information we have now. Your measured project estimate may change once we’ve inspected the property.",
  items: [
    { lead: "Ceiling size", copy: "if the measured ceiling area is larger or smaller than the size you entered, your insulation price and VEU / VEEC discount will change accordingly." },
    { lead: "Existing insulation", copy: "if insulation is already present and needs to be removed before new insulation can be installed, removal will be added to the measured project estimate." },
    { lead: "Access", copy: "if the ceiling space is more difficult to access than expected, an access adjustment may apply." },
    { lead: "Electrical rectification", copy: "your later mandatory PIESA is completed by a licensed electrician. If it identifies electrical work that must be completed before insulation can safely proceed, that work will be shown separately." },
  ],
  closing: "If any of these apply, we’ll show you exactly what is required and the updated price before you decide whether to proceed. We will never proceed with additional work or additional costs without first showing you the scope and price and getting your approval.",
  gst: "All prices include GST.",
} as const;

export const CUSTOMER_EXISTING_INSULATION_NOTE = "Existing insulation: removal MAY be required. It is not included unless shown in the quote. Your Ready Check confirms whether removal is required and, if so, the price before you proceed.";

export function customerQuoteRows(values: { piesa: number; installation: number; apManagement: number }) {
  return [
    { key: "insulation", label: CUSTOMER_QUOTE_LABELS.insulation, amount: values.installation },
    { key: "piesa", label: CUSTOMER_QUOTE_LABELS.piesa, amount: values.piesa },
    { key: "apManagement", label: CUSTOMER_QUOTE_LABELS.apManagement, amount: values.apManagement },
  ] as const;
}
/** Canonical deduction display: leading true minus, whole dollars. */
export function discountAmount(value: number) {
  return `−$${Math.round(Math.abs(value)).toLocaleString("en-AU")}`;
}

/** Canonical discount band / final-cost treatment shared by email + React. */
export const CUSTOMER_DISCOUNT_TREATMENT = {
  bandBackground: CUSTOMER_VISUAL_SYSTEM.paleGreen,
  bandBorder: CUSTOMER_VISUAL_SYSTEM.softGreenBorder,
  amountColor: CUSTOMER_BRAND.colors.green,
  finalColor: CUSTOMER_BRAND.colors.blue,
} as const;

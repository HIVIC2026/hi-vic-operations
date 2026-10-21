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

export const CUSTOMER_CALCULATOR_COPY = "Use this calculator to compare how a different Victorian property address or ceiling size could change your estimated project total, VEU / VEEC discount and estimated cost after discount.";

/** Pre-Ready-Check preliminary estimate labels. No electrical allowance appears before the Ready Check. */
export const CUSTOMER_QUOTE_LABELS = {
  insulation: "R5.0 ceiling insulation — supply & install",
  piesa: "Mandatory Pre-Installation Electrical Safety Assessment (PIESA)",
  apManagement: "Home Insulation Victoria — Accredited Person Management",
  projectTotal: "Estimated project total",
  discount: "Estimated VEU / VEEC discount",
  finalCost: "YOUR ESTIMATED COST AFTER DISCOUNT",
  payableNow: "Ready Check — free",
} as const;

export const CUSTOMER_PIESA_NOTE = "Completed later by a licensed electrician, close to installation.";

export const CUSTOMER_QUOTE_ORDER = [
  CUSTOMER_QUOTE_LABELS.piesa,
  CUSTOMER_QUOTE_LABELS.insulation,
  CUSTOMER_QUOTE_LABELS.apManagement,
  CUSTOMER_QUOTE_LABELS.projectTotal,
  CUSTOMER_QUOTE_LABELS.discount,
  CUSTOMER_QUOTE_LABELS.finalCost,
] as const;

export const CUSTOMER_PAYMENT_COPY = {
  credited: "Your Ready Check is free.",
  notPiesa: "It is not the PIESA.",
  purpose: "The Ready Check gives us the measured site information needed to prepare a more accurate project estimate before you commit to the full upgrade.",
} as const;

export const CUSTOMER_READY_CHECK = {
  name: "Ready Check",
  short: "Ready Check",
  fee: 0,
  cta: "BOOK MY READY CHECK →",
  paragraphs: [
    "Your Ready Check is free.",
    "One of our insulation partners visits to measure the ceiling space and collect the eligibility evidence needed to prepare a more accurate project estimate.",
    "The Ready Check is not the mandatory Pre Insulation Electrical Safety Assessment (PIESA). Your PIESA is completed later by a licensed electrician, close to installation.",
    "If the Ready Check identifies something that wasn’t known beforehand — such as existing insulation that needs removal or difficult access — we’ll show you your measured project estimate before you decide whether to proceed.",
  ],
} as const;

/** Concise email invitation; the secure confirmation page carries the full service explanation. */
export const CUSTOMER_READY_CHECK_EMAIL_ACTION = {
  eyebrow: "NEXT STEP",
  heading: "BOOK YOUR HOME INSULATION READY CHECK",
  sentence: "Your free Ready Check confirms the ceiling measurements and eligibility details needed to progress your preliminary estimate.",
  credit: "There is no charge for the Ready Check.",
  helper: "See exactly what’s included on the next page.",
} as const;

/** Back-compat alias used by renderers for the free Ready Check action. */
export const CUSTOMER_ASSESSMENT_ACTION = { cta: CUSTOMER_READY_CHECK.cta, paragraphs: CUSTOMER_READY_CHECK.paragraphs } as const;

export const CUSTOMER_APPROVAL_REASSURANCE = "We will never proceed with additional work or additional costs without first showing you the scope and price and getting your approval." as const;

export const CUSTOMER_WHAT_COULD_CHANGE: { heading: string; intro: string; items: readonly { lead: string; copy: string }[]; closing: string; gst: string } = {
  heading: "WHAT COULD CHANGE MY ESTIMATE?",
  intro: "This estimate is based on the information currently available. The final scope and price may change after we confirm the measured ceiling size, existing insulation and any required removal, ceiling access conditions, and any electrical fixes identified through the mandatory Pre-Installation Electrical Safety Assessment (PIESA).",
  items: [],
  closing: CUSTOMER_APPROVAL_REASSURANCE,
  gst: "All prices include GST.",
};

export const CUSTOMER_EXISTING_INSULATION_NOTE = "Existing insulation: removal MAY be required. It is not included unless shown in the quote. Your Ready Check confirms whether removal is required and, if so, the price before you proceed.";

export function customerQuoteRows(values: { piesa: number; installation: number; apManagement: number }) {
  return [
    { key: "piesa", label: CUSTOMER_QUOTE_LABELS.piesa, amount: values.piesa },
    { key: "insulation", label: CUSTOMER_QUOTE_LABELS.insulation, amount: values.installation },
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

/** Exact shared approval reassurance (Ready Check, measured estimate, PIESA stage). */
export const CUSTOMER_LIKELY_HERO = {
  heading: "YOU'RE LIKELY ELIGIBLE",
  intro: "Based on the information provided, your property appears likely to qualify for a VEU / VEEC discount on eligible ceiling insulation work.",
  next: "Your preliminary estimate is below. The next step is to book your Ready Check so we can confirm the property details required to progress your quote.",
} as const;

export const CUSTOMER_INELIGIBLE_COPY = {
  heading: "UNFORTUNATELY, THIS PROPERTY DOESN'T APPEAR TO BE ELIGIBLE AT THIS STAGE",
  intro: "Based on the information we have, this is because:",
  reviewHeading: "IS SOMETHING NOT RIGHT?",
  review: "If any of the information you entered was incorrect, you can review and update your answers. We will reassess the result using the corrected information.",
  cta: "REVIEW MY RESULT →",
} as const;


/** Onsite-outcome hero: one heading, one subheading, dynamic reasons. */
export const CUSTOMER_ONSITE_HERO = {
  heading: "IT'S LOOKING GOOD SO FAR",
  subheading: (count: number) => (count === 1 ? "WE JUST NEED TO CHECK ONE THING ONSITE:" : "WE JUST NEED TO CHECK A COUPLE OF THINGS ONSITE:"),
  transition: "While these items still need to be checked, the preliminary estimate below shows what the project may cost based on the information currently available.",
} as const;

export const CUSTOMER_READY_CHECK_PAGE = {
  eyebrow: "NEXT STEP",
  heading: "BOOK YOUR HOME INSULATION READY CHECK",
  intro: "We’ll arrange a free onsite Ready Check so an insulation installer can measure your ceiling and collect the eligibility evidence needed for your measured project estimate.",
  cardTitle: "FREE HOME INSULATION READY CHECK",
  credit: "No payment is required.",
  whatHappensHeading: "What happens",
  whatHappens: [
    "An insulation installer attends your property",
    "Your ceiling area is measured",
    "Existing insulation, removal and access are checked",
    "Eligibility evidence and site photos are collected",
  ],
  notPiesa: "This is not the mandatory PIESA. Your PIESA is completed later by a licensed electrician, close to installation.",
  acceptance: "I request the free Ready Check. I understand the installer will measure my ceiling and check eligibility, and it is not the PIESA.",
} as const;

export const CUSTOMER_MEASURED_QUOTE = {
  eyebrow: "YOUR READY CHECK IS COMPLETE",
  heading: "YOUR MEASURED PROJECT ESTIMATE",
  subcopy: "Your Ready Check is complete. We’ve used the measured ceiling area and site information to update your project estimate.",
  labels: {
    removal: "Existing insulation removal",
    access: "Access adjustment",
    allowance: "Preliminary electrical allowance",
    readyCheckCredit: "Ready Check — free",
    finalCost: "YOUR ESTIMATED COST AFTER DISCOUNT",
  },
  allowanceNote: "Preliminary — confirmed by your licensed electrician at the PIESA.",
  stillChangeHeading: "WHAT COULD STILL CHANGE?",
  stillChange: [
    "Your formal PIESA may confirm electrical fixes that is different from the preliminary electrical allowance.",
    "If the confirmed PIESA amount is lower, we’ll reduce your project price by the difference.",
    "If it is higher, we’ll show you the variation for your approval before anything proceeds.",
  ],
} as const;

export const CUSTOMER_PIESA_STAGE = {
  heading: "ELECTRICAL SAFETY CHECK",
  before: "Your mandatory PIESA is the next step before installation.",
  after: "Your PIESA is complete.",
  performedBy: "Your PIESA is completed by a licensed electrician, close to installation.",
  requiredHeading: "ELECTRICAL WORK REQUIRED BEFORE INSTALLATION",
  noneHeading: "NO ELECTRICAL ELECTRICAL FIXES REQUIRED",
  noneCopy: "Your PIESA is complete and your installation can proceed to scheduling.",
  compare: { preliminary: "Preliminary electrical allowance", confirmed: "Confirmed PIESA amount", difference: "Difference" },
  higher: "The confirmed electrical work is higher than your preliminary allowance. Please review and approve the variation before anything proceeds.",
  same: "The confirmed electrical work matches your preliminary allowance. No change to your project price and no approval is needed.",
  lower: "The confirmed electrical work is lower than your preliminary allowance. We’ll reduce your project price by the difference — no approval is needed.",
  approveCta: "APPROVE ELECTRICAL VARIATION →",
} as const;

/** Customer display order for the measured estimate (optional lines only when > 0). Display only; math lives in measuredQuote(). */
export function measuredCustomerRows(v: { piesa: number; installation: number; removal: number; access: number; allowance: number; apManagement: number }) {
  const L = CUSTOMER_MEASURED_QUOTE.labels;
  return [
    { key: "piesa", label: CUSTOMER_QUOTE_LABELS.piesa, amount: v.piesa, note: null as string | null },
    { key: "insulation", label: CUSTOMER_QUOTE_LABELS.insulation, amount: v.installation, note: null },
    ...(v.removal > 0 ? [{ key: "removal", label: L.removal, amount: v.removal, note: null }] : []),
    ...(v.access > 0 ? [{ key: "access", label: L.access, amount: v.access, note: null }] : []),
    ...(v.allowance > 0 ? [{ key: "allowance", label: L.allowance, amount: v.allowance, note: CUSTOMER_MEASURED_QUOTE.allowanceNote }] : []),
    { key: "apManagement", label: CUSTOMER_QUOTE_LABELS.apManagement, amount: v.apManagement, note: null },
  ];
}

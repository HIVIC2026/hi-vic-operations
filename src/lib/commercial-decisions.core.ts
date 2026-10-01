/**
 * Commercial decisions C01–C04 — recorded exactly as Jo decided them on 2 Oct 2026.
 * This module is a record and a display source only. It never prices a job, never decides a
 * stage and never unlocks an external action; the rules it describes live in the modules named
 * in `enforcedBy`.
 */
export type CommercialDecision = {
  code: "C01" | "C02" | "C03" | "C04";
  question: string;
  decided: string;
  decidedAt: string;
  enforcedBy: string;
  status: "decided";
};

export const COMMERCIAL_DECISIONS: readonly CommercialDecision[] = [
  {
    code: "C01",
    question: "One combined $349 fee, or separate $349 PIESA and Accredited Person fees?",
    decided: "Two separate fees and two separate lines. Each appears in its own row on the quote and invoice; they are never merged into one combined charge.",
    decidedAt: "2026-10-02",
    enforcedBy: "readycheck.core.ts (MEASURED_QUOTE_LABELS, measuredQuote), installer-invoice.tsx",
    status: "decided",
  },
  {
    code: "C02",
    question: "Installer-led own-electrician pricing, invoice ownership and Ready Check coverage.",
    decided: "The owner is still charged the standard $349 electrical safety assessment while HI VIC pays that electrician their agreed onboarding rate. The customer's invoice is co-branded. What the installer already supplied is matched against the Ready Check list; anything still missing is collected with the PIISA. An installer who has not been on site uploads the job and is given the Ready Check template to fill in. The installer enters their own price to the customer in the quote section — HI VIC does not mark that figure up, it only adds its own Accredited Person fee and the $349 set electrical assessment fee.",
    decidedAt: "2026-10-02",
    enforcedBy: "installer-led.core.ts, ready-check-template.core.ts, quotes.server.ts, installer-invoice.functions.ts",
    status: "decided",
  },
  {
    code: "C03",
    question: "C03 — no lead fee: should anything be charged for supplying a lead?",
    decided: "No. There is no such charge on any active surface, for our leads or the installer's own customers; historic signed records stay as they are. Wording approved 2 Oct 2026.",
    decidedAt: "2026-10-01",
    enforcedBy: "profit.core.ts, tests/no-lead-fee.test.ts",
    status: "decided",
  },
  {
    code: "C04",
    question: "Who may change the Accredited Person management fee?",
    decided: "Only Jo (the Home Insulation Victoria owner account). No other staff member, and no automation, may change it. The reason stays recorded permanently.",
    decidedAt: "2026-10-02",
    enforcedBy: "ap-fee.core.ts, installer-invoice.functions.ts",
    status: "decided",
  },
] as const;

/** Anything still undecided. Empty while every recorded decision stands. */
export function openCommercialDecisions(): CommercialDecision[] {
  return COMMERCIAL_DECISIONS.filter((d) => d.status !== "decided");
}

/** null while every decision is recorded; a message for the office while any is outstanding. */
export function commercialDecisionBlocker(): string | null {
  const open = openCommercialDecisions();
  return open.length ? `Commercial decision outstanding: ${open.map((d) => d.code).join(", ")}. Ask Jo.` : null;
}

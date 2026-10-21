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
  status: "decided" | "resolved";
  /** Separate, not-yet-applied safeguards. Never affects status. */
  pendingSafeguard?: string;
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
    decided: "The owner is still charged the standard $349 Pre Insulation Electrical Safety Assessment (PIESA) while Home Insulation Victoria pays that electrician their agreed onboarding rate. The customer's invoice is co-branded. What the installer already supplied is matched against the Ready Check list; anything still missing is collected with the PIISA. An installer who has not been on site uploads the job and is given the Ready Check template to fill in. The installer enters their own price to the customer in the quote section — Home Insulation Victoria does not mark that figure up, it only adds its own Accredited Person fee and the $349 set electrical assessment fee.",
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
    decided: "Only Jo (info@homeinsulationvictoria.com.au) may change it, with a non-blank reason, audited, and only before the customer accepts the quote. Once accepted it is permanently locked for everyone. No post-acceptance reconfirmation flow.",
    decidedAt: "2026-10-02",
    enforcedBy: "ap-fee.core.ts (applyApFeeChange), installer-invoice.functions.ts; tests/ap-fee-lock.test.ts",
    status: "resolved",
    pendingSafeguard: "Database safeguard 0078 tested in a throwaway copy only; not applied to the live database.",
  },
] as const;

/** Anything still undecided. Empty while every recorded decision stands. */
export function openCommercialDecisions(): CommercialDecision[] {
  return COMMERCIAL_DECISIONS.filter((d) => d.status !== "decided" && d.status !== "resolved");
}

/** null while every decision is recorded; a message for the office while any is outstanding. */
export function commercialDecisionBlocker(): string | null {
  const open = openCommercialDecisions();
  return open.length ? `Commercial decision outstanding: ${open.map((d) => d.code).join(", ")}. Ask Jo.` : null;
}

// Full-journey test: the step list, the expected maths and the result shape. Pure, shared by the
// browser runner (e2e/journey) and the server runner (journey.server.ts). TEST data only.

export const JOURNEY_STEPS = [
  { key: "s1_calculator", label: "1. Public calculator: register and whole-VEEC price" },
  { key: "s2_owner_links", label: "2. Owner email links: Save my spot (double tap), owner calculator, My job" },
  { key: "s3_office_offer", label: "3. Office: Spot saved / Hot leads, offered to TEST installer" },
  { key: "s4_ready_check", label: "4. TEST installer: Ready Check and quote maths" },
  { key: "s5_owner_accept", label: "5. Owner: accepts quote and paperwork" },
  { key: "s6_electrician", label: "6. TEST electrician: Pre Insulation Electrical Safety Assessment (PIESA) (all clear, and with fixes), certificate" },
  { key: "s7_install", label: "7. Installer: install booking (deadline rules), install day, evidence" },
  { key: "s8_ap_payout", label: "8. Office: AP sign-off, payout Coming in 7 days" },
  { key: "s9_visibility", label: "9. Who sees what (prices, owner details, Money)" },
  { key: "s10_allowlist", label: "10. Nothing sent outside the allowlist" },
] as const;
export type JourneyStepKey = (typeof JOURNEY_STEPS)[number]["key"];

export type StepResult = { key: JourneyStepKey; label: string; passed: boolean; checks: { name: string; ok: boolean; detail?: string }[]; error?: string; simulated?: string[]; screenshots?: string[] };
export type JourneyResult = { passed: boolean; failingStep: string | null; failingReason: string | null; steps: StepResult[] };

/** Whole-VEEC customer maths (v2): install $/m² + PIESA + AP fee − whole VEECs × value, never below the minimum. */
export function expectedEstimate(areaM2: number, veecs: number, s = { perM2: 30, piesa: 349, ap: 349, veecValue: 70, minimum: 200 }) {
  const install = Math.round(areaM2 * s.perM2 * 100) / 100;
  const gross = install + s.piesa + s.ap;
  const wholeVeecs = Math.floor(veecs);
  const discount = Math.min(wholeVeecs * s.veecValue, Math.max(0, gross - s.minimum));
  return { install, gross, discount, pay: gross - discount, wholeVeecs };
}

/** Money-looking text a trade (electrician) screen must never contain beyond their own rate. */
export function customerPriceLeaks(text: string, allowed: number[] = []): string[] {
  const found = [...text.matchAll(/\$\s?([\d,]+(?:\.\d{2})?)/g)].map((m) => Number(m[1]!.replace(/,/g, "")));
  return found.filter((n) => !allowed.includes(n)).map((n) => `$${n}`);
}

/** Every recipient a run produced must be on the allowlist or on the TEST domain (which never delivers). */
export function recipientsOutsideAllowlist(recipients: string[], allow: string[] = ["jolowexo@hotmail.com", "+61477511901"]) {
  return recipients.filter((r) => { const v = r.trim().toLowerCase(); return v && !allow.includes(v) && !v.endsWith("@hivic-test.example"); });
}

export function summarise(steps: StepResult[]): JourneyResult {
  const bad = steps.find((s) => !s.passed) ?? null;
  const reason = bad ? (bad.error ?? bad.checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ""}`).join("; ")) : null;
  return { passed: steps.length === JOURNEY_STEPS.length && !bad, failingStep: bad?.label ?? (steps.length < JOURNEY_STEPS.length ? "incomplete run" : null), failingReason: reason, steps };
}

export function publishVerdict(r: JourneyResult): string {
  return r.passed ? "OK TO PUBLISH (journey passed)" : `DON'T PUBLISH — ${r.failingStep}: ${r.failingReason ?? "failed"}`;
}

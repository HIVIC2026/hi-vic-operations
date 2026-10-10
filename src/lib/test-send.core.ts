// Safe test sending (Jo as a fake tradie). Pure rules, no I/O.
// The test sender may ONLY ever reach Jo's own phone/email, and only for TEST jobs or TEST partners.
// This is independent of (and in addition to) the global customer comms switch, which stays OFF.

export const TEST_ALLOWLIST = {
  sms: ["+61477511901"] as const,
  email: ["jolowexo@hotmail.com", "jo@actpropertyinspections.com.au"] as const,
};

/** 04xx / 614xx / +614xx -> +614xxxxxxxx. Anything else returns null. */
export function normaliseAuMobile(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/[^\d+]/g, "");
  const m = d.match(/^(?:\+?61|0)(4\d{8})$/);
  return m ? `+61${m[1]}` : null;
}

export const normaliseEmail = (raw: string | null | undefined) => (raw ?? "").trim().toLowerCase();

export type TestSendInput = {
  channel: "sms" | "email";
  to: string | null | undefined;
  /** jobs.source when the message is about a job; null for partner-only messages (welcome). */
  jobSource: string | null;
  /** True only for businesses marked as TEST partners. */
  partnerIsTest: boolean;
};

/** null = allowed; otherwise the plain reason it was blocked. Fails closed. */
export function testSendBlocker(x: TestSendInput): string | null {
  const to = x.channel === "sms" ? normaliseAuMobile(x.to) : normaliseEmail(x.to);
  if (!to) return "No valid recipient";
  const list: readonly string[] = x.channel === "sms" ? TEST_ALLOWLIST.sms : TEST_ALLOWLIST.email;
  if (!list.includes(to)) return "Recipient is not on the test allowlist";
  if (!x.partnerIsTest) return "Only TEST partners can receive test messages";
  if (x.jobSource !== null && x.jobSource !== "qa_test") return "Only TEST jobs can trigger test messages";
  return null;
}

export const TEST_PARTNER_MARK = "[TEST PARTNER]";
export const isTestPartner = (b: { onboarding_notes?: string | null } | null | undefined) => !!b?.onboarding_notes?.includes(TEST_PARTNER_MARK);

/** Real jobs never go to TEST partners; TEST (qa_test) jobs only go to TEST partners. */
export const partnerAllowedForJob = (b: { onboarding_notes?: string | null } | null | undefined, jobSource: string | null | undefined) => (jobSource === "qa_test") === isTestPartner(b);
/** Why this job may not be offered to this trade (null = allowed). Unknown trade → refused. */
export function offerPairBlocker(b: { onboarding_notes?: string | null } | null | undefined, jobSource: string | null | undefined): string | null {
  if (!b) return "trade not found";
  if (jobSource === "qa_test" && !isTestPartner(b)) return "a TEST job can only be offered to TEST partners";
  if (jobSource !== "qa_test" && isTestPartner(b)) return "a real job can never be offered to a TEST partner";
  return null;
}

// Slice 1 guard checks: failed-message visibility, server-side role guards, source-of-truth config and retired-term scan.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { failedMessageAttention } from "../src/lib/readycheck-flow.core";
import { WORKFLOW_DECISIONS, depositPctFor } from "../src/config/workflow-decisions";
import { scan } from "../scripts/scan-retired-terms";

describe("failed messages appear in Needs attention", () => {
  const base = {
    jobId: "TEST-J",
    recipient: "TEST Owner",
    channel: "sms" as const,
    template: "ready_check_reminder_24h",
  };
  test("failed, undelivered and held-for-follow-up rows surface with who/what/why", () => {
    const items = failedMessageAttention([
      { ...base, id: "1", outcome: "failed", reason: "Invalid number" },
      { ...base, id: "2", outcome: "undelivered" },
      { ...base, id: "3", outcome: "suppressed", followUp: true },
      { ...base, id: "4", outcome: "delivered" },
      { ...base, id: "5", outcome: "sent" },
      { ...base, id: "6", outcome: "suppressed" },
    ]);
    expect(items.map((i) => i.messageId)).toEqual(["1", "2", "3"]);
    expect(items[0]).toMatchObject({
      code: "failed_message",
      who: "TEST Owner",
      what: "sms · ready_check_reminder_24h",
      why: "Invalid number",
    });
    expect(items[2]!.why).toBe("Held: sending is switched off");
  });
});

// Reviewed exceptions: elevated access scoped by token hash or by the caller's own business membership.
const REVIEWED: Record<string, string> = {
  getWorkerInvite: "token-hash scoped invite lookup",
  submitWorkerInvite: "token-hash scoped invite submission",
  listMyWorkers: "scoped to caller's own business via myBusinesses()",
  createBatchOwnerEligibilityLinks: "authorise(): office, or member of every job's originating installer company",
  jobOwnerEligibility: "reads through RLS (context.supabase); elevated text is the following token-hash resolve() helper",
  ownerPaperworkFn: "secure owner link token, usable link only, own job",
  ownerReconfirmVariationFn: "verified owner code session; variation must belong to the session job",
  ownerSignConsentFn: "verified owner code session scoped to its own job",
  getMyIntakeJob: "requireSupplyingInstaller(): can_access_job + installer role + member of the job's originating business",
  getMyIntakeProgress: "intakeProgressGate(): can_access_job BEFORE the job is read (STEP 73); intake jobs then requireSupplyingInstaller(): can_access_job + installer role + member of the job's originating business",
  myTeamCompliance: "scoped to caller's own business memberships (read through RLS) or their own worker row",
};
describe("server-side role guards", () => {
  test("every server function using the elevated client checks the caller's role (or is a reviewed exception)", () => {
    const dir = new URL("../src/lib/", import.meta.url).pathname;
    const unguarded: string[] = [];
    let total = 0;
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".functions.ts"))) {
      const parts = readFileSync(dir + f, "utf8")
        .split(/(?=export const \w+ = createServerFn)/)
        .slice(1);
      for (const p of parts) {
        total++;
        const name = /export const (\w+)/.exec(p)![1]!;
        const elevated = p.includes("client.server") || p.includes("supabaseAdmin");
        const guarded =
          /require\w*(Admin|Office|Role|Staff|Member)\w*\(|has_role|is_admin|isAdmin/.test(p);
        if (elevated && !guarded && !REVIEWED[name]) unguarded.push(`${f}:${name}`);
      }
    }
    expect(total).toBeGreaterThan(200);
    expect(unguarded).toEqual([]);
  });
});

describe("source of truth", () => {
  test("deposit tiers and retired 50% rule", () => {
    expect(depositPctFor(19_999.99)).toBe(10);
    expect(depositPctFor(20_000)).toBe(5);
    expect(WORKFLOW_DECISIONS.payment.retired).toContain("50% deposit gate");
    expect(WORKFLOW_DECISIONS.eligibility.rules.missingOrConflictingEvidence).toBe("needs_review");
    expect(WORKFLOW_DECISIONS.routes.installer_supplied.leadFee).toBe("none");
  });
  test("no retired brand names in customer-visible files; retired payment wording nowhere in src", () => {
    const visible = scan().filter((h) => h.kind === "customer-visible");
    expect(visible.filter((h) => h.term.startsWith("HI VIC"))).toEqual([]);
    // The payment-option gate replaced the retired half-deposit rule: zero tolerated customer-visible hits.
    expect(visible).toEqual([]);
  });
});

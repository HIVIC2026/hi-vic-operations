// Decision 410 (Jo 27 Oct 2026, replaces 355 for electricians): electricians are paid for the safety check (A3) and the
// fixes (A4) within 7 days of someone in the office approving their completed Mitti form. It never waits for the owner.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ELECTRICIAN_PAY_RULE_LINE, INSTALLER_PAY_WAITING_AP, electricianPayDueAt, electricianPayState, payPill, payState } from "../src/lib/trade-view.core";
import { electricianFormCompleteAt, PAYOUT_FORM_NOT_COMPLETE, type TradePayoutFacts } from "../src/lib/trade-payout-gate.core";
import { approvalKindFor, ELECTRICIAN_FORM_AWAITING_APPROVAL, electricianPayTiming } from "../src/lib/electrician-pay.core";

const A4_DONE = "2026-10-01T02:00:00Z";
const facts = (o: Partial<TradePayoutFacts> = {}): TradePayoutFacts => ({
  piesa: { mittiForm: true, completed: true, evidence: [], completedAt: A4_DONE },
  fixes: { sameVisitOnPiesa: false, outcome: "done", detail: null, completedAt: "2026-10-06T03:00:00Z" },
  install: null, ...o,
});

describe("electricianPayState: 7 days after the office approves the completed Mitti form", () => {
  test("approved → coming 7 days later", () => {
    expect(electricianPayState({ paidAt: null, approvedAt: A4_DONE })).toEqual({ kind: "coming", on: "2026-10-08T02:00:00.000Z" });
    expect(payPill(electricianPayState({ paidAt: null, approvedAt: "2026-10-01T00:00:00Z" })).label).toBe("Coming Thu 8 Oct");
    expect(electricianPayDueAt({ approvedAt: "2026-10-05T00:00:00Z" })).toBe("2026-10-12T00:00:00.000Z");
  });
  test("not approved → being checked; paid wins", () => {
    expect(electricianPayState({ paidAt: null, approvedAt: null })).toEqual({ kind: "checking" });
    expect(electricianPayState({ paidAt: "2026-10-09T00:00:00Z", approvedAt: null })).toEqual({ kind: "paid", on: "2026-10-09T00:00:00Z" });
    expect(electricianPayDueAt({ approvedAt: null })).toBeNull();
  });
  test("installer pay unchanged (AP approval; installer's own customers also wait for payment in full)", () => {
    expect(payState({ paidAt: null, apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: false })).toEqual({ kind: "coming", on: "2026-10-08T00:00:00.000Z" });
    expect(payState({ paidAt: null, apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: true, ownerPaidInFullAt: null })).toEqual({ kind: "checking" });
  });
  test("the electrician Money page says the rule, and never that pay waits for the owner", () => {
    expect(ELECTRICIAN_PAY_RULE_LINE).toBe("Paid within 7 days of us approving your completed Mitti form");
    expect(ELECTRICIAN_PAY_RULE_LINE).not.toMatch(/owner/i);
    expect(readFileSync("src/routes/_authenticated/field.money.tsx", "utf8")).toContain("{ELECTRICIAN_PAY_RULE_LINE}");
  });
});

describe("form complete time (decision 318 gate first)", () => {
  test("safety check = the A3 completion; fixes = the A4 completion; same-visit fixes follow the A3", () => {
    expect(electricianFormCompleteAt("assessment", facts())).toBe(A4_DONE);
    expect(electricianFormCompleteAt("rectification", facts())).toBe("2026-10-06T03:00:00Z");
    expect(electricianFormCompleteAt("rectification", facts({ fixes: { sameVisitOnPiesa: true, outcome: null, detail: null } }))).toBe(A4_DONE);
  });
  test("a held form (not Complete / evidence missing) has no completion time", () => {
    expect(electricianFormCompleteAt("assessment", facts({ piesa: { mittiForm: true, completed: false, evidence: [], completedAt: null } }))).toBeNull();
    expect(electricianFormCompleteAt("assessment", facts({ piesa: { mittiForm: true, completed: true, evidence: ["photo missing"], completedAt: A4_DONE } }))).toBeNull();
    expect(electricianFormCompleteAt("rectification", facts({ fixes: { sameVisitOnPiesa: false, outcome: "open", detail: null } }))).toBeNull();
    expect(PAYOUT_FORM_NOT_COMPLETE.assessment).toContain("A3");
  });
});

describe("timing: office Approve starts the 7 days; the owner's payment is never read", () => {
  const APPROVED = "2026-10-09T05:00:00Z";
  test("complete but not approved → not due, office can Approve, with the approval reason", () => {
    expect(electricianPayTiming("assessment", facts())).toEqual({ formCompleteAt: A4_DONE, approvedAt: null, dueAt: null, waiting: [ELECTRICIAN_FORM_AWAITING_APPROVAL.assessment], approvable: true });
    expect(electricianPayTiming("rectification", facts()).waiting).toEqual(["Waiting for the office to approve the electrical fixes form (A4)"]);
  });
  test("approved → due 7 days after the Approve; each form has its own approval", () => {
    const f = facts({ electricianApprovedAt: { assessment: APPROVED, rectification: null } });
    expect(electricianPayTiming("assessment", f)).toEqual({ formCompleteAt: A4_DONE, approvedAt: APPROVED, dueAt: "2026-10-16T05:00:00.000Z", waiting: [], approvable: false });
    expect(electricianPayTiming("rectification", f).dueAt).toBeNull();
  });
  test("same-visit fixes follow the A3 approval", () => {
    const f = facts({ fixes: { sameVisitOnPiesa: true, outcome: null, detail: null }, electricianApprovedAt: { assessment: APPROVED, rectification: null } });
    expect(approvalKindFor("rectification", f)).toBe("assessment");
    expect(electricianPayTiming("rectification", f).dueAt).toBe("2026-10-16T05:00:00.000Z");
  });
  test("a form that isn't complete is never approvable, even with an old approval", () => {
    const f = facts({ piesa: { mittiForm: true, completed: false, evidence: [], completedAt: null }, electricianApprovedAt: { assessment: APPROVED, rectification: null } });
    expect(electricianPayTiming("assessment", f)).toEqual({ formCompleteAt: null, approvedAt: null, dueAt: null, waiting: [], approvable: false });
    expect(electricianPayTiming("assessment", undefined)).toEqual({ formCompleteAt: null, approvedAt: null, dueAt: null, waiting: [], approvable: false });
  });
});

describe("wiring", () => {
  test("trade Money, office Payouts, the trade status line and Mark paid all use the decision-410 rule", () => {
    expect(readFileSync("src/lib/trade-view.server.ts", "utf8")).toContain("electricianPayState({ paidAt: pe?.created_at ?? null, approvedAt: et.approvedAt })");
    expect(readFileSync("src/lib/office-money.server.ts", "utf8")).toContain("electricianPayTiming(l.kind, vf)");
    expect(readFileSync("src/lib/job-status.server.ts", "utf8")).toContain("electricianPayState({ paidAt: paidOut, approvedAt: t.approvedAt })");
    expect(readFileSync("src/lib/office.functions.ts", "utf8")).toContain("electricianPayTiming(data.kind, (await payoutGateFacts([data.jobId])).get(data.jobId)).waiting");
    for (const f of ["src/lib/trade-view.server.ts", "src/lib/office-money.server.ts", "src/lib/job-status.server.ts", "src/lib/office.functions.ts"])
      expect(readFileSync(f, "utf8")).not.toContain("ownerElectricalStepsPaidAt");
  });
  test("trade Money held lines carry the 410 approval wait and the F19 installer wait — the same reasons the office shows", () => {
    const tv = readFileSync("src/lib/trade-view.server.ts", "utf8");
    expect(tv).toContain("...(et?.waiting ?? [])");
    expect(tv).toContain("installerPayHeldReasons({ installerSupplied:");
    expect(ELECTRICIAN_FORM_AWAITING_APPROVAL.rectification).toContain("A4");
    expect(INSTALLER_PAY_WAITING_AP).toContain("Final check");
  });
  test("office Approve: admin only, one shared write, refused while the form gate holds it, the button on held rows", () => {
    const fn = readFileSync("src/lib/office.functions.ts", "utf8");
    const at = fn.indexOf("export const approveElectricianForm");
    // requireOfficeJob falls through to requireAdmin for everyone who is not the isolated TEST office login.
    expect(fn.slice(at, at + 600)).toContain("await requireOfficeJob(context.supabase, data.jobId)");
    expect(fn.slice(at, at + 600)).toContain("recordElectricianFormApproval(data.jobId, data.kind, context.userId, ");
    const w = readFileSync("src/lib/electrician-form-approval.server.ts", "utf8");
    expect(w).toContain("if (!gate || blockers.length) throw");
    expect(w).toContain("if (t.approvedAt) return { approvedAt: t.approvedAt, already: true }");
    expect(readFileSync("src/routes/_authenticated/admin.money.tsx", "utf8")).toContain("data-approve-electrician-form");
    expect(readFileSync("src/lib/trade-payout-gate.server.ts", "utf8")).toContain("q.eq(\"event_type\", ELECTRICIAN_FORM_APPROVED_EVENT)");
  });
});

// Decision 318 (Jo 25 Oct 2026): no complete Mitti form, no payment. Pure gate + presentation + source pins (no database).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PAYOUT_FORM_NOT_COMPLETE, payoutHeldLine, tradePayoutBlockers, type TradePayoutFacts } from "../src/lib/trade-payout-gate.core";
import { groupPayouts, type PayoutLine } from "../src/lib/office-money.core";
import { NO_FORM_NO_PAY, heldPayPill } from "../src/lib/trade-view.core";
import { FIXES_FORM_COMPLETED_EVENT, FIXES_FORM_CREATED_EVENT, FIXES_FORM_HELD_EVENT, FIXES_FORM_NOT_DONE_EVENT, fixesFormOutcome } from "../src/lib/fixes-day.core";
import { partnerWelcomeEmail } from "../src/lib/partner-email.core";

const ok: TradePayoutFacts = {
  piesa: { mittiForm: true, completed: true, evidence: [] },
  fixes: { sameVisitOnPiesa: false, outcome: "done", detail: null },
  install: { formCompleted: true, evidence: [] },
};

describe("tradePayoutBlockers: complete form + evidence → payable", () => {
  test("every kind is payable when its Mitti form is Complete and its evidence passes", () => {
    expect(tradePayoutBlockers("assessment", ok)).toEqual([]);
    expect(tradePayoutBlockers("rectification", ok)).toEqual([]);
    expect(tradePayoutBlockers("installation", ok)).toEqual([]);
  });
  test("fixes done on the same visit follow the A4 rule (no A5 form)", () => {
    expect(tradePayoutBlockers("rectification", { ...ok, fixes: { sameVisitOnPiesa: true, outcome: null, detail: null } })).toEqual([]);
    expect(tradePayoutBlockers("rectification", { ...ok, piesa: { mittiForm: true, completed: false, evidence: [] }, fixes: { sameVisitOnPiesa: true, outcome: null, detail: null } })).toEqual([PAYOUT_FORM_NOT_COMPLETE.assessment]);
  });
});

describe("tradePayoutBlockers: not Complete → held with a plain reason", () => {
  test("safety check: not marked Complete, no Mitti form, no facts", () => {
    expect(tradePayoutBlockers("assessment", { ...ok, piesa: { mittiForm: true, completed: false, evidence: [] } })).toEqual(["Mitti safety check form (A4) not marked Complete"]);
    expect(tradePayoutBlockers("assessment", { ...ok, piesa: { mittiForm: false, completed: false, evidence: [] } })).toEqual([PAYOUT_FORM_NOT_COMPLETE.assessment]);
    expect(tradePayoutBlockers("assessment", { ...ok, piesa: null })).toEqual([PAYOUT_FORM_NOT_COMPLETE.assessment]);
  });
  test("fixes: open / held / not done / no form", () => {
    expect(tradePayoutBlockers("rectification", { ...ok, fixes: { sameVisitOnPiesa: false, outcome: "open", detail: null } })).toEqual(["Mitti electrical fixes form (A5) not marked Complete"]);
    expect(tradePayoutBlockers("rectification", { ...ok, fixes: { sameVisitOnPiesa: false, outcome: null, detail: null } })).toEqual([PAYOUT_FORM_NOT_COMPLETE.rectification]);
    expect(tradePayoutBlockers("rectification", { ...ok, fixes: null })).toEqual([PAYOUT_FORM_NOT_COMPLETE.rectification]);
    expect(tradePayoutBlockers("rectification", { ...ok, fixes: { sameVisitOnPiesa: false, outcome: "not_done", detail: "Smoke alarm still to fit" } }))
      .toEqual([PAYOUT_FORM_NOT_COMPLETE.rectification, "Electrical fixes form says the work is not all done: Smoke alarm still to fit"]);
    expect(tradePayoutBlockers("rectification", { ...ok, fixes: { sameVisitOnPiesa: false, outcome: "held", detail: "The fixes form was marked Complete but is missing: Photo of the finished work at the switchboard / in the ceiling (must be geotagged)" } }))
      .toEqual([PAYOUT_FORM_NOT_COMPLETE.rectification, "Electrical fixes form: The fixes form was marked Complete but is missing: Photo of the finished work at the switchboard / in the ceiling (must be geotagged)"]);
  });
  test("install: A3 not Complete", () => {
    expect(tradePayoutBlockers("installation", { ...ok, install: { formCompleted: false, evidence: [] } })).toEqual(["Mitti install day form (A3) not marked Complete"]);
    expect(tradePayoutBlockers("installation", { ...ok, install: null })).toEqual([PAYOUT_FORM_NOT_COMPLETE.installation]);
  });
});

describe("tradePayoutBlockers: missing geotag → held", () => {
  test("safety check Complete but a photo has no location", () => {
    expect(tradePayoutBlockers("assessment", { ...ok, piesa: { mittiForm: true, completed: false, evidence: ["Switchboard photo must be geotagged"] } }))
      .toEqual([PAYOUT_FORM_NOT_COMPLETE.assessment, "Safety check form: Switchboard photo must be geotagged"]);
    // Even a stale `completed` flag never pays while the stored evidence still has a blocker.
    expect(tradePayoutBlockers("assessment", { ...ok, piesa: { mittiForm: true, completed: true, evidence: ["Hazard photos must be geotagged (1 without a location)"] } }))
      .toEqual(["Safety check form: Hazard photos must be geotagged (1 without a location)"]);
  });
  test("install Complete but a zone video is not geotagged", () => {
    expect(tradePayoutBlockers("installation", { ...ok, install: { formCompleted: true, evidence: ["Install evidence: Area 1 after-install video must be geotagged"] } }))
      .toEqual(["Install day form: Area 1 after-install video must be geotagged"]);
  });
  test("one short held line", () => {
    expect(payoutHeldLine([])).toBe("");
    expect(payoutHeldLine(["A"])).toBe("Held: A");
    expect(payoutHeldLine(["A", "B", "C"])).toBe("Held: A and 2 more");
  });
});

describe("office Money › Payouts: held lines are never payable", () => {
  const line = (o: Partial<PayoutLine>): PayoutLine => ({ jobId: "j1", jobNumber: "HV-1", businessId: "b1", business: "Spark", kind: "assessment", amountEx: 200, dueAt: "2026-11-01T00:00:00Z", paidAt: null, ...o });
  test("a held line leaves the Mark paid groups and carries its reasons; paid lines ignore the hold", () => {
    const g = groupPayouts([
      line({}),
      line({ jobId: "j2", jobNumber: "HV-2", held: [PAYOUT_FORM_NOT_COMPLETE.assessment] }),
      line({ jobId: "j3", jobNumber: "HV-3", paidAt: "2026-10-20T00:00:00Z", held: ["ignored once paid"] }),
    ]);
    expect(g.due).toHaveLength(1);
    expect(g.due[0]!.jobs.map((j) => j.jobNumber)).toEqual(["HV-1"]);
    expect(g.held).toEqual([{ jobId: "j2", jobNumber: "HV-2", businessId: "b1", business: "Spark", trade: "electrician", kind: "assessment", amountEx: 200, dueAt: "2026-11-01T00:00:00Z", reasons: [PAYOUT_FORM_NOT_COMPLETE.assessment] }]);
    expect(g.paid.map((p) => p.jobs[0]!.jobNumber)).toEqual(["HV-3"]);
  });
});

describe("fixesFormOutcome (shared by the fixes card and the payout gate)", () => {
  const ev = (event_type: string, created_at: string, details: Record<string, unknown>) => ({ event_type, created_at, summary: null, details });
  test("latest form's outcome, newest first", () => {
    expect(fixesFormOutcome([]).outcome).toBeNull();
    expect(fixesFormOutcome([ev(FIXES_FORM_CREATED_EVENT, "2026-10-25T01:00:00Z", { audit_id: "a1" })]).outcome).toBe("open");
    expect(fixesFormOutcome([ev(FIXES_FORM_COMPLETED_EVENT, "2026-10-25T02:00:00Z", { audit_id: "a1" }), ev(FIXES_FORM_CREATED_EVENT, "2026-10-25T01:00:00Z", { audit_id: "a1" })]).outcome).toBe("done");
    expect(fixesFormOutcome([ev(FIXES_FORM_NOT_DONE_EVENT, "2026-10-25T02:00:00Z", { audit_id: "a1", text: "x" }), ev(FIXES_FORM_CREATED_EVENT, "2026-10-25T01:00:00Z", { audit_id: "a1" })])).toMatchObject({ outcome: "not_done", detail: "x" });
    // A completion for an OLDER form does not pay the new one.
    expect(fixesFormOutcome([ev(FIXES_FORM_CREATED_EVENT, "2026-10-26T01:00:00Z", { audit_id: "a2" }), ev(FIXES_FORM_COMPLETED_EVENT, "2026-10-25T02:00:00Z", { audit_id: "a1" }), ev(FIXES_FORM_CREATED_EVENT, "2026-10-25T01:00:00Z", { audit_id: "a1" })]).outcome).toBe("open");
    expect(fixesFormOutcome([ev(FIXES_FORM_HELD_EVENT, "2026-10-25T01:00:00Z", { reason: "not set up" })])).toMatchObject({ outcome: "held", detail: "not set up" });
  });
});

describe("Jo's approved wording, the same everywhere", () => {
  test("constants are verbatim", () => {
    expect(NO_FORM_NO_PAY.headline).toBe("No complete form, no payment");
    expect(NO_FORM_NO_PAY.body).toBe("We pay for the safety check, electrical fixes and installs only when the Mitti form is 100% finished and you've pressed Complete. Every photo and video must be taken in Mitti on site so it is geotagged. If anything is missing, we can't claim the rebate, so we can't pay you until it's fixed.");
    expect(NO_FORM_NO_PAY.offerLine).toBe("Paid only when the Mitti form is complete with every geotagged photo.");
    expect(NO_FORM_NO_PAY.mittiInstruction).toBe("Paid only when this form is 100% complete and you press Complete. Take every photo in Mitti on site so it's geotagged.");
  });
  test("held pay pill", () => {
    expect(heldPayPill([])).toBeNull();
    expect(heldPayPill(["A"])).toEqual({ label: "Held", tone: "blush", why: "A" });
    expect(heldPayPill(["A", "B"])!.why).toBe("A (and 1 more)");
  });
  const src = (f: string) => readFileSync(f, "utf8");
  test("the shared piece renders the constant (never a retyped copy)", () => {
    const kit = src("src/components/trade/installer-kit.tsx");
    expect(kit).toContain("NO_FORM_NO_PAY.headline");
    expect(kit).toContain("NO_FORM_NO_PAY.body");
    expect(kit).toContain("NO_FORM_NO_PAY.offerLine");
  });
  test("trade job page (installer + electrician), today's job, Money, offers and the guide all show it", () => {
    const job = src("src/routes/_authenticated/field.$jobId.tsx");
    expect(job.match(/<NoFormNoPay\b/g)?.length).toBeGreaterThanOrEqual(2); // installer NEXT panel + electrician PIESA/fixes
    expect(src("src/routes/_authenticated/field.day.$jobId.tsx")).toContain("<NoFormNoPay");
    const money = src("src/routes/_authenticated/field.money.tsx");
    expect(money).toContain("<NoFormNoPay />");
    expect(money.indexOf("<NoFormNoPay />")).toBeLessThan(money.indexOf('<Group title="Jobs">'));
    expect(money).toContain("heldPayPill(r.held)");
    expect(src("src/routes/_authenticated/field.offer.$offerId.tsx").match(/<NoFormNoPay line\b/g)?.length).toBe(2);
    expect(src("src/routes/_authenticated/field.guide.tsx")).toContain("<NoFormNoPay />");
  });
  test("welcome email appends the paragraph (html + text) after the approved content", () => {
    for (const trade of ["installer", "electrician"] as const) {
      const m = partnerWelcomeEmail({ firstName: "Sam", businessName: "Reinsulate", trade, email: "sam@x.test", link: "https://example.test/l" });
      expect(m.text).toContain(`${NO_FORM_NO_PAY.headline}. ${NO_FORM_NO_PAY.body}`);
      expect(m.html).toContain(NO_FORM_NO_PAY.headline);
      expect(m.html.indexOf(NO_FORM_NO_PAY.headline)).toBeGreaterThan(m.html.indexOf("Read the 2-minute guide"));
    }
  });
  test("office: Payouts shows Held and Mark paid refuses a held payout", () => {
    expect(src("src/routes/_authenticated/admin.money.tsx")).toContain("q.data.held.map");
    const fns = src("src/lib/office.functions.ts");
    const at = fns.indexOf("export const markPayoutPaid");
    expect(fns.slice(at, fns.indexOf("payout_marked_paid", at))).toContain("payoutBlockersFor");
    expect(src("src/lib/office-money.server.ts")).toContain("tradePayoutBlockers(l.kind, f)");
    expect(src("src/lib/trade-view.server.ts")).toContain("tradePayoutBlockers(");
  });
  test("A3 / A4 / A5 Mitti prompts carry the first-page instruction line", () => {
    for (const f of ["docs/MITTI_INSTALL_FORM_FIX_PROMPT.md", "docs/MITTI_PIESA_CHATGPT_PROMPT.md", "docs/MITTI_PIESA_BUILD_PROMPT.md", "docs/MITTI_FIXES_FORM_PROMPT.md"]) {
      const d = src(f);
      const g1 = d.indexOf("## Group 1: Job\n");
      expect(g1, f).toBeGreaterThan(-1);
      expect(d.slice(g1).split("\n")[1], f).toContain(`\`${NO_FORM_NO_PAY.mittiInstruction}\``);
    }
  });
});

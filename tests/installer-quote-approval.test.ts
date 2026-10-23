import { describe, it, expect } from "bun:test";
import {
  approvalState, approveButtonLabel, canApprove, approvalCardLine, reminderDue, quoteFingerprint, formFingerprint, splitQuotesToCheck,
  WAITING_ON_INSTALLER, INSTALLER_QUOTE_REMINDER_ENABLED, readApprovalEvents,
} from "../src/lib/installer-quote-approval.core";
import { automaticQuoteSendingAllowed } from "../src/lib/office-quote-review.core";

const lines = [{ code: "INS", description: "Ceiling insulation", quantity: 120, unit_price_inc_gst: 35, line_total_inc_gst: 4200 }, { code: "HIV", description: "HIV fee", quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349 }];
const q = { subtotal_inc_gst: 4549, veec_discount_inc_gst: 1200, customer_total_inc_gst: 3349 };
const qfp = quoteFingerprint(q, lines), ffp = formFingerprint([{ label: "Area", value: "120" }]);
const approved = [{ at: "2026-10-23T05:00:00Z", quoteId: "q1", quoteFp: qfp, formFp: ffp, by: "deep" }];

describe("Jo 23 Oct: installer approves the owner quote", () => {
  it("1. a new draft is the installer's task: 'You: check the quote'", () => {
    expect(approvalState({ quoteId: "q1", quoteFp: qfp, formFp: ffp, approvals: [] })).toBe("needs_check");
    expect(approvalCardLine("needs_check", false)).toBe("You: check the quote");
  });
  it("3. button label by lead type and disabled while anything is missing", () => {
    expect(approveButtonLabel("installer_sourced")).toBe("Quote is ready to send");
    expect(approveButtonLabel("hivic_sourced")).toBe("Measurements are final");
    expect(canApprove(["Missing: ceiling area"])).toBe(false);
    expect(canApprove([WAITING_ON_INSTALLER])).toBe(true);
    expect(canApprove([])).toBe(true);
  });
  it("3. approval records who/when", () => {
    const ev = readApprovalEvents([{ created_at: "2026-10-23T05:00:00Z", actor_id: "deep", details: { quote_id: "q1", quote_fp: qfp, form_fp: ffp } }]);
    expect(ev[0]).toEqual(approved[0]!);
    expect(approvalState({ quoteId: "q1", quoteFp: qfp, formFp: ffp, approvals: ev })).toBe("approved");
  });
  it("4. only approved quotes are on the office list; others wait greyed", () => {
    const s = splitQuotesToCheck([{ quoteId: "a", waitingOnInstaller: false }, { quoteId: "b", waitingOnInstaller: true }, { quoteId: null, waitingOnInstaller: false }]);
    expect(s.ready.map((r) => r.quoteId)).toEqual(["a"]);
    expect(s.waiting.map((r) => r.quoteId)).toEqual(["b", null]);
    expect(approvalCardLine("approved", false)).toBe("Waiting on office: checking your quote");
    expect(approvalCardLine("approved", true)).toBe("Waiting on owner: to accept the quote");
  });
  it("5. a changed Mitti form cancels approval", () => {
    expect(approvalState({ quoteId: "q1", quoteFp: qfp, formFp: formFingerprint([{ label: "Area", value: "130" }]), approvals: approved })).toBe("form_changed");
    expect(approvalCardLine("form_changed", false)).toBe("You: check the quote");
    expect(approvalState({ quoteId: "q2", quoteFp: qfp, formFp: ffp, approvals: approved })).toBe("needs_check");
  });
  it("6. office Adjust sends it back to the installer", () => {
    const adjusted = quoteFingerprint({ ...q, customer_total_inc_gst: 3200 }, lines);
    expect(adjusted).not.toBe(qfp);
    expect(approvalState({ quoteId: "q1", quoteFp: adjusted, formFp: ffp, approvals: approved, adjustedAfterApproval: true })).toBe("office_changed");
    expect(approvalCardLine("office_changed", false)).toBe("You: office changed the quote — please check");
    expect(approvalState({ quoteId: "q1", quoteFp: qfp, formFp: ffp, approvals: approved, adjustedAfterApproval: true })).toBe("office_changed");
  });
  it("7. one reminder per version after 48h, switched off by default", () => {
    expect(INSTALLER_QUOTE_REMINDER_ENABLED).toBe(false);
    const base = { readyAt: "2026-10-20T00:00:00Z", state: "needs_check" as const, sent: false, remindedFps: [] as string[], quoteFp: qfp };
    expect(reminderDue({ ...base, now: Date.parse("2026-10-22T01:00:00Z") })).toBe(false);
    expect(reminderDue({ ...base, now: Date.parse("2026-10-21T23:00:00Z"), enabled: true })).toBe(false);
    expect(reminderDue({ ...base, now: Date.parse("2026-10-22T00:00:00Z"), enabled: true })).toBe(true);
    expect(reminderDue({ ...base, remindedFps: [qfp], now: Date.parse("2026-10-23T00:00:00Z"), enabled: true })).toBe(false);
    expect(reminderDue({ ...base, state: "approved", now: Date.parse("2026-10-23T00:00:00Z"), enabled: true })).toBe(false);
  });
  it("8. quotes never go to owners automatically from the draft step (A1 auto-send on Complete is switched off)", () => {
    expect(automaticQuoteSendingAllowed()).toBe(false);
    expect(automaticQuoteSendingAllowed("A1")).toBe(false);
  });
});

it("Jo 23 Oct: an accepted quote never still reads 'to accept the quote'", () => {
  expect(approvalCardLine("approved", true)).toBe("Waiting on owner: to accept the quote");
  expect(approvalCardLine("approved", true, true)).toBe("Waiting on owner: quote accepted – waiting for owner's payment");
});

it("Jo 24 Oct: installer jobs have no approval step — the card says press Complete, or office checking when held", () => {
  expect(approvalCardLine("approved", false, false, { held: false })).toBe("You: when the Ready Check is finished, press Complete in Mitti — the quote then goes to the owner");
  expect(approvalCardLine("approved", false, false, { held: true })).toBe("Waiting on office: checking your quote");
  expect(approvalCardLine("approved", true, false, { held: false })).toBe("Waiting on owner: to accept the quote");
});

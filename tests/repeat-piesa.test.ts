import { describe, expect, it, test } from "bun:test";
import { chooseRepeatPayerBlocker, installerRepeatDeduction, ownerRepeatView, repeatInvoicePaid, repeatPiesaGateBlocker, repeatPiesaState, REPEAT_ARRANGING_TITLE, REPEAT_PRICE_NOT_SET } from "../src/lib/repeat-piesa.core";
import { fixesFoundLine, needsCandidates } from "../src/lib/office-needs.core";
import { jobNext, FIXES_PAUSED_TITLE } from "../src/lib/installer-screens.core";

const D = "2026-11-20";
const lapsed = repeatPiesaState({ lapsedDeadline: D, choice: null, acceptedAt: null, paidAt: null });
const chose = (payer: "owner" | "installer" | "hivic", price: number | null = 220) => repeatPiesaState({ lapsedDeadline: D, choice: { payer, priceIncGst: price, deadline: D, at: "x" }, acceptedAt: null, paidAt: null });
const accepted = (payer: "owner" | "installer" | "hivic", paid = false) => repeatPiesaState({ lapsedDeadline: D, choice: { payer, priceIncGst: 220, deadline: D, at: "x" }, acceptedAt: "y", paidAt: paid ? "z" : null });

test("lapse waits for the office to choose; owner page never mentions install days", () => {
  expect(lapsed.stage).toBe("choose");
  const v = ownerRepeatView(lapsed)!;
  expect(v.title).toBe("We're arranging the next step");
  expect(`${v.title} ${v.body}`).not.toMatch(/install day/i);
  expect(v.button).toBeNull();
  expect(repeatPiesaGateBlocker(lapsed)).toMatch(/office is choosing/);
});

test("owner-pays is refused while the Repeat safety check price is empty", () => {
  expect(chooseRepeatPayerBlocker(lapsed, "owner", null)).toBe(REPEAT_PRICE_NOT_SET);
  expect(chooseRepeatPayerBlocker(lapsed, "owner", 220)).toBeNull();
  expect(chooseRepeatPayerBlocker(lapsed, "installer", null)).toBeNull();
  expect(chooseRepeatPayerBlocker(chose("hivic"), "owner", 220)).toMatch(/already been chosen/);
});

test("owner page has no repeat card once accepted (and paid if owed) — normal booking area shows", () => {
  expect(ownerRepeatView({ stage: "offer", payer: "owner", priceIncGst: 349, deadline: "2026-10-01" })).toBeNull();
  expect(ownerRepeatView({ stage: "offer", payer: "installer", priceIncGst: 349, deadline: "2026-10-01" })).toBeNull();
  expect(ownerRepeatView({ stage: "choose", payer: null, priceIncGst: null, deadline: "2026-10-01" })!.title).toBe(REPEAT_ARRANGING_TITLE);
  expect(ownerRepeatView({ stage: "owner_accept", payer: "owner", priceIncGst: 349, deadline: "2026-10-01" })!.button).toBe("Accept");
  expect(ownerRepeatView({ stage: "owner_pay", payer: "owner", priceIncGst: 349, deadline: "2026-10-01" })!.body).toContain("Please pay $349 inc GST");
});

test("owner pays: price shown, Accept, then must be paid before booking", () => {
  const v = ownerRepeatView(chose("owner"))!;
  expect(v.title).toBe("A new safety check (PIESA) is needed");
  expect(v.body).toMatch(/30 days since your last check have passed/);
  expect(v.price).toMatch(/\$220 inc GST/);
  expect(v.button).toBe("Accept");
  expect(accepted("owner").stage).toBe("owner_pay");
  expect(repeatPiesaGateBlocker(accepted("owner"))).toMatch(/payment is needed/);
  expect(accepted("owner", true).stage).toBe("offer");
  expect(repeatPiesaGateBlocker(accepted("owner", true))).toBeNull();
});

test("installer or HIVIC pays: no cost to the owner; installer's payout is reduced", () => {
  expect(ownerRepeatView(chose("installer"))!.price).toBe("There's no cost to you for this check.");
  expect(accepted("hivic").stage).toBe("offer");
  expect(installerRepeatDeduction(accepted("installer"))).toBe(220);
  expect(installerRepeatDeduction(accepted("hivic"))).toBe(0);
  expect(installerRepeatDeduction(accepted("owner"))).toBe(0);
});

test("an older choice never carries over to a new lapsed deadline", () => {
  expect(repeatPiesaState({ lapsedDeadline: "2026-12-30", choice: { payer: "hivic", priceIncGst: null, deadline: D, at: "x" }, acceptedAt: null, paidAt: null }).stage).toBe("choose");
});

test("Needs me: one row for the office choice and one for fixes found", () => {
  const base = { jobId: "j", jobNumber: "HV-1", surname: "T", suburb: null };
  const rows = needsCandidates({ ...base, repeatPiesaChoice: { deadline: D, suggested: "owner" }, lapsedWindow: { deadline: D } }, Date.now());
  expect(rows[0]?.kind).toBe("repeat_piesa_choose");
  expect(rows[0]?.line).toMatch(/choose who pays.*suggested: owner/);
  const f = needsCandidates({ ...base, fixesFound: { at: "2026-10-28T00:00:00Z", stage: "rectification_required" } }, Date.now());
  expect(f.filter((r) => r.kind === "piesa_fixes_found")).toHaveLength(1);
  expect(fixesFoundLine("rectification_required")).toBe("Safety check found electrical fixes — waiting on fixes quote/approval");
});

test("installer page says the job is paused while fixes are open, and not after", () => {
  const facts = { channel: "hivic_sourced", stage: "rectification_booked", ownerFirstName: "Sam", formLinked: true, formCompleted: true, quoteLine: null, clearedOn: null } as never;
  expect(jobNext(facts).title).toBe(FIXES_PAUSED_TITLE);
  expect(jobNext({ ...(facts as object), stage: "installation_scheduling", installTurn: "installer_to_offer" } as never).title).not.toBe(FIXES_PAUSED_TITLE);
});

test("installer payout deduction: only installer-pays choices, ex GST", async () => {
  const { repeatDeductionEx } = await import("../src/lib/repeat-piesa.core");
  expect(repeatDeductionEx([{ payer: "installer", price_inc_gst: 220 }], 1.1)).toBe(200);
  expect(repeatDeductionEx([{ payer: "owner", price_inc_gst: 220 }, { payer: "hivic", price_inc_gst: 220 }], 1.1)).toBe(0);
  expect(repeatDeductionEx([{ payer: "installer", price_inc_gst: null }], 1.1)).toBe(0);
});

test("installer page is paused at piesa_complete when the PIESA found fixes and Section C isn't signed", () => {
  const facts = { channel: "hivic_sourced", stage: "piesa_complete", ownerFirstName: "Sam", formLinked: true, formCompleted: true, quoteLine: "Waiting on owner: quote accepted — waiting for owner's payment", clearedOn: null, fixesOpen: true } as never;
  expect(jobNext(facts).title).toBe(FIXES_PAUSED_TITLE);
  expect(jobNext({ ...(facts as object), fixesOpen: false } as never).title).not.toBe(FIXES_PAUSED_TITLE);
});

test("TEST jobs only ever use STRIPE_TEST_SECRET_KEY; real jobs only STRIPE_SECRET_KEY", async () => {
  const { stripeKeyFor } = await import("../src/lib/stripe.server");
  const save = { t: process.env["STRIPE_TEST_SECRET_KEY"], l: process.env["STRIPE_SECRET_KEY"] };
  process.env["STRIPE_SECRET_KEY"] = "sk_live_x"; delete process.env["STRIPE_TEST_SECRET_KEY"];
  expect(stripeKeyFor("qa_test")).toBeNull();
  process.env["STRIPE_TEST_SECRET_KEY"] = "sk_live_wrong";
  expect(stripeKeyFor("qa_test")).toBeNull();
  process.env["STRIPE_TEST_SECRET_KEY"] = "sk_test_ok";
  expect(stripeKeyFor("qa_test")).toBe("sk_test_ok");
  expect(stripeKeyFor("website")).toBe("sk_live_x");
  if (save.t === undefined) delete process.env["STRIPE_TEST_SECRET_KEY"]; else process.env["STRIPE_TEST_SECRET_KEY"] = save.t;
  if (save.l === undefined) delete process.env["STRIPE_SECRET_KEY"]; else process.env["STRIPE_SECRET_KEY"] = save.l;
});

describe("owner-pays repeat safety check on its OWN invoice (batch 3b)", () => {
  const inv = (over: Record<string, unknown> = {}) => ({ kind: "repeat_safety_check", repeat_key: "2026-11-20", total_inc_gst: 349, ...over });
  test("paid only when the current repeat's own invoice is paid in full", () => {
    expect(repeatInvoicePaid({ invoice: inv(), deadline: "2026-11-20", paidCents: 34_900 })).toBe(true);
    expect(repeatInvoicePaid({ invoice: inv(), deadline: "2026-11-20", paidCents: 34_899 })).toBe(false);
  });
  test("money on another invoice, or on an older repeat's invoice, never counts", () => {
    expect(repeatInvoicePaid({ invoice: inv({ kind: "installation", repeat_key: null }), deadline: "2026-11-20", paidCents: 500_000 })).toBe(false);
    expect(repeatInvoicePaid({ invoice: inv({ repeat_key: "reopen:2026-10-25T01:00:00.000Z" }), deadline: "2026-11-20", paidCents: 34_900 })).toBe(false);
    expect(repeatInvoicePaid({ invoice: null, deadline: "2026-11-20", paidCents: 34_900 })).toBe(false);
  });
});

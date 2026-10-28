import { describe, expect, it, test } from "bun:test";
import { chooseRepeatPayerBlocker, installerRepeatDeduction, ownerRepeatView, repeatPiesaGateBlocker, repeatPiesaState, REPEAT_PRICE_NOT_SET } from "../src/lib/repeat-piesa.core";
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

describe("owner-pays repeat PIESA on the ONE Xero invoice (decision 233, Jo 28 Oct)", () => {
  it("counts as paid only once payments grow by the repeat price since acceptance", async () => {
    const { repeatPaidByInvoice } = await import("../src/lib/repeat-piesa.core");
    expect(repeatPaidByInvoice({ paidCents: 34900, paidAtAddCents: 34900, priceCents: 34900 })).toBe(false); // re-applied $349 fee
    expect(repeatPaidByInvoice({ paidCents: 69800, paidAtAddCents: 34900, priceCents: 34900 })).toBe(true);
  });
  it("adds ONE tagged line to the existing invoice, never a new invoice", async () => {
    const core = await import("../src/lib/xero-repairs.core");
    const { repeatLineTag, repeatLineDescription } = await import("../src/lib/repeat-piesa.core");
    const x = { InvoiceID: "inv1", Status: "AUTHORISED", Reference: "Home Insulation Victoria HV-1", Total: 1000, AmountPaid: 0, LineItems: [{ LineItemID: "l1", Description: "Insulation", LineAmount: 1000 }] };
    const tag = repeatLineTag("2026-11-20");
    const d = core.repairsAmendDecision({ enabled: true, repairs: { rectQuoteId: "2026-11-20", amountCents: 34900 }, key: "k", recorded: [], baseTotalCents: 100000, xero: x, tag });
    expect(d.action).toBe("amend");
    const u = core.buildRepairsAmendment({ xero: x, jobNumber: "HV-1", rectQuoteId: "2026-11-20", amountCents: 34900, key: "k", mode: "test", description: repeatLineDescription(x.Reference, "2026-11-20") });
    expect(u.path).toBe("/api.xro/2.0/Invoices/inv1");
    expect(u.body.Invoices[0]!.LineItems).toHaveLength(2);
    expect(u.expectedTotalCents).toBe(134900);
    // Paid invoice → held for the office, not a second invoice.
    expect(core.repairsAmendDecision({ enabled: true, repairs: { rectQuoteId: "2026-11-20", amountCents: 34900 }, key: "k", recorded: [], baseTotalCents: 100000, xero: { ...x, AmountPaid: 349 }, tag }).action).toBe("hold");
  });
});

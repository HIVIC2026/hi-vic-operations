// Review R08 / audit F14: the complete "electrician on site at the start of the install day" exception journey
// (decision 314 follow-up; A3 PIESA → A5 Install day, decision 390 numbering).
//  1. Install coordination clears on `electrician_at_start` only once the FULL accepted onsite electrical (fixes) charge has
//     been received on top of the safety check payment — the generic payment gate (which clears on the $349 alone) is
//     never enough. Exercised through the REAL clearanceFacts / onsiteChargePaidFor / ledger reader against an in-memory
//     backend; `paymentGate` is stood in by the real pure `evaluatePaymentGate` over the same fixture.
//  2. Before work begins on the install day, the electrician's attendance answer AND photo stay compulsory (A5 Q27–Q29 →
//     official p5.electricianPresent + electrician photo), whatever the payment state.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { evaluatePaymentGate } from "../src/lib/payment-gate.core";
import { ONSITE_CHARGE_NOT_PAID, onsiteChargePaid } from "../src/lib/payments.core";
import { FIXES_ONSITE_OPTION, FIXES_WORK_LABEL } from "../src/lib/official-short.core";
import { B1_OPTIONS } from "../src/lib/official-forms.core";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(table: string) {
  const f: ((r: Row) => boolean)[] = [];
  let one = false, head = false;
  const b: Record<string, unknown> = {
    select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return b; },
    eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return b; },
    neq: (c: string, v: unknown) => { f.push((r) => r[c] !== v); return b; },
    in: (c: string, v: unknown[]) => { f.push((r) => v.includes(r[c])); return b; },
    order: () => b, limit: () => b,
    maybeSingle: () => { one = true; return b; },
    then: (res: (v: unknown) => unknown) => {
      const out = (tables[table] ?? []).filter((r) => f.every((x) => x(r)));
      return Promise.resolve(head ? { count: out.length, data: null, error: null } : { data: one ? out[0] ?? null : out, error: null }).then(res);
    },
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
let gateEnabled = true;
// The generic approved payment gate over the same fixture (the real pure rule): clears on the safety check payment.
const genericGate = () => {
  const inv = tables["invoices"]![0]!;
  return evaluatePaymentGate({ enabled: gateEnabled, route: "hiv_lead", currentQuote: { id: "q-install", customer_total_inc_gst: 4000 }, invoice: { quote_id: "q-install", total_inc_gst: inv["total_inc_gst"] as number, total_paid: inv["total_paid"] as number }, plan: null, overrideCount: 0, safetyFeeIncGst: 349 });
};
mock.module("../src/lib/workflow.server", () => ({ paymentGate: async () => genericGate() }));

const { clearanceFacts, onsiteStartClearedFor, onsiteChargePaidFor } = await import("../src/lib/electrical-clearance.server");
const { electricalClearance, installationCoordinationBlocker, installEntryElectricalBlockers, FIXES_NOT_COMPLETED_BLOCKER } = await import("../src/lib/allocation.core");

const JOB = "job-onsite";
let n = 0;
/** Batch 3b: the $349 goes on the installation invoice ("inv-1"), the onsite fixes charge on its own fixes invoice ("inv-fix"). */
function pay(dollars: number, source: "xero" | "stripe" = "xero", invoiceId = "inv-1") {
  n++;
  tables["workflow_events"]!.push({ id: `p${n}`, job_id: JOB, event_type: "owner_payment_recorded", created_at: `2026-10-0${n}T00:00:00Z`, actor_id: null, details: { invoice_id: invoiceId, amount_cents: Math.round(dollars * 100), source, paid_at: `2026-10-0${n}T00:00:00Z`, ...(source === "xero" ? { xero_payment_id: `x${n}` } : { stripe_payment_intent: `pi_${n}` }) } });
  const inv = tables["invoices"]!.find((i) => i["id"] === invoiceId)!;
  inv["total_paid"] = Number(inv["total_paid"]) + dollars; // Xero mirror follows the ledger
}
beforeEach(() => {
  n = 0; gateEnabled = true;
  tables = {
    piesa_records: [{ job_id: JOB, kind: "initial", outcome: "fail", completed_date: "2026-10-02", signed_off_by: "elec-1", is_current: true }],
    quotes: [{ id: "q-fix", job_id: JOB, kind: "rectification", status: "accepted", customer_total_inc_gst: 550, accepted_at: "2026-10-03T00:00:00Z" }],
    rectification_items: [{ id: "ri-1", job_id: JOB }],
    // The A3's ONLY repair tick is "Be on site at the start of the install day" (decision 314).
    assessments: [{ job_id: JOB, mitti_raw_snapshot: [{ label: "Is any electrical repair work needed before insulation can be installed?", value: "Yes" }, { label: FIXES_WORK_LABEL, value: FIXES_ONSITE_OPTION }] }],
    invoices: [{ id: "inv-1", job_id: JOB, kind: "installation", quote_id: "q-install", total_inc_gst: 4000, total_paid: 0, created_at: "2026-10-01T00:00:00Z" },
      { id: "inv-fix", job_id: JOB, kind: "rectification", quote_id: "q-fix", total_inc_gst: 550, total_paid: 0, created_at: "2026-10-03T00:00:00Z" }],
    quote_items: [{ quote_id: "q-install", code: "PIESA", line_total_inc_gst: 349 }],
    workflow_settings: [{ id: 1, safety_check_payment_inc_gst: 349 }],
    workflow_events: [],
  };
});

const cleared = async () => electricalClearance(await clearanceFacts(JOB));

// Part 3 Task 1 (Jo 2 Nov 2026): the electrician quotes and bills the upgrades on EVERY job, so Home Insulation Victoria
// no longer collects an onsite electrical charge. The on-site-only job clears on the PIESA alone (electrician_at_start);
// the R08 money gate is kept behind `electricianBillsUpgrades` (its ledger reader `onsiteChargePaidFor` still works) and
// `fixesPaymentCleared` is no longer read. Part 2 below (attendance evidence) is unchanged.
describe("R08 part 1 (retired by Part 3 Task 1): install clearance no longer waits for an HIV onsite electrical charge", () => {
  test("nothing paid → cleared on electrician_at_start, 30 days from the official PIESA", async () => {
    expect(await cleared()).toMatchObject({ cleared: true, basis: "electrician_at_start", timingDate: "2026-10-02", blocker: null });
    expect(await onsiteStartClearedFor(JOB)).toBe(true);
    expect(installEntryElectricalBlockers({ openRectItems: 1, piesaDate: "2026-10-02", piesaOutcome: "fail", onsiteStartCleared: true })).toEqual([]);
  });
  test("the facts: on-site-only is read without an accepted HIV quote; the fixes payment is never read", async () => {
    const f = await clearanceFacts(JOB);
    expect(f).toMatchObject({ onsiteStartOnly: true, fixesPaymentCleared: false, partnerBilledRectification: true });
    tables["quotes"] = []; // no HIV upgrades quote at all (every new job)
    expect(await clearanceFacts(JOB)).toMatchObject({ onsiteStartOnly: true, rectificationQuoteAccepted: false, partnerBilledRectification: true });
    expect(await cleared()).toMatchObject({ cleared: true, basis: "electrician_at_start" });
  });
  test("the generic payment gate and the payment switch no longer change the clearance", async () => {
    expect(genericGate().cleared).toBe(false);
    expect((await cleared()).cleared).toBe(true);
    gateEnabled = false;
    expect((await cleared()).cleared).toBe(true);
    pay(349); pay(300, "stripe", "inv-fix");
    expect((await cleared()).cleared).toBe(true);
  });
  test("the ledger reader onsiteChargePaidFor still answers correctly (kept for a reversal): part paid → false", async () => {
    pay(349); pay(300, "stripe", "inv-fix");
    expect(await onsiteChargePaidFor(JOB)).toBe(false);
  });
  test("… paid in full → true", async () => {
    pay(349); pay(300, "stripe", "inv-fix"); pay(250, "xero", "inv-fix");
    expect(await onsiteChargePaidFor(JOB)).toBe(true);
  });
  test("… a reversed (voided) Xero payment stops counting", async () => {
    pay(349); pay(550, "xero", "inv-fix");
    tables["workflow_events"]!.push({ id: "r1", job_id: JOB, event_type: "owner_payment_reversed", created_at: "2026-10-09T00:00:00Z", actor_id: null, details: { invoice_id: "inv-fix", amount_cents: 55000, source: "xero", paid_at: "2026-10-02T00:00:00Z", xero_payment_id: "x2" } });
    expect(await onsiteChargePaidFor(JOB)).toBe(false);
  });
  test("no invoice / no accepted charge → the reader fails closed (pure rule unchanged)", async () => {
    tables["invoices"] = [];
    expect(await onsiteChargePaidFor(JOB)).toBe(false);
    expect(onsiteChargePaid({ quoteTotalCents: 400000, safetyCheckCents: 34900, rectTotalCents: 0, paid: { install: 1_000_000, fixes: 1_000_000 } })).toBe(false);
    expect(onsiteChargePaid({ quoteTotalCents: 400000, safetyCheckCents: 34900, rectTotalCents: 55000, paid: { install: 34900, fixes: 54999 } })).toBe(false);
    expect(onsiteChargePaid({ quoteTotalCents: 400000, safetyCheckCents: 34900, rectTotalCents: 55000, paid: { install: 89900, fixes: 0 } })).toBe(false); // fixes money is on its own invoice
    expect(onsiteChargePaid({ quoteTotalCents: 400000, safetyCheckCents: 34900, rectTotalCents: 55000, paid: { install: 34900, fixes: 55000 } })).toBe(true);
  });
});

describe("R08 part 2: attendance evidence stays compulsory before work begins (A5 Install day)", async () => {
  const { a3PrestartBlockers, A3_REQUIREMENT_LABELS } = await import("../src/lib/piisa-a3.core");
  const { electricianAtStartPrefill, piesaPart5Answers, ELECTRICIAN_AT_START_MISSING, INSTALL_DAY_QUESTIONS, INSTALL_DAY_Q, electricianPresentAnswer } = await import("../src/lib/install-day.core");
  const { shortAnswersFromEntries } = await import("../src/lib/official-short.core");
  const a4Short = shortAnswersFromEntries("piesa", [{ label: "Is any electrical repair work needed before insulation can be installed?", value: "Yes" }, { label: FIXES_WORK_LABEL, value: FIXES_ONSITE_OPTION }]);
  // The portal reads the A3 (decision 338): this job needs the electrician at the start, whatever the payment state.
  const ctx = { crewCount: 1, electricianRequiredAtStart: electricianAtStartPrefill({ a4Short, b1: B1_OPTIONS[2] }), existingPlanMatchesInstall: false, generatedFinalPlan: true, installDayForm: true, lifeSupportConsentOnFile: false };
  const elecLines = (answers: Record<string, string>, media: { key: "electrician_photo"; count: number; geotagged: number }[]) =>
    a3PrestartBlockers(answers as never, ctx, media).filter((b) => /electrician/i.test(b));
  const PHOTO = A3_REQUIREMENT_LABELS.electrician_photo;

  test("the A3 makes the electrician compulsory at the start", () => expect(ctx.electricianRequiredAtStart).toBe(true));
  test("the A5 form asks Q27–Q29 in order, stops on 'No' and requires the photo", () => {
    const needed = INSTALL_DAY_QUESTIONS.find((q) => q.label === INSTALL_DAY_Q.electricianNeeded)!;
    const here = INSTALL_DAY_QUESTIONS.find((q) => q.label === INSTALL_DAY_Q.electricianHere)!;
    const photo = INSTALL_DAY_QUESTIONS.find((q) => q.label === INSTALL_DAY_Q.electricianPhoto)!;
    expect(needed.prefill).toBe("electricianAtStart");
    expect(here.stop).toEqual({ when: "No", text: "Stop. Wait for the electrician." });
    expect(photo).toMatchObject({ type: "photo", required: true, showWhen: { n: here.n, is: ["Yes"] } });
    expect(electricianPresentAnswer("Yes", "Yes")).toBe("Yes");
    expect(electricianPresentAnswer("Yes", "No")).toBe("No");
    expect(electricianPresentAnswer("No", null)).toBe("N/A");
  });
  test("not answered / No / N/A (Q27 changed to No) → a pre-start blocker every time, plus the missing photo", () => {
    expect(elecLines({}, [])).toEqual([`${PHOTO}: 0 of 1`, "Electrician attendance: not answered"]);
    expect(elecLines({ "p5.electricianPresent": "No" }, [])).toEqual([`${PHOTO}: 0 of 1`, expect.stringContaining("Get the required electrician onsite")]);
    expect(elecLines({ "p5.electricianPresent": "N/A" }, [])).toEqual([`${PHOTO}: 0 of 1`, expect.stringContaining("N/A is not valid for this job")]);
  });
  test("'here' = Yes without the photo → still blocked; photo without a location → office review", () => {
    expect(elecLines({ "p5.electricianPresent": "Yes" }, [])).toEqual([`${PHOTO}: 0 of 1`]);
    expect(elecLines({ "p5.electricianPresent": "Yes" }, [{ key: "electrician_photo", count: 1, geotagged: 0 }])).toEqual([`${PHOTO}: location not recorded on 1 — office review`]);
  });
  test("'here' = Yes WITH the geotagged photo → the electrician items clear", () => {
    expect(elecLines({ "p5.electricianPresent": "Yes" }, [{ key: "electrician_photo", count: 1, geotagged: 1 }])).toEqual([]);
  });
  test("the PIESA-side official answer needs the same evidence (decision 362)", () => {
    const piesa = { b1: B1_OPTIONS[2], "p6.recessed": "No" };
    expect(piesaPart5Answers(piesa, { electricianHere: "No", electricianPhoto: false }).missing).toContain(ELECTRICIAN_AT_START_MISSING);
    expect(piesaPart5Answers(piesa, { electricianHere: "Yes", electricianPhoto: false }).missing).toContain(ELECTRICIAN_AT_START_MISSING);
    expect(piesaPart5Answers(piesa, null).missing).toContain(ELECTRICIAN_AT_START_MISSING);
    const ok = piesaPart5Answers(piesa, { electricianHere: "Yes", electricianPhoto: true });
    expect(ok.missing).toEqual([]);
    expect(ok.answers["p5.electricianPresent"]).toBe("Yes");
  });
});

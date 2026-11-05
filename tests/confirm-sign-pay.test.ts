// Part 4 Task 5 (Jo 2 Nov 2026, answers 10 and 21): ONE page — PIESA owner declarations + ESC consent + 50% deposit.
// Pure rules + the server orchestration run against recorded fakes (no database, nothing is sent).
import { describe, expect, test } from "bun:test";
import { CONFIRM_SIGN_PAY, confirmSignPayBlockers, confirmSignPayFooter, piesaConfirmTick, piesaResultLabel, clearScreenOpen, consentTickLine, clearAction, consentOnlyOpen, consentOnlyPiesa, hasDepositStep, hasPiesaStep, withNoDeposit, type ConfirmSignPayState } from "../src/lib/confirm-sign-pay.core";
import { currentOwnerAction, resolveOwnerScreen } from "../src/lib/owner-myjob.core";
import { OWNER_DECLARATIONS } from "../src/lib/consent.core";
import { confirmSignPay, type ConfirmSignPayDeps } from "../src/lib/confirm-sign-pay.server";

const J = "job-1";
const state = (o: Partial<{ piesa: boolean; consent: boolean; paid: boolean; result: ConfirmSignPayState["piesa"]["result"] }> = {}): ConfirmSignPayState => ({
  piesa: { checkedOn: "7 November", electrician: "Sam Spark", result: o.result ?? "Safe to insulate", done: o.piesa ?? false },
  consent: { name: "Helen Yang", address: "1 Test St, Richmond VIC 3121", phone: "0400111222", email: "helen@example.com", done: o.consent ?? false, signedOn: o.consent ? "2 November 2026" : null },
  deposit: { amountCents: 18510, paid: o.paid ?? false },
});
const ALL = [true, true, true, true] as [boolean, boolean, boolean, boolean];
const NONE = [false, false, false, false] as [boolean, boolean, boolean, boolean];

describe("copy", () => {
  test("constants are Jo's wording", () => {
    expect(CONFIRM_SIGN_PAY).toEqual({
      kicker: "ONE LAST STEP", title: "Confirm, sign and pay your deposit", step1: "Confirm your safety check", step2: "Sign the government consent form",
      step2Sub: "The law says we must tell the Essential Services Commission about every install before it happens. This is the Commission's own form.",
      step3: "Pay your deposit", nameLabel: "Type your full name to sign steps 1 and 2", card: "Sign and pay by card", bank: "Sign and pay by bank transfer", viewForm: "View the full form ›",
      signOnly: "Sign", // DRAFT (fix round 1): the consent-only page's button
    });
  });
  test("tick and footer", () => {
    expect(piesaConfirmTick("7 November")).toBe("I confirm the electrical safety check was done on 7 November. I understand that anyone going into the ceiling before the install may void it, and that this form goes to my installer and may go to the Essential Services Commission.");
    expect(confirmSignPayFooter("Rapid Insulation", "Saturday 6 December")).toBe("Then Rapid Insulation will call you to book your install day. Install by Saturday 6 December.");
  });
  test("result label: safe, or upgrades still to come", () => {
    expect(piesaResultLabel("all_clear")).toBe("Safe to insulate");
    expect(piesaResultLabel("repair_needed")).toBe("Electrical upgrades needed");
  });
});

describe("blockers", () => {
  const base = { piesaTick: true, consentTicks: ALL, typedName: "Helen Yang", state: state() };
  test("all present -> none", () => expect(confirmSignPayBlockers(base)).toEqual([]));
  test("missing name", () => expect(confirmSignPayBlockers({ ...base, typedName: " " }).length).toBeGreaterThan(0));
  test("missing PIESA tick", () => expect(confirmSignPayBlockers({ ...base, piesaTick: false }).length).toBe(1));
  test("each missing consent tick blocks", () => {
    for (let i = 0; i < 4; i++) { const t = [...ALL] as typeof ALL; t[i] = false; expect(confirmSignPayBlockers({ ...base, consentTicks: t }).length).toBe(1); }
  });
  test("ticks only needed for steps not done (old flow: consent signed at acceptance, PIESA confirmed)", () => {
    expect(confirmSignPayBlockers({ piesaTick: false, consentTicks: NONE, typedName: "", state: state({ piesa: true, consent: true }) })).toEqual([]);
    expect(confirmSignPayBlockers({ piesaTick: false, consentTicks: ALL, typedName: "Helen Yang", state: state({ piesa: true }) })).toEqual([]);
    expect(confirmSignPayBlockers({ piesaTick: true, consentTicks: NONE, typedName: "Helen Yang", state: state({ consent: true }) })).toEqual([]);
  });
  test("first and last name are both needed before any signing", () => {
    expect(confirmSignPayBlockers({ ...base, typedName: "Helen" }).length).toBe(1);
    expect(confirmSignPayBlockers({ ...base, typedName: "  Helen   Yang " })).toEqual([]);
    expect(confirmSignPayBlockers({ piesaTick: false, consentTicks: ALL, typedName: "Helen", state: state({ piesa: true }) }).length).toBe(1);
  });
  test("a name is needed whenever something still has to be signed", () => {
    expect(confirmSignPayBlockers({ piesaTick: true, consentTicks: ALL, typedName: "", state: state({ consent: true }) }).length).toBe(1);
  });
});

describe("consent ticks are the official Section 2 lines", () => {
  test("four lines from consent.core", () => {
    expect(OWNER_DECLARATIONS.length).toBe(4);
    expect(CONFIRM_SIGN_PAY.step2).toBe("Sign the government consent form");
  });
});

describe("which screen is current", () => {
  const all = { newquote: false, turn: false, taps: false, quote: false, fixes: false, pay: false, piesa: false, veec: false, book: false, spot: false, review: false, clear: false };
  test("clear beats pay, piesa and fixes", () => {
    expect(currentOwnerAction({ ...all, clear: true, pay: true, piesa: true, fixes: true })).toBe("clear");
  });
  test("an open quote still comes first", () => expect(currentOwnerAction({ ...all, clear: true, quote: true })).toBe("quote"));
  test("clearScreenOpen: straight after the PIESA result, also when upgrades are still to come (answer 21)", () => {
    const f = { stage: "piesa_complete", outcome: "all_clear" as const, safetyCleared: true, depositCleared: false, depositCents: 18510 };
    expect(clearScreenOpen(f)).toBe(true);
    expect(clearScreenOpen({ ...f, outcome: "upgrades_needed" })).toBe(true);
    expect(clearScreenOpen({ ...f, outcome: null })).toBe(false);
    expect(clearScreenOpen({ ...f, depositCleared: true })).toBe(false);
    expect(clearScreenOpen({ ...f, safetyCleared: false })).toBe(false);
    expect(clearScreenOpen({ ...f, stage: "quote_sent" })).toBe(false);
    expect(clearScreenOpen({ ...f, depositCents: 0 })).toBe(false);
    // C1: a partner-billed in-house job auto-advances to the upgrades stages the moment the PIESA finds upgrades — still open.
    expect(clearScreenOpen({ ...f, outcome: "upgrades_needed", stage: "rectification_scheduling" })).toBe(true);
    expect(clearScreenOpen({ ...f, outcome: "upgrades_needed", stage: "rectification_booked" })).toBe(true);
    expect(clearScreenOpen({ ...f, outcome: "upgrades_needed", stage: "electrical_variation_pending" })).toBe(true);
  });
  test("stays open while a signature is missing even if the deposit is paid; closes when all done and paid", () => {
    const f = { stage: "piesa_complete", outcome: "all_clear" as const, safetyCleared: true, depositCleared: true, depositCents: 18510 };
    expect(clearScreenOpen({ ...f, unsigned: true })).toBe(true);
    expect(clearScreenOpen({ ...f, unsigned: false })).toBe(false);
    expect(clearScreenOpen({ ...f, unsigned: true, outcome: null })).toBe(false);
  });
  test("clearAction: only when the page state loads; otherwise fall back to the old screens", () => {
    expect(clearAction(true, state())).toBe("clear");
    expect(clearAction(true, null)).toBe(null);
    expect(clearAction(false, state())).toBe(null);
  });
  test("?screen=pay and ?screen=piesa resolve to clear while a step is unsigned; other screens untouched", () => {
    const facts = { currentAction: "clear" as const, clearStepsUnsigned: true };
    expect(resolveOwnerScreen("pay", facts)).toBe("clear");
    expect(resolveOwnerScreen("piesa", facts)).toBe("clear");
    expect(resolveOwnerScreen("quote", facts)).toBe("quote");
    expect(resolveOwnerScreen("pay", { currentAction: "clear", clearStepsUnsigned: false })).toBe("pay");
    expect(resolveOwnerScreen("piesa", { currentAction: "pay" })).toBe("piesa");
  });
  test("official third consent line keeps its wording (no full stop added); the others still end with one", () => {
    expect(consentTickLine("consent_ap_sends", "I consent to X sending it to the Essential Services Commission (commission)")).toBe("I consent to X sending it to the Essential Services Commission (commission)");
    expect(consentTickLine("details_accurate", "the details listed above are complete and accurate.")).toBe("the details listed above are complete and accurate.");
    expect(consentTickLine("consent_commission_shares", "I consent to the Commission sharing that")).toBe("I consent to the Commission sharing that.");
  });
});

// ---------- server orchestration (fakes) ----------
function fakes(initial: ConfirmSignPayState, over: Partial<ConfirmSignPayDeps> = {}) {
  const st = structuredClone(initial);
  const calls: string[] = [];
  let sent = false;
  const deps: ConfirmSignPayDeps = {
    loadState: async () => structuredClone(st),
    prepareConsent: async () => { calls.push("prepare"); },
    signPiesa: async (p) => { calls.push(`piesa:${p.fullName}`); st.piesa.done = true; },
    signConsent: async (p) => { calls.push(`consent:${p.signatureName}:${Object.values(p.declarations).every(Boolean)}`); st.consent.done = true; },
    consentCopySent: async () => sent,
    sendConsentCopy: async () => { calls.push(`copy:paid=${st.deposit.paid}`); sent = true; },
    cardCheckout: async () => { calls.push("card"); return { url: "https://stripe.test/c" }; },
    bankLines: async () => ["Account name: Test", "Reference: HV-1"],
    ...over,
  };
  return { deps, calls, st };
}
const session = { jobId: J, userId: "u1", codeId: "code-1", channel: "sms" as const, destination: "04**" };
const input = { piesaTick: true, consentTicks: ALL, typedName: "Helen Yang", method: "bank" as const };

describe("confirmSignPay", () => {
  test("bank: signs both steps with ONE name, sends the consent copy once before any payment, returns bank lines, deposit not paid", async () => {
    const { deps, calls, st } = fakes(state());
    const r = await confirmSignPay(J, session, input, deps);
    expect(r).toEqual({ bank: ["Account name: Test", "Reference: HV-1"] });
    expect(calls).toEqual(["prepare", "piesa:Helen Yang", "consent:Helen Yang:true", "copy:paid=false"]);
    expect(st.deposit.paid).toBe(false);
  });
  test("second submit signs nothing new, sends no second copy, same lines", async () => {
    const { deps, calls } = fakes(state());
    const a = await confirmSignPay(J, session, input, deps);
    const n = calls.length;
    const b = await confirmSignPay(J, session, { ...input, piesaTick: false, consentTicks: NONE, typedName: "" }, deps);
    expect(b).toEqual(a);
    expect(calls.length).toBe(n);
  });
  test("card: copy is sent at signing, before checkout, not on the payment webhook", async () => {
    const { deps, calls } = fakes(state());
    const r = await confirmSignPay(J, session, { ...input, method: "card" }, deps);
    expect(r).toEqual({ checkoutUrl: "https://stripe.test/c" });
    expect(calls).toEqual(["prepare", "piesa:Helen Yang", "consent:Helen Yang:true", "copy:paid=false", "card"]);
  });
  test("in-flight: consent signed at acceptance and PIESA confirmed on the old page -> nothing re-signed; the missing consent copy is sent once", async () => {
    const { deps, calls } = fakes(state({ piesa: true, consent: true }));
    const r = await confirmSignPay(J, session, { ...input, piesaTick: false, consentTicks: NONE, typedName: "" }, deps);
    expect(r).toEqual({ bank: ["Account name: Test", "Reference: HV-1"] });
    expect(calls).toEqual(["copy:paid=false"]);
    await confirmSignPay(J, session, { ...input, piesaTick: false, consentTicks: NONE, typedName: "" }, deps);
    expect(calls).toEqual(["copy:paid=false"]);
  });
  test("consent already signed and a copy already exists -> no send", async () => {
    const { deps, calls } = fakes(state({ piesa: true, consent: true }), { consentCopySent: async () => true });
    await confirmSignPay(J, session, { ...input, piesaTick: false, consentTicks: NONE, typedName: "" }, deps);
    expect(calls).toEqual([]);
  });
  test("a retry after a failed copy send sends it (signed in an earlier call)", async () => {
    let fail = true;
    const { deps, calls } = fakes(state(), { sendConsentCopy: async () => { calls2.push("try"); if (fail) throw new Error("mail down"); } });
    const calls2: string[] = [];
    await confirmSignPay(J, session, input, deps);
    fail = false;
    await confirmSignPay(J, session, { ...input, piesaTick: false, consentTicks: NONE, typedName: "" }, deps);
    expect(calls2).toEqual(["try", "try"]);
  });
  test("only the missing step is signed", async () => {
    const { deps, calls } = fakes(state({ consent: true }));
    await confirmSignPay(J, session, { ...input, consentTicks: NONE }, deps);
    expect(calls).toEqual(["piesa:Helen Yang", "copy:paid=false"]);
  });
  test("upgrades still to come: page signs the same PIESA record", async () => {
    const { deps, calls } = fakes(state({ result: "Electrical upgrades needed" }));
    await confirmSignPay(J, session, input, deps);
    expect(calls.slice(0, 2)).toEqual(["prepare", "piesa:Helen Yang"]);
  });
  test("blocked input signs nothing", async () => {
    const { deps, calls } = fakes(state());
    await expect(confirmSignPay(J, session, { ...input, consentTicks: [true, true, true, false] }, deps)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  test("a 6-digit code session for THIS job is required", async () => {
    const { deps, calls } = fakes(state());
    await expect(confirmSignPay(J, { ...session, codeId: "" }, input, deps)).rejects.toThrow(/code/i);
    await expect(confirmSignPay(J, { ...session, jobId: "other-job" }, input, deps)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  test("deposit already paid: signs what is left, nothing to pay", async () => {
    const { deps } = fakes(state({ paid: true }));
    expect(await confirmSignPay(J, session, input, deps)).toEqual({ paid: true });
  });
  test("a failed copy email never loses the signature", async () => {
    const { deps, calls } = fakes(state(), { sendConsentCopy: async () => { throw new Error("mail down"); } });
    const r = await confirmSignPay(J, session, input, deps);
    expect("bank" in r).toBe(true);
    expect(calls).toEqual(["prepare", "piesa:Helen Yang", "consent:Helen Yang:true"]);
  });
});

// ---------- Part 4 Task 14 fix round 1, item 5: no ESC consent dead end ----------
describe("consent-only clear page (Reg 23A consent awaiting the owner while the pay page would not open)", () => {
  test("pure: opens only when the normal page is closed and a consent row is awaiting the owner; state shows no deposit step", () => {
    expect(consentOnlyOpen({ clearOpen: false, consentAwaitingOwner: true })).toBe(true);
    expect(consentOnlyOpen({ clearOpen: true, consentAwaitingOwner: true })).toBe(false);
    expect(consentOnlyOpen({ clearOpen: false, consentAwaitingOwner: false })).toBe(false);
    const s = withNoDeposit(state());
    expect(s.deposit).toEqual({ amountCents: 0, paid: false });
    expect(hasDepositStep(s)).toBe(false);
    expect(hasDepositStep(state())).toBe(true);
    expect(consentOnlyPiesa().done).toBe(true); // nothing to confirm when there is no PIESA yet
    expect(hasPiesaStep(consentOnlyPiesa())).toBe(false);
    expect(hasPiesaStep(state().piesa)).toBe(true);
  });
  test("submit with no deposit step: signs the consent, sends the copy, returns signed (no bank lines, no checkout)", async () => {
    const { deps, calls } = fakes(withNoDeposit(state({ piesa: true })));
    const r = await confirmSignPay(J, session, { ...input, piesaTick: false }, deps);
    expect(r).toEqual({ signed: true });
    expect(calls).toEqual(["prepare", "consent:Helen Yang:true", "copy:paid=false"]);
  });
  test("server: the page opens from the My job read when clearScreenOpen is false (depositCents 0) and when the state load throws, if the consent is awaiting the owner", async () => {
    const { clearPageMode } = await import("../src/lib/confirm-sign-pay.server");
    const facts = { stage: "piesa_complete", outcome: "all_clear" as const, safetyCleared: true, depositCleared: false, depositCents: 0 };
    const awaiting = async () => ({ status: "awaiting_owner", premises_address: "1 Test St", owner_contact: { name: "Helen Yang", email: "h@x", phone: "04" } });
    const loads = async () => state();
    const noPiesa = async () => null;
    expect(await clearPageMode("j", facts, { hasConfirmation: true, loadState: loads, consent: awaiting })).toEqual({ mode: "consent_only", state: withNoDeposit(state()) });
    expect(await clearPageMode("j", { ...facts, depositCents: 18510 }, { hasConfirmation: true, loadState: async () => { throw new Error("db down"); }, consent: awaiting, piesaFacts: noPiesa })).toEqual({ mode: "consent_only", state: expect.objectContaining({ deposit: { amountCents: 0, paid: false } }) });
    expect(await clearPageMode("j", { ...facts, depositCents: 18510 }, { hasConfirmation: true, loadState: loads, consent: awaiting })).toEqual({ mode: "clear", state: state() });
    expect(await clearPageMode("j", facts, { hasConfirmation: true, loadState: loads, consent: async () => ({ status: "signed" }) })).toEqual({ mode: null, state: null });
    expect(await clearPageMode("j", facts, { hasConfirmation: false, loadState: async () => { throw new Error("no PIESA"); }, consent: awaiting, piesaFacts: noPiesa })).toEqual({ mode: "consent_only", state: expect.objectContaining({ piesa: expect.objectContaining({ done: true }), deposit: { amountCents: 0, paid: false } }) });
  });
});

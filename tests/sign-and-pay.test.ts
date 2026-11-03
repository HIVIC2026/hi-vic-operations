// Part 4 Task 11 (?screen=finish): sign the rebate form (official ESC VEEC form, Section 4 Part B) and pay the balance on one page.
// Pure rules + server orchestration against recorded fakes (no database, nothing is sent, no money moves).
import { describe, expect, test } from "bun:test";
import { SIGN_AND_PAY, signAndPayBlockers, signAndPayButtons, signAndPayRows, consumerSignBlocker, type SignAndPayState } from "../src/lib/sign-and-pay.core";
import { signAndPay, type SignAndPayDeps } from "../src/lib/sign-and-pay.server";
import { P2 } from "../src/lib/owner-pages.core";
import { resolveOwnerScreen } from "../src/lib/owner-myjob.core";

const J = "job-1";
const state = (o: Partial<{ signed: boolean; paid: boolean; blocker: string | null; payable: boolean }> = {}): SignAndPayState => ({
  installedOn: "13 November 2026", product: "Bradford Gold R5.0", areaM2: 120, address: "12 Example St, Box Hill", rebateCents: 238000,
  sign: { done: o.signed ?? false, signedOn: o.signed ? "13 November 2026" : null, blocker: o.blocker ?? null },
  balance: { amountCents: 141200, paid: o.paid ?? false, payable: o.payable ?? true },
});
const session = { jobId: J, userId: "u1", codeId: "code-1", channel: "sms" as const, destination: "04**" };
const input = { tick: true, over18: true, typedName: "Helen Yang", method: "bank" as const };

describe("copy", () => {
  test("constants are Jo's wording, verbatim", () => {
    expect(SIGN_AND_PAY).toEqual({
      kicker: "TWO LAST THINGS", title: "Sign your rebate form and pay your balance", step1: "Sign your rebate form",
      step1Sub: "The government's official form (VEEC assignment). It confirms what was installed and lets us claim the rebate you've already had off your price.",
      viewForm: "View the full form (PDF) ›",
      tick: "I've read the form. The details are correct, and I assign the right to create the rebate certificates for this install to Home Insulation Victoria.",
      nameLabel: "Type your full name to sign", step2: "Pay your balance", dueToday: "due today", card: "Sign and pay by card", bank: "Sign and pay by bank transfer",
      footer: "Your tax invoice is attached to your email. Once both are done, we'll send your completion pack.",
    });
  });
  test("summary rows: installed, product with m², address, rebate", () => {
    expect(signAndPayRows(state())).toEqual([
      { label: "Installed", value: "13 November 2026" }, { label: "Product", value: "Bradford Gold R5.0, 120 m²" },
      { label: "Address", value: "12 Example St, Box Hill" }, { label: "Rebate (already off your price)", value: "$2,380" },
    ]);
  });
  test("buttons: approved labels when both steps are open; shorter when one step is done", () => {
    expect(signAndPayButtons(state())).toEqual({ card: "Sign and pay by card", bank: "Sign and pay by bank transfer" });
    expect(signAndPayButtons(state({ signed: true }))).toEqual({ card: "Pay by card", bank: "Pay by bank transfer" });
    expect(signAndPayButtons(state({ paid: true }))).toEqual({ sign: "Sign my rebate form" });
    expect(signAndPayButtons(state({ signed: true, paid: true }))).toEqual({});
    // balance not payable yet: sign only, no pay wording
    expect(signAndPayButtons(state({ payable: false }))).toEqual({ sign: "Sign my rebate form" });
    expect(signAndPayButtons(state({ signed: true, payable: false }))).toEqual({});
  });
});

describe("blockers", () => {
  test("signing needs the tick and a first and last name", () => {
    expect(signAndPayBlockers({ tick: true, over18: true, typedName: "Helen Yang", state: state() })).toEqual([]);
    expect(signAndPayBlockers({ tick: false, over18: true, typedName: "Helen Yang", state: state() }).length).toBe(1);
    expect(signAndPayBlockers({ tick: true, over18: true, typedName: "Helen", state: state() }).length).toBe(1);
    expect(signAndPayBlockers({ tick: true, over18: true, typedName: "  ", state: state() }).length).toBe(1);
    expect(signAndPayBlockers({ tick: true, over18: false, typedName: "Helen Yang", state: state() }).length).toBe(1);
  });
  test("already signed: only payment is asked, no tick or name", () => {
    expect(signAndPayBlockers({ tick: false, over18: false, typedName: "", state: state({ signed: true }) })).toEqual([]);
  });
  test("the VEEC order guard blocks until the Lead Installer's Part B (and the AP's Part A) are in", () => {
    const b = (status: string, installerSigned: boolean, apSigned = false) => consumerSignBlocker({ status: status as never, installerSigned, apSigned, consumerSigned: false, openVariation: false });
    expect(consumerSignBlocker(null)).toMatch(/lead installer/i);
    expect(b("awaiting_installer_signature", false)).toMatch(/lead installer/i);
    expect(b("awaiting_ap_signature", true)).toMatch(/AP representative/i);
    expect(b("awaiting_consumer_signature", true, true)).toBeNull();
  });
});

function fakes(initial: SignAndPayState, over: Partial<SignAndPayDeps> = {}) {
  const st = structuredClone(initial);
  const calls: string[] = [];
  const deps: SignAndPayDeps = {
    loadState: async () => structuredClone(st),
    signVeec: async (p) => { calls.push(`sign:${p.signatureName}:${p.over18}:${p.confirmsSection2}`); st.sign.done = true; },
    afterSigned: async () => { calls.push("copy"); },
    cardCheckout: async () => { calls.push("card"); return { url: "https://stripe.test/b" }; },
    bankLines: async () => { calls.push("bank"); return ["Account name: Test", "Reference: HV-1"]; },
    ...over,
  };
  return { deps, calls, st };
}

describe("signAndPay", () => {
  test("bank: signs with the typed name, starts the copy, returns bank lines (no receipt, nothing marked paid)", async () => {
    const { deps, calls, st } = fakes(state());
    expect(await signAndPay(J, session, input, deps)).toEqual({ bank: ["Account name: Test", "Reference: HV-1"] });
    expect(calls).toEqual(["sign:Helen Yang:true:true", "copy", "bank"]);
    expect(st.balance.paid).toBe(false);
  });
  test("card: signs first, then opens the card page", async () => {
    const { deps, calls } = fakes(state());
    expect(await signAndPay(J, session, { ...input, method: "card" }, deps)).toEqual({ checkoutUrl: "https://stripe.test/b" });
    expect(calls).toEqual(["sign:Helen Yang:true:true", "copy", "card"]);
  });
  test("already signed: nothing is signed again, only payment", async () => {
    const { deps, calls } = fakes(state({ signed: true }));
    expect(await signAndPay(J, session, { tick: false, over18: false, typedName: "", method: "card" }, deps)).toEqual({ checkoutUrl: "https://stripe.test/b" });
    expect(calls).toEqual(["card"]);
  });
  test("already paid: the button signs only, then done", async () => {
    const { deps, calls } = fakes(state({ paid: true }));
    expect(await signAndPay(J, session, input, deps)).toEqual({ done: true });
    expect(calls).toEqual(["sign:Helen Yang:true:true", "copy"]);
  });
  test("both done: { done: true }, nothing happens", async () => {
    const { deps, calls } = fakes(state({ signed: true, paid: true }));
    expect(await signAndPay(J, session, { tick: false, over18: false, typedName: "", method: "bank" }, deps)).toEqual({ done: true });
    expect(calls).toEqual([]);
  });
  test("signing before the Lead Installer's Part B exists is refused; nothing signed, nothing paid", async () => {
    const msg = consumerSignBlocker(null)!;
    const { deps, calls } = fakes(state({ blocker: msg }));
    await expect(signAndPay(J, session, input, deps)).rejects.toThrow(msg);
    expect(calls).toEqual([]);
  });
  test("no tick or no name: nothing signed", async () => {
    const { deps, calls } = fakes(state());
    await expect(signAndPay(J, session, { ...input, tick: false }, deps)).rejects.toThrow();
    await expect(signAndPay(J, session, { ...input, typedName: "Helen" }, deps)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  test("one tick is not enough: over18 is never assumed, nothing signed", async () => {
    const { deps, calls } = fakes(state());
    await expect(signAndPay(J, session, { ...input, over18: false }, deps)).rejects.toThrow();
    await expect(signAndPay(J, session, { ...input, tick: false }, deps)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  test("over18 is recorded true only because the second box was ticked", async () => {
    let seen: boolean | null = null;
    const { deps } = fakes(state(), { signVeec: async (p) => { seen = p.over18; } });
    await signAndPay(J, session, input, deps);
    expect(seen).toBe(true);
  });
  test("the second tick uses the approved P2.tick3 wording", () => {
    expect(P2.tick3).toBe("I'm 18 or over, and I own this home or I'm authorised to sign for the owner");
  });
  test("a 6-digit code session for THIS job is required", async () => {
    const { deps, calls } = fakes(state());
    await expect(signAndPay(J, { ...session, codeId: "" }, input, deps)).rejects.toThrow(/code/i);
    await expect(signAndPay(J, { ...session, jobId: "other" }, input, deps)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  test("card trouble never loses the signature: the owner is pointed to bank transfer", async () => {
    const { deps, st } = fakes(state(), { cardCheckout: async () => ({ blocker: "Card is off." }) });
    await expect(signAndPay(J, session, { ...input, method: "card" }, deps)).rejects.toThrow(/signature is saved.*bank transfer/i);
    expect(st.sign.done).toBe(true);
  });
  test("a failed copy step never loses the signature or stops payment", async () => {
    const { deps } = fakes(state(), { afterSigned: async () => { throw new Error("mail down"); } });
    const orig = console.error; console.error = () => {};
    try { expect(await signAndPay(J, session, input, deps)).toEqual({ bank: ["Account name: Test", "Reference: HV-1"] }); } finally { console.error = orig; }
  });
  test("balance not payable yet (not the due step): signs, never opens card or bank", async () => {
    const { deps, calls } = fakes(state({ payable: false }));
    expect(await signAndPay(J, session, input, deps)).toEqual({ done: true });
    expect(calls).toEqual(["sign:Helen Yang:true:true", "copy"]);
  });
});

describe("screen", () => {
  test("?screen=finish is its own screen", () => {
    expect(resolveOwnerScreen("finish", { currentAction: null })).toBe("finish");
  });
});

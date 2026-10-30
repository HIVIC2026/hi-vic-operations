/**
 * Guide fix 6 (Jo, 29 Oct 2026, decision 425): accepting a quote on My job is "tick and tap Accept".
 * No typed name (twice) and no "over 18" tick. The owner/acting-for-owner choice and the 6-digit code stay.
 * The agreement record takes the owner's name on file; "over 18" is simply not recorded (false).
 * Would fail if the name fields or the 18+ tick came back, or if a blank name stopped an owner from accepting.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { agreementSignBlockers, fillSignerFromOwner, type Template } from "../src/lib/assignment.core";
import { P2 } from "../src/lib/owner-pages.core";

const T = (k: string): Template => ({ template_key: k, version: "v1", body: "x".repeat(30), approved: true, is_active: true, required: true });
const all = [T("consumer_rights")];

describe("guide fix 6 — accept a quote without typing a name", () => {
  test("the owner's name on file signs the agreement record", () => {
    const filled = fillSignerFromOwner({ authorityType: "owner", readConsumerInfo: true, acceptAgreement: true }, "Helen Smith");
    expect(filled.signatoryName).toBe("Helen Smith");
    expect(filled.signatureName).toBe("Helen Smith");
    expect(filled.authorityType).toBe("owner");
    expect(filled.over18).toBe(false);
  });
  test("acting for the owner is kept", () => {
    expect(fillSignerFromOwner({ authorityType: "authorised_representative", readConsumerInfo: true, acceptAgreement: true }, "Helen Smith").authorityType).toBe("authorised_representative");
  });
  test("no 18+ tick needed; the two accept ticks still are", () => {
    const filled = fillSignerFromOwner({ authorityType: "owner", readConsumerInfo: true, acceptAgreement: true }, "Helen Smith");
    expect(agreementSignBlockers(filled, all)).toEqual([]);
    expect(agreementSignBlockers({ ...filled, acceptAgreement: false }, all)).toEqual(["Please confirm you accept the quote and agreement."]);
  });
  test("My job accept screen has no name fields and no 18+ tick, but keeps owner/acting and the code", () => {
    const src = readFileSync("src/routes/my-job.$token.tsx", "utf8");
    const accept = src.slice(src.indexOf("function AcceptQuote("), src.indexOf("\n}\n", src.indexOf("function AcceptQuote(")));
    expect(accept).not.toContain("P2.fullName");
    expect(accept).not.toContain("P2.typeAgain");
    expect(accept).not.toContain("P2.tick3");
    expect(accept).toContain("<AuthorityChoice");
    expect(accept).toContain("<OwnerCodeGate");
    expect(accept).not.toMatch(/signatoryName:|signatureName:|over18/);
    expect(accept).not.toContain("P2.signTitle");
    expect(accept).not.toContain("P2.signSub");
  });
  test("the page says accept, not sign (Jo's wording)", () => {
    expect(P2.twoThings).toBe("Two quick things, then accept");
    expect(P2.button("$349.00")).toBe("Accept and pay $349.00");
    expect(P2.lockHint).toBe("Tick both to accept");
  });
  test("the owner accept call no longer requires a typed name", () => {
    const src = readFileSync("src/lib/owner-link.functions.ts", "utf8");
    const fn = src.slice(src.indexOf("export const ownerAcceptQuoteFn"), src.indexOf("export const ownerDeclineQuoteFn"));
    expect(fn).not.toContain("...signer");
    expect(fn).not.toContain("over18");
  });
});

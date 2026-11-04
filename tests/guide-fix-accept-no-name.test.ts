/**
 * Guide fix 6 (Jo, 29 Oct 2026, decision 425) said: accept a quote with no typed name and no 18+ tick. Jo 2 Nov 2026
 * REVERSED the typed name (lawyer Q8) and moved the 18+ line into tick 1 (touchpoint #33), so those two halves are replaced by
 * tests/quote-page-v2.test.ts. What still holds: the owner's name on file fills the agreement record, acting-for-owner is kept,
 * the 6-digit code is still asked for, and there is no separate 18+ tick on the accept screen.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { agreementSignBlockers, fillSignerFromOwner, type Template } from "../src/lib/assignment.core";

const T = (k: string): Template => ({ template_key: k, version: "v1", body: "x".repeat(30), approved: true, is_active: true, required: true });
const all = [T("consumer_rights")];

describe("accepting a quote", () => {
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
  test("no 18+ tick needed; the accept tick still is", () => {
    const filled = fillSignerFromOwner({ authorityType: "owner", readConsumerInfo: true, acceptAgreement: true }, "Helen Smith");
    expect(agreementSignBlockers(filled, all)).toEqual([]);
    expect(agreementSignBlockers({ ...filled, acceptAgreement: false }, all)).toEqual(["Please confirm you accept the quote and agreement."]);
  });
  test("accept screen keeps owner/acting and the code, and has no separate 18+ tick", () => {
    const src = readFileSync("src/routes/my-job.$token.tsx", "utf8");
    const accept = src.slice(src.indexOf("function AcceptQuote("), src.indexOf("\n}\n", src.indexOf("function AcceptQuote(")));
    expect(accept).not.toContain("P2.tick3");
    expect(accept).toContain("<AuthorityChoice");
    expect(accept).toContain("<OwnerCodeGate");
    expect(accept).not.toMatch(/over18/);
  });
});

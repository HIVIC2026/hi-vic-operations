// Base44 enquiry handoff: Ed25519 verification + preliminary eligibility mapping + idempotency (in-memory). Run: bun test ./tests/
import { describe, expect, test } from "bun:test";
import { BASE44_PUBLIC_KEY_SPKI_B64, PRELIM_STAGE_ALLOWED_FROM, preliminaryEligibilityFields, verifyEd25519 } from "../src/lib/enquiry.core";
import { enquirySchema } from "../src/lib/enquiry.server";

const b64 = (b: ArrayBuffer) => Buffer.from(b).toString("base64");
async function keypair() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return { priv: kp.privateKey, pubB64: b64(await crypto.subtle.exportKey("spki", kp.publicKey)) };
}
const sign = async (k: CryptoKey, body: string) => b64(await crypto.subtle.sign({ name: "Ed25519" }, k, new TextEncoder().encode(body)));

const payload = { external_enquiry_id: "b44-123", full_name: "Test Owner", email: "t@example.com", address_line: "1 Test St", eligibility_outcome: "likely_eligible", eligibility_reason: "Built 1985", source_reference: "B44-REF-9" };

describe("Ed25519 signature", () => {
  test("valid signed body accepted", async () => {
    const { priv, pubB64 } = await keypair();
    const body = JSON.stringify(payload);
    expect(await verifyEd25519(body, await sign(priv, body), pubB64)).toBe(true);
  });
  test("body modified after signing rejected", async () => {
    const { priv, pubB64 } = await keypair();
    const body = JSON.stringify(payload);
    const sig = await sign(priv, body);
    expect(await verifyEd25519(body.replace("Test Owner", "Evil Owner"), sig, pubB64)).toBe(false);
    expect(await verifyEd25519(body + " ", sig, pubB64)).toBe(false);
  });
  test("missing / malformed / wrong-key signature rejected", async () => {
    const { priv } = await keypair();
    const body = JSON.stringify(payload);
    expect(await verifyEd25519(body, null)).toBe(false);
    expect(await verifyEd25519(body, "")).toBe(false);
    expect(await verifyEd25519(body, "not base64!!")).toBe(false);
    expect(await verifyEd25519(body, Buffer.alloc(64).toString("base64"))).toBe(false);
    // signed by a different key than the trusted Base44 key
    expect(await verifyEd25519(body, await sign(priv, body), BASE44_PUBLIC_KEY_SPKI_B64)).toBe(false);
  });
  test("trusted Base44 key imports", async () => {
    const der = Buffer.from(BASE44_PUBLIC_KEY_SPKI_B64, "base64");
    await expect(crypto.subtle.importKey("spki", der, { name: "Ed25519" }, false, ["verify"])).resolves.toBeDefined();
  });
});

describe("preliminary eligibility mapping", () => {
  const cases = [
    ["likely_eligible", "Confirm eligibility and arrange electrician assessment"],
    ["needs_onsite_confirmation", "Review onsite confirmation requirements"],
    ["does_not_appear_eligible", "Review eligibility outcome before closing"],
  ] as const;
  for (const [o, na] of cases) test(o, () => {
    const f = preliminaryEligibilityFields(o, "r", new Date("2026-09-28T00:00:00Z"))!;
    expect(f.stage).toBe("eligibility_review");
    expect(f.next_action).toBe(na);
    expect(f.eligibility_set_by).toBeNull();
    expect(f.eligibility_set_at).toBe("2026-09-28T00:00:00.000Z");
  });
  test("no outcome -> no change", () => expect(preliminaryEligibilityFields(undefined, "x")).toBeNull());
  test("never moves later stages backwards", () => {
    expect(PRELIM_STAGE_ALLOWED_FROM).toEqual(["new_enquiry", "eligibility_review"]);
  });
  test("schema: accepts new fields, rejects bad outcome / long reason", () => {
    expect(enquirySchema.safeParse(payload).success).toBe(true);
    expect(enquirySchema.safeParse({ ...payload, eligibility_outcome: "eligible" }).success).toBe(false);
    expect(enquirySchema.safeParse({ ...payload, eligibility_reason: "x".repeat(2001) }).success).toBe(false);
    expect(enquirySchema.safeParse({ ...payload, source_reference: "x".repeat(101) }).success).toBe(false);
  });
});

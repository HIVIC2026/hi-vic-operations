import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { bounceWords, resendEventResult, verifyResendSignature } from "../src/lib/email-delivery.core";

const key = Buffer.from("test-signing-key-123");
const secret = `whsec_${key.toString("base64")}`;
const now = 1_800_000_000_000;
const body = JSON.stringify({ type: "email.delivered", data: { email_id: "em_1" } });
const sign = (raw: string, id: string, ts: number, k = key) => `v1,${createHmac("sha256", k).update(`${id}.${ts}.${raw}`).digest("base64")}`;
const hdr = (raw = body, ts = now / 1000, k = key) => ({ id: "msg_1", timestamp: String(ts), signature: sign(raw, "msg_1", ts, k) });

test("signed sample verifies", () => {
  expect(verifyResendSignature(body, hdr(), secret, now)).toBe(true);
});
test("any v1 signature in a list may match", () => {
  const h = hdr();
  expect(verifyResendSignature(body, { ...h, signature: `v1,AAAA ${h.signature}` }, secret, now)).toBe(true);
});
test("tampered body, wrong secret and missing headers fail", () => {
  expect(verifyResendSignature(`${body} `, hdr(), secret, now)).toBe(false);
  expect(verifyResendSignature(body, hdr(body, now / 1000, Buffer.from("other")), secret, now)).toBe(false);
  expect(verifyResendSignature(body, { id: null, timestamp: null, signature: null }, secret, now)).toBe(false);
  expect(verifyResendSignature(body, hdr(), "", now)).toBe(false);
});
test("timestamp 301 s old fails, 299 s passes", () => {
  expect(verifyResendSignature(body, hdr(body, now / 1000 - 301), secret, now)).toBe(false);
  expect(verifyResendSignature(body, hdr(body, now / 1000 - 299), secret, now)).toBe(true);
});
test("resendEventResult maps delivered and bounced, ignores the rest", () => {
  expect(resendEventResult({ type: "email.delivered", data: { email_id: "em_1" } })).toEqual({ emailId: "em_1", result: "delivered", detail: null });
  expect(resendEventResult({ type: "email.bounced", data: { email_id: "em_2", bounce: { message: "550 5.1.1 User unknown" } } })).toEqual({ emailId: "em_2", result: "bounced", detail: "Email address doesn't exist" });
  expect(resendEventResult({ type: "email.opened", data: { email_id: "em_3" } })).toBeNull();
  expect(resendEventResult({ type: "email.delivered", data: {} })).toBeNull();
});
test("bounceWords gives plain reasons", () => {
  expect(bounceWords("550 5.1.1 User unknown")).toBe("Email address doesn't exist");
  expect(bounceWords("Mailbox does not exist")).toBe("Email address doesn't exist");
  expect(bounceWords("452 mailbox full")).toBe("Their inbox is full");
  expect(bounceWords("blocked by policy")).toBe("Their email provider refused it");
  expect(bounceWords(null)).toBe("Their email provider refused it");
});

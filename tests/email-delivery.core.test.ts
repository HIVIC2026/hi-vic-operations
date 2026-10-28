import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { bounceWords, bouncedAddress, isBounceNotice, matchBounce, resendEventResult, verifyResendSignature } from "../src/lib/email-delivery.core";
import type { MailMessage } from "../src/lib/outlook-correspondence.core";

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

const mail = (o: Partial<MailMessage>): MailMessage => ({ providerMessageId: "p1", threadId: null, internetMessageId: null, direction: "inbound", from: "someone@example.com", fromName: null, to: [], cc: [], subject: "Hello", body: "", at: "2026-10-20T00:00:00Z", hasAttachments: false, attachments: [], ...o });
const notice = mail({ from: "postmaster@outlook.com", subject: "Undeliverable: RE: your quote", body: "Your message to owner@example.com couldn't be delivered. Sent by info@homeinsulationvictoria.com.au" });

test("Exchange bounce notice is detected, owner's out of office is not", () => {
  expect(isBounceNotice(notice)).toBe(true);
  expect(isBounceNotice(mail({ from: "owner@example.com", subject: "Out of office" }))).toBe(false);
  expect(isBounceNotice(mail({ from: "a@b.com", subject: "Mail delivery failed: returning message" }))).toBe(true);
  expect(isBounceNotice(mail({ from: "MAILER-DAEMON@x.com", subject: "hi" }))).toBe(true);
  expect(isBounceNotice({ ...notice, direction: "outbound" })).toBe(false);
});
test("bouncedAddress skips our addresses and the sender", () => {
  expect(bouncedAddress(notice)).toBe("owner@example.com");
  expect(bouncedAddress(mail({ from: "postmaster@outlook.com", body: "postmaster@outlook.com info@homeinsulationvictoria.com.au" }))).toBeNull();
});
const sent = (id: string, to: string, subject: string | null, sentAt: string) => ({ id, to, subject, sentAt });
const n = { address: "owner@example.com", at: "2026-10-20T00:00:00Z", subject: "Undeliverable: RE: your quote" };
test("matchBounce prefers subject match, else newest", () => {
  const list = [sent("a", "owner@example.com", "RE: your quote", "2026-10-15T00:00:00Z"), sent("b", "owner@example.com", "Other", "2026-10-19T00:00:00Z")];
  expect(matchBounce(n, list)).toBe("a");
  expect(matchBounce({ ...n, subject: "Undeliverable: nothing" }, list)).toBe("b");
});
test("matchBounce ignores old or other-address replies", () => {
  expect(matchBounce(n, [sent("a", "owner@example.com", "x", "2026-10-11T00:00:00Z")])).toBeNull();
  expect(matchBounce(n, [sent("a", "other@example.com", "x", "2026-10-19T00:00:00Z")])).toBeNull();
});

// Xero webhook signature + payload handling (decision 139). Pure, no network. Run: bun test tests/xero-webhook.core.test.ts
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { parseXeroWebhookEvents, verifyXeroWebhookSignature, webhookInvoiceIds, XERO_SIGNATURE_HEADER } from "../src/lib/xero-webhook.core";

const KEY = "test-webhook-key-not-real";
const sign = (body: string, key = KEY) => createHmac("sha256", key).update(body, "utf8").digest("base64");

const FIXTURE = JSON.stringify({
  events: [
    { resourceUrl: "https://api.xero.com/api.xro/2.0/Invoices/inv-1", resourceId: "inv-1", eventDateUtc: "2026-10-24T03:00:00.000", eventType: "UPDATE", eventCategory: "INVOICE", tenantId: "tenant-a", tenantType: "ORGANISATION" },
    { resourceId: "inv-1", eventType: "UPDATE", eventCategory: "INVOICE", tenantId: "tenant-a" },
    { resourceId: "con-9", eventType: "UPDATE", eventCategory: "CONTACT", tenantId: "tenant-a" },
    { resourceId: "inv-2", eventType: "CREATE", eventCategory: "INVOICE", tenantId: "tenant-b" },
    { eventType: "UPDATE", eventCategory: "INVOICE" },
  ],
  firstEventSequence: 1, lastEventSequence: 5, entropy: "abc",
});

describe("signature (fails closed)", () => {
  test("matches Xero's HMAC-SHA256 base64 over the raw body", async () => {
    expect(await verifyXeroWebhookSignature(FIXTURE, sign(FIXTURE), KEY)).toBe(true);
    expect(XERO_SIGNATURE_HEADER).toBe("x-xero-signature");
  });
  test("intent-to-receive probe with a wrong key, a tampered body, a missing header or no configured key is rejected", async () => {
    expect(await verifyXeroWebhookSignature(FIXTURE, sign(FIXTURE, "other"), KEY)).toBe(false);
    expect(await verifyXeroWebhookSignature(FIXTURE + " ", sign(FIXTURE), KEY)).toBe(false);
    expect(await verifyXeroWebhookSignature(FIXTURE, null, KEY)).toBe(false);
    expect(await verifyXeroWebhookSignature(FIXTURE, "", KEY)).toBe(false);
    expect(await verifyXeroWebhookSignature(FIXTURE, sign(FIXTURE), undefined)).toBe(false);
    expect(await verifyXeroWebhookSignature(FIXTURE, sign(FIXTURE), "")).toBe(false);
  });
  test("empty-body probe verifies only against the right key", async () => {
    expect(await verifyXeroWebhookSignature("", sign(""), KEY)).toBe(true);
    expect(await verifyXeroWebhookSignature("", sign("", "nope"), KEY)).toBe(false);
  });
});

describe("payload", () => {
  test("only INVOICE events with a resource id; distinct invoice ids to re-sync", () => {
    const events = parseXeroWebhookEvents(FIXTURE);
    expect(events.map((e) => e.resourceId)).toEqual(["inv-1", "inv-1", "inv-2"]);
    expect(events[2]).toMatchObject({ eventType: "CREATE", tenantId: "tenant-b" });
    expect(webhookInvoiceIds(events)).toEqual(["inv-1", "inv-2"]);
  });
  test("unreadable or event-less bodies yield nothing (the probe body is empty)", () => {
    expect(parseXeroWebhookEvents("")).toEqual([]);
    expect(parseXeroWebhookEvents("not json")).toEqual([]);
    expect(parseXeroWebhookEvents(JSON.stringify({ events: "x" }))).toEqual([]);
    expect(parseXeroWebhookEvents(JSON.stringify({ events: [] }))).toEqual([]);
  });
});

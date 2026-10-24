import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { createHmac } from "crypto";
import { join } from "path";
import { base44BridgeConfig, bridgeAdapter, bridgeBody, hmacHex } from "../src/lib/delivery.core";
import { safeReason } from "../src/lib/ineligible-email";
import { sendBlocker } from "../src/lib/engagement.core";

const src = (p: string) => readFileSync(p, "utf8");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const REF = `https://homeinsulationvictoria.com.au/homeowner?ref=${"A".repeat(43)}`;
const SECRET = "k".repeat(40);
const msg = { to: "o@example.com", subject: "S", html: "<p>h</p>", text: "t", idempotencyKey: "step3_estimate:l:e", purpose: "step3_estimate" };

describe("delivery settings lock", () => {
  test("disabled / missing / invalid settings => no adapter", () => {
    expect(base44BridgeConfig(undefined)).toBeNull();
    expect(base44BridgeConfig({ endpoint_url: "https://b/x", hmac_secret: SECRET, enabled: false })).toBeNull();
    expect(base44BridgeConfig({ endpoint_url: "https://b/x", hmac_secret: "short", enabled: true })).toBeNull();
    expect(base44BridgeConfig({ endpoint_url: "not a url", hmac_secret: SECRET, enabled: true })).toBeNull();
    expect(base44BridgeConfig({ provider: "other", endpoint_url: "https://b/x", hmac_secret: SECRET, enabled: true })).toBeNull();
  });
  test("adapter reads DB row only, async, no env secrets", () => {
    const s = src("src/lib/delivery.server.ts");
    expect(s).toContain("customer_delivery_settings");
    expect(s).toMatch(/export async function configuredDeliveryAdapter/);
    for (const f of walk("src")) if (/\.(ts|tsx)$/.test(f)) expect(src(f)).not.toMatch(/BASE44_DELIVERY_(URL|SECRET)/);
  });
  test("secret is never logged", () => {
    for (const f of ["src/lib/delivery.server.ts", "src/lib/delivery.core.ts", "src/lib/followups.server.ts", "src/lib/postintake.server.ts"])
      expect(src(f)).not.toMatch(/console\.[a-z]+\([^)]*(secret|hmac_secret|cfg)/i);
  });
  test("comms off / provider off => blocked", () => {
    const all = { commsEnabled: true, consent: true, activeLink: true, eligibilityOk: true, providerConfigured: true, alreadySent: false };
    expect(sendBlocker({ ...all, commsEnabled: false })).toBeTruthy();
    expect(sendBlocker({ ...all, providerConfigured: false })).toBeTruthy();
  });
});

describe("HMAC contract unchanged", () => {
  test("x-hivic-signature = HMAC-SHA256 hex of exact body; Idempotency-Key header", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ message_id: "m1" }), { status: 200 }); }) as unknown as typeof fetch;
    const r = await bridgeAdapter({ url: "https://b/x", secret: SECRET }, fake).deliver(msg);
    expect(r.providerMessageId).toBe("m1");
    const body = bridgeBody(msg);
    const h = seen!.init.headers as Record<string, string>;
    expect(seen!.init.body).toBe(body);
    expect(h["x-hivic-signature"]).toBe(createHmac("sha256", SECRET).update(body).digest("hex"));
    expect(await hmacHex(SECRET, body)).toBe(h["x-hivic-signature"]);
    expect(h["Idempotency-Key"]).toBe(msg.idempotencyKey);
    expect(JSON.parse(body)).toEqual({ to: msg.to, subject: "S", html: "<p>h</p>", text: "t", idempotency_key: msg.idempotencyKey, purpose: msg.purpose });
  });
  test("non-2xx throws without secret in message", async () => {
    const fake = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    const e = await bridgeAdapter({ url: "https://b/x", secret: SECRET }, fake).deliver(msg).catch((x) => x as Error);
    expect(e.message).not.toContain(SECRET);
  });
});

describe("post-intake + worker wiring", () => {
  const pi = src("src/lib/postintake.server.ts");
  test("email attempt runs after Step 3, before completion, and can never throw", () => {
    // 8 Oct one-automated-leads plan: Step 3 before completion; the single router runs after and never throws.
    expect(pi.indexOf("await syncStep3")).toBeGreaterThan(0);
    expect(pi.indexOf("await syncStep3")).toBeLessThan(pi.indexOf('status: "complete"'));
    expect(pi.indexOf('status: "complete"')).toBeLessThan(pi.indexOf("await maybeAutoRouteLeadEmail"));
    const router = src("src/lib/lead-email-routing.server.ts");
    expect(router).toMatch(/try \{[\s\S]*\} catch/);
    // S20-R01: the router calls the decision wrapper, which runs the same guarded ineligible sender.
    expect(router).toContain("sendDecisionIneligibleEmail");
    const fu = src("src/lib/followups.server.ts");
    const wrapper = fu.slice(fu.indexOf("export async function sendDecisionIneligibleEmail"), fu.indexOf("export async function sendPreliminaryIneligibleEmail"));
    expect(wrapper).toContain("sendPreliminaryIneligibleEmail(jobId, null)");
    const fn = pi.slice(pi.indexOf("export async function attemptCustomerEmail"));
    expect(fn).toMatch(/try \{[\s\S]*\} catch/);
    expect(fn).toContain('view.mode === "none_ineligible"');
    expect(fn).toContain("sendPreliminaryIneligibleEmail");
  });
  test("worker runs initial scan then follow-ups; counts only", () => {
    const w = src("src/routes/api/public/hooks/customer-followups.ts");
    expect(w.indexOf("processPendingInitialEstimateEmails(")).toBeLessThan(w.indexOf("processDueFollowups()"));
    expect(w).not.toMatch(/results: r\.results|to:|owners/);
    expect(w).toContain("consume_cron_nonce");
  });
  const f = src("src/lib/followups.server.ts");
  test("pending scan gates on comms + adapter first, uses idempotent sender", () => {
    const s = f.slice(f.indexOf("export async function processPendingInitialEstimateEmails"), f.indexOf("export const INELIGIBLE_PURPOSE"));
    expect(s.indexOf("customerCommsEnabled()")).toBeLessThan(s.indexOf("customer_estimate_links"));
    expect(s).toContain('.in("status", ["sent", "delivered_unrecorded", "sending"])');
    expect(s).toContain("sendInitialEstimateEmail(l.job_id, null, adapter)");
    expect(s).toContain("sendPreliminaryIneligibleEmail(j.id, null, adapter)");
  });
  test("estimate tracking/follow-ups only after confirmed send", () => {
    const s = f.slice(f.indexOf("export async function sendInitialEstimateEmail"), f.indexOf("export async function processDueFollowups"));
    expect(s.indexOf("if (!r.sent) return r")).toBeLessThan(s.indexOf("planInitialFollowups"));
  });
  test("ineligible: official recorded result only, all locks, per-job key, no follow-ups, send marked after deliver", () => {
    const s = f.slice(f.indexOf("export async function sendPreliminaryIneligibleEmail"));
    expect(f).toContain("officialOutcomeForDelivery");
    expect(s).toContain('official.kind !== "ineligible"');
    expect(s).toContain("customerCommsEnabled()");
    expect(s).toContain("hasCurrentOwnerContactConsent");
    expect(s).toContain('if (ex?.status === "sent")');
    expect(s).not.toMatch(/customer_followups|planInitialFollowups/);
    expect(s.indexOf("adapter.deliver(")).toBeLessThan(s.indexOf('status: "sent"'));
    expect(f).toContain("`${INELIGIBLE_PURPOSE}:${jobId}`");
  });
});

// The old preliminary ineligible renderer was removed on 24 Oct 2026 (the approved O6 Not eligible email replaced it);
// its shared reason filter is still used by the live ineligible path.
describe("ineligible reason filter", () => {
  test("internal codes dropped; plain reasons kept", () => {
    expect(safeReason("REVIEW REQUIRED internal")).toBeNull();
    expect(safeReason("The home was built less than 5 years ago.")).toBe("The home was built less than 5 years ago.");
  });
});

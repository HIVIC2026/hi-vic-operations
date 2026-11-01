// Step 3 secure no-login link: pure rules + static wiring assertions.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { deliveryState, expiryFrom, isWellFormedToken, linkAllowed, linkUsable, newToken, planLink, publicPayload } from "../src/lib/estimatelink.core";

const worker = readFileSync("src/lib/postintake.server.ts", "utf8");
const portal = readFileSync("src/lib/portal.functions.ts", "utf8");
const server = readFileSync("src/lib/estimatelink.server.ts", "utf8");
const fns = readFileSync("src/lib/estimate.functions.ts", "utf8");
const route = readFileSync("src/routes/estimate.$token.tsx", "utf8");
const ui = readFileSync("src/components/portal/estimate.tsx", "utf8");
const engagementServer = readFileSync("src/lib/engagement.server.ts", "utf8");
const mig = readFileSync("drizzle/migrations/0035_customer_estimate_links.sql", "utf8");
const NOW = Date.parse("2026-09-29T00:00:00Z");

describe("token", () => {
  it("is >=256 bits, URL-safe and unique", () => {
    const t = newToken();
    expect(t.length).toBe(43); // 32 bytes base64url
    expect(isWellFormedToken(t)).toBe(true);
    expect(new Set(Array.from({ length: 200 }, newToken)).size).toBe(200);
  });
  it("rejects malformed tokens", () => {
    for (const bad of [undefined, null, "", "abc", "x".repeat(42), "a b".repeat(20), "../".repeat(20), 123]) expect(isWellFormedToken(bad)).toBe(false);
  });
});

describe("link lifecycle", () => {
  const active = { id: "1", status: "active", expires_at: new Date(NOW + 86_400_000).toISOString() };
  const expired = { id: "2", status: "active", expires_at: new Date(NOW - 1).toISOString() };
  it("likely/onsite allowed; review/fail/none not (rollout hold irrelevant)", () => {
    expect(linkAllowed("likely")).toBe(true); expect(linkAllowed("onsite")).toBe(true);
    for (const m of ["withheld_review", "none_ineligible", "none_undecided"]) expect(linkAllowed(m)).toBe(false);
  });
  it("repeat ensure reuses the active link", () => expect(planLink(active, true, NOW).action).toBe("reuse"));
  it("issues when none exists", () => expect(planLink(null, true, NOW).action).toBe("issue"));
  it("review/hard fail revokes existing link; nothing to do if none", () => {
    expect(planLink(active, false, NOW).action).toBe("revoke");
    expect(planLink(null, false, NOW).action).toBe("none");
  });
  // Jo 1 Nov 2026: owner links have no time limit; a past expires_at is ignored and the same link is reused.
  it("no time limit: an old active link is reused, never re-issued", () => {
    expect(expiryFrom(NOW)).toBe("9999-12-31T00:00:00.000Z");
    expect(planLink(expired, true, NOW)).toEqual({ action: "reuse" });
  });
  it("revoked links fail closed; a past date alone does not", () => {
    expect(linkUsable(active, NOW)).toBe(true);
    expect(linkUsable(expired, NOW)).toBe(true);
    expect(linkUsable({ ...active, status: "revoked" }, NOW)).toBe(false);
    expect(linkUsable(null, NOW)).toBe(false);
  });
});

describe("delivery readiness", () => {
  it("consent + comms OFF => prepared, not deliverable", () => expect(deliveryState({ activeLink: true, consent: true, commsEnabled: false })).toBe("prepared_delivery_locked"));
  it("consent + comms ON => ready", () => expect(deliveryState({ activeLink: true, consent: true, commsEnabled: true })).toBe("ready"));
  it("no consent => not ready; no link => no_link", () => {
    expect(deliveryState({ activeLink: true, consent: false, commsEnabled: true })).toBe("prepared_no_consent");
    expect(deliveryState({ activeLink: false, consent: true, commsEnabled: true })).toBe("no_link");
  });
  it("no sending code anywhere in link module", () => {
    for (const bad of ["recordCommunication", "CONNECTED_COMMS_ADAPTERS", "sendMessage", "xero", "mitti", "confirmBooking"]) expect(server).not.toContain(bad);
  });
});

describe("wiring", () => {
  it("worker syncs Step 3 after Gate 1 and before completing", () => {
    const g = worker.indexOf("autoDecideEligibility(item.job_id"), s = worker.indexOf("syncStep3(item.job_id"), c = worker.indexOf('status: "complete"');
    expect(g).toBeGreaterThan(0); expect(s).toBeGreaterThan(g); expect(c).toBeGreaterThan(s);
  });
  it("admin setEligibility syncs Step 3 after persisting and never throws Gate 1 away", () => {
    const u = portal.indexOf('eligibility_decision_source: "admin"'), s = portal.indexOf("syncStep3(data.jobId");
    expect(s).toBeGreaterThan(u);
  });
  it("public resolver re-evaluates Gate 1 and revokes if no longer allowed", () => {
    expect(server).toMatch(/resolvePublicEstimate[\s\S]*refreshIndicativeEstimate\(l\.job_id\)[\s\S]*linkAllowed\(view\.mode\)[\s\S]*revokeActive/);
    expect(server).toContain("view_count");
  });
  it("public payload is whitelisted: no email/phone/audit/supplier/margin", () => {
    const p = JSON.stringify(publicPayload({ job_number: "HV-1", address: "1 A St" }, { visible: true }));
    expect(Object.keys(JSON.parse(p))).toEqual(["job", "estimate", "referralShareUrl"]);
    const sel = server.slice(server.indexOf("resolvePublicEstimate"), server.indexOf("estimateDeliveryReady"));
    for (const bad of ["email", "phone", "history", "snapshot", "margin", "cost", "internal_notes"]) expect(sel).not.toContain(bad);
    expect(sel).toContain("customerView(view)");
  });
  it("public fn needs no login; admin link fns require admin; status never selects token", () => {
    expect(fns).toMatch(/getPublicEstimate = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[withRequestMeta\]\)\s*\.inputValidator/);
    expect(fns.slice(fns.indexOf("getPublicEstimate"), fns.indexOf("getAdminEstimateLink ="))).not.toContain("requireSupabaseAuth");
    expect(fns).toMatch(/getAdminEstimateLinkUrl[\s\S]*requireAdmin/);
    const st = server.slice(server.indexOf("export async function adminLinkStatus"), server.indexOf("export async function adminLinkPath"));
    expect(st.split("\n").filter((l) => l.includes(".select(")).join("")).not.toContain("token");
  });
  it("route: no-store, no-referrer and noindex", () => {
    for (const s of ["no-store", "no-referrer", "noindex, nofollow", "ssr: false"]) expect(route).toContain(s);
  });
  it("secure estimate supports the separate free Ready Check request", () => {
    expect(route).toContain('window.location.hash === "#confirm"');
    for (const copy of ["FREE_CHECK_CONFIRM_COPY", "C.name", "C.cta", "Test mode · no live booking will be created", "Back to my estimate"]) expect(ui).toContain(copy);
    expect(ui).not.toMatch(/stripe|checkout|paymentIntent|card number/i);
    expect(engagementServer).toContain('t.purpose === "step3_estimate" ? "#confirm" : ""');
  });
  it("secure estimate no longer embeds the retired calculator", () => {
    expect(ui).not.toContain("AreaCalculator");
    expect(route).not.toContain('window.location.hash === "#calculator"');
    expect(route).not.toContain("onCalculatorUse");
  });
  it("table: RLS on, no anon/authenticated access, one active link per job", () => {
    expect(mig).toContain("ENABLE ROW LEVEL SECURITY");
    expect(mig).toContain("REVOKE ALL ON public.customer_estimate_links FROM anon, authenticated");
    expect(mig).not.toContain("CREATE POLICY");
    expect(mig).toContain("WHERE status = 'active'");
  });
});

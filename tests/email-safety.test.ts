import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { emailSuppression, isTestRecipient, reservationAllowed, statusAfterDelivery, UNSUBSCRIBE_LINK_SLOT, unsubscribeUrl, withUnsubscribe, type SafetyInput } from "../src/lib/emailsafety.core";
import { renderFollowupEmail } from "../src/lib/followup-email";
import { renderIneligibleEmail } from "../src/lib/ineligible-email";

const NOW = Date.parse("2026-10-10T00:00:00Z");
const base: SafetyInput = { purpose: "step3_estimate", optedOut: false, bounced: false, stage: "new_enquiry", jobSource: "base44", jobCreatedAt: "2026-10-09T00:00:00Z", recipient: "owner@gmail.com", jobsCreatedAfter: "2026-10-01T00:00:00Z", now: NOW };
const TOK = "A".repeat(43);

describe("suppression", () => {
  test("clean fresh job allowed", () => expect(emailSuppression(base)).toBeNull());
  test("opt-out and bounce win", () => {
    expect(emailSuppression({ ...base, optedOut: true })).toBe("unsubscribed");
    expect(emailSuppression({ ...base, bounced: true })).toBe("bounced");
  });
  test("QA / example recipients never emailed", () => {
    expect(emailSuppression({ ...base, jobSource: "qa_test" })).toBe("test_or_example_recipient");
    for (const e of ["a@example.com", "x@foo.test", "qa.jo@gmail.com", "a+qa@gmail.com", "z@mailinator.com", null]) expect(isTestRecipient(e)).toBe(true);
    expect(isTestRecipient("jo.lowe@gmail.com")).toBe(false);
  });
  test("closed / progressed / booked / paid stages suppress estimate + follow-ups", () => {
    for (const stage of ["cancelled", "complete", "on_hold", "assessment_booked", "awaiting_deposit_payment", "installation_booked"])
      for (const purpose of ["step3_estimate", "followup"] as const) expect(emailSuppression({ ...base, stage, purpose })).toBe("job_progressed_or_closed");
    expect(emailSuppression({ ...base, purpose: "preliminary_ineligible", stage: "on_hold" })).toBeNull();
    expect(emailSuppression({ ...base, purpose: "preliminary_ineligible", stage: "cancelled" })).toBe("job_progressed_or_closed");
  });
  test("backlog cannot suddenly receive email", () => {
    expect(emailSuppression({ ...base, jobsCreatedAfter: null })).toBe("backlog_cutoff_not_set");
    expect(emailSuppression({ ...base, jobCreatedAt: "2026-09-20T00:00:00Z" })).toBe("backlog_before_cutoff");
    expect(emailSuppression({ ...base, jobsCreatedAfter: "2026-01-01T00:00:00Z", jobCreatedAt: "2026-09-01T00:00:00Z" })).toBe("backlog_too_old");
  });
});

describe("duplicate prevention", () => {
  test("only clean failures may re-call the provider", () => {
    expect(reservationAllowed(null)).toBe(true);
    expect(reservationAllowed({ status: "failed" })).toBe(true);
    for (const status of ["sent", "sending", "delivered_unrecorded"]) expect(reservationAllowed({ status })).toBe(false);
    expect(statusAfterDelivery(false)).toBe("delivered_unrecorded");
  });
  test("simulated provider success + DB failure never resends", async () => {
    let calls = 0; const rows = new Map<string, { status: string }>();
    const attempt = async (dbFails: boolean) => {
      const ex = rows.get("k") ?? null; if (!reservationAllowed(ex)) return "skipped";
      rows.set("k", { status: "sending" }); let delivered = false;
      try { calls++; delivered = true; if (dbFails) throw new Error("db down"); rows.set("k", { status: "sent" }); return "sent"; }
      catch { rows.set("k", { status: delivered ? statusAfterDelivery(false) : "failed" }); return "err"; }
    };
    expect(await attempt(true)).toBe("err");
    expect(await attempt(false)).toBe("skipped");
    expect(calls).toBe(1);
  });
  test("senders wire the guards", () => {
    const f = readFileSync("src/lib/followups.server.ts", "utf8");
    expect(f.match(/delivered = true/g)?.length).toBe(2);
    // P1-R3-S92: three customer email paths in this file — the Jo-rendered ineligible result (T7),
    // the follow-up and the outcome email. Every one of them is still wrapped in withUnsubscribe,
    // so the invariant (no customer email ships without a working unsubscribe link) is unchanged.
    expect(f.match(/withUnsubscribe\(/g)?.length).toBe(3);
    // Every withUnsubscribe call must pair with a real delivered subject: no ship-without-unsubscribe path.
    expect((f.match(/withUnsubscribe\(/g) ?? []).length).toBeGreaterThanOrEqual(
      (f.match(/adapter\.deliver\(/g) ?? []).length,
    );
    expect(f.match(/suppressionFor\(/g)?.length).toBe(3);
    expect(f).not.toMatch(/10 \* 60_000/);
  });
});

describe("unsubscribe", () => {
  const url = unsubscribeUrl(TOK);
  test("every customer email gets a working link", () => {
    for (const m of [renderFollowupEmail({ kind: "estimate_unopened_3d", estimateUrl: `https://estimate.homeinsulationvictoria.com.au/estimate/${TOK}` }), renderIneligibleEmail({ referralUrl: `https://homeinsulationvictoria.com.au/homeowner?ref=${TOK}` })]) {
      const w = withUnsubscribe(m, url);
      expect(w.html).toContain(`href="${url}"`); expect(w.plainText).toContain(`Unsubscribe: ${url}`);
      expect(w.html.indexOf("Unsubscribe")).toBeLessThan(w.html.indexOf("</body>"));
    }
  });
  test("opt-in footer slot receives one real link while standard emails keep the fallback", () => {
    const slotted = withUnsubscribe({ html: `<html><body><footer>${UNSUBSCRIBE_LINK_SLOT}</footer></body></html>`, plainText: "Footer" }, url);
    expect(slotted.html.split(`href="${url}"`).length - 1).toBe(1);
    expect(slotted.html).not.toContain(UNSUBSCRIBE_LINK_SLOT);
    expect(slotted.html).not.toContain("Don’t want these emails?");
    const standard = withUnsubscribe({ html: "<html><body>Standard</body></html>", plainText: "Standard" }, url);
    expect(standard.html).toContain("Don’t want these emails?");
    expect(standard.html).toContain(`href="${url}"`);
  });
  test("bad URLs rejected", () => { expect(() => withUnsubscribe({ html: "", plainText: "" }, "https://evil.example/x")).toThrow(); });
  test("route: GET never opts out, POST does; opt-out closes consent + follow-ups", () => {
    const r = readFileSync("src/routes/api/public/unsubscribe.ts", "utf8");
    const get = r.slice(r.indexOf("GET:"), r.indexOf("POST:"));
    expect(get).not.toContain("recordUnsubscribe");
    expect(r.slice(r.indexOf("POST:"))).toContain("recordUnsubscribe");
    const s = readFileSync("src/lib/emailsafety.server.ts", "utf8");
    expect(s).toContain('consent_status: "not_granted"');
    expect(s).toContain('suppression_reason: "unsubscribed"');
  });
});

import { DeliveryRejectedError, statusAfterDeliveryError } from "../src/lib/delivery.core";
test("timeout after provider may have accepted -> sent-unknown, never auto-retried", () => {
  expect(statusAfterDeliveryError(new DOMException("timeout", "TimeoutError"))).toBe("delivered_unrecorded");
  expect(statusAfterDeliveryError(new TypeError("fetch failed"))).toBe("delivered_unrecorded");
  expect(statusAfterDeliveryError(new DeliveryRejectedError("bridge returned 500"))).toBe("failed");
  expect(statusAfterDeliveryError(new DeliveryRejectedError("x"), true)).toBe("delivered_unrecorded");
});

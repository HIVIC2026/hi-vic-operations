// Functional check of the Base44 enquiry webhook response: it must be able to include
// referral_share_url (full homeinsulationvictoria.com.au share URL only) and never a raw token.
import { describe, expect, mock, test } from "bun:test";
import { newReferralToken, referralShareUrl } from "../src/lib/referral.core";

const TOKEN = newReferralToken();
const JOB = "7f1c2b9e-1111-4222-8333-944455556666";
const inserts: unknown[] = [];
const fakeAdmin = {
  from: (_table: string) => ({
    insert: (row: unknown) => {
      inserts.push(row);
      return Promise.resolve({ error: null });
    },
  }),
};
let failReferral = false;
let thrown = false;

// Spread the real modules and only bypass while this file runs, so other test files see real behaviour.
let active = true;
const realCore = { ...(await import("../src/lib/enquiry.core")) };
const realServer = { ...(await import("../src/lib/enquiry.server")) };
mock.module("@/lib/enquiry.core", () => ({ ...realCore, verifyEd25519: async (...a: Parameters<typeof realCore.verifyEd25519>) => (active ? true : realCore.verifyEd25519(...a)) }));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
mock.module("@/lib/enquiry.server", () => ({
  ...realServer,
  enquirySchema: { ...realServer.enquirySchema, safeParse: (d: unknown) => (active ? { success: true, data: d } : realServer.enquirySchema.safeParse(d)) },
  upsertEnquiry: async (...a: unknown[]) => {
    if (!active) return (realServer.upsertEnquiry as (...x: unknown[]) => unknown)(...a);
    if (thrown) throw new Error("boom");
    return { job_id: JOB, created: false };
  },
}));
mock.module("@/lib/referral.server", () => ({
  referralUrlForJob: async () => {
    if (failReferral) throw new Error("boom");
    return referralShareUrl(TOKEN);
  },
}));

const { Route } = await import("../src/routes/api/public/enquiry");
// File routes expose the server handlers under Route.options.server.
const POST = Route.options.server!.handlers.POST as (ctx: { request: Request }) => Promise<Response>;

async function post(body: unknown) {
  return POST({
    request: new Request("http://localhost/api/public/enquiry", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hivic-key-id": "base44-v1", "x-hivic-signature": "sig" },
      body: JSON.stringify(body),
    }),
  });
}

import { afterAll } from "bun:test";
afterAll(() => { active = false; });

describe("Base44 enquiry response referral share URL", () => {
  test("successful enquiry returns referral_share_url — full URL only, no raw token field", async () => {
    const res = await post({ external_enquiry_id: "ENQ_1" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    const url = json.referral_share_url as string;
    expect(url).toMatch(/^https:\/\/homeinsulationvictoria\.com\.au\/homeowner\?ref=[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(json)).not.toMatch(/"token"/);
    expect(url).toContain(TOKEN); // the token exists only inside the share URL
    expect(Object.keys(json).sort()).toEqual(["created", "customer_email_enabled", "job_id", "ok", "referral_share_url"]);
    expect(inserts.length).toBe(1);
  });

  test("referral failure does not fail the enquiry — referral_share_url is null", async () => {
    failReferral = true;
    try {
      const res = await post({ external_enquiry_id: "ENQ_2" });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.referral_share_url).toBeNull();
      expect(json.ok).toBe(true);
    } finally {
      failReferral = false;
    }
  });

  test("enquiry failure still returns 500 and no referral URL", async () => {
    thrown = true;
    try {
      const res = await post({ external_enquiry_id: "ENQ_3" });
      expect(res.status).toBe(500);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.referral_share_url).toBeUndefined();
    } finally {
      thrown = false;
    }
  });
});

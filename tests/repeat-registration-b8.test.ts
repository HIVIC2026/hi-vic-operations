import { expect, mock, test } from "bun:test";

mock.module("@tanstack/react-start", () => ({ createServerFn: () => ({ middleware() { return this; }, inputValidator() { return this; }, handler(fn: unknown) { return fn; } }) }));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: async () => ({ data: true, error: null }) }) }));
let registrations = 0, starts = 0, open = false;
const jobs = new Set<string>();
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: `new-${++registrations}`, consented_at: "2026-11-01T10:00:00Z" }, error: null }) }) }), update: () => ({ eq: async () => ({ error: null }) }) }),
} }));
mock.module("../src/lib/calculator-intake.server", () => ({ startCalculatorEnquiry: async () => { starts++; if (!open) jobs.add("new-job"); return { jobId: open ? "open-job" : "new-job", created: !open }; } }));
const { registerInterest } = await import("../src/lib/interest.functions");
const input = { fullName: "Fixture Owner", email: "owner@example.com", mobile: "0400123456", addressLine: "12 Test Street", suburb: "Richmond", postcode: "3121", ceilingM2: 150, insulationDeclared: "unknown", consent: true, honeypot: "" };
test("repeat contact after a closed job still reaches normal address/job intake", async () => {
  const r = await registerInterest({ data: input } as never);
  expect(r).toEqual({ ok: true, duplicate: false }); expect(registrations).toBe(1); expect(starts).toBe(1); expect(jobs.size).toBe(1);
});
test("repeat at an open address reaches the shared matcher, never creates a second job", async () => {
  open = true; const previous = jobs.size;
  await registerInterest({ data: { ...input, email: "different@example.com" } } as never);
  expect(starts).toBe(2); expect(jobs.size).toBe(previous);
});
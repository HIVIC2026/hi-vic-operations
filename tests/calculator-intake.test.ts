import { expect, mock, test } from "bun:test";

const jobs = new Map<string, { id: string; job_number: string; source: string; key: string; external_refs: Record<string, unknown> }>();
const calls: { source: string; external: string }[] = [];
const updates: { table: string; patch: Record<string, unknown> }[] = [];
const events: string[] = [];
let queued = 0;

mock.module("../src/lib/enquiry.server", () => ({
  // Stand-in for the website intake: same person + address = the same job (the real rule lives in upsertEnquiry).
  upsertEnquiry: async (input: { email: string; address_line: string; external_enquiry_id: string }, source: string) => {
    calls.push({ source, external: input.external_enquiry_id });
    const key = `${input.email}|${input.address_line}`;
    const hit = [...jobs.values()].find((j) => j.key === key);
    if (hit) return { job_id: hit.id, job_number: hit.job_number, created: false, post_intake: "none" };
    const id = `job-${jobs.size + 1}`;
    jobs.set(id, { id, job_number: `HV-T${jobs.size + 1}`, source, key, external_refs: {} });
    if (source === "base44") queued++; // initial Gate 1 queued -> automatic Save my spot routing (switch decides sending)
    return { job_id: id, job_number: `HV-T${jobs.size}`, created: true, post_intake: source === "base44" ? "queued" : "none" };
  },
}));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (_j: string, _a: unknown, type: string) => { events.push(type); } }));
mock.module("../src/lib/intake.server", () => ({ recordContactConsent: async () => { events.push("consent"); } }));
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  let patch: Record<string, unknown> | null = null; let id: string | null = null;
  const q: any = {
    select() { return q; }, update(p: Record<string, unknown>) { patch = p; return q; },
    eq(_c: string, v: string) { id = v; return q; }, maybeSingle() { return q; }, single() { return q; },
    then(res: (v: unknown) => void) {
      if (patch) { updates.push({ table, patch }); if (table === "jobs" && id && jobs.get(id)) jobs.get(id)!.external_refs = patch["external_refs"] as never; }
      return Promise.resolve({ data: table === "jobs" && id ? { ...jobs.get(id), owner_id: "owner-1" } : null, error: null }).then(res);
    },
  }; return q;
} } }));

const { startCalculatorEnquiry } = await import("../src/lib/calculator-intake.server");
const { qaInboxRoute, QA_INBOX } = await import("../src/lib/qa-inbox.core");
const person = (email: string) => ({ fullName: "Sam Test", mobile: "0400000000", email, addressLine: "1 Test St", suburb: "Frankston", postcode: "3199", ceilingM2: 120, insulationDeclared: "none" as const, consentVersion: "interest-2026-10-01" });

test("a calculator registration creates one website-path enquiry, queues Save my spot routing, and is marked calculator", async () => {
  const r = await startCalculatorEnquiry("int-1", person("sam@example.com"), "2026-10-27T11:00:00Z");
  expect(r.created).toBe(true);
  expect(r.source).toBe("base44");
  expect(calls[0]).toEqual({ source: "base44", external: "calculator:int-1" });
  expect(queued).toBe(1); // counted, nothing sent here
  expect(jobs.get(r.jobId!)!.external_refs["intake_channel"]).toBe("calculator");
  expect(updates.some((u) => u.table === "calculator_interests" && u.patch["job_id"] === r.jobId)).toBe(true);
  expect(events).toContain("calculator_registration");
});

test("the same person again does not create a second enquiry", async () => {
  const r = await startCalculatorEnquiry("int-2", person("sam@example.com"), "2026-10-27T11:05:00Z");
  expect(r.created).toBe(false);
  expect(jobs.size).toBe(1);
  expect(queued).toBe(1);
});

test("a TEST-domain registration is qa_test, keeps consent, and its email routes to Jo's TEST inbox", async () => {
  const r = await startCalculatorEnquiry("int-3", person("calc@hivic-test.example"), "2026-10-27T11:10:00Z");
  expect(r.source).toBe("qa_test");
  expect(jobs.get(r.jobId!)!.source).toBe("qa_test");
  expect(events).toContain("consent");
  expect(queued).toBe(1); // no live automation for TEST
  expect(qaInboxRoute(jobs.get(r.jobId!)!.source, "calc@hivic-test.example")?.to).toBe(QA_INBOX);
});

test("no ceiling size: not started, reason kept on the registration", async () => {
  const r = await startCalculatorEnquiry("int-4", { ...person("x@example.com"), ceilingM2: 0 }, "2026-10-27T11:15:00Z");
  expect(r.jobId).toBeNull();
  expect(r.blocker).toContain("ceiling size");
});

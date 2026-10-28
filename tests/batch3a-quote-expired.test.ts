// Batch 3a Task 1: an expired installation quote closes the job (once) and emails the owner once. Fake database + recorded fakes.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const get = (r: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
function fakeAdmin() {
  return {
    from(table: string) {
      let op: "select" | "update" = "select"; let payload: Row | null = null; let ret = false; let one = false;
      const preds: ((r: Row) => boolean)[] = [];
      const b: Record<string, unknown> & PromiseLike<unknown> = {
        select() { if (op === "update") ret = true; return b; },
        eq(c: string, v: unknown) { preds.push((r) => get(r, c) === v); return b; },
        neq(c: string, v: unknown) { preds.push((r) => get(r, c) !== v); return b; },
        not(c: string, _o: string, v: unknown) { preds.push((r) => get(r, c) !== v); return b; },
        is(c: string, v: unknown) { preds.push((r) => (get(r, c) ?? null) === v); return b; },
        order() { return b; }, limit() { return b; },
        maybeSingle() { one = true; return b; }, single() { one = true; return b; },
        update(p: Row) { op = "update"; payload = p; return b; },
        then(res, rej) {
          const hit = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
          if (op === "update") { for (const r of hit) Object.assign(r, payload); return Promise.resolve({ data: ret ? (one ? hit[0] ?? null : hit) : null, error: null }).then(res, rej); }
          return Promise.resolve({ data: one ? hit[0] ?? null : hit, error: null }).then(res, rej);
        },
      };
      return b;
    },
  };
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin() }));
const events: { jobId: string; type: string; summary: string }[] = [];
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (jobId: string, _a: unknown, type: string, summary: string) => { events.push({ jobId, type, summary }); } }));
const cancels: { jobId: string; reason: string; actor: unknown; opts: unknown }[] = [];
mock.module("../src/lib/office-actions.server", () => ({
  cancelJobFully: async (jobId: string, reason: string, actor: unknown, opts: unknown) => {
    cancels.push({ jobId, reason, actor, opts });
    const j = tables["jobs"]!.find((x) => x["id"] === jobId); if (j) j["stage"] = "cancelled";
  },
}));
let deliveryAllowed = true;
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => { if (!deliveryAllowed) throw new Error("Customer messages are switched off"); } }));
const sent: { via: string; to: string; subject: string; text: string; html: string; key?: string }[] = [];
const once = new Set<string>();
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: { to: string; key: string; build: (u: string | null) => { subject: string; text: string; html: string } }) => {
    if (once.has(p.key)) return "already attempted — not resent";
    once.add(p.key); const m = p.build("https://u"); sent.push({ via: "live", to: p.to, subject: m.subject, text: m.text, html: m.html, key: p.key }); return "sent";
  },
}));
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (_c: Row, to: string, subject: string, html: string, text: string) => { sent.push({ via: "test", to, subject, html, text }); return { status: "sent", detail: "ok" }; },
}));
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async () => "https://estimate.homeinsulationvictoria.com.au/my-job/TOKEN" }));

const { sweepQuoteExpiry } = await import("../src/lib/quote-expiry.server");
const NOW = new Date("2026-03-20T00:00:00Z");
const OLD = "2026-02-28T23:00:00Z";

function seed(over: { stage?: string; source?: string; others?: string[] } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  sent.length = 0; cancels.length = 0; events.length = 0; once.clear(); deliveryAllowed = true;
  tables["jobs"] = [{ id: "J1", stage: over.stage ?? "quoted", source: over.source ?? "website", owners: { full_name: "Helen Smith", email: "helen@example.com" }, properties: { address_line: "12 Example St", suburb: "Sampletown" } }];
  tables["quotes"] = [{ id: "Q1", job_id: "J1", kind: "installation", status: "issued", sent_at: OLD, nudge_day3_at: "x", nudge_day10_at: "y" },
    ...(over.others ?? []).map((s, i) => ({ id: `QX${i}`, job_id: "J1", kind: "installation", status: s, sent_at: null, nudge_day3_at: null, nudge_day10_at: null }))];
  tables["job_assignments"] = [];
}

describe("expired quote closes the job and emails the owner once", () => {
  beforeEach(() => seed());
  test("closes the job once and sends the approved email once", async () => {
    const r = await sweepQuoteExpiry(NOW);
    expect(r.expired).toBe(1);
    expect(cancels).toEqual([{ jobId: "J1", reason: "Quote expired (14 days)", actor: null, opts: { tell: { owner: false, installer: true } } }]);
    expect(sent.length).toBe(1);
    const m = sent[0]!;
    expect(m.key).toBe("quote-expired:v1:Q1");
    expect(m.to).toBe("helen@example.com");
    expect(m.subject).toBe("Your quote has expired");
    expect(m.text).toContain("Hi Helen, your insulation quote for 12 Example St, Sampletown has now expired. If you'd still like to go ahead, tap below and we'll prepare a new quote at today's prices.");
    expect(m.text).toContain("Send me a new quote: https://estimate.homeinsulationvictoria.com.au/my-job/TOKEN?screen=newquote");
    expect(m.text).toContain("Cheers, the Home Insulation Victoria team");
    expect(m.html).toContain('href="https://estimate.homeinsulationvictoria.com.au/my-job/TOKEN?screen=newquote"');
    expect(m.html).toContain("Send me a new quote");
  });
  test("sweeping twice does not cancel or email again", async () => {
    await sweepQuoteExpiry(NOW); await sweepQuoteExpiry(NOW);
    expect(cancels.length).toBe(1); expect(sent.length).toBe(1);
  });
  test("another issued or accepted installation quote keeps the job open and sends nothing", async () => {
    for (const other of ["issued", "accepted"]) {
      seed({ others: [other] });
      const r = await sweepQuoteExpiry(NOW);
      expect(r.expired).toBe(1); expect(cancels.length).toBe(0); expect(sent.length).toBe(0);
    }
  });
  test("an old expired or declined quote on the job does not stop the close", async () => {
    seed({ others: ["expired", "declined", "superseded"] });
    await sweepQuoteExpiry(NOW);
    expect(cancels.length).toBe(1); expect(sent.length).toBe(1);
  });
  test("a cancelled or complete job is left alone", async () => {
    for (const stage of ["cancelled", "complete"]) {
      seed({ stage });
      await sweepQuoteExpiry(NOW);
      expect(cancels.length).toBe(0); expect(sent.length).toBe(0);
    }
  });
  test("a TEST job goes through test-send, not the live sender", async () => {
    seed({ source: "qa_test" });
    await sweepQuoteExpiry(NOW);
    expect(cancels.length).toBe(1);
    expect(sent.map((s) => s.via)).toEqual(["test"]);
    expect(sent[0]!.subject).toBe("Your quote has expired");
  });
  test("customer messages switched off: job still closes, no email", async () => {
    deliveryAllowed = false;
    await sweepQuoteExpiry(NOW);
    expect(cancels.length).toBe(1); expect(sent.length).toBe(0);
  });
  test("a failed close is recorded and the quote stays expired", async () => {
    tables["jobs"]![0]!["stage"] = "quoted";
    const m = await import("../src/lib/office-actions.server");
    const orig = m.cancelJobFully;
    mock.module("../src/lib/office-actions.server", () => ({ cancelJobFully: async () => { throw new Error("boom"); } }));
    const r = await sweepQuoteExpiry(NOW);
    mock.module("../src/lib/office-actions.server", () => ({ cancelJobFully: orig }));
    expect(r.expired).toBe(1); expect(sent.length).toBe(0);
    expect(events.some((e) => e.type === "quote_expired_close_failed")).toBe(true);
  });
});

describe("O78 design and sign-off", () => {
  test("the MJML design carries the approved wording", () => {
    const d = readFileSync("docs/templates/mjml/owner_O78.mjml", "utf8");
    for (const s of ["Your quote has expired", "Send me a new quote", "?screen=newquote", "Cheers, the Home Insulation Victoria team", "has now expired. If you'd still like to go ahead, tap below and we'll prepare a new quote at today's prices."]) expect(d).toContain(s);
  });
});

// Batch 3a Task 1: an expired installation quote closes the job (once) and emails the owner once. Fake database + recorded fakes.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildNeedsRows, quoteExpiredBlockedFact } from "../src/lib/office-needs.core";

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
        contains(c: string, v: Row) { preds.push((r) => Object.entries(v).every(([k, x]) => ((get(r, c) as Row | null)?.[k]) === x)); return b; },
        in(c: string, v: unknown[]) { preds.push((r) => v.includes(get(r, c))); return b; },
        gte(c: string, v: string) { preds.push((r) => String(get(r, c)) >= v); return b; },
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
let evClock = Date.parse("2026-03-20T00:00:00Z");
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (jobId: string, _a: unknown, type: string, summary: string, details: Row = {}) => {
  if (failMarker && type === "quote_expired_cancelled") throw new Error("write failed");
  events.push({ jobId, type, summary });
  evClock += 1000; (tables["workflow_events"] ??= []).push({ id: crypto.randomUUID(), job_id: jobId, event_type: type, summary, details, created_at: new Date(evClock).toISOString() });
} }));
const cancels: { jobId: string; reason: string; actor: unknown; opts: unknown }[] = [];
mock.module("../src/lib/office-actions.server", () => ({
  cancelJobFully: async (jobId: string, reason: string, actor: unknown, opts: unknown) => {
    if (cancelFails) { cancelFails = false; throw new Error("boom"); }
    cancels.push({ jobId, reason, actor, opts });
    const j = tables["jobs"]!.find((x) => x["id"] === jobId); if (j) { j["stage"] = "cancelled"; j["cancelled_reason"] = reason; }
  },
}));
let failMarker = false; let cancelFails = false; let deliveryAllowed = true; let consent = true; let linkOk = true; let emailFailsOnce = false;
mock.module("../src/lib/comms.server", () => ({
  assertCustomerDeliveryAllowed: async () => { if (!deliveryAllowed) throw new Error("Customer messages are switched off"); },
  customerCommsEnabled: async () => deliveryAllowed, hasCurrentOwnerContactConsent: async () => consent,
}));
const sent: { via: string; to: string; subject: string; text: string; html: string; key?: string }[] = [];
const once = new Set<string>();
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: { to: string; key: string; build: (u: string | null) => { subject: string; text: string; html: string } }) => {
    if (once.has(p.key)) return "already attempted — not resent";
    if (emailFailsOnce) { emailFailsOnce = false; return "failed: provider refused"; }
    once.add(p.key); const m = p.build("https://u"); sent.push({ via: "live", to: p.to, subject: m.subject, text: m.text, html: m.html, key: p.key }); return "sent";
  },
}));
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (_c: Row, to: string, subject: string, html: string, text: string) => { sent.push({ via: "test", to, subject, html, text }); return { status: "sent", detail: "ok" }; },
}));
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async () => (linkOk ? "https://estimate.homeinsulationvictoria.com.au/my-job/TOKEN" : null) }));

const { sweepQuoteExpiry } = await import("../src/lib/quote-expiry.server");
const NOW = new Date("2026-03-20T00:00:00Z");
const OLD = "2026-02-28T23:00:00Z";

function seed(over: { stage?: string; source?: string; others?: string[] } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  sent.length = 0; cancels.length = 0; events.length = 0; once.clear(); deliveryAllowed = true; consent = true; linkOk = true; cancelFails = false; emailFailsOnce = false; failMarker = false;
  tables["jobs"] = [{ id: "J1", stage: over.stage ?? "quoted", source: over.source ?? "website", owners: { full_name: "Helen Smith", email: "helen@example.com" }, properties: { address_line: "12 Example St", suburb: "Sampletown" } }];
  tables["quotes"] = [{ id: "Q1", job_id: "J1", kind: "installation", status: "issued", sent_at: OLD, expired_at: null, nudge_day3_at: "x", nudge_day10_at: "y" },
    ...(over.others ?? []).map((s, i) => ({ id: `QX${i}`, job_id: "J1", kind: "installation", status: s, sent_at: null, nudge_day3_at: null, nudge_day10_at: null }))];
  tables["job_assignments"] = []; tables["workflow_events"] = [];
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
  test("first sweep: the close fails -> second sweep closes once and emails once", async () => {
    cancelFails = true;
    await sweepQuoteExpiry(NOW);
    expect(cancels.length).toBe(0); expect(sent.length).toBe(0);
    expect(events.some((e) => e.type === "quote_expired_close_failed")).toBe(true);
    await sweepQuoteExpiry(NOW); await sweepQuoteExpiry(NOW);
    expect(cancels.length).toBe(1); expect(sent.length).toBe(1);
    expect(events.filter((e) => e.type === "quote_expired_closed").length).toBe(1);
  });
  test("first sweep: the email fails definitely -> second sweep resends once, no second cancel", async () => {
    emailFailsOnce = true;
    await sweepQuoteExpiry(NOW);
    expect(cancels.length).toBe(1); expect(sent.length).toBe(0);
    expect(events.some((e) => e.type === "quote_expired_closed")).toBe(false);
    await sweepQuoteExpiry(NOW); await sweepQuoteExpiry(NOW);
    expect(cancels.length).toBe(1); expect(sent.length).toBe(1);
    expect(events.filter((e) => e.type === "quote_expired_closed").length).toBe(1);
  });
  test("owner can't be emailed for a lasting reason: job stays open, ONE Needs me row, nothing sent", async () => {
    const cases: [() => void, string][] = [
      [() => { linkOk = false; }, "no working owner link"],
      [() => { deliveryAllowed = false; }, "customer messages are switched off"],
      [() => { consent = false; }, "no contact consent"],
    ];
    for (const [setUp, reason] of cases) {
      seed(); setUp();
      await sweepQuoteExpiry(NOW); await sweepQuoteExpiry(NOW);
      expect(cancels.length).toBe(0); expect(sent.length).toBe(0);
      expect(tables["jobs"]![0]!["stage"]).toBe("quoted");
      const raised = (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === "quote_expired_not_emailable");
      expect(raised.length).toBe(1);
      const fact = quoteExpiredBlockedFact(raised.map((e) => ({ event_type: String(e["event_type"]), created_at: String(e["created_at"]), details: e["details"] as Row })));
      expect(fact?.reason).toBe(reason);
      const g = buildNeedsRows({ now: NOW.getTime(), jobs: [{ jobId: "J1", jobNumber: "HV-1", surname: "Smith", suburb: "Sampletown", quoteExpiredBlocked: fact }] });
      expect(g.today.map((r) => [r.kind, r.line, r.button.label])).toEqual([["quote_expired_blocked", `Quote expired — owner can't be emailed (${reason})`, "Open job"]]);
    }
  });
  test("once the owner can be emailed again, the job closes and the row clears", async () => {
    consent = false;
    await sweepQuoteExpiry(NOW);
    consent = true;
    await sweepQuoteExpiry(NOW);
    expect(cancels.length).toBe(1); expect(sent.length).toBe(1);
    const evs = (tables["workflow_events"] ?? []).map((e) => ({ event_type: String(e["event_type"]), created_at: String(e["created_at"]), details: e["details"] as Row }));
    expect(quoteExpiredBlockedFact(evs)).toBeNull();
  });
  test("office reopens the job after a close whose email failed: no second cancel, no email, row cleared", async () => {
    emailFailsOnce = true;
    await sweepQuoteExpiry(NOW);
    expect(cancels.length).toBe(1);
    tables["jobs"]![0]!["stage"] = "quoted"; tables["jobs"]![0]!["cancelled_reason"] = null; // office reopened
    await sweepQuoteExpiry(NOW); await sweepQuoteExpiry(NOW);
    expect(cancels.length).toBe(1); expect(sent.length).toBe(0);
    const closed = (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === "quote_expired_closed");
    expect(closed.length).toBe(1); expect((closed[0]!["details"] as Row)["superseded_by_office"]).toBe(true);
  });
  test("job cancelled for a different reason after our close: nothing more is done", async () => {
    emailFailsOnce = true;
    await sweepQuoteExpiry(NOW);
    tables["jobs"]![0]!["cancelled_reason"] = "Owner changed their mind";
    await sweepQuoteExpiry(NOW);
    expect(cancels.length).toBe(1); expect(sent.length).toBe(0);
  });
  const blockedFact = () => quoteExpiredBlockedFact((tables["workflow_events"] ?? []).map((e) => ({ event_type: String(e["event_type"]), created_at: String(e["created_at"]), details: e["details"] as Row })));
  test("the blocked row clears when the job gets a newer issued or accepted installation quote", async () => {
    for (const status of ["issued", "accepted"]) {
      seed(); consent = false;
      await sweepQuoteExpiry(NOW);
      expect(blockedFact()).not.toBeNull();
      (tables["quotes"] ??= []).push({ id: "QN", job_id: "J1", kind: "installation", status, sent_at: null, expired_at: null });
      await sweepQuoteExpiry(NOW);
      expect(blockedFact()).toBeNull(); expect(cancels.length).toBe(0); expect(sent.length).toBe(0);
    }
  });
  test("the blocked row clears when the job is closed by someone else", async () => {
    consent = false;
    await sweepQuoteExpiry(NOW);
    expect(blockedFact()).not.toBeNull();
    tables["jobs"]![0]!["stage"] = "cancelled"; tables["jobs"]![0]!["cancelled_reason"] = "Owner declined";
    await sweepQuoteExpiry(NOW);
    expect(blockedFact()).toBeNull(); expect(cancels.length).toBe(0); expect(sent.length).toBe(0);
  });
  test("the blocked row clears when the quote falls out of the 14-day window", async () => {
    consent = false;
    await sweepQuoteExpiry(NOW);
    expect(blockedFact()).not.toBeNull();
    consent = true;
    await sweepQuoteExpiry(new Date("2026-04-04T00:00:00Z")); // 15 days later, daytime
    expect(blockedFact()).toBeNull();
    const closed = (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === "quote_expired_closed");
    expect((closed[0]!["details"] as Row)["abandoned"]).toBe(true);
    expect(cancels.length).toBe(0); expect(sent.length).toBe(0);
  });
  test("a quote that expired before this change (no marker) is never closed or emailed", async () => {
    tables["quotes"]![0]!["status"] = "expired"; tables["quotes"]![0]!["expired_at"] = "2026-03-18T00:00:00Z";
    await sweepQuoteExpiry(NOW);
    expect(cancels.length).toBe(0); expect(sent.length).toBe(0);
  });
  test("a failed marker write after a successful cancel still sends the email in the same run", async () => {
    failMarker = true;
    await sweepQuoteExpiry(NOW);
    expect(cancels.length).toBe(1); expect(sent.length).toBe(1);
  });
  test("night time: 9pm marks expired but does not close; 7:15am does", async () => {
    await sweepQuoteExpiry(new Date("2026-03-20T10:00:00Z")); // 9:00pm Melbourne
    expect((tables["quotes"] ?? [])[0]!["status"]).toBe("expired");
    expect(cancels.length).toBe(0); expect(sent.length).toBe(0);
    await sweepQuoteExpiry(new Date("2026-03-20T20:15:00Z")); // 7:15am Melbourne next morning
    expect(cancels.length).toBe(1); expect(sent.length).toBe(1);
  });
});

describe("O78 design and sign-off", () => {
  test("the MJML design carries the approved wording", () => {
    const d = readFileSync("docs/templates/mjml/owner_O78.mjml", "utf8");
    for (const s of ["Your quote has expired", "Send me a new quote", "?screen=newquote", "Cheers, the Home Insulation Victoria team", "has now expired. If you'd still like to go ahead, tap below and we'll prepare a new quote at today's prices."]) expect(d).toContain(s);
  });
});

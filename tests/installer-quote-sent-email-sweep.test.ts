// The 15-minute tick retry for the installer office's "Quote sent" email (Jo 5 Nov 2026): a quote held at release (trade
// messages paused / no office email) is sent on a later sweep once the hold lifts; one already attempted is never selected
// again; HIV leads are never selected; a failed read sends nothing. Same in-memory database and recorders as the sender test.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const T: Tables = {};
const admin = memoryPostgrest(T);
const sent: { kind: string; to: string; key?: string }[] = [];
let paused: string | null = null;
let breakReads = false;

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      if (breakReads && table === "quotes") return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ not: () => ({ gte: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: "connection reset" } }) }) }) }) }) }) }) }) };
      return admin.from(table);
    },
  },
}));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details?: unknown) => { await admin.from("workflow_events").insert({ job_id, actor_id, event_type, summary, details: details ?? {} }); },
}));
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => paused }));
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { to: string; idempotencyKey?: string }) => { sent.push({ kind: "real-email", to: p.to, key: p.idempotencyKey }); return { channel: "email", to: p.to, status: "sent", detail: "ok" }; } }));
mock.module("../src/lib/test-send.server", () => ({
  TEST_APP_BASE: "https://test.example",
  sendTestEmail: async (ctx: { label: string }, to: string) => { sent.push({ kind: "test-email", to, key: ctx.label }); return { channel: "email", to, status: "sent", detail: "test" }; },
}));

const { emailInstallerQuoteSent, sweepInstallerQuoteSentEmails } = await import("../src/lib/installer-quote-sent-email.server");

const NOW = new Date("2026-11-06T03:00:00Z");
const SENT_AT = "2026-11-05T03:00:00Z";
const events = (type: string) => (T["workflow_events"] ?? []).filter((e) => e["event_type"] === type);
const attempts = () => T["customer_email_sends"] ?? [];

let n = 0;
function addJob(o: { channel?: string; sentAt?: string | null; email?: string | null; kind?: string; deleted?: string | null } = {}): { jobId: string; quoteId: string } {
  n++;
  const jobId = `job-${n}`, quoteId = `q-${n}`, biz = `biz-${n}`, prop = `prop-${n}`, own = `own-${n}`;
  T["properties"]!.push({ id: prop, address_line: `${n} Example St`, suburb: "Box Hill", postcode: "3128" });
  T["owners"]!.push({ id: own, full_name: "Sarah Brown" });
  T["jobs"]!.push({ id: jobId, job_number: `HV-${1000 + n}`, stage: "awaiting_quote_acceptance", source: "website", channel: o.channel ?? "installer_sourced", deleted_at: o.deleted ?? null, originating_installer_business_id: biz, property_id: prop, owner_id: own });
  T["businesses"]!.push({ id: biz, name: `Installer ${n}`, signer_name: "Deep Patel", email: o.email === undefined ? `office${n}@sample.example` : o.email, onboarding_notes: null });
  T["quotes"]!.push({ id: quoteId, job_id: jobId, kind: o.kind ?? "installation", status: "issued", sent_at: o.sentAt === undefined ? SENT_AT : o.sentAt, customer_total_inc_gst: "4850.00" });
  return { jobId, quoteId };
}
function reset() {
  for (const k of Object.keys(T)) delete T[k];
  for (const k of ["properties", "owners", "jobs", "businesses", "quotes", "workflow_events", "customer_email_sends"]) T[k] = [];
  sent.length = 0; paused = null; breakReads = false; n = 0;
}
const sweep = () => sweepInstallerQuoteSentEmails(NOW);

describe("the 15-minute tick retries held installer 'Quote sent' emails", () => {
  beforeEach(reset);

  test("held at release while trade messages were paused: the sweep sends it once the pause lifts, then never again", async () => {
    const a = addJob();
    paused = "Trade messages are paused (Jo 30 Oct 2026)";
    expect(await emailInstallerQuoteSent(a.jobId, a.quoteId)).toContain("held");
    expect(sent).toHaveLength(0);
    // Still paused: the sweep looks, holds again, records nothing more.
    expect(await sweep()).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(sent).toHaveLength(0);
    expect(events("installer_quote_sent_email_held")).toHaveLength(1);
    expect(events("installer_quote_sent_email_held")[0]!["summary"]).toContain("Retried on the 15-minute tick");
    paused = null;
    expect(await sweep()).toEqual({ checked: 1, sent: 1, held: 0 });
    expect(sent).toEqual([{ kind: "real-email", to: "office1@sample.example", key: `installer-quote-sent:v1:${a.quoteId}` }]);
    expect(attempts()).toHaveLength(1);
    // Attempted now: not selected again.
    expect(await sweep()).toEqual({ checked: 0, sent: 0, held: 0 });
    expect(sent).toHaveLength(1);
  });

  test("no office email: held each tick until one is on file, then sent once", async () => {
    const a = addJob({ email: null });
    expect(await sweep()).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(await sweep()).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(events("installer_quote_sent_email_held")).toHaveLength(1);
    T["businesses"]![0]!["email"] = "office@late.example";
    expect(await sweep()).toEqual({ checked: 1, sent: 1, held: 0 });
    expect(sent[0]).toMatchObject({ to: "office@late.example", key: `installer-quote-sent:v1:${a.quoteId}` });
  });

  test("already attempted (sent or failed) is skipped; a quote never attempted on the same job is still picked up", async () => {
    const a = addJob();
    const b = addJob();
    T["customer_email_sends"]!.push({ job_id: a.jobId, purpose: "installer_quote_sent_email", idempotency_key: `installer-quote-sent:v1:${a.quoteId}`, status: "failed" });
    expect(await sweep()).toEqual({ checked: 1, sent: 1, held: 0 });
    expect(sent.map((s) => s.key)).toEqual([`installer-quote-sent:v1:${b.quoteId}`]);
  });

  test("never selected: HIV leads, fixes quotes, unsent quotes, closed jobs, quotes sent more than 30 days ago", async () => {
    addJob({ channel: "hivic_sourced" });
    addJob({ kind: "rectification" });
    addJob({ sentAt: null });
    addJob({ deleted: "2026-11-05T04:00:00Z" });
    addJob({ sentAt: "2026-10-01T03:00:00Z" });
    expect(await sweep()).toEqual({ checked: 0, sent: 0, held: 0 });
    expect(sent).toHaveLength(0);
    expect(T["workflow_events"]).toHaveLength(0);
    expect(attempts()).toHaveLength(0);
  });

  test("a read error stops the run: nothing sent, nothing recorded, no throw", async () => {
    addJob();
    breakReads = true;
    await expect(sweep()).resolves.toEqual({ checked: 0, sent: 0, held: 0 });
    expect(sent).toHaveLength(0);
    expect(T["workflow_events"]).toHaveLength(0);
    breakReads = false;
    expect(await sweep()).toEqual({ checked: 1, sent: 1, held: 0 });
  });

  test("at most 50 a run; the rest wait for the next tick", async () => {
    for (let i = 0; i < 52; i++) addJob();
    expect(await sweep()).toEqual({ checked: 50, sent: 50, held: 0 });
    expect(await sweep()).toEqual({ checked: 2, sent: 2, held: 0 });
    expect(sent).toHaveLength(52);
  });
});

describe("wiring (source facts)", () => {
  test("the sweep runs on the allocation tick like its neighbours", () => {
    const s = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    expect(s).toContain('await import("@/lib/installer-quote-sent-email.server")');
    expect(s).toContain('timed("sweepInstallerQuoteSentEmails", () => sweepInstallerQuoteSentEmails())');
  });
});

// Task 1b: a booked PIESA writes `booking_completed`; that (and payment_received / quote_declined) must only stop
// MARKETING / follow-up owner emails, never the job emails (safety check copy, install booked, completion pack, VEEC copy).
// Bounces, complaints and opt-outs still block every guarded owner email.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

type Row = Record<string, unknown>;
let engagement: Row[] = [];
let sends: Row[] = [];
let engagementReadFails = false;
let optedOutRow = false;
let n = 0;
function from(table: string) {
  const f: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" = "select", payload: Row = {}, one = false, head = false;
  const run = () => {
    if (table === "customer_engagement_events") {
      if (engagementReadFails) return { count: null, data: null, error: { message: "read failed" } };
      const hit = engagement.filter((r) => f.every((x) => x(r)));
      return head ? { count: hit.length, data: null, error: null } : { data: one ? hit[0] ?? null : hit, error: null };
    }
    if (table === "customer_email_optouts" && !head) return { data: optedOutRow ? { opted_out_at: "2026-11-01T00:00:00Z" } : null, error: null };
    if (table !== "customer_email_sends") return head ? { count: 0, data: null, error: null } : { data: one ? null : [], error: null };
    if (op === "insert") {
      if (sends.some((r) => r["idempotency_key"] === payload["idempotency_key"])) return { data: null, error: { message: "duplicate" } };
      const row = { id: `s${++n}`, status: "sending", ...payload };
      sends.push(row);
      return { data: { id: row.id }, error: null };
    }
    const hit = sends.filter((r) => f.every((x) => x(r)));
    if (op === "update") { for (const r of hit) Object.assign(r, payload); return { data: one ? hit[0] ?? null : hit, error: null }; }
    return { data: one ? hit[0] ?? null : hit, error: null };
  };
  const b: Record<string, unknown> = {
    select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return b; },
    insert: (p: Row) => { op = "insert"; payload = p; return b; },
    update: (p: Row) => { op = "update"; payload = p; return b; },
    eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return b; },
    in: (c: string, vs: unknown[]) => { f.push((r) => vs.includes(r[c])); return b; },
    limit: () => b,
    single: () => { one = true; return b; },
    maybeSingle: () => { one = true; return b; },
    then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
const delivered: string[] = [];
mock.module("../src/lib/hot-leads-send.server", () => ({
  resendSend: async (_to: string, _s: string, _h: string, _t: string, idem: string) => { delivered.push(idem); return { outcome: "accepted", id: "re_1", detail: "Accepted" }; },
}));
mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => "https://example.test/u/1" }));

const core = await import("../src/lib/emailsafety.core");
const { sendGuardedOwnerEmail } = await import("../src/lib/owner-email-send.server");
const { estimateFollowupPurpose } = await import("../src/lib/estimate-followup.core");

const JOB_EMAILS = ["piesa_copy", "install_booked", "completion_pack", "veec_assignment_copy"];
const send = (purpose: string) => sendGuardedOwnerEmail({ jobId: "J", jobSource: "website", to: "owner@example.com", purpose, key: `${purpose}:J`, build: () => ({ subject: "s", html: "h", text: "t" }) });
const event = (event_type: string) => engagement.push({ job_id: "J", event_type });
beforeEach(() => { engagement = []; sends = []; n = 0; delivered.length = 0; engagementReadFails = false; optedOutRow = false; });

describe("pure: delivery suppressions vs engagement stops", () => {
  test("the split covers exactly the old list, and SUPPRESSING_EVENTS stays the union for marketing callers", () => {
    expect([...core.DELIVERY_SUPPRESSIONS]).toEqual(["email_bounced", "email_complained", "complaint", "opted_out"]);
    expect([...core.HARD_DELIVERY_SUPPRESSIONS]).toEqual(["email_bounced", "email_complained", "complaint"]);
    expect([...core.ENGAGEMENT_STOPS]).toEqual(["payment_received", "quote_declined", "booking_completed"]);
    expect(core.SUPPRESSING_EVENTS).toEqual(["email_bounced", "email_complained", "complaint", "opted_out", "payment_received", "quote_declined", "booking_completed"]);
  });
  test("marketing purposes are the pre-acceptance nudges only", () => {
    expect([...core.MARKETING_OWNER_EMAIL_PURPOSES]).toEqual(["estimate_followup_day_2", "estimate_followup_day_7", "estimate_followup_day_21", "three_questions_reminder", "quote_reminder"]);
    for (const s of ["day_2", "day_7", "day_21"] as const) expect(core.MARKETING_OWNER_EMAIL_PURPOSES).toContain(estimateFollowupPurpose(s));
  });
  test("engagementStopBlocks: only a marketing purpose with a stop is blocked", () => {
    expect(core.engagementStopBlocks("estimate_followup_day_7", true)).toBe(true);
    expect(core.engagementStopBlocks("estimate_followup_day_7", false)).toBe(false);
    for (const p of [...JOB_EMAILS, "review_request", "warranty_followup", "deposit_release"]) expect(core.engagementStopBlocks(p, true)).toBe(false);
  });
});

describe("sendGuardedOwnerEmail with engagement events", () => {
  test("booking_completed no longer blocks the job emails", async () => {
    event("booking_completed");
    for (const p of JOB_EMAILS) expect(await send(p)).toBe("sent");
    expect(delivered).toHaveLength(JOB_EMAILS.length);
  });
  test("payment_received / quote_declined do not block job emails either", async () => {
    event("payment_received"); event("quote_declined");
    expect(await send("install_booked")).toBe("sent");
  });
  test("booking_completed still blocks an estimate follow-up", async () => {
    event("booking_completed");
    expect(await send(estimateFollowupPurpose("day_2"))).toBe("blocked — not sent");
    expect(await send("quote_reminder")).toBe("blocked — not sent");
    expect(delivered).toHaveLength(0);
  });
  test("a bounce still blocks everything", async () => {
    event("email_bounced");
    for (const p of [...JOB_EMAILS, estimateFollowupPurpose("day_2")]) expect(await send(p)).toBe("blocked — not sent");
    expect(delivered).toHaveLength(0);
  });
  test("an unsubscribe (opt-out row) still lets the legal copies go and blocks the rest", async () => {
    optedOutRow = true;
    for (const p of ["piesa_copy", "esc_consent_copy", "veec_assignment_copy"]) expect(await send(p)).toBe("sent");
    expect(await send("quote_reminder")).toBe("blocked — not sent");
  });
  test("an opted_out engagement event behaves like an unsubscribe", async () => {
    event("opted_out");
    for (const p of ["piesa_copy", "esc_consent_copy", "veec_assignment_copy"]) expect(await send(p)).toBe("sent");
    expect(await send("quote_reminder")).toBe("blocked — not sent");
    expect(await send("install_booked")).toBe("blocked — not sent");
  });
  test("a bounce blocks the legal copies even when the owner also unsubscribed", async () => {
    optedOutRow = true; event("opted_out"); event("email_bounced");
    for (const p of ["piesa_copy", "esc_consent_copy", "veec_assignment_copy"]) expect(await send(p)).toBe("blocked — not sent");
  });
  test("an unreadable engagement history fails closed", async () => {
    engagementReadFails = true;
    expect(await send("piesa_copy")).toBe("blocked — not sent");
    expect(delivered).toHaveLength(0);
  });
});

describe("source", () => {
  test("emailsafety.server re-exports the core list instead of keeping its own copy", () => {
    const s = readFileSync("src/lib/emailsafety.server.ts", "utf8");
    expect(s).not.toMatch(/SUPPRESSING_EVENTS\s*=\s*\[/);
    expect(s).toContain('export { SUPPRESSING_EVENTS } from "./emailsafety.core"');
  });
});

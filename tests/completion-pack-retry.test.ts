// Review R04 applied to the completion pack (O47): it shared the defect through the guarded sender's reservation — a
// definitely failed real send left the `completion-pack:v1:{job}` reservation 'failed', every later tick got "already
// attempted — not resent", so the pack (and the warranty copy it may record) never went. Now: a definite failure is
// retried on a later tick with the SAME key after a growing wait; an unknown outcome is never resent and raises one
// Needs me row; `completion_pack_sent` + `warranty_copy_provided` only after a confirmed send.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { COMPLETION_PACK_EMAIL_KEY, COMPLETION_PACK_UNKNOWN_LINE, COMPLETION_PACK_SEND_EVENTS, COMPLETION_PACK_SEND_FAILED_EVENT, COMPLETION_PACK_SEND_UNKNOWN_EVENT, COMPLETION_PACK_SENT_EVENT } from "../src/lib/completion-pack.core";
import { unknownSendOpen } from "../src/lib/send-outcome.core";
import { buildNeedsRows } from "../src/lib/office-needs.core";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  const f: ((r: Row) => boolean)[] = [];
  let one = false;
  const b: Record<string, unknown> = {
    select: () => b, limit: () => b, order: () => b,
    eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { f.push((r) => v.includes(r[c])); return b; },
    maybeSingle: () => { one = true; return b; },
    then: (res: (v: unknown) => unknown) => { const out = (tables[t] ?? []).filter((r) => f.every((x) => x(r))); return Promise.resolve({ data: one ? out[0] ?? null : out, error: null }).then(res); },
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, storage: { from: () => ({ download: async () => ({ data: null }) }) } } }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (job: string, _a: unknown, type: string, summary: string, details?: unknown) => { tables["workflow_events"]!.push({ job_id: job, event_type: type, summary, details: details ?? {}, created_at: new Date().toISOString() }); } }));
const W = { family: "bradford_gold", productName: "Bradford Gold", manufacturer: "CSR Bradford", attachmentName: "Bradford-Gold-warranty.pdf", warranty: { kind: "years", years: 70 } };
mock.module("../src/lib/product-warranty.server", () => ({
  warrantyDecisionFor: async () => ({ products: ["Bradford Gold R5"], attach: [W], missing: [], recordProvided: true }),
  prepareWarrantyCopies: async () => ({ attachments: [{ filename: W.attachmentName, content: "JVBERi0=", contentType: "application/pdf" }], attached: [W], missing: [] }),
}));
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async () => "https://example.test/my-job/t" }));
let apChecks = 0;
mock.module("../src/lib/veec-ap-auto.server", () => ({ tryAutoApSignature: async () => { apChecks++; } }));
// Guarded sender + template sender stand-in with the real reservation semantics.
let mode: "sent" | "reject" | "unknown" | "throw" | "test_unknown" | "test_reject" | "test_sent" = "sent";
let ledger = new Map<string, string>();
const providerKeys: string[] = [];
mock.module("../src/lib/owner-email-send.server", () => ({ guardedOwnerEmailStatus: async (k: string) => ledger.get(k) ?? null }));
mock.module("../src/lib/approved-owner-emails.server", () => ({
  emailOwnerCompletionPack: async (jobId: string, _d: unknown, _i: unknown, x: { retryAfterDefiniteFailure?: boolean }) => {
    const key = COMPLETION_PACK_EMAIL_KEY(jobId);
    if (mode.startsWith("test_")) { providerKeys.push(key); return mode === "test_sent" ? "sent: Resend accepted" : mode === "test_reject" ? "failed: Resend 422: bad" : "failed: sent_unknown (no clear answer from Resend): timed out"; }
    const prior = ledger.get(key);
    if (prior && !(prior === "failed" && x.retryAfterDefiniteFailure)) return "already attempted — not resent";
    if (mode === "throw") { ledger.set(key, "failed"); throw new Error("unsubscribe token unavailable"); }
    providerKeys.push(key);
    if (mode === "reject") { ledger.set(key, "failed"); return "failed: Email service error 422: bad"; }
    if (mode === "unknown") { ledger.set(key, "delivered_unrecorded"); return "delivery uncertain — not retried"; }
    ledger.set(key, "sent"); return "sent";
  },
}));
const { sendCompletionPack } = await import("../src/lib/completion-pack.server");
const H = 3_600_000;
const at = (h: number) => new Date(Date.now() + h * H);
const reset = (source = "website") => {
  mode = "sent"; ledger = new Map(); providerKeys.length = 0; apChecks = 0;
  tables = {
    jobs: [{ id: "J", source, installation_completed_at: "2026-10-20T02:00:00Z", deleted_at: null }],
    invoices: [{ job_id: "J", kind: "installation", total_inc_gst: 4000, total_paid: 4000, created_at: "2026-10-01T00:00:00Z" }],
    workflow_events: [], documents: [],
  };
};
const types = () => tables["workflow_events"]!.map((e) => e["event_type"]);
beforeEach(() => reset());

describe("R04: completion pack delivery outcomes", () => {
  for (const failure of ["reject", "throw"] as const) {
    test(`real owner, first send ${failure === "reject" ? "definitively rejected" : "throws before the provider"} → retried once healthy, same key, then sent + warranty copy recorded`, async () => {
      mode = failure;
      expect((await sendCompletionPack("J")).outcome).toBe("not_sent");
      expect(types()).toEqual([COMPLETION_PACK_SEND_FAILED_EVENT]);
      mode = "sent";
      expect(await sendCompletionPack("J", null, at(0.5))).toMatchObject({ outcome: "skipped", detail: expect.stringContaining("next try after") });
      const r = await sendCompletionPack("J", null, at(1.5));
      expect(r).toMatchObject({ outcome: "sent", warranties: { recorded: true } });
      expect(types()).toEqual([COMPLETION_PACK_SEND_FAILED_EVENT, COMPLETION_PACK_SENT_EVENT, "warranty_copy_provided"]);
      expect(apChecks).toBe(1);
      expect(new Set(providerKeys)).toEqual(new Set([COMPLETION_PACK_EMAIL_KEY("J")]));
      expect((await sendCompletionPack("J", null, at(30))).detail).toBe("already sent");
    });
  }
  test("real owner, unknown outcome → never resent; one Needs me row until sent", async () => {
    mode = "unknown";
    expect((await sendCompletionPack("J")).outcome).toBe("not_sent");
    mode = "sent";
    for (const h of [2, 26]) expect(await sendCompletionPack("J", null, at(h))).toMatchObject({ outcome: "skipped", detail: "delivery uncertain — not resent; office to check" });
    expect(providerKeys).toHaveLength(1);
    expect(types()).toEqual([COMPLETION_PACK_SEND_UNKNOWN_EVENT]);
    const ev = tables["workflow_events"]! as { event_type: string; created_at: string }[];
    const open = unknownSendOpen(ev, COMPLETION_PACK_SEND_EVENTS, false);
    expect(open).not.toBeNull();
    const rows = buildNeedsRows({ now: Date.now(), jobs: [{ jobId: "J", jobNumber: "HV-1", surname: "Yang", suburb: null, sendUnknown: { at: open!.at, text: COMPLETION_PACK_UNKNOWN_LINE } }] });
    expect(rows.today.map((r) => [r.kind, r.line, r.button])).toEqual([["send_failed", COMPLETION_PACK_UNKNOWN_LINE, { label: "Open job", to: "job", section: "contact" }]]);
  });
  test("TEST job: sent_unknown is not resent every tick (it used to be); a definite TEST refusal is retried after the wait", async () => {
    reset("qa_test");
    mode = "test_unknown";
    await sendCompletionPack("J");
    mode = "test_sent";
    expect((await sendCompletionPack("J", null, at(3))).detail).toBe("delivery uncertain — not resent; office to check");
    expect(providerKeys).toHaveLength(1);
    reset("qa_test");
    mode = "test_reject";
    await sendCompletionPack("J");
    mode = "test_sent";
    expect((await sendCompletionPack("J", null, at(1.5))).outcome).toBe("sent");
    expect(providerKeys).toHaveLength(2);
  });
  test("holds (approval / link / consent) are not attempts: no failure recorded, nothing waits", async () => {
    // emailOwnerCompletionPack answers "not sent — …" for holds; simulate via the template classifier directly.
    const { classifyTemplateSendResult } = await import("../src/lib/send-outcome.core");
    const kind = () => "rejected" as const;
    expect(classifyTemplateSendResult("not sent — awaiting approval", false, kind)).toBe("held");
    expect(classifyTemplateSendResult("skipped", true, kind)).toBe("held");
    expect(classifyTemplateSendResult("sent: Resend accepted (id x)", true, kind)).toMatchObject({ outcome: "delivered" });
    expect(classifyTemplateSendResult("failed: Resend 503: busy", true, (s) => (s >= 500 ? "uncertain" : "rejected"))).toMatchObject({ outcome: "unknown" });
    expect(classifyTemplateSendResult("already attempted — not resent", false, kind)).toBeNull();
  });
});

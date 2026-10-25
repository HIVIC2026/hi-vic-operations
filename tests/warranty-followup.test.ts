// Decision 363 (Jo 25 Oct 2026): a warranty PDF added after the completion pack went without it is sent ONCE to the owner
// (O73 draft, PDF attached), then `warranty_copy_provided` is recorded (via "warranty_followup") so the AP auto-signature
// can proceed. Pure rules + draft file first, then the sweep against an in-memory backend with recorder senders.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  PRODUCT_WARRANTY_MISSING_EVENT, WARRANTY_FOLLOWUP_APPROVED, WARRANTY_FOLLOWUP_SENT_EVENT, WARRANTY_FOLLOWUP_TEMPLATE_CODE, renderWarrantyFollowupEmail,
  warrantyFollowupBlocker, warrantyFollowupKey, type WarrantyFollowupFacts,
} from "../src/lib/warranty-followup.core";
import { WARRANTY_VIA_LABEL } from "../src/lib/completion-pack.core";
import { FOOTER_TEXT } from "../src/lib/email-kit.core";

const due: WarrantyFollowupFacts = { installCompleted: true, deleted: false, missingRecorded: true, provided: false, alreadySent: false, products: ["Bradford Gold R5"], allOnFile: true };

describe("decision 363: warranty follow-up rules and the O73 draft", () => {
  test("held until Jo approves; key, code and the new recorder via", () => {
    expect(WARRANTY_FOLLOWUP_APPROVED).toBe(true);
    expect(WARRANTY_FOLLOWUP_TEMPLATE_CODE).toBe("O73");
    expect(warrantyFollowupKey("j1")).toBe("warranty-followup:v1:j1");
    expect(WARRANTY_VIA_LABEL.warranty_followup).toContain("decision 363");
  });
  test("due only when the pack went without a PDF, nothing recorded yet, not sent before, and every PDF is now on file", () => {
    expect(warrantyFollowupBlocker(due)).toBeNull();
    expect(warrantyFollowupBlocker({ ...due, installCompleted: false })).toBe("install not recorded complete");
    expect(warrantyFollowupBlocker({ ...due, missingRecorded: false })).toBe("no warranty was missing");
    expect(warrantyFollowupBlocker({ ...due, provided: true })).toBe("warranty copy already provided");
    expect(warrantyFollowupBlocker({ ...due, alreadySent: true })).toBe("follow-up already sent");
    expect(warrantyFollowupBlocker({ ...due, allOnFile: false })).toBe("warranty PDF still not on file");
    expect(warrantyFollowupBlocker({ ...due, products: [] })).toBe("installed product not known");
  });
  test("O73: subject 'Your insulation warranty', three plain sentences, kit footer; the rendered draft matches", () => {
    const m = renderWarrantyFollowupEmail({ firstName: "Helen Yang", products: ["Bradford Gold"], unsubscribeUrl: null });
    expect(m.subject).toBe("Your insulation warranty");
    expect(m.text).toContain("Hi Helen,");
    expect(m.text).toContain("Attached is the manufacturer's warranty for the Bradford Gold insulation we installed in your ceiling.");
    expect(m.text).toContain("just reply to this email");
    expect(m.text).toContain(FOOTER_TEXT);
    const draft = readFileSync("docs/templates/drafts/O73-warranty-followup.html", "utf8");
    expect(draft).toBe(m.html);
  });
});

describe("sweepWarrantyFollowups (mocked backend)", () => {
  type Row = Record<string, unknown>;
  let tables: Record<string, Row[]> = {};
  const sent = { test: [] as { to: string; subject: string; files: string[] }[], guarded: [] as string[] };
  let onFile = true;
  const reset = (source = "qa_test") => {
    sent.test.length = 0; sent.guarded.length = 0; onFile = true;
    tables = {
      jobs: [{ id: "J", source, installation_completed_at: "2026-11-20T02:00:00Z", deleted_at: null, owners: { full_name: "Helen Yang", email: "jo@example.com" } }],
      workflow_events: [{ job_id: "J", event_type: PRODUCT_WARRANTY_MISSING_EVENT, created_at: new Date().toISOString(), details: {} }],
    };
  };
  const builder = (t: string) => {
    const f: ((r: Row) => boolean)[] = [];
    let one = false;
    const b: Record<string, unknown> = {
      select: () => b, limit: () => b,
      eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return b; }, in: (c: string, v: unknown[]) => { f.push((r) => v.includes(r[c])); return b; },
      gte: (c: string, v: string) => { f.push((r) => String(r[c]) >= v); return b; },
      maybeSingle: () => { one = true; return b; },
      then: (res: (v: unknown) => unknown) => { const out = (tables[t] ?? []).filter((r) => f.every((x) => x(r))); return Promise.resolve({ data: one ? out[0] ?? null : out, error: null }).then(res); },
    };
    return b;
  };
  const W = { family: "bradford_gold", productName: "Bradford Gold", manufacturer: "CSR Bradford", attachmentName: "Bradford-Gold-warranty.pdf", warranty: { kind: "years", years: 70 } };
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: builder } }));
  mock.module("../src/lib/workflow.server", () => ({ logEvent: async (job: string, _a: unknown, type: string, summary: string, details?: unknown) => { tables["workflow_events"]!.push({ job_id: job, event_type: type, summary, details: details ?? {}, created_at: new Date().toISOString() }); } }));
  mock.module("../src/lib/product-warranty.server", () => ({
    warrantyDecisionFor: async () => ({ products: ["Bradford Gold R5"], attach: onFile ? [W] : [], missing: onFile ? [] : [{ product: "Bradford Gold", reason: "Warranty copy for Bradford Gold not on file." }], recordProvided: onFile }),
    prepareWarrantyCopies: async () => ({ attachments: [{ filename: W.attachmentName, content: "JVBERi0=", contentType: "application/pdf" }], attached: [W], missing: [] }),
  }));
  mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => undefined }));
  mock.module("../src/lib/test-send.server", () => ({ sendTestEmail: async (_c: unknown, to: string, subject: string, _h: string, _t: string, o: { attachments?: { filename: string }[] } = {}) => { sent.test.push({ to, subject, files: (o.attachments ?? []).map((a) => a.filename) }); return { status: "sent", detail: "ok" }; } }));
  mock.module("../src/lib/owner-email-send.server", () => ({ sendGuardedOwnerEmail: async (p: { key: string }) => { sent.guarded.push(p.key); return "sent"; } }));
  mock.module("../src/lib/veec-ap-auto.server", () => ({ tryAutoApSignature: async () => undefined }));
  beforeEach(() => reset());

  test("TEST job, PDF now on file: one email with the PDF, then warranty_copy_provided (via warranty_followup); the next tick does nothing", async () => {
    const { sweepWarrantyFollowups } = await import("../src/lib/warranty-followup.server");
    expect(await sweepWarrantyFollowups()).toEqual({ checked: 1, sent: 1, held: 0, failed: 0 });
    expect(sent.test).toEqual([{ to: "jo@example.com", subject: "Your insulation warranty", files: ["Bradford-Gold-warranty.pdf"] }]);
    const types = tables["workflow_events"]!.map((e) => e["event_type"]);
    expect(types).toEqual([PRODUCT_WARRANTY_MISSING_EVENT, WARRANTY_FOLLOWUP_SENT_EVENT, "warranty_copy_provided"]);
    expect((tables["workflow_events"]![2]!["details"] as { via: string }).via).toBe("warranty_followup");
    expect(await sweepWarrantyFollowups()).toEqual({ checked: 1, sent: 0, held: 0, failed: 0 });
    expect(sent.test).toHaveLength(1);
  });
  test("PDF still not on file: nothing sent, nothing recorded", async () => {
    onFile = false;
    const { sendWarrantyFollowup } = await import("../src/lib/warranty-followup.server");
    expect(await sendWarrantyFollowup("J")).toBe("skipped — warranty PDF still not on file");
    expect(sent.test).toEqual([]);
    expect(tables["workflow_events"]!).toHaveLength(1);
  });
  test("real owner: approved wording (decision 375) goes through the guarded owner sender", async () => {
    reset("website");
    const { sendWarrantyFollowup } = await import("../src/lib/warranty-followup.server");
    expect(await sendWarrantyFollowup("J")).not.toBe("held — wording awaiting approval");
    expect(sent.guarded.length).toBe(1);
  });
  test("the tick runs the sweep after the completion pack and before the AP auto-signature", () => {
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    const at = tick.indexOf("sweepWarrantyFollowups()");
    expect(at).toBeGreaterThan(tick.indexOf("sweepCompletionPacks()"));
    expect(at).toBeLessThan(tick.indexOf("Decision 271: Section 3 Part A"));
  });
});

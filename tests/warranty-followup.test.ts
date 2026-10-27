// Decision 363 (Jo 25 Oct 2026): a warranty PDF added after the completion pack went without it is sent ONCE to the owner
// (O73 draft, PDF attached), then `warranty_copy_provided` is recorded (via "warranty_followup") so the AP auto-signature
// can proceed. Pure rules + draft file first, then the sweep against an in-memory backend with recorder senders.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  PRODUCT_WARRANTY_MISSING_EVENT, WARRANTY_FOLLOWUP_APPROVED, WARRANTY_FOLLOWUP_ATTEMPT_EVENT, WARRANTY_FOLLOWUP_FAILED_EVENT, WARRANTY_FOLLOWUP_SENT_EVENT, WARRANTY_FOLLOWUP_UNKNOWN_EVENT,
  warrantyFollowupDelivery, warrantyFollowupUnknownOpen, WARRANTY_FOLLOWUP_TEMPLATE_CODE, renderWarrantyFollowupEmail,
  warrantyFollowupBlocker, warrantyFollowupKey, type WarrantyFollowupFacts,
} from "../src/lib/warranty-followup.core";
import { WARRANTY_VIA_LABEL } from "../src/lib/completion-pack.core";
import { FOOTER_TEXT } from "../src/lib/email-kit.core";
import { MAIL_LOGO_URL } from "../src/lib/mail-mjml.core";

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
    expect(m.text).toContain("Any questions? Just reply to this email.");
    expect(m.text).toContain(FOOTER_TEXT);
    // MJML refresh (design docs/templates/mjml/owner_O73.mjml): hosted logo, no embedded images.
    expect(m.html).toContain(MAIL_LOGO_URL);
    expect(m.html).not.toContain("data:image");
    expect(readFileSync("docs/templates/mjml/owner_O73.mjml", "utf8")).toContain("Attached is the manufacturer's warranty for the Bradford Gold insulation we installed in your ceiling.");
  });
});

describe("sweepWarrantyFollowups (mocked backend)", () => {
  type Row = Record<string, unknown>;
  let tables: Record<string, Row[]> = {};
  const sent = { test: [] as { to: string; subject: string; files: string[] }[], guarded: [] as string[] };
  // Review R04: sender behaviour per scenario, the provider idempotency key of every call that reached the provider, the
  // guarded sender's reservation log (customer_email_sends stand-in) and the AP auto-signature re-checks.
  let mode: "sent" | "reject" | "throw" | "unknown" = "sent";
  const providerKeys: string[] = [];
  let ledger = new Map<string, string>();
  let apChecks = 0;
  let onFile = true;
  const reset = (source = "qa_test") => {
    sent.test.length = 0; sent.guarded.length = 0; onFile = true; mode = "sent"; providerKeys.length = 0; ledger = new Map(); apChecks = 0;
    tables = {
      jobs: [{ id: "J", source, installation_completed_at: "2026-11-20T02:00:00Z", deleted_at: null, owners: { full_name: "Helen Yang", email: "jo@example.com" } }],
      workflow_events: [{ job_id: "J", event_type: PRODUCT_WARRANTY_MISSING_EVENT, created_at: new Date().toISOString(), details: {} }],
    };
  };
  const builder = (t: string) => {
    const f: ((r: Row) => boolean)[] = [];
    let one = false;
    const b: Record<string, unknown> = {
      select: () => b, limit: () => b, order: () => b,
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
  // test-send stand-in: its provider key is recipient + subject + body (test-send.server idemKey).
  mock.module("../src/lib/test-send.server", () => ({ sendTestEmail: async (_c: unknown, to: string, subject: string, html: string, _t: string, o: { attachments?: { filename: string }[] } = {}) => {
    if (mode === "throw") throw new Error("Email is not connected");
    providerKeys.push(`${to}\n${subject}\n${html}`);
    if (mode === "reject") return { status: "failed", detail: "Resend 422: invalid attachment" };
    if (mode === "unknown") return { status: "failed", detail: "sent_unknown (no clear answer from Resend; do not retry by hand within 24h — Resend drops an identical repeat): timed out" };
    sent.test.push({ to, subject, files: (o.attachments ?? []).map((a) => a.filename) }); return { status: "sent", detail: "ok" };
  } }));
  // Guarded sender stand-in with the real reservation semantics (owner-email-send.server): one row per key; a 'failed'
  // row is re-claimed only when the caller opts in; a throw before the provider marks the row 'failed'.
  mock.module("../src/lib/owner-email-send.server", () => ({
    sendGuardedOwnerEmail: async (p: { key: string; retryAfterDefiniteFailure?: boolean }) => {
      const prior = ledger.get(p.key);
      if (prior && !(prior === "failed" && p.retryAfterDefiniteFailure)) return "already attempted — not resent";
      ledger.set(p.key, "sending");
      if (mode === "throw") { ledger.set(p.key, "failed"); throw new Error("unsubscribe token unavailable"); }
      providerKeys.push(p.key);
      if (mode === "reject") { ledger.set(p.key, "failed"); return "failed: Email service error 422: invalid attachment"; }
      if (mode === "unknown") { ledger.set(p.key, "delivered_unrecorded"); return "delivery uncertain — not retried"; }
      ledger.set(p.key, "sent"); sent.guarded.push(p.key); return "sent";
    },
    guardedOwnerEmailStatus: async (key: string) => ledger.get(key) ?? null,
  }));
  mock.module("../src/lib/veec-ap-auto.server", () => ({ tryAutoApSignature: async () => { apChecks++; } }));
  beforeEach(() => reset());

  test("TEST job, PDF now on file: one email with the PDF, then warranty_copy_provided (via warranty_followup); the next tick does nothing", async () => {
    const { sweepWarrantyFollowups } = await import("../src/lib/warranty-followup.server");
    expect(await sweepWarrantyFollowups()).toEqual({ checked: 1, sent: 1, held: 0, failed: 0 });
    expect(sent.test).toEqual([{ to: "jo@example.com", subject: "Your insulation warranty", files: ["Bradford-Gold-warranty.pdf"] }]);
    const types = tables["workflow_events"]!.map((e) => e["event_type"]);
    expect(types).toEqual([PRODUCT_WARRANTY_MISSING_EVENT, WARRANTY_FOLLOWUP_ATTEMPT_EVENT, WARRANTY_FOLLOWUP_SENT_EVENT, "warranty_copy_provided"]);
    expect((tables["workflow_events"]![2]!["details"] as { confirmed: boolean }).confirmed).toBe(true);
    expect((tables["workflow_events"]![3]!["details"] as { via: string }).via).toBe("warranty_followup");
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
  // ---------- Review R04 (audit F16): the four reproduced failure scenarios + unknown outcomes ----------
  const H = 3_600_000;
  const at = (ms: number) => new Date(Date.now() + ms);
  const types = () => tables["workflow_events"]!.map((e) => e["event_type"]);
  const copies = () => types().filter((t) => t === "warranty_copy_provided").length;
  for (const source of ["qa_test", "website"] as const) {
    for (const failure of ["reject", "throw"] as const) {
      test(`R04 ${source === "qa_test" ? "TEST" : "website"} path, first send ${failure === "reject" ? "definitively rejected" : "throws before acceptance"} → later tick sends ONE copy with the same key and records the warranty copy`, async () => {
        reset(source);
        const { sweepWarrantyFollowups } = await import("../src/lib/warranty-followup.server");
        mode = failure;
        expect(await sweepWarrantyFollowups()).toEqual({ checked: 1, sent: 0, held: 0, failed: 1 });
        expect(types()).toEqual([PRODUCT_WARRANTY_MISSING_EVENT, WARRANTY_FOLLOWUP_ATTEMPT_EVENT, WARRANTY_FOLLOWUP_FAILED_EVENT]);
        expect(copies()).toBe(0);
        expect(apChecks).toBe(0);
        // The sender is healthy again. Not inside the 1-hour wait …
        mode = "sent";
        expect(await sweepWarrantyFollowups(at(0.5 * H))).toEqual({ checked: 1, sent: 0, held: 0, failed: 0 });
        expect([...sent.test, ...sent.guarded]).toHaveLength(0);
        // … but the next tick after it sends exactly one copy, records warranty_copy_provided and re-checks the AP signature.
        expect(await sweepWarrantyFollowups(at(1.5 * H))).toEqual({ checked: 1, sent: 1, held: 0, failed: 0 });
        expect(sent.test.length + sent.guarded.length).toBe(1);
        expect(copies()).toBe(1);
        expect(apChecks).toBe(1);
        expect(types().slice(3)).toEqual([WARRANTY_FOLLOWUP_ATTEMPT_EVENT, WARRANTY_FOLLOWUP_SENT_EVENT, "warranty_copy_provided"]);
        // Same provider idempotency key on every call that reached the provider.
        expect(new Set(providerKeys).size).toBe(1);
        if (source === "website") expect(providerKeys[0]).toBe(warrantyFollowupKey("J"));
        // Nothing more, ever.
        expect(await sweepWarrantyFollowups(at(30 * H))).toEqual({ checked: 1, sent: 0, held: 0, failed: 0 });
        expect(sent.test.length + sent.guarded.length).toBe(1);
        expect(copies()).toBe(1);
      });
    }
    test(`R04 ${source === "qa_test" ? "TEST" : "website"} path, unknown outcome → never resent, nothing recorded, one Needs me row`, async () => {
      reset(source);
      const { sweepWarrantyFollowups } = await import("../src/lib/warranty-followup.server");
      mode = "unknown";
      expect(await sweepWarrantyFollowups()).toEqual({ checked: 1, sent: 0, held: 1, failed: 0 });
      expect(types()).toEqual([PRODUCT_WARRANTY_MISSING_EVENT, WARRANTY_FOLLOWUP_ATTEMPT_EVENT, WARRANTY_FOLLOWUP_UNKNOWN_EVENT]);
      mode = "sent";
      for (const h of [2, 26, 72]) expect(await sweepWarrantyFollowups(at(h * H))).toEqual({ checked: 1, sent: 0, held: 1, failed: 0 });
      expect(providerKeys).toHaveLength(1);
      expect(copies()).toBe(0);
      const ev = tables["workflow_events"]! as { event_type: string; created_at: string }[];
      expect(warrantyFollowupUnknownOpen(ev, false)?.text).toContain("not resent");
      expect(warrantyFollowupUnknownOpen(ev, true)).toBeNull(); // a recorded copy closes the row
    });
  }
  test("R04 retry waits grow (1h, 2h, 4h …) while the sender keeps failing", async () => {
    reset("website");
    const { sendWarrantyFollowup } = await import("../src/lib/warranty-followup.server");
    mode = "reject";
    expect(await sendWarrantyFollowup("J")).toMatch(/^failed: .* next try after /);
    expect(await sendWarrantyFollowup("J", at(0.9 * H))).toMatch(/^skipped — last send failed — next try after /);
    expect(await sendWarrantyFollowup("J", at(1.1 * H))).toMatch(/^failed/);
    const d = warrantyFollowupDelivery(tables["workflow_events"]! as { event_type: string; created_at: string }[]);
    expect(d).toMatchObject({ state: "failed", attempts: 2, failures: 2 });
    expect(await sendWarrantyFollowup("J", at(1.5 * H))).toMatch(/^skipped — last send failed/); // second wait is 2h
    expect(providerKeys).toEqual([warrantyFollowupKey("J"), warrantyFollowupKey("J")]);
  });
  test("R04 pre-fix marker (written before delivery, no outcome): the email log decides — failed → retried; sent → recorded; none of it blind", async () => {
    reset("website");
    const { sendWarrantyFollowup } = await import("../src/lib/warranty-followup.server");
    const legacy = { job_id: "J", event_type: WARRANTY_FOLLOWUP_SENT_EVENT, created_at: new Date(Date.now() - 5 * H).toISOString(), details: { key: warrantyFollowupKey("J") } };
    tables["workflow_events"]!.push(legacy);
    ledger.set(warrantyFollowupKey("J"), "failed");
    expect(await sendWarrantyFollowup("J")).toMatch(/^skipped — last send failed/); // resolved as a definite failure now
    expect(types()).toContain(WARRANTY_FOLLOWUP_FAILED_EVENT);
    expect(await sendWarrantyFollowup("J", at(1.5 * H))).toBe("sent · warranty copy recorded");
    expect(sent.guarded).toEqual([warrantyFollowupKey("J")]);
    // Same marker, but the email log shows it was accepted: record the copy, send nothing.
    reset("website");
    tables["workflow_events"]!.push(legacy);
    ledger.set(warrantyFollowupKey("J"), "sent");
    expect(await sendWarrantyFollowup("J")).toBe("sent (confirmed from the email log) · warranty copy recorded");
    expect(providerKeys).toEqual([]);
    expect(copies()).toBe(1);
    // Same marker, email log still "sending" (no answer): unknown, never resent.
    reset("website");
    tables["workflow_events"]!.push(legacy);
    ledger.set(warrantyFollowupKey("J"), "sending");
    expect(await sendWarrantyFollowup("J", at(48 * H))).toMatch(/^held — follow-up delivery outcome unknown/);
    expect(providerKeys).toEqual([]);
    expect(types()).toContain(WARRANTY_FOLLOWUP_UNKNOWN_EVENT);
  });
  test("R04 delivery state (pure)", () => {
    const e = (event_type: string, h: number, details: Record<string, unknown> = {}) => ({ event_type, created_at: new Date(Date.UTC(2026, 9, 25, h)).toISOString(), details });
    expect(warrantyFollowupDelivery([])).toMatchObject({ state: "none", attempts: 0 });
    expect(warrantyFollowupDelivery([e(WARRANTY_FOLLOWUP_ATTEMPT_EVENT, 1)])).toMatchObject({ state: "pending" });
    expect(warrantyFollowupDelivery([e(WARRANTY_FOLLOWUP_SENT_EVENT, 1)])).toMatchObject({ state: "pending", attempts: 1 }); // pre-fix marker
    expect(warrantyFollowupDelivery([e(WARRANTY_FOLLOWUP_ATTEMPT_EVENT, 1), e(WARRANTY_FOLLOWUP_FAILED_EVENT, 2)])).toMatchObject({ state: "failed", failures: 1 });
    expect(warrantyFollowupDelivery([e(WARRANTY_FOLLOWUP_ATTEMPT_EVENT, 1), e(WARRANTY_FOLLOWUP_FAILED_EVENT, 2), e(WARRANTY_FOLLOWUP_ATTEMPT_EVENT, 3)])).toMatchObject({ state: "pending", attempts: 2 });
    expect(warrantyFollowupDelivery([e(WARRANTY_FOLLOWUP_ATTEMPT_EVENT, 1), e(WARRANTY_FOLLOWUP_UNKNOWN_EVENT, 2)])).toMatchObject({ state: "unknown" });
    expect(warrantyFollowupDelivery([e(WARRANTY_FOLLOWUP_ATTEMPT_EVENT, 1), e(WARRANTY_FOLLOWUP_SENT_EVENT, 2, { confirmed: true })])).toMatchObject({ state: "delivered" });
    expect(warrantyFollowupBlocker({ ...due, delivery: { state: "unknown", attempts: 1, failures: 0, lastFailureAt: null } })).toContain("outcome unknown");
    expect(warrantyFollowupBlocker({ ...due, delivery: { state: "failed", attempts: 1, failures: 1, lastFailureAt: "2026-10-25T00:00:00.000Z" }, now: "2026-10-25T00:59:00.000Z" })).toContain("next try after 2026-10-25T01:00:00.000Z");
    expect(warrantyFollowupBlocker({ ...due, delivery: { state: "failed", attempts: 1, failures: 1, lastFailureAt: "2026-10-25T00:00:00.000Z" }, now: "2026-10-25T01:00:00.000Z" })).toBeNull();
  });
  test("the tick runs the sweep after the completion pack and before the AP auto-signature", () => {
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    const at = tick.indexOf("sweepWarrantyFollowups()");
    expect(at).toBeGreaterThan(tick.indexOf("sweepCompletionPacks()"));
    expect(at).toBeLessThan(tick.indexOf("Decision 271: Section 3 Part A"));
  });
});

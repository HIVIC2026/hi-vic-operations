// Part 4 Task 10 (Review Focus 3): an unpaid balance never holds back a completion document.
// Install complete + balance unpaid → the All done email carries warranty + instructions and records the warranty copy;
// the completion pack (the "paid in full" email) still waits; the signed rebate form copy goes on the next tick; and the
// same holds with "Do not contact" on (compliance purposes). Fake db, no sends anywhere.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { doNotContactBlocks } from "../src/lib/do-not-contact.core";
import { WORKFLOW_DECISIONS } from "../src/config/workflow-decisions";

type Row = Record<string, any>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  const f: ((r: Row) => boolean)[] = [];
  let one = false, patch: Row | null = null;
  const b: Record<string, any> = {
    select: () => b, limit: () => b, order: () => b,
    eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { f.push((r) => v.includes(r[c])); return b; },
    update: (p: Row) => { patch = p; return b; },
    maybeSingle: () => { one = true; return b; },
    then: (res: (v: unknown) => unknown) => {
      const out = (tables[t] ?? []).filter((r) => f.every((x) => x(r)));
      if (patch) out.forEach((r) => Object.assign(r, patch));
      return Promise.resolve({ data: patch ? null : one ? out[0] ?? null : out, error: null }).then(res);
    },
  };
  return b;
}
const PDF = new Blob(["%PDF-1.4 signed"]);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, storage: { from: () => ({ download: async () => ({ data: PDF, error: null }) }) } } }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (job: string, _a: unknown, type: string, summary: string, details?: unknown) => { tables["workflow_events"]!.push({ job_id: job, event_type: type, summary, details: details ?? {}, created_at: new Date().toISOString() }); } }));
const att = (filename: string) => ({ filename, content: "JVBERi0=", contentType: "application/pdf" });
const W = { family: "bradford_gold", productName: "Bradford Gold R5.0", manufacturer: "CSR Bradford", attachmentName: "Bradford-warranty.pdf", warranty: { kind: "years", years: 70 } };
mock.module("../src/lib/product-warranty.server", () => ({
  warrantyDecisionFor: async () => ({ products: ["Bradford Gold R5.0"], attach: [W], missing: [], buildingClass: null }),
  prepareWarrantyCopies: async () => ({ attachments: [att("Bradford-warranty.pdf")], attached: [W], missing: [] }),
}));
mock.module("../src/lib/product-instructions.server", () => ({ productInstructionsFor: async () => att("Bradford-instructions.pdf") }));
const CONTACT = (n: string) => ({ name: n, tradingName: n, officePhone: "03 9000 0001", email: "office@example.invalid" });
mock.module("../src/lib/owner-contact.server", () => ({ businessContactForJob: async (_j: string, role: string) => (role === "installer" ? CONTACT("Rapid Insulation") : null) }));
mock.module("../src/lib/tax-invoice-pdf.server", () => ({ fileTaxInvoicePdf: async () => ({ path: "J/tax.pdf" }) }));
mock.module("../src/lib/veec-form-pdf.server", () => ({ veecFormPdf: async () => ({ bytes: new TextEncoder().encode("%PDF-1.4 form"), layout: { split: [] } }) }));
mock.module("../src/lib/assignment.server", () => ({ currentAssignment: async () => null, veecPreparation: async () => ({ blockers: [], values: { a: "b" }, missing: [] }) }));
mock.module("../src/lib/veec-ap-auto.server", () => ({ tryAutoApSignature: async () => {} }));
let dnc = false;
const sentEmails: { purpose: string; key: string; attachments: string[] }[] = [];
const blockedByDnc: string[] = [];
const dncOk = (purpose: string) => { const why = doNotContactBlocks({ channel: "email", purpose, on: dnc }); if (why) blockedByDnc.push(purpose); return !why; };
mock.module("../src/lib/owner-template-send.server", () => ({
  sendOwnerTemplateEmail: async (p: any) => {
    if (!dncOk(p.purpose)) return "not sent — do not contact";
    sentEmails.push({ purpose: p.purpose, key: p.key, attachments: (p.attachments ?? []).map((a: any) => a.filename) });
    return "sent";
  },
}));
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: any) => {
    if (!dncOk(p.purpose)) return "not sent — do not contact";
    sentEmails.push({ purpose: p.purpose, key: p.key, attachments: (p.build(null).attachments ?? []).map((a: any) => a.filename) });
    return "sent";
  },
}));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async (_j: string, _w: string, purpose?: string) => { if (!dncOk(purpose ?? "")) throw new Error("do not contact"); } }));
mock.module("../src/lib/veec-emails.core", () => ({
  VEEC_COPY_EMAIL_APPROVED: true, bytesToBase64: () => "JVBERi0=", veecCopyFilename: (n: string) => `VEEC-${n}.pdf`,
  renderVeecCopyEmail: () => ({ subject: "s", html: "h", text: "t" }),
}));

const { emailOwnerInstallComplete } = await import("../src/lib/approved-owner-emails.server");
const { sendCompletionPack } = await import("../src/lib/completion-pack.server");
const { sendVeecCopyEmail } = await import("../src/lib/veec-copy-email.server");
const { installerPayHeldReasons, INSTALLER_PAY_WAITING_OWNER } = await import("../src/lib/trade-view.core");

const facts = { product: "Bradford Gold R5.0", areaM2: 120, rebate: 2380, balancePaid: false, balanceCents: 141200, signRebateFormUrl: "https://e.invalid/my-job/t?screen=done" };
beforeEach(() => {
  dnc = false; sentEmails.length = 0; blockedByDnc.length = 0;
  tables = {
    workflow_events: [],
    jobs: [{ id: "J", job_number: "HV-1", owner_id: "O", source: "website", installation_completed_at: "2026-10-20T02:00:00Z", deleted_at: null }],
    owners: [{ id: "O", full_name: "Sarah Owner", email: "sarah@example.invalid" }],
    invoices: [{ job_id: "J", kind: "installation", total_inc_gst: 3000, total_paid: 1000, created_at: "2026-10-01T00:00:00Z" }],
    customer_estimate_links: [{ job_id: "J", purpose: "step3_estimate", status: "active", token: "tok", expires_at: null }],
    job_assignments: [],
    customer_assignments: [{ id: "A", job_id: "J", record_kind: "final_veec_assignment", status: "effective_complete", consumer_signed_at: "2026-10-21T00:00:00Z", copy_sent_at: null, final_copy_path: "J/final.pdf" }],
  };
});
const types = () => tables["workflow_events"]!.map((e) => e.event_type);

for (const [label, withDnc] of [["balance unpaid", false], ["balance unpaid and Do not contact on", true]] as const) {
  describe(label, () => {
    test("All done email goes once with warranty + instructions and records the warranty copy", async () => {
      dnc = withDnc;
      const r = await emailOwnerInstallComplete("J", facts, { v2: true });
      expect(r).toBe("sent");
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]).toMatchObject({ purpose: "install_complete", key: "install-complete:v1:J" });
      expect(sentEmails[0]!.attachments).toEqual(expect.arrayContaining(["Bradford-warranty.pdf"]));
      expect(types()).toContain("warranty_copy_provided");
      const w = tables["workflow_events"]!.find((e) => e.event_type === "warranty_copy_provided")!;
      expect(w.details.via).toBe("all_done_email");
    });
    test("completion pack still waits for the balance", async () => {
      dnc = withDnc;
      expect(await sendCompletionPack("J")).toMatchObject({ outcome: "skipped", detail: "invoice not paid in full" });
      expect(sentEmails).toHaveLength(0);
    });
    test("signed rebate form copy goes on the next tick, balance or not", async () => {
      dnc = withDnc;
      expect(await sendVeecCopyEmail("J")).toBe("sent");
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]).toMatchObject({ purpose: "veec_assignment_copy", key: "veec-copy:v1:A" });
      expect(sentEmails[0]!.attachments).toEqual(["VEEC-HV-1.pdf"]);
      expect(tables["customer_assignments"]![0]!.copy_sent_at).not.toBeNull();
      expect(blockedByDnc).toEqual([]);
    });
  });
}

test("installer pay for an installer's own customer is still held until the owner has paid in full", () => {
  const held = installerPayHeldReasons({ installerSupplied: true, apApprovedAt: "2026-10-25T00:00:00Z", ownerPaidInFullAt: null });
  expect(held).toContain(INSTALLER_PAY_WAITING_OWNER);
  expect(installerPayHeldReasons({ installerSupplied: true, apApprovedAt: "2026-10-25T00:00:00Z", ownerPaidInFullAt: "2026-10-26T00:00:00Z" })).toEqual([]);
});

test("the decisions file says no completion document waits for the balance", () => { expect(WORKFLOW_DECISIONS.payment.completionDocumentsWaitForBalance).toBe(false); });

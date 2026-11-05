// Task 4 (recovery paths): a signature is only "signed" once the signature row is really saved. A write error or 0 rows
// written throws the plain message and logs no signed event.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, any>;
type W = { error: { code?: string; message: string } | null; rows: Row[] };
const J = "10000000-0000-4000-8000-0000000000e1";
const A = "20000000-0000-4000-8000-0000000000e1";
const U = "30000000-0000-4000-8000-0000000000e1";
const MSG = "Your signature didn't save – please try again.";
const OK: W = { error: null, rows: [{ id: "new" }] };

const st = {
  write: { ...OK } as W, // result of the signature write under test
  upsert: { ...OK } as W, // declarations upsert
  agreement: null as Row | null,
  assignment: {} as Row,
  variation: {} as Row,
  events: [] as Row[],
  decl: null as Row | null, declRow: null as Row | null,
};
const reset = () => {
  st.write = { ...OK }; st.upsert = { ...OK }; st.agreement = null; st.events = []; st.decl = null; st.declRow = null;
  st.assignment = {
    id: A, job_id: J, record_kind: "final_veec_assignment", status: "awaiting_installer_signature",
    final_facts: { template_version: "v1.1" }, final_facts_sha256: "facts", installer_user_id: U,
    installer_signed_at: null, ap_signed_at: null, consumer_signed_at: null, consumer_final_required: false, consumer_declaration_version: "v1.1",
  };
  st.variation = { id: "v1", job_id: J, assignment_id: A, status: "pending", reasons: ["r"], proposed_snapshot: {}, resume_status: "awaiting_installer_signature" };
};

const TEMPLATES = ["consumer_rights", "customer_agreement", "installer_declaration", "consumer_declaration", "ap_declaration"].map((k) => ({
  template_key: k, version: k === "consumer_declaration" ? "v1.1" : "v1", body: "x", approved: true, is_active: true, required: true, form_fields: null, requires_final_consumer_signature: false,
}));

function chain(table: string, op: string) {
  const run = (single: boolean): Row => {
    if (op === "select") {
      switch (table) {
        case "compliance_templates": return { data: TEMPLATES, error: null };
        case "quotes": return { data: { id: "q1", job_id: J, version: 1, option_label: "Batts", option_code: "A", kind: "main", status: "sent", subtotal_inc_gst: 100, veec_discount_inc_gst: 50, customer_total_inc_gst: 50, quote_items: [] }, error: null };
        case "jobs": return { data: { job_number: "HV-1", installation_completed_at: "2026-11-01T00:00:00Z", owners: { full_name: "O", email: "o@x.com", phone: "1" }, properties: { address_line: "1 Test St", suburb: "Town", state: "VIC", postcode: "3000" } }, error: null };
        case "customer_agreements": return { data: st.agreement, error: null };
        case "customer_assignments": return { data: st.assignment, error: null };
        case "assignment_variations": return single ? { data: st.variation, error: null } : { data: null, count: 0, error: null };
        case "job_assignments": return { data: { user_id: U, business_id: null }, error: null };
        case "profiles": return { data: { full_name: "Ivy", licence_number: "1", business_id: null }, error: null };
        case "installer_declarations": return { data: st.decl, error: null };
        case "declarations": return { data: st.declRow, error: null };
        case "workflow_events": return { data: st.events.filter((e) => e.event_type === "INSTALLER_DECLARATION_SIGNED").map(() => ({ id: "e" })), error: null };
        case "owner_gate_signatures": return { data: [], error: null };
        default: return { data: null, error: null };
      }
    }
    // writes
    let w: W = OK;
    if (["customer_agreements", "installer_declarations", "assignment_variations", "customer_assignments"].includes(table)) w = st.write;
    else if (table === "declarations") w = st.upsert;
    if (w.error) return { data: null, error: w.error };
    if (table === "installer_declarations" && w.rows[0]) st.decl = { id: "new", status: "signed", signed_by: U, template_version: "v1", installed_product: "Batts", signed_at: "t", snapshot_sha256: "h" };
    if (table === "declarations" && w.rows[0]) st.declRow = { id: "d" };
    return single ? { data: w.rows[0] ?? null, error: w.rows[0] ? null : { code: "PGRST116", message: "0 rows" } } : { data: w.rows, error: null };
  };
  const q: any = {
    eq: () => q, neq: () => q, is: () => q, in: () => q, gte: () => q, lte: () => q, not: () => q, or: () => q, ilike: () => q, order: () => q, limit: () => q, select: () => q,
    maybeSingle: async () => run(true), single: async () => run(true),
    then: (res: any, rej: any) => Promise.resolve(run(false)).then(res, rej),
  };
  return q;
}
const admin = {
  from: (t: string) => ({ select: () => chain(t, "select"), update: () => chain(t, "update"), insert: () => chain(t, "insert"), upsert: () => chain(t, "upsert") }),
  storage: { from: () => ({ upload: async () => ({ error: null }), download: async () => ({ data: null, error: null }) }) },
  rpc: async () => ({ data: true, error: null }),
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  logEvent: async (job_id: string, actor_id: string | null, event_type: string) => { st.events.push({ job_id, actor_id, event_type }); },
}));
mock.module("../src/lib/comms.server", () => ({ customerDeliveryState: async () => "ready_to_send" }));
mock.module("../src/lib/signed-pdf.server", () => ({ textToPdf: async () => new Uint8Array([1]), signedAcceptancePdf: async () => new Uint8Array([1]) }));
const realForm = await import("../src/lib/veec-assignment-form.core");
mock.module("../src/lib/veec-assignment-form.core", () => ({ ...realForm, apPrerequisiteBlockers: () => [] })); // prerequisites are not under test
mock.module("../src/lib/recovery-work.server", () => ({ addWork: async () => undefined }));

const { signCustomerAgreement, signInstallerDecl, signFinalAssignment, writeApSignature, reconfirmVariation } = await import("../src/lib/assignment.server");
beforeEach(reset);

const errWrite: W = { error: { message: "db down" }, rows: [] };
const zeroWrite: W = { error: null, rows: [] };
const bad: [string, W][] = [["write error", errWrite], ["0 rows written", zeroWrite]];
const signedEvents = () => st.events.filter((e) => ["CUSTOMER_AGREEMENT_SIGNED", "INSTALLER_DECLARATION_SIGNED", "FINAL_ASSIGNMENT_SIGNED", "ASSIGNMENT_VARIATION_RECONFIRMED"].includes(e.event_type));

const agreementArgs = () => ({
  quoteId: "q1", actorId: U, assistance: "none" as const, ip: null, userAgent: null,
  input: { signatoryName: "Owner", authorityType: "owner" as const, over18: true, readConsumerInfo: true, acceptAgreement: true, signatureName: "Owner Name" },
});
const declArgs = () => ({ jobId: J, actorId: U, asQuotedProduct: true, installedArea: 10, fieldValues: {}, signatureName: "Ivy Installer", ip: null, userAgent: null });
const finalArgs = (party: "installer" | "ap" | "consumer") => ({ jobId: J, actorId: U, party, signatureName: "Some Name", ip: null, userAgent: null });

describe("signature save check", () => {
  for (const [label, w] of bad) {
    test(`signCustomerAgreement: ${label} -> exact message, no signed event`, async () => {
      st.write = w;
      await expect(signCustomerAgreement(agreementArgs() as any)).rejects.toThrow(MSG);
      expect(signedEvents()).toHaveLength(0);
    });
    test(`signInstallerDecl: ${label} on the declaration -> exact message, no signed event`, async () => {
      st.agreement = { id: "ag", quoted_product: "Batts" };
      st.write = w;
      await expect(signInstallerDecl(declArgs())).rejects.toThrow(MSG);
      expect(signedEvents()).toHaveLength(0);
    });
    test(`signInstallerDecl: ${label} on the declarations upsert -> exact message, no signed event`, async () => {
      st.agreement = { id: "ag", quoted_product: "Batts" };
      st.upsert = w;
      await expect(signInstallerDecl(declArgs())).rejects.toThrow(MSG);
      expect(signedEvents()).toHaveLength(0);
    });
    test(`signFinalAssignment (installer): ${label} -> exact message, no signed event`, async () => {
      st.write = w;
      await expect(signFinalAssignment(finalArgs("installer"))).rejects.toThrow(MSG);
      expect(signedEvents()).toHaveLength(0);
    });
    test(`signFinalAssignment (consumer): ${label} -> exact message, no signed event`, async () => {
      st.assignment = { ...st.assignment, installer_signed_at: "t", ap_signed_at: "t" };
      st.write = w;
      await expect(signFinalAssignment({ ...finalArgs("consumer"), signatoryName: "Owner", over18: true } as any)).rejects.toThrow(MSG);
      expect(signedEvents()).toHaveLength(0);
    });
    test(`reconfirmVariation: ${label} -> exact message, no reconfirmed event`, async () => {
      st.write = w;
      await expect(reconfirmVariation({ variationId: "v1", actorId: U, signatureName: "Some Name", ip: null, userAgent: null })).rejects.toThrow(MSG);
      expect(signedEvents()).toHaveLength(0);
    });
  }

  test("signInstallerDecl: failed declarations upsert is repaired on retry, with exactly one signed event", async () => {
    st.agreement = { id: "ag", quoted_product: "Batts" };
    st.upsert = errWrite;
    await expect(signInstallerDecl(declArgs())).rejects.toThrow(MSG);
    expect(signedEvents()).toHaveLength(0);
    st.upsert = { ...OK };
    await expect(signInstallerDecl(declArgs())).resolves.toBe("new");
    expect(signedEvents()).toHaveLength(1);
    await expect(signInstallerDecl(declArgs())).rejects.toThrow("Installer declaration already signed.");
    expect(signedEvents()).toHaveLength(1);
  });
  test("signFinalAssignment (ap): a writeApSignature write error surfaces the exact message", async () => {
    st.assignment = { ...st.assignment, installer_signed_at: "t" };
    st.write = errWrite;
    await expect(signFinalAssignment(finalArgs("ap"))).rejects.toThrow(MSG);
    expect(signedEvents()).toHaveLength(0);
  });

  const apArgs = () => ({ assignmentId: A, templates: TEMPLATES as any, officialVersion: "v1.1", sig: { at: "t" }, hash: "h", signatureName: "AP Rep", actorId: null, method: "automatic" as const });
  test("writeApSignature: a write error throws the exact message", async () => {
    st.write = errWrite;
    await expect(writeApSignature(apArgs())).rejects.toThrow(MSG);
  });
  test("writeApSignature: 0 rows still means 'already signed' (returns false, never a fake success)", async () => {
    st.write = zeroWrite;
    expect(await writeApSignature(apArgs())).toBe(false);
  });
});

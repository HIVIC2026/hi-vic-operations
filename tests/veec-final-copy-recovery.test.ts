// Task 3 (recovery paths): the VEEC assignment only completes with a stored signed copy; a failed read or write never reports "done".
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, any>;
type E = { code?: string; message: string } | null;
const J = "10000000-0000-4000-8000-0000000000d1";
const A = "20000000-0000-4000-8000-0000000000d1";

const st = {
  assignment: {} as Row,
  uploadError: null as E, documentsError: null as E, variationError: null as E, updateError: null as E, complianceError: null as E,
  rpc: { data: true as any, error: null as E },
  rpcCalls: [] as { name: string; args: Row }[],
  events: [] as Row[], work: [] as Row[], compliance: [] as Row[], documents: [] as Row[], uploads: [] as string[],
};
const reset = () => {
  st.assignment = {
    id: A, job_id: J, record_kind: "final_veec_assignment", status: "awaiting_consumer_signature", prepared_at: "2026-11-01T00:00:00Z",
    final_facts: { template_version: "v1.1", form_values: {}, completed_date: "2026-11-01", property_address: "1 Test St", installed: [], total_installed_area_m2: 10,
      installer: { name: "Ivy", business: "B", licence: "1" }, final_customer_price_inc_gst: 100, veu_benefit_inc_gst: 50, payment: {} },
    final_facts_sha256: "facts", installer_signed_at: "t", ap_signed_at: "t", consumer_signed_at: "t", installed_product: "Batts", installed_area_m2: 10,
    consumer_final_required: false, consumer_declaration_version: "v1.1", ap_legal_entity: "AP", consumer_snapshot: { form: { body: "form" } },
    installer_signature_name: "I", ap_signature_name: "A", consumer_signature_name: "C", signatory_name: "C", signatory_authority_type: "owner", consumer_ip: "1.1.1.1",
  };
  Object.assign(st, { uploadError: null, documentsError: null, variationError: null, updateError: null, complianceError: null, rpc: { data: true, error: null }, rpcCalls: [], events: [], work: [], compliance: [], documents: [], uploads: [] });
};

const TEMPLATES = [{ template_key: "consumer_declaration", version: "v1.1", body: "x", approved: true, is_active: true, required: true, form_fields: null, requires_final_consumer_signature: false }];

function chain(table: string, op: string, payload?: Row) {
  const f: [string, string, unknown][] = [];
  let head = false;
  const run = (): Row => {
    if (table === "customer_assignments") {
      if (op === "select") return { data: st.assignment, error: null };
      if (op === "update") { if (st.updateError) return { data: null, error: st.updateError }; Object.assign(st.assignment, payload); return { data: [{ id: A }], error: null }; }
    }
    if (table === "jobs") return { data: { job_number: "HV-1" }, error: null };
    if (table === "assignment_variations") return st.variationError ? { data: null, count: null, error: st.variationError } : { data: null, count: 0, error: null };
    if (table === "compliance_templates") return { data: TEMPLATES, error: null };
    if (table === "documents") { if (st.documentsError) return { error: st.documentsError }; st.documents.push(payload!); return { error: null }; }
    if (table === "compliance_checks") { if (st.complianceError) return { error: st.complianceError }; st.compliance.push(payload!); return { error: null }; }
    if (table === "recovery_work") { st.work.push(payload!); return { error: null }; }
    return { data: null, error: null };
  };
  const q: any = {
    eq: (k: string, v: unknown) => (f.push([k, "eq", v]), q), neq: (k: string, v: unknown) => (f.push([k, "neq", v]), q),
    is: () => q, order: () => q, limit: () => q,
    select: (_c?: string, o?: { head?: boolean }) => (head = !!o?.head, q),
    maybeSingle: async () => run(), single: async () => run(),
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  void head;
  return q;
}
const admin = {
  from: (t: string) => ({ select: (c?: string, o?: any) => chain(t, "select").select(c, o), update: (p: Row) => chain(t, "update", p), insert: (p: Row) => chain(t, "insert", p) }),
  storage: { from: () => ({ upload: async (p: string) => { st.uploads.push(p); return { error: st.uploadError }; }, download: async () => ({ data: null, error: null }) }) },
  rpc: async (name: string, args: Row) => { st.rpcCalls.push({ name, args }); return st.rpc; },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details: Row = {}) => { st.events.push({ job_id, actor_id, event_type, summary, details }); },
}));
mock.module("../src/lib/comms.server", () => ({ customerDeliveryState: async () => "ready_to_send" }));
mock.module("../src/lib/signed-pdf.server", () => ({ textToPdf: async () => new Uint8Array([1, 2, 3]), signedAcceptancePdf: async () => new Uint8Array([1]) }));
mock.module("../src/lib/veec-form-pdf.server", () => ({ veecFormPdf: async () => ({ bytes: new Uint8Array([1, 2]), layout: { split: [] } }) }));

const { evaluateAndApply, signFinalAssignment } = await import("../src/lib/assignment.server");
beforeEach(reset);

const effective = () => st.events.filter((e) => e.event_type === "VEEC_ASSIGNMENT_EFFECTIVE");
const nothingRecorded = () => {
  expect(st.assignment.status).toBe("awaiting_consumer_signature");
  expect(st.compliance).toHaveLength(0);
  expect(effective()).toHaveLength(0);
  expect(st.rpcCalls.filter((c) => c.name === "complete_veec_assignment")).toHaveLength(0);
};

describe("signed copy", () => {
  test("upload_fails_no_pass", async () => {
    st.uploadError = { message: "storage down" };
    const r = await evaluateAndApply(J, null);
    nothingRecorded();
    expect(r?.status).toBe("awaiting_consumer_signature");
    expect(st.work).toEqual([{ kind: "veec_final_copy", work_key: A, job_id: J, payload: {} }]);
  });
  test("documents_insert_fails_no_pass", async () => {
    st.documentsError = { message: "insert failed" };
    await evaluateAndApply(J, null);
    nothingRecorded();
    expect(st.work).toHaveLength(1);
    expect(st.work[0]!.work_key).toBe(A);
  });
  test("happy path completes through the RPC once", async () => {
    const r = await evaluateAndApply(J, "actor");
    expect(r?.status).toBe("effective_complete");
    expect(st.work).toHaveLength(0);
    const call = st.rpcCalls.find((c) => c.name === "complete_veec_assignment")!;
    expect(call.args["p_assignment_id"]).toBe(A);
    expect(call.args["p_job_id"]).toBe(J);
    expect(call.args["p_delivery"]).toBe("ready_to_send");
    expect(call.args["p_actor"]).toBe("actor");
    expect(String(call.args["p_path"])).toContain(`${J}/assignment/final-`);
    expect(String(call.args["p_summary"])).toContain("signed copy stored (customer delivery ready)");
  });
  test("rpc_error_records_nothing", async () => {
    st.rpc = { data: null, error: { code: "XX000", message: "db down" } };
    await expect(evaluateAndApply(J, null)).rejects.toThrow("db down");
    expect(st.assignment.status).toBe("awaiting_consumer_signature");
    expect(st.compliance).toHaveLength(0);
    expect(effective()).toHaveLength(0);
  });
  test("rpc false (already complete) does not log or update", async () => {
    st.rpc = { data: false, error: null };
    await evaluateAndApply(J, null);
    expect(effective()).toHaveLength(0);
  });
  test.each(["PGRST202", "42883"])("rpc missing (%s): old three writes, each checked, event last", async (code) => {
    st.rpc = { data: null, error: { code, message: "not found" } };
    const r = await evaluateAndApply(J, null);
    expect(r?.status).toBe("effective_complete");
    expect(st.assignment.status).toBe("effective_complete");
    expect(st.compliance).toHaveLength(1);
    expect(effective()).toHaveLength(1);
  });
  test("rpc missing, assignment update error throws and writes no event", async () => {
    st.rpc = { data: null, error: { code: "PGRST202", message: "nf" } };
    st.updateError = { message: "update failed" };
    await expect(evaluateAndApply(J, null)).rejects.toThrow("update failed");
    expect(effective()).toHaveLength(0);
  });
  test("rpc missing, compliance error throws and writes no event", async () => {
    st.rpc = { data: null, error: { code: "42883", message: "nf" } };
    st.complianceError = { message: "compliance failed" };
    await expect(evaluateAndApply(J, null)).rejects.toThrow("compliance failed");
    expect(effective()).toHaveLength(0);
  });
});

describe("variation check", () => {
  test("variation_count_error_sign", async () => {
    st.variationError = { message: "boom" };
    Object.assign(st.assignment, { status: "awaiting_installer_signature", installer_signed_at: null, ap_signed_at: null, consumer_signed_at: null });
    await expect(signFinalAssignment({ jobId: J, actorId: "u", party: "installer", signatureName: "Ivy Installer", ip: null, userAgent: null })).rejects.toThrow("Couldn't check for changes – try again.");
  });
  test("variation_count_error_complete", async () => {
    st.variationError = { message: "boom" };
    const r = await evaluateAndApply(J, null);
    nothingRecorded();
    expect(r?.status).toBe("awaiting_consumer_signature");
    expect(st.work).toHaveLength(1);
    expect(st.work[0]!.kind).toBe("veec_final_copy");
  });
  test("nonfinal_status_update_error_throws", async () => {
    Object.assign(st.assignment, { status: "awaiting_installer_signature", ap_signed_at: null, consumer_signed_at: null }); // evaluates to awaiting_ap_signature
    st.updateError = { message: "update failed" };
    await expect(evaluateAndApply(J, null)).rejects.toThrow("update failed");
  });
});

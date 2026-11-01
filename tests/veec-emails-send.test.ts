// Decision 169 (Jo, 24 Oct 2026): the day-0 VEEC signing request IS the approved All done email (O44) plus the approved
// text; days 1/3/7 send O61 + the reminder text; the signed copy goes out as O62 with the executed PDF attached.
// Runs the real veec-reminders / veec-copy-email / approved-owner-emails / owner-template-send chain against an in-memory
// database; every sender (test-send, guarded owner email, real SMS) is a recorder, so nothing is sent anywhere.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const J = "00000000-0000-0000-0000-00000000000a", T = "00000000-0000-0000-0000-00000000000b", OWNER = "00000000-0000-0000-0000-0000000000c1", TOWNER = "00000000-0000-0000-0000-0000000000c2";
const ASG = "00000000-0000-0000-0000-0000000000d1", FINAL = `${J}/assignment/final-abc123def456.pdf`;
const PDF = new TextEncoder().encode("%PDF-1.4 signed copy");
const LINK = "https://estimate.homeinsulationvictoria.com.au/my-job/tok-real?screen=done";
let tables: Record<string, Row[]> = {};
let seq = 0;
function reset() {
  seq = 0;
  tables = {
    jobs: [
      { id: J, owner_id: OWNER, source: "website", property_id: null, job_number: "HV-3117", stage: "evidence_outstanding", installation_completed_at: "2026-11-21T02:00:00Z", deleted_at: null },
      { id: T, owner_id: TOWNER, source: "qa_test", property_id: null, job_number: "HV-9001", stage: "evidence_outstanding", installation_completed_at: "2026-11-21T02:00:00Z", deleted_at: null },
    ],
    owners: [{ id: OWNER, full_name: "Helen Yang", email: "helen@example.com", phone: "0400111222" }, { id: TOWNER, full_name: "Jo Test", email: "jo@example.com", phone: "0400999888" }],
    job_assignments: [{ job_id: J, role: "installer", active: true, businesses: { name: "Reinsulate", trading_name: null, phone: "0400 000 000", onboarding_notes: null } }, { job_id: T, role: "installer", active: true, businesses: { name: "[TEST PARTNER] Reinsulate", trading_name: null, phone: "0400 000 000", onboarding_notes: "[TEST PARTNER]" } }],
    customer_estimate_links: [{ job_id: J, purpose: "step3_estimate", status: "active", token: "tok-real", expires_at: "2099-01-01T00:00:00Z" }, { job_id: T, purpose: "step3_estimate", status: "active", token: "tok-test", expires_at: "2099-01-01T00:00:00Z" }],
    customer_agreements: [{ job_id: J, status: "signed", quoted_product: "Bradford Gold R5.0", quoted_area_m2: 137.6, veu_benefit_inc_gst: 1850 }, { job_id: T, status: "signed", quoted_product: "Bradford Gold R5.0", quoted_area_m2: 100, veu_benefit_inc_gst: 1200 }],
    invoices: [{ job_id: J, kind: "installation", total_inc_gst: 2200, total_paid: 2200, created_at: "2026-11-01T00:00:00Z" }],
    customer_assignments: [{ id: ASG, job_id: J, record_kind: "final_veec_assignment", status: "effective_complete", consumer_signed_at: "2026-11-21T03:00:00Z", copy_sent_at: null, final_copy_path: FINAL }],
    workflow_events: [], customer_email_sends: [],
  };
}
let missingPdf = false;
function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" = "select", patch: Row = {}, orderCol: string | null = null, desc = false, lim = Infinity, mode: "many" | "maybe" | "one" = "many", head = false, count = false;
  const rows = () => (tables[table] ??= []);
  const run = () => {
    if (op === "insert") {
      const row = { id: `${table}-${++seq}`, ...patch };
      if (table === "customer_email_sends" && rows().some((r) => r["idempotency_key"] === row["idempotency_key"])) return { data: null, error: { message: "duplicate key" } };
      rows().push(row);
      return { data: mode === "many" ? [row] : row, error: null };
    }
    if (op === "update") { for (const r of rows()) if (filters.every((f) => f(r))) Object.assign(r, patch); return { data: null, error: null }; }
    let out = rows().filter((r) => filters.every((f) => f(r)));
    if (orderCol) out = [...out].sort((a, b) => (String(a[orderCol!]) < String(b[orderCol!]) ? -1 : 1) * (desc ? -1 : 1));
    out = out.slice(0, lim);
    if (count || head) return { data: null, count: out.length, error: null };
    return { data: mode === "many" ? out : out[0] ?? null, error: null };
  };
  const b: Record<string, unknown> = {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => { if (op === "select") { head = !!o?.head; count = o?.count === "exact"; } return b; },
    insert: (p: Row) => { op = "insert"; patch = p; return b; }, update: (p: Row) => { op = "update"; patch = p; return b; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; }, neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return b; },
    in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; },
    is: (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
    not: (c: string) => { filters.push((r) => r[c] != null); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { orderCol = c; desc = o?.ascending === false; return b; }, limit: (n: number) => { lim = n; return b; },
    maybeSingle: () => { mode = "maybe"; return b; }, single: () => { mode = "one"; return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
  };
  return b;
}
const fakeAdmin = {
  from: builder,
  storage: { from: (bucket: string) => ({ download: async (path: string) => (bucket === "job-files" && path === FINAL && !missingPdf ? { data: new Blob([PDF]), error: null } : { data: null, error: { message: "Object not found" } }) }) },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { (tables["workflow_events"] ??= []).push({ job_id: job, actor_id: actor, event_type: type, summary, details: details ?? {} }); },
}));

type Mail = { subject: string; html: string; text: string; attachments?: { filename: string; content: string; contentType: string }[] };
const guarded: { purpose: string; key: string; to: string; jobSource: string | null; mail: Mail }[] = [];
const tests: { kind: "email" | "sms"; to: string; label: string; subject?: string; body: string; attachments?: Mail["attachments"] }[] = [];
const sms: { type: string; idempotencyKey: string; to: string | null; body: string; jobId: string }[] = [];
let deliveryBlocked: string | null = null;
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: { jobId: string; jobSource: string | null; to: string; purpose: string; key: string; build: (u: string | null) => Mail }) => {
    const dup = guarded.some((g) => g.key === p.key);
    if (dup) return "already attempted — not resent";
    guarded.push({ purpose: p.purpose, key: p.key, to: p.to, jobSource: p.jobSource, mail: p.build("https://estimate.homeinsulationvictoria.com.au/u/x") });
    return "sent";
  },
}));
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (ctx: { label: string }, to: string, subject: string, html: string, text: string, opts?: { attachments?: Mail["attachments"] }) => { tests.push({ kind: "email", to, label: ctx.label, subject, body: html, attachments: opts?.attachments }); void text; return { channel: "email", to, status: "sent", detail: "Resend accepted (test)" }; },
  sendTestSms: async (ctx: { label: string }, to: string, body: string) => { tests.push({ kind: "sms", to, label: ctx.label, body }); return { channel: "sms", to, status: "sent", detail: "Twilio accepted (test)" }; },
}));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (p: { type: string; idempotencyKey: string; to: string | null; body: string; jobId: string }) => { sms.push(p); return { status: "sent", detail: "recorded" }; } }));
mock.module("../src/lib/comms.server", () => ({
  assertCustomerDeliveryAllowed: async () => { if (deliveryBlocked) throw new Error(deliveryBlocked); },
  customerDeliveryState: async () => "ready",
}));

const { sendVeecSignStep, REQUEST_CARRIED_BY_ALL_DONE } = await import("../src/lib/veec-reminders.server");
const { sendVeecCopyEmail } = await import("../src/lib/veec-copy-email.server");
const events = (type: string, job = J) => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === type && e["job_id"] === job);

beforeEach(() => { reset(); guarded.length = 0; tests.length = 0; sms.length = 0; deliveryBlocked = null; missingPdf = false; });

describe("day-0 request (decision 169): the All done email is the request", () => {
  test("real job: one O44 email under the install-complete key + the approved request text; no separate request email", async () => {
    const r = await sendVeecSignStep(J, "request");
    expect(r).toBe("All done email sent; sms sent: recorded");
    expect(guarded.map((g) => [g.purpose, g.key])).toEqual([["install_complete", `install-complete:v1:${J}`]]);
    const mail = guarded[0]!.mail;
    expect(mail.subject).toBe("All done, Helen. Enjoy a warmer home!");
    for (const s of ["One last thing: sign your rebate form", `href="${LINK}"`, "137.6 m² Bradford Gold R5.0", "$1,850 off", "Paid in full ✓", "Contact Reinsulate first on 0400 000 000"]) expect(mail.html).toContain(s);
    expect(guarded.some((g) => g.purpose.startsWith("veec_sign_"))).toBe(false);
    expect(sms).toEqual([{ type: "veec_sign_request", idempotencyKey: `veec-sign:v1:${J}:request`, to: "0400111222", body: expect.stringContaining("$1,850"), jobId: J }]);
    expect(sms[0]!.body).toContain(LINK);
    const ev = events("veec_sign_reminder");
    expect(ev).toHaveLength(1);
    expect(ev[0]!["details"]).toEqual({ step: "request", email: REQUEST_CARRIED_BY_ALL_DONE });
    expect(tests).toEqual([]);
  });
  test("the request step never repeats, and the All done key blocks a second All done email from any path", async () => {
    await sendVeecSignStep(J, "request");
    expect(await sendVeecSignStep(J, "request")).toBe("already handled");
    expect(guarded).toHaveLength(1); expect(sms).toHaveLength(1);
    const { emailOwnerInstallComplete } = await import("../src/lib/approved-owner-emails.server");
    expect(await emailOwnerInstallComplete(J, { product: "x", areaM2: 1, rebate: 1, balancePaid: false, signRebateFormUrl: LINK })).toBe("already attempted — not resent");
    expect(guarded).toHaveLength(1);
  });
  test("balance not yet paid shows 'Due today'; no invoice means not paid", async () => {
    tables["invoices"] = [];
    await sendVeecSignStep(J, "request");
    expect(guarded[0]!.mail.html).toContain("Due today");
  });
  test("TEST job: All done email and request text go only through test-send", async () => {
    expect(await sendVeecSignStep(T, "request")).toBe("All done email sent: Resend accepted (test); sms sent: Twilio accepted (test)");
    expect(guarded).toEqual([]); expect(sms).toEqual([]);
    expect(tests.map((t) => [t.kind, t.to, t.label])).toEqual([["email", "jo@example.com", `install_complete:install-complete:v1:${T}`], ["sms", "0400999888", "veec_sign:request"]]);
    expect(tests[0]!.subject).toBe("All done, Jo. Enjoy a warmer home!");
    expect(tests[0]!.body).toContain("TEST — only sent to Jo");
  });
});

describe("reminders (days 1/3/7): O61 + the approved reminder text", () => {
  test("real job: O61 through the guarded path under the step key, reminder text through the one real sender", async () => {
    expect(await sendVeecSignStep(J, "reminder_1")).toBe("email sent; sms sent: recorded");
    expect(guarded.map((g) => [g.purpose, g.key, g.to])).toEqual([["veec_sign_reminder_1", `veec-sign:v1:${J}:reminder_1`, "helen@example.com"]]);
    const mail = guarded[0]!.mail;
    expect(mail.subject).toBe("Helen, your rebate form still needs your signature");
    for (const s of ["We can't claim your $1,850 Victorian Energy Upgrades rebate", `href="${LINK}"`, "Sign your rebate form</a>", 'href="https://estimate.homeinsulationvictoria.com.au/u/x" style="color:#5A6785">Unsubscribe</a>']) expect(mail.html).toContain(s);
    expect(mail.html).not.toContain("All done");
    expect(sms).toEqual([{ type: "veec_sign_reminder", idempotencyKey: `veec-sign:v1:${J}:reminder_1`, to: "0400111222", body: expect.stringContaining("still needs your signature"), jobId: J }]);
    expect(await sendVeecSignStep(J, "reminder_1")).toBe("already handled");
    expect(guarded).toHaveLength(1);
  });
  test("each reminder day is its own step and key", async () => {
    for (const step of ["reminder_1", "reminder_3", "reminder_7"] as const) await sendVeecSignStep(J, step);
    expect(guarded.map((g) => g.key)).toEqual([`veec-sign:v1:${J}:reminder_1`, `veec-sign:v1:${J}:reminder_3`, `veec-sign:v1:${J}:reminder_7`]);
    expect(sms.map((s) => s.idempotencyKey)).toEqual(guarded.map((g) => g.key));
  });
  test("customer messages locked: the step is recorded, no email, the text is left to the real sender's own gate", async () => {
    deliveryBlocked = "Customer communications are switched off";
    expect(await sendVeecSignStep(J, "reminder_3")).toBe("email not sent — Customer communications are switched off; sms sent: recorded");
    expect(guarded).toEqual([]);
    expect(events("veec_sign_reminder")).toHaveLength(1);
  });
  test("TEST job: O61 and the text through test-send only", async () => {
    await sendVeecSignStep(T, "reminder_1");
    expect(guarded).toEqual([]); expect(sms).toEqual([]);
    expect(tests.map((t) => [t.kind, t.label])).toEqual([["email", "veec_sign:reminder_1"], ["sms", "veec_sign:reminder_1"]]);
    expect(tests[0]!.subject).toBe("Jo, your rebate form still needs your signature");
  });
  test("no working owner link: nothing sent, recorded for the office", async () => {
    tables["customer_estimate_links"] = [];
    expect(await sendVeecSignStep(J, "reminder_1")).toBe("not sent — owner link missing");
    expect(guarded).toEqual([]); expect(sms).toEqual([]);
    expect(events("veec_sign_request_not_sent")).toHaveLength(1);
  });
});

describe("signed copy (O62) with the executed PDF attached", () => {
  const b64 = btoa(String.fromCharCode(...PDF));
  test("real job: O62 through the guarded path with the stored PDF attached; marked sent once", async () => {
    expect(await sendVeecCopyEmail(J)).toBe("sent");
    expect(guarded.map((g) => [g.purpose, g.key, g.to])).toEqual([["veec_assignment_copy", `veec-copy:v1:${ASG}`, "helen@example.com"]]);
    const mail = guarded[0]!.mail;
    expect(mail.subject).toBe("Here's your signed rebate form, Helen");
    for (const s of ["Your copy of the rebate form for HV-3117 is attached", "<strong>Signed on 21 November 2026</strong>", "veu@esc.vic.gov.au"]) expect(mail.html).toContain(s);
    expect(mail.attachments).toEqual([{ filename: "VEEC-assignment-form-HV-3117.pdf", content: b64, contentType: "application/pdf" }]);
    const a = tables["customer_assignments"]![0]!;
    expect(typeof a["copy_sent_at"]).toBe("string");
    expect(events("veec_copy_email_sent")[0]!["summary"]).toContain("PDF attached");
    expect(await sendVeecCopyEmail(J)).toBe("already sent");
    expect(guarded).toHaveLength(1);
  });
  test("stored PDF unreadable: not sent (the wording says attached), left for the tick to retry", async () => {
    missingPdf = true;
    expect(await sendVeecCopyEmail(J)).toBe("not sent — signed copy file unavailable");
    expect(guarded).toEqual([]);
    expect(tables["customer_assignments"]![0]!["copy_sent_at"]).toBeNull();
    expect(events("veec_copy_email_not_sent")).toHaveLength(1);
  });
  test("customer messages locked: not sent, not marked", async () => {
    deliveryBlocked = "Customer communications are switched off";
    expect(await sendVeecCopyEmail(J)).toBe("not sent — Customer communications are switched off");
    expect(tables["customer_assignments"]![0]!["copy_sent_at"]).toBeNull();
  });
  test("TEST job: O62 + attachment through test-send", async () => {
    tables["customer_assignments"] = [{ id: "asg-t", job_id: T, record_kind: "final_veec_assignment", status: "effective_complete", consumer_signed_at: "2026-11-21T03:00:00Z", copy_sent_at: null, final_copy_path: FINAL }];
    expect(await sendVeecCopyEmail(T)).toBe("sent: Resend accepted (test)");
    expect(guarded).toEqual([]);
    expect(tests.map((t) => [t.kind, t.to, t.label])).toEqual([["email", "jo@example.com", "veec_copy:asg-t"]]);
    expect(tests[0]!.attachments).toEqual([{ filename: "VEEC-assignment-form-HV-9001.pdf", content: b64, contentType: "application/pdf" }]);
    expect(typeof tables["customer_assignments"]![0]!["copy_sent_at"]).toBe("string");
  });
  test("not yet effective: skipped", async () => {
    tables["customer_assignments"]![0]!["consumer_signed_at"] = null;
    expect(await sendVeecCopyEmail(J)).toBe("skipped — not effective");
  });
});

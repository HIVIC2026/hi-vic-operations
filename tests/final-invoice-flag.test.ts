// Part 4 Task 14 fix round 1 (touchpoint 52): the O45 final invoice email keeps going while ALL_DONE_V2_APPROVED is false
// (an unpaid owner still gets a tax invoice) and stops the moment Jo approves the one All done email. The live trigger
// (install recorded complete) and the 15-minute sweep both run through onFinalInvoiceDue. Everything is in-memory.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as core from "../src/lib/owner-email-triggers.core";
import * as finalCore from "../src/lib/final-invoice-email.core";
import * as sweepCore from "../src/lib/sweep-batch.core";
import * as claimCore from "../src/lib/mitti-create-claim.core";

function load(path: string, deps: Record<string, unknown>) {
  const api: Record<string, any> = {};
  new Function("exports", "require", ts.transpile(readFileSync(path, "utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(api, (name: string) => { if (!(name in deps)) throw Error(`Unmocked ${name}`); return deps[name]; });
  return api;
}

function triggers(flag: boolean) {
  const sent: string[] = []; const events: string[] = [];
  const row = (data: unknown) => ({ data, error: null, count: 0 });
  const q = (data: unknown, list: unknown[] = []): any => { const o: any = {}; for (const m of ["select", "eq", "in", "is", "gte", "order", "limit", "contains", "update"]) o[m] = () => o; o.maybeSingle = async () => row(data); o.then = (r: any) => Promise.resolve(row(list)).then(r); return o; };
  const admin = { from: (t: string) => t === "jobs" ? q({ stage: "evidence_outstanding", deleted_at: null, qa_archived_at: null, installation_completed_at: "2026-11-11T05:00:00Z" }, [{ id: "j" }])
    : t === "invoices" ? q({ id: "inv1", quote_id: "q1", total_inc_gst: 2200, total_paid: 0, xero_invoice_id: "x1", xero_invoice_number: "INV-1", quotes: { veec_discount_inc_gst: 1850, quote_items: [] } })
    // The trigger event is written directly as the once-only claim (fix 7 Nov), not through logEvent.
    : t === "workflow_events" ? Object.assign(q([]), { insert: async (r: { event_type: string }) => { events.push(r.event_type); return { error: null }; } }) : q(null) };
  const api = load("src/lib/owner-email-triggers.server.ts", {
    "@/integrations/supabase/client.server": { supabaseAdmin: admin },
    "./workflow.server": { logEvent: async (_j: string, _a: unknown, type: string) => { events.push(type); } },
    "./in-house-suppression.server": { inHouseDispatchSkip: async () => null },
    "./owner-email-triggers.core": core,
    "./mitti-create-claim.core": claimCore,
    "./completion-emails.core": { ALL_DONE_V2_APPROVED: flag },
    "./final-invoice-email.core": finalCore,
    "./payments.server": { paymentLedger: async () => [], bankDetails: () => ({ accountName: "HIV", bsb: "1", account: "2", payId: null }) },
    "./invoice-itemisation.core": { itemiseInvoiceLines: () => ({ items: [] }) },
    "./invoice-itemisation.server": { installedProductFacts: async () => null },
    "./approved-owner-emails.server": { emailOwnerFinalInvoice: async (jobId: string, invoiceId: string) => { sent.push(`${jobId}:${invoiceId}`); return "sent"; } },
    "./sweep-batch.server": { readByJobIds: async () => [{ id: "inv1", job_id: "j", created_at: "2026-11-11T00:00:00Z" }] },
    "./sweep-batch.core": sweepCore,
  });
  return { api, sent, events };
}

test("flag off: O45 goes once per invoice (event first), from the live trigger and from the sweep", async () => {
  const t = triggers(false);
  expect(await t.api.onFinalInvoiceDue("j", new Date("2026-11-11T06:00:00Z"))).toBe("sent");
  expect(t.sent).toEqual(["j:inv1"]);
  expect(t.events).toEqual([core.OWNER_EMAIL_TRIGGER_EVENT]);
  const sweep = await t.api.sweepFinalInvoices(new Date("2026-11-11T06:00:00Z"));
  expect(sweep).toEqual({ checked: 1, sent: 1 }); // the in-memory event store never records, so the sweep sends again here; the key dedupes live
});

test("flag on: nothing is sent and no event is recorded — the All done email carries the invoice", async () => {
  const t = triggers(true);
  expect(await t.api.onFinalInvoiceDue("j", new Date("2026-11-11T06:00:00Z"))).toBe("not due — the balance is in the All done email");
  expect(await t.api.sweepFinalInvoices(new Date("2026-11-11T06:00:00Z"))).toEqual({ checked: 1, sent: 0 });
  expect(t.sent).toEqual([]); expect(t.events).toEqual([]);
});

test("the live wiring is back exactly as before: install-complete calls it best-effort, the tick sweeps it, the hub lists O45 as retiring with ALL_DONE_V2", () => {
  const ic = readFileSync("src/lib/install-complete.server.ts", "utf8");
  expect(ic.split("\n").find((l) => l.includes("onFinalInvoiceDue(jobId)"))).toMatch(/\.catch\(/);
  expect(readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8")).toContain("sweepFinalInvoices()");
  const hub = readFileSync("src/lib/template-hub.core.ts", "utf8");
  expect(hub).toContain('id: "invoices:O45"');
  expect(hub).toContain("Retires when ALL_DONE_V2 is approved");
});

// Mocked tests only – fake Xero, in-memory store. No live Xero calls, no database. Run: bun test ./tests/
import { describe, expect, test } from "bun:test";
import {
  buildDueDateUpdate, buildInvoicePayload, evaluateXeroInvoice, findInvoiceByReference, findOrCreateContact, findTrackingOption,
  invoiceIdemKey, lockHeld, melbourneDate, quoteGuard, XERO_DUE_DATE_UPDATES_ENABLED, xeroReference, type XeroCall,
} from "../src/lib/xero.core";
import {
  buildDepositOverride, clearInstallDueDatePatch, CUSTOMER_INVOICE_COLUMNS, depositGateCleared, depositRequestPatch, ensureInvoice,
  installDueDatePatch, paymentPatch, splitTotal, xeroDueDate, type InvoiceRow, type InvoiceStore,
} from "../src/lib/invoice.lifecycle";
import { installationDateBlocker } from "../src/lib/workflow";
import { itemiseInvoiceLines } from "../src/lib/invoice-itemisation.core";

// ---------- in-memory store with UNIQUE(quote_id) ----------
function memStore() {
  const rows: InvoiceRow[] = [];
  let n = 0;
  const store: InvoiceStore = {
    async find(q) { return rows.find((r) => r.quote_id === q) ?? null; },
    async insert(row) {
      if (rows.some((r) => r.quote_id === row.quote_id)) throw Object.assign(new Error("dup"), { code: "23505" });
      const r: InvoiceRow = { ...row, id: `inv${++n}`, balance_due_date: null, total_paid: 0, deposit_paid_at: null, balance_paid_at: null, xero_invoice_id: null, xero_update_pending: false, deposit_request_raised_at: null, deposit_request_raised_by: null, deposit_request_amount: null, deposit_request_pct: null };
      rows.push(r); return r;
    },
    async update(id, patch) { Object.assign(rows.find((r) => r.id === id)!, patch); },
  };
  return { store, rows };
}
const quote = (total: number | string, status = "accepted") => ({ id: "q1", job_id: "j1", kind: "installation", status, customer_total_inc_gst: total });
const apply = (row: InvoiceRow, patch: Partial<InvoiceRow> | null) => patch && Object.assign(row, patch);

describe("one invoice per accepted quote", () => {
  test("acceptance creates exactly one invoice for the full total", async () => {
    const m = memStore();
    const r = await ensureInvoice(m.store, quote(3330), "2026-09-28");
    expect(r.created).toBe(true);
    expect(m.rows.length).toBe(1);
    expect(r.row.total_inc_gst).toBe(3330);
    expect(r.row.deposit_amount).toBe(349); // safety check payment (Jo 7 Oct)
    expect(r.row.deposit_pct).toBe(0.1048);
    expect(r.row.balance_due_date).toBeNull(); // final due date pending until installation booked
  });
  test("retry / concurrent acceptance never creates a second invoice record", async () => {
    const m = memStore();
    await ensureInvoice(m.store, quote(3330), "2026-09-28");
    const again = await ensureInvoice(m.store, quote(3330), "2026-09-28");
    await Promise.all([ensureInvoice(m.store, quote(3330), "2026-09-28"), ensureInvoice(m.store, quote(3330), "2026-09-28")]);
    expect(again.created).toBe(false);
    expect(m.rows.length).toBe(1);
  });
  test("non-accepted quote raises nothing", async () => {
    await expect(ensureInvoice(memStore().store, quote(3330, "issued"), "2026-09-28")).rejects.toThrow("not accepted");
  });
  test("odd-cent minimum-deposit threshold is currency-safe", () => {
    for (const t of [3000.01, 0.01, 1271.57, 999.99]) {
      const { deposit, balance } = splitTotal(t);
      expect(Math.round((deposit + balance) * 100)).toBe(Math.round(t * 100));
    }
  });
});

describe("deposit gate on the one invoice", () => {
  async function inv() { return (await ensureInvoice(memStore().store, quote(3330), "2026-09-28")).row; }
  test("one cent below the 10% minimum does not unlock", async () => {
    const r = await inv();
    const { patch, events } = paymentPatch(r, 332.99, null, "2026-09-28T00:00:00Z"); apply(r, patch);
    expect(events).toEqual([]);
    expect(depositGateCleared(r, 0)).toBe(false);
  });
  test("cumulative ≥ minimum unlocks, dated when Xero payments reached it", async () => {
    const r = await inv();
    const { patch, events } = paymentPatch(r, 400, "2026-09-27T01:00:00.000Z", "2026-09-28T00:00:00Z"); apply(r, patch);
    expect(events).toEqual(["deposit_paid"]);
    expect(r.deposit_paid_at).toBe("2026-09-27T01:00:00.000Z");
    expect(depositGateCleared(r, 0)).toBe(true);
    const ev = evaluateXeroInvoice({ Status: "AUTHORISED", AmountPaid: 400, Payments: [{ Date: "/Date(1000)/", Amount: 300 }, { Date: "/Date(2000)/", Amount: 100 }] }, 333);
    expect(ev.depositPaidAt).toBe(new Date(2000).toISOString());
  });
  test("full payment marks fully paid", async () => {
    const r = await inv();
    const { events } = paymentPatch(r, 3330, null, "2026-09-28T00:00:00Z");
    expect(events).toEqual(["deposit_paid", "balance_paid"]);
  });
  test("deposit-request-raised flag alone never unlocks", async () => {
    const r = await inv();
    apply(r, depositRequestPatch(r, "admin1", "2026-09-28T00:00:00Z"));
    expect(r.deposit_request_raised_at).toBe("2026-09-28T00:00:00Z");
    expect(r.deposit_request_amount).toBe(349);
    expect(r.deposit_request_pct).toBe(10);
    expect(r.deposit_request_raised_by).toBe("admin1");
    expect(depositGateCleared(r, 0)).toBe(false);
    expect(() => depositRequestPatch(r, "admin1", "x")).toThrow("already");
  });
  test("audited override still clears gate and needs a reason", async () => {
    const r = await inv();
    expect(() => buildDepositOverride(r, "no", "admin1", "awaiting_deposit_payment")).toThrow("reason");
    const o = buildDepositOverride(r, "Paid by bank transfer, receipt seen", "admin1", "awaiting_deposit_payment");
    expect(o).toMatchObject({ gate: "deposit", overridden_by: "admin1", invoice_id: r.id });
    expect([o.before_state.deposit_gate, o.after_state.deposit_gate]).toEqual(["locked", "overridden"]);
    expect(depositGateCleared(r, 1)).toBe(true);
  });
  test("voided/deleted invoice never counts as paid", () => {
    for (const Status of ["VOIDED", "DELETED"]) expect(evaluateXeroInvoice({ Status, AmountPaid: 3330 }, 1665).paid).toBe(0);
  });
});

describe("installation date drives the same invoice's due date", () => {
  async function inv() { const m = memStore(); const r = (await ensureInvoice(m.store, quote(3330), "2026-09-28")).row; return { m, r }; }
  test("before booking, Xero due date = 30 days after acceptance and final due is pending (Jo 1 Nov 2026)", async () => {
    const { r } = await inv();
    expect(r.balance_due_date).toBeNull();
    expect(xeroDueDate(r)).toBe("2026-10-28");
    expect(xeroDueDate({ balance_due_date: null, deposit_due_date: "2026-12-15" })).toBe("2027-01-14");
    expect(xeroDueDate({ balance_due_date: null, deposit_due_date: null })).toBeNull();
  });
  test("booking sets the Melbourne-local install date on the same invoice", async () => {
    const { m, r } = await inv();
    apply(r, installDueDatePatch(r, melbourneDate("2026-10-14T23:30:00.000Z")));
    expect(r.balance_due_date).toBe("2026-10-15");
    expect(xeroDueDate(r)).toBe("2026-10-15");
    expect(m.rows.length).toBe(1);
  });
  test("rebooking updates the same invoice and flags an idempotent Xero update (disabled)", async () => {
    const { m, r } = await inv();
    r.xero_invoice_id = "XI";
    apply(r, installDueDatePatch(r, "2026-10-15"));
    r.xero_update_pending = false;
    apply(r, installDueDatePatch(r, "2026-10-22"));
    expect(r.balance_due_date).toBe("2026-10-22");
    expect(r.xero_update_pending).toBe(true);
    expect(m.rows.length).toBe(1);
    expect(installDueDatePatch(r, "2026-10-22")).toBeNull();
    expect(buildDueDateUpdate("XI", "2026-10-22", r.id)).toEqual(buildDueDateUpdate("XI", "2026-10-22", r.id));
    expect(buildDueDateUpdate("XI", "2026-10-22", r.id).body.Invoices[0]).toEqual({ InvoiceID: "XI", DueDate: "2026-10-22" });
    expect(XERO_DUE_DATE_UPDATES_ENABLED).toBe(true);
  });
  test("cancellation returns final due date to pending; fully paid is untouched", async () => {
    const { r } = await inv();
    apply(r, installDueDatePatch(r, "2026-10-15"));
    apply(r, clearInstallDueDatePatch(r));
    expect(r.balance_due_date).toBeNull();
    expect(r.xero_update_pending).toBe(false); // not in Xero yet: nothing to send
    expect(xeroDueDate(r)).toBe("2026-10-28");
    apply(r, installDueDatePatch(r, "2026-11-02"));
    r.total_paid = 3330;
    expect(installDueDatePatch(r, "2026-12-01")).toBeNull();
    expect(clearInstallDueDatePatch(r)).toBeNull();
  });
  test("cancelling the install on an invoice already in Xero sends it back to acceptance + 30 (Jo 1 Nov 2026)", async () => {
    const { r } = await inv();
    r.xero_invoice_id = "XI";
    apply(r, installDueDatePatch(r, "2026-10-15"));
    r.xero_update_pending = false;
    apply(r, clearInstallDueDatePatch(r));
    expect(r.balance_due_date).toBeNull();
    expect(r.xero_update_pending).toBe(true);
    expect(xeroDueDate(r)).toBe("2026-10-28");
  });
});

describe("full detailed invoice payload", () => {
  const items = [
    { description: "R4.0 ceiling batts", quantity: 118, unit_price_inc_gst: 28, line_total_inc_gst: 3304 },
    { description: "Electrical rectification: Downlight upgrade to IC-4 LED", quantity: 6, unit_price_inc_gst: 165, line_total_inc_gst: 990 },
    { description: "Electrical rectification: Install RCD", quantity: 1, unit_price_inc_gst: 216, line_total_inc_gst: 216 },
  ];
  const tracking = { categoryName: "Projects", optionName: "Home Insulation Victoria" };
  test("every line once + VEEC incentive negative, inclusive GST, totals exact, tracking and reference", () => {
    const inv = buildInvoicePayload({ contactId: "C", jobNumber: "HV-1007", dueDate: "2026-09-28", total: 3330, items, veecIncentive: 1180, tracking }).Invoices[0]!;
    expect(inv.Reference).toBe("Home Insulation Victoria HV-1007");
    expect(inv.LineAmountTypes).toBe("Inclusive");
    expect(inv.LineItems.length).toBe(4);
    expect(inv.LineItems.at(-1)).toMatchObject({ UnitAmount: -1180, Quantity: 1 });
    // Decision 391: GST on the full price, so only the incentive line is No GST; price lines keep Xero's default (GST).
    expect(inv.LineItems.at(-1)).toMatchObject({ TaxType: "BASEXCLUDED", AccountCode: "200" });
    for (const l of inv.LineItems.slice(0, -1)) expect("TaxType" in l).toBe(false);
    expect(inv.LineItems.at(-1)!.Description).toBe("Home Insulation Victoria HV-1007 – VEEC incentive"); // decision 209: never "discount"
    expect(inv.LineItems.reduce((s, l) => s + l.Quantity * l.UnitAmount, 0)).toBe(3330);
    for (const l of inv.LineItems) expect(l.Tracking).toEqual([{ Name: "Projects", Option: "Home Insulation Victoria" }]);
  });
  test("decision 209: first line carries the installation address; the locked reference is unchanged; totals still exact", () => {
    const inv = buildInvoicePayload({ contactId: "C", jobNumber: "HV-1007", dueDate: "2026-09-28", total: 3330, items, veecIncentive: 1180, tracking, installationAddress: "824 High Street Road, Glen Waverley VIC 3150" }).Invoices[0]!;
    expect(inv.Reference).toBe("Home Insulation Victoria HV-1007");
    expect(inv.LineItems[0]!.Description).toBe("Home Insulation Victoria HV-1007 – Installation address: 824 High Street Road, Glen Waverley VIC 3150 – R4.0 ceiling batts");
    expect(inv.LineItems[1]!.Description).toBe("Home Insulation Victoria HV-1007 – Electrical rectification: Downlight upgrade to IC-4 LED");
    expect(inv.LineItems.reduce((s, l) => s + Math.round(l.Quantity * l.UnitAmount * 100), 0)).toBe(333000);
    // Unknown address is never invented.
    const none = buildInvoicePayload({ contactId: "C", jobNumber: "HV-1007", dueDate: "2026-09-28", total: 3330, items, veecIncentive: 1180, tracking, installationAddress: "  " }).Invoices[0]!;
    expect(none.LineItems[0]!.Description).toBe("Home Insulation Victoria HV-1007 – R4.0 ceiling batts");
  });
  test("decision 209: itemised insulation line flows into the payload unchanged in amount", () => {
    const quoteItems = [{ code: "R5_BATTS", description: "Supply and install of Bradford Gold R5 ceiling insulation", quantity: 137.6, unit_price_inc_gst: 20, line_total_inc_gst: 2752 }, { code: "AP_FEE", description: "Accredited Provider fee (Home Insulation Victoria)", quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349 }];
    const it = itemiseInvoiceLines(quoteItems, { product: { option: "Bradford Gold R5", rValue: "R5.0" }, areaM2: 137.6 });
    expect(it.officeFlag).toBeNull();
    const inv = buildInvoicePayload({ contactId: "C", jobNumber: "HV-3117", dueDate: "2026-11-11", total: 1251, items: it.items, veecIncentive: 1850, tracking, installationAddress: "824 High Street Road, Glen Waverley VIC 3150" }).Invoices[0]!;
    expect(inv.LineItems.map((l) => l.Description)).toEqual([
      "Home Insulation Victoria HV-3117 – Installation address: 824 High Street Road, Glen Waverley VIC 3150 – Ceiling insulation — CSR Bradford Gold Ceiling Batt R5.0 — 137.6 m²",
      "Home Insulation Victoria HV-3117 – Accredited Person fee (Home Insulation Victoria)",
      "Home Insulation Victoria HV-3117 – VEEC incentive",
    ]);
    expect(inv.LineItems[0]).toMatchObject({ Quantity: 137.6, UnitAmount: 20 });
    expect(inv.LineItems.reduce((s, l) => s + Math.round(l.Quantity * l.UnitAmount * 100), 0)).toBe(125100);
  });
  test("lines that don't match the accepted total are refused", () => {
    expect(() => buildInvoicePayload({ contactId: "C", jobNumber: "HV-1007", dueDate: "d", total: 3331, items, veecIncentive: 1180, tracking })).toThrow("don't add up");
  });
  test("accepted-quote guard", () => {
    expect(quoteGuard({ status: "issued", customer_total_inc_gst: 100 }, 100)).toMatch("not accepted");
    expect(quoteGuard({ status: "accepted", customer_total_inc_gst: 100 }, 99.99)).toMatch("does not match");
  });
});

// ---------- fake Xero ----------
type Req = { path: string; method: string; headers?: Record<string, string>; body?: any };
function mockXero(state: { contacts?: any[]; invoices?: any[]; loseNextInvoiceResponse?: boolean }) {
  const reqs: Req[] = [];
  const contacts = state.contacts ?? [];
  const invoices = state.invoices ?? [];
  const idem = new Map<string, any>();
  const tracking = [{ Name: "Projects", Status: "ACTIVE", Options: [{ TrackingOptionID: "o2", Name: "Home Insulation Victoria", Status: "ACTIVE" }] }];
  const call: XeroCall = async (path, init = {}) => {
    const method = init.method ?? "GET";
    reqs.push({ path, method, headers: init.headers, body: init.body });
    const key = init.headers?.["Idempotency-Key"];
    if (key && idem.has(key)) return idem.get(key);
    if (path.startsWith("/api.xro/2.0/TrackingCategories")) return { TrackingCategories: tracking };
    if (path.startsWith("/api.xro/2.0/Contacts?")) {
      const m = /(EmailAddress|Name)=="(.*)"/.exec(decodeURIComponent(path))!;
      return { Contacts: contacts.filter((c) => c[m[1]!] === m[2]) };
    }
    if (path === "/api.xro/2.0/Contacts" && method === "POST") {
      const c = { ContactID: `C${contacts.length + 1}`, ...init.body.Contacts[0] }; contacts.push(c);
      const res = { Contacts: [c] }; if (key) idem.set(key, res); return res;
    }
    if (path.startsWith("/api.xro/2.0/Invoices?")) {
      const ref = /Reference=="(.*)"/.exec(decodeURIComponent(path))![1];
      return { Invoices: invoices.filter((i) => i.Reference === ref) };
    }
    if (path === "/api.xro/2.0/Invoices" && method === "POST") {
      const i = { InvoiceID: `I${invoices.length + 1}`, InvoiceNumber: `INV-${invoices.length + 1}`, Status: "AUTHORISED", ...init.body.Invoices[0] };
      invoices.push(i);
      const res = { Invoices: [i] }; if (key) idem.set(key, res);
      if (state.loseNextInvoiceResponse) { state.loseNextInvoiceResponse = false; throw new Error("Xero 504: timeout"); }
      return res;
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { call, reqs, invoices, contacts };
}
const owner = { id: "own1", full_name: "Daniel Rossi", email: "daniel@example.com" };
async function push(call: XeroCall, invoiceId: string, jobNumber: string) {
  const t = await findTrackingOption(call);
  let x = await findInvoiceByReference(call, xeroReference(jobNumber, "installation"));
  if (!x) {
    const { contactId } = await findOrCreateContact(call, owner);
    const payload = buildInvoicePayload({ contactId, jobNumber, dueDate: "2026-09-28", total: 2000, items: [{ description: "Batts", quantity: 100, unit_price_inc_gst: 25, line_total_inc_gst: 2500 }], veecIncentive: 500, tracking: t });
    x = (await call("/api.xro/2.0/Invoices", { method: "POST", headers: { "Idempotency-Key": invoiceIdemKey(invoiceId) }, body: payload })).Invoices[0];
  }
  return x;
}

describe("fake Xero: idempotency, contacts, references", () => {
  test("deterministic reference", () => expect(xeroReference("HV-1007", "installation")).toBe("Home Insulation Victoria HV-1007"));
  test("lost response + retry = exactly one Xero invoice", async () => {
    const m = mockXero({ loseNextInvoiceResponse: true });
    await expect(push(m.call, "inv1", "HV-1007")).rejects.toThrow("504");
    await push(m.call, "inv1", "HV-1007");
    await push(m.call, "inv1", "HV-1007");
    expect(m.invoices.length).toBe(1);
    expect(m.reqs.filter((r) => r.method === "POST" && r.path.endsWith("/Invoices")).length).toBe(1);
    expect(m.reqs.find((r) => r.method === "POST" && r.path.endsWith("/Invoices"))!.headers?.["Idempotency-Key"]).toBe("hivic-invoice-inv1");
  });
  test("existing owner contact reused, no contact POST", async () => {
    const m = mockXero({ contacts: [{ ContactID: "EXIST", Name: "Daniel Rossi", EmailAddress: "daniel@example.com" }] });
    const x = await push(m.call, "inv2", "HV-1002");
    expect(x.Contact.ContactID).toBe("EXIST");
    expect(m.reqs.some((r) => r.method === "POST" && r.path.endsWith("/Contacts"))).toBe(false);
  });
  test("voided invoice with same reference is not adopted", async () => {
    const m = mockXero({ invoices: [{ InvoiceID: "OLD", Reference: "Home Insulation Victoria HV-1004", Status: "VOIDED" }] });
    expect((await push(m.call, "inv4", "HV-1004")).InvoiceID).not.toBe("OLD");
  });
  test("sync lock held 2 minutes then stale", () => {
    expect(lockHeld(new Date(Date.now() - 30_000).toISOString())).toBe(true);
    expect(lockHeld(new Date(Date.now() - 180_000).toISOString())).toBe(false);
  });
});

describe("privacy and compliance", () => {
  test("owner-facing invoice columns exclude Xero IDs, errors, internal and deposit-request fields", () => {
    const forbidden = ["xero_invoice_id", "xero_contact_id", "xero_reference", "xero_invoice_status", "last_sync_error", "sync_lock_at", "xero_update_pending", "xero_tracking_option_id", "status", "deposit_request_raised_at", "deposit_request_raised_by"];
    for (const f of forbidden) expect(CUSTOMER_INVOICE_COLUMNS as readonly string[]).not.toContain(f);
  });
  test("expired PIESA still blocks installation; deadline on Melbourne date", () => {
    expect(installationDateBlocker({ piesa_expired: true, install_deadline: "2026-09-01" }, "2026-10-15T00:00:00Z")).toMatch("PIESA 30-day window expired");
    expect(installationDateBlocker({ piesa_expired: false, install_deadline: "2026-10-14" }, "2026-10-14T23:30:00Z")).toMatch("before the PIESA deadline");
    expect(installationDateBlocker({ piesa_expired: false, install_deadline: "2026-10-15" }, "2026-10-14T23:30:00Z")).toBeNull();
  });
});

// ---------- business-unit barrier ----------
import { assertHivicInvoice, assertHivicJob, assertHivicPayload, assertHivicReference, NOT_HIVIC_ERROR } from "../src/lib/xero.core";
describe("HI VIC business-unit barrier", () => {
  test("hivic job passes", () => expect(() => assertHivicJob({ business_unit: "hivic" })).not.toThrow());
  test("missing business_unit / missing job blocked", () => {
    for (const j of [null, undefined, {}, { business_unit: null }, { business_unit: "" }]) expect(() => assertHivicJob(j as any)).toThrow(NOT_HIVIC_ERROR);
  });
  test("any non-hivic unit blocked (incl. near-misses)", () => {
    for (const u of ["dc", "dc_construction", "HIVIC", "hivic ", "hi_vic"]) expect(() => assertHivicJob({ business_unit: u })).toThrow(NOT_HIVIC_ERROR);
  });
  test("both HI VIC channels pass", () => {
    for (const channel of ["hivic_sourced", "installer_sourced"]) expect(() => assertHivicJob({ business_unit: "hivic", channel } as any)).not.toThrow();
  });
  test("caller-supplied invoice ID is resolved to its job and blocked if not hivic", async () => {
    const jobs: Record<string, any> = { invHivic: { business_unit: "hivic" }, invDc: { business_unit: "dc" }, invOrphan: null };
    const load = async (id: string) => jobs[id] ?? null;
    await expect(assertHivicInvoice("invHivic", load)).resolves.toBeUndefined();
    await expect(assertHivicInvoice("invDc", load)).rejects.toThrow(NOT_HIVIC_ERROR);
    await expect(assertHivicInvoice("invOrphan", load)).rejects.toThrow(NOT_HIVIC_ERROR);
    await expect(assertHivicInvoice("unknown", load)).rejects.toThrow(NOT_HIVIC_ERROR);
  });
  const tr = [{ Name: "Projects", Option: "Home Insulation Victoria" }];
  test("payload guard: good HI VIC payload passes", () => {
    const p = buildInvoicePayload({ contactId: "C", jobNumber: "HV-1", dueDate: "d", total: 100, items: [{ description: "x", quantity: 1, unit_price_inc_gst: 100, line_total_inc_gst: 100 }], veecIncentive: 0, tracking: { categoryName: "Projects", optionName: "Home Insulation Victoria" } });
    expect(() => assertHivicPayload(p)).not.toThrow();
  });
  test("payload guard fails closed on wrong reference or tracking", () => {
    expect(() => assertHivicPayload({ Invoices: [{ Reference: "DC 123", LineItems: [{ Tracking: tr }] }] })).toThrow("Home Insulation Victoria");
    expect(() => assertHivicPayload({ Invoices: [{ Reference: undefined, LineItems: [{ Tracking: tr }] }] })).toThrow("Home Insulation Victoria");
    expect(() => assertHivicPayload({ Invoices: [{ Reference: "Home Insulation Victoria HV-1", LineItems: [{ Tracking: [{ Name: "Business Unit", Option: "Home Insulation Victoria" }] }] }] })).toThrow("Home Insulation Victoria");
    expect(() => assertHivicPayload({ Invoices: [{ Reference: "Home Insulation Victoria HV-1", LineItems: [{ Tracking: tr }, {}] }] })).toThrow("Home Insulation Victoria");
    expect(() => assertHivicPayload({ Invoices: [{ Reference: "Home Insulation Victoria HV-1", LineItems: [] }] })).toThrow();
  });
  test("reference lookups/updates only for HI VIC references; no broad search", async () => {
    expect(() => assertHivicReference("INV-0042")).toThrow();
    expect(() => assertHivicReference(null)).toThrow();
    const calls: string[] = [];
    const call: XeroCall = async (p) => { calls.push(p); return { Invoices: [] }; };
    await expect(findInvoiceByReference(call, "DC job 55")).rejects.toThrow();
    expect(calls.length).toBe(0);
    await findInvoiceByReference(call, "Home Insulation Victoria HV-1007");
    expect(decodeURIComponent(calls[0]!)).toContain('Reference=="Home Insulation Victoria HV-1007"');
  });
  test("tracking resolution fails closed when Home Insulation Victoria option is missing", async () => {
    const call: XeroCall = async () => ({ TrackingCategories: [{ Name: "Projects", Status: "ACTIVE", Options: [{ Name: "DC Constructions", Status: "ACTIVE" }] }] });
    await expect(findTrackingOption(call)).rejects.toThrow("not found");
  });
});

describe("Projects tracking fail-closed", () => {
  test("does not fall back to Business Unit when Projects is missing", async () => {
    const call: XeroCall = async () => ({ TrackingCategories: [{ Name: "Business Unit", Status: "ACTIVE", Options: [{ Name: "Home Insulation Victoria", Status: "ACTIVE" }] }] });
    await expect(findTrackingOption(call)).rejects.toThrow("Projects");
  });
  test("blocks when Projects option is archived", async () => {
    const call: XeroCall = async () => ({ TrackingCategories: [{ Name: "Projects", Status: "ACTIVE", Options: [{ Name: "Home Insulation Victoria", Status: "ARCHIVED" }] }] });
    await expect(findTrackingOption(call)).rejects.toThrow("Projects");
  });
  test("blocks when Projects category is archived", async () => {
    const call: XeroCall = async () => ({ TrackingCategories: [{ Name: "Projects", Status: "ARCHIVED", Options: [{ Name: "Home Insulation Victoria", Status: "ACTIVE" }] }] });
    await expect(findTrackingOption(call)).rejects.toThrow("Projects");
  });
});

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
    expect(r.row.deposit_amount).toBe(1665);
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
  test("odd-cent 50% threshold is currency-safe", () => {
    for (const t of [3000.01, 0.01, 1271.57, 999.99]) {
      const { deposit, balance } = splitTotal(t);
      expect(Math.round((deposit + balance) * 100)).toBe(Math.round(t * 100));
    }
  });
});

describe("deposit gate on the one invoice", () => {
  async function inv() { return (await ensureInvoice(memStore().store, quote(3330), "2026-09-28")).row; }
  test("partial payment below 50% does not unlock", async () => {
    const r = await inv();
    const { patch, events } = paymentPatch(r, 1664.99, null, "2026-09-28T00:00:00Z"); apply(r, patch);
    expect(events).toEqual([]);
    expect(depositGateCleared(r, 0)).toBe(false);
  });
  test("cumulative ≥ 50% unlocks, dated when Xero payments reached 50%", async () => {
    const r = await inv();
    const { patch, events } = paymentPatch(r, 1700, "2026-09-27T01:00:00.000Z", "2026-09-28T00:00:00Z"); apply(r, patch);
    expect(events).toEqual(["deposit_paid"]);
    expect(r.deposit_paid_at).toBe("2026-09-27T01:00:00.000Z");
    expect(depositGateCleared(r, 0)).toBe(true);
    const ev = evaluateXeroInvoice({ Status: "AUTHORISED", AmountPaid: 1700, Payments: [{ Date: "/Date(1000)/", Amount: 1000 }, { Date: "/Date(2000)/", Amount: 700 }] }, 1665);
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
    expect(r.deposit_request_amount).toBe(1665);
    expect(r.deposit_request_pct).toBe(50);
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
  test("before booking, Xero due date = acceptance date and final due is pending", async () => {
    const { r } = await inv();
    expect(r.balance_due_date).toBeNull();
    expect(xeroDueDate(r)).toBe("2026-09-28");
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
    expect(XERO_DUE_DATE_UPDATES_ENABLED).toBe(false);
  });
  test("cancellation returns final due date to pending; fully paid is untouched", async () => {
    const { r } = await inv();
    apply(r, installDueDatePatch(r, "2026-10-15"));
    apply(r, clearInstallDueDatePatch(r));
    expect(r.balance_due_date).toBeNull();
    apply(r, installDueDatePatch(r, "2026-11-02"));
    r.total_paid = 3330;
    expect(installDueDatePatch(r, "2026-12-01")).toBeNull();
    expect(clearInstallDueDatePatch(r)).toBeNull();
  });
});

describe("full detailed invoice payload", () => {
  const items = [
    { description: "R4.0 ceiling batts", quantity: 118, unit_price_inc_gst: 28, line_total_inc_gst: 3304 },
    { description: "Electrical rectification: Downlight upgrade to IC-4 LED", quantity: 6, unit_price_inc_gst: 165, line_total_inc_gst: 990 },
    { description: "Electrical rectification: Install RCD", quantity: 1, unit_price_inc_gst: 216, line_total_inc_gst: 216 },
  ];
  const tracking = { categoryName: "Projects", optionName: "Home Insulation Victoria" };
  test("every line once + VEEC discount negative, inclusive GST, totals exact, tracking and reference", () => {
    const inv = buildInvoicePayload({ contactId: "C", jobNumber: "HV-1007", dueDate: "2026-09-28", total: 3330, items, veecDiscount: 1180, tracking }).Invoices[0]!;
    expect(inv.Reference).toBe("HI VIC HV-1007");
    expect(inv.LineAmountTypes).toBe("Inclusive");
    expect(inv.LineItems.length).toBe(4);
    expect(inv.LineItems.at(-1)).toMatchObject({ UnitAmount: -1180, Quantity: 1 });
    expect(inv.LineItems.at(-1)!.Description).toContain("VEEC discount");
    expect(inv.LineItems.reduce((s, l) => s + l.Quantity * l.UnitAmount, 0)).toBe(3330);
    for (const l of inv.LineItems) expect(l.Tracking).toEqual([{ Name: "Projects", Option: "Home Insulation Victoria" }]);
  });
  test("lines that don't match the accepted total are refused", () => {
    expect(() => buildInvoicePayload({ contactId: "C", jobNumber: "HV-1007", dueDate: "d", total: 3331, items, veecDiscount: 1180, tracking })).toThrow("don't add up");
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
  let x = await findInvoiceByReference(call, xeroReference(jobNumber));
  if (!x) {
    const { contactId } = await findOrCreateContact(call, owner);
    const payload = buildInvoicePayload({ contactId, jobNumber, dueDate: "2026-09-28", total: 2000, items: [{ description: "Batts", quantity: 100, unit_price_inc_gst: 25, line_total_inc_gst: 2500 }], veecDiscount: 500, tracking: t });
    x = (await call("/api.xro/2.0/Invoices", { method: "POST", headers: { "Idempotency-Key": invoiceIdemKey(invoiceId) }, body: payload })).Invoices[0];
  }
  return x;
}

describe("fake Xero: idempotency, contacts, references", () => {
  test("deterministic reference", () => expect(xeroReference("HV-1007")).toBe("HI VIC HV-1007"));
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
    const m = mockXero({ invoices: [{ InvoiceID: "OLD", Reference: "HI VIC HV-1004", Status: "VOIDED" }] });
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

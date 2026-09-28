// Mocked tests only – no live Xero calls, no database. Run: bun test ./tests/
import { describe, expect, test } from "bun:test";
import {
  allocateLines, buildDueDateUpdate, buildInvoicePayload, evaluateXeroInvoice, findInvoiceByReference, findOrCreateContact, findTrackingOption,
  invoiceIdemKey, lockHeld, melbourneDate, quoteGuard, XERO_DUE_DATE_UPDATES_ENABLED, xeroReference, type Part, type XeroCall,
} from "../src/lib/xero.core";
import {
  buildDepositOverride, CUSTOMER_INVOICE_COLUMNS, depositGateCleared, ensureBalanceInvoice, ensureDepositInvoice, paymentPatch,
  splitTotal, unscheduleBalance, type InvoiceRow, type InvoiceStore,
} from "../src/lib/invoice.lifecycle";
import { installationDateBlocker } from "../src/lib/workflow";

// ---------- in-memory invoice store with the (quote_id, part) unique constraint ----------
function memStore() {
  const rows: InvoiceRow[] = [];
  let n = 0;
  const store: InvoiceStore = {
    async find(q, part) { return rows.find((r) => r.quote_id === q && r.part === part) ?? null; },
    async insert(row) {
      if (rows.some((r) => r.quote_id === row.quote_id && r.part === row.part)) throw Object.assign(new Error("dup"), { code: "23505" });
      const r = { ...row, id: `inv${++n}`, xero_invoice_id: null, xero_update_pending: false, paid_at: null, deposit_paid_at: null } as InvoiceRow;
      rows.push(r); return r;
    },
    async update(id, patch) { Object.assign(rows.find((r) => r.id === id)!, patch); },
  };
  return { store, rows };
}
const quote = (total: number | string, status = "accepted") => ({ id: "q1", job_id: "j1", kind: "installation", status, customer_total_inc_gst: total });

describe("deposit invoice", () => {
  test("acceptance creates exactly one deposit record", async () => {
    const m = memStore();
    const r = await ensureDepositInvoice(m.store, quote(3000), "2026-09-28");
    expect(r.created).toBe(true);
    expect(m.rows.length).toBe(1);
    expect(m.rows[0]!.part).toBe("deposit");
    expect(m.rows[0]!.amount_inc_gst).toBe(1500);
  });
  test("retrying acceptance does not duplicate the deposit (sequential and concurrent)", async () => {
    const m = memStore();
    await ensureDepositInvoice(m.store, quote(3000), "2026-09-28");
    const again = await ensureDepositInvoice(m.store, quote(3000), "2026-09-28");
    await Promise.all([ensureDepositInvoice(m.store, quote(3000), "2026-09-28"), ensureDepositInvoice(m.store, quote(3000), "2026-09-28")]);
    expect(again.created).toBe(false);
    expect(m.rows.filter((r) => r.part === "deposit").length).toBe(1);
  });
  test("non-accepted quote raises no invoice", async () => {
    await expect(ensureDepositInvoice(memStore().store, quote(3000, "issued"), "2026-09-28")).rejects.toThrow("not accepted");
  });
});

describe("deposit gate", () => {
  const dep = () => ({ id: "d", job_id: "j1", quote_id: "q1", kind: "installation", part: "deposit", status: "deposit_due", total_inc_gst: 3000, deposit_amount: 1500, balance_amount: 1500, amount_inc_gst: 1500, due_date: "2026-09-28", amount_paid: 0, paid_at: null, deposit_paid_at: null, xero_invoice_id: "X", xero_update_pending: false }) as InvoiceRow;
  test("partial deposit does not unlock", () => {
    const row = dep();
    const { patch, events } = paymentPatch(row, 1499.99, null, "2026-09-28T00:00:00Z");
    Object.assign(row, patch);
    expect(events).toEqual([]);
    expect(depositGateCleared(row, 0)).toBe(false);
  });
  test("full deposit unlocks, using Xero payment date", () => {
    const row = dep();
    const { patch, events } = paymentPatch(row, 1500, "2026-09-27T01:00:00.000Z", "2026-09-28T00:00:00Z");
    Object.assign(row, patch);
    expect(events).toEqual(["deposit_paid"]);
    expect(row.deposit_paid_at).toBe("2026-09-27T01:00:00.000Z");
    expect(depositGateCleared(row, 0)).toBe(true);
  });
  test("balance invoice never clears the deposit gate", () => {
    expect(depositGateCleared({ part: "balance", deposit_paid_at: "2026-01-01" }, 1)).toBe(false);
  });
  test("manual override clears gate, needs a reason and records before/after", () => {
    const row = dep();
    expect(() => buildDepositOverride(row, "no", "admin1", "awaiting_deposit_payment")).toThrow("reason");
    expect(() => buildDepositOverride({ ...row, part: "balance" }, "Paid by bank transfer", "admin1", "x")).toThrow("deposit gate");
    const o = buildDepositOverride(row, "Paid by bank transfer, receipt seen", "admin1", "awaiting_deposit_payment");
    expect(o).toMatchObject({ gate: "deposit", overridden_by: "admin1", invoice_id: "d" });
    expect(o.before_state.deposit_gate).toBe("locked");
    expect(o.after_state.deposit_gate).toBe("overridden");
    expect(depositGateCleared(row, 1)).toBe(true);
  });
});

describe("balance invoice", () => {
  async function setup() {
    const m = memStore();
    const d = (await ensureDepositInvoice(m.store, quote(3000.01), "2026-09-28")).row;
    return { m, d };
  }
  test("install booking creates exactly one balance record", async () => {
    const { m, d } = await setup();
    const r = await ensureBalanceInvoice(m.store, d, "2026-10-15");
    await ensureBalanceInvoice(m.store, d, "2026-10-15");
    expect(r.created).toBe(true);
    expect(m.rows.filter((x) => x.part === "balance").length).toBe(1);
    expect(r.row.due_date).toBe("2026-10-15");
  });
  test("rebooking moves due date without duplicate; flags Xero update if linked", async () => {
    const { m, d } = await setup();
    const b = (await ensureBalanceInvoice(m.store, d, "2026-10-15")).row;
    await m.store.update(b.id, { xero_invoice_id: "XB" });
    const r = await ensureBalanceInvoice(m.store, d, "2026-10-20");
    expect(r.dueChanged).toBe(true);
    expect(m.rows.filter((x) => x.part === "balance").length).toBe(1);
    expect(m.rows.find((x) => x.part === "balance")!.due_date).toBe("2026-10-20");
    expect(m.rows.find((x) => x.part === "balance")!.xero_update_pending).toBe(true);
  });
  test("cancellation keeps the record; rebooking reuses it", async () => {
    const { m, d } = await setup();
    const b = (await ensureBalanceInvoice(m.store, d, "2026-10-15")).row;
    await unscheduleBalance(m.store, d.quote_id);
    expect(m.rows.find((x) => x.id === b.id)!.due_date).toBeNull();
    const r = await ensureBalanceInvoice(m.store, d, "2026-11-02");
    expect(r.created).toBe(false);
    expect(r.row.id).toBe(b.id);
    expect(m.rows.filter((x) => x.part === "balance").length).toBe(1);
    expect(m.rows.find((x) => x.id === b.id)!.due_date).toBe("2026-11-02");
  });
  test("paid balance is not re-dated", async () => {
    const { m, d } = await setup();
    const b = (await ensureBalanceInvoice(m.store, d, "2026-10-15")).row;
    await m.store.update(b.id, { amount_paid: b.amount_inc_gst });
    const r = await ensureBalanceInvoice(m.store, d, "2026-12-01");
    expect(r.dueChanged).toBe(false);
    expect(m.rows.find((x) => x.id === b.id)!.due_date).toBe("2026-10-15");
  });
  test("Melbourne-local installation date", () => {
    expect(melbourneDate("2026-10-14T23:30:00.000Z")).toBe("2026-10-15");
  });
});

describe("amounts and GST", () => {
  test("odd-cent totals split exactly", () => {
    for (const t of [3000.01, 0.01, 1234.57, 999.99, 2500]) {
      const { deposit, balance } = splitTotal(t);
      expect(Math.round((deposit + balance) * 100)).toBe(Math.round(t * 100));
      expect(deposit).toBe(Math.round(t * 50) / 100);
    }
  });
  test("line allocation: both invoices sum exactly to the accepted inc-GST total", () => {
    const items = [{ description: "Batts", line_total_inc_gst: 1833.33 }, { description: "Removal", line_total_inc_gst: 700.01 }, { description: "RCD", line_total_inc_gst: 467.67 }];
    const total = 1833.33 + 700.01 + 467.67 - 1; // with VEEC discount 1.00
    const { deposit } = splitTotal(total);
    const common = { contactId: "C", jobNumber: "HV-1007", dueDate: "2026-10-15", total, depositAmount: deposit, items, veecDiscount: 1, tracking: { categoryName: "Projects", optionName: "Home Insulation Victoria" } };
    const sum = (p: Part) => buildInvoicePayload({ ...common, part: p }).Invoices[0]!.LineItems.reduce((s, l) => s + Math.round(l.UnitAmount * 100), 0);
    expect(sum("deposit")).toBe(Math.round(deposit * 100));
    expect(sum("deposit") + sum("balance")).toBe(Math.round(total * 100));
    const inv = buildInvoicePayload({ ...common, part: "deposit" }).Invoices[0]!;
    expect(inv.LineAmountTypes).toBe("Inclusive"); // amounts are inc GST – Xero must not add GST again
  });
  test("lines that don't match the accepted total are refused", () => {
    expect(() => allocateLines([{ description: "a", amount: 100 }], 101, 50.5)).toThrow("don't add up");
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
// Mirrors pushInvoiceToXero's Xero-side sequence.
async function push(call: XeroCall, invoiceId: string, jobNumber: string, part: Part) {
  const t = await findTrackingOption(call);
  let x = await findInvoiceByReference(call, xeroReference(jobNumber, part));
  if (!x) {
    const { contactId } = await findOrCreateContact(call, owner);
    const payload = buildInvoicePayload({ contactId, jobNumber, part, dueDate: "2026-10-15", total: 3000.01, depositAmount: 1500.01, items: [{ description: "Batts", line_total_inc_gst: 3000.01 }], veecDiscount: 0, tracking: t });
    x = (await call("/api.xro/2.0/Invoices", { method: "POST", headers: { "Idempotency-Key": invoiceIdemKey(invoiceId) }, body: payload })).Invoices[0];
  }
  return x;
}

describe("Xero references and idempotency (fake Xero)", () => {
  test("references are deterministic and separate", () => {
    expect(xeroReference("HV-1007", "deposit")).toBe("HI VIC HV-1007 DEPOSIT");
    expect(xeroReference("HV-1007", "balance")).toBe("HI VIC HV-1007 BALANCE");
  });
  for (const part of ["deposit", "balance"] as const) {
    test(`${part}: lost response + retry = one Xero invoice, tracking on every line`, async () => {
      const m = mockXero({ loseNextInvoiceResponse: true });
      await expect(push(m.call, `inv-${part}`, "HV-1007", part)).rejects.toThrow("504");
      const x = await push(m.call, `inv-${part}`, "HV-1007", part);
      expect(m.invoices.length).toBe(1);
      expect(x.Reference).toBe(`HI VIC HV-1007 ${part.toUpperCase()}`);
      for (const l of x.LineItems) expect(l.Tracking).toEqual([{ Name: "Projects", Option: "Home Insulation Victoria" }]);
      expect(x.LineItems.reduce((s: number, l: any) => s + l.UnitAmount, 0)).toBeCloseTo(part === "deposit" ? 1500.01 : 1500, 2);
    });
  }
  test("deposit and balance are separate Xero invoices sharing one contact", async () => {
    const m = mockXero({});
    await push(m.call, "d1", "HV-1007", "deposit");
    await push(m.call, "b1", "HV-1007", "balance");
    expect(m.invoices.length).toBe(2);
    expect(m.contacts.length).toBe(1);
    expect(new Set(m.invoices.map((i) => i.Reference)).size).toBe(2);
  });
  test("existing contact reused", async () => {
    const m = mockXero({ contacts: [{ ContactID: "EXIST", Name: "Daniel Rossi", EmailAddress: "daniel@example.com" }] });
    const x = await push(m.call, "d2", "HV-1002", "deposit");
    expect(x.Contact.ContactID).toBe("EXIST");
    expect(m.reqs.some((r) => r.method === "POST" && r.path.endsWith("/Contacts"))).toBe(false);
  });
  test("due-date update is prepared, idempotent, and disabled", () => {
    expect(XERO_DUE_DATE_UPDATES_ENABLED).toBe(false);
    expect(buildDueDateUpdate("XB", "2026-10-20", "b1")).toEqual(buildDueDateUpdate("XB", "2026-10-20", "b1"));
    expect(buildDueDateUpdate("XB", "2026-10-20", "b1").body.Invoices[0]).toEqual({ InvoiceID: "XB", DueDate: "2026-10-20" });
  });
  test("voided invoices never count as paid; lock times out", () => {
    expect(evaluateXeroInvoice({ Status: "VOIDED", AmountPaid: 1500 }, 1500).paid).toBe(0);
    expect(lockHeld(new Date(Date.now() - 30_000).toISOString())).toBe(true);
    expect(lockHeld(new Date(Date.now() - 180_000).toISOString())).toBe(false);
  });
});

describe("visibility and compliance", () => {
  test("customer invoice columns exclude Xero IDs, errors and internal fields", () => {
    const forbidden = ["xero_invoice_id", "xero_contact_id", "xero_reference", "xero_invoice_status", "last_sync_error", "sync_lock_at", "xero_update_pending", "xero_tracking_option_id", "status"];
    for (const f of forbidden) expect(CUSTOMER_INVOICE_COLUMNS as readonly string[]).not.toContain(f);
  });
  test("expired PIESA still blocks installation booking; deadline enforced on Melbourne date", () => {
    expect(installationDateBlocker({ piesa_expired: true, install_deadline: "2026-09-01" }, "2026-10-15T00:00:00Z")).toMatch("PIESA 30-day window expired");
    expect(installationDateBlocker({ piesa_expired: false, install_deadline: "2026-10-14" }, "2026-10-14T23:30:00Z")).toMatch("before the PIESA deadline");
    expect(installationDateBlocker({ piesa_expired: false, install_deadline: "2026-10-15" }, "2026-10-14T23:30:00Z")).toBeNull();
  });
});

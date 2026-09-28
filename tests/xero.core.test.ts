// Mocked Xero tests – no live Xero calls. Run: bun test tests/
import { describe, expect, test } from "bun:test";
import {
  buildInvoicePayload, evaluateXeroInvoice, findInvoiceByReference, findOrCreateContact, findTrackingOption,
  invoiceIdemKey, lockHeld, melbourneDate, quoteGuard, xeroReference, type XeroCall,
} from "../src/lib/xero.core";

type Req = { path: string; method: string; headers?: Record<string, string>; body?: any };
function mockXero(state: { contacts?: any[]; invoices?: any[]; tracking?: any[]; loseNextInvoiceResponse?: boolean }) {
  const reqs: Req[] = [];
  const contacts = state.contacts ?? [];
  const invoices = state.invoices ?? [];
  const idem = new Map<string, any>();
  const call: XeroCall = async (path, init = {}) => {
    const method = init.method ?? "GET";
    reqs.push({ path, method, headers: init.headers, body: init.body });
    const key = init.headers?.["Idempotency-Key"];
    if (key && idem.has(key)) return idem.get(key);
    if (path.startsWith("/api.xro/2.0/TrackingCategories")) return { TrackingCategories: state.tracking ?? [] };
    if (path.startsWith("/api.xro/2.0/Contacts") && method === "GET") {
      const w = decodeURIComponent(path.split("where=")[1] ?? "");
      const m = /(EmailAddress|Name)=="(.*)"/.exec(w)!;
      return { Contacts: contacts.filter((c) => c[m[1]!] === m[2]) };
    }
    if (path === "/api.xro/2.0/Contacts" && method === "POST") {
      const c = { ContactID: `C${contacts.length + 1}`, ...init.body.Contacts[0] };
      contacts.push(c);
      const res = { Contacts: [c] }; if (key) idem.set(key, res); return res;
    }
    if (path.startsWith("/api.xro/2.0/Invoices?") ) {
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

const tracking = [{ Name: "Projects", Status: "ACTIVE", TrackingCategoryID: "tc", Options: [{ TrackingOptionID: "o1", Name: "DC Constructions", Status: "ACTIVE" }, { TrackingOptionID: "o2", Name: "Home Insulation Victoria", Status: "ACTIVE" }] }];

// Mirrors pushInvoiceToXero's Xero-side sequence (the DB parts are exercised by the regression checks).
async function push(call: XeroCall, invoiceId: string, jobNumber: string, owner: any) {
  const t = await findTrackingOption(call);
  let x = await findInvoiceByReference(call, xeroReference(jobNumber));
  if (!x) {
    const { contactId } = await findOrCreateContact(call, owner);
    const payload = buildInvoicePayload({ contactId, jobNumber, dueDate: "2026-09-28", items: [{ description: "R6.0 batts", quantity: 100, unit_price_inc_gst: 30 }], veecDiscount: 500, tracking: t });
    x = (await call("/api.xro/2.0/Invoices", { method: "POST", headers: { "Idempotency-Key": invoiceIdemKey(invoiceId) }, body: payload })).Invoices[0];
  }
  return x;
}
const owner = { id: "own1", full_name: "Daniel Rossi", email: "daniel@example.com" };

describe("duplicate protection", () => {
  test("lost response then retry adopts existing invoice – one POST total", async () => {
    const m = mockXero({ tracking, loseNextInvoiceResponse: true });
    await expect(push(m.call, "inv1", "HV-1007", owner)).rejects.toThrow("504");
    const x = await push(m.call, "inv1", "HV-1007", owner);
    expect(m.invoices.length).toBe(1);
    expect(x.InvoiceID).toBe("I1");
    expect(m.reqs.filter((r) => r.method === "POST" && r.path === "/api.xro/2.0/Invoices").length).toBe(1);
  });
  test("idempotency key is stable and present", async () => {
    const m = mockXero({ tracking });
    await push(m.call, "inv9", "HV-1009", owner);
    const post = m.reqs.find((r) => r.method === "POST" && r.path.endsWith("/Invoices"))!;
    expect(post.headers?.["Idempotency-Key"]).toBe("hivic-invoice-inv9");
  });
  test("existing contact reused by email – no contact POST", async () => {
    const m = mockXero({ tracking, contacts: [{ ContactID: "EXIST", Name: "Daniel Rossi", EmailAddress: "daniel@example.com", ContactStatus: "ACTIVE" }] });
    const x = await push(m.call, "inv2", "HV-1002", owner);
    expect(x.Contact.ContactID).toBe("EXIST");
    expect(m.reqs.some((r) => r.method === "POST" && r.path.endsWith("/Contacts"))).toBe(false);
  });
  test("new contact named after owner, not job", async () => {
    const m = mockXero({ tracking });
    await push(m.call, "inv3", "HV-1003", owner);
    expect(m.contacts[0].Name).toBe("Daniel Rossi");
  });
  test("voided invoice with same reference is not adopted", async () => {
    const m = mockXero({ tracking, invoices: [{ InvoiceID: "OLD", Reference: "HI VIC HV-1004", Status: "VOIDED" }] });
    const x = await push(m.call, "inv4", "HV-1004", owner);
    expect(x.InvoiceID).not.toBe("OLD");
  });
  test("sync lock held for 2 minutes, then stale", () => {
    const now = Date.now();
    expect(lockHeld(new Date(now - 30_000).toISOString(), now)).toBe(true);
    expect(lockHeld(new Date(now - 180_000).toISOString(), now)).toBe(false);
    expect(lockHeld(null, now)).toBe(false);
  });
});

describe("payload", () => {
  test("HI VIC reference, tracking on every line, inclusive GST", async () => {
    const m = mockXero({ tracking });
    await push(m.call, "inv5", "HV-1005", owner);
    const b = m.reqs.find((r) => r.method === "POST" && r.path.endsWith("/Invoices"))!.body.Invoices[0];
    expect(b.Reference).toBe("HI VIC HV-1005");
    expect(b.LineAmountTypes).toBe("Inclusive");
    for (const l of b.LineItems) {
      expect(l.Description.startsWith("HI VIC HV-1005 – ")).toBe(true);
      expect(l.Tracking).toEqual([{ Name: "Projects", Option: "Home Insulation Victoria" }]);
    }
    expect(b.LineItems.reduce((s: number, l: any) => s + l.Quantity * l.UnitAmount, 0)).toBe(2500);
  });
  test("missing tracking option fails without creating it", async () => {
    const m = mockXero({ tracking: [{ Name: "Projects", Status: "ACTIVE", Options: [] }] });
    await expect(push(m.call, "inv6", "HV-1006", owner)).rejects.toThrow("not found");
    expect(m.reqs.every((r) => r.method === "GET")).toBe(true);
  });
});

describe("accepted-quote guard", () => {
  test("rejects non-accepted and mismatched totals", () => {
    expect(quoteGuard({ status: "issued", customer_total_inc_gst: 100 }, 100)).toMatch("not accepted");
    expect(quoteGuard({ status: "accepted", customer_total_inc_gst: 100 }, 99.99)).toMatch("does not match");
    expect(quoteGuard({ status: "accepted", customer_total_inc_gst: "2500.00" }, 2500)).toBeNull();
  });
});

describe("payment state", () => {
  test("deposit thresholds and Xero payment date", () => {
    const d = "/Date(1790000000000+0000)/";
    expect(evaluateXeroInvoice({ Status: "AUTHORISED", AmountPaid: 100, Payments: [{ Date: d, Amount: 100 }] }, 1250).depositPaidAt).toBeNull();
    const eq = evaluateXeroInvoice({ Status: "AUTHORISED", AmountPaid: 1250, Payments: [{ Date: d, Amount: 1250 }] }, 1250);
    expect(eq.depositPaidAt).toBe(new Date(1790000000000).toISOString());
    expect(evaluateXeroInvoice({ Status: "PAID", AmountPaid: 2500, Payments: [{ Date: d, Amount: 2500 }] }, 1250).paid).toBe(2500);
  });
  test("voided/deleted never clears deposit", () => {
    for (const Status of ["VOIDED", "DELETED"]) {
      const r = evaluateXeroInvoice({ Status, AmountPaid: 2500 }, 1250);
      expect(r.voided).toBe(true); expect(r.paid).toBe(0); expect(r.depositPaidAt).toBeNull();
    }
  });
});

describe("balance due date", () => {
  test("Melbourne local date, not UTC slice", () => {
    expect(melbourneDate("2026-10-14T23:30:00.000Z")).toBe("2026-10-15");
    expect(melbourneDate("2026-10-15T02:00:00.000Z")).toBe("2026-10-15");
  });
});

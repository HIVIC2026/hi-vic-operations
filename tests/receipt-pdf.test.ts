import { describe, expect, test } from "bun:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { paymentPlan } from "../src/lib/payments.core";
import { buildReceiptInput, receiptModel, type ReceiptInput } from "../src/lib/receipt-pdf.core";
import { receiptPdf } from "../src/lib/receipt-pdf.server";

const text = async (b: Uint8Array) => { const d = await getDocument({ data: b.slice() }).promise; const out: string[] = []; for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ")); return out; };
const BASE = { jobNumber: "HV-1234", ownerName: "Sarah Brown", firstName: "Sarah", address: "12 Example St, Box Hill VIC 3128", yourPriceCents: 218800 };
const PIESA = { label: "Electrical safety check (PIESA)", paidOn: "8 Nov", cents: 34900 };
const DEP = { label: "50% deposit", paidOn: "10 Nov", cents: 91950 };
const SAFETY: ReceiptInput = { ...BASE, step: "safety_check", method: "card", paidOn: "Sat 8 Nov 2026", amountCents: 34900, earlier: [] };
const DEPOSIT: ReceiptInput = { ...BASE, step: "install_deposit", method: "card", paidOn: "Mon 10 Nov 2026", amountCents: 91950, earlier: [PIESA] };
const FINAL: ReceiptInput = { ...BASE, step: "balance", method: "bank", paidOn: "Thu 13 Nov 2026", amountCents: 91950, earlier: [PIESA, DEP] };

describe("receipt maths and wording", () => {
  test("deposit = 50% of the price after the $349 (existing paymentPlan maths)", () => {
    const p = paymentPlan({ quoteTotalCents: 218800, safetyCheckCents: 34900 });
    expect(p.installDepositCents).toBe(91950);
    expect(p.balanceCents).toBe(91950);
  });
  test("deposit receipt running list", () => {
    const m = receiptModel({ step: "install_deposit", firstName: "Sarah", method: "card", amountCents: 91950, yourPriceCents: 218800, earlier: [{ label: "Electrical safety check (PIESA)", paidOn: "8 Nov", cents: 34900 }], paidOn: "Mon 10 Nov 2026" } as never);
    expect(m.heading).toBe("We've received your deposit.");
    expect(m.rows).toEqual([{ label: "Your price (incl. GST)", amount: "$2,188.00" }, { label: "Electrical safety check (PIESA), paid 8 Nov", amount: "– $349.00" }, { label: "50% deposit, paid today", amount: "– $919.50" }]);
    expect(m.stillToPay).toBe("$919.50 on install day");
    expect(m.paidLine).toBe("50% deposit to book your install day");
  });
  test("final receipt ends Paid in full", () => {
    expect(receiptModel(FINAL).stillToPay).toBe("$0.00 · Paid in full ✓");
    expect(receiptModel(FINAL).heading).toBe("We've received your final payment.");
    expect(receiptModel(FINAL).paidLine).toBe("The rest of your price, due on install day");
    expect(receiptModel(FINAL).rows.map((r) => r.amount)).toEqual(["$2,188.00", "– $349.00", "– $919.50", "– $919.50"]);
    expect(receiptModel(FINAL).rows[3]!.label).toBe("Final payment, paid today");
  });
  test("$349 receipt shows GST, and uses the job's own safety-check amount", () => {
    expect(receiptModel(SAFETY).gstLine).toBe("Includes GST $31.73");
    expect(receiptModel(SAFETY).heading).toBe("We've received your payment.");
    expect(receiptModel(DEPOSIT).gstLine).toBeNull();
    const rec = receiptModel({ ...SAFETY, amountCents: 40000 });
    expect(rec.gstLine).toBe("Includes GST $36.36");
    expect(rec.rows[1]!.amount).toBe("– $400.00");
  });
  test("each PDF is one page, with the approved wording and no 'lawyer'", async () => {
    for (const i of [SAFETY, DEPOSIT, FINAL]) {
      const bytes = await receiptPdf(i);
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
      const t = (await text(bytes)).join(" ");
      expect(t).toContain("Thanks, Sarah");
      expect(t).toContain("DC Construction Solutions Pty Ltd");
      expect(t).toContain("Page 1 of 1");
      expect(t).not.toMatch(/lawyer/i);
      expect(Buffer.from(bytes).toString("latin1")).not.toMatch(/lawyer/i);
    }
    const t = (await text(await receiptPdf(DEPOSIT))).join(" ");
    expect(t).toContain("$919.50");
    expect(t).toContain("$919.50 on install day");
    expect(t).not.toContain("218.80");
    expect((await text(await receiptPdf(FINAL))).join(" ")).toContain("Paid in full");
  });
  test("missing facts stop the PDF", async () => {
    await expect(receiptPdf({ ...DEPOSIT, ownerName: " " })).rejects.toThrow(/owner name/);
  });
});

describe("buildReceiptInput: held, never a guess", () => {
  const plan = paymentPlan({ quoteTotalCents: 218800, safetyCheckCents: 34900 });
  const pay = (cents: number, paidAt: string, source: "card" | "xero" = "card") => ({ amountCents: cents, paidAt, source });
  const ledger = [pay(34900, "2026-11-08T01:00:00Z"), pay(91950, "2026-11-10T01:00:00Z")];
  const ok = { jobNumber: "HV-1234", ownerName: "Sarah Brown", address: "12 Example St, Box Hill VIC 3128", plan, ledger };
  test("builds the deposit input with earlier payments from the ledger", () => {
    const r = buildReceiptInput({ ...ok, step: "install_deposit", payment: ledger[1]! });
    expect(r).toMatchObject({ firstName: "Sarah", paidOn: "Tue 10 Nov 2026", method: "card", amountCents: 91950, yourPriceCents: 218800, earlier: [{ label: "Electrical safety check (PIESA)", paidOn: "8 Nov", cents: 34900 }] });
  });
  test("bank payments say bank", () => {
    expect(buildReceiptInput({ ...ok, step: "safety_check", payment: pay(34900, "2026-11-08T01:00:00Z", "xero") })).toMatchObject({ method: "bank" });
  });
  test("each missing fact is held with its reason", () => {
    const base = { ...ok, step: "install_deposit" as const, payment: ledger[1]! };
    expect(buildReceiptInput({ ...base, ownerName: "" })).toEqual({ held: "Receipt not made: the owner's name is missing" });
    expect(buildReceiptInput({ ...base, address: " " })).toEqual({ held: "Receipt not made: the property address is missing" });
    expect(buildReceiptInput({ ...base, jobNumber: null })).toEqual({ held: "Receipt not made: the job number is missing" });
    expect(buildReceiptInput({ ...base, plan: paymentPlan({ quoteTotalCents: 0 }) })).toEqual({ held: "Receipt not made: the price is missing" });
    expect(buildReceiptInput({ ...base, payment: null })).toEqual({ held: "Receipt not made: that payment is not on record" });
    expect(buildReceiptInput({ ...base, ledger: [ledger[1]!] })).toEqual({ held: "Receipt not made: the date of the earlier safety check payment is not on record" });
    expect(buildReceiptInput({ ...base, payment: pay(10000, "2026-11-10T01:00:00Z") })).toEqual({ held: "Receipt not made: the payment of $100.00 is not the $919.50 due for this step" });
  });
});

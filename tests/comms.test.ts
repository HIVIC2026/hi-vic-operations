import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";

// Walk the static + dynamic import graph of a module inside src/lib.
function graph(entry: string, seen = new Set<string>()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  // Type-only references (import type / import("x").Type) carry no runtime call; strip them.
  const src = readFileSync(entry, "utf8").replace(/^import type [^;]+;/gm, "").replace(/import\(["'][^"']+["']\)\.[A-Z]\w*/g, "");
  for (const m of src.matchAll(/(?:from|import\()\s*["'](\.\/[^"']+|@\/lib\/[^"']+)["']/g)) {
    const spec = m[1]!.startsWith("@/") ? resolve("src", m[1]!.slice(2)) : resolve(dirname(entry), m[1]!);
    const file = [".ts", ".tsx"].map((e) => spec + e).find(existsSync);
    if (file) graph(file, seen);
  }
  return seen;
}

describe("pre-launch communications lock", () => {
  const files = [...graph(resolve("src/lib/autoadvance.server.ts"))];
  const code = files.map((f) => readFileSync(f, "utf8")).join("\n");
  test("autoAdvanceJob graph has no email/SMS/notification delivery", () => {
    expect(code).not.toMatch(/resend|sendgrid|twilio|nodemailer|sendEmail|sendSms|send_transactional|\/functions\/v1\/send/i);
  });
  test("autoAdvanceJob graph has no Xero or Mitti external calls", () => {
    expect(files.filter((f) => /xero\.server|mitti\.server/.test(f))).toEqual([]);
    expect(code).not.toMatch(/connector-gateway\.lovable\.dev|api\.mitti\.com|createInvoiceForQuote|syncInvoiceFromXero/);
  });
  test("open-job sweep never creates Xero invoices", () => {
    const s = readFileSync("src/lib/autoadvance.server.ts", "utf8");
    expect(s).not.toMatch(/createInvoice|syncInvoice|xero\.server/);
  });
  test("visit cancellation clears the local due-date flag without importing the Xero date module", () => {
    const visits = readFileSync("src/lib/visit-events.server.ts", "utf8");
    const local = readFileSync("src/lib/install-balance.server.ts", "utf8");
    expect(visits).toContain('import("./install-balance.server")');
    expect(visits).not.toContain("invoice-dates.server");
    expect(local).not.toMatch(/xero\.server|connector-gateway|api\.xero/i);
  });
  test("email/SMS messages and authority requests check the lock", () => {
    const pf = readFileSync("src/lib/portal.functions.ts", "utf8");
    const send = pf.slice(pf.indexOf("export const sendMessage"), pf.indexOf("export const requestReassignment"));
    expect(send).toContain("assertCustomerCommsEnabled");
    const auth = pf.slice(pf.indexOf("export const requestOwnerAuthority"), pf.indexOf("export const revokeOwnerAuthority"));
    expect(auth).toContain("Owner Authority has been retired"); // retired: cannot send anything
    const c = readFileSync("src/lib/comms.server.ts", "utf8");
    const allowed = c.slice(c.indexOf("export async function assertCustomerDeliveryAllowed"));
    expect(allowed.indexOf("assertCustomerCommsEnabled")).toBeLessThan(allowed.indexOf("assertOwnerContactConsent"));
  });
  test("lock fails closed by default", () => {
    const c = readFileSync("src/lib/comms.server.ts", "utf8");
    expect(c).toMatch(/if \(error \|\| !data\) return false/);
    expect(readFileSync("drizzle/migrations/0018_customer_comms_lock.sql", "utf8")).toMatch(/DEFAULT false/);
  });
});

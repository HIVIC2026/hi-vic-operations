// Proves docs/pending-migrations/0223_payment_gate_both_routes.sql on PGlite before any live run (AGENTS.md).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { evaluatePaymentGate } from "../src/lib/payment-gate.core";

const db = new PGlite();
await db.exec(`
CREATE TABLE workflow_settings (id int primary key, payment_option_gate_enabled boolean, safety_check_payment_inc_gst numeric);
CREATE TABLE jobs (id uuid primary key, channel text);
CREATE TABLE invoices (id uuid primary key, job_id uuid, total_inc_gst numeric, total_paid numeric);
CREATE TABLE payment_overrides (id uuid primary key default gen_random_uuid(), invoice_id uuid, gate text);
CREATE FUNCTION can_access_job(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
INSERT INTO workflow_settings VALUES (1, true, 349);`);
await db.exec(readFileSync("docs/pending-migrations/0223_payment_gate_both_routes.sql", "utf8"));

let n = 0;
async function cleared(channel: string, total: number, paid: number, override = false) {
  n++;
  const job = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, inv = `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  await db.query("insert into jobs values ($1,$2)", [job, channel]);
  await db.query("insert into invoices values ($1,$2,$3,$4)", [inv, job, total, paid]);
  if (override) await db.query("insert into payment_overrides (invoice_id, gate) values ($1,'deposit')", [inv]);
  return (await db.query<{ c: boolean }>("select invoice_deposit_cleared($1) c", [inv])).rows[0]!.c;
}
const ts = (route: "hiv_lead" | "installer_supplied" | "unknown", total: number, paid: number) =>
  evaluatePaymentGate({ enabled: true, route, currentQuote: { id: "q", customer_total_inc_gst: total }, invoice: { quote_id: "q", total_inc_gst: total, total_paid: paid }, plan: null, overrideCount: 0, safetyFeeIncGst: 349 }).cleared;

describe("0223 payment gate mirror — both routes, $349 safety check", () => {
  test("SQL and TS agree for every route and amount", async () => {
    const cases: [string, "hiv_lead" | "installer_supplied" | "unknown", number, number][] = [
      ["hivic_sourced", "hiv_lead", 4000, 349], ["hivic_sourced", "hiv_lead", 4000, 348.99], ["hivic_sourced", "hiv_lead", 4000, 4000],
      ["installer_sourced", "installer_supplied", 4000, 349], ["installer_sourced", "installer_supplied", 4000, 0], ["installer_sourced", "installer_supplied", 300, 300],
      ["partner_sourced", "unknown", 4000, 4000],
    ];
    for (const [ch, route, total, paid] of cases) expect([ch, total, paid, await cleared(ch, total, paid)]).toEqual([ch, total, paid, ts(route, total, paid)]);
  });
  test("old 10% deposit no longer counts; an audited override still clears", async () => {
    expect(await cleared("hivic_sourced", 10000, 1000)).toBe(true); // ≥ $349
    expect(await cleared("installer_sourced", 10000, 200)).toBe(false);
    expect(await cleared("installer_sourced", 10000, 0, true)).toBe(true);
  });
  test("switch off blocks everything", async () => {
    await db.exec("update workflow_settings set payment_option_gate_enabled = false");
    expect(await cleared("installer_sourced", 4000, 4000)).toBe(false);
    await db.exec("update workflow_settings set payment_option_gate_enabled = true");
  });
  test("rollback restores the captured live definitions", () => {
    const rb = readFileSync("docs/pending-migrations/0223_payment_gate_both_routes.rollback.sql", "utf8");
    expect(rb).toContain("j.channel = 'hivic_sourced'");
    expect(rb).toContain("CASE WHEN _total >= 20000 THEN 5 ELSE 10 END");
  });
});

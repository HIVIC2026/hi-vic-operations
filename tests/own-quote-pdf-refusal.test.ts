// Review fix round IMPORTANT 3b (Jo 14:50, binding): "View quote (PDF)" is refused SERVER-SIDE on a Home Insulation
// Victoria lead, even when the installer who holds that lead (boss, prices and Money on) calls it directly. Nothing about
// the quote is read or rendered.
import { expect, mock, test } from "bun:test";
import { memoryPostgrest } from "./helpers/memory-postgrest";
const t: Record<string, Record<string, unknown>[]> = {
  jobs: [
    { id: "lead", job_number: "HV-9001", channel: "hivic_sourced", originating_installer_business_id: null, owner_id: "o1", property_id: "p1" },
    { id: "own", job_number: "HV-9002", channel: "installer_sourced", originating_installer_business_id: "nogap", owner_id: "o1", property_id: "p1" },
  ],
  owners: [{ id: "o1", full_name: "Helen Yang" }], properties: [{ id: "p1", address_line: "1 Main St", suburb: "Richmond", postcode: "3121" }],
  quotes: [{ id: "q1", job_id: "lead", kind: "installation", status: "issued", customer_total_inc_gst: 1898, veec_discount_inc_gst: 1200, created_at: "2026-11-06T01:00:00Z" }],
  quote_items: [{ quote_id: "q1", code: "INSTALLER_PRICE", description: "x", line_total_inc_gst: 2400, sort: 1 }],
};
const reads: string[] = [];
const db = memoryPostgrest(t);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (table: string) => { reads.push(table); return db.from(table); } } }));
const access: string[] = [];
mock.module("../src/lib/trade-view.server", () => ({
  // The installer holds the lead: the trade-job check passes for them.
  requireTradeJob: async (userId: string, jobId: string) => { access.push(`${userId}:${jobId}`); return { biz: { id: "nogap", name: "No Gap" }, prices: true, money: true, boss: true }; },
  businessLogoUrl: async () => null,
}));
const rendered: unknown[] = [];
mock.module("../src/lib/pdf-look.server", () => ({ renderPdf: async (x: unknown) => { rendered.push(x); return { bytes: new Uint8Array([1]), layout: {} }; } }));
const { ownQuotePdfFor } = await import("../src/lib/own-photo-quote.server");

test("an HIV lead is refused for the installer who holds it; the quote is never read or rendered", async () => {
  await expect(ownQuotePdfFor("lead", "boss")).rejects.toThrow("The quote isn't available here.");
  expect(access).toEqual(["boss:lead"]);
  expect(reads).not.toContain("quotes");
  expect(rendered).toEqual([]);
});

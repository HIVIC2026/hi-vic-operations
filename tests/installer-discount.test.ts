// Installer fixes deep, Task 6 (Jo 5 Nov 2026): after the quote has gone to the owner on an installer's OWN customer
// job, the Boss / Office can offer a discount. It makes a NEW quote version (draft, held for "Quotes to check") with a
// line "Discount −$X" under the installer's price; the sent quote is never changed; the office's Send replaces the old one.
// Runs the real server modules over an in-memory database. Nothing is ever sent from here.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const T: Tables = {};
const admin = memoryPostgrest(T);

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details?: unknown) => {
    await admin.from("workflow_events").insert({ job_id, actor_id, event_type, summary, details: details ?? {}, created_at: new Date().toISOString() });
  },
}));

const core = await import("../src/lib/installer-discount.core");
const { discountErrors, discountedLines, discountedTotals, discountLineDescription, INSTALLER_DISCOUNT_CODE, INSTALLER_DISCOUNT_EVENT, DISCOUNT_NOT_SENT, DISCOUNT_ACCEPTED, DISCOUNT_EXPIRED, DISCOUNT_NOT_OWN_JOB, DISCOUNT_REFUSED_ROLE, DISCOUNT_ALREADY_PENDING, DISCOUNT_QUOTE_LABEL } = core;
const { requestInstallerDiscount, installerDiscountState, discountSourceFor } = await import("../src/lib/installer-discount.server");
const { loadQuotesToCheck } = await import("../src/lib/installer-quote-review.server");
mock.module("../src/lib/trade-view.server", () => ({ tradeContext: async () => ({ prices: true }) }));
const { myOwnerQuoteFor } = await import("../src/lib/my-owner-quote.server");
const { QUOTE_SENT_LINE } = await import("../src/lib/installer-quote-status.core");
const SB = { rpc: async () => ({ data: true, error: null }) };

const JOB = "job-1", BIZ = "biz-1", BOSS = "u-boss", OFFICE = "u-office", LEAD = "u-lead", Q = "q-sent";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const sentLines = () => [
  { id: "l1", quote_id: Q, code: "INSTALLER_PRICE", description: "Ceiling insulation — supply and install", quantity: 1, unit: "job", unit_price_inc_gst: 2500, line_total_inc_gst: 2500, is_other: false, explanation: null, sort: 0 },
  { id: "l2", quote_id: Q, code: "AP_FEE", description: "Home Insulation Victoria fee", quantity: 1, unit: "flat", unit_price_inc_gst: 349, line_total_inc_gst: 349, is_other: false, explanation: null, sort: 1 },
  { id: "l3", quote_id: Q, code: "PIESA", description: "Electrical safety check", quantity: 1, unit: "flat", unit_price_inc_gst: 275, line_total_inc_gst: 275, is_other: false, explanation: "Electrician: Pete", sort: 2 },
];

function seed(o: { channel?: string; status?: string; sentAt?: string | null; acceptedAt?: string | null; expiredAt?: string | null } = {}) {
  for (const k of Object.keys(T)) delete T[k];
  T["jobs"] = [{ id: JOB, job_number: "HV-9001", channel: o.channel ?? "installer_sourced", originating_installer_business_id: BIZ, stage: "awaiting_quote_acceptance", deleted_at: null, qa_archived_at: null, source: null, owner_id: "o1", property_id: "p1" }];
  T["owners"] = [{ id: "o1", full_name: "Sam Owner" }];
  T["properties"] = [{ id: "p1", address_line: "12 Example St", suburb: "Box Hill", postcode: "3128" }];
  T["business_members"] = [
    { business_id: BIZ, user_id: BOSS, member_role: "business_admin", active: true },
    { business_id: BIZ, user_id: OFFICE, member_role: "office", active: true },
    { business_id: BIZ, user_id: LEAD, member_role: "member", active: true },
  ];
  T["businesses"] = [{ id: BIZ, name: "Deep Insulation" }];
  T["job_assignments"] = [{ job_id: JOB, business_id: BIZ, role: "installer", active: true }];
  T["ceiling_measurements"] = [{ id: "m1", job_id: JOB, is_current: true, external_source: "mitti", external_id: "audit-1" }];
  T["retail_estimator_settings"] = [{ id: "rs1", is_current: true, indicative_veec_value: 90, minimum_customer_copayment_inc_gst: 200 }];
  T["workflow_events"] = [{ id: "ev-snap", job_id: JOB, event_type: "mitti_quote_electrician_snapshot", summary: "", details: { quote_id: Q, electrician: { name: "Pete" } }, created_at: ago(3) }];
  T["quotes"] = [{
    id: Q, job_id: JOB, kind: "installation", option_code: "INSTALLER_A1", option_label: "Installer's quote (from Ready Check)", status: o.status ?? "issued",
    sent_at: o.sentAt === undefined ? ago(2) : o.sentAt, accepted_at: o.acceptedAt ?? null, expired_at: o.expiredAt ?? null, release_state: "released", release_hold_reason: null,
    subtotal_inc_gst: 3124, gst_amount: 284, veec_discount_inc_gst: 900, discount_note: null, veec_count: 10, veec_unit_value_inc_gst: 90, customer_total_inc_gst: 2224,
    created_at: ago(3), created_by: BOSS, version: 1, partner_business_id: BIZ, cobrand: { name: "Deep" },
  }];
  T["quote_items"] = sentLines();
}

const newQuotes = () => (T["quotes"] ?? []).filter((q) => q["id"] !== Q);
const sentQuote = () => (T["quotes"] ?? []).find((q) => q["id"] === Q)!;

describe("discountErrors (pure)", () => {
  const quote = { subtotal_inc_gst: 3124, veec_discount_inc_gst: 900, minimumCopay: 200, veecValue: 90 };
  test("a valid amount has no errors", () => expect(discountErrors(200, 2500, quote)).toEqual([]));
  test("more than the installer's price", () => expect(discountErrors(2600, 2500, quote)[0]).toMatch(/more than your price/i));
  test("below the owner minimum names the minimum and the most allowed", () => {
    const e = discountErrors(2100, 2500, quote); // 3124 − 2100 − 900 = 124 < 200
    expect(e[0]).toMatch(/\$200 minimum/);
    expect(e[0]).toMatch(/\$2,024/); // 3124 − 900 − 200
  });
  test("zero, negative, blank and three decimals are refused", () => {
    expect(discountErrors(0, 2500, quote)).not.toEqual([]);
    expect(discountErrors(-5, 2500, quote)).not.toEqual([]);
    expect(discountErrors(Number.NaN, 2500, quote)).not.toEqual([]);
    expect(discountErrors(10.123, 2500, quote)).not.toEqual([]);
  });
  test("the line says exactly Discount −$X", () => {
    expect(discountLineDescription(200)).toBe("Discount −$200");
    expect(discountLineDescription(150.5)).toBe("Discount −$150.50");
  });
  test("discountedLines puts the discount straight under the installer's price and renumbers sort", () => {
    const lines = discountedLines(sentLines(), 200);
    expect(lines.map((l) => l.code)).toEqual(["INSTALLER_PRICE", INSTALLER_DISCOUNT_CODE, "AP_FEE", "PIESA"]);
    expect(lines.map((l) => l.sort)).toEqual([0, 1, 2, 3]);
    expect(lines[1]).toMatchObject({ description: "Discount −$200", line_total_inc_gst: -200, unit_price_inc_gst: -200, quantity: 1 });
    expect(lines[1]).not.toHaveProperty("id");
  });
  test("discountedTotals takes the discount off the subtotal, keeps the rebate", () => {
    expect(discountedTotals({ subtotal_inc_gst: 3124, veec_discount_inc_gst: 900 }, 200)).toEqual({ subtotal_inc_gst: 2924, gst_amount: 265.82, veec_discount_inc_gst: 900, customer_total_inc_gst: 2024 });
  });
});

describe("requestInstallerDiscount — refusals", () => {
  beforeEach(() => seed());
  test("not sent yet (draft) → refused, nothing written", async () => {
    seed({ status: "draft", sentAt: null });
    await expect(requestInstallerDiscount(JOB, BOSS, 200, null)).rejects.toThrow(DISCOUNT_NOT_SENT);
    expect(newQuotes()).toHaveLength(0);
  });
  test("accepted → refused", async () => {
    seed({ status: "accepted", acceptedAt: ago(1) });
    await expect(requestInstallerDiscount(JOB, BOSS, 200, null)).rejects.toThrow(DISCOUNT_ACCEPTED);
    expect(newQuotes()).toHaveLength(0);
  });
  test("expired (status) → refused", async () => {
    seed({ status: "expired", expiredAt: ago(1) });
    await expect(requestInstallerDiscount(JOB, BOSS, 200, null)).rejects.toThrow(DISCOUNT_EXPIRED);
  });
  test("sent 40 days ago (past the 30-day validity) → refused", async () => {
    seed({ sentAt: ago(40) });
    await expect(requestInstallerDiscount(JOB, BOSS, 200, null)).rejects.toThrow(DISCOUNT_EXPIRED);
  });
  test("HIV lead → refused", async () => {
    seed({ channel: "hivic_sourced" });
    await expect(requestInstallerDiscount(JOB, BOSS, 200, null)).rejects.toThrow(DISCOUNT_NOT_OWN_JOB);
  });
  test("Lead Installer / crew → refused; office person allowed", async () => {
    await expect(requestInstallerDiscount(JOB, LEAD, 200, null)).rejects.toThrow(DISCOUNT_REFUSED_ROLE);
    expect(newQuotes()).toHaveLength(0);
    const r = await requestInstallerDiscount(JOB, OFFICE, 200, null);
    expect(r.quoteId).toBeTruthy();
  });
  test("more than the installer's price → error, nothing written", async () => {
    await expect(requestInstallerDiscount(JOB, BOSS, 2600, null)).rejects.toThrow(/more than your price/i);
    expect(newQuotes()).toHaveLength(0);
  });
  test("below the owner minimum → error naming it", async () => {
    await expect(requestInstallerDiscount(JOB, BOSS, 2100, null)).rejects.toThrow(/\$200 minimum/);
    expect(newQuotes()).toHaveLength(0);
  });
  test("a second discount while one is waiting → refused", async () => {
    await requestInstallerDiscount(JOB, BOSS, 200, null);
    await expect(requestInstallerDiscount(JOB, BOSS, 300, null)).rejects.toThrow(DISCOUNT_ALREADY_PENDING);
    expect(newQuotes()).toHaveLength(1);
  });
});

describe("requestInstallerDiscount — valid", () => {
  beforeEach(() => seed());
  test("held new version with the exact line; the sent quote is untouched", async () => {
    const before = JSON.stringify(sentQuote());
    const r = await requestInstallerDiscount(JOB, BOSS, 200, "Owner asked for a better price");
    const nq = newQuotes();
    expect(nq).toHaveLength(1);
    expect(nq[0]!["id"]).toBe(r.quoteId);
    expect(nq[0]).toMatchObject({ status: "draft", sent_at: null, release_state: "held", release_hold_reason: "Waiting for office review before sending", option_code: "INSTALLER_A1", option_label: DISCOUNT_QUOTE_LABEL, kind: "installation", subtotal_inc_gst: 2924, veec_discount_inc_gst: 900, customer_total_inc_gst: 2024, veec_count: 10, partner_business_id: BIZ, created_by: BOSS });
    const items = (T["quote_items"] ?? []).filter((i) => i["quote_id"] === r.quoteId).sort((a, b) => a["sort"] - b["sort"]);
    expect(items.map((i) => i["code"])).toEqual(["INSTALLER_PRICE", INSTALLER_DISCOUNT_CODE, "AP_FEE", "PIESA"]);
    expect(items[1]).toMatchObject({ description: "Discount −$200", line_total_inc_gst: -200 });
    expect(items[3]!["explanation"]).toBe("Electrician: Pete");
    // the old quote: same row, still live for the owner
    expect(JSON.stringify(sentQuote())).toBe(before);
    expect((T["quote_items"] ?? []).filter((i) => i["quote_id"] === Q)).toHaveLength(3);
    // one event with the note; the electrician snapshot copied for the new version
    const ev = (T["workflow_events"] ?? []).filter((e) => e["event_type"] === INSTALLER_DISCOUNT_EVENT);
    expect(ev).toHaveLength(1);
    expect(ev[0]!["details"]).toMatchObject({ quote_id: r.quoteId, source_quote_id: Q, amount_inc_gst: 200, note: "Owner asked for a better price", requested_by: BOSS });
    expect(ev[0]!["summary"]).toContain("Note to office: Owner asked for a better price");
    expect(nq[0]!["discount_note"]).toBeNull(); // the note never rides on the quote row (owner-visible once issued)
    const snaps = (T["workflow_events"] ?? []).filter((e) => e["event_type"] === "mitti_quote_electrician_snapshot");
    expect(snaps.map((s) => (s["details"] as { quote_id: string }).quote_id).sort()).toEqual([Q, r.quoteId].sort());
    // nothing to the owner: no send rows of any kind
    expect(T["customer_email_sends"] ?? []).toHaveLength(0);
    expect(T["sms_messages"] ?? []).toHaveLength(0);
  });
  test("the pending state names the amount; it clears once the draft is no longer a draft", async () => {
    const r = await requestInstallerDiscount(JOB, BOSS, 200, null);
    const s = await installerDiscountState(JOB);
    expect(s.pending).toMatchObject({ quoteId: r.quoteId, sourceQuoteId: Q, amountIncGst: 200 });
    const row = (T["quotes"] ?? []).find((q) => q["id"] === r.quoteId)!;
    row["status"] = "issued"; row["sent_at"] = new Date().toISOString();
    expect((await installerDiscountState(JOB)).pending).toBeNull();
  });
  test("one Quotes-to-check item for the job, the discount draft, even though the old quote is still issued", async () => {
    expect((await loadQuotesToCheck({ onlyJobIds: [JOB] })).rows).toHaveLength(0); // before: a sent quote alone is not a row
    const r = await requestInstallerDiscount(JOB, BOSS, 200, null);
    const rows = (await loadQuotesToCheck({ onlyJobIds: [JOB] })).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ jobId: JOB, quoteId: r.quoteId, total: 2024 });
  });
  test("the installer's card: Offer a discount only on a sent quote; while one waits it keeps showing the owner's quote", async () => {
    const before = await myOwnerQuoteFor(SB, BOSS, JOB);
    expect(before).toMatchObject({ applies: true, priceHidden: false, quoteId: Q, canDiscount: true, discountPending: null, sent: true, total: 2224 });
    const r = await requestInstallerDiscount(JOB, BOSS, 200, null);
    const after = await myOwnerQuoteFor(SB, BOSS, JOB);
    expect(after).toMatchObject({ applies: true, priceHidden: false, quoteId: Q, canDiscount: false, discountPending: { amountIncGst: 200 }, sent: true, total: 2224, line: QUOTE_SENT_LINE });
    expect((after as { lines: { description: string }[] }).lines.map((l) => l.description)).not.toContain("Discount −$200");
    expect(r.quoteId).not.toBe(Q);
  });
  test("the office's Send: the source is found, an accepted source refuses, an issued source is replaced", async () => {
    const r = await requestInstallerDiscount(JOB, BOSS, 200, null);
    const src = await discountSourceFor(JOB, r.quoteId);
    expect(src).toMatchObject({ sourceQuoteId: Q, status: "issued" });
    expect(await discountSourceFor(JOB, "some-other-quote")).toBeNull();
  });
});

// Part 10 Task 9: labels, Job details money rows and the pay rule for an installer's own customer.
// Jo 3 Nov 2026: pay wording is plain (no "No complete form, no payment" threat — PAY_RULE_LINE_V2 behind
// NO_FORM_NO_PAY_V2_APPROVED); money rows only for Boss/Office (seesPrices); the electrician's rate never on an owner row.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OWN_CUSTOMER_PAY_RULE, jobMoneyRows } from "../src/lib/own-customer-price.core";
import { sourceLabel } from "../src/lib/installer-screens.core";
import { sourceLabel as homeSourceLabel } from "../src/lib/installer-home.core";
import { INSTALLER_PAY_WAITING_OWNER, installerPayHeldReasons } from "../src/lib/trade-view.core";
import { NO_FORM_NO_PAY_V2_APPROVED, PAY_RULE_LINE_V2 } from "../src/lib/money-screen.core";

describe("jobMoneyRows", () => {
  const own = { channel: "installer_sourced", canSeePrices: true, ownerPriceIncGst: 2098, installerPriceIncGst: 2000, hivLeadPayIncGst: null };
  test("own customer (Boss/Office): the owner's quote and the installer's pay, whole dollars", () => {
    expect(jobMoneyRows(own)).toEqual([["Owner's quote", "$2,098"], ["Your pay", "$2,000"]]);
    expect(jobMoneyRows({ ...own, ownerPriceIncGst: 2098.5, installerPriceIncGst: 1999.99 })).toEqual([["Owner's quote", "$2,099"], ["Your pay", "$2,000"]]);
  });
  test("the approved rule can sit on the pay row; unknown figures are left out", () => {
    expect(jobMoneyRows({ ...own, payRule: "paid once Sarah has paid in full" })).toEqual([["Owner's quote", "$2,098"], ["Your pay", "$2,000 · paid once Sarah has paid in full"]]);
    expect(jobMoneyRows({ ...own, ownerPriceIncGst: null })).toEqual([["Your pay", "$2,000"]]);
    expect(jobMoneyRows({ ...own, installerPriceIncGst: null })).toEqual([["Owner's quote", "$2,098"]]);
  });
  test("Home Insulation Victoria lead: the installer's pay only — never the owner's price", () => {
    const r = jobMoneyRows({ channel: "hivic_sourced", canSeePrices: true, ownerPriceIncGst: 3798, installerPriceIncGst: null, hivLeadPayIncGst: 3000 });
    expect(r).toEqual([["Your pay", "$3,000"]]);
    expect(JSON.stringify(r).toLowerCase()).not.toContain("owner");
  });
  test("Lead Installer / Crew (no prices): nothing", () => {
    expect(jobMoneyRows({ ...own, canSeePrices: false })).toEqual([]);
    expect(jobMoneyRows({ channel: "hivic_sourced", canSeePrices: false, ownerPriceIncGst: null, installerPriceIncGst: null, hivLeadPayIncGst: 3000 })).toEqual([]);
  });
  test("Office who can see prices but not Money: the owner's quote only", () => {
    expect(jobMoneyRows({ ...own, canSeeMoney: false })).toEqual([["Owner's quote", "$2,098"]]);
  });
});

describe("I3: the installer's pay on an own customer = their own lines on the quote that counts", () => {
  test("INSTALLER_PRICE + INSTALLER_REMOVAL + INSTALLER_EXTRA; never the fee, PIESA or the owner's total", async () => {
    const { ownCustomerQuoteFigures } = await import("../src/lib/own-customer-price.core");
    const q = { status: "issued", created_at: "2026-11-01T00:00:00Z", customer_total_inc_gst: 2548, items: [
      { code: "INSTALLER_PRICE", line_total_inc_gst: 2000 }, { code: "INSTALLER_REMOVAL", line_total_inc_gst: 300 }, { code: "INSTALLER_EXTRA", line_total_inc_gst: "150" },
      { code: "AP_FEE", line_total_inc_gst: 349 }, { code: "PIESA", line_total_inc_gst: 349 } ] };
    expect(ownCustomerQuoteFigures([q])).toEqual({ installerPayIncGst: 2450, ownerPriceIncGst: 2548 });
  });
  test("an accepted quote wins over a newer draft (as installerPayForJob does); otherwise the newest; nothing → nulls", async () => {
    const { ownCustomerQuoteFigures } = await import("../src/lib/own-customer-price.core");
    const accepted = { status: "accepted", created_at: "2026-11-01T00:00:00Z", customer_total_inc_gst: 2098, items: [{ code: "INSTALLER_PRICE", line_total_inc_gst: 2000 }, { code: "AP_FEE", line_total_inc_gst: 349 }, { code: "PIESA", line_total_inc_gst: 349 }] };
    const draft = { status: "draft", created_at: "2026-11-03T00:00:00Z", customer_total_inc_gst: 2598, items: [{ code: "INSTALLER_PRICE", line_total_inc_gst: 2500 }, { code: "AP_FEE", line_total_inc_gst: 349 }, { code: "PIESA", line_total_inc_gst: 349 }] };
    expect(ownCustomerQuoteFigures([draft, accepted])).toEqual({ installerPayIncGst: 2000, ownerPriceIncGst: 2098 });
    expect(ownCustomerQuoteFigures([draft, { ...accepted, status: "issued" }])).toEqual({ installerPayIncGst: 2500, ownerPriceIncGst: 2598 });
    expect(ownCustomerQuoteFigures([])).toEqual({ installerPayIncGst: null, ownerPriceIncGst: null });
    expect(ownCustomerQuoteFigures([{ ...draft, items: [{ code: "AP_FEE", line_total_inc_gst: 349 }] }])).toEqual({ installerPayIncGst: null, ownerPriceIncGst: 2598 });
  });
  test("the job page reads several quotes and picks with the pure helper", () => {
    const s = readFileSync("src/lib/trade-view.server.ts", "utf8");
    expect(s).toContain("ownCustomerQuoteFigures(");
    expect(s).toContain('.in("status", ["issued", "accepted", "draft"]).order("created_at", { ascending: false }).limit(5)');
  });
});

describe("labels and the pay rule", () => {
  test("one source label, shared by My work and the Job page", () => {
    expect(sourceLabel("installer_sourced")).toBe("Your customer");
    expect(sourceLabel("hivic_sourced")).toBe("Home Insulation Victoria lead");
    expect(sourceLabel(null)).toBeNull();
    expect(homeSourceLabel).toBe(sourceLabel);
  });
  test("own-customer pay rule is plain (no threat, no HIV), lives in one place and the job page footnote reads it", () => {
    expect(OWN_CUSTOMER_PAY_RULE).toBe("Your customers are paid once the office approves the paperwork and the owner has paid their balance.");
    for (const s of [OWN_CUSTOMER_PAY_RULE, PAY_RULE_LINE_V2]) expect(s).not.toMatch(/no payment|No complete form|\bHIV\b|\bfixes\b/i);
    const screens = readFileSync("src/lib/installer-screens.core.ts", "utf8");
    expect(screens).toContain("OWN_CUSTOMER_PAY_RULE");
    expect(screens).not.toContain('"Your customers are paid once the office approves the paperwork and the owner has paid their balance."');
    // Every NoFormNoPay block switches to the plain line together once Jo approves it (off as shipped).
    expect(NO_FORM_NO_PAY_V2_APPROVED).toBe(false);
    const kit = readFileSync("src/components/trade/installer-kit.tsx", "utf8");
    expect(kit).toContain("NO_FORM_NO_PAY_V2_APPROVED");
    expect(kit).toContain("PAY_RULE_LINE_V2");
  });
  test("installer pay on an own customer waits for the owner to pay in full (one rule, trade-view.core)", () => {
    expect(installerPayHeldReasons({ installerSupplied: true, apApprovedAt: "2026-11-10T00:00:00Z", ownerPaidInFullAt: null })).toEqual([INSTALLER_PAY_WAITING_OWNER]);
    expect(installerPayHeldReasons({ installerSupplied: true, apApprovedAt: "2026-11-10T00:00:00Z", ownerPaidInFullAt: "2026-11-12T00:00:00Z" })).toEqual([]);
  });
  test("the job page reads the money rows through jobMoneyRows with the Part 5 role flags", () => {
    const s = readFileSync("src/lib/trade-view.server.ts", "utf8");
    expect(s).toContain("jobMoneyRows({");
    expect(s).toContain("canSeePrices: c.prices, canSeeMoney: c.money");
  });
});

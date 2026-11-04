import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AP_CERTIFICATES_LINE, businessContactFromRow, contactLine } from "@/lib/owner-wording.core";

test("contact line", () => {
  expect(contactLine({ name: "Rapid Insulation Pty Ltd", tradingName: "Rapid Insulation", officePhone: "03 9000 0000", email: "office@rapidinsulation.com.au" })).toBe("Rapid Insulation · 03 9000 0000 · office@rapidinsulation.com.au");
  expect(contactLine({ name: "X", tradingName: null, officePhone: null, email: "a@b.au" })).toBeNull();
  expect(AP_CERTIFICATES_LINE).toBe("Rebate certificates created by Home Insulation Victoria (Accredited Person A003654).");
});

test("contact line trims, falls back to name, and treats blanks as missing", () => {
  expect(contactLine({ name: " Acme Pty Ltd ", tradingName: "  ", officePhone: " 03 1 ", email: " a@b.au " })).toBe("Acme Pty Ltd · 03 1 · a@b.au");
  expect(contactLine({ name: "X", tradingName: null, officePhone: "   ", email: "a@b.au" })).toBeNull();
  expect(contactLine({ name: "X", tradingName: null, officePhone: "03 1", email: "" })).toBeNull();
});

test("row to contact maps only business office fields", () => {
  expect(businessContactFromRow({ name: "N", trading_name: "T", phone: "03 9", email: "e@x.au" })).toEqual({ name: "N", tradingName: "T", officePhone: "03 9", email: "e@x.au" });
  expect(businessContactFromRow({ name: "N", trading_name: null, phone: " ", email: null })).toEqual({ name: "N", tradingName: null, officePhone: null, email: null });
  expect(businessContactFromRow(null)).toBeNull();
  expect(businessContactFromRow(undefined)).toBeNull();
});

test("server reader never touches people", () => {
  const src = readFileSync("src/lib/owner-contact.server.ts", "utf8");
  expect(src).toMatch(/from\("businesses"\)/);
  expect(src).not.toMatch(/from\("(profiles|partner_workers|business_workers)"\)/);
});

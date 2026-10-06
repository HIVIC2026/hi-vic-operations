import { expect, test } from "bun:test";
import { cleanLead, gridToRecords, normaliseAuPhone } from "../src/lib/bulk-import.core";
test("phones", () => {
  expect(normaliseAuPhone("0412 345 678").phone).toBe("0412 345 678");
  expect(normaliseAuPhone("+61412345678").phone).toBe("0412 345 678");
  expect(normaliseAuPhone("412345678").phone).toBe("0412 345 678");
  expect(normaliseAuPhone("0398765432").phone).toBe("03 9876 5432");
  expect(normaliseAuPhone("12345").ok).toBe(false);
});
test("header lower down, blank rows, extra columns", () => {
  const r = gridToRecords([["Job list"], [], ["Customer", "Mobile", "Address", ""], ["A B", "0412345678", "3/7 Elm Ct", "x"], ["", "", "", ""]]);
  expect(r).toEqual([{ Customer: "A B", Mobile: "0412345678", Address: "3/7 Elm Ct", "Column 4": "x" }]);
});
test("flags bad email/postcode/size", () => {
  const { issues } = cleanLead({ full_name: "X", email: "x@y", phone: "0412345678", postcode: "2000", area_m2: 2500 });
  expect(issues.length).toBe(3);
});

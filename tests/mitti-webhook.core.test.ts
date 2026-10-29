import { expect, test } from "bun:test";
import { mittiNoticeTokenOk, mittiNoticeAuditId, mittiNoticeBodyKeys } from "@/lib/mitti-webhook.core";

test("token: missing env → false", () => expect(mittiNoticeTokenOk("abc", undefined)).toBe(false));
test("token: empty env → false", () => expect(mittiNoticeTokenOk("", "")).toBe(false));
test("token: mismatch → false", () => expect(mittiNoticeTokenOk("abc", "xyz")).toBe(false));
test("token: match → true", () => expect(mittiNoticeTokenOk("xyz", "xyz")).toBe(true));
test("audit id at top level", () => expect(mittiNoticeAuditId(JSON.stringify({ audit_id: "audit_1" }))).toBe("audit_1"));
test("audit id under data", () => expect(mittiNoticeAuditId(JSON.stringify({ data: { audit_id: "audit_2" } }))).toBe("audit_2"));
test("audit id under event.data", () => expect(mittiNoticeAuditId(JSON.stringify({ event: { data: { audit_id: "audit_3" } } }))).toBe("audit_3"));
test("not JSON → null", () => expect(mittiNoticeAuditId("<xml/>")).toBeNull());
test("no id → null", () => expect(mittiNoticeAuditId("{}")).toBeNull());
test("non-string id → null", () => expect(mittiNoticeAuditId(JSON.stringify({ audit_id: 7 }))).toBeNull());

// Shape-only description of a notice with no audit id: top-level key names, never values.
test("body keys: top-level JSON key names only", () =>
  expect(mittiNoticeBodyKeys(JSON.stringify({ event: "x", payload: { audit_id: "secret-audit", owner: "Helen" }, email: "a@b.c" }))).toEqual(["event", "payload", "email"]));
test("body keys: not JSON → 'not json'", () => expect(mittiNoticeBodyKeys("<xml/>")).toBe("not json"));
test("body keys: JSON array or scalar → no keys", () => {
  expect(mittiNoticeBodyKeys("[1,2]")).toEqual([]);
  expect(mittiNoticeBodyKeys('"hello"')).toEqual([]);
  expect(mittiNoticeBodyKeys("null")).toEqual([]);
});

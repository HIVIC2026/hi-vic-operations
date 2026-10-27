import { describe, expect, test } from "bun:test";
import { qaEmailGuard, qaEmailRoute } from "../src/lib/qa-email-routing.core";

describe("Jo's TEST inbox routing", () => {
  for (const original of ["owner@hivic-test.example", "installer@hivic-test.example", "office@hivic-test.example"]) {
    test(`qa_test email redirects ${original}`, () => {
      const r = qaEmailRoute("qa_test", original, "<html><body><p>Original</p></body></html>", "Original");
      expect(r.to).toBe("jolowexo@hotmail.com");
      expect(r.text).toBe(`TEST — would have gone to: ${original}\n\nOriginal`);
      expect(r.html.indexOf("TEST — would have gone to:")).toBeLessThan(r.html.indexOf("<p>Original"));
    });
  }
  for (const source of ["base44", "installer_import", null]) test(`real source ${source} is unchanged`, () => {
    expect(qaEmailRoute(source, "real@example.com", "<p>unchanged</p>", "unchanged")).toEqual({ to: "real@example.com", html: "<p>unchanged</p>", text: "unchanged", redirected: false });
  });
  test("master switch blocks TEST email even with approval", () => expect(qaEmailGuard(false, true)).toBe("customer_comms_enabled is OFF — TEST email held"));
  test("unapproved or unknown email stays held", () => {
    expect(qaEmailGuard(true, false)).toBe("Per-email approval is OFF or not verified — TEST email held");
    expect(qaEmailGuard(true, undefined)).toBe("Per-email approval is OFF or not verified — TEST email held");
    expect(qaEmailGuard(true, true)).toBeNull();
  });
});
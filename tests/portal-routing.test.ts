import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { afterPasswordPath, portalDestination, setPasswordLink } from "../src/lib/set-password-link.core";

describe("portal sign-in routing", () => {
  test("each role lands on its own dashboard", () => {
    expect(portalDestination({ roles: ["admin"], hasBusiness: false })).toBe("/admin/needs-me");
    expect(portalDestination({ roles: ["admin", "electrician"], hasBusiness: true })).toBe("choose");
    expect(portalDestination({ roles: ["installer"], hasBusiness: true })).toBe("/field");
    expect(portalDestination({ roles: ["electrician"], hasBusiness: true })).toBe("/field");
    expect(portalDestination({ roles: [], hasBusiness: true })).toBe("/field");
    expect(portalDestination({ roles: [], hasBusiness: false })).toBe("no-access");
  });
  test("after a password is set, never the calculator", () => {
    for (const n of [null, "", "/", "/calculator", "https://evil.example", "/field/welcome", "/partner", "/portal"]) {
      expect(["/field/welcome", "/portal"]).toContain(afterPasswordPath(n));
    }
  });
  test("links always open our own /reset-password page", () => {
    const l = new URL(setPasswordLink("abc", "/portal", "https://estimate.homeinsulationvictoria.com.au", "invite"));
    expect(l.pathname).toBe("/reset-password");
    expect(l.searchParams.get("type")).toBe("invite");
    expect(l.searchParams.get("next")).toBe("/portal");
  });
  test("staff link no longer uses the auth service redirect", () => {
    expect(readFileSync("src/lib/trade-access.functions.ts", "utf8")).not.toContain("link = g.properties?.action_link");
  });
});

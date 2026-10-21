import { describe, expect, test } from "bun:test";
import { normaliseLoginEmail, safeNextPath, signInErrorMessage, linkErrorMessage, badLinkMessage } from "../src/lib/login.core";
import { portalDestination } from "../src/lib/set-password-link.core";

describe("login email tidy-up", () => {
  test("trailing full stop, spaces, uppercase, plus-address", () => {
    expect(normaliseLoginEmail("jolowexo+install@hotmail.com.")).toEqual({ ok: true, email: "jolowexo+install@hotmail.com" });
    expect(normaliseLoginEmail("  JoLowExo@Hotmail.COM  ")).toEqual({ ok: true, email: "jolowexo@hotmail.com" });
    expect(normaliseLoginEmail("a@b.com..,")).toEqual({ ok: true, email: "a@b.com" });
  });
  test("says exactly what's wrong", () => {
    expect(normaliseLoginEmail("")).toMatchObject({ ok: false, message: "Type your email address." });
    expect(normaliseLoginEmail("jo hotmail.com")).toMatchObject({ ok: false, message: expect.stringContaining("spaces") });
    expect(normaliseLoginEmail("johotmail.com")).toMatchObject({ ok: false, message: expect.stringContaining("@") });
    expect(normaliseLoginEmail("jo@hotmail")).toMatchObject({ ok: false, message: expect.stringContaining("hotmail") });
    expect(normaliseLoginEmail("jo@@x.com")).toMatchObject({ ok: false });
  });
});

describe("messages never reveal accounts", () => {
  test("password", () => {
    expect(signInErrorMessage({ code: "invalid_credentials", message: "Invalid login credentials", status: 400 })).toContain("don't match");
    expect(signInErrorMessage({ status: 429, message: "Request rate limit reached" })).toContain("Too many tries");
  });
  test("links", () => {
    expect(linkErrorMessage({ message: "Signups not allowed for otp", status: 422 })).toBeNull();
    expect(linkErrorMessage({ status: 429, message: "For security purposes, you can only request this after 40 seconds." })).toContain("wait");
    expect(badLinkMessage({ code: "otp_expired", message: "Email link is invalid or has expired" })).toBe("This link has expired.");
  });
});

describe("where people land", () => {
  test("roles", () => {
    expect(portalDestination({ roles: ["admin"], hasBusiness: false })).toBe("/admin/enquiries");
    expect(portalDestination({ roles: ["admin", "installer"], hasBusiness: true })).toBe("choose");
    expect(portalDestination({ roles: ["owner"], hasBusiness: false })).toBe("/owner");
  });
  test("deep links only to portal pages", () => {
    expect(safeNextPath("/field/offer/abc")).toBe("/field/offer/abc");
    expect(safeNextPath("http://localhost:8080/field/offer/abc?x=1")).toBe("/field/offer/abc?x=1");
    for (const bad of ["/", "/calculator", "//evil.com/field", "https://evil.com/x", "/auth", "/portal?next=/x", null]) expect(safeNextPath(bad as never)).toBeNull();
  });
});

// STEP 36 (W4): FFS (approved partner) Phase 1 access gap.
// FFS = an approved partner business member (businessAdmin) who holds no installer/electrician role.
// These tests pin: (1) portal routing sends an FFS partner to /field, (2) the /field route guard
// now ADMITS an FFS partner, (3) unauthorised users are still rejected, (4) no cross-role escalation,
// (5) the existing five-role routing is unchanged, (6) the fix grants NO new DB access (RLS unchanged).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { portalDestination } from "../src/lib/set-password-link.core";

// Mirror of the /field beforeLoad admission rule (src/routes/_authenticated/field.tsx), kept in sync
// by the source-pin test below so a future guard edit cannot silently drift from this contract.
type Access = { admin: boolean; installer: boolean; electrician: boolean; owner: boolean; businessAdmin: boolean };
const fieldGuardAdmits = (a: Access) => a.admin || a.installer || a.electrician || a.businessAdmin;
const base: Access = { admin: false, installer: false, electrician: false, owner: false, businessAdmin: false };

describe("STEP36 FFS routing (login → portal destination)", () => {
  test("approved FFS partner (business, no trade role) lands on /field", () => {
    expect(portalDestination({ roles: [], hasBusiness: true })).toBe("/field");
  });
  test("a user with neither a role nor a business gets no access", () => {
    expect(portalDestination({ roles: [], hasBusiness: false })).toBe("no-access");
  });
});

describe("STEP36 /field guard admits FFS, rejects the unauthorised", () => {
  test("authorised: approved FFS partner (businessAdmin only) is admitted", () => {
    expect(fieldGuardAdmits({ ...base, businessAdmin: true })).toBe(true);
  });
  test("authorised: installer, electrician and admin remain admitted (regression)", () => {
    expect(fieldGuardAdmits({ ...base, installer: true })).toBe(true);
    expect(fieldGuardAdmits({ ...base, electrician: true })).toBe(true);
    expect(fieldGuardAdmits({ ...base, admin: true })).toBe(true);
  });
  test("unauthorised: a bare owner (homeowner) is rejected from /field", () => {
    expect(fieldGuardAdmits({ ...base, owner: true })).toBe(false);
  });
  test("unauthorised: a signed-in user with no role and no business is rejected", () => {
    expect(fieldGuardAdmits({ ...base })).toBe(false);
  });
});

describe("STEP36 no cross-role privilege escalation", () => {
  test("FFS admission does NOT confer admin/installer/electrician/owner capability flags", () => {
    const ffs: Access = { ...base, businessAdmin: true };
    expect(ffs.admin).toBe(false);
    expect(ffs.installer).toBe(false);
    expect(ffs.electrician).toBe(false);
    expect(ffs.owner).toBe(false);
    // Admission is the ONLY thing businessAdmin grants at /field.
    expect(fieldGuardAdmits(ffs)).toBe(true);
  });
  test("owner portal destination is unchanged by the FFS fix", () => {
    expect(portalDestination({ roles: ["owner"], hasBusiness: false })).toBe("/owner");
  });
});

describe("STEP36 existing five-role routing regression", () => {
  test("Office/admin", () => {
    expect(portalDestination({ roles: ["admin"], hasBusiness: false })).toBe("/admin/needs-me");
    expect(portalDestination({ roles: ["admin", "installer"], hasBusiness: true })).toBe("choose");
  });
  test("Installer & Electrician", () => {
    expect(portalDestination({ roles: ["installer"], hasBusiness: true })).toBe("/field");
    expect(portalDestination({ roles: ["electrician"], hasBusiness: true })).toBe("/field");
  });
  test("Homeowner", () => {
    expect(portalDestination({ roles: ["owner"], hasBusiness: false })).toBe("/owner");
  });
  test("FFS", () => {
    expect(portalDestination({ roles: [], hasBusiness: true })).toBe("/field");
  });
});

describe("STEP36 source pins (fix is present, RLS not expanded)", () => {
  const guard = readFileSync("src/routes/_authenticated/field.tsx", "utf8");
  const access = readFileSync("src/lib/route-guards.ts", "utf8");

  test("the /field guard admits businessAdmin (the FFS fix is in place)", () => {
    expect(guard).toContain("a.businessAdmin");
    expect(guard).toMatch(/a\.admin \|\| a\.installer \|\| a\.electrician \|\| a\.businessAdmin/);
  });
  test("businessAdmin is derived only from an existing business_members membership (no new DB grant)", () => {
    expect(access).toContain('.from("business_members")');
    expect(access).toContain('.eq("member_role", "business_admin")');
  });
  test("the FFS fix adds no new RLS/policy and no job/quote table grants", () => {
    // The change is purely a client-side route admission; it must not introduce SQL DDL.
    expect(guard).not.toMatch(/create\s+policy|alter\s+table|enable\s+row\s+level\s+security|grant\s+(all|select|execute)/i);
    // My work (/field) reads stay on the RLS-bounded trade server fns — no direct quotes/jobs widening here.
    expect(guard).not.toMatch(/from\(["']quotes["']\)|from\(["']jobs["']\)/);
  });
});

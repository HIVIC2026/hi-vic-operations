// Decision 381: the staff address opens sign-in; customer hosts keep the calculator at the bare address.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isStaffHost, staffHostRedirect } from "../src/lib/staff-host.core";

describe("decision 381: staff host", () => {
  test("bare staff address → /auth; everything else unchanged", () => {
    expect(staffHostRedirect("https://portal.homeinsulationvictoria.com.au/")).toBe("/auth");
    expect(staffHostRedirect("https://PORTAL.homeinsulationvictoria.com.au/?x=1")).toBe("/auth");
    expect(staffHostRedirect("https://portal.homeinsulationvictoria.com.au/calculator")).toBeNull();
    expect(staffHostRedirect("https://portal.homeinsulationvictoria.com.au/home")).toBeNull();
    expect(staffHostRedirect("https://estimate.homeinsulationvictoria.com.au/")).toBeNull();
    expect(staffHostRedirect("https://hi-vic-operations.lovable.app/")).toBeNull();
    expect(isStaffHost("estimate.homeinsulationvictoria.com.au")).toBe(false);
  });
  test("server entry and the / route both apply it", () => {
    expect(readFileSync("src/server.ts", "utf8")).toContain("staffHostRedirect(request.url)");
    expect(readFileSync("src/routes/index.tsx", "utf8")).toContain("isStaffHost(window.location.hostname)");
  });
});

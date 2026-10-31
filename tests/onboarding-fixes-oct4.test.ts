import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { stepErrors, type InstData } from "../src/lib/installer-onboarding.core";

const page = readFileSync("src/routes/installer-onboarding.tsx", "utf8");
const recPage = readFileSync("src/routes/electrician-onboarding.tsx", "utf8");
const worker = {
  full_legal_name: "A B",
  piisa_done: "no",
  mobile: "0412345679",
  email: "a@example.com",
  cii_holds: "held" as const,
  cii_certificate_number: "C1",
  cii_issuer: "EEC",
  cii_issue_date: "2024-01-01",
};
const errs = (d: InstData, k: string) => stepErrors(k as never, d).join(" | ");

describe("onboarding fixes", () => {
  test("weekly installations is not asked and never required", () => {
    expect(page).not.toContain("Weekly installations");
    expect(errs({ capacity_band: undefined }, "capacity")).toBe("");
  });
  test("REC weekly capacity is also hidden and ignored", () => {
    expect(recPage).not.toContain("Weekly assessment visits");
  });
  test("accepting new work is a Yes/No choice; No is allowed", () => {
    expect(page).toContain(
      "Are you available to accept Home Insulation Victoria work at the moment?",
    );
    const base: InstData = { typical_days: ["Mon"], normal_attendance_speed: "1-2 weeks" };
    expect(errs({ ...base, accepting_jobs: false }, "availability")).toBe("");
    expect(errs(base, "availability")).toContain("new work");
  });
  test("held CII needs level and a future expiry; provisional is marked no-work", () => {
    expect(errs({ installers: [worker] }, "installers")).toContain("Full or Provisional");
    expect(
      errs(
        { installers: [{ ...worker, cii_level: "full", cii_expiry: "2020-01-01" }] },
        "installers",
      ),
    ).toContain("expiry");
    expect(
      errs(
        { installers: [{ ...worker, cii_level: "provisional", cii_expiry: "2099-01-01" }] },
        "installers",
      ),
    ).not.toContain("expiry");
    expect(page).toContain("can't receive work until they hold a Full certification");
  });
  test("nothing is saved until the first page is saved", () => {
    const begin = page.slice(
      page.indexOf("async function begin()"),
      page.indexOf("async function persist("),
    );
    expect(begin).not.toContain("startWith(");
    expect(
      page.slice(page.indexOf("async function persist("), page.indexOf("async function go(")),
    ).toContain("await startWith(token)");
  });
  test("brand fonts", () => {
    expect(page).toContain("Outfit");
    expect(page).toContain("Figtree");
  });
});

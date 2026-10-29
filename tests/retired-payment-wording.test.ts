import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const RETIRED = [/3-instalment plan/i, /minimum upfront deposit/i, /deposit request in Xero/i, /requested in Xero/i, /Minimum deposit/];

describe("retired payment wording (batch 3a task 4)", () => {
  test("acceptance record uses the approved line", () => {
    const s = read("src/lib/portal.functions.ts");
    expect(s).toContain("safety check paid at acceptance; electrical fixes in full if needed; 10% install deposit to book the install; balance on installation day.");
    for (const re of RETIRED) expect(s).not.toMatch(re);
  });
  test("Xero office notes name today's steps", () => {
    const s = read("src/lib/xero.server.ts");
    for (const re of RETIRED) expect(s).not.toMatch(re);
    expect(s).toContain("Safety check payment confirmed in Xero");
  });
  test("office invoice panel: no deposit-request wording, 10% comes from the server payment plan", () => {
    const s = read("src/components/portal/panels.tsx");
    for (const re of RETIRED) expect(s).not.toMatch(re);
    expect(s).not.toMatch(/Request deposit|Deposit request must be raised/);
    expect(s).not.toMatch(/paymentPlan\(\{ quoteTotalCents: Math\.round\(Number\(i\.total_inc_gst\)/);
  });
});

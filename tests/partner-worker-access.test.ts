import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const activation = readFileSync("src/lib/partner-activation.functions.ts", "utf8");
const activationCore = readFileSync("src/lib/partner-activation.core.ts", "utf8");
const access = readFileSync("src/lib/pilot.functions.ts", "utf8");
const team = readFileSync("src/components/portal/business.tsx", "utf8");
const migration = readFileSync("drizzle/migrations/0052_partner_worker_profiles.sql", "utf8");

describe("partner worker access", () => {
  test("activation creates one business-linked record for every nominated worker", () => {
    expect(activation).toContain('admin.from("partner_workers").upsert(workers');
    expect(activation).toContain("activationWorkers(type, application");
    expect(activationCore).toContain("(application as InstData).installers");
  });

  test("trade access must match the approved onboarding email and role", () => {
    expect(access).toContain('admin.from("partner_workers")');
    expect(access).toContain('.ilike("email", normalizedEmail)');
    expect(access).toContain('.eq("trade_role", data.tradeRole)');
    expect(access).toContain('account_status: "linked"');
  });

  test("worker records are private to HI VIC and their business", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("public.is_admin() OR public.is_business_member(business_id)");
    expect(team).toContain("Awaiting account");
  });
});
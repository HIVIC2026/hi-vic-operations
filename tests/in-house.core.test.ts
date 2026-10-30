import { describe, expect, test } from "bun:test";
import { inHouseEnableBlockers, isInHousePartner, partnerBillsRectification } from "../src/lib/in-house.core";
import { readFileSync } from "node:fs";
import { z } from "zod";

describe("in-house partner", () => {
  test("reads the stored flag", () => {
    expect(isInHousePartner({ in_house: true })).toBe(true);
    expect(isInHousePartner({ in_house: false })).toBe(false);
  });
  test("requires approved worker and Mitti login", () => {
    expect(inHouseEnableBlockers({ approvedElectricianWorkers: 0, hasActiveRateCardWithPiesa: true, mittiElectricianLogins: 0 })).toEqual(["No approved electrician worker", "No electrician Mitti login"]);
  });
  test("requires an active PIESA rate card", () => {
    expect(inHouseEnableBlockers({ approvedElectricianWorkers: 1, hasActiveRateCardWithPiesa: false, mittiElectricianLogins: 1 })).toEqual(["No active rate card with PIESA"]);
  });
  test("allows all good facts", () => {
    expect(inHouseEnableBlockers({ approvedElectricianWorkers: 1, hasActiveRateCardWithPiesa: true, mittiElectricianLogins: 1 })).toEqual([]);
  });
  test("partner bills rectification only when in-house", () => {
    expect(partnerBillsRectification({ in_house: true, rectification_billed_by: "partner" })).toBe(true);
    expect(partnerBillsRectification({ in_house: false, rectification_billed_by: "partner" })).toBe(false);
    expect(partnerBillsRectification({ in_house: true, rectification_billed_by: "hivic" })).toBe(false);
  });
});

// Exercise the actual save handler with isolated callers and an in-memory business.
// No server imports, hosted reads, settings changes, or delivery paths.
const source = readFileSync("src/lib/pilot.functions.ts", "utf8");
const handlerBody = source.split("export const saveBusiness =")[1]?.split(".handler(async ({ data, context }) => {")[1]?.split("\n  });")[0];
if (!handlerBody) throw new Error("Business save handler not found");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runHandler = new AsyncFunction("data", "context", "isAdmin", "splitInvoicingBlocker", "WorkflowError", "admin", "requireMember", "CRITICAL_FIELDS", "inHouseEnableBlockers", "readFacts", handlerBody.replace('await (await import("./installer-paid-electricians.server")).inHouseFactsFor(id)', 'await readFacts(id)'));

function saveFixture(adminUser: boolean, facts = { approvedElectricianWorkers: 1, hasActiveRateCardWithPiesa: true, mittiElectricianLogins: 1 }) {
  const writes: Record<string, unknown>[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const before = { id: "business-a", name: "TEST partner", in_house: false, rectification_billed_by: "hivic" };
  const admin = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: before }) }) }), update: (patch: Record<string, unknown>) => { writes.push(patch); return { eq: async () => ({ error: null }) }; } }),
    rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return { error: null }; } };
  return { writes, rpcCalls, run: (data: Record<string, unknown>) => runHandler(data, { userId: adminUser ? "office-a" : "partner-b", supabase: {} }, async () => adminUser, () => null, Error, admin, async (_user: string, id: string) => { if (id !== "business-a") throw new Error("Not your business."); }, [], inHouseEnableBlockers, async () => facts) };
}

test("only the office can save in-house and billing configuration", async () => {
  const office = saveFixture(true);
  await office.run({ id: "business-a", name: "TEST partner", in_house: true, rectification_billed_by: "partner" });
  expect(office.rpcCalls).toEqual([{ name: "save_in_house_partner", args: { p_business_id: "business-a", p_in_house: true, p_rectification_billed_by: "partner", p_actor_id: "office-a" } }]);
  const partner = saveFixture(false);
  await partner.run({ id: "business-a", name: "TEST partner", in_house: true, rectification_billed_by: "partner" });
  expect(partner.rpcCalls).toEqual([]);
  expect(partner.writes[0]).not.toHaveProperty("in_house");
  expect(partner.writes[0]).not.toHaveProperty("rectification_billed_by");
  await expect(partner.run({ id: "business-other", name: "Other partner", in_house: true })).rejects.toThrow("Not your business.");
});

test("save refuses enabling with the exact blocker reasons and writes nothing", async () => {
  const office = saveFixture(true, { approvedElectricianWorkers: 0, hasActiveRateCardWithPiesa: true, mittiElectricianLogins: 0 });
  await expect(office.run({ id: "business-a", name: "TEST partner", in_house: true })).rejects.toThrow("No approved electrician worker • No electrician Mitti login");
  expect(office.rpcCalls).toEqual([]);
  expect(office.writes).toEqual([]);
});

test("business input permits only the two billing choices", () => {
  const expression = source.match(/const businessInput = (z\.object\([\s\S]*?\n\}\));/)?.[1];
  if (!expression) throw new Error("Business input not found");
  const schema = new Function("z", "uuid", "txt", `return ${expression}`)(z, z.string().uuid(), (n: number) => z.string().trim().max(n).nullish()) as z.ZodType;
  expect(schema.safeParse({ name: "TEST partner", in_house: true, rectification_billed_by: "partner" }).success).toBe(true);
  expect(schema.safeParse({ name: "TEST partner", in_house: false, rectification_billed_by: "hivic" }).success).toBe(true);
  expect(schema.safeParse({ name: "TEST partner", rectification_billed_by: "electrician" }).success).toBe(false);
});
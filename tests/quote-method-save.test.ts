// Photo-quote installers Task 1: saveBusiness keeps "How they quote" office-only, a missing column reads as Ready Check,
// and the Partners business page offers both choices. Runs the real handler source with an in-memory business.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import { inHouseEnableBlockers } from "../src/lib/in-house.core";

const source = readFileSync("src/lib/pilot.functions.ts", "utf8");
const handlerBody = source.split("export const saveBusiness =")[1]?.split(".handler(async ({ data, context }) => {")[1]?.split("\n  });")[0];
if (!handlerBody) throw new Error("Business save handler not found");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const javascript = ts.transpile(handlerBody.replace('await (await import("./installer-paid-electricians.server")).inHouseFactsFor(id)', 'await readFacts(id)'), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
const runHandler = new AsyncFunction("data", "context", "isAdmin", "splitInvoicingBlocker", "WorkflowError", "admin", "requireMember", "CRITICAL_FIELDS", "inHouseEnableBlockers", "readFacts", javascript);

function fixture(adminUser: boolean, before: Record<string, unknown>) {
  const writes: Record<string, unknown>[] = [];
  const admin = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: before }) }) }), update: (patch: Record<string, unknown>) => { writes.push(patch); return { eq: async () => ({ error: null }) }; } }),
    rpc: async () => ({ error: null }) };
  return { writes, run: (data: Record<string, unknown>) => runHandler(data, { userId: adminUser ? "office-a" : "partner-b", supabase: {} }, async () => adminUser, () => null, Error, admin, async () => {}, [], inHouseEnableBlockers, async () => ({})) };
}
const BEFORE = { id: "business-a", name: "No Gap Insulation", in_house: true, rectification_billed_by: "hivic", quote_method: "ready_check" };

test("the office can set From photos", async () => {
  const office = fixture(true, BEFORE);
  await office.run({ id: "business-a", name: "No Gap Insulation", quote_method: "photos" });
  expect(office.writes[0]).toMatchObject({ quote_method: "photos" });
});

test("a non-admin patch with quote_method drops it", async () => {
  const partner = fixture(false, BEFORE);
  await partner.run({ id: "business-a", name: "No Gap Insulation", quote_method: "photos" });
  expect(partner.writes[0]).not.toHaveProperty("quote_method");
});

test("before the pending SQL runs (no column): From photos is refused with a reason, Ready Check is dropped", async () => {
  const { quote_method: _gone, ...noColumn } = BEFORE;
  const office = fixture(true, noColumn);
  await expect(office.run({ id: "business-a", name: "No Gap Insulation", quote_method: "photos" })).rejects.toThrow("From photos can't be saved yet");
  expect(office.writes).toEqual([]);
  await office.run({ id: "business-a", name: "No Gap Insulation", quote_method: "ready_check" });
  expect(office.writes[0]).not.toHaveProperty("quote_method");
});

test("business input allows only ready_check / photos", () => {
  const expression = source.match(/const businessInput = (z\.object\([\s\S]*?\n\}\));/)?.[1];
  if (!expression) throw new Error("Business input not found");
  const schema = new Function("z", "uuid", "txt", `return ${expression}`)(z, z.string().uuid(), (n: number) => z.string().trim().max(n).nullish()) as z.ZodType;
  expect(schema.safeParse({ name: "TEST partner", quote_method: "photos" }).success).toBe(true);
  expect(schema.safeParse({ name: "TEST partner", quote_method: "ready_check" }).success).toBe(true);
  expect(schema.safeParse({ name: "TEST partner", quote_method: "desk" }).success).toBe(false);
});

test("the Partners business page offers How they quote: both choices from the core labels, saved only when changed", () => {
  const page = readFileSync("src/routes/_authenticated/admin.partners_.business.$businessId.tsx", "utf8");
  expect(page).toContain("PHOTO_QUOTE_WORDS.settingLabel");
  expect(page).toContain("QUOTE_METHODS.map(m => ");
  expect(page).toContain("PHOTO_QUOTE_WORDS.methodLabel[m]");
  expect(page).toContain("...(method !== quoteMethodOf(business) ? { quote_method: method } : {})");
});

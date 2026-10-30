import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { z } from "zod";

// Exercise the actual input schema without importing any server/network dependencies.
const source = readFileSync(new URL("../src/lib/pilot.functions.ts", import.meta.url), "utf8");
const schemaExpression = source.match(/const businessInput = (z\.object\([\s\S]*?\n\}\));/ )?.[1];
if (!schemaExpression) throw new Error("Business save input schema not found");
const schema = new Function("z", "uuid", "txt", `return ${schemaExpression}`)(z, z.string().uuid(), (n: number) => z.string().trim().max(n).nullish()) as z.ZodType;

test("existing save accepts 750 postcode entries but refuses 751", () => {
  expect(schema.safeParse({ name: "TEST partner", service_postcodes: Array(750).fill("3199") }).success).toBe(true);
  expect(schema.safeParse({ name: "TEST partner", service_postcodes: Array(751).fill("3199") }).success).toBe(false);
  expect(schema.safeParse({ name: "TEST partner", service_postcodes: ["3*"] }).success).toBe(true);
});
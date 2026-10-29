// Final review fix: Add a person before migration 0230 (declarations_due) is live, and any other insert error, never
// shows the boss a raw database message. No retry without the column.
import { expect, mock, test } from "bun:test";

let insertError: { code?: string; message: string } | null = null;
let inserts = 0;
const result = (table: string) => {
  if (table === "business_members") return { data: [{ business_id: "b1", member_role: "business_admin" }], error: null };
  if (table === "user_roles") return { data: [{ role: "installer" }], error: null };
  if (table === "profiles") return { data: { full_name: "Boss Test" }, error: null };
  if (table === "businesses") return { data: { id: "b1", name: "Test Biz", business_type: "eec_installer" }, error: null };
  return { data: null, error: null };
};
const chain = (table: string): Record<string, unknown> => {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "order", "limit"]) c[m] = () => c;
  c.insert = () => { inserts++; return { select: () => ({ single: async () => (insertError ? { data: null, error: insertError } : { data: { id: "w1" }, error: null }) }) }; };
  c.maybeSingle = async () => result(table);
  c.single = async () => result(table);
  c.then = (r: (v: unknown) => unknown) => Promise.resolve(result(table)).then(r);
  return c;
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => chain(t), rpc: async () => ({ data: null, error: null }) } }));

const { tradeAddTeamPerson } = await import("../src/lib/trade-view.server");
const add = () => tradeAddTeamPerson("u1", { name: "Sam Crew", workerRole: "crew", mobile: null, email: null, licenceNumber: null });
const DB_UPDATE = "Adding someone without an email needs the office's database update first.";

test("missing declarations_due column (PostgREST schema cache) gives the database-update message, no retry", async () => {
  insertError = { code: "PGRST204", message: "Could not find the 'declarations_due' column of 'partner_workers' in the schema cache" }; inserts = 0;
  await expect(add()).rejects.toThrow(DB_UPDATE);
  expect(inserts).toBe(1);
});
test("missing column from Postgres gives the same message", async () => {
  insertError = { code: "42703", message: 'column "declarations_due" of relation "partner_workers" does not exist' }; inserts = 0;
  await expect(add()).rejects.toThrow(DB_UPDATE);
  expect(inserts).toBe(1);
});
test("any other error says plain words, not the database message", async () => {
  insertError = { code: "XX000", message: "internal raw db detail" };
  const e = await add().catch((x: Error) => x);
  expect((e as Error).message).toBe("Couldn't add them. Please try again.");
});
test("existing cases unchanged", async () => {
  insertError = { code: "23502", message: "null value" };
  await expect(add()).rejects.toThrow(DB_UPDATE);
  insertError = { code: "23505", message: "dup" };
  await expect(add()).rejects.toThrow("Someone with that email is already on your team.");
  insertError = null;
  expect(await add()).toEqual({ workerId: "w1" });
});

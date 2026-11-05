// Final review fix: Add a person when a column the live table does not have yet is named, and any other insert error, never
// shows the boss a raw database message. No retry without the column.
// Jo 5 Nov 2026: adding a person never sets declarations_due, so a new team member is not held back from jobs.
import { expect, mock, test } from "bun:test";

let insertError: { code?: string; message: string } | null = null;
let inserts = 0;
let inserted: Record<string, unknown> | null = null; // the partner_workers row
let role = "installer";
const result = (table: string) => {
  if (table === "business_members") return { data: [{ business_id: "b1", member_role: "business_admin", businesses: { id: "b1", name: "Test Biz", business_type: "eec_installer" } }], error: null }; // business embedded, as PostgREST returns it
  if (table === "user_roles") return { data: [{ role }], error: null };
  if (table === "profiles") return { data: { full_name: "Boss Test" }, error: null };
  if (table === "businesses") return { data: { id: "b1", name: "Test Biz", business_type: "eec_installer" }, error: null };
  return { data: null, error: null };
};
const chain = (table: string): Record<string, unknown> => {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "order", "limit"]) c[m] = () => c;
  c.insert = (row: Record<string, unknown>) => { inserts++; if (table === "partner_workers") inserted = row; return { select: () => ({ single: async () => (insertError ? { data: null, error: insertError } : { data: { id: "w1" }, error: null }) }) }; };
  c.maybeSingle = async () => result(table);
  c.single = async () => result(table);
  c.then = (r: (v: unknown) => unknown) => Promise.resolve(result(table)).then(r);
  return c;
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => chain(t), rpc: async () => {inserts++;return {data:insertError?null:'w1',error:insertError};} } }));

const { tradeAddTeamPerson } = await import("../src/lib/trade-view.server");
// Task 10 (Jo 2 Nov): mobile + date of birth are required for everyone, so the fixture gives both.
const add = () => tradeAddTeamPerson("u1", { name: "Sam Crew", role: "crew", mobile: "0412 000 111", email: null, licenceNumber: null, recNumber: null, dateOfBirth: "1990-01-01" });
const DB_UPDATE = "Adding someone without an email needs the office's database update first.";

test("missing column (PostgREST schema cache) gives the database-update message, no retry", async () => {
  insertError = { code: "PGRST204", message: "Could not find the 'worker_role' column of 'partner_workers' in the schema cache" }; inserts = 0;
  await expect(add()).rejects.toThrow(DB_UPDATE);
  expect(inserts).toBe(1);
});
test("missing column from Postgres gives the same message", async () => {
  insertError = { code: "42703", message: 'column "worker_role" of relation "partner_workers" does not exist' }; inserts = 0;
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

test("adding an electrician team member does not hold them back from jobs: no declarations_due is written", async () => {
  role = "electrician"; insertError = null; inserted = null;
  try {
    const r = await tradeAddTeamPerson("u1", { name: "Eli Sparks", role: "electrician", mobile: "0412 000 222", email: "eli@sparks.test", licenceNumber: "A12345", recNumber: "REC1", dateOfBirth: "1990-01-01" });
    expect(r).toEqual({ workerId: "w1" });
    expect(inserted).not.toBeNull();
    expect(Object.keys(inserted!)).not.toContain("declarations_due");
    expect(inserted).toMatchObject({ approval_status: "pending", full_legal_name: "Eli Sparks" });
  } finally { role = "installer"; }
});

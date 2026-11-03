// Local actual-handler proof only: no live database or delivery.
import { beforeEach, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let writes = 0;
function query(table: string) {
  let rows = [...(tables[table] ?? [])];
  let patch: Row | null = null;
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (key: string, value: unknown) => { rows = rows.filter(r => r[key] === value); return q; };
  q.is = (key: string, value: unknown) => { rows = rows.filter(r => (r[key] ?? null) === value); return q; };
  q.update = (value: Row) => { patch = value; return q; };
  const result = (single = false) => {
    if (patch) {
      const email = patch.email;
      if (email && rows.some(r => tables.partner_workers?.some(other => other !== r && other.business_id === r.business_id && other.email === email))) {
        return { data: null, error: { code: "23505", message: "duplicate" } };
      }
      for (const row of rows) { Object.assign(row, patch); writes++; }
    }
    return { data: single ? rows[0] ?? null : rows, error: null };
  };
  q.maybeSingle = async () => result(true);
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: query } }));
const { tradeFillWorkerMissing } = await import("../src/lib/trade-view.server");
beforeEach(() => {
  writes = 0;
  const business = (id: string) => ({ id, name: `TEST ${id}`, business_type: "eec_installer" });
  Object.assign(tables, {
    business_members: [
      { user_id: "boss-a", active: true, member_role: "business_admin", business_id: "a", businesses: business("a") },
      { user_id: "boss-b", active: true, member_role: "business_admin", business_id: "b", businesses: business("b") },
      { user_id: "staff-a", active: true, member_role: "member", business_id: "a", businesses: business("a") },
    ],
    user_roles: ["boss-a", "boss-b", "staff-a"].map(user_id => ({ user_id, role: "installer" })),
    profiles: [],
    partner_workers: [
      { id: "wayne", business_id: "a", email: null, removed_at: null },
      { id: "liam", business_id: "b", email: null, removed_at: null },
      { id: "existing", business_id: "a", email: "existing@example.com.au", removed_at: null },
    ],
    partner_worker_identity: [{ worker_id: "wayne", date_of_birth: "1990-01-01" }, { worker_id: "liam", date_of_birth: "1991-01-01" }],
  });
});
const fill = (boss: string, worker: string, email: string) => tradeFillWorkerMissing(boss, worker, { email, dateOfBirth: null });
test("both installer bosses fill only their own team's email", async () => {
  await expect(fill("boss-a", "liam", "wrong@example.com.au")).rejects.toThrow("Team member not found.");
  await expect(fill("boss-b", "wayne", "wrong@example.com.au")).rejects.toThrow("Team member not found.");
  expect(writes).toBe(0);
  expect(await fill("boss-a", "wayne", " Wayne@Example.com.au ")).toEqual({ ok: true });
  expect(await fill("boss-b", "liam", "liam@example.com.au")).toEqual({ ok: true });
  expect(tables.partner_workers?.map(r => r.email)).toEqual(["wayne@example.com.au", "liam@example.com.au", "existing@example.com.au"]);
  expect(writes).toBe(2);
  expect(tables.partner_worker_identity?.map(r => r.date_of_birth)).toEqual(["1990-01-01", "1991-01-01"]);
});
test("duplicate team email is refused without saving", async () => {
  await expect(fill("boss-a", "wayne", " Existing@Example.com.au ")).rejects.toThrow("Someone in your team already uses that email.");
  expect(tables.partner_workers?.[0]?.email).toBeNull();
  expect(writes).toBe(0);
});
test("saved email cannot be overwritten", async () => {
  await expect(fill("boss-a", "existing", "replacement@example.com.au")).rejects.toThrow("Their email is already saved.");
  expect(tables.partner_workers?.[2]?.email).toBe("existing@example.com.au");
  expect(writes).toBe(0);
});
test("staff cannot fill team emails", async () => {
  await expect(fill("staff-a", "wayne", "wayne@example.com.au")).rejects.toThrow("Only the business owner");
  expect(writes).toBe(0);
});
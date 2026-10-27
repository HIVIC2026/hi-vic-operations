import { beforeEach, expect, mock, test } from "bun:test";
let role = "qa_office";
const testId = "00000000-0000-4000-8000-000000000001";
const realId = "00000000-0000-4000-8000-000000000002";
let scopes: (string[] | undefined)[] = [];
mock.module("@tanstack/react-start", () => ({ createServerFn: () => {
  let validate = (d: unknown) => d;
  const chain = { middleware: () => chain, inputValidator: (fn: typeof validate) => { validate = fn; return chain; }, handler: (fn: (a: unknown) => unknown) => (a: { data: unknown; context: unknown }) => fn({ ...a, data: validate(a.data) }) };
  return chain;
} }));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("../src/lib/workflow.server", () => ({ requireAdmin: async () => { if (role !== "admin") throw new Error("Admin only"); } }));
mock.module("../src/lib/qa-office-access.server", () => ({ requireOfficeIdentity: async () => role, officeTestJobIds: async () => [testId], officeTestBusinessIds: async () => [testId] }));
const list = (ids?: string[]) => { scopes.push(ids); return { rows: (ids ?? [testId, realId]).map(id => ({ id })) }; };
mock.module("../src/lib/installer-waiting.server", () => ({ loadInstallerWaitingList: async (_p: unknown, ids?: string[]) => list(ids) }));
mock.module("../src/lib/office-money.server", () => ({ moneyPayouts: async (ids?: string[]) => list(ids), moneyInvoices: async () => list(), moneyMargins: async () => list() }));
const money = await import("../src/lib/office-money.functions");
const waiting = await import("../src/lib/installer-waiting.functions");
const invoke = (fn: unknown, data = {}) => (fn as (a: unknown) => Promise<{ rows: { id: string }[] }>)({ data, context: { supabase: {} } });
beforeEach(() => { role = "qa_office"; scopes = []; });
for (const [name, fn] of [["payouts", money.getMoneyPayouts], ["Choose installer", waiting.getInstallerWaitingList]] as const) {
  test(`${name}: zero real rows and admin unchanged`, async () => {
    expect((await invoke(fn)).rows).toEqual([{ id: testId }]);
    expect(scopes).toEqual([[testId]]);
    role = "admin";
    expect((await invoke(fn)).rows).toEqual([{ id: testId }, { id: realId }]);
    expect(scopes[1]).toBeUndefined();
  });
}
test("denied Money lists refuse TEST office before reads; admin unchanged", async () => {
  for (const fn of [money.getMoneyInvoices, money.getMoneyMargins]) await expect(invoke(fn)).rejects.toThrow("Admin only");
  expect(scopes).toEqual([]);
  role = "admin";
  expect((await invoke(money.getMoneyInvoices)).rows).toHaveLength(2);
});
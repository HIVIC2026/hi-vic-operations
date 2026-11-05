import { beforeEach, expect, mock, test } from "bun:test";

type Row = Record<string, any>;
let rows: Row[] = [];
let tableError: { code: string; message: string } | null = null;
let claimResult: { data: Row[] | null; error: { code: string; message: string } | null } = { data: [], error: null };

function builder(op: "insert" | "select" | "update", payload?: Row) {
  const filters: [string, unknown][] = [];
  const run = () => {
    if (tableError) return { data: null, error: tableError };
    if (op === "insert") {
      if (rows.some((r) => r.kind === payload!.kind && r.work_key === payload!.work_key)) return { data: null, error: { code: "23505", message: "duplicate" } };
      rows.push({ attempts: 0, status: "open", ...payload }); return { data: null, error: null };
    }
    const hit = rows.filter((r) => filters.every(([k, v]) => r[k] === v));
    if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
    return { data: hit[0] ?? null, error: null };
  };
  const q: any = {
    eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
    select: () => q,
    maybeSingle: async () => run(),
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: () => ({
    insert: (p: Row) => builder("insert", p),
    select: () => builder("select"),
    update: (p: Row) => builder("update", p),
  }),
  rpc: async () => claimResult,
} }));
const { addWork, workStatus, markDone, markFailed, runRecoveryWork } = await import("../src/lib/recovery-work.server");

const noop = async () => undefined;
const handlers = (over: Record<string, any> = {}) => ({
  veec_final_copy: noop, veec_copy_email: noop, stripe_payment_followup: noop, stripe_refund_waiting: noop, spot_saved_email: noop, ...over,
}) as any;
const claim = (...items: Row[]) => { claimResult = { data: items.map((i) => ({ job_id: null, payload: {}, attempts: 0, status: "open", last_error: null, ...i })), error: null }; };

beforeEach(() => { rows = []; tableError = null; claimResult = { data: [], error: null }; });

test("addWork twice: added then exists", async () => {
  expect(await addWork("veec_final_copy", "k1", null, { a: 1 })).toBe("added");
  expect(await addWork("veec_final_copy", "k1", null, { a: 1 })).toBe("exists");
  expect(await workStatus("veec_final_copy", "k1")).toBe("open");
  expect(await workStatus("veec_final_copy", "nope")).toBeNull();
});

test("addWork accepts a starting status and error", async () => {
  await addWork("spot_saved_email", "k", null, {}, { status: "needs_office", lastError: "bad" });
  expect(rows[0]).toMatchObject({ status: "needs_office", last_error: "bad" });
});

test("missing table (either code) is unavailable, not a throw", async () => {
  for (const code of ["42P01", "PGRST205"]) {
    tableError = { code, message: "missing" };
    expect(await addWork("veec_final_copy", "k", null, {})).toBe("unavailable");
    expect(await workStatus("veec_final_copy", "k")).toBe("unavailable");
  }
});

test("other errors throw", async () => {
  tableError = { code: "XX000", message: "boom" };
  await expect(addWork("veec_final_copy", "k", null, {})).rejects.toThrow("boom");
});

test("markDone marks done", async () => {
  await addWork("veec_final_copy", "k", null, {});
  await markDone("veec_final_copy", "k", "sent");
  expect(rows[0].status).toBe("done");
  expect(rows[0].done_at).toBeTruthy();
});

test("markFailed backs off, then hands to office on the 3rd failure", async () => {
  await addWork("veec_final_copy", "k", null, {});
  const now = new Date("2026-11-05T00:00:00Z");
  expect(await markFailed("veec_final_copy", "k", "e1", now)).toBe("open");
  expect(rows[0]).toMatchObject({ attempts: 1, last_error: "e1", next_attempt_at: "2026-11-05T00:05:00.000Z" });
  expect(await markFailed("veec_final_copy", "k", "e2", now)).toBe("open");
  expect(await markFailed("veec_final_copy", "k", "e3", now)).toBe("needs_office");
  expect(rows[0]).toMatchObject({ attempts: 3, status: "needs_office" });
});

test("runRecoveryWork: done, failed, needs_office, and one throw doesn't stop the rest", async () => {
  await addWork("veec_final_copy", "a", null, {});
  await addWork("veec_copy_email", "b", null, {});
  await addWork("stripe_payment_followup", "c", null, {});
  rows[2].attempts = 2;
  claim(
    { kind: "veec_final_copy", work_key: "a" },
    { kind: "veec_copy_email", work_key: "b", attempts: 0 },
    { kind: "stripe_payment_followup", work_key: "c", attempts: 2 },
    { kind: "spot_saved_email", work_key: "d" },
  );
  const seen: string[] = [];
  const res = await runRecoveryWork(handlers({
    veec_final_copy: async (i: any) => { seen.push(i.work_key); },
    veec_copy_email: async () => { throw new Error("nope"); },
    stripe_payment_followup: async () => { throw new Error("nope again"); },
    spot_saved_email: async (i: any) => { seen.push(i.work_key); },
  }));
  expect(res).toEqual({ done: 2, failed: 1, needsOffice: 1 });
  expect(seen).toEqual(["a", "d"]);
  expect(rows.map((r) => r.status)).toEqual(["done", "open", "needs_office"]);
});

test("unknown kind is marked failed with 'no handler'", async () => {
  await addWork("veec_final_copy", "a", null, {});
  claim({ kind: "veec_final_copy", work_key: "a" });
  const res = await runRecoveryWork({} as any);
  expect(res).toEqual({ done: 0, failed: 1, needsOffice: 0 });
  expect(rows[0].last_error).toBe("no handler");
});

test("claim RPC missing returns zeros", async () => {
  claimResult = { data: null, error: { code: "PGRST202", message: "function not found" } };
  expect(await runRecoveryWork(handlers())).toEqual({ done: 0, failed: 0, needsOffice: 0 });
  claimResult = { data: null, error: { code: "42883", message: "no function" } };
  expect(await runRecoveryWork(handlers())).toEqual({ done: 0, failed: 0, needsOffice: 0 });
});

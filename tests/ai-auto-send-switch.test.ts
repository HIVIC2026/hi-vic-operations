// AI replies step 4, task 2: auto-send switch + samples. Fake database, no live calls.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { COMPLAINT_WORDS } from "../src/lib/ai-email-reply.core";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let tables: Record<string, Row[]> = {};
let failAll = false;
let isAdmin = true;
const inserts: Row[] = [];

function from(table: string) {
  let rows = [...(tables[table] ?? [])]; let ins: Row | null = null; let lim = Infinity; let from0 = 0;
  const q: Record<string, unknown> = {};
  const get = (r: Row, path: string) => path.includes("->>") ? r["details"]?.[path.split("->>")[1]!] : r[path];
  Object.assign(q, {
    select: () => q,
    insert: (v: Row) => { ins = v; return q; },
    eq: (c: string, v: unknown) => { rows = rows.filter((r) => get(r, c) === v); return q; },
    in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(get(r, c))); return q; },
    order: (c: string, o: { ascending: boolean }) => { rows.sort((a, b) => (a[c] < b[c] ? -1 : 1) * (o.ascending ? 1 : -1)); return q; },
    limit: (n: number) => { lim = n; return q; },
    range: (a: number, b: number) => { from0 = a; lim = b - a + 1; return q; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (failAll) return Promise.resolve({ data: null, error: { message: "boom" } }).then(res, rej);
      if (ins) { inserts.push({ table, ...ins }); (tables[table] ??= []).push({ created_at: "9999", ...ins }); return Promise.resolve({ data: null, error: null }).then(res, rej); }
      return Promise.resolve({ data: rows.slice(from0, from0 + lim), error: null }).then(res, rej);
    },
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = { middleware: () => b, inputValidator: (fn: typeof validate) => { validate = fn; return b; },
      handler: (h: (a: { data: unknown; context: unknown }) => Promise<unknown>) => async (a: { data?: unknown }) =>
        h({ data: validate(a?.data), context: { userId: "u1", supabase: { rpc: async () => ({ data: isAdmin, error: null }) } } }) };
    return b;
  },
  createMiddleware: () => ({ server: () => ({}) }),
}));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const { autoSendOn, autoSendSamples, switchAutoSend } = await import("../src/lib/ai-auto-send.server");
const fns = await import("../src/lib/ai-answers.functions");
const call = (fn: unknown, data?: unknown) => (fn as (a: { data?: unknown }) => Promise<any>)({ data }); // eslint-disable-line @typescript-eslint/no-explicit-any

const switchEv = (on: boolean, at: string): Row => ({ event_type: "ai_auto_send_switched", created_at: at, details: { on } });
function seed(n: number, extra: Row[] = []) {
  const drafts: Row[] = []; const jobs: Row[] = [{ id: "jq", job_number: "TEST-1", source: "qa_test", owner_id: "o1" }];
  for (let i = 0; i < n; i++) {
    drafts.push({ id: `d${i}`, job_id: `j${i}`, event_type: "email_ai_draft", created_at: `2026-10-${String(10 + i).padStart(2, "0")}`, details: { body: `Body ${i}`, auto_kind: "job_status" } });
    jobs.push({ id: `j${i}`, job_number: `HIV-${i}`, source: "web", owner_id: "o1" });
  }
  tables = { workflow_events: [...drafts, ...extra], jobs, owners: [{ id: "o1", full_name: "Sam Smith" }] };
  inserts.length = 0; failAll = false; isAdmin = true;
}

describe("autoSendOn", () => {
  test("no events → off", async () => { seed(0); expect(await autoSendOn()).toBe(false); });
  test("latest wins", async () => {
    seed(0, [switchEv(true, "2026-10-01"), switchEv(false, "2026-10-02")]); expect(await autoSendOn()).toBe(false);
    seed(0, [switchEv(false, "2026-10-01"), switchEv(true, "2026-10-02")]); expect(await autoSendOn()).toBe(true);
  });
  test("error → off", async () => { seed(0, [switchEv(true, "2026-10-01")]); failAll = true; expect(await autoSendOn()).toBe(false); });
});

describe("autoSendSamples", () => {
  test("latest 10, newest first, with owner first name, job number and state", async () => {
    seed(12, [
      { event_type: "email_ai_draft_sent", created_at: "x", details: { draft_event_id: "d11" } },
      { event_type: "email_ai_draft_edited", created_at: "x", details: { draft_event_id: "d10", body: "Edited ten" } },
      { event_type: "email_ai_draft_sent", created_at: "x", details: { draft_event_id: "d10" } },
      { event_type: "email_ai_draft_discarded", created_at: "x", details: { draft_event_id: "d9" } },
    ]);
    const s = await autoSendSamples();
    expect(s).toHaveLength(10);
    expect(s[0]).toMatchObject({ eventId: "d11", ownerFirstName: "Sam", jobNumber: "HIV-11", state: "sent_as_is", kind: "job_status" });
    expect(s[1]).toMatchObject({ eventId: "d10", body: "Edited ten", state: "sent_edited" });
    expect(s[2]).toMatchObject({ eventId: "d9", state: "discarded" });
    expect(s[3]!.state).toBe("waiting");
  });
  test("excludes QA/TEST jobs and non-auto kinds", async () => {
    seed(2, [
      { id: "dq", job_id: "jq", event_type: "email_ai_draft", created_at: "2026-11-01", details: { body: "qa", auto_kind: "job_status" } },
      { id: "do", job_id: "j0", event_type: "email_ai_draft", created_at: "2026-11-02", details: { body: "other", auto_kind: "other" } },
      { id: "dn", job_id: "j0", event_type: "email_ai_draft", created_at: "2026-11-03", details: { body: "old", kind: "simple" } },
    ]);
    expect((await autoSendSamples()).map((s) => s.eventId).sort()).toEqual(["d0", "d1"]);
  });
});

describe("switchAutoSend", () => {
  test("turning on with fewer than 10 samples is refused", async () => {
    seed(9);
    await expect(switchAutoSend(true, "u1")).rejects.toThrow("Not enough samples yet");
    expect(inserts).toHaveLength(0);
  });
  test("turning on with 10 saves an internal job-less event; turning off always works", async () => {
    seed(10);
    await switchAutoSend(true, "u1");
    expect(inserts[0]).toMatchObject({ table: "workflow_events", event_type: "ai_auto_send_switched", job_id: null, internal: true, actor_id: "u1", details: { on: true } });
    expect(await autoSendOn()).toBe(true);
    seed(0);
    await switchAutoSend(false, "u1");
    expect(inserts[0]!["details"]).toEqual({ on: false });
  });
});

describe("paging and job spread", () => {
  test("150 newer QA drafts do not bury 12 real ones", async () => {
    seed(12);
    for (let i = 0; i < 150; i++) tables["workflow_events"]!.push({ id: `q${i}`, job_id: "jq", event_type: "email_ai_draft", created_at: `2026-12-01T${String(i).padStart(4, "0")}`, details: { body: "qa", auto_kind: "job_status" } });
    expect(await autoSendSamples()).toHaveLength(10);
    await switchAutoSend(true, "u1");
    expect(inserts).toHaveLength(1);
  });
});

describe("server functions", () => {
  test("both require an admin", async () => {
    seed(10); isAdmin = false;
    await expect(call(fns.getAutoSendState)).rejects.toThrow();
    await expect(call(fns.switchAutoSend, { on: false })).rejects.toThrow();
    expect(inserts).toHaveLength(0);
    isAdmin = true;
    expect((await call(fns.getAutoSendState)).samples).toHaveLength(10);
    expect(await call(fns.switchAutoSend, { on: true })).toEqual({ on: true });
  });
});

describe("page source", () => {
  const src = readFileSync("src/routes/_authenticated/admin.ai-answers.tsx", "utf8");
  test("turn-on button only with enough samples, after a confirm", () => {
    expect(src).toContain("samples.length >= needed");
    expect(src).toMatch(/window\.confirm\("Turn on\? Simple replies will send without you\."\)/);
    expect(src.indexOf("samples.length >= needed")).toBeLessThan(src.indexOf("Turn on auto-send"));
    expect(src).toContain("sample replies to check ({samples.length} so far)");
  });
  test("turn off is shown while on, no confirm; buttons disable while saving", () => {
    expect(src).toContain("Auto-send is ON");
    expect(src).toMatch(/q\.data\.on \? \(\s*<div><Btn tone="secondary" disabled=\{saving\} onClick=\{\(\) => void change\(false\)\}>/);
    expect(src.match(/disabled=\{saving\}/g)!.length).toBe(2);
  });
});

describe("widened complaint words", () => {
  test("each blocks", () => {
    for (const w of ["lawyer", "lawyers", "solicitors", "disgrace", "disgraceful", "terrible", "terribly"]) expect(COMPLAINT_WORDS.test(`this is ${w} now`)).toBe(true);
    expect(COMPLAINT_WORDS.test("Thanks, where is my job up to?")).toBe(false);
  });
});

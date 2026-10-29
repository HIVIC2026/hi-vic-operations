// AI replies step 3, task 1: Jo's recent replies as style examples. Own file because it mocks the database client.
import { afterAll, describe, expect, mock, test } from "bun:test";

const realClient = { ...(await import("../src/integrations/supabase/client.server")) };

type Row = Record<string, unknown>;
const world = { tables: {} as Record<string, Row[]>, fail: false, calls: [] as string[] };
const q = (table: string) => {
  world.calls.push(table);
  const b: Record<string, unknown> = {};
  const eqs: [string, unknown][] = [];
  for (const f of ["select", "neq", "in", "or", "like", "order", "limit", "is", "lt"]) b[f] = () => b;
  b["eq"] = (c: string, v: unknown) => { eqs.push([c, v]); return b; };
  b["then"] = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    (world.fail ? Promise.reject(new Error("db down")) : Promise.resolve({ data: (world.tables[table] ?? []).filter((r) => eqs.every(([c, v]) => c === "channel" || r[c] === v)), error: null })).then(res, rej);
  return b;
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q } }));
afterAll(() => { mock.module("@/integrations/supabase/client.server", () => realClient); });

const { pickStyleExamples, scrubExample } = await import("../src/lib/ai-style.core");
const { loadStyleExamples } = await import("../src/lib/ai-style.server");

const ex = (n: number, theirEmail: string) => ({ theirEmail, reply: `r${n}`, at: `2026-10-${String(10 + n).padStart(2, "0")}T00:00:00Z` });

describe("pickStyleExamples", () => {
  test("prefers topic overlap, then newest, max 8", () => {
    const rows = [ex(1, "ceiling insulation price"), ex(2, "hello there"), ex(3, "insulation rebate price question"), ex(4, "nothing")];
    const out = pickStyleExamples(rows, ["insulation", "rebate", "price"], 2);
    expect(out.map((r) => r.reply)).toEqual(["r3", "r1"]);
    const many = Array.from({ length: 12 }, (_, i) => ex(i + 1, "same words here"));
    const picked = pickStyleExamples(many, ["words"]);
    expect(picked).toHaveLength(8);
    expect(picked[0]!.reply).toBe("r12");
  });
  test("ignores short and stopwords", () => {
    const rows = [ex(1, "this with have"), ex(2, "gap")];
    const out = pickStyleExamples(rows, ["this", "with", "gap"]);
    expect(out.map((r) => r.reply)).toEqual(["r2", "r1"]);
  });
});

describe("scrubExample", () => {
  const owner = { name: "Mohamed Ali" };
  test("greeting name, names, links, emails, phones, addresses", () => {
    const s = scrubExample("Hi Mohamed,\n\nThanks Ali. See https://x.com.au/a?b=1 or mail mo@x.com, ring 0412 345 678 or 03 9123 4567. We'll come to 12 Smith Street on Monday.\n\nCheers", owner);
    expect(s).toContain("Hi <name>,");
    expect(s).toContain("Thanks <name>.");
    expect(s).toContain("<link>");
    expect(s).toContain("<email>");
    expect(s.match(/<phone>/g)).toHaveLength(2);
    expect(s).toContain("<address> on Monday");
    expect(s).not.toMatch(/Mohamed|smith|0412|x\.com/i);
  });
  test("greetings, sign-offs, phone, address shapes", () => {
    const o = {};
    expect(scrubExample("Dear Mohammed,\n\nok", o)).toContain("Dear <name>,");
    expect(scrubExample("G'day Mo,\n\nok", o)).toContain("G'day <name>,");
    expect(scrubExample("Good morning Sam,\nok", o)).toContain("Good morning <name>,");
    expect(scrubExample("ok\n\nCheers Mo", o)).toBe("ok\n\nCheers <name>");
    expect(scrubExample("ok\nCheers,\nMo", o)).toBe("ok\nCheers,\n<name>");
    expect(scrubExample("Cheers, the Home Insulation Victoria team", o)).toBe("Cheers, the Home Insulation Victoria team");
    expect(scrubExample("ring (03) 9123 4567 now", o)).toBe("ring <phone> now");
    const a = scrubExample("At Unit 4/22 Smith St, Brighton 3186 and 5 The Ridgeway, Preston 3072 ok", o);
    expect(a).toBe("At <address> and <address> ok");
  });
  test("known job details are removed exactly", () => {
    const s = scrubExample("Hi Jo, your place in Fitzroy North 3068 at 7 Oak Hill is fine, Li.", { name: "Jo Li", address: "7 Oak Hill", suburb: "Fitzroy North", postcode: "3068" });
    expect(s).toBe("Hi <name>, your place in <suburb> <postcode> at <address> is fine, <name>.");
  });
  test("normal text is untouched", () => {
    const t = "A 10% deposit, R7.0 batts, 90 m\u00b2 at $3,008 within 30 days. Booked for 5 November, ok. Cheers, the Home Insulation Victoria team";
    expect(scrubExample(t, {})).toBe(t);
  });
  test("other greeting name still replaced, long text trimmed", () => {
    expect(scrubExample("Hey Priya!\n\nok", {})).toBe("Hey <name>!\n\nok");
    expect(scrubExample("a".repeat(2000), {})).toHaveLength(1200);
  });
});

describe("loadStyleExamples", () => {
  const reset = (t: Record<string, Row[]>, fail = false) => { world.tables = t; world.fail = fail; world.calls = []; };
  test("pairs, scrubs, drops QA/TEST and the current job, 3 round trips", async () => {
    reset({
      job_communications: [
        { job_id: "j2", direction: "outbound", body: "Hi Sam,\n\nThe rebate is fine.", created_at: "2026-10-20T00:00:00Z" },
        { job_id: "jq", direction: "outbound", body: "qa", created_at: "2026-10-19T00:00:00Z" },
        { job_id: "jt", direction: "outbound", body: "t", created_at: "2026-10-19T00:00:00Z" },
        { job_id: "j3", direction: "outbound", body: "no inbound", created_at: "2026-10-18T00:00:00Z" },
        { job_id: "j2", direction: "inbound", body: "Is the rebate real? Sam", created_at: "2026-10-19T00:00:00Z" },
        { job_id: "j2", direction: "inbound", body: "too late", created_at: "2026-10-21T00:00:00Z" },
        { job_id: "jq", direction: "inbound", body: "x", created_at: "2026-10-18T00:00:00Z" },
        { job_id: "jt", direction: "inbound", body: "x", created_at: "2026-10-18T00:00:00Z" },
      ],
      jobs: [
        { id: "j2", job_number: "HV-1", source: "website", owners: { full_name: "Sam Lee" }, properties: { address_line: "1 Zed Way", suburb: "Zeta", postcode: "3000" } },
        { id: "jq", job_number: "HV-2", source: "qa_test", owners: { full_name: "Q" } },
        { id: "jt", job_number: "hv-test-3", source: "website", owners: { full_name: "T" } },
        { id: "j3", job_number: "HV-4", source: "website", owners: { full_name: "N" } },
      ],
    });
    const out = await loadStyleExamples("cur", "owner@x.com wants the rebate");
    expect(out).toEqual([{ theirEmail: "Is the rebate real? <name>", reply: "Hi <name>,\n\nThe rebate is fine.", at: "2026-10-20T00:00:00Z" }]);
    expect(world.calls.length).toBeLessThanOrEqual(3);
  });
  test("any error gives []", async () => {
    reset({}, true);
    const spy = mock(() => {}); const orig = console.error; console.error = spy;
    try { expect(await loadStyleExamples("cur", "a")).toEqual([]); } finally { console.error = orig; }
    expect(spy).toHaveBeenCalled();
  });
});

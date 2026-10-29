// AI replies step 3, task 1: Jo's recent replies as style examples. Own file because it mocks the database client.
import { afterAll, describe, expect, mock, test } from "bun:test";

const realClient = { ...(await import("../src/integrations/supabase/client.server")) };

type Row = Record<string, unknown>;
const world = { tables: {} as Record<string, Row[]>, fail: false, calls: [] as string[], ops: [] as { table: string; ops: [string, unknown[]][] }[] };
const q = (table: string) => {
  world.calls.push(table);
  const b: Record<string, unknown> = {};
  const eqs: [string, unknown][] = [];
  const isNull: string[] = [];
  const rec = { table, ops: [] as [string, unknown[]][] };
  world.ops.push(rec);
  for (const f of ["select", "neq", "in", "or", "like", "order", "limit", "lt", "lte"]) b[f] = (...a: unknown[]) => { rec.ops.push([f, a]); return b; };
  b["eq"] = (c: string, v: unknown) => { rec.ops.push(["eq", [c, v]]); eqs.push([c, v]); return b; };
  b["is"] = (c: string, v: unknown) => { rec.ops.push(["is", [c, v]]); if (v === null) isNull.push(c); return b; };
  b["then"] = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    (world.fail ? Promise.reject(new Error("db down")) : Promise.resolve({ data: (world.tables[table] ?? []).filter((r) => eqs.every(([c, v]) => c === "channel" || r[c] === v) && isNull.every((c) => r[c] == null)), error: null })).then(res, rej);
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
  test("address tails: suburb, state, postcode", () => {
    expect(scrubExample("At 22 Smith Street, Brighton VIC 3186 ok", {})).toBe("At <address> ok");
    expect(scrubExample("At 12 Wattle Gr Bentleigh East 3165 ok", {})).toBe("At <address> ok");
    expect(scrubExample("Lives in Preston VIC 3072 ok", {})).toBe("Lives in Preston <postcode> ok");
    expect(scrubExample("Lives in Preston 3072 ok", {})).toBe("Lives in Preston <postcode> ok");
  });
  test("known address prefix is swallowed", () => {
    expect(scrubExample("At Unit 4/22 Smith St ok and 4/22 Smith St too", { address: "22 Smith St" })).toBe("At <address> ok and <address> too");
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
  const reset = (t: Record<string, Row[]>, fail = false) => { world.tables = t; world.fail = fail; world.calls = []; world.ops = []; };
  test("pairs, scrubs, drops QA/TEST and the current job, 3 round trips", async () => {
    reset({
      job_communications: [
        { job_id: "j2", direction: "outbound", visibility: "customer", body: "Hi Sam,\n\nThe rebate is fine.", created_at: "2026-10-20T00:00:00Z" },
        { job_id: "jq", direction: "outbound", visibility: "customer", body: "qa", created_at: "2026-10-19T00:00:00Z" },
        { job_id: "jt", direction: "outbound", visibility: "customer", body: "t", created_at: "2026-10-19T00:00:00Z" },
        { job_id: "j3", direction: "outbound", visibility: "customer", body: "no inbound", created_at: "2026-10-18T00:00:00Z" },
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

// Final review fixes (I1, I2a, I3, M1).
describe("final review: scrubExample", () => {
  test("I2a: sign-off name after a blank line is replaced", () => {
    expect(scrubExample("ok\n\nCheers,\n\nMo", {})).toBe("ok\n\nCheers,\n\n<name>");
    expect(scrubExample("ok\nKind regards,\n\n\nPriya Nair", {})).toBe("ok\nKind regards,\n\n\n<name>");
  });
  test("I1: job numbers become <job>", () => {
    expect(scrubExample("Your job HV-1234 and hv-55 are fine.", {})).toBe("Your job <job> and <job> are fine.");
  });
  test("M1: only capitalised name parts are replaced", () => {
    const s = scrubExample("Hi Will,\n\nWe will do our best in May. You may book now. Cheers, May", { name: "Will May Best" });
    expect(s).toBe("Hi <name>,\n\nWe will do our best in <name>. You may book now. Cheers, <name>");
  });
});

const OUTLOOK_REPLY = [
  "Hi Sam,",
  "",
  "Thanks for asking. Yes, the rebate comes off upfront :)",
  "",
  "Kind regards,",
  "",
  "Jo",
  "Home Insulation Victoria",
  "info@homeinsulationvictoria.com.au",
  "",
  "________________________________",
  "From: Mark Jones <mark@example.com>",
  "Sent: Monday, 20 October 2026 9:14 AM",
  "To: Home Insulation Victoria <info@homeinsulationvictoria.com.au>",
  "Subject: Re: HV-2001 quote",
  "",
  "Hi Jo, Priya Nair said Dave from Sparky Bros quoted $1,240 for HV-2001. Mark",
].join("\n");
const OUTLOOK_THEIRS = [
  "Is the rebate taken off upfront?",
  "",
  "On Sun, 19 Oct 2026 at 8:00 am, Home Insulation Victoria wrote:",
  "> Hi Mark, Priya Nair and Dave from Sparky Bros, $1,240 for HV-2001.",
].join("\n");

describe("final review: loadStyleExamples", () => {
  const reset = (t: Record<string, Row[]>, fail = false) => { world.tables = t; world.fail = fail; world.calls = []; world.ops = []; };
  const job = (id: string, extra: Row = {}) => ({ id, job_number: "HV-9", source: "website", owners: { full_name: "Sam Lee" }, properties: null, ...extra });
  test("I1: Outlook chain and Jo's signature never reach the example", async () => {
    reset({
      job_communications: [
        { job_id: "j2", direction: "outbound", visibility: "customer", body: OUTLOOK_REPLY, created_at: "2026-10-20T10:00:00Z" },
        { job_id: "j2", direction: "inbound", body: OUTLOOK_THEIRS, created_at: "2026-10-20T08:00:00Z" },
      ],
      jobs: [job("j2")],
    });
    const out = await loadStyleExamples("cur", "rebate upfront");
    expect(out).toHaveLength(1);
    const all = `${out[0]!.theirEmail}\n${out[0]!.reply}`;
    for (const bad of ["Mark", "Priya", "Nair", "Dave", "Sparky", "$1,240", "HV-2001", "Kind regards", "Jo\n", "Home Insulation Victoria", "From:", "Sent:", "To:", "Subject:", "info@"]) expect(all).not.toContain(bad);
    expect(out[0]!.reply).toBe("Hi <name>,\n\nThanks for asking. Yes, the rebate comes off upfront :)");
    expect(out[0]!.theirEmail).toBe("Is the rebate taken off upfront?");
  });
  test("I3: inbound read is bounded, narrow, and capped at 300", async () => {
    reset({
      job_communications: [
        { job_id: "j2", direction: "outbound", visibility: "customer", body: "Hi Sam,\n\nok", created_at: "2026-10-20T10:00:00Z" },
        { job_id: "j2", direction: "inbound", body: "q", created_at: "2026-10-20T08:00:00Z" },
      ],
      jobs: [job("j2")],
    });
    await loadStyleExamples("cur", "x");
    const inbound = world.ops.find((o) => o.table === "job_communications" && o.ops.some(([f, a]) => f === "eq" && a[0] === "direction" && a[1] === "inbound"))!;
    const sel = String(inbound.ops.find(([f]) => f === "select")![1][0]);
    expect(sel).not.toContain("*");
    expect(sel).toContain("received_at");
    expect(inbound.ops.some(([f, a]) => (f === "lt" || f === "lte") && a[0] === "created_at")).toBe(true);
    expect(inbound.ops.some(([f, a]) => f === "limit" && a[0] === 300)).toBe(true);
    const outbound = world.ops.find((o) => o.table === "job_communications" && o.ops.some(([f, a]) => f === "eq" && a[1] === "outbound"))!;
    expect(outbound.ops.some(([f, a]) => f === "eq" && a[0] === "visibility" && a[1] === "customer")).toBe(true);
    expect(String(outbound.ops.find(([f]) => f === "select")![1][0])).toContain("sent_at");
    const jobsQ = world.ops.find((o) => o.table === "jobs")!;
    expect(jobsQ.ops.some(([f, a]) => f === "is" && a[0] === "deleted_at" && a[1] === null)).toBe(true);
  });
  test("I3: internal outbound rows and deleted jobs are skipped", async () => {
    reset({
      job_communications: [
        { job_id: "j2", direction: "outbound", visibility: "internal", body: "Hi Sam,\n\ninternal", created_at: "2026-10-20T10:00:00Z" },
        { job_id: "j3", direction: "outbound", visibility: "customer", body: "Hi Sam,\n\ndeleted", created_at: "2026-10-20T10:00:00Z" },
        { job_id: "j2", direction: "inbound", body: "q", created_at: "2026-10-20T08:00:00Z" },
        { job_id: "j3", direction: "inbound", body: "q", created_at: "2026-10-20T08:00:00Z" },
      ],
      jobs: [job("j2"), job("j3", { deleted_at: "2026-10-25T00:00:00Z" })],
    });
    expect(await loadStyleExamples("cur", "x")).toEqual([]);
  });
  test("I3: pairs by received_at/sent_at when present", async () => {
    reset({
      job_communications: [
        // Synced at 10:00, sent at 09:00.
        { job_id: "j2", direction: "outbound", visibility: "customer", body: "Hi Sam,\n\nreply", created_at: "2026-10-20T10:00:00Z", sent_at: "2026-10-20T09:00:00Z" },
        { job_id: "j2", direction: "inbound", body: "after the reply", created_at: "2026-10-20T09:58:00Z", received_at: "2026-10-20T09:30:00Z" },
        { job_id: "j2", direction: "inbound", body: "the one answered", created_at: "2026-10-20T09:55:00Z", received_at: "2026-10-20T08:30:00Z" },
      ],
      jobs: [job("j2")],
    });
    const out = await loadStyleExamples("cur", "x");
    expect(out.map((r) => r.theirEmail)).toEqual(["the one answered"]);
    expect(out[0]!.at).toBe("2026-10-20T09:00:00Z");
  });
});

// AI replies step 4, task 4: show what the AI sent (job drafts, Emails tab, daily brief) and the manual-send race guard.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

const realClient = { ...(await import("../src/integrations/supabase/client.server")) };
const realRelease = { ...(await import("../src/lib/spot-release.server")) };
const realOutlook = { ...(await import("../src/lib/outlook-sync.server")) };
const realOwnerSend = { ...(await import("../src/lib/owner-email-send.server")) };
const realComms = { ...(await import("../src/lib/comms.server")) };
const realAi = { ...(await import("ai")) };
const realOpenAi = { ...(await import("@ai-sdk/openai")) };
process.env["LOVABLE_API_KEY"] ??= "test-key";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const world = { tables: {} as Record<string, Row[]>, clock: "", sends: [] as Row[], sendResult: "sent" as string, nextId: 1, release: [] as string[], aiText: "" };

function fromTable(table: string) {
  let filters: ((r: Row) => boolean)[] = [];
  let mode: "select" | "insert" | "update" = "select";
  let payload: Row | Row[] | null = null;
  let orderBy: { c: string; asc: boolean } | null = null;
  let lim = Infinity; let skip = 0;
  const get = (r: Row, path: string) => {
    if (!path.includes("->")) return r[path];
    const parts = path.split(/->>?/);
    let v: any = r[parts[0]!]; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const p of parts.slice(1)) v = v?.[p];
    return v == null ? v : path.includes("->>") ? String(v) : v;
  };
  const rowsNow = () => {
    let rows = (world.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (orderBy) { const { c, asc } = orderBy; rows = [...rows].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1)); }
    return rows.slice(skip, skip + lim);
  };
  const run = () => {
    if (mode === "insert") {
      const list = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({ id: `id${world.nextId++}`, created_at: world.clock, ...r }));
      (world.tables[table] ??= []).push(...list);
      return { data: list, error: null };
    }
    if (mode === "update") { const rows = rowsNow(); for (const r of rows) Object.assign(r, payload); return { data: rows, error: null }; }
    return { data: rowsNow(), error: null };
  };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    insert: (v: Row | Row[]) => { mode = "insert"; payload = v; return q; },
    update: (v: Row) => { mode = "update"; payload = v; return q; },
    eq: (c: string, v: unknown) => { filters.push((r) => get(r, c) === v); return q; },
    neq: (c: string, v: unknown) => { filters.push((r) => get(r, c) !== v); return q; },
    in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(get(r, c))); return q; },
    gt: (c: string, v: string) => { filters.push((r) => get(r, c) != null && get(r, c) > v); return q; },
    gte: (c: string, v: string) => { filters.push((r) => get(r, c) != null && get(r, c) >= v); return q; },
    lt: (c: string, v: string) => { filters.push((r) => get(r, c) != null && get(r, c) < v); return q; },
    lte: (c: string, v: string) => { filters.push((r) => get(r, c) != null && get(r, c) <= v); return q; },
    not: () => q, is: () => q, or: () => q, ilike: () => q,
    contains: (c: string, v: Row) => { filters.push((r) => Object.entries(v).every(([k, x]) => r[c]?.[k] === x)); return q; },
    order: (c: string, o?: { ascending?: boolean }) => { orderBy = { c, asc: o?.ascending !== false }; return q; },
    limit: (n: number) => { lim = n; return q; },
    range: (a: number, b: number) => { skip = a; lim = b - a + 1; return q; },
    maybeSingle: async () => { const r = run(); return { data: (r.data as Row[])[0] ?? null, error: null }; },
    single: async () => { const r = run(); return { data: (r.data as Row[])[0] ?? null, error: null }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  });
  return q;
}

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: fromTable } }));
// Release state per read (queue), then "confirmed".
mock.module("../src/lib/spot-release.server", () => ({ spotReleaseStates: async (ids: string[]) => { const st = world.release.shift() ?? "confirmed"; return new Map(ids.map((i) => [i, { state: st }])); } }));
mock.module("ai", () => ({ streamText: () => ({ text: Promise.resolve(world.aiText) }) }));
mock.module("@ai-sdk/openai", () => ({ createOpenAI: () => ({ responses: () => ({}) }) }));
mock.module("../src/lib/outlook-sync.server", () => ({ archiveOutlookMessage: async () => "skipped" }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => undefined }));
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: Row) => {
    if (world.sendResult !== "sent") return world.sendResult;
    // The real sender's once-only key: the same key never sends twice.
    if (world.sends.some((s) => s["key"] === p["key"])) return "already attempted — not resent";
    world.sends.push(p); return "sent";
  },
}));
afterAll(() => {
  mock.module("@/integrations/supabase/client.server", () => realClient);
  mock.module("../src/lib/spot-release.server", () => realRelease);
  mock.module("../src/lib/outlook-sync.server", () => realOutlook);
  mock.module("../src/lib/owner-email-send.server", () => realOwnerSend);
  mock.module("../src/lib/comms.server", () => realComms);
  mock.module("ai", () => realAi);
  mock.module("@ai-sdk/openai", () => realOpenAi);
});

const { autoSendDraft } = await import("../src/lib/ai-auto-send.server");
const { draftAutoState, autoNoteText, aiDraftKey } = await import("../src/lib/ai-email-reply.core");
const { aiAutoSentCount, aiAutoSentLine, buildDailyBrief } = await import("../src/lib/daily-brief.core");
const { buildEmailsTab } = await import("../src/lib/emails-tab.core");

const AT_10AM = "2026-10-29T23:00:00.000Z";
const BODY = "Hi Sam,\n\nYour job is with the installer now. You can see where it's up to on your job page.\n\nCheers, the Home Insulation Victoria team";
const ASK = "Hi, where's my job up to?";

describe("decision / sent mapping", () => {
  test("a waiting draft shows its newest decision", () => {
    expect(draftAutoState({ sentVia: undefined, decision: { decision: "at7am", reason: "Waiting for 7am" } })).toEqual({ auto: { decision: "at7am", reason: "Waiting for 7am" }, sentByAi: false });
  });
  test("sent wins over any decision, and via ai is marked", () => {
    expect(draftAutoState({ sentVia: "ai", decision: { decision: "no", reason: "Auto-send failed: x" } })).toEqual({ sentByAi: true });
    expect(draftAutoState({ sentVia: "office", decision: { decision: "no", reason: "Needs you" } })).toEqual({ sentByAi: false });
  });
  test("discarded or no decision: nothing", () => {
    expect(draftAutoState({ sentVia: undefined, discarded: true, decision: { decision: "no", reason: "x" } })).toEqual({ sentByAi: false });
    expect(draftAutoState({ sentVia: undefined })).toEqual({ sentByAi: false });
  });
  test("note wording", () => {
    expect(autoNoteText({ decision: "at7am", reason: "Waiting for 7am" })).toBe("Waiting for 7am — will send itself");
    expect(autoNoteText({ decision: "no", reason: "Auto-send failed: Outlook down" })).toBe("Auto-send failed: Outlook down");
    expect(autoNoteText({ decision: "no", reason: "Needs your answer" })).toBe("Didn't send itself: Needs your answer");
    expect(autoNoteText({ decision: "now", reason: "Sends itself" })).toBeNull();
    expect(autoNoteText(undefined)).toBeNull();
  });
});

describe("Emails tab card", () => {
  const change = { eventId: "r1", jobId: "j1", jobNumber: "HIV1", at: "2026-10-30T01:00:00Z", intent: "reply", messageId: "m1", from: "sam@x.au", subject: "Hi", label: null };
  const base = { changes: [change], unmatched: [], noJobDrafts: new Map(), inboundByMessage: new Map(), ownerNameByJob: new Map(), autoRepliedSenders: new Set<string>() };
  test("open draft carries its decision", () => {
    const t = buildEmailsTab({ ...base, jobDrafts: new Map([["j1:m1", { eventId: "d1", body: "x", auto: { decision: "at7am" as const, reason: "Waiting for 7am" } }]]), closedJobDrafts: new Set() });
    expect(t.withJob[0]).toMatchObject({ auto: { decision: "at7am" }, sentByAi: false });
  });
  test("AI-sent closed draft is marked, with no decision shown", () => {
    const t = buildEmailsTab({ ...base, jobDrafts: new Map(), closedJobDrafts: new Set(["j1:m1"]), aiSentJobDrafts: new Set(["j1:m1"]) });
    expect(t.withJob[0]).toMatchObject({ sentByAi: true });
    expect(t.withJob[0]!.auto).toBeUndefined();
  });
  test("an office-sent closed draft is not marked", () => {
    const t = buildEmailsTab({ ...base, jobDrafts: new Map(), closedJobDrafts: new Set(["j1:m1"]) });
    expect(t.withJob[0]!.sentByAi).toBe(false);
  });
});

describe("screens", () => {
  const read = (p: string) => readFileSync(new URL(`../src/components/portal/${p}`, import.meta.url), "utf8");
  test("job drafts show the grey note and a Sent by AI list", () => {
    const s = read("AiReplyDrafts.tsx");
    expect(s).toContain("autoNoteText(d.auto)");
    expect(s).toContain("Sent by AI");
    expect(s).toContain("d.sentByAi");
  });
  test("Emails tab shows the grey note and Sent by AI", () => {
    const s = read("EmailsScreen.tsx");
    expect(s).toContain("autoNoteText(c.auto)");
    expect(s).toContain("Sent by AI");
    expect(s).toContain("c.sentByAi");
  });
});

describe("daily brief count", () => {
  const from = "2026-10-29T13:00:00.000Z", to = "2026-10-30T13:00:00.000Z";
  const src = new Map<string, string | null>([["j1", "website"], ["jq", "qa_test"]]);
  const ev = (job_id: string, created_at: string, via = "ai") => ({ job_id, created_at, details: { via } });
  test("counts yesterday's AI sends on real jobs only", () => {
    const n = aiAutoSentCount([ev("j1", "2026-10-30T01:00:00Z"), ev("j1", "2026-10-30T02:00:00Z"), ev("jq", "2026-10-30T01:00:00Z"), ev("j1", "2026-10-29T12:59:00Z"), ev("j1", "2026-10-30T13:00:00Z"), ev("j1", "2026-10-30T01:00:00Z", "office")], src, from, to);
    expect(n).toBe(2);
  });
  test("line is omitted at 0", () => {
    expect(aiAutoSentLine(0)).toBeNull();
    expect(aiAutoSentLine(3)).toBe("AI replies sent by themselves: 3");
  });
  test("brief carries the number (default 0)", () => {
    const y = { day: "2026-10-29", enquiries: 0, bookings: 0, installs: 0, veecsSubmitted: 0, veecsRegistered: 0 };
    expect(buildDailyBrief({ date: "2026-10-30", needs: [], apQueue: 0, atRisk: [], yesterday: y, aiAutoSent: 4 }).aiAutoSent).toBe(4);
    expect(buildDailyBrief({ date: "2026-10-30", needs: [], apQueue: 0, atRisk: [], yesterday: y }).aiAutoSent).toBe(0);
  });
});

function reset() {
  world.tables = {
    jobs: [{ id: "j1", source: "website", owner_id: "o1", channel: "hivic_sourced", stage: "ready_check_scheduled", estimated_area_m2: null, deleted_at: null }],
    owners: [{ id: "o1", email: "sam@x.au", full_name: "Sam Smith" }],
    job_communications: [{ job_id: "j1", channel: "email", direction: "inbound", provider_message_id: "m1", body: ASK, received_at: AT_10AM, created_at: AT_10AM }],
    customer_email_optouts: [], lead_campaign_responses: [], customer_email_sends: [],
    workflow_events: [
      { id: "sw1", job_id: null, event_type: "ai_auto_send_switched", created_at: "2026-10-01T00:00:00.000Z", details: { on: true } },
      { id: "d1", job_id: "j1", event_type: "email_ai_draft", created_at: AT_10AM, details: { message_id: "m1", to: "sam@x.au", subject: "Re: Hi", body: BODY, kind: "simple", auto_kind: "job_status", job_stage: "ready_check_scheduled", received_at: AT_10AM } },
    ],
  };
  world.sends = []; world.sendResult = "sent"; world.nextId = 1; world.release = []; world.clock = AT_10AM;
}
const lastDecision = () => world.tables["workflow_events"]!.filter((e) => e["event_type"] === "email_ai_auto_decision").at(-1)?.["details"];

describe("race with Jo pressing Send", () => {
  beforeEach(reset);
  test("her manual send record exists: auto-send skips with 'You've already replied'", async () => {
    world.tables["customer_email_sends"]!.push({ idempotency_key: `${aiDraftKey("m1")}:send:d1`, status: "sent" });
    const r = await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: ASK });
    expect(r?.sent).toBe(false);
    expect(world.sends.length).toBe(0);
    expect(lastDecision()).toMatchObject({ decision: "no", reason: "You've already replied" });
  });
  test("a failed manual attempt doesn't block; no record sends as normal", async () => {
    world.tables["customer_email_sends"]!.push({ idempotency_key: `${aiDraftKey("m1")}:send:d1`, status: "failed" });
    expect((await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: ASK }))?.sent).toBe(true);
    expect(world.sends.length).toBe(1);
  });
});

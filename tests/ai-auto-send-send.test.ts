// AI replies step 4, task 3: eligible AI drafts send themselves; quiet-hours ones wait for the 7am sweep.
// Own file because it mocks modules. In-memory fake database, mocked sender — nothing live.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

const realClient = { ...(await import("../src/integrations/supabase/client.server")) };
const realRelease = { ...(await import("../src/lib/spot-release.server")) };
const realOutlook = { ...(await import("../src/lib/outlook-sync.server")) };
const realOwnerSend = { ...(await import("../src/lib/owner-email-send.server")) };
const realComms = { ...(await import("../src/lib/comms.server")) };

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const world = { tables: {} as Record<string, Row[]>, clock: "", sends: [] as Row[], sendResult: "sent" as string, nextId: 1 };

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
mock.module("../src/lib/spot-release.server", () => ({ spotReleaseStates: async (ids: string[]) => new Map(ids.map((i) => [i, { state: "confirmed" }])) }));
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
});

const { autoSendDraft, sweepHeldAutoReplies, autoSendSamples } = await import("../src/lib/ai-auto-send.server");

// Melbourne is UTC+11 (daylight saving) on these dates.
const AT_10AM = "2026-10-29T23:00:00.000Z"; // 10:00am Fri 30 Oct
const AT_9PM = "2026-10-30T10:00:00.000Z"; // 9:00pm Fri 30 Oct
const AT_705AM = "2026-10-30T20:05:00.000Z"; // 7:05am Sat 31 Oct
const BODY = "Hi Sam,\n\nYour job is with the installer now. You can see where it's up to on your job page.\n\nCheers, the Home Insulation Victoria team";
const ASK = "Hi, where's my job up to?";

function reset(o: { switchOn?: boolean } = {}) {
  world.tables = {
    jobs: [{ id: "j1", source: "website", owner_id: "o1", channel: "hivic_sourced", stage: "ready_check_scheduled", estimated_area_m2: null, deleted_at: null }],
    owners: [{ id: "o1", email: "sam@x.au", full_name: "Sam Smith" }],
    job_communications: [],
    customer_email_optouts: [],
    lead_campaign_responses: [],
    customer_email_sends: [],
    workflow_events: o.switchOn === false ? [] : [{ id: "sw1", job_id: null, event_type: "ai_auto_send_switched", created_at: "2026-10-01T00:00:00.000Z", details: { on: true } }],
  };
  world.sends = []; world.sendResult = "sent"; world.nextId = 1;
}
/** An inbound owner email stored on the job plus its saved AI draft (as writeAiReplyDraft leaves it). */
function addDraft(id: string, at: string, o: { msg?: string; text?: string; body?: string; kind?: string; extra?: Row } = {}) {
  const msg = o.msg ?? `m-${id}`;
  world.tables["job_communications"]!.push({ job_id: "j1", channel: "email", direction: "inbound", provider_message_id: msg, body: o.text ?? ASK, received_at: at, created_at: at });
  world.tables["workflow_events"]!.push({ id, job_id: "j1", event_type: "email_ai_draft", created_at: at,
    details: { message_id: msg, to: "sam@x.au", subject: "Re: Hi", body: o.body ?? BODY, kind: "simple", auto_kind: o.kind ?? "job_status", job_stage: "ready_check_scheduled", received_at: at, ...(o.extra ?? {}) } });
}
const events = (type: string) => world.tables["workflow_events"]!.filter((e) => e["event_type"] === type);
const decisions = (draft: string) => events("email_ai_auto_decision").filter((e) => e["details"]?.["draft_event_id"] === draft).map((e) => e["details"]);
const lastDecision = (draft: string) => decisions(draft).at(-1);

beforeEach(() => reset());

describe("send now", () => {
  test("an eligible draft in the day is sent once, marked Sent by AI", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM);
    const r = await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: ASK });
    expect(r?.send).toBe("now");
    expect(world.sends.length).toBe(1);
    const sent = events("email_ai_draft_sent");
    expect(sent.length).toBe(1);
    expect(sent[0]!["details"]["via"]).toBe("ai");
    expect(sent[0]!["actor_id"]).toBeNull();
    expect(String(sent[0]!["summary"])).toContain("Sent by AI");
    expect(lastDecision("d1")).toMatchObject({ decision: "now", kind: "job_status" });
    // Re-running never sends again.
    await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: ASK });
    await sweepHeldAutoReplies(new Date(AT_10AM));
    expect(world.sends.length).toBe(1);
    expect(events("email_ai_draft_sent").length).toBe(1);
  });
  test("switch off: nothing is ever sent, and the draft says why", async () => {
    reset({ switchOn: false });
    world.clock = AT_10AM; addDraft("d1", AT_10AM);
    await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: ASK });
    await sweepHeldAutoReplies(new Date(AT_705AM));
    expect(world.sends.length).toBe(0);
    expect(lastDecision("d1")).toMatchObject({ decision: "no", reason: "Auto-send is off" });
  });
  test("complaint wording in the owner's email keeps it a draft, whatever the AI called it", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM, { text: "Where's my job up to? I want a refund." });
    await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: "Where's my job up to? I want a refund." });
    expect(world.sends.length).toBe(0);
    expect(lastDecision("d1")).toMatchObject({ decision: "no", reason: "Owner sounds unhappy" });
  });
  test("the owner's email is read from the job when not passed in", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM, { text: "Where's my job up to? The installer left a mess." });
    await autoSendDraft("d1", { now: new Date(AT_10AM) });
    expect(world.sends.length).toBe(0);
    expect(lastDecision("d1")?.["reason"]).toBe("Owner sounds unhappy");
  });
  test("needs you / needs answer / actions / other kinds stay drafts", async () => {
    world.clock = AT_10AM;
    addDraft("a", AT_10AM, { extra: { needs_you: true } });
    addDraft("b", AT_10AM, { extra: { needs_answer: ["Solar?"] } });
    addDraft("c", AT_10AM, { extra: { actions: { installerNote: "Dog in yard" } } });
    addDraft("d", AT_10AM, { kind: "other" });
    for (const id of ["a", "b", "c", "d"]) await autoSendDraft(id, { now: new Date(AT_10AM), ownerText: ASK });
    expect(world.sends.length).toBe(0);
    expect(["a", "b", "c", "d"].map((id) => lastDecision(id)?.["decision"])).toEqual(["no", "no", "no", "no"]);
  });
  test("Jo's rule: the AI-draft wording checks run before sending ('fixes' blocks)", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM, { body: "Hi Sam,\n\nYour fixes are booked in.\n\nCheers, the Home Insulation Victoria team" });
    await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: ASK });
    expect(world.sends.length).toBe(0);
    expect(lastDecision("d1")).toMatchObject({ decision: "no", reason: "Has a rule problem" });
  });
  test("owner unsubscribed: stays a draft", async () => {
    world.tables["customer_email_optouts"]!.push({ job_id: "j1", opted_out_at: "2026-10-01T00:00:00.000Z" });
    world.clock = AT_10AM; addDraft("d1", AT_10AM);
    await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: ASK });
    expect(world.sends.length).toBe(0);
    expect(lastDecision("d1")?.["reason"]).toBe("Owner unsubscribed");
  });
  test("two owner emails within 30 minutes: only one auto-reply, the second waits as a draft", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM);
    await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: ASK });
    const later = "2026-10-29T23:10:00.000Z";
    world.clock = later; addDraft("d2", later);
    await autoSendDraft("d2", { now: new Date(later), ownerText: ASK });
    expect(world.sends.length).toBe(1);
    expect(lastDecision("d2")).toMatchObject({ decision: "no", reason: "Already replied by AI in the last 30 minutes" });
  });
  test("send fails (Outlook down): the draft stays for Jo, marked Auto-send failed", async () => {
    world.sendResult = "failed: Outlook couldn't send it";
    world.clock = AT_10AM; addDraft("d1", AT_10AM);
    await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: ASK });
    expect(events("email_ai_draft_sent").length).toBe(0);
    expect(events("email_ai_draft_discarded").length).toBe(0);
    expect(lastDecision("d1")?.["decision"]).toBe("no");
    expect(String(lastDecision("d1")?.["reason"])).toMatch(/^Auto-send failed: /);
  });
});

describe("quiet hours and the 7am sweep", () => {
  test("held at 9pm, not sent by the night sweep, sent once by the 7:05am sweep", async () => {
    world.clock = AT_9PM; addDraft("d1", AT_9PM);
    const r = await autoSendDraft("d1", { now: new Date(AT_9PM), ownerText: ASK });
    expect(r?.send).toBe("at7am");
    expect(lastDecision("d1")).toMatchObject({ decision: "at7am", reason: "Waiting for 7am" });
    await sweepHeldAutoReplies(new Date(AT_9PM));
    await sweepHeldAutoReplies(new Date("2026-10-30T19:50:00.000Z")); // 6:50am
    expect(world.sends.length).toBe(0);
    world.clock = AT_705AM;
    expect((await sweepHeldAutoReplies(new Date(AT_705AM))).sent).toBe(1);
    expect(world.sends.length).toBe(1);
    expect(events("email_ai_draft_sent")[0]!["details"]["via"]).toBe("ai");
    // The next tick does nothing more.
    world.clock = "2026-10-30T20:20:00.000Z";
    await sweepHeldAutoReplies(new Date("2026-10-30T20:20:00.000Z"));
    expect(world.sends.length).toBe(1);
  });
  test("switch turned off overnight: not sent at 7am", async () => {
    world.clock = AT_9PM; addDraft("d1", AT_9PM);
    await autoSendDraft("d1", { now: new Date(AT_9PM), ownerText: ASK });
    world.tables["workflow_events"]!.push({ id: "sw2", job_id: null, event_type: "ai_auto_send_switched", created_at: "2026-10-30T11:00:00.000Z", details: { on: false } });
    world.clock = AT_705AM; await sweepHeldAutoReplies(new Date(AT_705AM));
    expect(world.sends.length).toBe(0);
    expect(lastDecision("d1")).toMatchObject({ decision: "no", reason: "Auto-send is off" });
  });
  test("a newer email from the owner overnight: the held reply is not sent", async () => {
    world.clock = AT_9PM; addDraft("d1", AT_9PM);
    await autoSendDraft("d1", { now: new Date(AT_9PM), ownerText: ASK });
    world.tables["job_communications"]!.push({ job_id: "j1", channel: "email", direction: "inbound", provider_message_id: "m-late", body: "Also, can you call me?", received_at: "2026-10-30T12:00:00.000Z" });
    world.clock = AT_705AM; await sweepHeldAutoReplies(new Date(AT_705AM));
    expect(world.sends.length).toBe(0);
    expect(lastDecision("d1")?.["reason"]).toBe("Owner emailed again — check before sending");
  });
  test("already handled by Jo (sent, discarded or edited): the sweep leaves it alone", async () => {
    world.clock = AT_9PM;
    for (const [id, type] of [["s", "email_ai_draft_sent"], ["x", "email_ai_draft_discarded"], ["e", "email_ai_draft_edited"]] as const) {
      addDraft(id, AT_9PM);
      await autoSendDraft(id, { now: new Date(AT_9PM), ownerText: ASK });
      world.tables["workflow_events"]!.push({ id: `${id}-done`, job_id: "j1", event_type: type, created_at: "2026-10-30T11:00:00.000Z", details: { draft_event_id: id, body: "Jo's words" } });
    }
    world.clock = AT_705AM; await sweepHeldAutoReplies(new Date(AT_705AM));
    expect(world.sends.length).toBe(0);
  });
  test("job moved stage overnight: left as a draft", async () => {
    world.clock = AT_9PM; addDraft("d1", AT_9PM);
    await autoSendDraft("d1", { now: new Date(AT_9PM), ownerText: ASK });
    world.tables["jobs"]![0]!["stage"] = "piesa_scheduled";
    world.clock = AT_705AM; await sweepHeldAutoReplies(new Date(AT_705AM));
    expect(world.sends.length).toBe(0);
    expect(lastDecision("d1")?.["reason"]).toBe("Job moved on — check before sending");
  });
  test("two held emails from the same owner: at most one reply goes at 7am", async () => {
    world.clock = AT_9PM; addDraft("d1", AT_9PM);
    await autoSendDraft("d1", { now: new Date(AT_9PM), ownerText: ASK });
    const t2 = "2026-10-30T10:05:00.000Z";
    world.clock = t2; addDraft("d2", t2);
    await autoSendDraft("d2", { now: new Date(t2), ownerText: ASK });
    world.clock = AT_705AM; await sweepHeldAutoReplies(new Date(AT_705AM));
    expect(world.sends.length).toBe(1);
  });
});

describe("samples", () => {
  test("a draft is never counted twice when pages overlap", async () => {
    world.tables["jobs"]![0]!["source"] = "website";
    for (let i = 0; i < 3; i++) addDraft(`s${i}`, `2026-10-2${i}T00:00:00.000Z`);
    // The same draft id appearing twice (e.g. a new draft shifted the page window) counts once.
    world.tables["workflow_events"]!.push({ ...world.tables["workflow_events"]!.find((e) => e["id"] === "s0")! });
    const ids = (await autoSendSamples()).map((s) => s.eventId);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe("wiring", () => {
  const server = readFileSync("src/lib/ai-email-reply.server.ts", "utf8");
  test("writeAiReplyDraft saves the AI's kind, the job stage and the email time, then runs auto-send", () => {
    expect(server).toMatch(/auto_kind: out\.kind/);
    expect(server).toMatch(/job_stage: job\.stage/);
    expect(server).toMatch(/received_at: m\.at/);
    expect(server).toMatch(/autoSendDraft\(/);
  });
  test("the 15-minute Outlook tick runs the 7am sweep", () => {
    expect(readFileSync("src/routes/api/public/hooks/outlook-sync.ts", "utf8")).toMatch(/sweepHeldAutoReplies\(/);
  });
});

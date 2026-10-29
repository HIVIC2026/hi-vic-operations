// AI replies step 4, task 3: eligible AI drafts send themselves; quiet-hours ones wait for the 7am sweep.
// Own file because it mocks modules. In-memory fake database, mocked sender — nothing live.
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
const world = { tables: {} as Record<string, Row[]>, clock: "", sends: [] as Row[], sendResult: "sent" as string, nextId: 1, release: [] as string[], aiText: "",
  reads: [] as string[], failInsert: null as null | ((table: string, row: Row) => boolean) };

function fromTable(table: string) {
  world.reads.push(table);
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
      const raw = Array.isArray(payload) ? payload : [payload!];
      if (world.failInsert && raw.some((r) => world.failInsert!(table, r))) return { data: null, error: { message: "insert failed" } };
      const list = raw.map((r) => ({ id: `id${world.nextId++}`, created_at: world.clock, ...r }));
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
    single: async () => { const r = run(); return { data: ((r.data ?? []) as Row[])[0] ?? null, error: r.error }; },
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

const { autoSendDraft, sweepHeldAutoReplies, autoSendSamples } = await import("../src/lib/ai-auto-send.server");
const { writeAiReplyDraft } = await import("../src/lib/ai-email-reply.server");

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
  world.sends = []; world.sendResult = "sent"; world.nextId = 1; world.release = []; world.aiText = ""; world.reads = []; world.failInsert = null;
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
  test("final review I1: switch off changes nothing — no decision, no reads beyond the switch", async () => {
    reset({ switchOn: false });
    world.clock = AT_10AM; addDraft("d1", AT_10AM);
    world.reads = [];
    expect(await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: ASK })).toBeNull();
    expect(world.reads).toEqual(["workflow_events"]);
    await sweepHeldAutoReplies(new Date(AT_705AM));
    expect(world.sends.length).toBe(0);
    expect(decisions("d1")).toEqual([]);
  });
  test("final review I1: a non-simple kind changes nothing — no decision, no job reads", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM, { kind: "other" });
    world.reads = [];
    expect(await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: ASK })).toBeNull();
    expect(world.reads.every((t) => t === "workflow_events")).toBe(true);
    expect(decisions("d1")).toEqual([]);
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
    expect(["a", "b", "c", "d"].map((id) => lastDecision(id)?.["decision"])).toEqual(["no", "no", "no", undefined]);
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
  test("writeAiReplyDraft saves the AI's kind, the job stage and the email time, then only queues auto-send (never sends)", () => {
    expect(server).toMatch(/auto_kind: out\.kind/);
    expect(server).toMatch(/job_stage: job\.stage/);
    expect(server).toMatch(/received_at: m\.at/);
    expect(server).toMatch(/queueAutoSend\(/);
    expect(server).not.toMatch(/autoSendDraft\(/);
  });
  test("only the Outlook sync asks for auto-send; the Emails tab never does", () => {
    expect(readFileSync("src/lib/outlook-sync.server.ts", "utf8")).toMatch(/writeAiReplyDraft\(\{[^}]*autoSend: o\.autoSend/);
    expect(readFileSync("src/lib/emails-tab.server.ts", "utf8")).not.toMatch(/autoSend/);
  });
  test("the 15-minute Outlook tick runs the sender after the whole sync, told whether the sync was ok", () => {
    const route = readFileSync("src/routes/api/public/hooks/outlook-sync.ts", "utf8");
    expect(route).toMatch(/sweepHeldAutoReplies\(new Date\(\), \{ syncOk: r\.ok && r\.complete \}\)/);
    expect(route.indexOf("runOutlookSync()")).toBeLessThan(route.indexOf("sweepHeldAutoReplies("));
  });
  test("final review M1: an office Match never queues an auto-send; only the automatic sync does", () => {
    const sync = readFileSync("src/lib/outlook-sync.server.ts", "utf8");
    const office = sync.slice(sync.indexOf("export async function fileOutlookMessageOnJob"), sync.indexOf("async function finishWork"));
    expect(office).toMatch(/ownerAutoReply\(\[jobId\], filed, mailbox, undefined, \{ autoSend: false \}\)/);
    expect(sync).toMatch(/writeAiReplyDraft\(\{[^}]*autoSend: o\.autoSend/);
    const finish = sync.slice(sync.indexOf("async function finishWork"));
    expect(finish).toMatch(/ownerAutoReply\([^;]*counts, \{ autoSend: true \}\)/);
  });
});

describe("fix round 1", () => {
  const msg = (id: string, at: string) => ({ providerMessageId: id, internetMessageId: `<${id}>`, threadId: "t1", from: "sam@x.au", fromName: "Sam Smith", to: ["info@x.au"], cc: [],
    subject: "Hi", body: ASK, at, direction: "inbound" as const, attachments: [] });
  const store = (id: string, at: string) => world.tables["job_communications"]!.push({ job_id: "j1", channel: "email", direction: "inbound", provider_message_id: id, body: ASK, received_at: at, created_at: at });
  test("Emails-tab style draft (no autoSend) with the switch on: not sent; the sync draft: sent", async () => {
    world.clock = AT_10AM; world.aiText = "Hi Sam,\n\nYour job is with the installer now. You can see where it's up to on your job page.\n\nKIND: job_status";
    store("mA", AT_10AM);
    expect(await writeAiReplyDraft({ jobId: "j1", message: msg("mA", AT_10AM), kind: "other", reason: "Emails tab" })).toBe("drafted");
    expect(world.sends.length).toBe(0);
    expect(events("email_ai_auto_decision").length).toBe(0);
    const saved = events("email_ai_draft")[0]!["details"];
    expect(saved).toMatchObject({ auto_kind: "job_status", job_stage: "ready_check_scheduled", received_at: AT_10AM });
    reset(); world.clock = AT_10AM; world.aiText = "Hi Sam,\n\nYour job is with the installer now. You can see where it's up to on your job page.\n\nKIND: job_status";
    store("mB", AT_10AM);
    expect(await writeAiReplyDraft({ jobId: "j1", message: msg("mB", AT_10AM), kind: "simple", reason: "sync", autoSend: true })).toBe("drafted");
    // Final review I2+I3: the sync draft is only queued; the sender after the sync sends it.
    expect(world.sends.length).toBe(0);
    const id = events("email_ai_draft")[0]!["id"] as string;
    expect(lastDecision(id)).toMatchObject({ decision: "queued" });
    await sweepHeldAutoReplies(new Date(AT_10AM), { syncOk: true });
    expect(world.sends.length).toBe(1);
  });
  test("the 'now' path skips when the owner has emailed again", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM);
    store("m-later", "2026-10-29T23:01:00.000Z");
    await autoSendDraft("d1", { now: new Date("2026-10-29T23:02:00.000Z"), ownerText: ASK });
    expect(world.sends.length).toBe(0);
    expect(lastDecision("d1")?.["reason"]).toBe("Owner emailed again — check before sending");
  });
  test("two drafts of ONE owner email, both eligible: only one send (once-only key per email)", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM, { msg: "same" });
    await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: ASK });
    expect(world.sends.length).toBe(1);
    expect(world.sends[0]!["key"]).toBe("owner-email-ai-reply:v1:same:auto");
    // A second draft of the same email two hours later (outside 30 minutes; its history row went missing).
    world.tables["job_communications"] = world.tables["job_communications"]!.filter((r) => r["direction"] !== "outbound");
    const later = "2026-10-30T01:00:00.000Z"; world.clock = later;
    world.tables["workflow_events"]!.push({ id: "d2", job_id: "j1", event_type: "email_ai_draft", created_at: later,
      details: { message_id: "same", to: "sam@x.au", subject: "Re: Hi", body: BODY, auto_kind: "job_status", job_stage: "ready_check_scheduled", received_at: AT_10AM } });
    await autoSendDraft("d2", { now: new Date(later), ownerText: ASK });
    expect(world.sends.length).toBe(1);
    expect(lastDecision("d2")?.["reason"]).toBe("Already replied to this email by AI");
    expect(String(lastDecision("d2")?.["reason"])).not.toMatch(/Auto-send failed/);
  });
  test("Jo replied from Outlook since the owner's email: not sent (now and at 7am)", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM);
    world.tables["job_communications"]!.push({ job_id: "j1", channel: "email", direction: "outbound", provider_message_id: "out1", provider: "outlook", delivery_status: "sent", source_event: "outlook_sync:sync", created_by: null, body: "Jo's reply", sent_at: "2026-10-29T23:00:30.000Z" });
    await autoSendDraft("d1", { now: new Date("2026-10-29T23:01:00.000Z"), ownerText: ASK });
    expect(lastDecision("d1")?.["reason"]).toBe("You've already replied");
    world.clock = AT_9PM; addDraft("d2", AT_9PM);
    await autoSendDraft("d2", { now: new Date(AT_9PM), ownerText: ASK });
    world.tables["job_communications"]!.push({ job_id: "j1", channel: "email", direction: "outbound", provider_message_id: "out2", provider: "outlook", delivery_status: "sent", source_event: "outlook_sync:sync", created_by: null, body: "Jo's reply", sent_at: "2026-10-30T11:00:00.000Z" });
    world.clock = AT_705AM; await sweepHeldAutoReplies(new Date(AT_705AM));
    expect(world.sends.length).toBe(0);
    expect(lastDecision("d2")?.["reason"]).toBe("You've already replied");
  });
  test("a held draft Jo dealt with gets a final 'Already handled' so the sweep stops checking it", async () => {
    world.clock = AT_9PM; addDraft("d1", AT_9PM);
    await autoSendDraft("d1", { now: new Date(AT_9PM), ownerText: ASK });
    world.tables["workflow_events"]!.push({ id: "x", job_id: "j1", event_type: "email_ai_draft_discarded", created_at: "2026-10-30T11:00:00.000Z", details: { draft_event_id: "d1" } });
    world.clock = AT_705AM; await sweepHeldAutoReplies(new Date(AT_705AM));
    expect(lastDecision("d1")).toMatchObject({ decision: "no", reason: "Already handled" });
    const n = decisions("d1").length;
    world.clock = "2026-10-30T20:20:00.000Z"; await sweepHeldAutoReplies(new Date("2026-10-30T20:20:00.000Z"));
    expect(decisions("d1").length).toBe(n);
  });
  test("a 'now' that never finished is marked failed after an hour", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM);
    world.tables["workflow_events"]!.push({ id: "n1", job_id: "j1", event_type: "email_ai_auto_decision", created_at: AT_10AM, details: { draft_event_id: "d1", decision: "now", reason: "Sends itself", kind: "job_status" } });
    await sweepHeldAutoReplies(new Date("2026-10-29T23:30:00.000Z"));
    expect(lastDecision("d1")?.["decision"]).toBe("now");
    world.clock = "2026-10-30T00:05:00.000Z"; await sweepHeldAutoReplies(new Date("2026-10-30T00:05:00.000Z"));
    expect(lastDecision("d1")).toMatchObject({ decision: "no", reason: "Auto-send failed: didn't finish" });
  });
  test("rewritten at send (the owner's release changed between checks): left for Jo, Auto-send failed", async () => {
    world.tables["jobs"]![0]!["stage"] = "preliminary_estimate_ready";
    world.release = ["confirmed", "none"]; // auto-send's check, then sendAiDraft's own check
    const body = "Hi Sam,\n\nYour free Ready Check is coming this week.\n\nCheers, the Home Insulation Victoria team";
    world.aiText = body;
    world.clock = AT_10AM; addDraft("d1", AT_10AM, { body, extra: { job_stage: "preliminary_estimate_ready" } });
    await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: ASK });
    expect(world.sends.length).toBe(0);
    expect(events("email_ai_draft_sent").length).toBe(0);
    expect(lastDecision("d1")?.["reason"]).toBe("Auto-send failed: the reply needed fixing — check it and press Send");
  });
  test("delivery uncertain counts as sent (never resent)", async () => {
    world.sendResult = "delivery uncertain — not retried";
    world.clock = AT_10AM; addDraft("d1", AT_10AM);
    const r = await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: ASK });
    expect(r?.sent).toBe(true);
    expect(events("email_ai_draft_sent")[0]!["details"]).toMatchObject({ via: "ai", status: "delivery uncertain — not retried" });
    await sweepHeldAutoReplies(new Date(AT_705AM));
    expect(events("email_ai_draft_sent").length).toBe(1);
  });
});

describe("fix round 2", () => {
  const out = (o: Row) => world.tables["job_communications"]!.push({ job_id: "j1", channel: "email", direction: "outbound", sent_at: "2026-10-29T23:00:30.000Z", ...o });
  test("an automatic portal email (spot saved / follow-up) after the owner's email doesn't stop the reply", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM);
    out({ provider: "resend", delivery_status: "sent", source_event: "spot_saved_email", created_by: null });
    out({ provider: "resend", delivery_status: "sent", source_event: "estimate_followup", created_by: null });
    await autoSendDraft("d1", { now: new Date("2026-10-29T23:01:00.000Z"), ownerText: ASK });
    expect(world.sends.length).toBe(1);
  });
  test("a failed outbound email doesn't count as a reply", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM);
    out({ provider: "outlook", delivery_status: "failed", source_event: "email_ai_draft_sent", created_by: "u1" });
    await autoSendDraft("d1", { now: new Date("2026-10-29T23:01:00.000Z"), ownerText: ASK });
    expect(world.sends.length).toBe(1);
  });
  test("an earlier AI auto-send doesn't count as Jo's reply; Jo's office send does", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM);
    out({ provider: "outlook", delivery_status: "sent", source_event: "email_ai_draft_sent", created_by: null });
    await autoSendDraft("d1", { now: new Date("2026-10-29T23:01:00.000Z"), ownerText: ASK });
    expect(world.sends.length).toBe(1);
    reset(); world.clock = AT_10AM; addDraft("d2", AT_10AM);
    out({ provider: "outlook", delivery_status: "sent", source_event: "email_ai_draft_sent", created_by: "jo" });
    await autoSendDraft("d2", { now: new Date("2026-10-29T23:01:00.000Z"), ownerText: ASK });
    expect(world.sends.length).toBe(0);
    expect(lastDecision("d2")?.["reason"]).toBe("You've already replied");
  });
  test("stuck 'now' whose email did go (send record under the :auto key): the sent event is written, not 'failed'", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM, { msg: "mx" });
    world.tables["workflow_events"]!.push({ id: "n1", job_id: "j1", event_type: "email_ai_auto_decision", created_at: AT_10AM, details: { draft_event_id: "d1", decision: "now", reason: "Sends itself", kind: "job_status" } });
    world.tables["customer_email_sends"]!.push({ job_id: "j1", idempotency_key: "owner-email-ai-reply:v1:mx:auto", status: "delivered_unrecorded" });
    world.clock = "2026-10-30T00:05:00.000Z"; await sweepHeldAutoReplies(new Date("2026-10-30T00:05:00.000Z"));
    const sent = events("email_ai_draft_sent");
    expect(sent.length).toBe(1);
    expect(sent[0]!["details"]).toMatchObject({ draft_event_id: "d1", via: "ai", status: "delivery uncertain — not retried" });
    expect(lastDecision("d1")?.["decision"]).toBe("now");
  });
  test("office Send refuses when the AI already answered that owner email", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM, { msg: "my" });
    world.tables["customer_email_sends"]!.push({ job_id: "j1", idempotency_key: "owner-email-ai-reply:v1:my:auto", status: "sent" });
    const { sendAiDraft } = await import("../src/lib/ai-email-reply.server");
    await expect(sendAiDraft("d1", BODY, "u1")).rejects.toThrow("This email was already answered by AI — check the job's emails first");
    expect(world.sends.length).toBe(0);
    // A definitely failed auto attempt doesn't block Jo.
    world.tables["customer_email_sends"]![0]!["status"] = "failed";
    expect((await sendAiDraft("d1", BODY, "u1")).status).toBe("sent");
  });
});

describe("final review fixes", () => {
  const msg = (id: string, at: string, subject = "Hi", body = ASK) => ({ providerMessageId: id, internetMessageId: `<${id}>`, threadId: "t1", from: "sam@x.au", fromName: "Sam Smith", to: ["info@x.au"], cc: [],
    subject, body, at, direction: "inbound" as const, attachments: [] });
  const store = (id: string, at: string, body = ASK) => world.tables["job_communications"]!.push({ job_id: "j1", channel: "email", direction: "inbound", provider_message_id: id, body, received_at: at, created_at: at });
  const REPLY = "Hi Sam,\n\nYour job is with the installer now. You can see where it's up to on your job page.\n\nKIND: job_status";
  const queue = async (id: string, at: string, subject?: string, body?: string) => {
    world.clock = at; world.aiText = REPLY; store(id, at, body);
    expect(await writeAiReplyDraft({ jobId: "j1", message: msg(id, at, subject, body), kind: "simple", reason: "sync", autoSend: true })).toBe("drafted");
    return events("email_ai_draft").find((e) => e["details"]["message_id"] === id)!["id"] as string;
  };

  test("I2+I3: switch off or a non-simple kind: writeAiReplyDraft queues nothing", async () => {
    reset({ switchOn: false });
    await queue("m1", AT_10AM);
    expect(events("email_ai_auto_decision")).toEqual([]);
    reset(); world.aiText = "Hi Sam,\n\nThanks, I'll check.\n\nKIND: other"; world.clock = AT_10AM; store("m2", AT_10AM);
    await writeAiReplyDraft({ jobId: "j1", message: msg("m2", AT_10AM), kind: "simple", reason: "sync", autoSend: true });
    expect(events("email_ai_auto_decision")).toEqual([]);
  });
  test("I2+I3: Jo's Outlook reply pulled in the same tick (Sent Items after inbound): no AI send", async () => {
    const id = await queue("m1", AT_10AM);
    expect(world.sends.length).toBe(0);
    // Sent Items stored later in the same sync run.
    world.tables["job_communications"]!.push({ job_id: "j1", channel: "email", direction: "outbound", provider_message_id: "out1", provider: "outlook", delivery_status: "sent", source_event: "outlook_sync:sync", created_by: null, body: "Jo's reply", sent_at: "2026-10-29T23:00:30.000Z" });
    await sweepHeldAutoReplies(new Date("2026-10-29T23:01:00.000Z"), { syncOk: true });
    expect(world.sends.length).toBe(0);
    expect(lastDecision(id)).toMatchObject({ decision: "no", reason: "You've already replied" });
  });
  test("I2+I3: sync not ok → nothing sent this tick (queued and held stay); next ok tick sends", async () => {
    const id = await queue("m1", AT_10AM);
    const r = await sweepHeldAutoReplies(new Date("2026-10-29T23:01:00.000Z"), { syncOk: false });
    expect(r.sent).toBe(0);
    expect(world.sends.length).toBe(0);
    expect(lastDecision(id)?.["decision"]).toBe("queued");
    world.clock = "2026-10-29T23:15:00.000Z";
    expect((await sweepHeldAutoReplies(new Date("2026-10-29T23:15:00.000Z"), { syncOk: true })).sent).toBe(1);
    expect(world.sends.length).toBe(1);
    expect(lastDecision(id)?.["decision"]).toBe("now");
  });
  test("I2+I3: held drafts also wait while the sync is failing", async () => {
    world.clock = AT_9PM; addDraft("d1", AT_9PM);
    await autoSendDraft("d1", { now: new Date(AT_9PM), ownerText: ASK });
    world.clock = AT_705AM; await sweepHeldAutoReplies(new Date(AT_705AM), { syncOk: false });
    expect(world.sends.length).toBe(0);
    expect(lastDecision("d1")?.["decision"]).toBe("at7am");
  });
  test("I2+I3: markStuckSends still runs when the sync is not ok", async () => {
    world.clock = AT_10AM; addDraft("d1", AT_10AM);
    world.tables["workflow_events"]!.push({ id: "n1", job_id: "j1", event_type: "email_ai_auto_decision", created_at: AT_10AM, details: { draft_event_id: "d1", decision: "now", reason: "Sends itself", kind: "job_status" } });
    world.clock = "2026-10-30T00:05:00.000Z"; await sweepHeldAutoReplies(new Date("2026-10-30T00:05:00.000Z"), { syncOk: false });
    expect(lastDecision("d1")).toMatchObject({ decision: "no", reason: "Auto-send failed: didn't finish" });
  });
  test("I2+I3: queued at 9pm becomes 'Waiting for 7am', sent once by the 7:05am tick", async () => {
    const id = await queue("m1", AT_9PM);
    world.clock = AT_9PM; await sweepHeldAutoReplies(new Date(AT_9PM), { syncOk: true });
    expect(world.sends.length).toBe(0);
    expect(lastDecision(id)?.["decision"]).toBe("at7am");
    world.clock = AT_705AM; await sweepHeldAutoReplies(new Date(AT_705AM), { syncOk: true });
    expect(world.sends.length).toBe(1);
  });
  test("I2+I3: the same fresh checks apply to queued drafts (complaint, job moved, owner emailed again)", async () => {
    const a = await queue("m1", AT_10AM, "Hi", "Where's my job up to? The installer left a mess.");
    await sweepHeldAutoReplies(new Date(AT_10AM), { syncOk: true });
    expect(lastDecision(a)?.["reason"]).toBe("Owner sounds unhappy");
    reset(); const b = await queue("m2", AT_10AM);
    world.tables["jobs"]![0]!["stage"] = "piesa_scheduled";
    await sweepHeldAutoReplies(new Date(AT_10AM), { syncOk: true });
    expect(lastDecision(b)?.["reason"]).toBe("Job moved on — check before sending");
    expect(world.sends.length).toBe(0);
  });
  test("I2+I3: bounded per tick", async () => {
    for (let i = 0; i < 30; i++) {
      world.tables["workflow_events"]!.push({ id: `q${i}`, job_id: "j1", event_type: "email_ai_auto_decision", created_at: AT_10AM, details: { draft_event_id: `missing${i}`, decision: "queued", reason: "Queued", kind: "job_status" } });
    }
    const r = await sweepHeldAutoReplies(new Date(AT_10AM), { syncOk: true });
    expect(r.checked).toBeLessThanOrEqual(25);
  });
  test("re-review 2: superseded queued rows never crowd out a fresh queued draft", async () => {
    const early = "2026-10-29T20:00:00.000Z";
    for (let i = 0; i < 600; i++) {
      const det = { draft_event_id: `old${i}`, kind: "job_status" };
      world.tables["workflow_events"]!.push({ id: `oq${i}`, job_id: "j1", event_type: "email_ai_auto_decision", created_at: early, details: { ...det, decision: "queued", reason: "Queued" } });
      world.tables["workflow_events"]!.push({ id: `on${i}`, job_id: "j1", event_type: "email_ai_auto_decision", created_at: "2026-10-29T20:01:00.000Z", details: { ...det, decision: "no", reason: "Needs you" } });
    }
    const id = await queue("m1", AT_10AM);
    const r = await sweepHeldAutoReplies(new Date(AT_10AM), { syncOk: true });
    expect(r.checked).toBe(1);
    expect(world.sends.length).toBe(1);
    expect(lastDecision(id)?.["decision"]).toBe("now");
  });
  test("M2: a complaint in the SUBJECT keeps it a draft", async () => {
    const id = await queue("m1", AT_10AM, "Refund??", "Where are we up to?");
    await sweepHeldAutoReplies(new Date(AT_10AM), { syncOk: true });
    expect(world.sends.length).toBe(0);
    expect(lastDecision(id)?.["reason"]).toBe("Owner sounds unhappy");
  });
  test("M3: complaint words only in quoted history don't block; in the new text they do", async () => {
    const quoted = "Where's my job up to?\n\nOn Mon, 26 Oct 2026, Home Insulation Victoria wrote:\n> If you're unhappy or want a refund, just reply.";
    world.clock = AT_10AM; addDraft("d1", AT_10AM, { text: quoted });
    await autoSendDraft("d1", { now: new Date(AT_10AM) });
    expect(world.sends.length).toBe(1);
  });
  test("M4: 'no reply needed' drafts are never samples", async () => {
    addDraft("s1", "2026-10-20T00:00:00.000Z");
    addDraft("s2", "2026-10-21T00:00:00.000Z", { body: "", extra: { no_reply_needed: true } });
    expect((await autoSendSamples()).map((s) => s.eventId)).toEqual(["s1"]);
  });
  test("M5: a held draft Jo edited but hasn't sent: its card never says 'Already handled'", async () => {
    const { autoNoteText } = await import("../src/lib/ai-email-reply.core");
    world.clock = AT_9PM; addDraft("d1", AT_9PM);
    await autoSendDraft("d1", { now: new Date(AT_9PM), ownerText: ASK });
    world.tables["workflow_events"]!.push({ id: "e1", job_id: "j1", event_type: "email_ai_draft_edited", created_at: "2026-10-30T11:00:00.000Z", details: { draft_event_id: "d1", body: "Jo's words" } });
    world.clock = AT_705AM; await sweepHeldAutoReplies(new Date(AT_705AM));
    expect(world.sends.length).toBe(0);
    const last = lastDecision("d1") as { decision: "no"; reason: string };
    expect(last.decision).toBe("no");
    expect(autoNoteText(last)).toBeNull();
  });
  test("M6: a held (or queued) decision older than 3 days gets a final 'Too old' and is never sent", async () => {
    const old = "2026-10-25T10:00:00.000Z";
    world.clock = old; addDraft("d1", old);
    world.tables["workflow_events"]!.push({ id: "h1", job_id: "j1", event_type: "email_ai_auto_decision", created_at: old, details: { draft_event_id: "d1", decision: "at7am", reason: "Waiting for 7am", kind: "job_status" } });
    addDraft("d2", old);
    world.tables["workflow_events"]!.push({ id: "h2", job_id: "j1", event_type: "email_ai_auto_decision", created_at: old, details: { draft_event_id: "d2", decision: "queued", reason: "Queued", kind: "job_status" } });
    world.clock = AT_705AM; await sweepHeldAutoReplies(new Date(AT_705AM), { syncOk: true });
    expect(world.sends.length).toBe(0);
    expect(lastDecision("d1")).toMatchObject({ decision: "no", reason: "Too old to send itself — check it" });
    expect(lastDecision("d2")).toMatchObject({ decision: "no", reason: "Too old to send itself — check it" });
    const n = events("email_ai_auto_decision").length;
    world.clock = "2026-10-30T20:20:00.000Z"; await sweepHeldAutoReplies(new Date("2026-10-30T20:20:00.000Z"), { syncOk: true });
    expect(events("email_ai_auto_decision").length).toBe(n);
  });
  test("M9: the email went but the sent record didn't save — auto-send isn't marked failed, and is recovered later", async () => {
    world.failInsert = (t, r) => t === "workflow_events" && r["event_type"] === "email_ai_draft_sent";
    world.clock = AT_10AM; addDraft("d1", AT_10AM, { msg: "mz" });
    const r = await autoSendDraft("d1", { now: new Date(AT_10AM), ownerText: ASK });
    expect(world.sends.length).toBe(1);
    expect(r?.sent).toBe(true);
    expect(lastDecision("d1")?.["decision"]).toBe("now");
    // The history row still went in.
    expect(world.tables["job_communications"]!.some((c) => c["direction"] === "outbound" && c["source_event"] === "email_ai_draft_sent")).toBe(true);
    world.failInsert = null;
    world.tables["customer_email_sends"]!.push({ job_id: "j1", idempotency_key: "owner-email-ai-reply:v1:mz:auto", status: "sent" });
    world.clock = "2026-10-30T00:05:00.000Z"; await sweepHeldAutoReplies(new Date("2026-10-30T00:05:00.000Z"));
    expect(events("email_ai_draft_sent").length).toBe(1);
  });
  test("M9: office Send whose sent record didn't save says so (never silent)", async () => {
    world.failInsert = (t, r) => t === "workflow_events" && r["event_type"] === "email_ai_draft_sent";
    world.clock = AT_10AM; addDraft("d1", AT_10AM);
    const { sendAiDraft } = await import("../src/lib/ai-email-reply.server");
    await expect(sendAiDraft("d1", BODY, "u1")).rejects.toThrow(/^Sent, but/);
    expect(world.sends.length).toBe(1);
  });
});

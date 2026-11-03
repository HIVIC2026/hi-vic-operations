// Part 7 Task 7 (decision #26, Jo 2 Nov 2026): the 6:30am jobs text goes to WORKERS ONLY — the person allocated to each
// visit, on their own mobile. No fallback to the business owner's mobile; if no worker is picked, no text (and no log row).
// PIESA visits are the electrician's (Part 6), never on this text. In-memory PostgREST; senders faked.
import { beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dailySendKey, dailyTextRecipient, workerOnlyTextRecipient } from "../src/lib/visit-allocation.core";

describe("workerOnlyTextRecipient (pure)", () => {
  test("null when nobody is allocated or they have no mobile; the worker's own key and mobile otherwise", () => {
    expect(workerOnlyTextRecipient(null)).toBeNull();
    expect(workerOnlyTextRecipient({ workerId: "w1", name: "Deep", mobile: null })).toBeNull();
    expect(workerOnlyTextRecipient({ workerId: "w1", name: "Deep", mobile: "   " })).toBeNull();
    expect(workerOnlyTextRecipient({ workerId: "w1", name: "Deep", mobile: "+61400000001" })).toEqual({ key: "w:w1", name: "Deep", phone: "+61400000001", who: "allocated", note: null });
    // The send key for a worker group is unchanged.
    expect(dailySendKey("daily", "B1", "2026-11-13", "w:w1")).toBe("daily:B1:2026-11-13:w:w1");
    // dailyTextRecipient (owner fallback) stays for the senders that keep it (install-day-confirm.server).
    expect(dailyTextRecipient({ allocated: null, owner: { name: "Boss", phone: "+61400000000" } }).who).toBe("owner");
  });
});

// ── collectDay / sweep with an in-memory database ─────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" | "upsert" = "select";
  let inserted: Row | null = null;
  let patch: Row | null = null;
  const res = () => {
    if (op === "insert" || op === "upsert") return { data: inserted ? { id: inserted["id"] } : null, error: null };
    const rows = (tables[t] ?? []).filter((x) => filters.every((f) => f(x)));
    if (op === "update") { for (const r of rows) Object.assign(r, patch); return { data: rows, error: null }; }
    return { data: rows, error: null };
  };
  const one = async () => { const r = res(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
    neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return q; },
    gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return q; },
    lt: (k: string, v: string) => { filters.push((r) => String(r[k]) < v); return q; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q; },
    not: () => q, order: () => q, limit: () => q, range: () => q,
    insert: (r: Row) => { op = "insert"; inserted = { id: crypto.randomUUID(), ...r }; (tables[t] ??= []).push(inserted); return q; },
    upsert: (r: Row) => { op = "upsert"; inserted = { id: crypto.randomUUID(), ...r }; (tables[t] ??= []).push(inserted); return q; },
    update: (p: Row) => { op = "update"; patch = p; return q; },
    maybeSingle: one, single: one,
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
const allocated: Record<string, { workerId: string; name: string; mobile: string | null } | null> = {};
mock.module("../src/lib/visit-allocation.server", () => ({ allocatedPersonFor: async (jobId: string, kind: string) => allocated[`${jobId}:${kind}`] ?? null }));
mock.module("../src/lib/swms-link.server", () => ({ unsignedSwmsSignerLinks: async () => [], swmsSignLink: async () => "x" }));
const sent: { type: string; key: string; to: string; body: string }[] = [];
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (p: { type: string; idempotencyKey: string; to: string; body: string }) => { sent.push({ type: p.type, key: p.idempotencyKey, to: p.to, body: p.body }); return { status: "sent", detail: "faked", sid: "SM1" }; } }));
const testSent: { to: string; body: string }[] = [];
mock.module("../src/lib/test-send.server", () => ({ sendTestSms: async (_c: unknown, to: string, body: string) => { testSent.push({ to, body }); return { status: "sent", detail: "test" }; } }));
mock.module("../src/lib/set-password-link.core", () => ({ SET_PASSWORD_BASE: "https://p" }));
globalThis.fetch = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch; // refreshDelivery never reaches Twilio here

const { collectDay, sweepDailyMittiTexts } = await import("../src/lib/daily-mitti-text.server");
const DATE = "2026-11-13"; // Fri 13 Nov Melbourne
const booking = (id: string, jobId: string, kind: string, startIso: string, business: string, extra: Row = {}): Row => ({ id, job_id: jobId, kind, status: "confirmed", scheduled_start: startIso, scheduled_end: null, business_id: business, assignment_id: null, jobs: { source: "website", properties: { address_line: `${id} Example St`, suburb: "Box Hill" } }, ...extra });

beforeEach(() => {
  sent.length = 0; testSent.length = 0;
  for (const k of Object.keys(allocated)) delete allocated[k];
  setSystemTime(new Date("2026-11-12T19:40:00Z")); // 6:40am Fri 13 Nov Melbourne
  tables = {
    workflow_settings: [{ id: 1, daily_mitti_text_enabled: true, daily_mitti_text_time: "06:30", mitti_piesa_template_id: "t3", mitti_piisa_template_id: "t5" }],
    bookings: [
      booking("BK-INST", "J1", "installation", "2026-11-12T20:30:00Z", "B1"), // 7:30am install, allocated to w1
      booking("BK-RC", "J2", "ready_check", "2026-11-12T23:00:00Z", "B1"), // 10am Ready Check, nobody allocated
      booking("BK-PIESA", "J3", "assessment", "2026-11-13T00:00:00Z", "B1"), // electrician's safety check — not this text
      booking("BK-OTHER", "J4", "installation", "2026-11-13T02:00:00Z", "B2"), // another business, nobody allocated
    ],
    job_assignments: [{ id: "A1", job_id: "J1", business_id: "B1", role: "installer", active: true }, { id: "A2", job_id: "J2", business_id: "B1", role: "installer", active: true }, { id: "A4", job_id: "J4", business_id: "B2", role: "installer", active: true }],
    businesses: [
      { id: "B1", name: "Rapid Insulation", is_active: true, approved_at: "2026-10-01T00:00:00Z", mitti_account_invited: true, signer_mobile: "0499 000 111", phone: "03 9000 0000", onboarding_notes: null },
      { id: "B2", name: "Other Co", is_active: true, approved_at: "2026-10-01T00:00:00Z", mitti_account_invited: true, signer_mobile: "0499 000 222", phone: null, onboarding_notes: null },
    ],
    workflow_events: [{ job_id: "J1", event_type: "mitti_piisa_audit_created", created_at: "2026-11-10T00:00:00Z", details: { audit_id: "A5-J1" } }],
    ready_checks: [{ job_id: "J2", external_mitti_id: "RC-J2", created_at: "2026-11-01T00:00:00Z" }],
    ceiling_measurements: [], trade_text_log: [],
  };
  allocated["J1:install"] = { workerId: "w1", name: "John Smith", mobile: "0412 345 678" };
});

describe("collectDay — workers only", () => {
  test("one group for the allocated worker listing only the install; the unallocated Ready Check, the PIESA and the other business's unallocated install make no group", async () => {
    const groups = await collectDay(DATE);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.recipient).toEqual({ key: "w:w1", name: "John Smith", phone: "0412 345 678", who: "allocated", note: null });
    expect(groups[0]!.trade.phone).toBe("+61412345678");
    expect(groups[0]!.jobs.map((j) => j.jobId)).toEqual(["J1"]);
    expect(groups[0]!.jobs[0]!.link).toContain("A5-J1");
    expect(JSON.stringify(groups)).not.toContain("0499"); // never the business owner's numbers
  });
  test("a worker allocated to the Ready Check too gets both visits in one text (same person, one group)", async () => {
    allocated["J2:ready_check"] = { workerId: "w1", name: "John Smith", mobile: "0412 345 678" };
    const groups = await collectDay(DATE);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.jobs.map((j) => j.jobId).sort()).toEqual(["J1", "J2"]);
  });
  test("a different worker on the Ready Check gets their own text; an allocated worker without a mobile gets none and nothing goes to the boss", async () => {
    allocated["J2:ready_check"] = { workerId: "w2", name: "Sam Lee", mobile: "0400 000 002" };
    allocated["J4:install"] = { workerId: "w9", name: "No Mobile", mobile: null };
    const groups = await collectDay(DATE);
    expect(groups.map((g) => g.recipient.key).sort()).toEqual(["w:w1", "w:w2"]);
    expect(groups.find((g) => g.recipient.key === "w:w2")!.jobs.map((j) => j.jobId)).toEqual(["J2"]);
    expect(groups.some((g) => g.trade.businessId === "B2")).toBe(false);
  });
});

describe("sweepDailyMittiTexts — workers only", () => {
  test("ONE text to the worker's own mobile with the install only, keyed per worker; no trade_text_log row for anyone unallocated", async () => {
    const r = await sweepDailyMittiTexts(new Date());
    expect(r).toEqual({ daily: 1, updates: 0, skippedTrades: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "daily_mitti", to: "+61412345678", key: `daily-mitti:${dailySendKey("daily", "B1", DATE, "w:w1")}` });
    expect(sent[0]!.body).toStartWith("Good morning! Your jobs today: 1) 7:30am");
    expect(sent[0]!.body).toContain("A5-J1");
    expect(sent[0]!.body).not.toContain("RC-J2");
    expect(JSON.stringify(sent)).not.toContain("0499");
    const log = tables["trade_text_log"]!;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ business_id: "B1", to_number: "+61412345678", send_key: dailySendKey("daily", "B1", DATE, "w:w1"), job_ids: ["J1"] });
    // A second sweep the same morning sends nothing more.
    expect(await sweepDailyMittiTexts(new Date())).toEqual({ daily: 0, updates: 0, skippedTrades: 0 });
    expect(sent).toHaveLength(1);
  });
  test("nobody allocated anywhere → no text and no log row at all", async () => {
    delete allocated["J1:install"];
    expect(await sweepDailyMittiTexts(new Date())).toEqual({ daily: 0, updates: 0, skippedTrades: 0 });
    expect(sent).toHaveLength(0);
    expect(tables["trade_text_log"] ?? []).toHaveLength(0);
  });
  test("TEST partner → the test sender, same worker recipient", async () => {
    tables["businesses"]![0]!["onboarding_notes"] = "[TEST PARTNER] practice";
    expect(await sweepDailyMittiTexts(new Date())).toEqual({ daily: 1, updates: 0, skippedTrades: 0 });
    expect(sent).toHaveLength(0);
    expect(testSent).toHaveLength(1);
    expect(testSent[0]!.to).toBe("+61412345678");
  });
  test("source: no owner fallback left in the 6:30am sender; the sms type keeps its 6:30am exemption (Jo 24 Oct) and the real sender's gates", () => {
    const src = readFileSync("src/lib/daily-mitti-text.server.ts", "utf8");
    const collect = src.slice(src.indexOf("export async function collectDay"), src.indexOf("async function sendSms"));
    expect(collect).toContain("workerOnlyTextRecipient(");
    expect(collect).not.toContain("dailyTextRecipient(");
    expect(collect).not.toContain("signer_mobile");
    expect(collect).not.toContain("ownerPhone");
    const sms = readFileSync("src/lib/sms.core.ts", "utf8");
    expect(sms).toMatch(/daily_mitti: \{ audience: "partner"[^}]*quietHours: false/);
    expect(src).toContain('sendRealSms({ type: kind === "update" ? "daily_mitti_update" : "daily_mitti"');
  });
});

// Decision 307 (Jo, 25 Oct 2026): the owner ticks the 30-day-rule box before choosing PIESA times on the secure link.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  OWNER_THIRTY_DAY_ACK_EVENT, THIRTY_DAY_ACK_REFUSAL, THIRTY_DAY_ACK_SUMMARY, THIRTY_DAY_ACK_VERSION, THIRTY_DAY_ACK_WORDING,
  buildThirtyDayAck, piesaCycle, thirtyDayAckBlocker, thirtyDayAckNeeded,
} from "../src/lib/thirty-day-ack.core";
import { tagEvent } from "../src/lib/jobfile.core";

describe("decision 307 wording", () => {
  test("Jo's exact sentence", () => {
    expect(THIRTY_DAY_ACK_WORDING).toBe("I understand the Victorian Energy Upgrades program requires my insulation to be installed within 30 days of the electrical safety check. If it isn't, a new safety check is needed and may be charged.");
    expect(OWNER_THIRTY_DAY_ACK_EVENT).toBe("owner_thirty_day_acknowledged");
    expect(THIRTY_DAY_ACK_SUMMARY).toBe("Owner acknowledged the 30-day rule");
    expect(THIRTY_DAY_ACK_REFUSAL).toMatch(/tick the box/);
  });
  test("the office timeline shows it as an owner item", () => {
    expect(tagEvent(OWNER_THIRTY_DAY_ACK_EVENT)).toContain("customer");
  });
});

describe("decision 307 rule", () => {
  test("cycle = lapsed 30-day windows", () => {
    expect(piesaCycle(0)).toBe(0);
    expect(piesaCycle(2)).toBe(2);
    expect(piesaCycle(-1)).toBe(0);
  });
  test("asked once per cycle; asked again after the window lapses", () => {
    expect(thirtyDayAckNeeded({ cycle: 0, acks: [] })).toBe(true);
    expect(thirtyDayAckNeeded({ cycle: 0, acks: [{ cycle: 0 }] })).toBe(false);
    expect(thirtyDayAckNeeded({ cycle: 1, acks: [{ cycle: 0 }] })).toBe(true);
    expect(thirtyDayAckNeeded({ cycle: 1, acks: [{ cycle: 0 }, { cycle: 1 }] })).toBe(false);
    expect(thirtyDayAckNeeded({ cycle: 0, acks: [{}] })).toBe(false);
  });
  test("refuses unless ticked when needed", () => {
    expect(thirtyDayAckBlocker({ needed: true, understandsThirtyDays: undefined })).toBe(THIRTY_DAY_ACK_REFUSAL);
    expect(thirtyDayAckBlocker({ needed: true, understandsThirtyDays: false })).toBe(THIRTY_DAY_ACK_REFUSAL);
    expect(thirtyDayAckBlocker({ needed: true, understandsThirtyDays: true })).toBeNull();
    expect(thirtyDayAckBlocker({ needed: false, understandsThirtyDays: undefined })).toBeNull();
  });
  test("record shape", () => {
    const d = buildThirtyDayAck({ cycle: 1, quoteId: "q1", at: "2026-10-25T00:00:00.000Z", ipHash: "i", uaHash: "u" });
    expect(d).toEqual({ version: THIRTY_DAY_ACK_VERSION, wording: THIRTY_DAY_ACK_WORDING, cycle: 1, quote_id: "q1", acknowledged_at: "2026-10-25T00:00:00.000Z", ip_hash: "i", ua_hash: "u", via: "secure_link" });
  });
});

describe("decision 307 source pins", () => {
  const fns = readFileSync("src/lib/owner-link.functions.ts", "utf8");
  const choose = fns.slice(fns.indexOf("export const ownerChoosePiesaFn"), fns.indexOf("export const ownerTakeInstallDayFn"));
  test("ownerChoosePiesaFn passes the tick to submitOwnerPiesaWindows, which checks it (F17: one place for every owner path)", () => {
    expect(choose).toContain("understandsThirtyDays: z.boolean()");
    expect(choose).toContain("submitOwnerPiesaWindows(s.jobId, s.userId, data.picks, { understandsThirtyDays: data.understandsThirtyDays");
    expect(choose).not.toContain("requireOwnerThirtyDayAck("); // no duplicate check
    const srv = readFileSync("src/lib/allocation.server.ts", "utf8");
    const fn = srv.slice(srv.indexOf("export async function submitOwnerPiesaWindows"), srv.indexOf("export async function ownerPiesaWindowState"));
    const ack = fn.indexOf("requireOwnerThirtyDayAck(");
    expect(ack).toBeGreaterThan(fn.indexOf("PIESA_MAX_ROUNDS) throw")); // after the stage/round checks
    expect(fn.indexOf('from("appointment_proposals").insert')).toBeGreaterThan(ack); // before anything is saved
  });
  test("F17: the signed-in chooseOwnerPiesaWindows takes the tick and the old PiesaTimesCard shows the box", () => {
    const alloc = readFileSync("src/lib/allocation.functions.ts", "utf8");
    const signedIn = alloc.slice(alloc.indexOf("export const chooseOwnerPiesaWindows"), alloc.indexOf("export const getRectificationWindows"));
    expect(signedIn).toContain("middleware([requireSupabaseAuth, withRequestMeta])");
    expect(signedIn).toContain("understandsThirtyDays: z.boolean().optional()");
    expect(signedIn).toContain("{ understandsThirtyDays: data.understandsThirtyDays, ip: context.ip, userAgent: context.userAgent }");
    const card = readFileSync("src/components/portal/piesa-times.tsx", "utf8");
    const old = card.slice(card.indexOf("export function PiesaTimesCard"));
    expect(old).toContain("data.thirtyDayAck.wording");
    expect(old).toContain("choose({ jobId, picks, understandsThirtyDays: understands }");
    expect(old).toContain("disabled={busy || ackBlock || blockers.length > 0}");
  });
  test("server refuses with the plain message and records once per cycle", () => {
    const srv = readFileSync("src/lib/thirty-day-ack.server.ts", "utf8");
    expect(srv).toContain("thirtyDayAckBlocker(");
    expect(srv).toContain("throw new WorkflowError(blocker)");
    expect(srv).toContain("if (!state.needed) return");
    expect(srv).toContain("OWNER_THIRTY_DAY_ACK_EVENT, THIRTY_DAY_ACK_SUMMARY");
    expect(srv).toContain("INSTALL_WINDOW_EXPIRED_EVENT");
    expect(srv).not.toMatch(/send(Guarded|Real|Office)/);
  });
  test("the secure-link picker shows the box and sends the tick", () => {
    const page = readFileSync("src/routes/my-job.$token.tsx", "utf8");
    expect(page).toContain("data.piesa.thirtyDayAck.wording");
    expect(page).toContain("understandsThirtyDays: understands");
    expect(fns).toContain("thirtyDayAck: { needed: ack.needed, wording: ack.wording }");
  });
});

// F17: the legacy signed-in window picker is refused without the 30-day tick; with it, the ack is recorded then the times saved.
describe("submitOwnerPiesaWindows requires the 30-day acknowledgement (every owner path)", () => {
  type Row = Record<string, unknown>;
  const JOB = "00000000-0000-0000-0000-0000000000a7", OWNER = "00000000-0000-0000-0000-0000000000a8";
  let tables: Record<string, Row[]> = {};
  const reset = () => {
    tables = {
      jobs: [{ id: JOB, stage: "measured_quote_accepted", source: "website" }],
      job_assignments: [],
      // Round 1 already happened the old way and its times have passed (expired), reopened → the owner may pick again.
      appointment_proposals: [{ job_id: JOB, piesa_window_round: 1, created_at: "2026-10-01T00:00:00Z", status: "expired", starts_at: "2026-10-03T00:00:00Z" }],
      workflow_events: [], quotes: [],
    };
  };
  const builder = (t: string) => {
    const f: ((r: Row) => boolean)[] = [];
    let op: "select" | "insert" | "update" = "select", patch: unknown = null, one = false, count = false;
    const b: Record<string, unknown> = {
      select: (_c?: string, o?: { count?: string }) => { if (op === "select") count = o?.count === "exact"; return b; },
      insert: (p: unknown) => { op = "insert"; patch = p; return b; }, update: (p: unknown) => { op = "update"; patch = p; return b; },
      eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return b; }, in: () => b, order: () => b, limit: () => b,
      not: (c: string, _o: string, v: unknown) => { f.push((r) => (v === null ? r[c] != null : true)); return b; },
      single: () => { one = true; return b; }, maybeSingle: () => { one = true; return b; },
      then: (res: (v: unknown) => unknown) => {
        const rows = (tables[t] ??= []);
        if (op === "insert") { rows.push(...(Array.isArray(patch) ? patch as Row[] : [patch as Row])); return Promise.resolve({ data: null, error: null }).then(res); }
        if (op === "update") return Promise.resolve({ data: null, error: null }).then(res);
        const out = rows.filter((r) => f.every((x) => x(r)));
        return Promise.resolve(count ? { data: null, count: out.length, error: null } : { data: one ? out[0] ?? null : out, error: null }).then(res);
      },
    };
    return b;
  };
  class WorkflowError extends Error {}
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: builder } }));
  mock.module("../src/lib/workflow.server", () => ({
    WorkflowError, piesaRequestFacts: async () => ({}),
    logEvent: async (job: string, _a: string | null, type: string, summary: string, details?: unknown) => { (tables["workflow_events"] ??= []).push({ job_id: job, event_type: type, summary, details: details ?? {} }); },
  }));
  mock.module("../src/lib/electrical-clearance.server", () => ({ clearanceFacts: async () => ({}) }));
  mock.module("../src/lib/visit-events.server", () => ({ timesReopenedSince: async () => true }));
  const { allowedPiesaDays } = require("../src/lib/piesa-windows.core") as typeof import("../src/lib/piesa-windows.core");
  const picks = allowedPiesaDays().slice(0, 3).map((date) => ({ date, slot: "8-10" as const }));
  const meta = { ip: null, userAgent: null };

  test("not ticked → refused with the plain message and nothing saved", async () => {
    reset();
    const { submitOwnerPiesaWindows } = await import("../src/lib/allocation.server");
    const { piesaWindowBlockers } = await import("../src/lib/piesa-windows.core");
    expect(piesaWindowBlockers(picks)).toEqual([]);
    await expect(submitOwnerPiesaWindows(JOB, OWNER, picks, { understandsThirtyDays: undefined, ...meta })).rejects.toThrow(/30/);
    expect(tables["appointment_proposals"]!.length).toBe(1);
    expect(tables["workflow_events"]!.some((e) => e["event_type"] === OWNER_THIRTY_DAY_ACK_EVENT)).toBe(false);
  });
  test("ticked → the acknowledgement is recorded once, then the times are saved", async () => {
    reset();
    const { submitOwnerPiesaWindows } = await import("../src/lib/allocation.server");
    const r = await submitOwnerPiesaWindows(JOB, OWNER, picks, { understandsThirtyDays: true, ...meta });
    expect(r).toEqual({ ok: true, round: 2 });
    expect(tables["workflow_events"]!.filter((e) => e["event_type"] === OWNER_THIRTY_DAY_ACK_EVENT)).toHaveLength(1);
    expect(tables["appointment_proposals"]!.filter((p) => p["piesa_window_round"] === 2)).toHaveLength(3);
  });
});

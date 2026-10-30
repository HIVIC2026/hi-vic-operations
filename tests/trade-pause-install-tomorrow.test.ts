// "Pause all trade messages" (Jo 30 Oct 2026): the REAL install-tomorrow path (`textInstallerInstallTomorrow`) through the
// REAL `sendRealSms` and the REAL pause read. While paused the text is held (recorded "blocked", key not claimed) and
// Twilio is never called. Install tomorrow is day-bound: its prepared event is already written, so it is NOT re-sent
// after unpausing (listed as "lost, stale anyway" in the report). In-memory fake database; Twilio faked.
import { beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";

setSystemTime(new Date("2026-10-22T06:00:00Z")); // 5pm Melbourne, the afternoon before: due, outside quiet hours

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" = "select";
  let inserted: Row | null = null;
  const res = () => {
    if (op === "insert") return { data: inserted ? { id: inserted["id"] } : null, error: null };
    return { data: (tables[t] ?? []).filter((x) => filters.every((f) => f(x))), error: null };
  };
  const one = async () => { const r = res(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
    contains: (k: string, v: Row) => { filters.push((r) => Object.entries(v).every(([kk, vv]) => (r[k] as Row | undefined)?.[kk] === vv)); return q; },
    not: () => q, gt: () => q, lt: () => q, or: () => q, order: () => q, limit: () => q,
    insert: (r: Row) => { op = "insert"; inserted = { id: crypto.randomUUID(), ...r }; (tables[t] ??= []).push(inserted); return q; },
    update: () => { op = "update"; return q; },
    maybeSingle: one, single: one,
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (job_id: string, _a: unknown, event_type: string, summary: string, details: Row = {}) => { (tables["workflow_events"] ??= []).push({ job_id, event_type, summary, details }); },
}));
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => true, hasCurrentOwnerContactConsent: async () => true }));
mock.module("../src/lib/job-live.server", () => ({ jobDeletedBlocker: async () => null }));
mock.module("../src/lib/visit-allocation.server", () => ({ allocatedPersonFor: async () => null }));
mock.module("../src/lib/swms-link.server", () => ({ unsignedSwmsSignerLinks: async () => [], swmsSignLink: async () => "x" }));
const twilio: string[] = [];
mock.module("../src/lib/twilio-au1.server", () => ({
  au1Configured: () => true,
  au1SendMessage: async (p: URLSearchParams) => { twilio.push(p.get("Body") ?? ""); return { ok: true, status: 201, text: JSON.stringify({ sid: "SM1" }) }; },
}));
process.env["TWILIO_FROM_NUMBER"] = "+61480000000";

const { textInstallerInstallTomorrow } = await import("../src/lib/installer-texts.server");
const BOOKING = { id: "BK1", scheduled_start: "2026-10-23T00:00:00Z" }; // 11am Melbourne tomorrow

beforeEach(() => {
  twilio.length = 0;
  tables = {
    workflow_settings: [{ id: 1, trade_messages_paused: true, daily_mitti_text_enabled: false, sms_message_switches: { install_tomorrow: true } }],
    jobs: [{ id: "J1", job_number: "HV-1001", source: "website", channel: "hivic_sourced", deleted_at: null, properties: { address_line: "1 Main St", suburb: "Preston" } }],
    job_assignments: [{ job_id: "J1", role: "installer", active: true, business_id: "B1" }],
    businesses: [{ id: "B1", name: "Acme", signer_mobile: "0412 345 678", phone: null, onboarding_notes: null, is_active: true, approved_at: "2026-10-01T00:00:00Z" }],
    workflow_events: [], sms_messages: [], sms_optouts: [], job_communications: [],
  };
});

describe("install tomorrow while paused (real path)", () => {
  test("held by the pause: recorded blocked under a non-claiming key, Twilio never called", async () => {
    const r = await textInstallerInstallTomorrow("J1", BOOKING);
    expect(r).toBe("installer sms blocked: Trade messages paused");
    expect(twilio).toHaveLength(0);
    const rows = tables["sms_messages"]!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ message_type: "install_tomorrow", status: "blocked", detail: "Trade messages paused" });
    expect(String(rows[0]!["idempotency_key"])).toContain("#held:");
  });

  test("unpaused → the same real path sends", async () => {
    tables["workflow_settings"]![0]!["trade_messages_paused"] = false;
    expect(await textInstallerInstallTomorrow("J1", BOOKING)).toBe("installer sms sent: Twilio AU1 accepted");
    expect(twilio).toHaveLength(1);
  });
});

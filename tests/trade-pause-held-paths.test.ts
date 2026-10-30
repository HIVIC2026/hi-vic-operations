// "Pause all trade messages" fix round 1 (Jo 30 Oct 2026): messages that are not tied to one day are HELD, not lost.
// While paused, each of these returns "held" BEFORE writing its once-only claim, so the existing retry (sweep / re-sync /
// next trigger) sends it once unpaused: safety plan (SWMS) sign link, boss price link, fixes-times link, PIESA offer
// text, ESC notice link (a paused attempt never counts as one of the 3 tries). In-memory fake database; senders faked.
import { beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { RECTIFICATION_OUTCOMES } from "../src/lib/official-short.core";

setSystemTime(new Date("2026-10-22T02:00:00Z")); // 1pm Melbourne: outside SMS quiet hours

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  let rows = () => [...(tables[t] ?? [])];
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" = "select";
  let head = false, count = false;
  let inserted: Row | null = null;
  const res = () => {
    const r = rows().filter((x) => filters.every((f) => f(x)));
    if (op === "insert") return { data: inserted ? { id: inserted["id"] } : null, error: null };
    return { data: head ? null : r, count: count ? r.length : undefined, error: null };
  };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => { if (o?.head) head = true; if (o?.count) count = true; return q; },
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
    contains: (k: string, v: Row) => { filters.push((r) => Object.entries(v).every(([kk, vv]) => (r[k] as Row | undefined)?.[kk] === vv)); return q; },
    not: () => q, gt: () => q, lt: () => q, or: () => q, order: () => q, limit: () => q, like: () => q, ilike: () => q,
    insert: (r: Row) => { op = "insert"; inserted = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }; (tables[t] ??= []).push(inserted); return q; },
    update: () => { op = "update"; return q; },
    maybeSingle: async () => { const r = res(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
    single: async () => { const r = res(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
    then: (ok: (v: unknown) => unknown) => ok(res()),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (job_id: string, _a: unknown, event_type: string, summary: string, details: Row = {}) => { (tables["workflow_events"] ??= []).push({ job_id, event_type, summary, details }); },
}));
let paused: string | null = "Trade messages paused";
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => paused }));
mock.module("../src/lib/in-house-suppression.server", () => ({ inHouseDispatchSkip: async () => null, readInHouseDispatchState: async () => ({ held: new Set<string>(), failed: false }) }));
const sms: { type: string; key: string }[] = [];
const emails: string[] = [];
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (p: { type: string; idempotencyKey: string }) => { sms.push({ type: p.type, key: p.idempotencyKey }); return { status: "sent", detail: "ok", sid: "x" }; } }));
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { to: string }) => { emails.push(p.to); return { channel: "email", to: p.to, status: "sent", detail: "ok" }; } }));
mock.module("../src/lib/installer-price.server", () => ({ readInstallerPrice: async () => null, entriesWithInstallerPrice: async (_j: string, e: unknown[]) => e }));
mock.module("../src/lib/rectification.server", () => ({ rectificationWindowsExist: async () => false }));
mock.module("../src/lib/swms.server", () => ({ loadSwms: async () => ({ plan: { signers: [{ key: "w:W1", name: "Crew One" }] }, signatures: [], status: { complete: false } }) }));
mock.module("../src/lib/swms-link.server", () => ({ swmsSignLink: async () => "https://example.test/sp/x", unsignedSwmsSignerLinks: async () => null }));
const WORKER = { id: "W1", business_id: "B1", full_legal_name: "Crew One", email: "crew@acme.example", mobile: "0412 000 111", removed_at: null, trade_role: "installer" };
mock.module("../src/lib/esc-collection-notice.server", () => ({
  NOTICE_WORKER_COLS: "*",
  businessNoticeStatuses: async () => [],
  findNoticeLink: async () => null,
  loadNoticeWorkers: async () => [WORKER],
  noticeAckMap: async () => new Map([["W1", false]]),
  selfNoticeWorker: () => null,
  // The real rule reads COLLECTION_NOTICE_SEND_EVENT rows; here: every recorded attempt for the worker.
  noticeSendHistory: async () => {
    const { COLLECTION_NOTICE_SEND_EVENT: SEND } = await import("../src/lib/esc-collection-notice.core");
    const mine = (tables["admin_config_events"] ?? []).filter((e) => e["event_type"] === SEND && (e["details"] as Row)["worker_id"] === "W1");
    return new Map([["W1", mine.map((e) => ({ attempt: (e["details"] as Row)["attempt"] as number, at: (e["details"] as Row)["at"] as string, held: false }))]]);
  },
}));

const { textBossPriceLink } = await import("../src/lib/boss-price-link.server");
const { textFixesTimesLink } = await import("../src/lib/fixes-times-link.server");
const { textSwmsSignLinks } = await import("../src/lib/swms-sign-text.server");
const { textElectricianAboutOffer } = await import("../src/lib/trade-messages.server");
const { sweepCollectionNoticeLinks } = await import("../src/lib/esc-collection-notice-send.server");
const { COLLECTION_NOTICE_SEND_EVENT, COLLECTION_NOTICE_LINK_EVENT } = await import("../src/lib/esc-collection-notice.core");

const events = (type: string) => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === type);
const BIZ = { id: "B1", name: "Acme", signer_mobile: "0412 345 678", phone: null, email: "boss@acme.example", signer_email: null, onboarding_notes: null };

beforeEach(() => {
  paused = "Trade messages paused"; sms.length = 0; emails.length = 0;
  tables = {
    jobs: [{ id: "J1", job_number: "HV-1001", source: "website", channel: "installer_sourced", deleted_at: null, installation_completed_at: null, originating_installer_business_id: "B1", properties: { address_line: "1 Main St", suburb: "Preston" } }],
    businesses: [BIZ, { id: "E1", name: "Sparks", signer_mobile: "0412 555 666", phone: null, email: "sparks@x.example", signer_email: null, onboarding_notes: null }],
    job_assignments: [
      { job_id: "J1", role: "installer", active: true, business_id: "B1" },
      { job_id: "J1", role: "electrician", active: true, business_id: "E1", profiles: { full_name: "Sam Sparks", phone: "0412 777 888" }, businesses: { id: "E1", signer_mobile: null, phone: null, onboarding_notes: null } },
    ],
    partner_workers: [{ id: "W1", business_id: "B1", mobile: "0412 000 111", removed_at: null }],
    partner_offers: [{ id: "O1", job_id: "J1", business_id: "E1", kind: "piesa", status: "pending", summary: { suburb: "Preston", job_number: "HV-1001", electrician_rate_inc_gst: 300 }, offered_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86_400_000).toISOString() }],
    appointment_proposals: [], workflow_events: [], admin_config_events: [], sms_messages: [],
  };
});

describe("held before the claim while paused; sent once unpaused", () => {
  test("boss price link", async () => {
    expect(await textBossPriceLink("J1", { auditId: "A1", completedAt: new Date().toISOString(), entries: [] })).toBe("held: Trade messages paused");
    expect(events("boss_price_link_texted").length + sms.length).toBe(0);
    paused = null;
    expect(await textBossPriceLink("J1", { auditId: "A1", completedAt: new Date().toISOString(), entries: [] })).toMatch(/^boss sms sent/);
    expect(sms.map((s) => s.type)).toEqual(["boss_price_link"]);
  });

  test("fixes-times link", async () => {
    const i = { auditId: "A3", completedAt: new Date().toISOString(), short: { rectificationOutcome: RECTIFICATION_OUTCOMES[1] } };
    expect(await textFixesTimesLink("J1", i)).toBe("held: Trade messages paused");
    expect((tables["workflow_events"] ?? []).length + sms.length).toBe(0);
    paused = null;
    expect(await textFixesTimesLink("J1", i)).toMatch(/^fixes times sms sent/);
    expect(sms.map((s) => s.type)).toEqual(["fixes_times_link"]);
  });

  test("safety plan (SWMS) sign link", async () => {
    const booking = { id: "BK1", scheduled_start: new Date(Date.now() + 3 * 86_400_000).toISOString() };
    expect(await textSwmsSignLinks("J1", booking)).toEqual(["held: Trade messages paused"]);
    expect((tables["workflow_events"] ?? []).length + sms.length).toBe(0);
    paused = null;
    expect(await textSwmsSignLinks("J1", booking)).toEqual(["Crew One: sent"]);
    expect(sms.map((s) => s.type)).toEqual(["swms_sign_link"]);
  });

  test("PIESA offer text", async () => {
    expect(await textElectricianAboutOffer("O1")).toBe("held: Trade messages paused");
    expect((tables["workflow_events"] ?? []).length + sms.length).toBe(0);
    paused = null;
    expect(await textElectricianAboutOffer("O1")).toMatch(/^electrician sms sent/);
    expect(sms.map((s) => s.type)).toEqual(["piesa_offer"]);
  });

  test("ESC notice link: a paused sweep issues nothing and records no attempt; unpaused → attempt 1", async () => {
    Object.assign(tables["businesses"]![0]!, { onboarding_status: "approved", is_active: true });
    const r1 = await sweepCollectionNoticeLinks();
    expect(r1.sent).toBe(0);
    const recorded = (tables["admin_config_events"] ?? []).filter((e) => e["event_type"] === COLLECTION_NOTICE_SEND_EVENT || e["event_type"] === COLLECTION_NOTICE_LINK_EVENT);
    expect(recorded).toHaveLength(0);
    expect(sms.length + emails.length).toBe(0);
    paused = null;
    const r2 = await sweepCollectionNoticeLinks();
    expect(r2.sent).toBe(1);
    const sends = (tables["admin_config_events"] ?? []).filter((e) => e["event_type"] === COLLECTION_NOTICE_SEND_EVENT);
    expect(sends.map((e) => (e["details"] as Row)["attempt"])).toEqual([1]);
    expect(sms.map((s) => s.type)).toEqual(["esc_notice_link"]);
  });
});

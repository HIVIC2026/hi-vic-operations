// Batch 2, item 1 (Jo 29 Oct 2026): a one-off text held by the 8pm–7am quiet hours is sent at 7am — but only if what it
// says is still true. The 15-minute tick reads quiet-hours holds from the last 24h whose real key is still unclaimed,
// re-checks each type's own "still true" fact, and re-sends the stored body through `sendRealSms` with the REAL key.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { HELD_KEY_MARK } from "../src/lib/sms.core";
import { SMS_QUIET_REASON } from "../src/lib/quote-hold.core";
import { QUIET_RESEND_TYPES, quietResendDue, type HeldRow } from "../src/lib/quiet-held-texts.core";

const HELD_AT = "2026-10-28T11:00:00Z"; // 10pm Melbourne (AEDT)
const SEVEN_05 = "2026-10-28T20:05:00Z"; // 7:05am Melbourne next morning
const SIX_55 = "2026-10-28T19:55:00Z"; // 6:55am Melbourne — still quiet
const LIVE_JOB = { source: "base44", stage: "ready_check_ready_to_schedule", deleted_at: null, qa_archived_at: null };

const held = (over: Partial<HeldRow> = {}, attempt = "a1"): HeldRow => ({
  idempotency_key: `spot-saved-confirmation:v1:+61412345678${HELD_KEY_MARK}${attempt}`, message_type: "spot_saved", job_id: "j1", business_id: null,
  to_number: "+61412345678", body: "Home Insulation Victoria: Your spot is saved.", status: "blocked", detail: SMS_QUIET_REASON,
  created_at: HELD_AT, job: LIVE_JOB, ...over,
});

describe("quietResendDue (pure)", () => {
  test("covers exactly the 14 spec types", () => {
    expect([...QUIET_RESEND_TYPES].sort()).toEqual([
      "boss_price_link", "deposit_release", "fixes_times_link", "install_clearance", "install_no_access", "piesa_owner_confirm", "piesa_owner_fixes_confirm",
      "quote_ready", "ready_check_booked_installer", "ready_check_days_suggested", "spot_saved", "veec_sign_reminder", "veec_sign_request", "visit_new_times",
    ]);
  });
  test("held at 10pm, real key unclaimed, 7:05am → due", () => {
    expect(quietResendDue([held()], new Set(), SEVEN_05)).toEqual([held()]);
  });
  test("6:55am → nothing (still quiet hours)", () => {
    expect(quietResendDue([held()], new Set(), SIX_55)).toEqual([]);
  });
  test("real key already claimed → nothing", () => {
    expect(quietResendDue([held()], new Set(["spot-saved-confirmation:v1:+61412345678"]), SEVEN_05)).toEqual([]);
  });
  test("held 25h ago → nothing", () => {
    expect(quietResendDue([held({ created_at: "2026-10-27T19:05:00Z" })], new Set(), SEVEN_05)).toEqual([]);
  });
  test("two holds one send: two held rows for one real key → one due (the first hold)", () => {
    const later = held({ created_at: "2026-10-28T12:00:00Z" }, "a2");
    const due = quietResendDue([later, held()], new Set(), SEVEN_05);
    expect(due).toHaveLength(1);
    expect(due[0]!.created_at).toBe(HELD_AT);
  });
  test("type not in the list → nothing", () => {
    expect(quietResendDue([held({ message_type: "job_offer", idempotency_key: `job-offer:v1:o1${HELD_KEY_MARK}a1` })], new Set(), SEVEN_05)).toEqual([]);
  });
  test("qa_test job → nothing; cancelled / deleted job → nothing", () => {
    expect(quietResendDue([held({ job: { ...LIVE_JOB, source: "qa_test" } })], new Set(), SEVEN_05)).toEqual([]);
    expect(quietResendDue([held({ job: { ...LIVE_JOB, stage: "cancelled" } })], new Set(), SEVEN_05)).toEqual([]);
    expect(quietResendDue([held({ job: { ...LIVE_JOB, deleted_at: "2026-10-28T12:00:00Z" } })], new Set(), SEVEN_05)).toEqual([]);
    expect(quietResendDue([held({ job: null })], new Set(), SEVEN_05)).toEqual([]);
  });
  test("a non-held row, or a key that also has a different hold (e.g. switched off), is left alone", () => {
    expect(quietResendDue([held({ idempotency_key: "spot-saved-confirmation:v1:+61412345678" })], new Set(), SEVEN_05)).toEqual([]);
    const off = held({ detail: "\"Spot saved confirmation\" texts are switched off", created_at: "2026-10-28T20:00:00Z" }, "a2");
    expect(quietResendDue([held(), off], new Set(), SEVEN_05)).toEqual([]);
  });
  test("the tick runs the sweep", () => {
    expect(readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8")).toContain("sweepQuietHeldTexts()");
  });
});

// ---- server: mocked backend, recorder sender ----
type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let failTable: string | null = null;
const calls: { t: string; op: string; args: unknown[] }[] = [];
const builder = (t: string) => {
  const f: ((r: Row) => boolean)[] = [];
  let one = false;
  let sort: { c: string; asc: boolean } | null = null;
  const b: Record<string, unknown> = {
    select: () => b, limit: () => b,
    order: (c: string, o?: { ascending?: boolean }) => { calls.push({ t, op: "order", args: [c, o] }); sort = { c, asc: o?.ascending !== false }; return b; },
    eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return b; },
    neq: (c: string, v: unknown) => { f.push((r) => r[c] !== v); return b; },
    in: (c: string, v: unknown[]) => { calls.push({ t, op: "in:" + c, args: [v.length] }); f.push((r) => v.includes(r[c])); return b; },
    gte: (c: string, v: string) => { f.push((r) => String(r[c]) >= v); return b; },
    like: (c: string, v: string) => { const p = v.replace(/^%|%$/g, ""); f.push((r) => String(r[c]).includes(p)); return b; },
    contains: (c: string, v: Record<string, unknown>) => { f.push((r) => Object.entries(v).every(([k, x]) => (r[c] as Row | null)?.[k] === x)); return b; },
    maybeSingle: () => { one = true; return b; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => { const out = (tables[t] ?? []).filter((r) => f.every((x) => x(r)));
      if (sort) { const { c, asc } = sort; out.sort((x, y) => (String(x[c]) < String(y[c]) ? -1 : String(x[c]) > String(y[c]) ? 1 : 0) * (asc ? 1 : -1)); } return Promise.resolve(failTable === t ? { data: null, error: { message: "read failed" } } : { data: one ? out[0] ?? null : out, error: null }).then(res, rej); },
  };
  return b;
};
const sent: { type: string; key: string; to: string; body: string; jobId: string | null; businessId: string | null; event: unknown }[] = [];
const facts = {
  piesa: null as null | { piesaRecordId: string; confirmation: unknown },
  fixes: null as null | { recordId: string; confirmation: unknown },
  installDay: { clearance: { cleared: true, timingDate: "2026-10-28" }, booked: null as unknown },
  currentBooking: null as unknown,
  turn: "installer_to_answer",
  windowsExist: false,
  fixesAuditId: "audit1" as string | null,
  price: null as unknown,
};
// Copies of the real exports (mock.module patches the live module in place), put back in afterAll so the mocks
// don't leak into later files in the same run.
const realClient = { ...(await import("@/integrations/supabase/client.server")) };
const realSms = { ...(await import("../src/lib/sms.server")) };
const realPiesaConfirm = { ...(await import("../src/lib/piesa-owner-confirm.server")) };
const realFixesConfirm = { ...(await import("../src/lib/piesa-fixes-confirm.server")) };
const realInstallDays = { ...(await import("../src/lib/install-days.server")) };
const realVisitEvents = { ...(await import("../src/lib/visit-events.server")) };
const realRcTimes = { ...(await import("../src/lib/ready-check-times.server")) };
const realRect = { ...(await import("../src/lib/rectification.server")) };
const realInstallerPrice = { ...(await import("../src/lib/installer-price.server")) };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: builder } }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (i: { type: string; idempotencyKey: string; to: string; body: string; jobId?: string | null; businessId?: string | null; event?: unknown }) => {
  sent.push({ type: i.type, key: i.idempotencyKey, to: i.to, body: i.body, jobId: i.jobId ?? null, businessId: i.businessId ?? null, event: i.event }); return { status: "sent", detail: "ok", sid: "SM1" };
} }));
mock.module("../src/lib/piesa-owner-confirm.server", () => ({ ownerPiesaConfirmFacts: async () => facts.piesa }));
mock.module("../src/lib/piesa-fixes-confirm.server", () => ({ ownerFixesConfirmFacts: async () => facts.fixes }));
mock.module("../src/lib/install-days.server", () => ({ installDayContext: async () => facts.installDay }));
mock.module("../src/lib/visit-events.server", () => ({ currentBooking: async () => facts.currentBooking }));
mock.module("../src/lib/ready-check-times.server", () => ({ readyCheckTurnFor: async () => facts.turn }));
mock.module("../src/lib/rectification.server", () => ({ rectificationWindowsExist: async () => facts.windowsExist, fixesTimesFacts: async () => ({ auditId: facts.fixesAuditId }) }));
mock.module("../src/lib/installer-price.server", () => ({ readInstallerPrice: async () => facts.price }));
afterAll(() => {
  mock.module("@/integrations/supabase/client.server", () => realClient);
  mock.module("../src/lib/sms.server", () => realSms);
  mock.module("../src/lib/piesa-owner-confirm.server", () => realPiesaConfirm);
  mock.module("../src/lib/piesa-fixes-confirm.server", () => realFixesConfirm);
  mock.module("../src/lib/install-days.server", () => realInstallDays);
  mock.module("../src/lib/visit-events.server", () => realVisitEvents);
  mock.module("../src/lib/ready-check-times.server", () => realRcTimes);
  mock.module("../src/lib/rectification.server", () => realRect);
  mock.module("../src/lib/installer-price.server", () => realInstallerPrice);
});

const JOB = { id: "j1", ...LIVE_JOB, channel: "installer_sourced" };
beforeEach(() => {
  sent.length = 0; calls.length = 0; failTable = null;
  tables = { sms_messages: [held()], jobs: [JOB], lead_campaign_responses: [{ job_id: "j1", spot_saved_at: "2026-10-28T10:59:00Z", opted_out_at: null }] };
  Object.assign(facts, { piesa: null, fixes: null, installDay: { clearance: { cleared: true, timingDate: "2026-10-28" }, booked: null }, currentBooking: null, turn: "installer_to_answer", windowsExist: false, fixesAuditId: "audit1", price: null });
});

describe("sweepQuietHeldTexts", () => {
  test("due + still true → sendRealSms once with the REAL key, the stored body and event.at = hold time", async () => {
    const { sweepQuietHeldTexts } = await import("../src/lib/quiet-held-texts.server");
    expect(await sweepQuietHeldTexts(SEVEN_05)).toEqual({ sent: 1, skipped: 0 });
    expect(sent).toEqual([{ type: "spot_saved", key: "spot-saved-confirmation:v1:+61412345678", to: "+61412345678", body: "Home Insulation Victoria: Your spot is saved.", jobId: "j1", businessId: null, event: { at: HELD_AT, current: true } }]);
  });
  test("reads holds oldest first and checks real keys 100 per call", async () => {
    tables["sms_messages"] = Array.from({ length: 150 }, (_, i) => held({ idempotency_key: `spot-saved-confirmation:v1:+614123456${String(i).padStart(2, "0")}${HELD_KEY_MARK}a`, job_id: "gone" }));
    const { sweepQuietHeldTexts } = await import("../src/lib/quiet-held-texts.server");
    await sweepQuietHeldTexts(SEVEN_05);
    expect(calls.some((c) => c.op === "order" && c.args[0] === "created_at" && (c.args[1] as { ascending?: boolean })?.ascending === true)).toBe(true);
    expect(calls.filter((c) => c.op === "in:idempotency_key").map((c) => c.args[0])).toEqual([100, 50]);
  });
  test("during quiet hours nothing is read or sent", async () => {
    const { sweepQuietHeldTexts } = await import("../src/lib/quiet-held-texts.server");
    expect(await sweepQuietHeldTexts(SIX_55)).toEqual({ sent: 0, skipped: 0 });
    expect(sent).toEqual([]);
  });
  test("still true is false (spot no longer saved) → not sent", async () => {
    tables["lead_campaign_responses"] = [{ job_id: "j1", spot_saved_at: null, opted_out_at: null }];
    const { sweepQuietHeldTexts } = await import("../src/lib/quiet-held-texts.server");
    expect(await sweepQuietHeldTexts(SEVEN_05)).toEqual({ sent: 0, skipped: 1 });
    expect(sent).toEqual([]);
  });
  test("real key already in sms_messages → not sent", async () => {
    tables["sms_messages"]!.push({ ...held(), idempotency_key: "spot-saved-confirmation:v1:+61412345678", status: "sent", detail: "ok" });
    const { sweepQuietHeldTexts } = await import("../src/lib/quiet-held-texts.server");
    expect(await sweepQuietHeldTexts(SEVEN_05)).toEqual({ sent: 0, skipped: 0 });
    expect(sent).toEqual([]);
  });
});

describe("stale: one per type's still-true reader", () => {
  const row = (type: string, key: string, over: Partial<HeldRow> = {}) => held({ message_type: type, idempotency_key: `${key}${HELD_KEY_MARK}a1`, ...over });
  const check = async (type: string, key: string, setFresh: () => void, setStale: () => void, over: Partial<HeldRow> = {}) => {
    const { STILL_TRUE } = await import("../src/lib/quiet-held-texts.server");
    const r = row(type, key, over);
    setFresh(); expect(await STILL_TRUE[type as keyof typeof STILL_TRUE](r)).toBe(true);
    setStale(); expect(await STILL_TRUE[type as keyof typeof STILL_TRUE](r)).toBe(false);
  };
  test("spot_saved: owner opted out of the campaign", () => check("spot_saved", "spot-saved-confirmation:v1:+61412345678",
    () => { tables["lead_campaign_responses"] = [{ job_id: "j1", spot_saved_at: "2026-10-28T10:59:00Z", opted_out_at: null }]; },
    () => { tables["lead_campaign_responses"] = [{ job_id: "j1", spot_saved_at: "2026-10-28T10:59:00Z", opted_out_at: "2026-10-28T12:00:00Z" }]; }));
  test("quote_ready: quote no longer issued + released", () => check("quote_ready", "quote-ready:v1:q1",
    () => { tables["quotes"] = [{ id: "q1", job_id: "j1", status: "issued", release_state: "released" }]; },
    () => { tables["quotes"] = [{ id: "q1", job_id: "j1", status: "accepted", release_state: "released" }]; }));
  test("piesa_owner_confirm: owner already confirmed", () => check("piesa_owner_confirm", "piesa-owner-confirm:v1:j1:p1:request",
    () => { facts.piesa = { piesaRecordId: "p1", confirmation: null }; },
    () => { facts.piesa = { piesaRecordId: "p1", confirmation: { at: "2026-10-28T12:00:00Z" } }; }));
  test("piesa_owner_confirm: a newer PIESA record replaced the one texted about", () => check("piesa_owner_confirm", "piesa-owner-confirm:v1:j1:p1:day1",
    () => { facts.piesa = { piesaRecordId: "p1", confirmation: null }; },
    () => { facts.piesa = { piesaRecordId: "p2", confirmation: null }; }));
  test("piesa_owner_fixes_confirm: owner already confirmed the fixes", () => check("piesa_owner_fixes_confirm", "piesa-owner-fixes-confirm:v1:j1:r1:request",
    () => { facts.fixes = { recordId: "r1", confirmation: null }; },
    () => { facts.fixes = { recordId: "r1", confirmation: { at: "x" } }; }));
  test("veec_sign_request: owner has signed", () => check("veec_sign_request", "veec-sign:v1:j1:request",
    () => { tables["customer_assignments"] = [{ job_id: "j1", record_kind: "final_veec_assignment", status: "pending", consumer_signed_at: null }]; },
    () => { tables["customer_assignments"] = [{ job_id: "j1", record_kind: "final_veec_assignment", status: "pending", consumer_signed_at: "2026-10-28T12:00:00Z" }]; }));
  test("veec_sign_reminder: owner has signed", () => check("veec_sign_reminder", "veec-sign:v1:j1:day3",
    () => { tables["customer_assignments"] = [{ job_id: "j1", record_kind: "final_veec_assignment", status: "pending", consumer_signed_at: null }]; },
    () => { tables["customer_assignments"] = [{ job_id: "j1", record_kind: "final_veec_assignment", status: "pending", consumer_signed_at: "2026-10-28T12:00:00Z" }]; }));
  const install = (id: string) => ({ id, job_id: "j1", kind: "installation", status: "confirmed", scheduled_start: "2026-11-05T22:00:00Z" });
  test("deposit_release: a new install day was booked overnight", () => check("deposit_release", "deposit-release:v1:b1:sms",
    () => { tables["bookings"] = []; }, () => { tables["bookings"] = [install("b2")]; }));
  test("deposit_release: job cancelled", () => check("deposit_release", "deposit-release:v1:b1:sms",
    () => { tables["jobs"] = [JOB]; tables["bookings"] = []; }, () => { tables["jobs"] = [{ ...JOB, stage: "cancelled" }]; }));
  test("install_no_access: a new install day was booked overnight (the reported booking itself does not count)", () => check("install_no_access", "install-no-access:v1:b1:sms",
    () => { tables["bookings"] = [install("b1")]; }, () => { tables["bookings"] = [install("b1"), install("b2")]; }));
  test("install_no_access: job deleted", () => check("install_no_access", "install-no-access:v1:b1:sms",
    () => { tables["jobs"] = [JOB]; tables["bookings"] = []; }, () => { tables["jobs"] = [{ ...JOB, deleted_at: "2026-10-28T12:00:00Z" }]; }));
  test("veec: a read error fails closed", () => check("veec_sign_reminder", "veec-sign:v1:j1:day1",
    () => { tables["customer_assignments"] = [{ job_id: "j1", record_kind: "final_veec_assignment", status: "pending", consumer_signed_at: null }]; },
    () => { failTable = "customer_assignments"; }));
  test("visit_new_times: the visit was rebooked", () => check("visit_new_times", "visit-new-times:v1:j1:bk1:sms",
    () => { tables["workflow_events"] = [{ job_id: "j1", event_type: "visit_new_times_notice", details: { booking_id: "bk1", kind: "ready_check" } }]; facts.currentBooking = null; },
    () => { facts.currentBooking = { id: "bk2" }; }));
  test("install_clearance: an install day is now booked", () => check("install_clearance", "install-clearance:v1:j1:2026-10-28:sms",
    () => { facts.installDay = { clearance: { cleared: true, timingDate: "2026-10-28" }, booked: null }; },
    () => { facts.installDay = { clearance: { cleared: true, timingDate: "2026-10-28" }, booked: { id: "bk" } }; }));
  test("boss_price_link: the price has been entered", () => check("boss_price_link", "boss-price-link:v1:j1",
    () => { facts.price = null; },
    () => { facts.price = { record: { price_inc_gst: 2000, included: [] }, setAt: "2026-10-28T12:00:00Z", setBy: null }; }));
  test("boss_price_link: the stored Ready Check form (the sender's entries) already has a price", () => check("boss_price_link", "boss-price-link:v1:j1",
    () => { tables["ceiling_measurements"] = [{ job_id: "j1", is_current: true, raw_snapshot: [{ label: "Notes", value: "x" }] }]; },
    () => { tables["ceiling_measurements"] = [{ job_id: "j1", is_current: true, raw_snapshot: [{ label: "Total quoted price $", value: "2400" }] }]; }));
  test("fixes_times_link: fixes times now given", () => check("fixes_times_link", "fixes-times-link:v1:j1:audit1",
    () => { facts.windowsExist = false; }, () => { facts.windowsExist = true; }));
  test("fixes_times_link: the PIESA texted about is no longer the current audit", () => check("fixes_times_link", "fixes-times-link:v1:j1:audit1",
    () => { facts.fixesAuditId = "audit1"; }, () => { facts.fixesAuditId = "audit2"; }));
  const suggested = (id: string, at: string) => ({ id, job_id: "j1", event_type: "ready_check_days_suggested", created_at: at, details: {} });
  test("ready_check_days_suggested: no longer the installer's move", () => check("ready_check_days_suggested", "rc-days-suggested:v1:j1:ev1",
    () => { tables["workflow_events"] = [suggested("ev1", "2026-10-28T10:00:00Z")]; facts.turn = "installer_to_answer"; }, () => { facts.turn = "owner_to_pick"; }));
  test("ready_check_days_suggested: a newer suggestion replaced the one texted about", () => check("ready_check_days_suggested", "rc-days-suggested:v1:j1:ev1",
    () => { tables["workflow_events"] = [suggested("ev1", "2026-10-28T10:00:00Z")]; }, () => { tables["workflow_events"] = [suggested("ev1", "2026-10-28T10:00:00Z"), suggested("ev2", "2026-10-28T12:00:00Z")]; }));
  test("ready_check_booked_installer: that time is no longer the booked Ready Check", () => check("ready_check_booked_installer", "rc-booked-installer:v1:j1:2026-10-30T23:00:00.000Z",
    () => { tables["bookings"] = [{ job_id: "j1", kind: "ready_check", status: "confirmed", scheduled_start: "2026-10-30T23:00:00.000Z" }]; },
    () => { tables["bookings"] = [{ job_id: "j1", kind: "ready_check", status: "confirmed", scheduled_start: "2026-10-31T01:00:00.000Z" }]; }));
});

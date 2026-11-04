// Part 10 Task 8: an installer's OWN customer (channel installer_sourced) never gets a pre-quote owner message —
// no estimate / Save my spot / It's your turn / "will call" / estimate reminders / quick taps. The owner's first email from
// us is the quote (Review Focus 5). The one exception (Jo 2 Nov, answer 24) is the rental quick-taps TEXT right after Add a
// job. The block is enforced in each sender's own gate (pure cores) and pinned here; HIV leads are unchanged.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { OWN_CUSTOMER_PRE_QUOTE_BLOCK, ownCustomerPreQuoteBlocker } from "../src/lib/own-customer-messages.core";
import { willCallAllowed } from "../src/lib/owner-will-call.core";
import { estimateFollowupStop } from "../src/lib/estimate-followup.core";
import { spotSavedJobBlocker, planSpotSaved } from "../src/lib/spot-saved-send.core";
import { jobWaitingForInstaller } from "../src/lib/spot-release.core";
import { readyCheckOfferStartBlockers } from "../src/lib/ready-check-times.core";
import { batchJobEligible, waitingForCallConsent } from "../src/lib/in-house-batch.core";
import { quoteChangeRows } from "../src/lib/quote-changes.core";

describe("one block list, keyed on the channel", () => {
  test("installer_sourced → blocked with the one reason; our leads and unknown channels are not", () => {
    expect(ownCustomerPreQuoteBlocker("installer_sourced")).toBe(OWN_CUSTOMER_PRE_QUOTE_BLOCK);
    expect(ownCustomerPreQuoteBlocker("hivic_sourced")).toBeNull();
    expect(ownCustomerPreQuoteBlocker(null)).toBeNull();
    expect(willCallAllowed("installer_sourced")).toBe(false);
    expect(willCallAllowed("hivic_sourced")).toBe(true);
    expect(willCallAllowed(null)).toBe(true);
  });
});

describe("each pre-quote owner sender's own gate refuses an own customer at ready_check_ready_to_schedule", () => {
  test("estimate reminders (O66–O68): stop, even if an estimate email somehow exists", () => {
    const base = { stage: "preliminary_estimate_ready", source: "website", deletedAt: null, qaArchivedAt: null, estimateEmailedAt: null, spotSavedAt: null, optedOut: false, repliedAt: null, ownerEmail: "o@example.com", done: [] };
    expect(estimateFollowupStop({ ...base, channel: "installer_sourced" })).toBe("No estimate email has been sent");
    expect(estimateFollowupStop({ ...base, channel: "installer_sourced", estimateEmailedAt: "2026-11-01T00:00:00Z" })).toBe(OWN_CUSTOMER_PRE_QUOTE_BLOCK);
    expect(estimateFollowupStop({ ...base, channel: "hivic_sourced", estimateEmailedAt: "2026-11-01T00:00:00Z" })).toBeNull();
    expect(estimateFollowupStop({ ...base, estimateEmailedAt: "2026-11-01T00:00:00Z" })).toBeNull(); // channel unknown = unchanged
  });
  test("Spot saved (O10 + text): blocked, both channels, even with a saved spot and consent", () => {
    const f = { source: "website", stage: "ready_check_ready_to_schedule", deletedAt: null, qaArchivedAt: null, spotSavedAt: null, campaignOptedOutAt: null, consent: true, commsEnabled: true, email: "o@example.com", phone: "0400000000", emailOptedOut: false, emailSuppressed: false, smsStopped: false, emailSwitchOn: true, smsSwitchOn: true, hasLink: true };
    expect(spotSavedJobBlocker({ ...f, channel: "installer_sourced" })).toBe("Spot not saved");
    expect(spotSavedJobBlocker({ ...f, channel: "installer_sourced", spotSavedAt: "2026-11-01T00:00:00Z" })).toBe(OWN_CUSTOMER_PRE_QUOTE_BLOCK);
    const p = planSpotSaved({ ...f, channel: "installer_sourced", spotSavedAt: "2026-11-01T00:00:00Z" });
    expect(p.email).toEqual({ send: false, reason: OWN_CUSTOMER_PRE_QUOTE_BLOCK });
    expect(p.sms).toEqual({ send: false, reason: OWN_CUSTOMER_PRE_QUOTE_BLOCK });
    expect(spotSavedJobBlocker({ ...f, channel: "hivic_sourced", spotSavedAt: "2026-11-01T00:00:00Z" })).toBeNull();
  });
  test("It's your turn (release): never waiting for an installer, release start refused", () => {
    expect(jobWaitingForInstaller({ channel: "installer_sourced", stage: "ready_check_ready_to_schedule", hasInstaller: false, deleted: false })).toBe(false);
    expect(jobWaitingForInstaller({ channel: "hivic_sourced", stage: "ready_check_ready_to_schedule", hasInstaller: false, deleted: false })).toBe(true);
    expect(readyCheckOfferStartBlockers({ channel: "installer_sourced", stage: "ready_check_ready_to_schedule", deleted: false, hasInstaller: false, openOffers: 0, picks: 1 }).length).toBeGreaterThan(0);
  });
  test("in-house batches: an own customer can be in a batch but is never 'waiting for call consent' (never re-asked)", () => {
    const job = { id: "j", stage: "ready_check_ready_to_schedule", channel: "installer_sourced", source: "website", deleted_at: null, spot_saved_at: null, quickTapsYes: null, optedOut: false, hasActiveInstaller: false } as Parameters<typeof batchJobEligible>[0];
    expect(batchJobEligible(job)).toBe(true);
    expect(waitingForCallConsent(job, [], "2026-11-04T00:00:00Z")).toBe(false);
  });
  test("the quote email has no 'What's changed from your estimate' box without an estimate", () => {
    expect(quoteChangeRows({ estimate: { areaM2: null, removal: null, price: null }, quote: { areaM2: 120, removal: false, price: 2098 } })).toEqual([]);
  });
});

/* ---------------------------------------------------------------- will-call sender over the real guarded path */
type Row = Record<string, unknown>;
let ledger: Row[] = []; let channel = "installer_sourced"; const providerCalls: string[] = []; const events: string[] = []; const smsCalls: string[] = [];
function from(table: string) {
  let one = false, head = false, op = "read", payload: Row = {}; const filters: ((r: Row) => boolean)[] = [];
  const tables: Record<string, Row[]> = {
    jobs: [{ id: "j", source: "website", channel, deleted_at: null, stage: "ready_check_ready_to_schedule", owners: { email: "owner@example.com", full_name: "Sarah Smith", phone: "0400000000" } }],
    workflow_events: [{ job_id: "j", "jobs.deleted_at": null, "jobs.source": "website", "jobs.channel": channel, jobs: { id: "j", channel }, event_type: "in_house_partner_call_email_pending", details: { business_id: "b", batch_id: "batch", partner_trading_name: "Rapid Insulation" } }],
    job_assignments: [{ job_id: "j", business_id: "b", role: "installer", active: true }],
    bookings: [], customer_email_optouts: [], lead_campaign_responses: [], customer_engagement_events: [],
  };
  const run = () => {
    if (table === "customer_email_sends" && op === "insert") { const r = { id: "s", status: "sending", ...payload }; ledger.push(r); return { data: one ? r : [r], error: null }; }
    const hits = (table === "customer_email_sends" ? ledger : tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (op === "update") hits.forEach((r) => Object.assign(r, payload));
    return { data: one ? hits[0] ?? null : hits, error: null, ...(head ? { count: hits.length } : {}) };
  };
  const q: any = { select: (_s: unknown, o?: { head?: boolean }) => { head = !!o?.head; return q; }, insert: (p: Row) => { op = "insert"; payload = p; return q; }, update: (p: Row) => { op = "update"; payload = p; return q; },
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; }, neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return q; }, is: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; }, not: () => q, order: () => q, limit: () => q,
    single: () => { one = true; return q; }, maybeSingle: () => { one = true; return q; }, then: (resolve: (x: unknown) => unknown) => Promise.resolve(run()).then(resolve) };
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/qa-inbox.server", () => ({ qaDeliveryHeld: async () => false, qaInboxRouteForJob: async () => null }));
mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => "https://example.com/u" }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => undefined }));
mock.module("../src/lib/hot-leads-send.server", () => ({ resendSend: async (_t: string, _s: string, _h: string, _x: string, key: string) => { providerCalls.push(key); return { outcome: "accepted", id: "p", detail: "accepted" }; } }));
const mod = await import("../src/lib/in-house-batch-email.server");
const deps = () => ({ approved: true, now: () => new Date("2026-11-03T01:00:00Z"), contactFor: async () => ({ name: "Rapid Insulation", tradingName: null, officePhone: "03 9000 0000", email: "office@rapid.example" }),
  sendSms: async (i: { idempotencyKey: string }) => { smsCalls.push(i.idempotencyKey); return { status: "sent" as const, detail: "ok", sid: null }; }, logEvent: async (_j: string, _a: unknown, type: string) => { events.push(type); return null; } });

describe("will-call sender (Part 3 Task 6) refuses an own customer before any claim, send or held note", () => {
  beforeEach(() => { ledger = []; providerCalls.length = 0; events.length = 0; smsCalls.length = 0; });
  test("own customer handed to an in-house partner: nothing sent, nothing claimed, nothing recorded", async () => {
    channel = "installer_sourced";
    expect(await mod.sendInHousePartnerCall("j", deps())).toBe("not applicable: installer's own customer");
    expect(await mod.sweepInHousePartnerCalls(deps())).toEqual({ checked: 0, sent: 0 });
    expect(ledger).toEqual([]); expect(providerCalls).toEqual([]); expect(smsCalls).toEqual([]); expect(events).toEqual([]);
  });
  test("our lead: unchanged — email claimed and sent once, then the text", async () => {
    channel = "hivic_sourced";
    expect(await mod.sendInHousePartnerCall("j", deps())).toBe("sent");
    expect(ledger).toHaveLength(1); expect(providerCalls).toEqual(["in-house-partner-call:v1:j"]); expect(smsCalls).toEqual(["in-house-partner-call:v1:j:sms"]);
  });
});

// Final review M4: the quiet-hours / recovery retry of the Spot saved text goes back through sendSpotSavedConfirmation,
// which reads jobs.channel into spotSavedJobBlocker — so an own customer is refused on the retry too.
describe("M4: the Spot saved retry carries the channel", () => {
  test("recovery sweep calls sendSpotSavedConfirmation; the sender reads channel into the plan", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const rec = readFileSync("src/lib/spot-saved-recovery.server.ts", "utf8");
    expect(rec).toContain("sendSpotSavedConfirmation(candidate.jobId, { emailOnly: candidate.emailOnly })");
    const send = readFileSync("src/lib/spot-saved-send.server.ts", "utf8");
    expect(send).toContain('select("source, stage, channel, deleted_at, qa_archived_at, owners(phone, email)")');
    expect(send).toContain("channel: (job as { channel?: string | null } | null)?.channel ?? null,");
    expect(send.indexOf("channel: (job as")).toBeLessThan(send.indexOf("smsQuietReason(now)"));
  });
});

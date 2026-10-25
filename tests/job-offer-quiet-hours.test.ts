// Decision 361 (Jo 25 Oct 2026): Ready Check job offers made after 8pm are texted at 7am. `job_offer` keeps SMS quiet
// hours; the 15-minute tick (sweepJobOfferTexts) texts pending, unexpired offers whose `job-offer:v1:{id}` key is still
// unclaimed. The offer's 24 hours run from when it was made; the email + app alert still go immediately.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SMS_MESSAGE_TYPES, smsBlocker } from "../src/lib/sms.core";
import { SMS_QUIET_REASON } from "../src/lib/quote-hold.core";
import { jobOfferCatchUpDue, jobOfferSmsKey } from "../src/lib/ready-check-offer-text.core";

const NIGHT = "2026-10-22T10:30:00Z"; // 9:30pm Melbourne (AEDT)
const SEVEN = "2026-10-22T20:05:00Z"; // 7:05am Melbourne next morning
const pending = { kind: "ready_check", status: "pending", expiresAt: "2026-10-23T10:30:00Z", claimed: false, heldReasons: [] as string[] };

describe("decision 361: job_offer keeps quiet hours", () => {
  test("the job_offer text is held 8pm–7am (never claims its key) and allowed at 7am", () => {
    expect(SMS_MESSAGE_TYPES.job_offer.quietHours).toBe(true);
    const ok = { type: "job_offer" as const, to: "0412 345 678", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false };
    expect(smsBlocker({ ...ok, nowIso: NIGHT })).toBe(SMS_QUIET_REASON);
    expect(smsBlocker({ ...ok, nowIso: SEVEN })).toBeNull();
  });
  test("catch-up: only outside quiet hours, pending + unexpired + unclaimed, and only after quiet-hours holds", () => {
    expect(jobOfferSmsKey("o1")).toBe("job-offer:v1:o1");
    expect(jobOfferCatchUpDue({ ...pending, heldReasons: [SMS_QUIET_REASON] }, SEVEN)).toBe(true);
    expect(jobOfferCatchUpDue({ ...pending, heldReasons: [SMS_QUIET_REASON] }, NIGHT)).toBe(false); // still night
    expect(jobOfferCatchUpDue({ ...pending, claimed: true }, SEVEN)).toBe(false); // already texted
    expect(jobOfferCatchUpDue({ ...pending, status: "accepted" }, SEVEN)).toBe(false);
    expect(jobOfferCatchUpDue({ ...pending, expiresAt: "2026-10-22T19:00:00Z" }, SEVEN)).toBe(false); // the 24h ran out
    expect(jobOfferCatchUpDue({ ...pending, kind: "piesa" }, SEVEN)).toBe(false);
    expect(jobOfferCatchUpDue({ ...pending, heldReasons: [SMS_QUIET_REASON, "Texts are switched off"] }, SEVEN)).toBe(false); // other holds stay as recorded
  });
  test("the tick runs the catch-up", () => {
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    expect(tick).toContain("sweepJobOfferTexts()");
  });
});

describe("sweepJobOfferTexts (mocked backend, recorder sender)", () => {
  type Row = Record<string, unknown>;
  const tables: Record<string, Row[]> = {
    partner_offers: [
      { id: "night", job_id: "j1", business_id: "b1", kind: "ready_check", status: "pending", summary: { suburb: "Reservoir", area_m2: 120 }, offered_at: "2026-10-22T10:30:00Z", expires_at: "2026-10-23T10:30:00Z" },
      { id: "sent", job_id: "j2", business_id: "b1", kind: "ready_check", status: "pending", summary: null, offered_at: "2026-10-22T03:00:00Z", expires_at: "2026-10-23T03:00:00Z" },
      { id: "off", job_id: "j3", business_id: "b1", kind: "ready_check", status: "pending", summary: null, offered_at: "2026-10-22T04:00:00Z", expires_at: "2026-10-23T04:00:00Z" },
    ],
    sms_messages: [
      { idempotency_key: "job-offer:v1:night::held::a1", status: "blocked", detail: SMS_QUIET_REASON },
      { idempotency_key: "job-offer:v1:sent", status: "sent", detail: "ok" },
      { idempotency_key: "job-offer:v1:off::held::a2", status: "blocked", detail: "Texts are switched off" },
    ],
    jobs: [{ id: "j1", source: "website" }, { id: "j2", source: "website" }, { id: "j3", source: "website" }],
    businesses: [{ id: "b1", signer_mobile: "0412 345 678", phone: null, onboarding_notes: null }],
  };
  const builder = (t: string) => {
    const f: ((r: Row) => boolean)[] = [];
    let one = false;
    const b: Record<string, unknown> = {
      select: () => b, limit: () => b,
      eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return b; },
      gt: (c: string, v: string) => { f.push((r) => String(r[c]) > v); return b; },
      like: (c: string, v: string) => { const p = v.replace(/%$/, ""); f.push((r) => String(r[c]).startsWith(p)); return b; },
      maybeSingle: () => { one = true; return b; },
      then: (res: (v: unknown) => unknown) => { const out = (tables[t] ?? []).filter((r) => f.every((x) => x(r))); return Promise.resolve({ data: one ? out[0] ?? null : out, error: null }).then(res); },
    };
    return b;
  };
  const sent: { key: string; at: string | null }[] = [];
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: builder } }));
  mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (i: { idempotencyKey: string; event?: { at: string | null } }) => { sent.push({ key: i.idempotencyKey, at: i.event?.at ?? null }); return { status: "sent", detail: "ok", sid: "SM1" }; } }));

  test("at night nothing; at 7am only the quiet-hours offer is texted, with the offer's own time (its 24h unchanged)", async () => {
    // The real HELD_KEY_MARK decides what counts as a held row; build the fixture keys from it.
    const { HELD_KEY_MARK } = await import("../src/lib/sms.core");
    tables["sms_messages"] = tables["sms_messages"]!.map((r) => ({ ...r, idempotency_key: String(r["idempotency_key"]).replace("::held::", HELD_KEY_MARK) }));
    const { sweepJobOfferTexts } = await import("../src/lib/ready-check-offer-text.server");
    expect(await sweepJobOfferTexts(new Date(NIGHT))).toEqual({ checked: 0, texted: 0, failed: 0 });
    expect(sent).toEqual([]);
    const r = await sweepJobOfferTexts(new Date(SEVEN));
    expect(r).toEqual({ checked: 3, texted: 1, failed: 0 });
    expect(sent).toEqual([{ key: "job-offer:v1:night", at: "2026-10-22T10:30:00Z" }]);
  });
});

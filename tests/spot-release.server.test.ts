// Decision 389: the release step end to end on an in-memory fake database (with the pending migration's unique claim key)
// and recorded fake senders / installer offer. Covers: Release records a PENDING release and messages only the OWNER (the
// installer offer is NOT run), REAL jobs refuse while unapproved, TEST jobs go through test-send, idempotency (one claim
// per job + release + slot), Confirm runs the existing installer offer exactly once, decline closes the job (prior_stage
// kept, one stage_changed, nothing sent), the day-2 reminder, the day-5 lapse (one event, nothing sent) and a confirmed
// owner going straight to the installer on the next Release.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { SPOT_RELEASE_EVENTS, SPOT_RELEASE_UNAPPROVED } from "../src/lib/spot-release.core";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const get = (r: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
const subset = (a: unknown, b: unknown): boolean => {
  if (b && typeof b === "object" && !Array.isArray(b)) return !!a && typeof a === "object" && Object.entries(b as Row).every(([k, v]) => subset((a as Row)[k], v));
  return a === b;
};
let clock = Date.parse("2026-10-26T00:00:00.000Z");
function fakeAdmin() {
  return {
    from(table: string) {
      let op: "select" | "insert" | "update" = "select"; let payload: Row | null = null; let lim = Infinity; let head = false; let ret = false;
      const preds: ((r: Row) => boolean)[] = [];
      const b: Record<string, unknown> & PromiseLike<unknown> = {
        select(_c?: string, o?: { head?: boolean }) { if (op !== "select") ret = true; if (o?.head) head = true; return b; },
        eq(c: string, v: unknown) { preds.push((r) => get(r, c) === v); return b; },
        neq(c: string, v: unknown) { preds.push((r) => get(r, c) !== v); return b; },
        in(c: string, v: unknown[]) { preds.push((r) => v.includes(get(r, c))); return b; },
        is(c: string, v: unknown) { preds.push((r) => (get(r, c) ?? null) === v); return b; },
        gte(c: string, v: string) { preds.push((r) => String(get(r, c)) >= v); return b; },
        contains(c: string, v: unknown) { preds.push((r) => subset(get(r, c), v)); return b; },
        order() { return b; }, range() { return b; },
        limit(n: number) { lim = n; return b; },
        maybeSingle() { lim = 1; (b as Row)["single1"] = true; return b; },
        single() { lim = 1; (b as Row)["single1"] = true; return b; },
        insert(p: Row) { op = "insert"; payload = p; return b; },
        update(p: Row) { op = "update"; payload = p; return b; },
        then(res, rej) {
          let out: { data: unknown; error: { message: string; code?: string } | null; count?: number };
          const one = (b as Row)["single1"] === true;
          if (op === "insert") {
            const det = (payload?.["details"] ?? {}) as Row;
            const rows = (tables[table] ??= []);
            if (table === "workflow_events" && (SPOT_RELEASE_EVENTS as readonly string[]).includes(String(payload?.["event_type"])) && rows.some((r) => (SPOT_RELEASE_EVENTS as readonly string[]).includes(String(r["event_type"])) && (r["details"] as Row)?.["idempotency_key"] === det["idempotency_key"]))
              out = { data: null, error: { message: "duplicate key", code: "23505" } };
            else { clock += 1000; const row = { id: crypto.randomUUID(), created_at: new Date(clock).toISOString(), ...payload! }; rows.push(row); out = { data: one ? row : [row], error: null }; }
          } else if (op === "update") {
            const hit = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
            for (const r of hit) Object.assign(r, payload);
            out = { data: ret ? (one ? hit[0] ?? null : hit) : null, error: null };
          } else {
            const hit = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
            out = head ? { data: null, error: null, count: hit.length } : { data: one ? hit[0] ?? null : hit.slice(0, lim), error: null };
          }
          return Promise.resolve(out).then(res, rej);
        },
      };
      return b;
    },
  };
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin() }));
let deliveryAllowed = true;
mock.module("../src/lib/comms.server", () => ({
  assertCustomerDeliveryAllowed: async () => { if (!deliveryAllowed) throw new Error("Customer messages are switched off"); },
  customerCommsEnabled: async () => deliveryAllowed,
}));
const sent: { via: string; to: string; subject?: string; body?: string; key?: string }[] = [];
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: { to: string; key: string; build: (u: string | null) => { subject: string; text: string } }) => { const m = p.build("https://u"); sent.push({ via: "live-email", to: p.to, subject: m.subject, key: p.key }); return "sent"; },
}));
mock.module("../src/lib/sms.server", () => ({
  sendRealSms: async (i: { to: string; body: string; idempotencyKey: string }) => { sent.push({ via: "real-sms", to: i.to, body: i.body, key: i.idempotencyKey }); return { status: "blocked", detail: "wording not approved", sid: null }; },
}));
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (_c: Row, to: string, subject: string) => { sent.push({ via: "test-email", to, subject }); return { status: "sent", detail: "ok" }; },
  sendTestSms: async (_c: Row, to: string, body: string) => { sent.push({ via: "test-sms", to, body }); return { status: "sent", detail: "ok" }; },
}));
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async () => "https://estimate.homeinsulationvictoria.com.au/my-job/TOKEN" }));
const offers: { jobId: string; actor: string | null; ids: string[] }[] = [];
let offerFails = false;
mock.module("../src/lib/ready-check-times.server", () => ({
  officePickReadyCheckInstaller: async (jobId: string, actor: string | null, ids: string[]) => { if (offerFails) throw new Error("installer paused"); offers.push({ jobId, actor, ids }); return { offered: 1, exhausted: false, offerId: "o1" }; },
}));
mock.module("../src/lib/ready-check-booking-access.server", () => ({ assertOwnerReadyCheckBooking: async () => undefined }));
mock.module("../src/lib/readycheck-booking.server", () => ({ installerCandidatesFor: async () => ({ postcode: "3000", candidates: [{ business_id: "biz-1", name: "Sample Insulation", blocker: null }, { business_id: "biz-2", name: "Other Co", blocker: null }] }) }));
mock.module("../src/lib/offer-guard.server", () => ({ assertOfferPairsAllowed: async () => undefined }));

const S = await import("../src/lib/spot-release.server");
const OWNER = { full_name: "Helen Sample", email: "helen@example.com", phone: "0400000000" };

function seed(source: string | null) {
  for (const k of Object.keys(tables)) delete tables[k];
  offers.length = 0; sent.length = 0; deliveryAllowed = true; offerFails = false;
  tables["jobs"] = [{ id: "job-1", stage: "ready_check_ready_to_schedule", channel: "hivic_sourced", source, owner_id: "own-1", deleted_at: null, job_number: "HV-1" }];
  tables["owners"] = [{ id: "own-1", ...OWNER }];
  tables["businesses"] = [{ id: "biz-1", name: "Sample Insulation", trading_name: null, onboarding_notes: source === "qa_test" ? "[TEST PARTNER]" : null }, { id: "biz-2", name: "Other Co", trading_name: null, onboarding_notes: "[TEST PARTNER]" }];
  tables["job_assignments"] = []; tables["partner_offers"] = []; tables["workflow_events"] = [];
}
const events = (type?: string) => (tables["workflow_events"] ?? []).filter((e) => !type || e["event_type"] === type);
const ON = { email: true, sms: true };

describe("Release", () => {
  beforeEach(() => seed(null));
  test("REAL job while unapproved → refused with the clear message; nothing recorded or sent", async () => {
    await expect(S.releaseSpot("job-1", "jo", "biz-1")).rejects.toThrow(SPOT_RELEASE_UNAPPROVED);
    expect(events().length).toBe(0); expect(sent.length).toBe(0); expect(offers.length).toBe(0);
  });
  test("REAL job approved → ONE pending release, owner email + text, installer NOT offered", async () => {
    const r = await S.releaseSpot("job-1", "jo", "biz-1", { approved: ON, now: new Date("2026-10-26T00:00:00Z") });
    expect(r).toMatchObject({ mode: "released", installer: "Sample Insulation" });
    expect(events("spot_released").length).toBe(1);
    expect(offers.length).toBe(0);
    expect(sent.map((s) => s.via)).toEqual(["live-email", "real-sms"]);
    expect(sent[0]!.subject).toBe("It's your turn — confirm your free Ready Check");
    expect(sent[1]!.body).toContain("my-job/TOKEN?screen=turn");
    expect(sent.map((s) => s.key)).toEqual(["spot-release:v1:job-1:1:released:email", "spot-release:v1:job-1:1:released:sms"]);
    // Pending → not available to release again.
    await expect(S.releaseSpot("job-1", "jo", "biz-2", { approved: ON })).rejects.toThrow(/Already released to Sample Insulation/);
    expect(events("spot_released").length).toBe(1);
  });
  test("REAL job with customer messages off → refused, nothing recorded", async () => {
    deliveryAllowed = false;
    await expect(S.releaseSpot("job-1", "jo", "biz-1", { approved: ON })).rejects.toThrow(/switched off/);
    expect(events().length).toBe(0);
  });
  test("TEST job works end to end while unapproved (test-send only, never the real senders)", async () => {
    seed("qa_test");
    await S.releaseSpot("job-1", "jo", "biz-1");
    expect(sent.map((s) => s.via)).toEqual(["test-email", "test-sms"]);
    expect((await S.ownerTurnState("job-1")).kind).toBe("ask");
    const v = await S.confirmSpotRelease("job-1");
    expect(v).toEqual({ kind: "confirmed", installer: "Sample Insulation" });
    expect(offers).toEqual([{ jobId: "job-1", actor: "jo", ids: ["biz-1"] }]);
  });
  test("an installer not eligible for the job → refused before the owner is told", async () => {
    await expect(S.releaseSpot("job-1", "jo", "biz-x", { approved: ON })).rejects.toThrow(/isn't an approved installer/);
    expect(events().length).toBe(0); expect(sent.length).toBe(0);
  });
});

describe("owner answers", () => {
  beforeEach(async () => { seed(null); await S.releaseSpot("job-1", "jo", "biz-1", { approved: ON }); sent.length = 0; });
  test("Confirm runs the existing installer offer exactly once (double tap / race → once)", async () => {
    const [a, b] = await Promise.all([S.confirmSpotRelease("job-1"), S.confirmSpotRelease("job-1")]);
    await S.confirmSpotRelease("job-1");
    expect(offers).toEqual([{ jobId: "job-1", actor: "jo", ids: ["biz-1"] }]);
    expect(events("spot_release_confirmed").length).toBe(1);
    expect([a.kind, b.kind]).toEqual(["confirmed", "confirmed"]);
    expect(sent.length).toBe(0);
    // A decline after confirming changes nothing.
    expect((await S.declineSpotRelease("job-1")).kind).toBe("confirmed");
    expect(tables["jobs"]![0]!["stage"]).toBe("ready_check_ready_to_schedule");
  });
  test("Confirm when the offer is refused: confirmation stands; job back to Jo as 'Owner confirmed'; next Release goes straight to the installer", async () => {
    offerFails = true;
    expect((await S.confirmSpotRelease("job-1")).kind).toBe("confirmed");
    expect(events("spot_release_offer_failed").length).toBe(1);
    offerFails = false;
    const r = await S.releaseSpot("job-1", "jo", "biz-2"); // unapproved wording doesn't matter: the owner is not asked again
    expect(r).toEqual({ mode: "offered", installer: "Other Co" });
    expect(offers).toEqual([{ jobId: "job-1", actor: "jo", ids: ["biz-2"] }]);
    expect(events("spot_released").length).toBe(1);
    expect(sent.length).toBe(0);
  });
  test("I'm no longer interested → cancelled with the reason, prior_stage kept, one stage_changed, nothing sent, no offer", async () => {
    expect(await S.declineSpotRelease("job-1")).toEqual({ kind: "declined" });
    await S.declineSpotRelease("job-1");
    const j = tables["jobs"]![0]!;
    expect({ stage: j["stage"], prior: j["prior_stage"], reason: j["cancelled_reason"] }).toEqual({ stage: "cancelled", prior: "ready_check_ready_to_schedule", reason: "No longer interested (owner, at release)" });
    expect(events("stage_changed").length).toBe(1);
    expect(events("spot_release_declined").length).toBe(1);
    expect(offers.length).toBe(0); expect(sent.length).toBe(0);
    expect((await S.confirmSpotRelease("job-1")).kind).toBe("declined");
    expect(offers.length).toBe(0);
  });
});

describe("15-minute tick", () => {
  beforeEach(async () => { seed(null); clock = Date.parse("2026-10-26T00:00:00.000Z"); await S.releaseSpot("job-1", "jo", "biz-1", { approved: ON, now: new Date(clock) }); sent.length = 0; });
  const at = (hours: number) => new Date(Date.parse("2026-10-26T00:00:00.000Z") + hours * 3_600_000); // 11am Melbourne + h
  test("day 2: ONE reminder (email + text, 'Just checking'), never twice; day 5: lapse once, nothing sent", async () => {
    expect((await S.sweepSpotReleases(at(24), { approved: ON })).reminded).toBe(0);
    expect((await S.sweepSpotReleases(at(48.1), { approved: ON })).reminded).toBe(1);
    expect((await S.sweepSpotReleases(at(49), { approved: ON })).reminded).toBe(0);
    expect(sent.map((s) => s.via)).toEqual(["live-email", "real-sms"]);
    expect(sent[0]!.subject).toMatch(/^Just checking — it's your turn/);
    expect(sent[1]!.body).toMatch(/just checking — it's your turn!/);
    sent.length = 0;
    expect((await S.sweepSpotReleases(at(120.1), { approved: ON })).lapsed).toBe(1);
    expect((await S.sweepSpotReleases(at(121), { approved: ON })).lapsed).toBe(0);
    expect(events("spot_release_lapsed").length).toBe(1);
    expect(sent.length).toBe(0); expect(offers.length).toBe(0);
    // Lapsed → back on the list for Jo, the owner page has closed, and Jo can release again.
    expect((await S.ownerTurnState("job-1")).kind).toBe("closed");
    const st = await S.spotReleaseStateFor("job-1");
    expect(st.state).toBe("lapsed");
    const r = await S.releaseSpot("job-1", "jo", "biz-2", { approved: ON, now: at(122) });
    expect(r.mode).toBe("released");
    expect((await S.spotReleaseStateFor("job-1")).state).toBe("pending");
  });
  test("a job that moved on (installer assigned) is not chased", async () => {
    tables["job_assignments"]!.push({ job_id: "job-1", role: "installer", active: true });
    const r = await S.sweepSpotReleases(at(130), { approved: ON });
    expect(r).toMatchObject({ reminded: 0, lapsed: 0 });
  });
  test("batched states for the waiting list", async () => {
    const m = await S.spotReleaseStates(["job-1", "job-2"]);
    expect(m.get("job-1")?.state).toBe("pending");
    expect(m.get("job-2")?.state).toBe("none");
  });
});

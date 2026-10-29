// Save my spot is held while a website/email enquiry is waiting for the owner's full street address.
// In-memory database; no network, no live service.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ADDRESS_REQUEST_BLOCK_REASON } from "../src/lib/address-request.core";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
function from(table: string) {
  let op: "select" | "insert" | "update" = "select"; let payload: Row = {}; let lim = Infinity; let one = false;
  let orderBy: { col: string; asc: boolean } | null = null;
  const preds: ((r: Row) => boolean)[] = [];
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { preds.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { preds.push((r) => v.includes(r[c])); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { orderBy ??= { col: c, asc: o?.ascending !== false }; return b; },
    limit: (n: number) => { lim = n; return b; },
    maybeSingle: () => { one = true; return b; },
    insert: (p: Row) => { op = "insert"; payload = p; return b; },
    update: (p: Row) => { op = "update"; payload = p; return b; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      let data: unknown = null;
      if (op === "insert") (tables[table] ??= []).push({ id: crypto.randomUUID(), ...payload });
      else if (op === "update") for (const r of (tables[table] ?? []).filter((r) => preds.every((p) => p(r)))) Object.assign(r, payload);
      else {
        let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
        if (orderBy) rows = [...rows].sort((x, y) => String(x[orderBy!.col]).localeCompare(String(y[orderBy!.col])) * (orderBy!.asc ? 1 : -1));
        rows = rows.slice(0, lim);
        data = one ? rows[0] ?? null : rows;
      }
      return Promise.resolve({ data, error: null }).then(res, rej);
    },
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
// I4: only Save my spot is held. The insulation-details and more-photos paths need their own facts to reach sendOne.
mock.module("../src/lib/group-b-media.server", () => ({ groupBMediaForJob: async () => ({ received: false, uncertain: false, excluded: false, count: 0, pendingSync: false }) }));
mock.module("../src/lib/more-photos-request.server", () => ({ morePhotosRequestReview: async () => ({ reviewId: "review-1", blocker: null }) }));

const GO_LIVE = "2026-10-20T00:00:00Z";
const seed = (address: string | null, extraEvents: Row[] = [], goLive: string | null = GO_LIVE) => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables["workflow_settings"] = [{ id: 1, address_request_live_at: goLive }];
  tables["properties"] = [{ id: "p1", address_line: address, suburb: "Clayton", postcode: "3168", enrichment: {} }];
  tables["owners"] = [{ id: "o1", full_name: "Pat Owner", email: "pat@example.org" }];
  const job = { id: "j1", job_number: "HV-1", source: "base44", channel: "hivic_sourced", stage: "preliminary_estimate_ready", created_at: "2026-10-25T00:00:00Z", property_id: "p1", owners: tables["owners"][0], properties: tables["properties"][0] };
  tables["jobs"] = [job];
  tables["workflow_events"] = extraEvents;
  tables["customer_email_sends"] = [];
  tables["customer_delivery_settings"] = [{ id: 1, enabled: true }];
  (tables["workflow_settings"][0] as Row)["customer_comms_enabled"] = true;
};

describe("Save my spot waits for the owner's full address", () => {
  beforeEach(() => seed(null));

  test("a street-less website enquiry after go-live is blocked and nothing is reserved", async () => {
    const { sendSaveMySpot } = await import("../src/lib/hot-leads-send.server");
    const [r] = await sendSaveMySpot(["j1"], null, { mode: "send" });
    expect(r).toMatchObject({ outcome: "blocked", detail: ADDRESS_REQUEST_BLOCK_REASON });
    expect(tables["customer_email_sends"]).toHaveLength(0);
  });

  test("once the owner has answered with a street it is not blocked by this rule", async () => {
    seed("12 Wattle St", [{ id: "e1", job_id: "j1", event_type: "address_request_answered", created_at: "2026-10-26T00:00:00Z" }]);
    const { sendSaveMySpot } = await import("../src/lib/hot-leads-send.server");
    const [r] = await sendSaveMySpot(["j1"], null, { mode: "send" });
    expect(r.detail).not.toBe(ADDRESS_REQUEST_BLOCK_REASON);
  });

  test("feature off (no go-live date) never blocks; previews are never blocked", async () => {
    const { sendSaveMySpot } = await import("../src/lib/hot-leads-send.server");
    seed(null, [], null);
    expect((await sendSaveMySpot(["j1"], null, { mode: "send" }))[0]!.detail).not.toBe(ADDRESS_REQUEST_BLOCK_REASON);
    seed(null);
    expect((await sendSaveMySpot(["j1"], null, { mode: "preview" }))[0]!.detail).not.toBe(ADDRESS_REQUEST_BLOCK_REASON);
  });

  test("every Save my spot send is held: plain and existing-insulation follow-up", async () => {
    const { sendSaveMySpot, sendExistingInsulationSaveSpot } = await import("../src/lib/hot-leads-send.server");
    expect((await sendSaveMySpot(["j1"], null, { mode: "send", automaticInitial: true }))[0]).toMatchObject({ outcome: "blocked", detail: ADDRESS_REQUEST_BLOCK_REASON });
    expect(await sendExistingInsulationSaveSpot("j1", null, false)).toMatchObject({ outcome: "blocked", detail: ADDRESS_REQUEST_BLOCK_REASON });
  });

  test("the insulation-details / 3-questions emails and the Office more-photos request are NOT held by the address rule", async () => {
    const S = await import("../src/lib/hot-leads-send.server");
    expect((await S.sendAutomaticInsulationDetails("j1")).detail).not.toBe(ADDRESS_REQUEST_BLOCK_REASON);
    expect((await S.sendInsulationQuestionsInvitation("j1")).detail).not.toBe(ADDRESS_REQUEST_BLOCK_REASON);
    expect((await S.sendMorePhotosRequest("j1", "office-1", false, "review-1")).detail).not.toBe(ADDRESS_REQUEST_BLOCK_REASON);
  });

  test("the reader returns the earliest of each event", async () => {
    const { loadAddressRequestFacts } = await import("../src/lib/address-request.server");
    seed(null, [
      { id: "a", job_id: "j1", event_type: "address_request_sent", created_at: "2026-10-26T02:00:00Z" },
      { id: "b", job_id: "j1", event_type: "address_request_sent", created_at: "2026-10-26T01:00:00Z" },
    ]);
    expect(await loadAddressRequestFacts("j1")).toEqual({ addressLine: null, source: "base44", channel: "hivic_sourced", createdAt: "2026-10-25T00:00:00Z", eligibilityOutcome: null, goLiveAt: GO_LIVE, sentAt: "2026-10-26T01:00:00Z", reminderAt: null, answeredAt: null, closed: false });
    expect(await loadAddressRequestFacts("nope")).toBeNull();
  });
});

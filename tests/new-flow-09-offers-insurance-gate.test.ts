// G6 S6 (final Part 9 review, 4 Nov 2026): REC offers use the SAME insurance hard block as every booking — Part 9 Task 8's
// businessDocsBlocker through the one reader (business-docs.server): public liability on file, office-verified, $5m+ (the
// business's recorded cover, B1), unexpired; workers comp unless the business is exempt. An electrician business that fails
// it is not a candidate and the blocker names the document. A read failure throws (no offer on an unchecked business).
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest } from "./helpers/memory-postgrest";
import { BUSINESS_DOCS_WORDS } from "../src/lib/trade-expiry.core";

type Row = Record<string, unknown>;
let rows: Record<string, Row[]> = {};
let client = memoryPostgrest(rows as never);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => client.from(t), rpc: (n: string) => client.rpc(n) } }));
mock.module("../src/lib/job-facts.server", () => ({ jobAdmin: { from: (t: string) => client.from(t) } }));
mock.module("../src/lib/visit-events.server", () => ({ reliabilityFor: async () => new Map() }));
mock.module("../src/lib/job-electrician.server", () => ({ jobChosenElectrician: async () => null }));

const biz = (id: string, o: Row = {}): Row => ({
  id, name: `Volt ${id}`, business_type: "rec", capabilities: ["electrician"], is_active: true, onboarding_status: "approved", rec_number: "REC-1",
  accepting_new_jobs: true, receives_hivic_leads: true, coverage_verified_at: "2026-01-01T00:00:00Z", service_postcodes: ["3128"], coverage_mode: "postcodes",
  public_liability_cover_amount: 10_000_000, workcover_exempt_declared_at: null, onboarding_notes: null, added_by_installer_business_id: null, weekly_capacity: null, ...o,
});
const cred = (business_id: string, kind: string, expires_at: string | null, verification = "verified"): Row => ({ id: `${business_id}:${kind}`, business_id, kind, label: kind, expires_at, verification, critical: true });

beforeEach(() => {
  rows = {
    jobs: [{ id: "J1", source: "website", channel: "hivic_sourced", property_id: "P1" }],
    properties: [{ id: "P1", job_id: "J1", postcode: "3128" }],
    businesses: [biz("B-ok"), biz("B-low", { public_liability_cover_amount: 2_000_000 }), biz("B-nowc"), biz("B-exempt", { workcover_exempt_declared_at: "2026-10-01T00:00:00Z" }), biz("B-pending")],
    business_credentials: [
      cred("B-ok", "public_liability_insurance", "2027-06-30"), cred("B-ok", "workers_comp_insurance", "2027-06-30"), cred("B-ok", "electrical_licence", "2027-06-30"), cred("B-ok", "rec_registration", "2027-06-30"),
      cred("B-low", "public_liability_insurance", "2027-06-30"), cred("B-low", "workers_comp_insurance", "2027-06-30"), cred("B-low", "electrical_licence", "2027-06-30"), cred("B-low", "rec_registration", "2027-06-30"),
      cred("B-nowc", "public_liability_insurance", "2027-06-30"), cred("B-nowc", "electrical_licence", "2027-06-30"), cred("B-nowc", "rec_registration", "2027-06-30"),
      cred("B-exempt", "public_liability_insurance", "2027-06-30"), cred("B-exempt", "electrical_licence", "2027-06-30"), cred("B-exempt", "rec_registration", "2027-06-30"),
      cred("B-pending", "public_liability_insurance", "2027-06-30", "pending"), cred("B-pending", "workers_comp_insurance", "2027-06-30"), cred("B-pending", "electrical_licence", "2027-06-30"), cred("B-pending", "rec_registration", "2027-06-30"),
    ],
    partner_workers: ["B-ok", "B-low", "B-nowc", "B-exempt", "B-pending"].map((b) => ({ id: `w-${b}`, business_id: b, trade_role: "electrician", approval_status: "approved", removed_at: null, licence_expires_on: "2027-06-30" })),
    job_assignments: [], partner_offers: [], partner_relationships: [], bookings: [], appointment_proposals: [], workflow_events: [], workflow_settings: [],
  };
  client = memoryPostgrest(rows as never);
});

describe("recCandidatesFor: the insurance hard block on offers", () => {
  test("verified $10m + workers comp → candidate; $2m on the business record → blocked; no workers comp → blocked unless exempt; PL waiting to be checked → blocked", async () => {
    const { recCandidatesFor } = await import("../src/lib/allocation.server");
    const r = await recCandidatesFor("J1");
    const by = Object.fromEntries(r.candidates.map((c) => [c.business_id, c]));
    expect(by["B-ok"]).toMatchObject({ has_valid_licence: true, licence_blocker: null, blocker: null });
    expect(by["B-low"]).toMatchObject({ has_valid_licence: false, licence_blocker: BUSINESS_DOCS_WORDS.amountLow("Public liability insurance", 2_000_000) });
    expect(by["B-low"]!.blocker).toBe(BUSINESS_DOCS_WORDS.amountLow("Public liability insurance", 2_000_000));
    expect(by["B-nowc"]).toMatchObject({ has_valid_licence: false, licence_blocker: BUSINESS_DOCS_WORDS.notOnFile("Workers compensation insurance") });
    expect(by["B-exempt"]).toMatchObject({ has_valid_licence: true, licence_blocker: null, blocker: null });
    expect(by["B-pending"]).toMatchObject({ has_valid_licence: false, licence_blocker: BUSINESS_DOCS_WORDS.waitingCheck("Public liability insurance") });
  });
  test("a lapsed REC registration still blocks (the older expiry rule stays behind the insurance block)", async () => {
    rows["business_credentials"]!.find((c) => c["id"] === "B-ok:rec_registration")!["expires_at"] = "2026-01-01";
    const { recCandidatesFor } = await import("../src/lib/allocation.server");
    const r = await recCandidatesFor("J1");
    expect(r.candidates.find((c) => c.business_id === "B-ok")!.licence_blocker).toBe("REC registration expired on 2026-01-01. No new jobs until the renewed document is uploaded.");
  });
  test("the insurance rows can't be read → the whole read throws (no offer on an unchecked business)", async () => {
    const base = client;
    const failed = { data: null, error: { code: "XX000", message: "read failed: business_credentials" } };
    const chain: Record<string, unknown> = new Proxy({}, { get: (_t, k) => (k === "then" ? (res: (v: unknown) => unknown) => Promise.resolve(failed).then(res) : () => chain) });
    client = { from: (t: string) => (t === "business_credentials" ? chain : base.from(t)), rpc: base.rpc } as unknown as typeof client;
    const { recCandidatesFor } = await import("../src/lib/allocation.server");
    await expect(recCandidatesFor("J1")).rejects.toThrow(/Couldn't read insurance records: read failed/);
  });
});

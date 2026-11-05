// Portal speed step 2 (plan Task 3 extra): the no-login safety plan link (/sp/<token>, swms-link.server) still opens in at
// most 2 sequential database rounds. Round counter over the in-memory database; the read path is measured up to its answer
// (or its refusal, which comes after every read). Run on its own (bun shares mock.module per process).
import { describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { roundCounter } from "./helpers/round-counter";

process.env["ONBOARDING_FP_SECRET"] ??= "test-only-secret";
const J = "00000000-0000-4000-8000-000000000001";
const tables: Tables = {
  jobs: [{ id: J, job_number: "HV-1001", stage: "installation_booked", installation_completed_at: null, deleted_at: null, owner_id: "o1", property_id: "p1", source: "qa_test", channel: "installer_sourced" }],
  owners: [{ id: "o1", full_name: "Olive Owner" }], properties: [{ id: "p1", address_line: "1 Test St", suburb: "Testville", postcode: "3000" }],
  workflow_events: [], bookings: [], job_assignments: [], partner_workers: [], businesses: [], ceiling_measurements: [], piesa_records: [],
  assessments: [], profiles: [], documents: [], worker_job_links: [], installer_declarations: [], mitti_audits: [], quotes: [],
};
const rc = roundCounter(memoryPostgrest(tables));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: rc.client }));
const { swmsLinkView, swmsLinkToken, swmsLinkSecret } = await import("../src/lib/swms-link.server");

describe("no-login safety plan link", () => {
  test("opens in at most 2 sequential database rounds", async () => {
    const token = swmsLinkToken({ jobId: J, key: "lead", exp: Date.now() + 86_400_000 }, swmsLinkSecret());
    await swmsLinkView(token).catch(() => null); // load the modules first: a module load is not a read
    const r = await rc.countRounds(() => swmsLinkView(token).catch((e: Error) => ({ refused: e.message })));
    if (r.rounds > 2 || process.env["SHOW_ROUNDS"]) console.log(r.rounds, r.queries, JSON.stringify(r.result).slice(0, 120), "\n" + rc.roundsOf(r.log));
    expect(r.queries).toBeGreaterThan(0);
    expect(r.rounds).toBeLessThanOrEqual(2);
  });
});

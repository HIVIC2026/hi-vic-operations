// Jo 7 Nov 2026: DON'T START is a hard lock at the stage gate too. Any move into `evidence_outstanding` (installed)
// needs a GO — the latest GO / DON'T START check for the confirmed install start passed — on every job: HIV leads and
// installers' own customers alike. Behaviour of the real `stageEntryBlockers` on an in-memory database; the other
// install-day gates are stubbed to "clear" so only the GO decides.
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const START = "2026-11-10T22:00:00.000Z";
let T: Tables = {};
let intake = false;
const db = { from: (t: string) => memoryPostgrest(T).from(t), rpc: async () => ({ data: false, error: null }) };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db }));
mock.module("../src/lib/job-facts.server", () => ({ jobAdmin: db }));
mock.module("../src/lib/installer-intake.server", () => ({
  siteConditionsHoldFor: async () => ({ open: false, note: null }),
  isIntakeJob: async () => intake,
  reconfirmationOpen: async () => false,
}));
mock.module("../src/lib/ready-check-draft.server", () => ({ rcAreaWorksBlockers: async () => [] }));
mock.module("../src/lib/owner-gates.server", () => ({ ownerGateStageBlockers: async () => [] }));
mock.module("../src/lib/esc.server", () => ({ installReadiness: async () => ({ blockers: [] }) }));
mock.module("../src/lib/official-forms.server", () => ({ piisaPanel: async () => ({ blockers: [] }), hazardBlockers: async () => [] }));
mock.module("../src/lib/eligibility.server", () => ({ todayMelbourne: () => "2026-11-11" }));
afterAll(() => mock.restore());

const { stageEntryBlockers } = await import("../src/lib/workflow.server");

const failed = { scheduled_start: START, passed: false, failures: ["Certificate of Electrical Safety not in yet"], checked_at: "2026-11-10T03:00:00Z" };
const passed = { scheduled_start: START, passed: true, failures: [], checked_at: "2026-11-10T19:30:00Z" };

function seed(source: string, checks: Record<string, unknown>[]) {
  T = {
    jobs: [{ id: "j1", source, stage: "installation_booked", channel: source === "installer_portal" ? "installer_sourced" : "website", installer_led: source === "installer_portal", life_support: false }],
    bookings: [{ id: "b1", job_id: "j1", kind: "installation", status: "confirmed", scheduled_start: START }],
    job_assignments: [{ id: "a1", job_id: "j1", role: "installer", active: true }],
    pre_start_checks: checks.map((c) => ({ job_id: "j1", ...c })),
    job_compliance_records: [{ job_id: "j1", record_key: "pre_install_consumer_docs" }], invoices: [], documents: [], job_piesa_deadlines: [], rectification_items: [],
    evidence_requirements: [{ job_id: "j1", category: "before_ceiling_space", status: "verified" }],
    workflow_events: [],
  };
}
const goBlockers = async () => (await stageEntryBlockers("j1", "evidence_outstanding")).filter((b) => b.startsWith("Not cleared to start"));

beforeEach(() => { intake = false; });

test("stage gate: moving to installed without a GO is refused with the DON'T START words", async () => {
  seed("base44", [failed]);
  expect(await goBlockers()).toEqual(["Not cleared to start: Certificate of Electrical Safety not in yet"]);
  seed("base44", []);
  expect(await goBlockers()).toEqual(["Not cleared to start: The pre-start check has not run yet for this install date."]);
});

test("stage gate: moving to installed with a GO for the booked start is allowed", async () => {
  seed("base44", [failed, passed]);
  expect(await stageEntryBlockers("j1", "evidence_outstanding")).toEqual([]);
  // A GO for an older start does not count.
  seed("base44", [{ ...passed, scheduled_start: "2026-11-03T22:00:00.000Z" }]);
  expect((await goBlockers()).length).toBe(1);
});

test("stage gate: HIV lead and installer's own customer both need the GO (intake or not)", async () => {
  for (const source of ["base44", "installer_portal"]) {
    for (const isIntake of [false, true]) {
      intake = isIntake;
      seed(source, []);
      expect((await goBlockers()).length).toBe(1);
      seed(source, [passed]);
      expect(await goBlockers()).toEqual([]);
    }
  }
});

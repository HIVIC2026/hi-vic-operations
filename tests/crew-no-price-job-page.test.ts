// Jo 28 Oct 2026 (spec rule 3, fix round 5): only the owner of the business on the job ever receives a price. The trade
// job page (`tradeJobPage` → form.needsFinishing / needsFinishingItems) and the Mitti presentation (`mittiJobPresentation`
// → next, also its own server function) read jobs.next_action; office-typed "Needs finishing: …" text must not reach crew.
// Run on its own (bun shares mock.module across files in one process): bun test tests/crew-no-price-job-page.test.ts
import { describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const BIZ = "00000000-0000-4000-8000-0000000000b1";
const BOSS = "00000000-0000-4000-8000-0000000000a1";
const CREW = "00000000-0000-4000-8000-0000000000c1";
const JOB = "00000000-0000-4000-8000-000000000401";
const TYPED = "Needs finishing: owner pays 349 incl GST";
const SYSTEM = "Needs finishing: owner mobile/email on the Mitti form";

const noAmount = (v: unknown) => {
  const s = JSON.stringify(v);
  expect(s).not.toContain("$");
  expect(s).not.toMatch(/349|GST|pays/i);
};

function tables(next_action: string): Tables {
  return {
    business_members: [{ business_id: BIZ, user_id: BOSS, member_role: "business_admin", active: true }, { business_id: BIZ, user_id: CREW, member_role: "member", active: true }],
    user_roles: [{ user_id: BOSS, role: "installer" }, { user_id: CREW, role: "installer" }],
    profiles: [{ id: BOSS, full_name: "TEST Boss", phone: null, email: null }, { id: CREW, full_name: "TEST Crew", phone: null, email: null }],
    businesses: [{ id: BIZ, name: "TEST Insulators", business_type: "eec_installer", capabilities: null, base_suburb: null, coverage_radius_km: null, covers_all_victoria: null, accepting_new_jobs: true, onboarding_notes: "[TEST PARTNER]", mitti_account_invited: false }],
    job_assignments: [{ job_id: JOB, business_id: BIZ, user_id: CREW, role: "installer", active: true }],
    jobs: [{ id: JOB, job_number: "HV-9401", stage: "ready_check_booked", channel: "hivic_sourced", next_action, installation_completed_at: null, originating_installer_business_id: null }],
    ceiling_measurements: [{ job_id: JOB, is_current: true, external_source: "mitti", external_id: "audit-1", measured_area_m2: null, removal_m2: null, removal_required: false }],
    bookings: [], assessments: [], workflow_events: [], customer_assignments: [], quotes: [], installer_declarations: [], rectification_items: [],
  };
}
let T = tables(TYPED);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(T).from(t), rpc: async () => ({ data: null, error: null }) } }));
mock.module("../src/lib/job-status.server", () => ({ statusFactsFor: async () => new Map(), statusView: () => null }));
mock.module("../src/lib/installer-quote-status.server", () => ({ loadInstallerQuote: async () => ({ applies: false }), loadInstallerQuotes: async () => new Map() }));
mock.module("../src/lib/allocation.server", () => ({ clearanceFacts: async () => ({ piesaCompletedAt: null, piesaOutcome: null }) }));
mock.module("../src/lib/installer-price.server", () => ({ readInstallerPrice: async () => null, readInstallerPrices: async () => new Map() }));

describe("crew: office-typed 'Needs finishing' text never reaches the job page", () => {
  test("mittiJobPresentation (also getMittiJobPresentation): no amount in `next`", async () => {
    T = tables(TYPED);
    const { mittiJobPresentation } = await import("../src/lib/mitti-job-presentation.server");
    const p = await mittiJobPresentation(JOB, CREW);
    expect(p.applies).toBe(true);
    noAmount(p);
  });
  test("tradeJobPage: no amount anywhere in the page data (form.needsFinishing / needsFinishingItems)", async () => {
    T = tables(TYPED);
    const { tradeJobPage } = await import("../src/lib/trade-view.server");
    const page = await tradeJobPage(JOB, CREW);
    expect(page.boss).toBe(false);
    expect(page.form.linked).toBe(true);
    expect(page.form.needsFinishing).toBeNull();
    expect(page.form.needsFinishingItems).toEqual([]);
    noAmount(page);
  });
  test("crew still get the system-written Mitti list", async () => {
    T = tables(SYSTEM);
    const { tradeJobPage } = await import("../src/lib/trade-view.server");
    const page = await tradeJobPage(JOB, CREW);
    expect(page.form.needsFinishing).toBe("You: add the owner's phone and email in Mitti");
    expect(page.form.needsFinishingItems).toEqual(["The owner's mobile", "The owner's email"]);
  });
});

describe("owner of the job's business: unchanged", () => {
  test("the real text reaches the owner on both reads", async () => {
    T = tables(TYPED);
    T["job_assignments"] = [{ job_id: JOB, business_id: BIZ, user_id: BOSS, role: "installer", active: true }];
    const { tradeJobPage } = await import("../src/lib/trade-view.server");
    const { mittiJobPresentation } = await import("../src/lib/mitti-job-presentation.server");
    const page = await tradeJobPage(JOB, BOSS);
    expect(page.boss).toBe(true);
    expect(page.form.needsFinishing).toBe("You: add the owner's pays 349 incl GST in Mitti");
    expect(page.form.needsFinishingItems).toEqual(["The owner's pays 349 incl GST"]);
    expect((await mittiJobPresentation(JOB, BOSS)).next).toBe("You: add the owner's pays 349 incl GST in Mitti");
  });
});

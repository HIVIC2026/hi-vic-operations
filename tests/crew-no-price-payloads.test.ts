// Jo 28 Oct 2026 (spec rule 3, fix round 3): installer crew (workers who aren't the business owner) never see a price —
// on screen AND in anything sent to their phone. Here: the whole job-list rows (`tradeHome`), the job page overview (the
// bundle's `overview` section and `getJobOverview`, both `jobOverviewFor`), the worker link page, and the official ESC
// rebate form payload (`getAssignment`). Job: an owner-caused 30-day lapse (repeat PIESA $349) with an active installer
// assignment, plus a job stuck on a not-signed-up electrician. Owner and office output is unchanged.
// Run on its own (bun shares mock.module across files in one process): bun test tests/crew-no-price-payloads.test.ts
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { repeatPiesaCharge, repeatPiesaNextAction } from "../src/lib/thirty-day-rule.core";
import { installerNotOnboardedNote } from "../src/lib/rec-onboarded.core";
import { NOT_ONBOARDED_NEXT_TITLE } from "../src/lib/installer-quote-status.core";
import { VEEC_FORM_BODY, VEEC_FORM_FIELDS } from "../src/lib/veec-assignment-form.core";

const BIZ = "00000000-0000-4000-8000-0000000000b1";
const BOSS = "00000000-0000-4000-8000-0000000000a1";
const CREW = "00000000-0000-4000-8000-0000000000c1";
const LAPSED = "00000000-0000-4000-8000-000000000301";
const STUCK = "00000000-0000-4000-8000-000000000302";
const OWNER = "00000000-0000-4000-8000-0000000000d1";
const PROP = "00000000-0000-4000-8000-0000000000e1";

/** What thirty-day-rule.server writes to jobs.next_action on an owner-caused lapse with a $349 first safety check. */
const REPEAT = repeatPiesaNextAction(repeatPiesaCharge({ payer: "owner", reason: "owner", basis: "owner" }, { cents: 34900, source: "quote_line" }));
const NOTE = installerNotOnboardedNote("TEST Sparky");
const HOLD = "Quote held: owner price $4,201.25 is over the cap";
/** No "$" and no amount anywhere in the JSON. */
const noPrice = (v: unknown) => {
  const s = JSON.stringify(v);
  expect(s).not.toContain("$");
  expect(s).not.toMatch(/349|4,?201|798\.75|5,?000/);
};

test("the fixture really carries the prices (so the crew checks below mean something)", () => {
  expect(REPEAT).toContain("($349 inc GST");
  expect(NOTE).toContain("($349)");
});

function tables(): Tables {
  const job = (id: string, n: string, stage: string, next_action: string | null) => ({ id, job_number: n, stage, source: "qa_test", channel: "installer_sourced", qa_archived_at: null, deleted_at: null, updated_at: "2026-10-27T00:00:00Z", next_action, owner_id: OWNER, property_id: PROP, originating_installer_business_id: BIZ });
  return {
    business_members: [{ business_id: BIZ, user_id: BOSS, member_role: "business_admin", active: true }, { business_id: BIZ, user_id: CREW, member_role: "member", active: true }],
    user_roles: [{ user_id: BOSS, role: "installer" }, { user_id: CREW, role: "installer" }],
    profiles: [{ id: BOSS, full_name: "TEST Boss", phone: null, email: null }, { id: CREW, full_name: "TEST Crew", phone: null, email: null }],
    businesses: [{ id: BIZ, name: "TEST Insulators", business_type: "eec_installer", capabilities: null, base_suburb: null, coverage_radius_km: null, covers_all_victoria: null, accepting_new_jobs: true, onboarding_notes: "[TEST PARTNER]", mitti_account_invited: false }],
    job_assignments: [LAPSED, STUCK].map((job_id) => ({ job_id, business_id: BIZ, user_id: CREW, role: "installer", active: true })),
    jobs: [job(LAPSED, "HV-9301", "installation_scheduling", REPEAT), job(STUCK, "HV-9302", "ready_check_complete", null)],
    owners: [{ id: OWNER, full_name: "TEST Owner" }],
    properties: [{ id: PROP, address_line: "1 Test Street", suburb: "Testville", postcode: "3999" }],
    job_overview: [LAPSED, STUCK].map((id) => ({ id, job_number: id === LAPSED ? "HV-9301" : "HV-9302", stage: id === LAPSED ? "installation_scheduling" : "on_hold", channel: "installer_sourced", next_action: id === LAPSED ? REPEAT : "Needs finishing: your price on the job page", hold_reason: id === STUCK ? HOLD : null, property_id: PROP, owner_name: "TEST Owner", owner_phone: "0400000000", owner_email: "owner@example.test", property_address: "1 Test Street, Testville 3999", life_support: false, install_deadline: null, days_remaining: null, piesa_expired: true })),
    partner_offers: [], bookings: [], evidence_requirements: [], job_piesa_deadlines: [], ceiling_measurements: [], workflow_events: [], assessments: [],
  };
}
let T = tables();
let REL = true;
mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => memoryPostgrest(T).from(t), rpc: async (name: string) => ({ data: name === "has_contact_release" ? REL : null, error: null }) },
}));
mock.module("../src/lib/job-status.server", () => ({ statusFactsFor: async () => new Map(), statusView: () => null }));
mock.module("../src/lib/installer-quote-status.server", () => ({
  loadInstallerQuotes: async () => new Map([[STUCK, { applies: true, sent: false, accepted: false, declined: false, held: true, formCompleted: true, electricianNotOnboarded: { name: "TEST Sparky" } }]]),
}));
mock.module("../src/lib/installer-price.server", () => ({ readInstallerPrices: async () => new Map([[STUCK, { price_inc_gst: 2500 }]]), readInstallerPrice: async () => null }));

const sbAs = (role: string) => ({ auth: { getUser: async () => ({ data: { user: { user_metadata: {} } } }) }, rpc: async () => ({ data: role, error: null }) }) as never;

describe("job list (tradeHome): crew rows carry no price, whole rows", () => {
  test("crew: no $ or amount in any job row or home row; repeat PIESA becomes the price-free line", async () => {
    T = tables();
    const { tradeHome } = await import("../src/lib/trade-view.server");
    const home = await tradeHome(CREW);
    expect(home.boss).toBe(false);
    expect(home.jobs.length).toBe(2);
    const rows = [...home.home!.action, ...home.home!.progress, ...home.home!.done];
    expect(rows.length).toBe(2);
    noPrice(home.jobs);
    noPrice(rows);
    noPrice(home);
    const lapsed = rows.find((r) => r.jobId === LAPSED)!;
    expect(lapsed.nextAction).toBe("Repeat electrical safety check needed — the office will arrange it");
    const stuck = rows.find((r) => r.jobId === STUCK)!;
    expect(stuck.quoteLine).toBe(NOT_ONBOARDED_NEXT_TITLE);
    expect(stuck.group).toBe("progress");
  });

  test("owner: unchanged — the stored next action and the note", async () => {
    T = tables();
    T["job_assignments"] = [LAPSED, STUCK].map((job_id) => ({ job_id, business_id: BIZ, user_id: BOSS, role: "installer", active: true }));
    const { tradeHome } = await import("../src/lib/trade-view.server");
    const home = await tradeHome(BOSS);
    expect(home.boss).toBe(true);
    const rows = [...home.home!.action, ...home.home!.progress];
    expect(rows.find((r) => r.jobId === LAPSED)!.nextAction).toBe(REPEAT);
    const stuck = rows.find((r) => r.jobId === STUCK)!;
    expect(stuck.quoteLine).toBe(NOTE);
    expect(stuck.group).toBe("action");
  });
});

describe("installerHomeGroups returns the cleaned rows itself (crew path)", () => {
  const job = (boss: boolean | undefined) => ({ jobId: "j", jobNumber: "HV-1", street: null, suburb: null, channel: "installer_sourced", stage: "ready_check_complete", place: "moving" as const, placeTitle: null, nextAction: REPEAT, quoteLine: NOTE, status: null, upcoming: null, installDeadline: null, endedAt: null, formLinked: true, formCompleted: true, formHasAnswers: true, priceEntered: true, ...(boss === undefined ? {} : { boss }) });
  test("crew (and boss not given): quoteLine is the short line, nextAction price-free", async () => {
    const { installerHomeGroups } = await import("../src/lib/installer-home.core");
    for (const b of [false, undefined]) {
      const g = installerHomeGroups([job(b)]);
      const row = g.progress[0]!;
      expect(row.quoteLine).toBe(NOT_ONBOARDED_NEXT_TITLE);
      expect(row.next).toBe(NOT_ONBOARDED_NEXT_TITLE);
      noPrice(g);
    }
  });
  test("owner: rows unchanged", async () => {
    const { installerHomeGroups } = await import("../src/lib/installer-home.core");
    const row = installerHomeGroups([job(true)]).action[0]!;
    expect(row.quoteLine).toBe(NOTE);
    expect(row.nextAction).toBe(REPEAT);
  });
});

describe("job page overview (jobOverviewFor = bundle `overview` and getJobOverview)", () => {
  test("crew: no $ or amount in the overview row (next_action and hold_reason)", async () => {
    T = tables();
    const { jobOverviewFor } = await import("../src/lib/job-overview.server");
    for (const id of [LAPSED, STUCK]) {
      const { role, row } = await jobOverviewFor(sbAs("installer"), CREW, id);
      expect(role).toBe("installer");
      noPrice(row);
    }
    expect((await jobOverviewFor(sbAs("installer"), CREW, LAPSED)).row.next_action).toBe("Repeat electrical safety check needed — the office will arrange it");
    // Allow-listed system text is kept as it was; every hold reason is the set line (fix round 4).
    expect((await jobOverviewFor(sbAs("installer"), CREW, STUCK)).row.next_action).toBe("Needs finishing: your price on the job page");
    expect((await jobOverviewFor(sbAs("installer"), CREW, STUCK)).row.hold_reason).toBe("On hold — the office will be in touch");
  });
  test("crew without the contact release (own business job, and another business's job): still no price", async () => {
    T = tables(); REL = false;
    try {
      const { jobOverviewFor } = await import("../src/lib/job-overview.server");
      noPrice((await jobOverviewFor(sbAs("installer"), CREW, LAPSED)).row);
      T["jobs"] = T["jobs"]!.map((j) => ({ ...j, originating_installer_business_id: null }));
      const { row } = await jobOverviewFor(sbAs("installer"), CREW, LAPSED);
      expect(row.owner_phone).toBeNull();
      noPrice(row);
    } finally { REL = true; }
  });
  test("owner and office: overview unchanged", async () => {
    T = tables();
    const { jobOverviewFor } = await import("../src/lib/job-overview.server");
    const boss = (await jobOverviewFor(sbAs("installer"), BOSS, LAPSED)).row;
    expect(boss.next_action).toBe(REPEAT);
    expect((await jobOverviewFor(sbAs("installer"), BOSS, STUCK)).row.hold_reason).toBe(HOLD);
    const office = (await jobOverviewFor(sbAs("admin"), BOSS, STUCK)).row;
    expect(office.hold_reason).toBe(HOLD);
    expect(office.owner_phone).toBe("0400000000");
  });
  test("the bundle's overview section is this same crew-safe row", async () => {
    T = tables();
    const { jobOverviewFor } = await import("../src/lib/job-overview.server");
    const { tradeJobBundle } = await import("../src/lib/trade-job-bundle.server");
    const stub = async () => ({}) as never;
    const b = await tradeJobBundle(sbAs("installer"), CREW, LAPSED, {
      overview: jobOverviewFor, access: async () => ({ boss: false, kind: "installer", biz: { mitti_account_invited: false } }) as never,
      page: stub, installDays: stub, readyCheckTimes: stub, allocation: stub, swms: stub, workerLinks: stub, price: stub, ownerQuote: stub,
    });
    noPrice(b.overview);
  });
  test("getJobOverview returns jobOverviewFor's row", () => {
    expect(readFileSync("src/lib/admin-records.functions.ts", "utf8")).toContain("jobOverviewFor(context.supabase, context.userId, data.jobId)).row");
  });
});

describe("worker link page (/w/$token) never shows a stored price", () => {
  // Fix round 4: allow-list instead of a "$" block-list (tests/crew-no-price-allowlist.test.ts drives the real page data).
  test("next_action goes through the allow-list", () => {
    const src = readFileSync("src/lib/worker-links.functions.ts", "utf8");
    expect(src).toContain("next_action: nextActionForViewer(j.next_action, false)");
  });
  test("timeline keeps known system summaries only (e.g. the bulk 'Installer quoted $… inc GST' is dropped)", async () => {
    const { timelineForViewer } = await import("../src/lib/crew-no-price.core");
    expect(readFileSync("src/lib/worker-links.functions.ts", "utf8")).toContain("timeline: timelineForViewer(events ?? [])");
    expect(timelineForViewer([{ summary: "Installer quoted $2500 inc GST" }, { summary: "Repeat PIESA 349 incl GST" }, { summary: "Ready Check completed" }])).toEqual([{ summary: "Ready Check completed" }]);
  });
});

describe("rebate form payload (getAssignment) for the installer side", () => {
  const cur = { id: "a1", status: "awaiting_installer_signature", installer_signed_at: null, installed_product: "Bradford Gold R5", installed_area_m2: 120, final_facts: { final_customer_price_inc_gst: 4201.25, veu_benefit_inc_gst: 798.75 }, consumer_signature_name: "TEST Owner" };
  const priceLabels = VEEC_FORM_FIELDS.filter((f) => f.label.includes("$")).map((f) => f.label);
  const common = (blockers: string[]) => ({
    stage: "installation_complete", installationCompleted: true, installerBlockers: [], finalBlockers: [],
    veecPrep: { blockers, missing: priceLabels, values: { price_before_incentive: 5000, consumer_payment_after: 4201.25, benefit_amount: 798.75 }, fields: VEEC_FORM_FIELDS },
    officialForm: { template_key: "consumer_declaration", body: VEEC_FORM_BODY, form_fields: VEEC_FORM_FIELDS }, prefill: [{ label: "Product quoted", value: "Bradford Gold R5" }],
  });
  test("crew: no $ or amount anywhere; the form itself is not sent; what signing needs is kept", async () => {
    const { assignmentForInstaller } = await import("../src/lib/crew-no-price.core");
    const ready = assignmentForInstaller("installer", cur, common([]), false);
    noPrice(ready);
    expect(ready.officialForm).toBeNull();
    expect(ready.current).toEqual({ id: "a1", status: "awaiting_installer_signature", installer_signed_at: null, installed_product: "Bradford Gold R5", installed_area_m2: 120, final_facts: null });
    expect(ready.installationCompleted).toBe(true);
    expect(ready.veecPrep!.blockers).toEqual([]);
    const blocked = assignmentForInstaller("installer", null, common(priceLabels.map((l) => `Missing: ${l}`).concat("Missing: Date installation was completed", "Some other note")), false);
    noPrice(blocked);
    // Fix round 4 (Jo 28 Oct): no "Price details" line at all; the price-free field line is kept; Sign stays off.
    expect(blocked.veecPrep!.blockers).toEqual(["Missing: Date installation was completed"]);
    expect(blocked.veecPrep!.formPending).toBe(true);
  });
  test("owner (business owner): as before — no amounts, form wording kept", async () => {
    const { assignmentForInstaller } = await import("../src/lib/crew-no-price.core");
    const c = common(["Missing: Date completed"]);
    const boss = assignmentForInstaller("installer", cur, c, true);
    expect(boss.officialForm).toBe(c.officialForm);
    expect(boss.veecPrep).toEqual({ blockers: ["Missing: Date completed"], missing: priceLabels, values: {}, fields: [] });
    expect(JSON.stringify(boss.current)).not.toMatch(/4201|798/);
    expect(boss.agreement).toBeNull(); expect(boss.consent).toBeNull(); expect(boss.history).toEqual([]);
  });
  test("getAssignment uses it for installers (owner of the job's business); office/owner branch unchanged", () => {
    const src = readFileSync("src/lib/portal.functions.ts", "utf8");
    expect(src).toContain("return assignmentForInstaller(role, cur, common, boss);");
    expect(src).toContain("return { role, agreement, consent: consentView, current: cur, history: history ?? [], variations: v ?? [], ...common };");
  });
  test("signing is unchanged: the lead installer on the job signs Part B", () => {
    const fn = readFileSync("src/lib/portal.functions.ts", "utf8");
    expect(fn).toContain('else await requireJobRole(context.supabase, data.jobId, [data.party === "installer" ? "installer" : "owner"]);');
    expect(readFileSync("src/lib/assignment.server.ts", "utf8")).toContain('if (a.installer_user_id !== p.actorId) throw new WorkflowError("Only the lead installer on this job can sign.");');
  });
});

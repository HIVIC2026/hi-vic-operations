// Jo 28 Oct 2026 (spec rule 3, fix round 4): only a trade business's OWNER ever sees a price — installer crew AND
// electrician staff get no "$" and no amount anywhere. Non-owners never get office-typed text in next_action /
// hold_reason / event summaries: only known, system-written, price-free text (an allow-list), anything else becomes a set
// line. "Owner" = admin of the business on THIS job (not of some other business the person belongs to).
// Run on its own (bun shares mock.module across files in one process): bun test tests/crew-no-price-allowlist.test.ts
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { repeatPiesaCharge, repeatPiesaNextAction } from "../src/lib/thirty-day-rule.core";
import { STORED_NEXT_ACTION } from "../src/lib/workflow";
import { hashToken } from "../src/lib/worker-links.core";

const HOLD_LINE = "On hold — the office will be in touch";
const NEXT_LINE = "The office will be in touch";
const REPEAT_LINE = "Repeat electrical safety check needed — the office will arrange it";
/** Office-typed text the old "$ / inc GST" block-list let through, plus the obvious ones. */
const TYPED = ["349 incl GST", "owner pays 349", "$ 349", "(inc GST)", "Owner pays 349 including GST", "4,201.25 excl GST", "+ GST", "Call owner re 349", "Quote held: owner price $4,201.25 is over the cap"];
const REPEAT = repeatPiesaNextAction(repeatPiesaCharge({ payer: "owner", reason: "owner", basis: "owner" }, { cents: 34900, source: "quote_line" }));
/** No "$" and no amount anywhere in the JSON. */
const noPrice = (v: unknown) => {
  const s = JSON.stringify(v);
  expect(s).not.toContain("$");
  expect(s).not.toMatch(/349|4,?201|GST/);
};

// ---------------------------------------------------------------------------------------------------------------------
describe("the allow-list (pure)", () => {
  test("non-owners: office-typed or unknown next steps become the set line; owners unchanged", async () => {
    const { nextActionForViewer } = await import("../src/lib/crew-no-price.core");
    for (const t of TYPED) {
      expect(nextActionForViewer(t, false)).toBe(NEXT_LINE);
      expect(nextActionForViewer(t, true)).toBe(t);
    }
    expect(nextActionForViewer("Ring the owner before 9", false)).toBe(NEXT_LINE); // price-free but office-typed: still hidden
    expect(nextActionForViewer(null, false)).toBeNull();
    expect(nextActionForViewer(REPEAT, false)).toBe(REPEAT_LINE);
    expect(nextActionForViewer(REPEAT, true)).toBe(REPEAT);
  });

  test("non-owners: every hold reason becomes the set line; owners unchanged", async () => {
    const { holdReasonForViewer } = await import("../src/lib/crew-no-price.core");
    for (const t of [...TYPED, "Gate 1 auto-decision: does not appear eligible – roof built 2024"]) {
      expect(holdReasonForViewer(t, false)).toBe(HOLD_LINE);
      expect(holdReasonForViewer(t, true)).toBe(t);
    }
    expect(holdReasonForViewer(null, false)).toBeNull();
  });

  test("known system next steps are kept as written", async () => {
    const { nextActionForViewer } = await import("../src/lib/crew-no-price.core");
    for (const t of [
      "Needs finishing: your price on the job page",
      "Needs finishing: ceiling area, owner mobile/email on the Mitti form",
      "Needs finishing: add owner phone, owner contact permission on the Mitti form",
      "Ready Check booked", "Ready Check basics in — quote being prepared", "Ready Check form being set up in Mitti",
      "Waiting for the owner to pick one of the installer's install days", "Deposit paid – installer to offer 3 install days",
      "Waiting for the electrician to offer the owner 3 safety check times (within 24 hours)",
      "Needs me: installer couldn't get in on the install day (No one home). Installer offers 3 new days.",
      "Waiting for the owner to pick new Electrical fixes times", STORED_NEXT_ACTION.installation_booked,
    ]) expect(nextActionForViewer(t, false)).toBe(t);
    // "Needs finishing …" only with plain words (no digits / $), so it can't carry an amount.
    expect(nextActionForViewer("Needs finishing: add 349 on the Mitti form", false)).toBe(NEXT_LINE);
    expect(nextActionForViewer("Needs finishing: $ on the Mitti form", false)).toBe(NEXT_LINE);
  });

  test("no allow-list entry can carry a price; the one stored stage line with $349 is left out", async () => {
    const { CREW_NEXT_ACTIONS, CREW_TIMELINE_SUMMARIES, nextActionForViewer } = await import("../src/lib/crew-no-price.core");
    for (const t of [...CREW_NEXT_ACTIONS, ...CREW_TIMELINE_SUMMARIES]) expect(t).not.toMatch(/\$|GST|\binc\b|\bex\b|\d[\d,]*\.\d\d|%/);
    expect(STORED_NEXT_ACTION.awaiting_deposit_payment).toContain("$349");
    expect(nextActionForViewer(STORED_NEXT_ACTION.awaiting_deposit_payment, false)).toBe(NEXT_LINE);
  });

  test("drift: allow-list texts copied from server/other modules are still what those writers write", async () => {
    const { CREW_NEXT_ACTIONS } = await import("../src/lib/crew-no-price.core");
    const has = (s: string) => expect(CREW_NEXT_ACTIONS).toContain(s);
    has((await import("../src/lib/onsite-ready-check.core")).READY_CHECK_FORM_COMING);
    for (const v of Object.values((await import("../src/lib/piesa-times.core")).PIESA_TIMES_NEXT_ACTION)) has(v);
    for (const r of (await import("../src/lib/trade-view.core")).COULDNT_GET_IN) has(`Needs me: installer couldn't get in on the install day (${r}). Installer offers 3 new days.`);
    expect(readFileSync("src/lib/ready-check-basics.server.ts", "utf8")).toContain('READY_CHECK_BASICS_DONE = "Ready Check basics in — quote being prepared"');
    has("Ready Check basics in — quote being prepared");
    // Literal writers: every listed literal still appears in its writer.
    const src = (f: string) => readFileSync(`src/lib/${f}`, "utf8");
    for (const [f, t] of [
      ["install-days.server.ts", "Waiting for the owner to pick one of the installer's install days"],
      ["ready-check-times.server.ts", "Waiting for the installer to offer the owner Ready Check times"],
      ["payments.server.ts", "Deposit paid – installer to offer 3 install days"],
      ["allocation.server.ts", "Owner and electrician to agree a PIESA time"],
      ["job-electrician.server.ts", "Home Insulation Victoria is arranging the electrician"],
    ] as const) { expect(src(f)).toContain(t); has(t); }
  });

  test("timeline: only known system summaries; filtered BEFORE the 15 limit", async () => {
    const { timelineForViewer, CREW_TIMELINE_SUMMARIES } = await import("../src/lib/crew-no-price.core");
    const ok = CREW_TIMELINE_SUMMARIES[0]!;
    const events = [
      ...TYPED.map((summary, i) => ({ summary, created_at: `2026-10-28T00:00:${String(59 - i).padStart(2, "0")}Z` })),
      { summary: "Put on hold: owner pays 349", created_at: "2026-10-27T23:00:00Z" },
      ...Array.from({ length: 20 }, (_, i) => ({ summary: ok, created_at: `2026-10-${String(26 - (i % 5)).padStart(2, "0")}T00:00:00Z` })),
    ];
    const t = timelineForViewer(events);
    expect(t.length).toBe(15);
    expect(t.every((e) => e.summary === ok)).toBe(true);
    noPrice(t);
  });

  test("the rebate form: crew get no 'Price details' line at all, and still can't sign before the form is ready", async () => {
    const { assignmentForInstaller } = await import("../src/lib/crew-no-price.core");
    const { VEEC_FORM_FIELDS } = await import("../src/lib/veec-assignment-form.core");
    const priceLabels = VEEC_FORM_FIELDS.filter((f) => f.label.includes("$")).map((f) => f.label);
    const common = { installationCompleted: true, finalBlockers: [], veecPrep: { blockers: priceLabels.map((l) => `Missing: ${l}`), missing: priceLabels, values: {}, fields: [] }, officialForm: {} };
    const crew = assignmentForInstaller("installer", null, common, false);
    expect(JSON.stringify(crew)).not.toContain("Price details");
    noPrice(crew);
    expect(crew.veecPrep!.blockers).toEqual([]);
    expect(crew.veecPrep!.formPending).toBe(true);
    const boss = assignmentForInstaller("installer", null, common, true);
    expect(boss.veecPrep!.blockers).toEqual(common.veecPrep.blockers);
    expect((boss.veecPrep as { formPending?: boolean }).formPending).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
const BIZ_I = "00000000-0000-4000-8000-0000000000b1"; // installer business on the job
const BIZ_E = "00000000-0000-4000-8000-0000000000b2"; // electrician business on the job
const BIZ_A = "00000000-0000-4000-8000-0000000000b3"; // another installer business
const BOSS_I = "00000000-0000-4000-8000-0000000000a1";
const CREW_I = "00000000-0000-4000-8000-0000000000c1";
const BOSS_E = "00000000-0000-4000-8000-0000000000a2";
const STAFF_E = "00000000-0000-4000-8000-0000000000c2";
const X = "00000000-0000-4000-8000-0000000000c3"; // boss of A, crew on BIZ_I's job
const J1 = "00000000-0000-4000-8000-000000000401"; // BIZ_I's own customer (A1), on hold with office-typed reason
const J2 = "00000000-0000-4000-8000-000000000402"; // BIZ_I's job, typed next step starting "Needs finishing"
const JA = "00000000-0000-4000-8000-000000000403"; // BIZ_A's own job (X is its boss)
const OWNER = "00000000-0000-4000-8000-0000000000d1";
const PROP = "00000000-0000-4000-8000-0000000000e1";
const TOKEN = "T".repeat(43);
let HOLD = TYPED[0]!;
const TYPED_NEXT = "Ring owner — they pay 349 incl GST";
const NF_TYPED = "Needs finishing: owner pays 349 incl GST";

async function tables(): Promise<Tables> {
  const job = (id: string, n: string, stage: string, next_action: string | null, biz: string) => ({ id, job_number: n, stage, source: "qa_test", channel: "installer_sourced", qa_archived_at: null, deleted_at: null, updated_at: "2026-10-27T00:00:00Z", next_action, owner_id: OWNER, property_id: PROP, originating_installer_business_id: biz });
  const ov = (id: string, n: string, stage: string, next_action: string | null, hold_reason: string | null) => ({ id, job_number: n, stage, channel: "installer_sourced", next_action, hold_reason, property_id: PROP, owner_name: "TEST Owner", owner_phone: "0400000000", owner_email: "owner@example.test", property_address: "1 Test Street, Testville 3999", life_support: false, install_deadline: null, days_remaining: null, piesa_date: null, piesa_expired: false, payment_status: "unpaid" });
  const a = (job_id: string, business_id: string, user_id: string, role: string) => ({ id: `${job_id.slice(-3)}${user_id.slice(-3)}`, job_id, business_id, user_id, role, active: true });
  return {
    // X: first membership is BIZ_A (boss) — the old first-membership rule made X "boss" on BIZ_I's job too.
    business_members: [
      { business_id: BIZ_I, user_id: BOSS_I, member_role: "business_admin", active: true }, { business_id: BIZ_I, user_id: CREW_I, member_role: "member", active: true },
      { business_id: BIZ_E, user_id: BOSS_E, member_role: "business_admin", active: true }, { business_id: BIZ_E, user_id: STAFF_E, member_role: "member", active: true },
      { business_id: BIZ_A, user_id: X, member_role: "business_admin", active: true }, { business_id: BIZ_I, user_id: X, member_role: "member", active: true },
    ],
    user_roles: [BOSS_I, CREW_I, X].map((user_id) => ({ user_id, role: "installer" })).concat([BOSS_E, STAFF_E].map((user_id) => ({ user_id, role: "electrician" }))),
    profiles: [BOSS_I, CREW_I, BOSS_E, STAFF_E, X].map((id) => ({ id, full_name: "TEST Person", phone: null, email: null, business_id: null })),
    businesses: [
      { id: BIZ_I, name: "TEST Insulators", business_type: "eec_installer", capabilities: null, base_suburb: null, coverage_radius_km: null, covers_all_victoria: null, accepting_new_jobs: true, onboarding_notes: "[TEST PARTNER]", mitti_account_invited: false },
      { id: BIZ_E, name: "TEST Sparky", business_type: "rec", capabilities: null, base_suburb: null, coverage_radius_km: null, covers_all_victoria: null, accepting_new_jobs: true, onboarding_notes: "[TEST PARTNER]", mitti_account_invited: false },
      { id: BIZ_A, name: "TEST Other Insulators", business_type: "eec_installer", capabilities: null, base_suburb: null, coverage_radius_km: null, covers_all_victoria: null, accepting_new_jobs: true, onboarding_notes: "[TEST PARTNER]", mitti_account_invited: false },
    ],
    job_assignments: [a(J1, BIZ_I, CREW_I, "installer"), a(J2, BIZ_I, CREW_I, "installer"), a(J1, BIZ_E, STAFF_E, "electrician"), a(J2, BIZ_E, STAFF_E, "electrician"), a(J1, BIZ_I, X, "installer"), a(JA, BIZ_A, X, "installer")],
    jobs: [job(J1, "HV-9401", "on_hold", TYPED_NEXT, BIZ_I), job(J2, "HV-9402", "ready_check_scheduled", NF_TYPED, BIZ_I), job(JA, "HV-9403", "on_hold", TYPED_NEXT, BIZ_A)],
    owners: [{ id: OWNER, full_name: "TEST Owner" }],
    properties: [{ id: PROP, address_line: "1 Test Street", suburb: "Testville", postcode: "3999" }],
    job_overview: [ov(J1, "HV-9401", "on_hold", TYPED_NEXT, HOLD), ov(J2, "HV-9402", "ready_check_scheduled", NF_TYPED, null), ov(JA, "HV-9403", "on_hold", TYPED_NEXT, HOLD)],
    worker_job_links: [{ id: "l1", job_id: J1, worker_id: "w1", business_id: BIZ_E, expires_at: "2099-01-01T00:00:00Z", revoked_at: null, open_count: 0, token_hash: await hashToken(TOKEN) }],
    partner_workers: [{ id: "w1", full_legal_name: "TEST Staff Sparky", trade_role: "electrician", approval_status: "approved", certification_status: "verified", removed_at: null }],
    workflow_events: [
      ...TYPED.map((summary, i) => ({ job_id: J1, summary, internal: false, created_at: `2026-10-28T00:00:${String(10 + i)}Z` })),
      { job_id: J1, summary: "Ready Check completed", internal: false, created_at: "2026-10-20T00:00:00Z" },
    ],
    messages: [], assessments: [], ceiling_measurements: [], bookings: [], contact_releases: [],
    rate_cards: [{ id: "rc1", business_id: BIZ_E, kind: "electrical", is_active: true, version: 1 }],
    rate_card_items: [{ rate_card_id: "rc1", code: "CUSTOM_RCD", description: "Install RCD", unit: "each", display_unit: "each", category: "electrical", sort: 1, rate_inc_gst: 349, price_inc_gst: 349 }],
    partner_offers: [], evidence_requirements: [], job_piesa_deadlines: [],
  };
}
let T: Tables = {};
const REL = true;
mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => memoryPostgrest(T).from(t), rpc: async (name: string) => ({ data: name === "has_contact_release" ? REL : null, error: null }) },
}));
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => { let h: (a: unknown) => unknown = () => undefined; const chain: Record<string, unknown> = { middleware: () => chain, inputValidator: () => chain, handler: (fn: typeof h) => { h = fn; return (a: unknown) => h(a); } }; return chain; },
  createMiddleware: () => ({ server: (fn: unknown) => fn }),
}));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("../src/lib/job-status.server", () => ({ statusFactsFor: async () => new Map(), statusView: () => null }));
mock.module("../src/lib/installer-quote-status.server", () => ({
  loadInstallerQuotes: async () => new Map(),
  loadInstallerQuote: async () => ({ applies: true, channel: "installer_sourced", sent: false, held: false, formCompleted: true, electricianNotOnboarded: null, quote: { id: "q1", quote_items: [{ description: "Insulation", explanation: null, quantity: 1, unit: null, line_total_inc_gst: 4201.25 }], subtotal_inc_gst: 4201.25, veec_discount_inc_gst: 0, customer_total_inc_gst: 4201.25 } }),
}));
mock.module("../src/lib/installer-price.server", () => ({ readInstallerPrices: async () => new Map(), readInstallerPrice: async () => null }));
mock.module("../src/lib/office-quote-review.server", () => ({ officeQuoteBlockers: async () => [] }));
const sbAs = (role: string) => ({ auth: { getUser: async () => ({ data: { user: { user_metadata: {} } } }) }, rpc: async () => ({ data: role, error: null }) }) as never;

describe("job list (getTradeHome = tradeHome): whole rows", () => {
  test("installer crew: no $ / amount; typed 'Needs finishing' text and typed next step are the set line", async () => {
    T = await tables();
    const { tradeHome } = await import("../src/lib/trade-view.server");
    const home = await tradeHome(CREW_I);
    expect(home.boss).toBe(false);
    expect(home.jobs.length).toBe(2);
    noPrice(home);
    expect(home.jobs.find((j) => j.jobId === J2)!.status).toBe(NEXT_LINE);
    const rows = [...home.home!.action, ...home.home!.progress, ...home.home!.done];
    expect(rows.find((r) => r.jobId === J1)!.nextAction).toBe(NEXT_LINE);
  });
  test("electrician staff: no $ / amount", async () => {
    T = await tables();
    const { tradeHome } = await import("../src/lib/trade-view.server");
    const home = await tradeHome(STAFF_E);
    expect(home.kind).toBe("electrician");
    expect(home.boss).toBe(false);
    expect(home.jobs.length).toBe(2);
    noPrice(home);
  });
  test("installer owner: unchanged", async () => {
    T = await tables();
    T["job_assignments"] = T["job_assignments"]!.map((r) => (r["user_id"] === CREW_I ? { ...r, user_id: BOSS_I } : r));
    const { tradeHome } = await import("../src/lib/trade-view.server");
    const home = await tradeHome(BOSS_I);
    expect(home.boss).toBe(true);
    expect(home.jobs.find((j) => j.jobId === J2)!.status).toBe(NF_TYPED);
    expect([...home.home!.action, ...home.home!.progress].find((r) => r.jobId === J1)!.nextAction).toBe(TYPED_NEXT);
  });
});

describe("job page overview (getJobOverview / bundle overview = jobOverviewFor)", () => {
  for (const h of ["349 incl GST", "owner pays 349", "$ 349", "(inc GST)"]) {
    test(`hold "${h}": installer crew and electrician staff get the set lines, nothing priced`, async () => {
      HOLD = h; T = await tables();
      const { jobOverviewFor } = await import("../src/lib/job-overview.server");
      for (const [who, role] of [[CREW_I, "installer"], [STAFF_E, "electrician"]] as const) {
        const { row } = await jobOverviewFor(sbAs(role), who, J1);
        noPrice(row);
        expect(row.hold_reason).toBe(HOLD_LINE);
        expect(row.next_action).toBe(NEXT_LINE);
        // what the electrician page shows (nextStep reads hold_reason)
        const { nextStep } = await import("../src/lib/nextstep.core");
        noPrice(nextStep(row));
      }
    });
  }
  test("owners (installer + electrician), office and admin: unchanged", async () => {
    HOLD = TYPED[0]!; T = await tables();
    T["job_assignments"]!.push({ id: "bE", job_id: J1, business_id: BIZ_E, user_id: BOSS_E, role: "electrician", active: true });
    const { jobOverviewFor } = await import("../src/lib/job-overview.server");
    for (const [who, role] of [[BOSS_I, "installer"], [BOSS_E, "electrician"], [BOSS_I, "admin"]] as const) {
      const { row } = await jobOverviewFor(sbAs(role), who, J1);
      expect(row.hold_reason).toBe(HOLD);
      expect(row.next_action).toBe(TYPED_NEXT);
    }
  });
  test("boss of business A who is crew on business I's job: crew output on I's job, owner output on A's job", async () => {
    HOLD = TYPED[0]!; T = await tables();
    const { tradeContext } = await import("../src/lib/trade-view.server");
    expect((await tradeContext(X))?.boss).toBe(true); // the first-membership rule alone would call X "boss"
    const { jobOverviewFor } = await import("../src/lib/job-overview.server");
    const onI = (await jobOverviewFor(sbAs("installer"), X, J1)).row;
    noPrice(onI);
    expect(onI.hold_reason).toBe(HOLD_LINE);
    const onA = (await jobOverviewFor(sbAs("installer"), X, JA)).row;
    expect(onA.hold_reason).toBe(HOLD);
    expect(onA.next_action).toBe(TYPED_NEXT);
  });
  test("the bundle's overview section is the same cleaned row", async () => {
    HOLD = TYPED[0]!; T = await tables();
    const { jobOverviewFor } = await import("../src/lib/job-overview.server");
    const { tradeJobBundle } = await import("../src/lib/trade-job-bundle.server");
    const stub = async () => ({}) as never;
    for (const [who, role] of [[CREW_I, "installer"], [STAFF_E, "electrician"]] as const) {
      const b = await tradeJobBundle(sbAs(role), who, J1, {
        overview: jobOverviewFor, access: async () => ({ boss: false, kind: role, biz: { mitti_account_invited: false } }) as never,
        page: stub, installDays: stub, readyCheckTimes: stub, allocation: stub, swms: stub, workerLinks: stub, price: stub, ownerQuote: stub,
      });
      noPrice(b.overview);
    }
  });
});

describe("owner quote read: owner of the business on THIS job", () => {
  const sb = { rpc: async () => ({ data: true, error: null }) };
  test("boss of A, crew on I's job: status only, no price; boss of I: the figures", async () => {
    T = await tables();
    const { myOwnerQuoteFor } = await import("../src/lib/my-owner-quote.server");
    const onI = await myOwnerQuoteFor(sb, X, J1);
    expect(onI).toMatchObject({ applies: true, priceHidden: true });
    noPrice(onI);
    expect(await myOwnerQuoteFor(sb, BOSS_I, J1)).toMatchObject({ priceHidden: false, total: 4201.25 });
    expect(await myOwnerQuoteFor(sb, CREW_I, J1)).toMatchObject({ priceHidden: true });
  });
});

describe("rebate form (getAssignment) and other owner checks use the job's own business", () => {
  test("getAssignment and the owner quote read take 'owner' from ownsJobBusiness, not tradeContext", () => {
    const fn = readFileSync("src/lib/portal.functions.ts", "utf8");
    expect(fn).toContain('const boss = await (await import("./crew-no-price.server")).ownsJobBusiness(data.jobId, context.userId, "installer");');
    expect(fn).toContain("return assignmentForInstaller(role, cur, common, boss);");
    expect(readFileSync("src/lib/my-owner-quote.server.ts", "utf8")).toContain('ownsJobBusiness(jobId, userId, "installer")');
    expect(readFileSync("src/lib/job-overview.server.ts", "utf8")).toContain("ownsJobBusiness(jobId, userId, role)");
  });
  test("ownsJobBusiness reuses requireJobBusinessOwner / requireMember (no copied membership check)", () => {
    const s = readFileSync("src/lib/crew-no-price.server.ts", "utf8");
    expect(s).toContain("requireJobBusinessOwner(jobId, userId)");
    expect(s).toContain("requireMember(userId, b, true)");
    expect(s).not.toContain("business_members");
  });
  test("ownsJobBusiness: per job, per role", async () => {
    T = await tables();
    const { ownsJobBusiness } = await import("../src/lib/crew-no-price.server");
    expect(await ownsJobBusiness(J1, X, "installer")).toBe(false);
    expect(await ownsJobBusiness(JA, X, "installer")).toBe(true);
    expect(await ownsJobBusiness(J1, CREW_I, "installer")).toBe(false);
    expect(await ownsJobBusiness(J1, BOSS_I, "installer")).toBe(true);
    expect(await ownsJobBusiness(J1, STAFF_E, "electrician")).toBe(false);
    expect(await ownsJobBusiness(J1, BOSS_E, "electrician")).toBe(true);
    expect(await ownsJobBusiness(J1, BOSS_I, "electrician")).toBe(false);
  });
});

describe("worker link page (/w/$token): electrician staff", () => {
  test("page data: no $ / amount; typed next step is the set line; timeline keeps known system lines only", async () => {
    T = await tables();
    const { getWorkerJobView } = await import("../src/lib/worker-links.functions");
    const v = (await (getWorkerJobView as unknown as (a: unknown) => Promise<Record<string, unknown>>)({ data: { token: TOKEN } })) as { job: { next_action: string }; timeline: { summary: string }[] };
    noPrice(v);
    expect(v.job.next_action).toBe(NEXT_LINE);
    expect(v.timeline.map((e) => e.summary)).toEqual(["Ready Check completed"]);
  });
  test("approved rates list carries no price column", async () => {
    T = await tables();
    const { getWorkerApprovedRectificationRates } = await import("../src/lib/worker-links.functions");
    const r = await (getWorkerApprovedRectificationRates as unknown as (a: unknown) => Promise<unknown[]>)({ data: { token: TOKEN } });
    expect(r).toEqual([{ code: "CUSTOM_RCD", description: "Install RCD", unit: "each", display_unit: "each" }]);
    noPrice(r);
  });
});

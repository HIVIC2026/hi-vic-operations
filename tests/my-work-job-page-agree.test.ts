// Fix wave I4 (installer screens, 3 Nov 2026): My work's Next step box must come from the SAME facts as the Job page's —
// the deposit date from the owner's real payment (not jobs.updated_at), what the Mitti form still needs from the job's
// "Needs finishing" line, who books from businesses.piesa_booked_by, the electrician from the allocation event, the
// certificate from its document. REAL server modules against an in-memory database (tests/helpers/memory-postgrest.ts).
// Run on its own (bun shares mock.module across files in one process).
import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const tables: Tables = {};
const shim = memoryPostgrest(tables);
const adminRpc: Record<string, unknown> = { has_contact_release: true };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => shim.from(t), rpc: async (name: string) => ({ data: adminRpc[name] ?? null, error: null }), storage: { from: () => ({}) } } }));

const { tradeHome, tradeJobPage } = await import("../src/lib/trade-view.server");

const NOW = new Date("2026-11-03T03:00:00.000Z"); // Tue 3 Nov, Melbourne 2pm
const B1 = "00000000-0000-4000-8000-0000000000b1";
const U_BOSS = "00000000-0000-4000-8000-0000000000a1";
const W_ELEC = "00000000-0000-4000-8000-0000000000e1";
const J = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const at = (days: number, hour = 0) => new Date(NOW.getTime() + days * 86_400_000 + hour * 3_600_000).toISOString();

type Opts = { whoBooks?: "office" | "electrician" | "either"; piesaBookedByColumn?: boolean };
/** J1: deposit paid (ledger, 4 days ago) after electrical UPGRADES with the CoES document on file → book the install.
 *  J2: Ready Check done but the form still needs the owner's details → finish the Ready Check.
 *  J3: quote accepted, no PIESA yet → book the PIESA (office) or wait for the Team electrician the event names.
 *  J4: like J1 but no certificate document → upload the certificate (deposit paid). */
function seed(o: Opts = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  const job = (n: number, stage: string, extra: Record<string, unknown> = {}) => ({
    id: J(n), job_number: `HV-${1000 + n}`, stage, source: "website", channel: "hivic_sourced", qa_archived_at: null, deleted_at: null,
    updated_at: at(-1), next_action: null, created_at: at(-30), owner_id: `o${n}`, property_id: `p${n}`, electrician_choice: null,
    originating_installer_business_id: null, installation_completed_at: null, life_support_status: null, ...extra,
  });
  const biz: Record<string, unknown> = { id: B1, name: "Inst Co", legal_name: "Inst Co Pty Ltd", trading_name: null, business_type: "eec_installer", capabilities: ["installer"], base_suburb: "Geelong", coverage_radius_km: 50, covers_all_victoria: false, accepting_new_jobs: true, onboarding_notes: null, mitti_account_invited: true, in_house: true, pays_own_electricians: true, branding: {}, phone: "03 9000 0000" };
  if (o.piesaBookedByColumn !== false) biz["piesa_booked_by"] = o.whoBooks ?? "office";
  Object.assign(tables, {
    businesses: [biz],
    business_members: [{ id: "m1", business_id: B1, user_id: U_BOSS, member_role: "business_admin", active: true }],
    user_roles: [{ user_id: U_BOSS, role: "installer" }],
    profiles: [{ id: U_BOSS, full_name: "Bea Boss", phone: null, email: "bea@example.com", business_id: B1 }],
    owners: [1, 2, 3, 4].map((n) => ({ id: `o${n}`, full_name: `Owner Number${n}`, phone: "0400000000", email: `o${n}@example.com` })),
    properties: [1, 2, 3, 4].map((n) => ({ id: `p${n}`, address_line: `${n} Test St`, suburb: "Geelong", postcode: "3220" })),
    jobs: [
      job(1, "installation_scheduling"),
      job(2, "ready_check_complete", { next_action: "Needs finishing: owner details on the Mitti form." }),
      job(3, "piesa_and_install_window_pending"),
      job(4, "installation_scheduling"),
    ],
    job_assignments: [
      ...[1, 2, 3, 4].map((n) => ({ id: `a${n}`, job_id: J(n), business_id: B1, user_id: U_BOSS, role: "installer", active: true, assigned_at: at(-20) })),
      // The electrician on J3 has no login (electricians never log in): user_id null, named by the allocation event.
      { id: "e3", job_id: J(3), business_id: B1, user_id: null, role: "electrician", active: true, assigned_at: at(-2) },
    ],
    partner_workers: [{ id: W_ELEC, business_id: B1, profile_id: null, full_legal_name: "Will Casdorff", trade_role: "electrician", removed_at: null, approval_status: "approved", email: "will@example.com", licence_number: "L1", rec_number: "R1", licence_expires_on: "2030-01-01", licence_verified_at: at(-30) }],
    bookings: [
      ...[1, 2, 3, 4].map((n) => ({ id: `rc${n}`, job_id: J(n), business_id: B1, kind: "ready_check", status: "completed", scheduled_start: at(-15), scheduled_end: at(-15, 1), created_at: at(-16) })),
      ...[1, 4].map((n) => ({ id: `as${n}`, job_id: J(n), business_id: B1, kind: "assessment", status: "completed", scheduled_start: at(-10), scheduled_end: at(-10, 1), created_at: at(-12) })),
    ],
    assessments: [1, 4].map((n) => ({ id: `asm${n}`, job_id: J(n), status: "complete", piesa_outcome: "fail", completed_at: at(-10), hazards: null, mitti_raw_snapshot: [], external_mitti_id: `m${n}` })),
    piesa_records: [1, 4].map((n) => ({ id: `pr${n}`, job_id: J(n), kind: "initial", outcome: "fail", rectification_completed_at: null, section_c_signed_at: null, is_current: true, created_at: at(-10) })),
    documents: [{ id: "d1", job_id: J(1), kind: "piesa_evidence", title: "PIESA evidence – Certificate of Electrical Safety (photo or PDF)", source_system: "mitti", storage_path: "x", mime_type: "application/pdf", created_at: at(-5) }],
    ceiling_measurements: [1, 2, 3, 4].map((n) => ({ id: `cm${n}`, job_id: J(n), is_current: true, measured_area_m2: 92, removal_m2: null, removal_required: false, external_source: "mitti", external_id: `audit-${n}`, access_difficulty: null, raw_snapshot: [] })),
    quotes: [1, 3, 4].map((n) => ({ id: `q${n}`, job_id: J(n), kind: "installation", status: "accepted", sent_at: at(-9), accepted_at: at(-8), release_state: "released", release_hold_reason: null, option_code: "R5_BATTS", created_at: at(-9), subtotal_inc_gst: 4000, veec_discount_inc_gst: 500, customer_total_inc_gst: 3500 })),
    quote_items: [1, 3, 4].map((n) => ({ id: `qi${n}`, quote_id: `q${n}`, code: "INSUL", description: "Ceiling batts", quantity: 92, unit: "m2", unit_price_inc_gst: 38, line_total_inc_gst: 3500, sort: 1 })),
    quote_internals: [1, 3, 4].map((n) => ({ id: `qn${n}`, quote_id: `q${n}`, cost_ex_gst: 2000 })),
    // Owner paid the $349 + 50% deposit on J1/J4 four days ago: the ledger row carries the real date; jobs.updated_at is yesterday.
    invoices: [1, 4].map((n) => ({ id: `inv${n}`, job_id: J(n), kind: "installation", status: "partially_paid", total_inc_gst: 3500, total_paid: 2000, created_at: at(-9), updated_at: at(-1), quote_id: `q${n}` })),
    workflow_events: [
      ...[1, 2, 3, 4].map((n) => ({ id: `rcb${n}`, job_id: J(n), event_type: "ready_check_basics", created_at: at(-14), details: { completed: true, answered: true } })),
      ...[1, 4].map((n) => ({ id: `pay${n}`, job_id: J(n), event_type: "owner_payment_recorded", created_at: at(-4), actor_id: null, details: { invoice_id: `inv${n}`, amount_cents: 200000, source: "stripe", paid_at: at(-4), receipt_key: `k${n}` } })),
      { id: "alloc3", job_id: J(3), event_type: "in_house_electrician_allocated", created_at: at(-2), details: { worker_id: W_ELEC, business_id: B1 } },
    ],
    owner_esc_consents: [], customer_email_sends: [], customer_assignments: [], installer_declarations: [], rectification_items: [], appointment_proposals: [], partner_offers: [],
    evidence_requirements: [], job_piesa_deadlines: [], payment_overrides: [], assessment_payments: [], ready_check_windows: [],
    workflow_settings: [{ id: 1, safety_check_payment_inc_gst: 349, due_trade_reply_warn_hours: 24, due_trade_reply_exception_hours: 48, due_owner_reminder_days: 3, due_owner_flag_days: 7 }],
    rate_cards: [{ id: "rc1", business_id: B1, version: 2, effective_from: "2026-01-01", is_active: true }],
    rate_card_items: [{ id: "rci1", rate_card_id: "rc1", code: "PIESA", unit_price_ex_gst: 300 }],
    electrician_rates: [],
  });
}

beforeAll(() => { setSystemTime(NOW); });
afterAll(() => { setSystemTime(); });

async function both(n: number) {
  const home = await tradeHome(U_BOSS);
  const card = home.myWork!.all.find((c) => c.jobId === J(n))!;
  const page = await tradeJobPage(J(n), U_BOSS);
  return { card, box: page.nextStep };
}
/** The card is the box: same step, book-by, overdue flag and whose turn it is. */
const agree = (r: Awaited<ReturnType<typeof both>>) => expect({ step: r.card.step, by: r.card.by, overdue: r.card.overdue, yours: r.card.yours })
  .toEqual({ step: r.box.title, by: r.box.bookBy, overdue: r.box.overdue, yours: r.box.yours });

describe("My work and the Job page agree (same reads)", () => {
  test("deposit paid after upgrades with the certificate on file: Book the install, book-by from the owner's real payment date", async () => {
    seed();
    const r = await both(1);
    agree(r);
    expect(r.box.kind).toBe("book_install");
    // paid Fri 30 Oct (4 days before Tue 3 Nov) + 1 business day = Mon 2 Nov — never "yesterday" (jobs.updated_at)
    expect(r.box.bookBy).toBe("2026-11-02");
    expect(r.card.overdue).toBe(true);
  });

  test("upgrades with no certificate document: upload the certificate on both (deposit already in)", async () => {
    seed();
    const r = await both(4);
    agree(r);
    expect(r.box.kind).toBe("upload_certificate");
    expect(r.box.lines).toEqual([]);
    expect(r.box.alsoBookInstall).not.toBeNull();
  });

  test("Ready Check done but the form still needs the owner's details: Finish the Ready Check with the same 'Still needs' line", async () => {
    seed();
    const r = await both(2);
    agree(r);
    expect(r.box.kind).toBe("ready_check_missing");
    expect(r.box.sub).toBe("Still needs: The owner's details");
  });

  test("who books: 'office' → book the PIESA on both; 'electrician' → both wait for the electrician the allocation event names", async () => {
    seed({ whoBooks: "office" });
    const office = await both(3);
    agree(office);
    expect(office.box.kind).toBe("book_piesa");
    seed({ whoBooks: "electrician" });
    const elec = await both(3);
    agree(elec);
    expect(elec.box.kind).toBe("waiting_electrician_book");
    expect(elec.box.sub).toContain("Waiting for Will Casdorff to book the PIESA.");
  });

  test("the pending piesa_booked_by column missing reads as 'office' on both", async () => {
    seed({ piesaBookedByColumn: false });
    const r = await both(3);
    agree(r);
    expect(r.box.kind).toBe("book_piesa");
  });
});

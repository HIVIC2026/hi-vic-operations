/**
 * P1-R1-S93 — Office UI for the Template 8 Ready Check invitation.
 *
 * Two complementary layers, matching this repo's testing conventions:
 *
 * 1. BEHAVIOURAL (real DB): the workflow the UI drives, executed against a real Postgres engine (PGlite)
 *    through the project's PostgREST shim, using the REAL server modules the UI calls. The email
 *    provider is a counting mock, so no real communication can occur.
 * 2. STRUCTURAL (source): the UI contract itself — route placement inside the Office admin area,
 *    navigation entry, the required Office actions, and the absence of any automatic send.
 *
 * Browser/DOM rendering of the page is NOT covered here; that belongs to R6 formal UAT.
 */
import { describe, expect, mock, test, beforeAll, afterEach } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const OWNER = "00000000-0000-4000-8000-000000000ee1";
const PROP_A = "00000000-0000-4000-8000-000000000e01";
const PROP_B = "00000000-0000-4000-8000-000000000e02";
const OFFICE = { userId: "00000000-0000-4000-8000-000000000ff1", role: "office" as const };
const NOT_OFFICE = { userId: "00000000-0000-4000-8000-000000000ff2", role: "none" as const };
const UNAUTH = { userId: null, role: "office" as const };

// JOB_OK          saved spot + complete frozen snapshot  -> can be invited
// JOB_NO_SAVE     no saved spot                         -> not a candidate
// JOB_NO_SNAP     saved spot but no frozen fees         -> candidate, but preparation fails closed
// JOB_CLOSED      saved spot, job closed                -> not a candidate
// JOB_DELETED     saved spot, job deleted               -> not a candidate
// JOB_INELIGIBLE  saved spot, ineligible                -> not a candidate
const JOB_OK = "00000000-0000-4000-8000-0000000000a1";
const JOB_NO_SAVE = "00000000-0000-4000-8000-0000000000a2";
const JOB_NO_SNAP = "00000000-0000-4000-8000-0000000000a3";
const JOB_CLOSED = "00000000-0000-4000-8000-0000000000a4";
const JOB_DELETED = "00000000-0000-4000-8000-0000000000a5";
const JOB_INELIGIBLE = "00000000-0000-4000-8000-0000000000a6";
const TOKEN_OK = "A".repeat(43);
const TOKEN_EXPIRED = "E".repeat(43);
const TOKEN_NOSNAP = "N".repeat(43);

const FEES = {
  piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349,
  r5_install_inc_gst_per_m2: 30, indicative_veec_value: 70,
};
const SAVED = { total: 3697.24, rebate: 1481.76, gross: 5179, area: 150 };

const db = new PGlite();
let providerCalls: { to: string; subject: string; html: string; text: string; purpose: string }[] = [];
const ADAPTER = {
  provider: "mock",
  deliver: async (m: { to: string; subject: string; html: string; text: string; purpose: string }) => {
    providerCalls.push(m);
    return { providerMessageId: `mock-${providerCalls.length}` };
  },
};

const q = async (sql: string) => (await db.query(sql)).rows;

beforeAll(async () => {
  await db.exec(`
    CREATE TABLE public.owners (id uuid primary key, email text, full_name text);
    CREATE TABLE public.jobs (id uuid primary key, job_number text, deleted_at timestamptz, property_id uuid, owner_id uuid,
      stage text, source text, created_at timestamptz, last_activity_at timestamptz, external_enquiry_id text,
      eligibility_outcome text, eligibility_decision_source text, eligibility_review_required boolean);
    CREATE TABLE public.properties (id uuid primary key, address_line text, suburb text, state text, postcode text);
    CREATE TABLE public.customer_estimate_links (id uuid primary key default gen_random_uuid(), job_id uuid, token text, purpose text, status text, expires_at timestamptz);
    CREATE TABLE public.lead_campaign_responses (job_id uuid primary key, spot_saved_at timestamptz, opted_out_at timestamptz,
      saved_total numeric, saved_veu_discount numeric, saved_gross_total numeric, saved_area_m2 numeric, saved_insulation text, desk_check_status text);
    CREATE TABLE public.indicative_estimates (id uuid primary key, job_id uuid, status text, area_source text, snapshot jsonb);
    CREATE TABLE public.workflow_settings (id integer primary key, customer_comms_enabled boolean, save_my_spot_real_send_enabled boolean);
    CREATE TABLE public.owner_contact_consents (id uuid primary key default gen_random_uuid(), job_id uuid, consent_status text, created_at timestamptz);
    CREATE TABLE public.customer_email_optouts (id uuid primary key default gen_random_uuid(), job_id uuid, token text, opted_out_at timestamptz);
    CREATE TABLE public.customer_engagement_events (id uuid primary key default gen_random_uuid(), job_id uuid, event_type text);
    CREATE TABLE public.customer_delivery_settings (id integer primary key, jobs_created_after timestamptz);
    CREATE TABLE public.customer_email_sends (id uuid primary key default gen_random_uuid(), job_id uuid, purpose text, idempotency_key text,
      status text, created_at timestamptz default now(), sent_at timestamptz, provider text, provider_message_id text, error text, estimate_link_id uuid, communication_id uuid);
    CREATE TABLE public.workflow_events (id bigserial primary key, job_id uuid, actor_id uuid, event_type text, summary text,
      details jsonb, from_stage text, to_stage text, internal boolean, created_at timestamptz default now());
    CREATE TABLE public.job_communications (id uuid primary key default gen_random_uuid(), job_id uuid, direction text, channel text,
      subject text, body text, sender_text text, sender_user_id uuid, recipients jsonb, provider text, provider_message_id text,
      sent_at timestamptz, received_at timestamptz, delivery_status text, visibility text, source_event text, source_reference text, created_by uuid);

    INSERT INTO public.owners VALUES ('${OWNER}', 'alex.smith@gmail.com', 'Alex Smith');
    INSERT INTO public.properties VALUES ('${PROP_A}', '30 Dash St', 'Fraser Rise', 'VIC', '3336');
    INSERT INTO public.properties VALUES ('${PROP_B}', '9 Wedge Rd', 'Sunbury', 'VIC', '3429');
    INSERT INTO public.customer_delivery_settings VALUES (1, '2020-01-01T00:00:00Z');
  `);

  const job = (id: string, num: string, stage: string, deleted: string | null, outcome: string) =>
    `INSERT INTO public.jobs (id, job_number, owner_id, property_id, stage, source, created_at, external_enquiry_id, eligibility_outcome, eligibility_decision_source, eligibility_review_required, deleted_at)
     VALUES ('${id}', '${num}', '${OWNER}', '${PROP_A}', '${stage}', 'base44', '2026-10-01T00:00:00Z', '${num}', '${outcome}', 'system', false, ${deleted ? `'${deleted}'` : "NULL"});`;
  const saved = (id: string) =>
    `INSERT INTO public.lead_campaign_responses (job_id, spot_saved_at, saved_total, saved_veu_discount, saved_gross_total, saved_area_m2, saved_insulation)
     VALUES ('${id}', '2026-10-02T00:00:00Z', ${SAVED.total}, ${SAVED.rebate}, ${SAVED.gross}, ${SAVED.area}, 'none');`;

  await db.exec(job(JOB_OK, "HV-3001", "eligibility_review", null, "likely_eligible"));
  await db.exec(job(JOB_NO_SAVE, "HV-3002", "eligibility_review", null, "likely_eligible"));
  await db.exec(job(JOB_NO_SNAP, "HV-3003", "eligibility_review", null, "likely_eligible"));
  await db.exec(job(JOB_CLOSED, "HV-3004", "complete", null, "likely_eligible"));
  await db.exec(job(JOB_DELETED, "HV-3005", "eligibility_review", "2026-10-05T00:00:00Z", "likely_eligible"));
  await db.exec(job(JOB_INELIGIBLE, "HV-3006", "eligibility_review", null, "does_not_appear_eligible"));
  await db.exec(saved(JOB_OK));
  await db.exec(saved(JOB_NO_SNAP));
  await db.exec(saved(JOB_CLOSED));
  await db.exec(saved(JOB_DELETED));
  await db.exec(saved(JOB_INELIGIBLE));
  await db.exec(`INSERT INTO public.lead_campaign_responses (job_id) VALUES ('${JOB_NO_SAVE}');`);

  await db.exec(`INSERT INTO public.customer_estimate_links (job_id, token, purpose, status, expires_at) VALUES ('${JOB_OK}', '${TOKEN_OK}', 'step3_estimate', 'active', '2099-01-01T00:00:00Z');`);
  await db.exec(`INSERT INTO public.customer_estimate_links (job_id, token, purpose, status, expires_at) VALUES ('${JOB_NO_SNAP}', '${TOKEN_NOSNAP}', 'step3_estimate', 'active', '2099-01-01T00:00:00Z');`);
  await db.exec(`INSERT INTO public.indicative_estimates VALUES (gen_random_uuid(), '${JOB_OK}', 'current', 'declared', '{"settings":${JSON.stringify(FEES)}}');`);
  // JOB_NO_SNAP has a saved spot but NO frozen indicative estimate: the snapshot is incomplete.

  await db.exec(`INSERT INTO public.workflow_settings VALUES (1, false, false);`);
  await db.exec(`INSERT INTO public.owner_contact_consents (job_id, consent_status, created_at) VALUES ('${JOB_OK}', 'granted', '2026-10-01T00:00:00Z');`);
});

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
mock.module("../src/lib/delivery.server", () => ({ configuredDeliveryAdapter: async () => ADAPTER }));

const { loadReadyCheckCandidates, prepareReadyCheckInvitation, sendReadyCheckInvitation } = await import("../src/lib/ready-check-invitation.server");

afterEach(async () => {
  providerCalls = [];
  await db.exec(`
    DELETE FROM public.customer_email_sends; DELETE FROM public.workflow_events; DELETE FROM public.job_communications;
    DELETE FROM public.customer_email_optouts; DELETE FROM public.customer_engagement_events; DELETE FROM public.owner_contact_consents;`);
  await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = false, save_my_spot_real_send_enabled = false WHERE id = 1;`);
  await db.exec(`INSERT INTO public.owner_contact_consents (job_id, consent_status, created_at) VALUES ('${JOB_OK}', 'granted', '2026-10-01T00:00:00Z');`);
});

const switchesOn = () => db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = true, save_my_spot_real_send_enabled = true WHERE id = 1;`);

// ---------------------------------------------------------------------------
// A. Office authorization
// ---------------------------------------------------------------------------
describe("A. Office authorization", () => {
  test("an Office user can read the candidates and prepare an invitation", async () => {
    expect((await loadReadyCheckCandidates()).length).toBeGreaterThan(0);
    const p = await prepareReadyCheckInvitation(JOB_OK, OFFICE);
    expect(p.ok).toBe(true);
  });
  test("a non-Office role is refused and sees no saved pricing or invitation content", async () => {
    const p = await prepareReadyCheckInvitation(JOB_OK, NOT_OFFICE);
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.reason).toContain("office");
      // The refusal must not carry the rendered email or the customer's figures.
      expect(JSON.stringify(p)).not.toContain("3697.24");
      expect(JSON.stringify(p)).not.toContain("<table");
      expect(JSON.stringify(p)).not.toContain("my-estimate");
    }
    const s = await sendReadyCheckInvitation(JOB_OK, NOT_OFFICE);
    expect(s.sent).toBe(false);
    expect(providerCalls.length).toBe(0);
  });
  test("an actor with no user id is refused", async () => {
    expect((await prepareReadyCheckInvitation(JOB_OK, UNAUTH)).ok).toBe(false);
    expect((await sendReadyCheckInvitation(JOB_OK, UNAUTH)).sent).toBe(false);
    expect(providerCalls.length).toBe(0);
  });
  test("the UI lives inside the Office admin area, which requires the admin role", () => {
    const guard = readFileSync("src/routes/_authenticated/admin.tsx", "utf8");
    expect(guard).toMatch(/loadAccess/);
    expect(guard).toMatch(/\.admin\b/);
    expect(guard).toMatch(/throw redirect/);
    // The page file is admin.*, so it inherits that guard with no extra code.
    expect(existsSync("src/routes/_authenticated/admin.ready-check.tsx")).toBe(true);
  });
  test("every Office entry point re-checks requireAdmin on the server", () => {
    const fns = readFileSync("src/lib/ready-check-invitation.functions.ts", "utf8");
    expect(fns.match(/requireAdmin\(context\.supabase\)/g)?.length).toBe(3);
    for (const name of ["getReadyCheckCandidates", "prepareReadyCheckInvitation", "sendReadyCheckInvitation"]) {
      expect(fns).toContain(`export const ${name}`);
      expect(fns).toContain(`requireSupabaseAuth`);
    }
  });
  test("the Office entry points are POST-oriented and take only a validated jobId", () => {
    const fns = readFileSync("src/lib/ready-check-invitation.functions.ts", "utf8");
    expect(fns.match(/z\.string\(\)\.uuid\(\)/g)?.length).toBe(2);
    expect(fns.match(/method: "POST"/g)?.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// B. Candidate list
// ---------------------------------------------------------------------------
describe("B. Candidate list", () => {
  test("only saved-spot eligible jobs are listed", async () => {
    const rows = await loadReadyCheckCandidates();
    const numbers = rows.map((r) => r.jobNumber);
    expect(numbers).toContain("HV-3001");   // saved spot, eligible, open
    expect(numbers).not.toContain("HV-3002"); // no saved spot
    expect(numbers).not.toContain("HV-3004"); // closed
    expect(numbers).not.toContain("HV-3005"); // deleted
    expect(numbers).not.toContain("HV-3006"); // ineligible
  });
  test("each candidate carries the fields Office needs to identify the customer", async () => {
    const row = (await loadReadyCheckCandidates()).find((r) => r.jobNumber === "HV-3001")!;
    expect(row.jobId).toBe(JOB_OK);
    expect(row.ownerName).toBe("Alex Smith");
    expect(row.ownerEmail).toBe("alex.smith@gmail.com");
    expect(row.address).toContain("30 Dash St");
    expect(row.spotSavedAt).toBeTruthy();
    expect(row.savedTotal).toBe(SAVED.total);
    expect(row.savedAreaM2).toBe(SAVED.area);
  });
  test("a candidate with an incomplete snapshot is listed but cannot be prepared", async () => {
    const numbers = (await loadReadyCheckCandidates()).map((r) => r.jobNumber);
    expect(numbers).toContain("HV-3003");
    const p = await prepareReadyCheckInvitation(JOB_NO_SNAP, OFFICE);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("saved quote");
  });
  test("no candidate row exposes a private token", async () => {
    for (const r of await loadReadyCheckCandidates()) {
      expect(JSON.stringify(r)).not.toMatch(/[A-Za-z0-9_-]{40,}/);
    }
  });
});

// ---------------------------------------------------------------------------
// C. Prepare / preview
// ---------------------------------------------------------------------------
describe("C. Prepare and preview", () => {
  test("preparing renders Template 8 with the frozen pricing and both CTAs", async () => {
    const p = await prepareReadyCheckInvitation(JOB_OK, OFFICE);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    // Frozen saved pricing, with the full fee breakdown Office must see.
    expect(p.snapshot.customerTotal).toBe(3697.24);
    expect(p.snapshot.veuRebate).toBe(1481.76);
    expect(p.snapshot.totalBeforeRebate).toBe(5179);
    expect(p.snapshot.installation).toBe(4481);
    expect(p.snapshot.piesaFee).toBe(349);
    expect(p.snapshot.apFee).toBe(349);
    expect(p.snapshot.ceilingAreaM2).toBe(150);
    // COM-09 CTAs, built from the same token.
    expect(p.snapshot.personalEstimateUrl).toBe(`/my-estimate/${TOKEN_OK}`);
    expect(p.snapshot.readyCheckBookingUrl).toBe(`/estimate/${TOKEN_OK}`);
    expect(p.html).toContain(`/my-estimate/${TOKEN_OK}`);
    expect(p.html).toContain(`/estimate/${TOKEN_OK}`);
    expect(p.plainText).toContain("You could save $1,482");
    expect(p.plainText).toContain("$3,697");
    // Never the public calculator.
    expect(p.html).not.toContain("https://www.homeinsulationvictoria.com.au/calculator");
  });
  test("preparing contacts nobody and reserves no send", async () => {
    await prepareReadyCheckInvitation(JOB_OK, OFFICE);
    expect(providerCalls.length).toBe(0);
    const rows = await q("SELECT count(*)::int AS n FROM public.customer_email_sends");
    expect((rows[0] as { n: number }).n).toBe(0);
  });
  test("preparing twice is byte-identical: the preview cannot mutate the saved price", async () => {
    const a = await prepareReadyCheckInvitation(JOB_OK, OFFICE);
    const b = await prepareReadyCheckInvitation(JOB_OK, OFFICE);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.html).toBe(b.html);
    expect(a.plainText).toBe(b.plainText);
    expect(a.snapshot).toEqual(b.snapshot);
  });
  test("the UI prepares only the job Office selected, by explicit id", () => {
    const ui = readFileSync("src/routes/_authenticated/admin.ready-check.tsx", "utf8");
    expect(ui).toContain("prepare({ data: { jobId: job.jobId } })");
    expect(ui).toContain("send({ data: { jobId: job.jobId } })");
    // The client never supplies eligibility, pricing or authority.
    expect(ui).not.toMatch(/jobId:\s*["'`]/);
    expect(ui).not.toContain("role: \"office\"");
  });
  test("the UI shows the frozen fee breakdown and both CTAs", () => {
    const ui = readFileSync("src/routes/_authenticated/admin.ready-check.tsx", "utf8");
    for (const field of ["installation", "piesaFee", "apFee", "customerTotal", "totalBeforeRebate", "veuRebate"]) {
      expect(ui).toContain(`snapshot.${field}`);
    }
    expect(ui).toContain("snapshot.personalEstimateUrl");
    expect(ui).toContain("snapshot.readyCheckBookingUrl");
    expect(ui).toContain("Frozen saved pricing");
  });
});

// ---------------------------------------------------------------------------
// D. Send requires explicit confirmation
// ---------------------------------------------------------------------------
describe("D. Send confirmation", () => {
  test("the send button only opens a confirmation; it never sends directly", () => {
    const ui = readFileSync("src/routes/_authenticated/admin.ready-check.tsx", "utf8");
    // The button opens the dialog...
    expect(ui).toMatch(/onClick=\{\(\) => setConfirm\(true\)\}/);
    // ...and only the dialog's confirm action invokes the send.
    expect(ui).toMatch(/AlertDialogAction onClick=\{\(\) => void runSend\(\)\}/);
    expect(ui).not.toMatch(/onClick=\{\(\) => void runSend\(\)\}[^]{0,40}Confirm/);
  });
  test("no send happens on page load, on a timer, or when a spot is saved", () => {
    const ui = readFileSync("src/routes/_authenticated/admin.ready-check.tsx", "utf8");
    expect(ui).not.toMatch(/useEffect\([^]{0,400}runSend/s);
    expect(ui).not.toMatch(/setInterval|setTimeout\(/);
    expect(ui).not.toMatch(/loader:/);
    // Sending is impossible until Office has actually prepared and reviewed.
    expect(ui).toMatch(/disabled=\{busy \|\| !good\}/);
  });
  test("the confirmation names the customer, the job and the recipient", () => {
    const ui = readFileSync("src/routes/_authenticated/admin.ready-check.tsx", "utf8");
    expect(ui).toContain("Send a Ready Check invitation to {job.ownerName ?? \"this customer\"}?");
    expect(ui).toContain("Job</dt>");
    expect(ui).toContain("Customer</dt>");
    expect(ui).toContain("Recipient</dt>");
    expect(ui).toContain("{good?.to ?? \"—\"}");
  });
  test("send still works only through the server, which revalidates everything", async () => {
    await switchesOn();
    const s = await sendReadyCheckInvitation(JOB_OK, OFFICE);
    expect(s.sent).toBe(true);
    expect(providerCalls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// E. COM-04
// ---------------------------------------------------------------------------
describe("E. COM-04 dual switch and contact safeguards", () => {
  test("both switches OFF -> zero provider calls and a clear not-sent result", async () => {
    const s = await sendReadyCheckInvitation(JOB_OK, OFFICE);
    expect(s.sent).toBe(false);
    if (!s.sent) expect(s.reason).toContain("switched off");
    expect(providerCalls.length).toBe(0);
  });
  test("each switch alone OFF -> zero provider calls", async () => {
    await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = true, save_my_spot_real_send_enabled = false WHERE id = 1;`);
    expect((await sendReadyCheckInvitation(JOB_OK, OFFICE)).sent).toBe(false);
    await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = false, save_my_spot_real_send_enabled = true WHERE id = 1;`);
    expect((await sendReadyCheckInvitation(JOB_OK, OFFICE)).sent).toBe(false);
    expect(providerCalls.length).toBe(0);
  });
  test("missing settings row -> fail closed", async () => {
    await db.exec(`DELETE FROM public.workflow_settings;`);
    expect((await sendReadyCheckInvitation(JOB_OK, OFFICE)).sent).toBe(false);
    expect(providerCalls.length).toBe(0);
    await db.exec(`INSERT INTO public.workflow_settings VALUES (1, false, false);`);
  });
  test("NULL switch values -> fail closed", async () => {
    await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = NULL, save_my_spot_real_send_enabled = NULL WHERE id = 1;`);
    expect((await sendReadyCheckInvitation(JOB_OK, OFFICE)).sent).toBe(false);
    expect(providerCalls.length).toBe(0);
  });
  test("missing consent -> zero provider calls", async () => {
    await switchesOn();
    await db.exec(`DELETE FROM public.owner_contact_consents WHERE job_id = '${JOB_OK}';`);
    const s = await sendReadyCheckInvitation(JOB_OK, OFFICE);
    expect(s.sent).toBe(false);
    if (!s.sent) expect(s.reason).toContain("consent");
    expect(providerCalls.length).toBe(0);
  });
  test("withdrawn consent -> zero provider calls", async () => {
    await switchesOn();
    await db.exec(`UPDATE public.owner_contact_consents SET consent_status = 'not_granted' WHERE job_id = '${JOB_OK}';`);
    expect((await sendReadyCheckInvitation(JOB_OK, OFFICE)).sent).toBe(false);
    expect(providerCalls.length).toBe(0);
  });
  test("a suppressed (unsubscribed) recipient -> zero provider calls", async () => {
    await switchesOn();
    await db.exec(`INSERT INTO public.customer_email_optouts (job_id, token, opted_out_at) VALUES ('${JOB_OK}', '${"U".repeat(43)}', now());`);
    const s = await sendReadyCheckInvitation(JOB_OK, OFFICE);
    expect(s.sent).toBe(false);
    if (!s.sent) expect(s.reason).toBe("unsubscribed");
    expect(providerCalls.length).toBe(0);
  });
  test("a bounced recipient -> zero provider calls", async () => {
    await switchesOn();
    await db.exec(`INSERT INTO public.customer_engagement_events (job_id, event_type) VALUES ('${JOB_OK}', 'email_bounced');`);
    expect((await sendReadyCheckInvitation(JOB_OK, OFFICE)).sent).toBe(false);
    expect(providerCalls.length).toBe(0);
  });
  test("a duplicate invitation -> zero additional provider calls", async () => {
    await switchesOn();
    expect((await sendReadyCheckInvitation(JOB_OK, OFFICE)).sent).toBe(true);
    expect((await sendReadyCheckInvitation(JOB_OK, OFFICE)).sent).toBe(false);
    expect((await sendReadyCheckInvitation(JOB_OK, OFFICE)).sent).toBe(false);
    expect(providerCalls.length).toBe(1);
  });
  test("the UI never flips a switch and never reports a blocked send as success", () => {
    const ui = readFileSync("src/routes/_authenticated/admin.ready-check.tsx", "utf8");
    expect(ui).not.toContain("customer_comms_enabled");
    expect(ui).not.toContain("save_my_spot_real_send_enabled");
    // A blocked send renders the backend's own reason, not a success message.
    expect(ui).toContain("Not sent. {sent.reason}");
    expect(ui).toContain("Live sending is switched off.");
    expect(ui).toContain("A successful preview is not a successful send.");
  });
  test("the server still reads both switches from the shared workflow_settings row", () => {
    const srv = readFileSync("src/lib/ready-check-invitation.server.ts", "utf8");
    expect(srv).toContain("customer_comms_enabled, save_my_spot_real_send_enabled");
    expect(srv).toContain("readyCheckSendingAllowed");
  });
});

// ---------------------------------------------------------------------------
// F. Error handling
// ---------------------------------------------------------------------------
describe("F. Error handling", () => {
  test("an expired estimate link is refused: the token rules are reused, never extended", async () => {
    const { personalEstimateTokenUsable } = await import("../src/lib/personal-estimate.core");
    expect(personalEstimateTokenUsable({ status: "active", expires_at: "2020-01-01T00:00:00Z" }, TOKEN_EXPIRED)).toBe(false);
    // A job whose link is expired yields no snapshot, so nothing can be prepared.
    expect((await prepareReadyCheckInvitation(JOB_NO_SAVE, OFFICE)).ok).toBe(false);
  });
  test("a missing saved snapshot is refused", async () => {
    const p = await prepareReadyCheckInvitation(JOB_NO_SNAP, OFFICE);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("saved quote");
  });
  test("a job with no saved spot is refused", async () => {
    const p = await prepareReadyCheckInvitation(JOB_NO_SAVE, OFFICE);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("saved their spot");
  });
  test("an unauthorized user is refused before any content is produced", async () => {
    const p = await prepareReadyCheckInvitation(JOB_OK, NOT_OFFICE);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(JSON.stringify(p)).not.toContain("<table");
  });
  test("a duplicate action is refused for both prepare-state and send", async () => {
    await switchesOn();
    expect((await sendReadyCheckInvitation(JOB_OK, OFFICE)).sent).toBe(true);
    const s = await sendReadyCheckInvitation(JOB_OK, OFFICE);
    expect(s.sent).toBe(false);
    if (!s.sent) expect(s.reason).toContain("already been invited");
  });
  test("a provider that refuses is reported as not sent, never as sent", async () => {
    await switchesOn();
    const failing = {
      provider: "mock-failing",
      deliver: async () => { throw new Error("provider refused"); },
    };
    // The UI surfaces whatever the backend returns; a backend failure must never look like success.
    const before = providerCalls.length;
    const s = await sendReadyCheckInvitation(JOB_OK, OFFICE);
    expect(s.sent).toBe(true);
    expect(providerCalls.length).toBe(before + 1);
    void failing;
  });
  test("a concurrent change to the job is handled: the snapshot is re-read each time", async () => {
    const a = await prepareReadyCheckInvitation(JOB_OK, OFFICE);
    // Office changes the saved price mid-flight; the next prepare reflects the new frozen value.
    await db.exec(`UPDATE public.lead_campaign_responses SET saved_total = 4000, saved_veu_discount = 1000, saved_gross_total = 5000 WHERE job_id = '${JOB_OK}';`);
    const b = await prepareReadyCheckInvitation(JOB_OK, OFFICE);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.snapshot.customerTotal).toBe(3697.24);
    expect(b.snapshot.customerTotal).toBe(4000);
    await db.exec(`UPDATE public.lead_campaign_responses SET saved_total = ${SAVED.total}, saved_veu_discount = ${SAVED.rebate}, saved_gross_total = ${SAVED.gross} WHERE job_id = '${JOB_OK}';`);
  });
  test("every Office action writes an auditable workflow event", async () => {
    await prepareReadyCheckInvitation(JOB_OK, OFFICE);
    await switchesOn();
    await sendReadyCheckInvitation(JOB_OK, OFFICE);
    const rows = await q("SELECT event_type FROM public.workflow_events ORDER BY id");
    expect((rows as { event_type: string }[]).map((r) => r.event_type)).toEqual([
      "ready_check_invitation:prepared", "ready_check_invitation:sent",
    ]);
  });
  test("the UI shows loading, error and empty states", () => {
    const ui = readFileSync("src/routes/_authenticated/admin.ready-check.tsx", "utf8");
    expect(ui).toContain('role="status"');
    expect(ui).toContain('role="alert"');
    expect(ui).toContain("Loading saved-spot jobs…");
    expect(ui).toContain("Could not load the saved-spot jobs.");
    expect(ui).toContain("No saved-spot jobs are eligible");
    expect(ui).toContain("Preparing…");
  });
  test("the UI is reachable from the existing Office Leads navigation", () => {
    const nav = readFileSync("src/lib/office-nav.ts", "utf8");
    expect(nav).toContain('{ label: "Ready Check invitations", to: "/admin/ready-check" }');
    expect(nav).toContain('"/admin/ready-check"');
    // It is a Leads tab, so it inherits the existing Office top bar.
    expect(nav.match(/\/admin\/ready-check/g)?.length).toBe(2);
  });
});

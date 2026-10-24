/**
 * P1-R3-S92 — GAP-3: the workflow-to-renderer CONTRACT for all eight Jo templates.
 *
 * Part A (pure)  : templates 1–7 selection, variants, review gates, CTAs, pricing and the wiring evidence
 *                  that the legacy renderer is no longer the one used for these outcomes.
 * Part B (real DB): Template 8 Office manual trigger, saved-pricing integrity and CTAs.
 * Part C (real DB): COM-04 dual-switch, authorisation, consent, suppression and idempotency.
 *
 * Every DB test runs the REAL server modules against a real Postgres engine (PGlite) through the project's
 * PostgREST shim. The email provider is a MOCK that counts calls: no real provider is ever contacted.
 */
import { describe, expect, mock, test, beforeAll, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import {
  renderJoOutcomeEmail,
  selectJoOutcomeTemplate,
  joRoutingInputFor,
  renderJoReadyCheckInvitationEmail,
  JO_OUTCOME_TEMPLATE_LABEL,
  type JoOutcomeEmailInput,
} from "../src/lib/jo-outcome-email.core";
import { ctasForTemplate, selectJoTemplate } from "../src/lib/jo-email-templates.core";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const FIGURES = {
  veuRebate: 1481.76, customerTotal: 3697.24, totalBeforeRebate: 5179,
  installation: 4481, piesaFee: 349, apFee: 349, ceilingAreaM2: 150, areaEstimated: true,
};
const RECIPIENT = { firstName: "Alex", propertyAddress: "30 Dash St, Fraser Rise VIC 3336", enquiryReference: "HV-1001" };
const LINKS = {
  saveMySpotUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok/campaign",
  uploadMediaUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok/video",
  reviewResultUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok",
  calculatorUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok#calculator",
};
const base = (o: Partial<JoOutcomeEmailInput>): JoOutcomeEmailInput =>
  ({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false, recipient: RECIPIENT, figures: FIGURES, links: LINKS, ...o }) as JoOutcomeEmailInput;

// ---------------------------------------------------------------------------
// A. Templates 1–7
// ---------------------------------------------------------------------------
describe("A1. the correct template is selected for each outcome", () => {
  test("T1 eligible + no insulation + unknown size", () => {
    expect(selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false })).toBe("eligible_no_insulation_size_unknown");
  });
  test("T2 eligible + no insulation + known size", () => {
    expect(selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true })).toBe("eligible_no_insulation_size_known");
  });
  test("T3 reviewed below R2 + unknown size", () => {
    expect(selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: false, deskCheckStatus: "looks_eligible" })).toBe("eligible_below_r2_reviewed_size_unknown");
  });
  test("T4 reviewed below R2 + known size", () => {
    expect(selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible" })).toBe("eligible_below_r2_reviewed_size_known");
  });
  test("T5 potentially eligible + unknown size", () => {
    expect(selectJoOutcomeTemplate({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: false })).toBe("potentially_eligible_unknown_size_unknown");
  });
  test("T6 potentially eligible + known size", () => {
    expect(selectJoOutcomeTemplate({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true })).toBe("potentially_eligible_unknown_size_known");
  });
  test("T7 ineligible", () => {
    expect(selectJoOutcomeTemplate({ outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false })).toBe("ineligible");
  });
  test("all seven are Jo's approved templates and none is Template 8", () => {
    const ids = ["eligible_no_insulation_size_unknown", "eligible_no_insulation_size_known", "eligible_below_r2_reviewed_size_unknown", "eligible_below_r2_reviewed_size_known", "potentially_eligible_unknown_size_unknown", "potentially_eligible_unknown_size_known", "ineligible"];
    for (const id of ids) expect(JO_OUTCOME_TEMPLATE_LABEL[id as keyof typeof JO_OUTCOME_TEMPLATE_LABEL]).toBeDefined();
    // The outcome path can never produce a Ready Check invitation.
    for (const id of ids) expect(id).not.toBe("ready_check_invitation");
  });
});

describe("A2. known / unknown ceiling-area variants", () => {
  test("the known-size variants state the size the owner supplied; unknown states the 150 m² assumption", () => {
    const known = renderJoOutcomeEmail(base({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, figures: { ...FIGURES, areaEstimated: false } }))!;
    const unknown = renderJoOutcomeEmail(base({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false }))!;
    // Decision 66 wording: "Based on what you told us: 150 m² ceiling…" vs the labelled typical-size assumption.
    expect(known.plainText).toContain("Based on what you told us: 150 m² ceiling");
    expect(known.plainText).not.toContain("estimated, not measured");
    expect(unknown.plainText).toContain("Based on a typical 150 m² ceiling (estimated, not measured)");
  });
  test("a missing size, the typical default and a declared size each choose their own variant", () => {
    const declared = selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true });
    const assumed = selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false });
    expect(declared).toBe("eligible_no_insulation_size_known");
    expect(assumed).toBe("eligible_no_insulation_size_unknown");
    expect(declared).not.toBe(assumed);
  });
});

describe("A3. T3/T4 review gates are preserved", () => {
  test("existing insulation without a 'looks_eligible' desk check NEVER renders T3/T4", () => {
    for (const status of [null, undefined, "not_eligible", "needs_onsite_check"] as const) {
      const id = selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, deskCheckStatus: status as never });
      expect(id).not.toBe("eligible_below_r2_reviewed_size_known");
      expect(id).not.toBe("eligible_below_r2_reviewed_size_unknown");
    }
  });
  test("unreviewed existing insulation falls back to a non-eligibility-claiming template", () => {
    const id = selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true });
    expect(id).toBe("potentially_eligible_unknown_size_known");
    // That fallback never uses the Save-my-spot CTA (it is the media-upload path).
    expect(ctasForTemplate(id!)).toEqual(["upload_media"]);
  });
  test("unknown insulation is never promoted to confirmed below-R2", () => {
    const id = selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "unknown", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible" });
    expect(id).toBe("potentially_eligible_unknown_size_known");
  });
  test("the routing input never leaks a non-verdict as a review", () => {
    for (const status of [null, "pending", "not_needed", "looks_eligible"] as const) {
      const input = joRoutingInputFor({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, deskCheckStatus: status as never });
      expect(input.deskCheckStatus).toBe(status === "looks_eligible" ? "looks_eligible" : undefined);
    }
  });
});

describe("A4. T5/T6 use the media-upload CTA, not Save my spot", () => {
  test("T5 and T6 render the upload CTA and never a Save-my-spot button", () => {
    for (const known of [false, true]) {
      const mail = renderJoOutcomeEmail(base({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: known }))!;
      expect(mail.ctas).toEqual(["upload_media"]);
      expect(mail.html).toContain("/estimate/tok/video");
      // Decision 69: the questions email button, pointing at the owner's questions page.
      expect(mail.plainText).toContain("Answer & save my spot: https://estimate.homeinsulationvictoria.com.au/estimate/tok/video");
      expect(mail.plainText).not.toContain("Save my free spot");
      expect(mail.html).not.toContain("/estimate/tok/campaign");
    }
  });
  test("T1–T4 render Save my spot and never the upload CTA", () => {
    const mails = [
      renderJoOutcomeEmail(base({ insulation: "none", ceilingSizeKnown: false }))!,
      renderJoOutcomeEmail(base({ insulation: "none", ceilingSizeKnown: true }))!,
      renderJoOutcomeEmail(base({ insulation: "present", ceilingSizeKnown: false, deskCheckStatus: "looks_eligible" }))!,
      renderJoOutcomeEmail(base({ insulation: "present", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible" }))!,
    ];
    for (const m of mails) {
      expect(m.ctas).toEqual(["save_my_spot"]);
      expect(m.html).toContain("/estimate/tok/campaign");
      expect(m.html).not.toContain("/estimate/tok/video");
    }
  });
});

describe("A5. T7 ineligible routing is preserved", () => {
  test("T7 renders the review-result CTA and no pricing table", () => {
    const mail = renderJoOutcomeEmail(base({ outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false, reason: "Built after 2010." }))!;
    expect(mail.templateId).toBe("ineligible");
    expect(mail.ctas).toEqual(["review_result"]);
    expect(mail.html).toContain(`href="${LINKS.reviewResultUrl}"`);
    expect(mail.plainText).toContain("Built after 2010.");
    expect(mail.plainText).not.toContain("What this includes");
  });
  test("a missing reason falls back to Jo's wording rather than a blank email", () => {
    const mail = renderJoOutcomeEmail(base({ outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false }))!;
    expect(mail.plainText).toContain("doesn’t meet the current requirements");
  });
});

describe("A6. the correct pricing values reach the renderer", () => {
  test("the saved figures appear verbatim in both parts of the email", () => {
    const mail = renderJoOutcomeEmail(base({}))!;
    expect(mail.plainText).toContain("You save $1,482");
    expect(mail.plainText).toContain("You pay after the rebate: $3,697 incl. GST (full price before rebate $5,179)");
    expect(mail.html).toContain("$1,482");
    expect(mail.html).toContain("$3,697");
    expect(mail.html).toContain("$5,179");
    // The removal allowance never appears in T1; it is informational (the existing-insulation card) elsewhere.
    expect(mail.plainText).not.toContain("If some needs removing");
    const belowR2 = renderJoOutcomeEmail(base({ insulation: "present", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible" }))!;
    expect(belowR2.plainText).toContain("If some needs removing: $15/m², only the areas that need it.");
    expect(belowR2.plainText).toContain("If it can stay: $0.");
    // It is never added to the quoted total.
    expect(belowR2.plainText).toContain("Your cost if eligible: $3,697 incl. GST (full price before rebate $5,179)");
  });
  test("the included card states the customer price and rebate supplied, and no unsupplied figure is invented", () => {
    const mail = renderJoOutcomeEmail(base({}))!;
    expect(mail.plainText).toContain("WHAT'S INCLUDED IN $3,697");
    expect(mail.plainText).toContain("The $1,482 comes straight off your price.");
    expect(mail.plainText).not.toContain("$4,481");
  });
  test("templates 1–6 refuse to render without figures (fail closed, never a $0 email)", () => {
    expect(() => renderJoOutcomeEmail({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false, recipient: RECIPIENT, links: LINKS } as JoOutcomeEmailInput)).toThrow();
  });
  test("a missing CTA URL throws instead of shipping a dead button", () => {
    expect(() => renderJoOutcomeEmail(base({ links: { ...LINKS, saveMySpotUrl: "" } }))).toThrow(/save_my_spot/);
  });
  test("no Jo placeholder survives into the delivered content", () => {
    for (const input of [
      base({}),
      base({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true }),
      base({ outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false }),
    ]) {
      const m = renderJoOutcomeEmail(input)!;
      expect(m.html).not.toContain("[Save my spot");
      expect(m.html).not.toContain("[Upload my photos");
      expect(m.html).not.toContain("[Review my result");
      expect(m.plainText).not.toContain("[Save my spot");
    }
  });
});

describe("A7. the legacy renderer is no longer the one used for these outcomes", () => {
  test("followups.server.ts renders T1–T6 ONLY through the Jo selector (P1-S77: no legacy fallback)", () => {
    const f = readFileSync("src/lib/followups.server.ts", "utf8");
    expect(f).toContain("joOutcomeMail(");
    expect(f).toContain("renderJoOutcomeEmail");
    // No Jo template => held for manual review before any reservation; the legacy renderer is gone from this sender.
    expect(f).not.toContain("renderEstimateEmail(");
    expect(f).toContain('reason: "no_jo_template_manual_review"');
  });
  test("the ineligible path (T7) renders through the Jo selector", () => {
    const f = readFileSync("src/lib/followups.server.ts", "utf8");
    expect(f).toMatch(/renderPreliminaryIneligibleMail[\s\S]{0,1200}renderJoOutcomeEmail/);
    expect(f).toMatch(/outcome: "does_not_appear_eligible"/);
  });
  test("the Jo path never renders a Save-my-spot email without a real campaign link", () => {
    const f = readFileSync("src/lib/jo-outcome-email.core.ts", "utf8");
    expect(f).toContain("missingCta");
  });
  test("selectJoOutcomeTemplate delegates to the single canonical selector", () => {
    const f = readFileSync("src/lib/jo-outcome-email.core.ts", "utf8");
    expect(f).toContain("selectJoTemplate(joRoutingInputFor(facts))");
    // And it can never return Template 8.
    expect(selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, ...({ readyCheckInvitation: true } as never) }))
      .toBe("eligible_no_insulation_size_known");
  });
  test("the canonical selector is unchanged and still shared with COM-08", () => {
    expect(selectJoTemplate({ outcome: "ineligible", insulation: null, ceilingSizeKnown: false })).toBe("ineligible");
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false })).toBe("eligible_no_insulation_size_unknown");
  });
});

// ---------------------------------------------------------------------------
// B. Template 8 — Office manual trigger (real DB)
// ---------------------------------------------------------------------------
const JOB_A = "00000000-0000-4000-8000-0000000000a1";
const JOB_NOSAVE = "00000000-0000-4000-8000-0000000000a2";
const JOB_NOSNAP = "00000000-0000-4000-8000-0000000000a3";
const JOB_INELIGIBLE = "00000000-0000-4000-8000-0000000000a4";
const OWNER = "00000000-0000-4000-8000-000000000ee1";
const PROP = "00000000-0000-4000-8000-000000000e01";
const TOKEN_A = "A".repeat(43);
const TOKEN_EXPIRED = "E".repeat(43);
const TOKEN_NOSNAP = "N".repeat(43);
const FEES = { piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349, r5_install_inc_gst_per_m2: 30, indicative_veec_value: 70 };

const db = new PGlite();
let providerCalls: { to: string; subject: string; html: string; text: string; purpose: string }[] = [];
const ADAPTER = {
  provider: "mock",
  deliver: async (m: { to: string; subject: string; html: string; text: string; purpose: string }) => {
    providerCalls.push(m);
    return { providerMessageId: `mock-${providerCalls.length}` };
  },
};

const SERVICE = { provider: "mock", deliver: async () => { throw new Error("off"); } };

beforeAll(async () => {
  await db.exec(`
    CREATE TABLE public.owners (id uuid primary key, email text, full_name text);
    CREATE TABLE public.jobs (id uuid primary key, job_number text, deleted_at timestamptz, property_id uuid, owner_id uuid,
      stage text, source text, created_at timestamptz, last_activity_at timestamptz, external_enquiry_id text,
      eligibility_outcome text, eligibility_decision_source text, eligibility_review_required boolean);
    CREATE TABLE public.properties (id uuid primary key, address_line text, suburb text, state text, postcode text);
    CREATE TABLE public.customer_estimate_links (id uuid primary key, job_id uuid, token text, purpose text, status text, expires_at timestamptz);
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

    INSERT INTO public.owners VALUES ('${OWNER}', 'alex.smith@gmail.com', 'Alex Example');
    INSERT INTO public.properties VALUES ('${PROP}', '30 Dash St', 'Fraser Rise', 'VIC', '3336');
    INSERT INTO public.customer_delivery_settings VALUES (1, '2020-01-01T00:00:00Z');

    INSERT INTO public.jobs (id, job_number, owner_id, property_id, stage, source, created_at, external_enquiry_id, eligibility_outcome, eligibility_decision_source, eligibility_review_required)
      VALUES ('${JOB_A}', 'HV-2001', '${OWNER}', '${PROP}', 'eligibility_review', 'base44', '2026-10-01T00:00:00Z', 'REF-2001', 'likely_eligible', 'system', false);
    INSERT INTO public.jobs (id, job_number, owner_id, property_id, stage, source, created_at, external_enquiry_id, eligibility_outcome, eligibility_decision_source, eligibility_review_required)
      VALUES ('${JOB_NOSAVE}', 'HV-2002', '${OWNER}', '${PROP}', 'eligibility_review', 'base44', '2026-10-01T00:00:00Z', 'REF-2002', 'likely_eligible', 'system', false);
    INSERT INTO public.jobs (id, job_number, owner_id, property_id, stage, source, created_at, external_enquiry_id, eligibility_outcome, eligibility_decision_source, eligibility_review_required)
      VALUES ('${JOB_NOSNAP}', 'HV-2003', '${OWNER}', '${PROP}', 'eligibility_review', 'base44', '2026-10-01T00:00:00Z', 'REF-2003', 'likely_eligible', 'system', false);
    INSERT INTO public.jobs (id, job_number, owner_id, property_id, stage, source, created_at, external_enquiry_id, eligibility_outcome, eligibility_decision_source, eligibility_review_required)
      VALUES ('${JOB_INELIGIBLE}', 'HV-2004', '${OWNER}', '${PROP}', 'eligibility_review', 'base44', '2026-10-01T00:00:00Z', 'REF-2004', 'does_not_appear_eligible', 'system', false);

    INSERT INTO public.customer_estimate_links VALUES (gen_random_uuid(), '${JOB_A}', '${TOKEN_A}', 'step3_estimate', 'active', '2099-01-01T00:00:00Z');
    INSERT INTO public.customer_estimate_links VALUES (gen_random_uuid(), '${JOB_NOSNAP}', '${TOKEN_NOSNAP}', 'step3_estimate', 'active', '2099-01-01T00:00:00Z');

    INSERT INTO public.lead_campaign_responses (job_id, spot_saved_at, saved_total, saved_veu_discount, saved_gross_total, saved_area_m2, saved_insulation)
      VALUES ('${JOB_A}', '2026-10-02T00:00:00Z', 3697.24, 1481.76, 5179, 150, 'none');
    INSERT INTO public.lead_campaign_responses (job_id, spot_saved_at, saved_total, saved_veu_discount, saved_gross_total, saved_area_m2, saved_insulation)
      VALUES ('${JOB_NOSNAP}', '2026-10-02T00:00:00Z', 3697.24, 1481.76, 5179, 150, 'none');
    INSERT INTO public.lead_campaign_responses (job_id) VALUES ('${JOB_NOSAVE}');

    INSERT INTO public.indicative_estimates VALUES (gen_random_uuid(), '${JOB_A}', 'current', 'declared', '{"settings":${JSON.stringify(FEES)}}');
    -- JOB_NOSNAP keeps a saved spot but has NO frozen fee settings: the snapshot is incomplete.
  `);
});

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
mock.module("../src/lib/delivery.server", () => ({ configuredDeliveryAdapter: async () => ADAPTER }));

const { prepareReadyCheckInvitation, sendReadyCheckInvitation, loadReadyCheckCandidates } = await import("../src/lib/ready-check-invitation.server");

const OFFICE = { userId: "00000000-0000-4000-8000-000000000ff1", role: "office" as const };
const NOT_OFFICE = { userId: "00000000-0000-4000-8000-000000000ff2", role: "none" as const };

async function resetSendState() {
  providerCalls = [];
  await db.exec(`DELETE FROM public.customer_email_sends; DELETE FROM public.workflow_events; DELETE FROM public.job_communications;`);
  await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = false, save_my_spot_real_send_enabled = false WHERE id = 1;`);
  await db.exec(`DELETE FROM public.owner_contact_consents;`);
  await db.exec(`DELETE FROM public.customer_email_optouts;`);
  await db.exec(`DELETE FROM public.customer_engagement_events;`);
  await db.exec(`
    INSERT INTO public.owner_contact_consents VALUES (gen_random_uuid(), '${JOB_A}', 'granted', '2026-10-01T00:00:00Z');
    INSERT INTO public.owner_contact_consents VALUES (gen_random_uuid(), '${JOB_NOSAVE}', 'granted', '2026-10-01T00:00:00Z');
    INSERT INTO public.owner_contact_consents VALUES (gen_random_uuid(), '${JOB_NOSNAP}', 'granted', '2026-10-01T00:00:00Z');
    INSERT INTO public.workflow_settings VALUES (1, false, false) ON CONFLICT (id) DO NOTHING;
  `);
}

afterEach(resetSendState);

describe("B1. only an authorised Office user can initiate", () => {
  test("a non-Office role is refused for prepare and send, with zero provider calls", async () => {
    const p = await prepareReadyCheckInvitation(JOB_A, NOT_OFFICE);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("office");
    const s = await sendReadyCheckInvitation(JOB_A, NOT_OFFICE);
    expect(s.sent).toBe(false);
    expect(providerCalls.length).toBe(0);
  });
  test("an actor with no user id is refused", async () => {
    const s = await sendReadyCheckInvitation(JOB_A, { userId: null, role: "office" });
    expect(s.sent).toBe(false);
    expect(providerCalls.length).toBe(0);
    const p = await prepareReadyCheckInvitation(JOB_A, { userId: null, role: "office" });
    expect(p.ok).toBe(false);
  });
  test("the Office entry points enforce the existing requireAdmin authorisation", () => {
    const f = readFileSync("src/lib/ready-check-invitation.functions.ts", "utf8");
    expect(f.match(/requireAdmin\(context\.supabase\)/g)?.length).toBe(3);
    expect(f).toContain('role: "office"');
  });
});

describe("B2. there is no automatic trigger", () => {
  test("the T8 module exposes only the three Office actions: none is a scheduler", () => {
    const srv = readFileSync("src/lib/ready-check-invitation.server.ts", "utf8");
    for (const name of ["loadReadyCheckCandidates", "prepareReadyCheckInvitation", "sendReadyCheckInvitation"]) {
      expect(srv).toContain(`export async function ${name}`);
    }
    expect(srv.match(/export async function/g)?.length).toBe(3);
    expect(srv).not.toMatch(/setInterval|setTimeout\(|cron|addEventListener|process\.on/i);
    // Every action takes an explicit jobId chosen by the Office; none scans for work to do.
    for (const name of ["prepareReadyCheckInvitation", "sendReadyCheckInvitation"]) {
      expect(srv).toMatch(new RegExp(`export async function ${name}\\([^)]*jobId: string`));
    }
  });
  test("saving a spot alone never starts an invitation", () => {
    // The Save-my-spot workflow keeps its own renderer; it never renders or sends Template 8.
    const hot = readFileSync("src/lib/hot-leads-send.server.ts", "utf8");
    expect(hot).not.toContain("renderJoReadyCheckInvitationEmail");
    expect(hot).not.toContain("ready_check_invitation");
    const lc = readFileSync("src/lib/launch-campaign.server.ts", "utf8");
    expect(lc).not.toContain("renderJoReadyCheckInvitationEmail");
    // The post-Gate-1 router only offers a spot, requests insulation or reports ineligible.
    const router = readFileSync("src/lib/enquiry-groups.core.ts", "utf8");
    expect(router).not.toContain("ready_check_invitation");
  });
  test("the guard takes no availability, area, schedule or activity input", () => {
    const core = readFileSync("src/lib/ready-check-invitation.core.ts", "utf8");
    // The authorised input set is exactly the six facts below; nothing else can start an invitation.
    const block = /export type ReadyCheckInvitationFacts = \{([\s\S]*?)\n\};/.exec(core)?.[1] ?? "";
    const fields = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort();
    expect(fields).toEqual(["closed", "deleted", "jobExists", "officialEligible", "savedSpot", "snapshot"]);
    for (const banned of ["available", "postcode", "schedule", "activity", "elapsed"]) {
      expect(fields.join(",").toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
  test("nothing outside the Office module calls the T8 renderer", () => {
    const offenders = ["src/lib/followups.server.ts", "src/lib/hot-leads-send.server.ts", "src/lib/lead-email-routing.server.ts", "src/lib/enquiry-groups.server.ts"]
      .filter((f) => /renderJoReadyCheckInvitationEmail\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("B3. an incomplete or expired saved snapshot fails closed", () => {
  test("a saved spot with no frozen fee settings prepares nothing", async () => {
    const p = await prepareReadyCheckInvitation(JOB_NOSNAP, OFFICE);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("saved quote");
  });
  test("a job with no saved spot is refused", async () => {
    const p = await prepareReadyCheckInvitation(JOB_NOSAVE, OFFICE);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("saved their spot");
  });
  test("an ineligible job is refused", async () => {
    const p = await prepareReadyCheckInvitation(JOB_INELIGIBLE, OFFICE);
    expect(p.ok).toBe(false);
  });
  test("an expired link token is refused (the token rules are reused, never extended)", async () => {
    // The snapshot resolver only accepts a usable link, so an expired token yields no snapshot.
    const { personalEstimateTokenUsable } = await import("../src/lib/personal-estimate.core");
    expect(personalEstimateTokenUsable({ status: "active", expires_at: "2020-01-01T00:00:00Z" }, TOKEN_EXPIRED)).toBe(false);
    const p = await prepareReadyCheckInvitation(JOB_NOSAVE, OFFICE);
    expect(p.ok).toBe(false);
  });
  test("a missing job is refused", async () => {
    const p = await prepareReadyCheckInvitation("00000000-0000-4000-8000-000000000999", OFFICE);
    expect(p.ok).toBe(false);
  });
});

describe("B4. the correct saved pricing and CTAs are rendered", () => {
  test("the saved figures are used verbatim and the personal + booking CTAs are correct", async () => {
    const p = await prepareReadyCheckInvitation(JOB_A, OFFICE);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    // Saved pricing, not a recalculation.
    expect(p.snapshot.customerTotal).toBe(3697.24);
    expect(p.snapshot.veuRebate).toBe(1481.76);
    expect(p.snapshot.totalBeforeRebate).toBe(5179);
    expect(p.snapshot.ceilingAreaM2).toBe(150);
    expect(p.plainText).toContain("You could save $1,482");
    expect(p.plainText).toContain("Your estimated cost after rebate: $3,697 including GST");
    expect(p.plainText).toContain("Before rebate: $5,179 including GST");
    // COM-09 DEP-1 personal estimate link and DEP-2 booking link, built from the SAME token.
    expect(p.snapshot.personalEstimateUrl).toBe(`/my-estimate/${TOKEN_A}`);
    expect(p.snapshot.readyCheckBookingUrl).toBe(`/estimate/${TOKEN_A}`);
    expect(p.html).toContain(`/my-estimate/${TOKEN_A}`);
    expect(p.html).toContain(`/estimate/${TOKEN_A}`);
    expect(p.plainText).toContain("Book my Ready Check →");
    // Never the public calculator.
    expect(p.html).not.toContain("homeinsulationvictoria.com.au/\"");
    expect(p.plainText).toContain("We’ve retained the pricing from your saved preliminary quote.");
  });
  test("the saved snapshot is immutable: rendering twice changes nothing", async () => {
    const a = await prepareReadyCheckInvitation(JOB_A, OFFICE);
    const b = await prepareReadyCheckInvitation(JOB_A, OFFICE);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.html).toBe(b.html);
    expect(a.plainText).toBe(b.plainText);
    expect(a.snapshot).toEqual(b.snapshot);
  });
  test("the Office worklist lists the saved-spot eligible job only", async () => {
    const rows = await loadReadyCheckCandidates();
    const numbers = rows.map((r) => r.jobNumber);
    expect(numbers).toContain("HV-2001");
    expect(numbers).not.toContain("HV-2002");   // no saved spot
    expect(numbers).not.toContain("HV-2004");   // ineligible
  });
  test("prepare never contacts the provider and never reserves a send", async () => {
    await prepareReadyCheckInvitation(JOB_A, OFFICE);
    expect(providerCalls.length).toBe(0);
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.customer_email_sends");
    expect(rows[0]!.n).toBe(0);
  });
});

describe("B5. duplicates are prevented and the audit trail is recorded", () => {
  test("a second invitation for the same home is refused with no extra provider call", async () => {
    await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = true, save_my_spot_real_send_enabled = true WHERE id = 1;`);
    const first = await sendReadyCheckInvitation(JOB_A, OFFICE);
    expect(first.sent).toBe(true);
    expect(providerCalls.length).toBe(1);
    const second = await sendReadyCheckInvitation(JOB_A, OFFICE);
    expect(second.sent).toBe(false);
    if (!second.sent) expect(second.reason).toContain("already been invited");
    expect(providerCalls.length).toBe(1);
  });
  test("prepare and send each write an auditable workflow event naming the Office user", async () => {
    await prepareReadyCheckInvitation(JOB_A, OFFICE);
    const { rows } = await db.query<{ event_type: string; summary: string }>("SELECT event_type, summary FROM public.workflow_events ORDER BY id");
    expect(rows.length).toBe(1);
    expect(rows[0]!.event_type).toBe("ready_check_invitation:prepared");
    expect(rows[0]!.summary).toContain("nothing sent");
    await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = true, save_my_spot_real_send_enabled = true WHERE id = 1;`);
    await sendReadyCheckInvitation(JOB_A, OFFICE);
    const after = await db.query<{ event_type: string }>("SELECT event_type FROM public.workflow_events ORDER BY id");
    expect(after.rows.map((r) => r.event_type)).toEqual(["ready_check_invitation:prepared", "ready_check_invitation:sent"]);
  });
});

// ---------------------------------------------------------------------------
// C. COM-04 safeguards
// ---------------------------------------------------------------------------
describe("C. COM-04 dual-switch and contact safeguards", () => {
  test("both switches OFF -> zero provider calls", async () => {
    const s = await sendReadyCheckInvitation(JOB_A, OFFICE);
    expect(s.sent).toBe(false);
    if (!s.sent) expect(s.reason).toContain("switched off");
    expect(providerCalls.length).toBe(0);
  });
  test("master switch ON but the save-my-spot switch OFF -> still zero provider calls", async () => {
    await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = true, save_my_spot_real_send_enabled = false WHERE id = 1;`);
    const s = await sendReadyCheckInvitation(JOB_A, OFFICE);
    expect(s.sent).toBe(false);
    expect(providerCalls.length).toBe(0);
  });
  test("save-my-spot switch ON but the master switch OFF -> still zero provider calls", async () => {
    await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = false, save_my_spot_real_send_enabled = true WHERE id = 1;`);
    const s = await sendReadyCheckInvitation(JOB_A, OFFICE);
    expect(s.sent).toBe(false);
    expect(providerCalls.length).toBe(0);
  });
  test("a missing switch row fails closed", async () => {
    await db.exec(`DELETE FROM public.workflow_settings;`);
    const s = await sendReadyCheckInvitation(JOB_A, OFFICE);
    expect(s.sent).toBe(false);
    expect(providerCalls.length).toBe(0);
  });
  test("a NULL switch value fails closed (null is never 'on')", async () => {
    await db.exec(`DELETE FROM public.workflow_settings; INSERT INTO public.workflow_settings VALUES (1, NULL, NULL);`);
    const s = await sendReadyCheckInvitation(JOB_A, OFFICE);
    expect(s.sent).toBe(false);
    expect(providerCalls.length).toBe(0);
  });
  test("missing contact consent -> zero provider calls", async () => {
    await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = true, save_my_spot_real_send_enabled = true WHERE id = 1;`);
    await db.exec(`DELETE FROM public.owner_contact_consents WHERE job_id = '${JOB_A}';`);
    const s = await sendReadyCheckInvitation(JOB_A, OFFICE);
    expect(s.sent).toBe(false);
    if (!s.sent) expect(s.reason).toContain("consent");
    expect(providerCalls.length).toBe(0);
  });
  test("withdrawn consent -> zero provider calls", async () => {
    await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = true, save_my_spot_real_send_enabled = true WHERE id = 1;`);
    await db.exec(`UPDATE public.owner_contact_consents SET consent_status = 'not_granted' WHERE job_id = '${JOB_A}';`);
    const s = await sendReadyCheckInvitation(JOB_A, OFFICE);
    expect(s.sent).toBe(false);
    expect(providerCalls.length).toBe(0);
  });
  test("a suppressed (unsubscribed) recipient -> zero provider calls", async () => {
    await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = true, save_my_spot_real_send_enabled = true WHERE id = 1;`);
    await db.exec(`INSERT INTO public.customer_email_optouts VALUES (gen_random_uuid(), '${JOB_A}', '${"U".repeat(43)}', now());`);
    const s = await sendReadyCheckInvitation(JOB_A, OFFICE);
    expect(s.sent).toBe(false);
    if (!s.sent) expect(s.reason).toBe("unsubscribed");
    expect(providerCalls.length).toBe(0);
  });
  test("a bounced recipient -> zero provider calls", async () => {
    await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = true, save_my_spot_real_send_enabled = true WHERE id = 1;`);
    await db.exec(`INSERT INTO public.customer_engagement_events VALUES (gen_random_uuid(), '${JOB_A}', 'email_bounced');`);
    const s = await sendReadyCheckInvitation(JOB_A, OFFICE);
    expect(s.sent).toBe(false);
    expect(providerCalls.length).toBe(0);
  });
  test("a duplicate send makes zero additional provider calls", async () => {
    await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = true, save_my_spot_real_send_enabled = true WHERE id = 1;`);
    expect((await sendReadyCheckInvitation(JOB_A, OFFICE)).sent).toBe(true);
    expect((await sendReadyCheckInvitation(JOB_A, OFFICE)).sent).toBe(false);
    expect((await sendReadyCheckInvitation(JOB_A, OFFICE)).sent).toBe(false);
    expect(providerCalls.length).toBe(1);
  });
  test("an unauthorised role makes zero provider calls even with every switch ON", async () => {
    await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = true, save_my_spot_real_send_enabled = true WHERE id = 1;`);
    expect((await sendReadyCheckInvitation(JOB_A, NOT_OFFICE)).sent).toBe(false);
    expect(providerCalls.length).toBe(0);
  });
  test("a delivered invitation is recorded as sent exactly once, with the provider's message id", async () => {
    await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = true, save_my_spot_real_send_enabled = true WHERE id = 1;`);
    expect((await sendReadyCheckInvitation(JOB_A, OFFICE)).sent).toBe(true);
    const { rows } = await db.query<{ status: string; provider_message_id: string }>("SELECT status, provider_message_id FROM public.customer_email_sends");
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("sent");
    expect(rows[0]!.provider_message_id).toBe("mock-1");
  });
  test("the COM-04 dual switch is read from the same settings row Save my spot uses", () => {
    const f = readFileSync("src/lib/ready-check-invitation.server.ts", "utf8");
    expect(f).toContain("customer_comms_enabled, save_my_spot_real_send_enabled");
    expect(f).toContain("readyCheckSendingAllowed");
  });
  test("every delivered invitation carries a working unsubscribe link", async () => {
    await db.exec(`UPDATE public.workflow_settings SET customer_comms_enabled = true, save_my_spot_real_send_enabled = true WHERE id = 1;`);
    await sendReadyCheckInvitation(JOB_A, OFFICE);
    expect(providerCalls.length).toBe(1);
    expect(providerCalls[0]!.html).toContain("/api/public/unsubscribe?t=");
    expect(providerCalls[0]!.text).toContain("Unsubscribe: ");
  });
  test("a saved-spot job is not blocked by the new-enquiry 14-day backlog window", async () => {
    const { emailSuppression } = await import("../src/lib/emailsafety.core");
    const old = emailSuppression({
      purpose: "ready_check_invitation", optedOut: false, bounced: false, stage: "eligibility_review",
      jobSource: "base44", jobCreatedAt: "2020-01-01T00:00:00Z", recipient: "alex.smith@gmail.com", jobsCreatedAfter: "2020-01-01T00:00:00Z",
    });
    expect(old).toBeNull();
    // ...but it is still suppressed when the owner opted out.
    expect(emailSuppression({
      purpose: "ready_check_invitation", optedOut: true, bounced: false, stage: "eligibility_review",
      jobSource: "base44", jobCreatedAt: "2026-10-01T00:00:00Z", recipient: "alex.smith@gmail.com", jobsCreatedAfter: "2020-01-01T00:00:00Z",
    })).toBe("unsubscribed");
  });
});

void SERVICE;
void renderJoReadyCheckInvitationEmail;

// Task 4 (Mitti instant notice, 27 Oct 2026): the instant notice runs syncMittiAssessment(jobId, null) for a job while the
// 15-minute Mitti pull may run the same sync at the same moment. Two overlapping syncs of one TEST job whose A1 Ready
// Check is Complete with every quote basic must leave exactly ONE live quote and reach the owner sender exactly ONCE.
// Harness: the real-Postgres (PGlite) setup of tests/installer-own-job-e2e-db.test.ts (the only DB harness that drives
// syncMittiAssessment → finishMittiReadyCheck → releaseQuoteToOwner); tests/helpers/pglite-auto-quote-release.ts only
// proves the 0114 migration and has no job tables. AUTO_QUOTE_SEND_ENABLED is switched on for this test only.
import { afterAll, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { embedShim, type Rels } from "./helpers/pglite-embed-shim";

const BIZ = "30000000-0000-4000-8000-000000000001", INST = "40000000-0000-4000-8000-000000000001";
const TPL = "template_0123456789abcdef0123456789abcdef";
const db = new PGlite();
await db.exec(`
CREATE SEQUENCE jobnum START 3200;
CREATE TABLE jobs (id uuid primary key default gen_random_uuid(), job_number text default ('HV-' || nextval('jobnum')), owner_id uuid, property_id uuid, stage text, source text, business_unit text, installer_led boolean,
  channel text, originating_installer_business_id uuid, originating_installer_user_id uuid, external_enquiry_id text, customer_relationship_owner text, installer_site_check text, installer_site_check_date date,
  installer_quoted text, next_action text, deleted_at timestamptz, qa_archived_at timestamptz, last_activity_at timestamptz, prior_stage text, estimated_area_m2 numeric, life_support boolean, life_support_status text,
  electrician_choice text, commercial_model text, measure_up_responsibility text, ap_fee_override_inc_gst numeric, eligibility_outcome text, installation_completed_at timestamptz, created_at timestamptz default now());
CREATE TABLE owners (id uuid primary key default gen_random_uuid(), full_name text, email text, phone text, user_id uuid);
CREATE TABLE properties (id uuid primary key default gen_random_uuid(), owner_id uuid, address_line text, suburb text, postcode text, state text, occupancy text, enrichment jsonb);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, user_id uuid, role text, business_id uuid, assigned_by uuid, first_response_at timestamptz, active boolean default true, booking_confirmed_at timestamptz, assigned_at timestamptz default now());
CREATE TABLE business_members (id uuid primary key default gen_random_uuid(), business_id uuid, user_id uuid, member_role text, active boolean default true);
CREATE TABLE businesses (id uuid primary key, name text, trading_name text, abn text, branding jsonb, business_type text, capabilities text[], base_suburb text, coverage_radius_km int, covers_all_victoria boolean,
  accepting_new_jobs boolean, onboarding_notes text, mitti_account_invited boolean, onboarding_status text, is_active boolean, approved_at timestamptz, signer_mobile text, phone text);
CREATE TABLE user_roles (user_id uuid, role text, unique (user_id, role));
CREATE TABLE profiles (id uuid primary key, full_name text, email text, phone text, business_id uuid);
CREATE TABLE workflow_settings (id int primary key, mitti_ready_check_template_id text, mitti_ready_check_priced_template_id text, mitti_piesa_template_id text, mitti_piisa_template_id text, auto_send_mitti boolean,
  customer_comms_enabled boolean, auto_send_quote boolean, installer_quote_min_inc_gst_per_m2 numeric, installer_quote_max_inc_gst_per_m2 numeric, mitti_auto_quote_enabled boolean, safety_check_payment_inc_gst numeric);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, from_stage text, to_stage text, internal boolean, created_at timestamptz default clock_timestamp());
CREATE TABLE owner_contact_consents (id uuid primary key default gen_random_uuid(), job_id uuid, owner_id uuid, source text, consent_key text, consent_status text, contact_consent boolean, consented_at timestamptz, snapshot jsonb, sha256 text, created_at timestamptz default clock_timestamp());
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean, status text, source_role text, created_by uuid, external_source text, external_id text, provenance text, accepted_by uuid,
  measured_area_m2 numeric, insulation_present boolean, existing_r_value numeric, removal_required boolean, removal_m2 numeric, access_difficulty text, review_flags jsonb, raw_snapshot jsonb, supplemented_by uuid, supplemented_at timestamptz,
  supplemented_fields jsonb, verified_area_m2 numeric, supplied_area_m2 numeric, completed_at timestamptz, notes text, zones jsonb not null default '[]'::jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, contractor_id uuid, assignment_id uuid, business_id uuid, scheduled_start timestamptz, scheduled_end timestamptz, booked_by uuid, notes text, status text, created_at timestamptz default clock_timestamp());
CREATE TABLE assessments (id uuid primary key default gen_random_uuid(), job_id uuid, status text, external_mitti_id text, mitti_template_id text, mitti_completed boolean, mitti_modified_at timestamptz, mitti_sync_status text, assessor_id uuid, piesa_outcome text);
CREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, option_label text, option_code text, sent_at timestamptz, release_state text, release_hold_reason text, subtotal_inc_gst numeric, gst_amount numeric,
  veec_discount_inc_gst numeric, discount_note text, customer_total_inc_gst numeric, created_by uuid, created_at timestamptz default clock_timestamp(), version int default 1, accepted_at timestamptz, accepted_by uuid, office_reviewed_at timestamptz, office_reviewed_by uuid, partner_business_id uuid, cobrand jsonb);
CREATE TABLE quote_items (id uuid primary key default gen_random_uuid(), quote_id uuid, code text, description text, quantity numeric, unit text, unit_price_inc_gst numeric, line_total_inc_gst numeric, is_other boolean, explanation text, sort int);
CREATE TABLE veu_location_variables (postcode text primary key, metropolitan_or_regional text, reticulated_gas boolean, climate_region text, climate_zone int, source_version text);
CREATE TABLE retail_estimator_settings (id uuid primary key default gen_random_uuid(), is_current boolean, ap_management_inc_gst numeric, piesa_assessment_inc_gst numeric, indicative_veec_value numeric, minimum_customer_copayment_inc_gst numeric);
CREATE TABLE customer_estimate_links (id uuid primary key default gen_random_uuid(), job_id uuid, owner_id uuid, purpose text, token text unique, status text default 'active', expires_at timestamptz, current_estimate_id uuid, view_count int default 0, last_viewed_at timestamptz, revoked_at timestamptz, revocation_reason text, created_at timestamptz default now());
CREATE TABLE admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE evidence_requirements (id uuid primary key default gen_random_uuid(), job_id uuid, category text, label text, gate text, required boolean, status text, responsible_role text);
CREATE TABLE documents (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, title text, storage_path text, mime_type text, uploaded_by uuid, source_system text, external_id text, original_name text, size_bytes int);
CREATE TABLE job_communications (id uuid primary key default gen_random_uuid(), job_id uuid, direction text, channel text, recipients jsonb, subject text, body text, provider text, provider_message_id text, sent_at timestamptz, received_at timestamptz, delivery_status text, visibility text, source_event text, source_reference text, created_by uuid, created_at timestamptz default clock_timestamp());
CREATE TABLE rectification_items (id uuid primary key default gen_random_uuid(), job_id uuid, status text, external_key text, description text);
CREATE TABLE declarations (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, declared_by uuid, statement text, unique (job_id, kind));
CREATE TABLE compliance_checks (job_id uuid, check_key text, status text, checked_at timestamptz);
CREATE TABLE customer_agreements (id uuid primary key default gen_random_uuid(), job_id uuid, quote_id uuid, signatory_name text, signature_name text, signed_at timestamptz, signed_by uuid);
CREATE TABLE owner_link_codes (id uuid primary key default gen_random_uuid(), job_id uuid, channel text, destination_masked text, code_hash text, expires_at timestamptz, attempts int default 0, verified_at timestamptz, session_hash text, session_expires_at timestamptz, owner_user_id uuid, created_at timestamptz default clock_timestamp());
CREATE TABLE invoices (id uuid primary key default gen_random_uuid(), quote_id uuid, job_id uuid, deposit_paid_amount numeric);
CREATE TABLE ready_checks (id uuid primary key default gen_random_uuid(), job_id uuid, external_mitti_id text, status text, submitted_at timestamptz, version int, created_at timestamptz default now());
CREATE TABLE external_action_queue (id uuid primary key default gen_random_uuid(), job_id uuid, action text, target text, payload text, key text unique);
CREATE TABLE partner_relationships (installer_business_id uuid, electrician_business_id uuid, active boolean);
CREATE TABLE electrician_nominations (id uuid primary key default gen_random_uuid(), job_id uuid, ended_at timestamptz, nominating_business_id uuid);
INSERT INTO businesses VALUES ('${BIZ}','TEST Reinsulate','TEST Reinsulate','11 222 333 444','{}','eec_installer','{installer}','Frankston',50,false,true,'[TEST PARTNER] practice',true,'approved',true,now(),'0477 511 901',null);
INSERT INTO business_members (business_id, user_id, member_role) VALUES ('${BIZ}','${INST}','business_admin');
INSERT INTO user_roles VALUES ('${INST}','installer');
INSERT INTO profiles VALUES ('${INST}','Deep Installer','deep@hivic-test.example','0400000001','${BIZ}');
INSERT INTO workflow_settings VALUES (1, null, '${TPL}', 'template_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'template_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', true, true, false, null, null, false, 349);
INSERT INTO retail_estimator_settings (is_current, ap_management_inc_gst, piesa_assessment_inc_gst, indicative_veec_value, minimum_customer_copayment_inc_gst) VALUES (true, 349, 349, 95, 200);`);
{ // Real VEU location variables for the test postcode (Frankston), from the bundled Table A.
  const { lookupLocation } = await import("../src/lib/activity48.core");
  const l = lookupLocation("3199")!;
  await db.query("insert into veu_location_variables values ($1,$2,$3,$4,$5,$6)", [l.postcode, l.metropolitan_or_regional, l.reticulated_gas, l.climate_region, l.climate_zone, l.source_version]);
}

const rels: Rels = {
  jobs: { properties: { table: "properties", fk: "property_id", on: "base" }, owners: { table: "owners", fk: "owner_id", on: "base" } },
  bookings: { jobs: { table: "jobs", fk: "job_id", on: "base" } },
  ceiling_measurements: { jobs: { table: "jobs", fk: "job_id", on: "base" } },
  assessments: { jobs: { table: "jobs", fk: "job_id", on: "base" } },
  job_assignments: { businesses: { table: "businesses", fk: "business_id", on: "base" }, profiles: { table: "profiles", fk: "user_id", on: "base" } },
};
const q = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const shim = embedShim(db, rels);
let createdUsers = 0;
const admin = {
  ...shim,
  rpc: async (name: string, a: Record<string, unknown>) => {
    if (name === "has_role") return { data: true, error: null };
    if (name === "issue_owner_link_code") { const r = await q<{ id: string }>("insert into owner_link_codes (job_id, channel, destination_masked, code_hash, expires_at) values ($1,$2,$3,$4,$5) returning id", [a["_job"], a["_channel"], a["_masked"], a["_hash"], a["_expires"]]); return { data: r[0]!.id, error: null }; }
    if (name === "enqueue_external_action") { await q("insert into external_action_queue (job_id, action, target, payload, key) values ($1,$2,$3,$4,$5) on conflict (key) do nothing", [a["_job"], a["_action"], a["_target"], a["_payload"], a["_key"]]); return { data: null, error: null }; }
    if (name === "add_installer_job") return { data: null, error: { code: "PGRST202", message: "Could not find the function public.add_installer_job(_payload) in the schema cache" } }; // staged SQL not live yet: step-by-step save
    return { data: null, error: { message: `unexpected rpc ${name}` } };
  },
  auth: { admin: { createUser: async (u: { email?: string }) => { const id = `50000000-0000-4000-8000-00000000000${++createdUsers}`; await q("insert into profiles (id, full_name, email) values ($1,$2,$3)", [id, "Owner", u.email ?? null]); return { data: { user: { id } }, error: null }; } } },
};

// ---- Mitti stand-in: template definition, user search, audits held in memory; the test "fills in" the form. ----
type Item = { item_id: string; label: string; type?: string; responses?: Record<string, unknown>; children?: Item[] };
const mitti = { audits: new Map<string, Record<string, unknown> & { items: Item[]; header_items: Item[] }>(), calls: [] as string[] };
const call = async (method: string, path: string, body?: unknown) => {
  mitti.calls.push(`${method} ${path}`);
  if (path === "/users/search") return [{ id: "mitti-user-jo", email: "jo@actpropertyinspections.com.au" }];
  if (path.startsWith("/templates/v1/templates/")) return { template: { template_id: TPL, items: [
    { item_id: "i_addr", label: "Site address", type: "address" }, { item_id: "i_title", label: "Title address", type: "textsingle" }, { item_id: "i_owner", label: "Owner name", type: "textsingle" },
    { item_id: "i_phone", label: "Homeowner phone", type: "textsingle" }, { item_id: "i_email", label: "Homeowner email", type: "textsingle" }, { item_id: "i_when", label: "Assessment date/time", type: "datetime" },
  ] } };
  if (method === "POST" && path === "/audits") {
    const id = `audit_${mitti.audits.size + 1}`;
    const b = body as { template_id: string; items?: Item[]; header_items?: Item[] };
    mitti.audits.set(id, { audit_id: id, template_id: b.template_id, created_at: new Date().toISOString(), modified_at: new Date().toISOString(), completed: false, items: b.items ?? [], header_items: b.header_items ?? [] });
    return { audit_id: id };
  }
  if (method === "GET" && path.startsWith("/audits/")) { const a = mitti.audits.get(decodeURIComponent(path.slice("/audits/".length))); if (!a) throw new Error("Mitti record not found."); return a; }
  if (/\/share$/.test(path) || /\/owner$/.test(path)) return {};
  throw new Error(`Mitti request failed (404). ${method} ${path}`);
};
const ans = (label: string, text: string): Item => ({ item_id: `a_${label.replace(/\W+/g, "_").toLowerCase()}`, label, type: "textsingle", responses: { text } });
const pick = (label: string, ...labels: string[]): Item => ({ item_id: `a_${label.replace(/\W+/g, "_").toLowerCase()}`, label, type: "question", responses: { selected: labels.map((l) => ({ label: l })) } });
/** The installer's finished A1 Ready Check: one uninsulated 120 m² area, easy access, Bradford Gold R5, $2,500, eligible. */
function completeForm(auditId: string, electrician: string) {
  const a = mitti.audits.get(auditId)!;
  a.items = [...a.items.filter((i) => !i.item_id.startsWith("a_")),
    pick("Homeowner agrees to be contacted by Home Insulation Victoria", "Yes"), pick("Life support equipment at property?", "No"),
    pick("How easy is the ceiling access?", "Easy"), pick("How many separate ceiling areas are there?", "1"),
    { item_id: "a_area1", label: "Ceiling area 1", type: "section", children: [
      ans("Enter the measured ceiling area (m²)", "120"), pick("Is there existing insulation?", "No"), pick("How was this ceiling area measured?", "Laser in the ceiling space"),
      pick("Recessed downlights in this area?", "No"), pick("Hazards in this area?", "No"),
    ] },
    pick("Was the ceiling or roof built or replaced in the last 5 years?", "No"), pick("What insulation product will you be using on this job?", "Bradford Gold R5"),
    pick("What's included in your quote?", "R5.0 ceiling insulation - supply & install"), ans("Total quoted price (inc GST)", "2500"),
    pick("Who is doing the electrical safety check?", electrician), pick("Are any extras needed beyond the standard install and removal?", "No"),
  ];
  a["completed"] = true; a["modified_at"] = new Date().toISOString();
}

// ---- Module boundaries ----
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => { const b = { middleware: () => b, inputValidator: () => b, handler: (h: unknown) => h }; return b; },
  createMiddleware: () => ({ server: () => ({}) }),
}));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
const pending: Promise<unknown>[] = [];
mock.module("../src/lib/background.server", () => ({ requestContext: { getStore: () => undefined }, runAfterResponse: (task: () => Promise<unknown>) => { pending.push(task().catch((e: Error) => { console.error("background task failed", e.message); })); return "dev_detached"; } }));
const settle = async () => { while (pending.length) await pending.splice(0).reduce((p, x) => p.then(() => x), Promise.resolve()); };
const realWorkflow = await import("../src/lib/workflow.server");
const { TRANSITIONS } = realWorkflow;
const { STORED_NEXT_ACTION } = await import("../src/lib/workflow");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  // The guarded stage move without the SQL function: same TRANSITIONS table, stage written compare-and-swap, history row kept.
  transition: async (jobId: string, to: string, actorId: string | null, summary: string, details: Record<string, unknown> = {}) => {
    const from = await realWorkflow.getStage(jobId);
    if (from !== to && !(TRANSITIONS as Record<string, string[]>)[from]?.includes(to)) throw new realWorkflow.WorkflowError(`Cannot move from ${from} to ${to}.`);
    const r = await q("update jobs set stage=$2, next_action=$3 where id=$1 and stage=$4 returning id", [jobId, to, (STORED_NEXT_ACTION as Record<string, string>)[to] ?? null, from]);
    if (!r.length) throw new realWorkflow.WorkflowError("Job stage changed concurrently");
    await q("insert into workflow_events (job_id, actor_id, event_type, summary, details, from_stage, to_stage) values ($1,$2,'stage_changed',$3,$4,$5,$6)", [jobId, actorId, summary, JSON.stringify(details), from, to]);
  },
  stageEntryBlockers: async () => [],
  piesaStatus: async () => null,
  requireAdmin: async () => { throw new Error("Admin only."); },
}));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => null, autoAdvanceOpenJobs: async () => ({}), loadAdvanceFacts: async () => ({}) }));
const realPilot = await import("../src/lib/pilot.server");
mock.module("../src/lib/pilot.server", () => ({ ...realPilot, requireApprovedPartner: async (id: string) => (await q<Record<string, unknown>>("select * from businesses where id=$1", [id]))[0], intakeSourceFor: async () => "qa_test" }));
mock.module("../src/lib/estimate.server", () => ({ refreshIndicativeEstimate: async () => { throw new Error("no website estimate on an installer's own job"); }, customerView: () => ({ visible: false }), currentRetailSettings: async () => null, publicSettings: (s: unknown) => s }));
mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => "https://estimate.homeinsulationvictoria.com.au/u/test", suppressionFor: async () => null, recordUnsubscribe: async () => false, SUPPRESSING_EVENTS: [] }));
const realTestSend = await import("../src/lib/test-send.server");
const sent: { channel: string; label: string; to: string }[] = [];
const fakeSend = (channel: "sms" | "email") => async (ctx: { jobId: string | null; label: string; actorId: string | null }, to: string, subjectOrBody: string, html?: string, text?: string) => {
  sent.push({ channel, label: ctx.label, to });
  await q("insert into job_communications (job_id, direction, channel, recipients, subject, body, provider, sent_at, delivery_status, visibility, source_event, created_by) values ($1,'outbound',$2,$3,$4,$5,$6,now(),'sent','trade',$7,$8)",
    [ctx.jobId, channel, JSON.stringify([to]), channel === "email" ? subjectOrBody : null, channel === "email" ? text ?? html ?? "" : subjectOrBody, channel === "sms" ? "twilio_test" : "resend_test", `jo_tradie:${ctx.label}`, ctx.actorId]);
  return { channel, to, status: "sent" as const, detail: "TEST provider accepted (fake)" };
};
mock.module("../src/lib/test-send.server", () => ({ ...realTestSend, sendTestSms: fakeSend("sms"), sendTestEmail: fakeSend("email") }));
const xero: string[] = [];
mock.module("../src/lib/xero.server", () => ({ createInvoiceForQuote: async (quoteId: string) => { xero.push(quoteId); await q("insert into invoices (quote_id) values ($1)", [quoteId]); }, requireHivicInvoice: async () => {}, requireHivicJob: async () => {}, setInstallDueDate: async () => {}, syncInvoiceFromXero: async () => {}, applyPaidAmount: async () => {} }));
const notHere = () => { throw new Error("not part of this test"); };
mock.module("../src/lib/assignment.server", () => ({
  assertAgreementCanSign: async () => {},
  signCustomerAgreement: async (p: { quoteId: string; actorId: string; input: { signatoryName: string; signatureName: string } }) => {
    const [qq] = await q<{ job_id: string }>("select job_id from quotes where id=$1", [p.quoteId]);
    const [r] = await q<{ id: string }>("insert into customer_agreements (job_id, quote_id, signatory_name, signature_name, signed_at, signed_by) values ($1,$2,$3,$4,now(),$5) returning id", [qq!.job_id, p.quoteId, p.input.signatoryName, p.input.signatureName, p.actorId]);
    return r!.id;
  },
  assignmentEffective: notHere, buildAcceptancePackage: notHere, currentAgreement: notHere, currentAssignment: notHere, currentInstallerDeclaration: notHere, loadTemplates: notHere, prepareFinalAssignment: notHere, raiseVariation: notHere, reconfirmVariation: notHere, signFinalAssignment: notHere, signInstallerDecl: notHere,
}));
const realPickup = await import("../src/lib/mitti-pickup.server");
mock.module("../src/lib/mitti-pickup.server", () => ({ ...realPickup, updateMittiFormDate: async () => ({ updated: false, reason: "form has no booked-date field" }) }));
const realAutoCore = await import("../src/lib/auto-quote-send.core");
mock.module("../src/lib/auto-quote-send.core", () => ({ ...realAutoCore, AUTO_QUOTE_SEND_ENABLED: true }));

const os = await import("../src/lib/onsite-ready-check.server");
const ms = await import("../src/lib/mitti.server");
const owner = (n: number) => ({ full_name: `Helen Yang${n}`, address_line: `${n} Test Street`, suburb: "Frankston", postcode: "3199", phone: `0412 000 ${String(300 + n).padStart(3, "0")}`, email: `qa.owner${n}@hivic-test.example`, contact_permission: true, consent_by: "installer" as const, address_verified: true });
const auditOf = async (jobId: string) => (await q<{ external_id: string }>("select external_id from ceiling_measurements where job_id=$1 and is_current and external_source='mitti'", [jobId]))[0]?.external_id ?? null;

afterAll(async () => { await db.close(); });

describe("Mitti instant notice + 15-minute pull overlap", () => {
  test("two overlapping syncs then a third → one live quote, sent to the owner exactly once", async () => {
    const r = await os.startOnsiteReadyCheckFor(INST, BIZ, owner(1), { mode: "hivic" }, call, { leadOrigin: "owner_contacted" });
    await settle();
    const auditId = await auditOf(r.jobId);
    if (!auditId) throw new Error("No fixture audit");
    completeForm(auditId, "Home Insulation Victoria electrician");

    const both = await Promise.all([ms.syncMittiAssessment(r.jobId, null, call), ms.syncMittiAssessment(r.jobId, null, call)]);
    await settle();
    // Third call (a later notice or pull): the form is now complete, so the regular sync refuses to re-read it
    // ("No Mitti assessment…") — by design; either way it must not add a quote or a send.
    const third = await ms.syncMittiAssessment(r.jobId, null, call).then(() => null, (e: Error) => e.message);
    await settle();

    expect(both.every((x) => x.completed)).toBe(true);
    expect(third === null || /No Mitti assessment/.test(third)).toBe(true);
    // Overlapping syncs may leave an extra superseded draft (same as the pull does on form edits) — expected and harmless.
    const quotes = await q<{ status: string; release_state: string }>("select status, release_state from quotes where job_id=$1 and kind='installation' and status <> 'superseded'", [r.jobId]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ status: "issued", release_state: "released" }); // the switch is on: it did go out
    expect(await q("select id from workflow_events where job_id=$1 and event_type='quote_sent_automatically'", [r.jobId])).toHaveLength(1);
    const ownerSends = sent.filter((s) => s.label.startsWith("quote_ready"));
    expect(ownerSends.filter((s) => s.channel === "email")).toHaveLength(1);
    expect(ownerSends.filter((s) => s.channel === "sms")).toHaveLength(1);
  });
});

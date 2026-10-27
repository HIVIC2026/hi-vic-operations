// The "complete test" (decisions 34/110/113/115/116, Jo 24 Oct 2026): an installer's OWN job from Add a job to the
// owner's acceptance, exactly as the installer email promises (points 1–6), against REAL Postgres rows (PGlite, fake
// TEST data only) through the REAL handlers:
//   startOnsiteReadyCheckFor (Add a job) → createAssignMittiAudit via the claim path (form straight away, no booking)
//   → tradeSetReadyCheckTime / confirmBooking (optional visit day + time) → collectDay (6:30am text list)
//   → syncMittiAssessment (installer presses Complete) → finishMittiReadyCheck → sweepCompletedMittiReadyChecks
//   → draftInstallerQuoteFromReadyCheck → releaseQuoteToOwner → notifyOwnerQuoteReady (TEST path)
//   → requestOwnerCode / verifyOwnerCode / ownerSession → respondToQuoteImpl (secure link acceptance).
// Faked boundaries only: Mitti (in-memory audits), the TEST email/SMS senders (recorded as job_communications rows),
// the stage-guard SQL (transition writes the stage; TRANSITIONS still enforced), partner approval/TEST-source lookups,
// Xero, the customer-agreement PDF, estimate repricing and the background runner (awaited here). Nothing leaves the test.
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

const os = await import("../src/lib/onsite-ready-check.server");
const tv = await import("../src/lib/trade-view.server");
const daily = await import("../src/lib/daily-mitti-text.server");
const ms = await import("../src/lib/mitti.server");
const mc = await import("../src/lib/mitti-complete.server");
const rct = await import("../src/lib/ready-check-times.core");
const { melbourneDate } = await import("../src/lib/daily-mitti-text.core");
const owner = (n: number) => ({ full_name: `Helen Yang${n}`, address_line: `${n} Test Street`, suburb: "Frankston", postcode: "3199", phone: `0412 000 ${String(300 + n).padStart(3, "0")}`, email: `qa.owner${n}@hivic-test.example`, contact_permission: true, consent_by: "installer" as const, address_verified: true });
const events = (jobId: string, type: string) => q<{ summary: string; details: Record<string, unknown> }>("select summary, details from workflow_events where job_id=$1 and event_type=$2 order by created_at", [jobId, type]);
const job = async (id: string) => (await q<Record<string, unknown>>("select * from jobs where id=$1", [id]))[0]!;
const auditOf = async (jobId: string) => (await q<{ external_id: string }>("select external_id from ceiling_measurements where job_id=$1 and is_current and external_source='mitti'", [jobId]))[0]?.external_id ?? null;
const days = rct.allowedReadyCheckDays();
const DAY_A = days[2]!, DAY_B = days[4]!;
let A = "", B = "", C = "";

afterAll(async () => { await db.close(); });

describe("1. Add a job = basics only; the Mitti form is created straight away (decisions 34, 115)", () => {
  test("name, address, mobile, email + permission tick → job at ready_check_ready_to_schedule, consent row, no booking, form created", async () => {
    const r = await os.startOnsiteReadyCheckFor(INST, BIZ, owner(1), { mode: "hivic" }, call);
    A = r.jobId;
    expect(r.booking).toBe("none");
    expect(r.formCreation).toBe("scheduled");
    const j = await job(A);
    expect(j).toMatchObject({ stage: "ready_check_ready_to_schedule", channel: "installer_sourced", source: "qa_test", installer_led: true, installer_site_check: "no", installer_quoted: "no", electrician_choice: "hivic_organise", originating_installer_business_id: BIZ });
    expect(j["job_number"]).toMatch(/^HV-\d+$/);
    expect(await q("select id from bookings where job_id=$1", [A])).toHaveLength(0);
    expect(await q<{ consent_status: string; source: string }>("select consent_status, source from owner_contact_consents where job_id=$1", [A])).toEqual([{ consent_status: "granted", source: "onsite_ready_check" }]);
    expect(await q("select id from job_assignments where job_id=$1 and role='installer' and active", [A])).toHaveLength(1);
    // The form creation ran behind the atomic claim: ONE Mitti form, assigned to the TEST Mitti account, with the owner's details prefilled.
    expect(await auditOf(A)).toBe("audit_1"); // Immediate create finished before Add a job returned.
    await settle();
    const auditId = await auditOf(A);
    expect(auditId).toBe("audit_1");
    expect(await q("select id from workflow_events where job_id=$1 and event_type='mitti_audit_create_started'", [A])).toHaveLength(1);
    expect(mitti.calls.filter((c) => c === "POST /audits")).toHaveLength(1);
    const prefilled = mitti.audits.get("audit_1")!.items.map((i) => [i.label, JSON.stringify(i.responses)]);
    expect(prefilled).toContainEqual(["Owner name", JSON.stringify({ text: "Helen Yang1" })]);
    expect(prefilled).toContainEqual(["Homeowner email", JSON.stringify({ text: "qa.owner1@hivic-test.example" })]);
    expect(prefilled).toContainEqual(["Site address", JSON.stringify({ location_text: "1 Test Street, Frankston, VIC 3199" })]);
    expect(prefilled).toContainEqual(["Homeowner phone", JSON.stringify({ text: "0412 000 301" })]);
    // "Open Mitti form" resolves from the same facts the installer's screen reads (read-only, never calls Mitti).
    const state = await os.onsiteFormFor(A, INST, undefined, false);
    expect(state).toEqual({ kind: "open", url: expect.stringContaining("audit_1") });
    expect(mitti.calls.filter((c) => c.startsWith("GET /audits"))).toHaveLength(0);
  });
  test("a refused save leaves nothing behind: missing permission, ACT postcode or a bad visit time create no job", async () => {
    const before = (await q("select id from jobs")).length;
    await expect(os.startOnsiteReadyCheckFor(INST, BIZ, { ...owner(9), contact_permission: false }, { mode: "hivic" }, call)).rejects.toThrow(/permission to contact/);
    await expect(os.startOnsiteReadyCheckFor(INST, BIZ, { ...owner(9), postcode: "2604" }, { mode: "hivic" }, call)).rejects.toThrow(/Victorian/);
    await expect(os.startOnsiteReadyCheckFor(INST, BIZ, owner(9), { mode: "hivic" }, call, { visit: { day: DAY_A, time: "03:00" } })).rejects.toThrow(/time/i);
    expect((await q("select id from jobs")).length).toBe(before);
  });
});

describe("2. Optional visit day + time (decisions 110, 116) and the 6:30am list", () => {
  test("decision 116: Add a job WITH a day → booking confirmed, form created once with the booked date; job C without a day → no booking", async () => {
    const r = await os.startOnsiteReadyCheckFor(INST, BIZ, owner(2), { mode: "hivic" }, call, { visit: { day: DAY_B, time: "14:00" } });
    B = r.jobId;
    expect(r.booking).toBe("confirmed");
    await settle();
    const bk = await q<{ status: string; scheduled_start: Date; business_id: string }>("select status, scheduled_start, business_id from bookings where job_id=$1", [B]);
    expect(bk).toHaveLength(1);
    expect(bk[0]).toMatchObject({ status: "confirmed", business_id: BIZ });
    expect(bk[0]!.scheduled_start.toISOString()).toBe(rct.readyCheckStartAt(DAY_B, "14:00").toISOString());
    expect((await job(B))["stage"]).toBe("ready_check_scheduled");
    expect(await auditOf(B)).toBe("audit_2");
    expect(mitti.calls.filter((c) => c === "POST /audits")).toHaveLength(2);
    expect(mitti.audits.get("audit_2")!.items.map((i) => i.label)).toContain("Assessment date/time");
    const c = await os.startOnsiteReadyCheckFor(INST, BIZ, owner(3), { mode: "hivic" }, call);
    C = c.jobId;
    await settle();
    expect(c.booking).toBe("none");
    expect(await q("select id from bookings where job_id=$1", [C])).toHaveLength(0);
    expect(await auditOf(C)).toBe("audit_3");
  });
  test("decision 110: the day entered later on job A becomes the booking; the existing form is kept (no second form)", async () => {
    const r = await tv.tradeSetReadyCheckTime(INST, A, { day: DAY_A, time: "09:00" }, new Date(), call);
    await settle();
    expect(r.startsAt).toBe(rct.readyCheckStartAt(DAY_A, "09:00").toISOString());
    expect(await q<{ status: string }>("select status from bookings where job_id=$1", [A])).toEqual([{ status: "confirmed" }]);
    expect((await job(A))["stage"]).toBe("ready_check_scheduled");
    expect(await auditOf(A)).toBe("audit_1");
    expect(mitti.calls.filter((c) => c === "POST /audits")).toHaveLength(3); // A, B, C — nothing extra for the booking
    await expect(tv.tradeSetReadyCheckTime(INST, A, { day: DAY_A, time: "03:00" }, new Date(), call)).rejects.toThrow();
  });
  test("collectDay lists the booked jobs with their Mitti form links; the job without a day is not in any list", async () => {
    const dayA = await daily.collectDay(melbourneDate(rct.readyCheckStartAt(DAY_A, "09:00")));
    const dayB = await daily.collectDay(melbourneDate(rct.readyCheckStartAt(DAY_B, "14:00")));
    const flat = (g: Awaited<ReturnType<typeof daily.collectDay>>) => g.flatMap((x) => x.jobs.map((j) => ({ biz: x.trade.businessId, jobId: j.jobId, link: j.link, street: j.street, status: j.status })));
    expect(flat(dayA)).toEqual([{ biz: BIZ, jobId: A, link: expect.stringContaining("audit_1"), street: "1 Test Street", status: "confirmed" }]);
    expect(flat(dayB)).toEqual([{ biz: BIZ, jobId: B, link: expect.stringContaining("audit_2"), street: "2 Test Street", status: "confirmed" }]);
    for (const d of days) expect(flat(await daily.collectDay(d)).some((x) => x.jobId === C)).toBe(false);
    expect(dayA[0]!.trade).toMatchObject({ mittiInvited: true, approved: true, linked: true, isTest: true });
  });
});

describe("3. Complete in Mitti → quote prepared and released to the owner (TEST path)", () => {
  test("pressing Complete: measurements recorded, eligible from the form, quote stage, draft held until the send switch", async () => {
    completeForm("audit_1", "Home Insulation Victoria electrician");
    const r = await ms.syncMittiAssessment(A, null, call);
    // Decision 288: the form carries a price (old A1 form), so the business owner is NOT texted a price link.
    expect(await events(A, "boss_price_link_sent")).toHaveLength(0);
    expect(r.completed).toBe(true);
    const m = (await q<Record<string, unknown>>("select status, measured_area_m2, insulation_present, removal_required, access_difficulty from ceiling_measurements where job_id=$1 and is_current", [A]))[0]!;
    expect(m).toMatchObject({ status: "complete", measured_area_m2: "120", insulation_present: false, removal_required: false, access_difficulty: "easy" });
    expect(await events(A, "ready_check_form_eligible")).toHaveLength(1);
    expect((await job(A))["stage"]).toBe("measured_estimate_ready");
    const qs = await q<Record<string, unknown>>("select status, option_code, release_state, sent_at, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, partner_business_id from quotes where job_id=$1", [A]);
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ status: "draft", option_code: "INSTALLER_A1", release_state: "held", sent_at: null, partner_business_id: BIZ });
    const lines = await q<{ code: string; line_total_inc_gst: string }>("select code, line_total_inc_gst from quote_items qi join quotes qq on qq.id = qi.quote_id where qq.job_id=$1 order by sort", [A]);
    expect(lines).toEqual([{ code: "INSTALLER_PRICE", line_total_inc_gst: "2500" }, { code: "PIESA", line_total_inc_gst: "349" }, { code: "AP_FEE", line_total_inc_gst: "349" }]);
    expect(Number(qs[0]!["subtotal_inc_gst"])).toBe(3198);
    expect(Number(qs[0]!["veec_discount_inc_gst"])).toBeGreaterThan(0);
    expect(Number(qs[0]!["customer_total_inc_gst"])).toBe(3198 - Number(qs[0]!["veec_discount_inc_gst"]));
    expect(sent).toHaveLength(0); // nothing to the owner yet
  });
  test("the tick releases it through releaseQuoteToOwner: issued + released, secure owner link, TEST email and text recorded", async () => {
    const r = await mc.sweepCompletedMittiReadyChecks({ enabled: true, sendEnabled: true, call });
    expect(r.retried).toBeGreaterThanOrEqual(1);
    const [qq] = await q<Record<string, unknown>>("select id, status, release_state, sent_at from quotes where job_id=$1", [A]);
    expect(qq).toMatchObject({ status: "issued", release_state: "released" });
    expect(qq!["sent_at"]).not.toBeNull();
    expect(await events(A, "quote_sent_automatically")).toHaveLength(1);
    expect(await q<{ status: string }>("select status from customer_estimate_links where job_id=$1 and purpose='step3_estimate'", [A])).toEqual([{ status: "active" }]);
    const comms = await q<{ channel: string; source_event: string; delivery_status: string }>("select channel, source_event, delivery_status from job_communications where job_id=$1 order by channel", [A]);
    expect(comms).toEqual([{ channel: "email", source_event: `jo_tradie:quote_ready:${qq!["id"]}`, delivery_status: "sent" }, { channel: "sms", source_event: `jo_tradie:quote_ready:${qq!["id"]}`, delivery_status: "sent" }]);
    expect(sent.map((s) => s.to).sort()).toEqual(["0412 000 301", "qa.owner1@hivic-test.example"]);
    // Idempotent: a second tick sends nothing again.
    await mc.sweepCompletedMittiReadyChecks({ enabled: true, sendEnabled: true, call });
    expect(await q("select id from job_communications where job_id=$1", [A])).toHaveLength(2);
    expect(await events(A, "quote_sent_automatically")).toHaveLength(1);
  });
});

describe("4. 'My usual electrician' with none saved → held; saved later → the next tick releases (decision 113)", () => {
  test("Complete with My usual electrician and no usual electrician on the business: no quote, reason recorded, job waits at the quote stage", async () => {
    // Decision 289: the electrician is chosen at Add a job and that recorded choice wins over any old form answer. Job C was
    // added with no usual electrician saved (default = HIV), so stand in for a job whose owner chose "my usual electrician"
    // at Add a job and whose usual electrician is not on file any more: the recorded choice is "usual".
    expect(await events(C, "electrician_choice_set")).toHaveLength(1);
    expect((await events(C, "electrician_choice_set"))[0]!.details["choice"]).toBe("hivic");
    await q("insert into workflow_events (job_id, event_type, summary, details) values ($1, 'electrician_choice_set', 'test: chosen at Add a job', $2)", [C, JSON.stringify({ choice: "usual", source: "add_job" })]);
    completeForm("audit_3", "My usual electrician");
    const r = await ms.syncMittiAssessment(C, null, call);
    expect(r.completed).toBe(true);
    expect(await q("select id from quotes where job_id=$1", [C])).toHaveLength(0);
    const held = await events(C, "installer_quote_held");
    expect(held).toHaveLength(1);
    expect(held[0]!.details["blockers"]).toContain("Installer has no usual electrician saved");
    expect((await job(C))["stage"]).toBe("measured_estimate_ready"); // no booking: the Mitti hold moved it to scheduled, then the form completed it
    expect((await q<{ status: string }>("select status from ceiling_measurements where job_id=$1 and is_current", [C]))[0]!.status).toBe("complete");
    await mc.sweepCompletedMittiReadyChecks({ enabled: true, sendEnabled: true, call });
    expect(await q("select id from quotes where job_id=$1", [C])).toHaveLength(0); // still waiting, no text, no duplicate reason
    expect(await events(C, "installer_quote_held")).toHaveLength(1);
    expect(sent.filter((s) => s.label.startsWith("quote_ready"))).toHaveLength(2);
  });
  // Decisions 303 / 353 / 369 (JO_DECISIONS_LOG, Jo 25 Oct 2026) replace the old "usual electrician's saved price" rule:
  // an installer job's electrician is Home Insulation Victoria's or an APPROVED REC only, priced at its own onboarding
  // rate; anyone else holds the quote ("Electrician not onboarded: <name>"). Saving "Sam Sparks" (not an onboarded REC)
  // under My business therefore must NOT release a quote priced from the form/My business.
  test("decisions 303/369: saving a usual electrician who is not an onboarded REC releases nothing — no quote, no owner message", async () => {
    await tv.tradeSaveUsualElectrician(INST, { name: "Sam Sparks", licence: "REC 12345", priceIncGst: 299 });
    await mc.sweepCompletedMittiReadyChecks({ enabled: true, sendEnabled: true, call });
    expect(await q("select id from quotes where job_id=$1 and status in ('issued','accepted')", [C])).toHaveLength(0);
    expect(await q("select qi.id from quote_items qi join quotes qq on qq.id = qi.quote_id where qq.job_id=$1 and qi.line_total_inc_gst = 299", [C])).toHaveLength(0);
    expect(await q("select id from job_communications where job_id=$1 and source_event like 'jo_tradie:quote_ready:%'", [C])).toHaveLength(0);
  });
});

describe("5. The owner accepts on the secure link (6-digit code, signed agreement)", () => {
  test("code → session → respondToQuoteImpl: accepted, agreement recorded, installer told, invoice step run, stage moved", async () => {
    const ov = await import("../src/lib/owner-verify.server");
    const { respondToQuoteImpl } = await import("../src/lib/portal.functions");
    const [{ token }] = await q<{ token: string }>("select token from customer_estimate_links where job_id=$1 and status='active'", [A]);
    const asked = await ov.requestOwnerCode(token, "email");
    expect(asked.testCode).toMatch(/^\d{6}$/); // TEST jobs never send the code
    await expect(ov.verifyOwnerCode(token, asked.testCode === "000000" ? "000001" : "000000")).rejects.toThrow(/doesn't match/);
    const { session } = await ov.verifyOwnerCode(token, asked.testCode!);
    const s = await ov.ownerSession(token, session);
    expect(s.jobId).toBe(A);
    const [{ user_id }] = await q<{ user_id: string }>("select user_id from owners where id = (select owner_id from jobs where id=$1)", [A]);
    expect(s.userId).toBe(user_id);
    const [qq] = await q<{ id: string; version: number }>("select id, version from quotes where job_id=$1 and status='issued'", [A]);
    const signing = { signatoryName: "Helen Yang1", authorityType: "owner" as const, signatureName: "Helen Yang1", over18: true, readConsumerInfo: true, acceptAgreement: true, assistance: "none" as const };
    const ctx = { userId: s.userId, ip: "127.0.0.1", userAgent: "test", authorize: async (j: string) => { if (j !== s.jobId) throw new Error("This quote isn't on your job."); }, isOwner: async (j: string) => j === s.jobId };
    await expect(respondToQuoteImpl({ quoteId: qq!.id, accept: true, consent: true, expectedVersion: qq!.version + 1, signing } as never, ctx)).rejects.toThrow(/updated since/);
    expect(await respondToQuoteImpl({ quoteId: qq!.id, accept: true, consent: true, expectedVersion: qq!.version, signing } as never, ctx)).toEqual({ ok: true });
    expect((await q<Record<string, unknown>>("select status, accepted_by from quotes where id=$1", [qq!.id]))[0]).toEqual({ status: "accepted", accepted_by: s.userId });
    expect(await q("select id from customer_agreements where job_id=$1 and quote_id=$2 and signed_by=$3", [A, qq!.id, s.userId])).toHaveLength(1);
    expect(await q("select id from declarations where job_id=$1 and kind='owner_consent'", [A])).toHaveLength(1);
    expect(await events(A, "QUOTE_ACCEPTED")).toHaveLength(1);
    expect((await job(A))["stage"]).toBe("measured_quote_accepted");
    // Decision 376 (F13): the dead "quote accepted" outbox enqueue is gone — the installer is told by the approved I23
    // email below instead, and nothing is queued that the dispatcher could never deliver.
    expect(await q<{ payload: string }>("select payload from external_action_queue where job_id=$1", [A])).toEqual([]);
    // "You're told when they accept": the installer's email through the TEST path, once.
    expect(await q<{ source_event: string; recipients: string[] }>("select source_event, recipients from job_communications where job_id=$1 and source_event=$2", [A, `jo_tradie:installer_accepted:${qq!.id}`])).toEqual([{ source_event: `jo_tradie:installer_accepted:${qq!.id}`, recipients: ["deep@hivic-test.example"] }]);
    expect((await events(A, "installer_accepted_email"))[0]!.details).toMatchObject({ status: "sent", quote_id: qq!.id });
    expect(xero).toEqual([qq!.id]);
    // Accepting twice is refused; nothing doubles.
    await expect(respondToQuoteImpl({ quoteId: qq!.id, accept: true, consent: true, expectedVersion: qq!.version, signing } as never, ctx)).rejects.toThrow(/no longer open/);
    expect(await q("select id from customer_agreements where job_id=$1", [A])).toHaveLength(1);
  });
});

// HV-3151 (live, 23 Oct): Reinsulate added a job; the website-lead checks parked it at "Estimate sent – waiting for the owner
// to save their spot"; the 15-minute tick's form attempt was refused ("assessments can only be created once the job is
// waiting on or has booked its PIESA") and then waited a day. Jo 24 Oct: the form is made in any pre-Ready-Check stage and
// a stage refusal is retried on the next tick.
describe("6. HV-3151: an installer job parked at 'estimate sent' still gets its form on the next tick", () => {
  test("stage preliminary_estimate_ready + a stage refusal 10 minutes ago → the sweep makes ONE form and the job waits on the installer", async () => {
    await q("update workflow_settings set auto_send_mitti=false where id=1"); // keep Add a job from making the form so the sweep is what's tested
    const r = await os.startOnsiteReadyCheckFor(INST, BIZ, owner(9), { mode: "hivic" }, call);
    expect(r.formCreation).toBe("skipped");
    await settle();
    await q("update workflow_settings set auto_send_mitti=true where id=1");
    await q("update jobs set stage='preliminary_estimate_ready' where id=$1", [r.jobId]); // what the website-lead checks did live
    const { MITTI_STAGE_GUARD_MESSAGE } = await import("../src/lib/mitti.core");
    await q("insert into workflow_events (job_id, event_type, summary, details, internal, created_at) values ($1,'mitti_autoform_failed','Mitti Ready Check form could not be created automatically',$2,true, now() - interval '10 minutes')", [r.jobId, JSON.stringify({ needs_office: true, reason: MITTI_STAGE_GUARD_MESSAGE })]);
    const creates = () => mitti.calls.filter((c) => c === "POST /audits").length;
    const before = creates();
    const { sweepReadyCheckForms } = await import("../src/lib/mitti-autoform.server");
    const sweep = await sweepReadyCheckForms({ call, enabled: true });
    expect(sweep.results.find((x) => x.jobId === r.jobId)).toMatchObject({ outcome: "created" });
    expect(creates()).toBe(before + 1);
    const auditId = await auditOf(r.jobId);
    expect(auditId).not.toBeNull();
    expect(mitti.audits.get(auditId!)!["template_id"]).toBe(TPL); // the installer's A1 Ready Check form, prefilled
    expect((await job(r.jobId))["stage"]).toBe("ready_check_scheduled"); // waits on the installer, never "No reply"
    expect(await q("select id from workflow_events where job_id=$1 and event_type='mitti_autoform_failed' and created_at > now() - interval '1 minute'", [r.jobId])).toHaveLength(0);
    expect(await q("select id from workflow_events where job_id=$1 and event_type='mitti_audit_create_started'", [r.jobId])).toHaveLength(1);
    // The next tick leaves it alone: the form exists.
    const again = await sweepReadyCheckForms({ call, enabled: true });
    expect(again.results.find((x) => x.jobId === r.jobId)).toBeUndefined();
    expect(creates()).toBe(before + 1);
    expect(await os.onsiteFormFor(r.jobId, INST, undefined, false)).toEqual({ kind: "open", url: expect.stringContaining(auditId!) });
  });
});

describe("Jo 27 Oct completed Ready Check edit recovery", () => {
  test("completed 75m² removal edit refreshes current measurement then redrafts a held quote once, without sends", async () => {
    const beforeSends = sent.length;
    const added = await os.startOnsiteReadyCheckFor(INST, BIZ, owner(20), { mode: "hivic" }, call, { electricianChoice: "hivic" });
    const auditId = await auditOf(added.jobId);
    if (!auditId) throw new Error("No fixture audit");
    completeForm(auditId, "Home Insulation Victoria electrician");
    await ms.syncMittiAssessment(added.jobId, null, call);
    const original = await q<{ id: string }>("select id from quotes where job_id=$1 and status='draft'", [added.jobId]);
    expect(original).toHaveLength(1);
    const audit = mitti.audits.get(auditId);
    if (!audit) throw new Error("No fixture audit");
    audit.items = audit.items.filter(i => i.item_id !== "a_area1");
    audit.items.push({ item_id: "a_area1", label: "Ceiling area 1", type: "section", children: [ans("Enter the measured ceiling area (m²)", "75"), pick("Is there existing insulation?", "Yes – batts below R2.0"), pick("Does any insulation in this area need to be removed?", "Yes"), ans("How much existing insulation needs to be removed? (m²)", "75")] });
    audit.items = audit.items.filter(i => i.label !== "What's included in your quote?");
    audit.items.push(pick("What's included in your quote?", "R5.0 ceiling insulation - supply & install", "Removal of existing insulation"));
    audit["modified_at"] = new Date(Date.now() + 1000).toISOString();
    await mc.sweepCompletedMittiReadyChecks({ enabled: true, sendEnabled: false, call });
    expect((await q("select measured_area_m2,removal_required,removal_m2,access_difficulty,status from ceiling_measurements where job_id=$1 and is_current", [added.jobId]))[0]).toMatchObject({ measured_area_m2: "75", removal_required: true, removal_m2: "75", access_difficulty: "easy", status: "complete" });
    expect(await events(added.jobId, "mitti_completed_measurement_refreshed")).toHaveLength(1);
    expect(await q("select id from quotes where job_id=$1 and status='superseded'", [added.jobId])).toEqual(original);
    const draft = await q<{ id: string }>("select id from quotes where job_id=$1 and status='draft' and release_state='held'", [added.jobId]);
    expect(draft).toHaveLength(1);
    expect(draft[0]?.id).not.toBe(original[0]?.id);
    await mc.sweepCompletedMittiReadyChecks({ enabled: true, sendEnabled: false, call });
    expect(await events(added.jobId, "mitti_completed_measurement_refreshed")).toHaveLength(1);
    expect(await q("select id from quotes where job_id=$1 and status='draft'", [added.jobId])).toEqual(draft);
    expect(sent.length).toBe(beforeSends);
    // Both issued and accepted quotes remain byte-for-byte unchanged on further form edits.
    for (const status of ["issued", "accepted"]) {
      await q("update quotes set status=$2,sent_at=now(),release_state='released' where id=$1", [draft[0]?.id, status]);
      const before = await q("select * from quotes where job_id=$1 order by id", [added.jobId]);
      audit.items.push(ans("Please explain", `Access note ${status}`));
      await mc.sweepCompletedMittiReadyChecks({ enabled: true, sendEnabled: false, call });
      expect(await q("select * from quotes where job_id=$1 order by id", [added.jobId])).toEqual(before);
      expect(sent.length).toBe(beforeSends);
    }
  });
});


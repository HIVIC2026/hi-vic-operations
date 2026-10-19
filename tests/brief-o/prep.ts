// Brief O — fixture preparation for the integrated browser journey.
//
// This file prepares DATA ONLY (a synthetic qa_test job, its Gate 1 outcome, the on-site consent and the
// customer estimate link that the real homeowner page consumes). Every business step under test — the
// owner choosing times, the office dispatching, the installer accepting and submitting — is executed
// afterwards in a real browser against the running app. Nothing here substitutes for a browser interaction.
//
// Each run gets its own job (BRIEF-O-FLOW-<n>). ready_check_acceptances is append-only, so a job that has
// been through the owner's acceptance cannot be returned to a pre-acceptance state without deleting audit
// history. Refusing to do that is the point of the append-only rule, so runs use separate jobs instead.
import { mkdirSync, writeFileSync } from "node:fs";
import { assertLocalOnly, ID, installEnv, seedFixtures, serviceAdmin } from "../brief-n/harness";

installEnv();
assertLocalOnly();

const RUN = process.argv[2] ?? "1";
const JOB = `fa400000-0000-4000-8000-00000000000${RUN}`;
const JOB_NUMBER = `BRIEF-O-FLOW-${RUN}`;
const OUT = "/tmp/brief-o-browser";
mkdirSync(OUT, { recursive: true });

const admin = await serviceAdmin();

// 1. Reset the shared Brief N fixtures (FK-safe, append-only history preserved). This keeps the Brief N
//    regression suite runnable after a Brief O journey.
await seedFixtures(admin);

// 2. Clear this run's own mutable, job-scoped rows (safe on a brand-new job id).
for (const table of ["contact_releases", "ready_check_observations", "ready_checks", "partner_offers",
  "ready_check_windows", "bookings", "job_assignments", "ceiling_measurements", "evidence_files"]) {
  const { error } = await admin.from(table).delete().eq("job_id", JOB);
  if (error) throw new Error(`${table}: ${error.message}`);
}

// 3. Create the job. Gate 1 outcome and the owner's area estimate are business facts the test must not
//    invent through the UI; the estimate maths itself is not under test.
const { data: existingJob } = await admin.from("jobs").select("id").eq("id", JOB).maybeSingle();
if (!existingJob) {
  const { error } = await admin.from("jobs").insert({
    id: JOB, job_number: JOB_NUMBER, property_id: ID.property, owner_id: ID.owner,
    business_unit: "hivic", stage: "preliminary_estimate_ready", source: "qa_test", channel: "hivic_sourced",
    life_support: false, life_support_status: "no", offer_dispatch_override: "office_picks",
    estimated_area_m2: 120, estimated_area_unknown: false,
    eligibility_outcome: "likely_eligible",
    eligibility_reason: "Brief O synthetic fixture — Gate 1 outcome prepared, not asserted",
    eligibility_decision_source: "admin", eligibility_review_required: false,
    eligibility_set_by: ID.officeProfile, eligibility_set_at: new Date().toISOString(),
  } as never);
  if (error) throw new Error(`jobs: ${error.message}`);
} else {
  const { error } = await admin.from("jobs").update({
    stage: "preliminary_estimate_ready", prior_stage: null, next_action: null,
    offer_dispatch_override: "office_picks", deleted_at: null, deleted_by: null, deleted_reason: null,
    estimated_area_m2: 120, estimated_area_unknown: false,
    eligibility_outcome: "likely_eligible", eligibility_decision_source: "admin", eligibility_review_required: false,
  }).eq("id", JOB);
  if (error) throw new Error(`jobs: ${error.message}`);
}

// 4. The owner consented on site (Gate A). Append-only: created once per job.
const { data: consent } = await admin.from("owner_contact_consents").select("job_id").eq("job_id", JOB).maybeSingle();
if (!consent) {
  const { error } = await admin.from("owner_contact_consents").insert({
    job_id: JOB, owner_id: ID.owner, source: "onsite_ready_check", consent_status: "granted",
    consent_key: "onsite_ready_check", sha256: "brief-o-fixture", snapshot: { fixture: true },
  } as never);
  if (error) throw new Error(`owner_contact_consents: ${error.message}`);
}

// 5. Property coordinates so an installer's on-site photo passes the real location check
//    (checkPhotoLocation). Synthetic point in Richmond VIC, matching the browser's fake geolocation.
const { data: existingFact } = await admin.from("property_facts")
  .select("id").eq("property_id", ID.property).eq("fact_key", "coordinates").eq("is_current", true).maybeSingle();
if (!existingFact) {
  const { error } = await admin.from("property_facts").insert({
    property_id: ID.property, job_id: JOB, fact_key: "coordinates",
    value: [144.9986, -37.8183], is_current: true, check_status: "pass",
    source_type: "fixture", source_name: "Brief O synthetic coordinate", confidence: "high",
  } as never);
  if (error) throw new Error(`property_facts: ${error.message}`);
}

// 6. Build the estimate + secure customer link through the real product mechanism (syncStep3), the same
//    call the office's Gate 1 decision makes. No hand-written token rows.
const { syncStep3 } = await import("../../src/lib/estimatelink.server");
const synced = await syncStep3(JOB, ID.officeProfile);

const { data: link, error: linkErr } = await admin.from("customer_estimate_links")
  .select("token, status, expires_at, current_estimate_id")
  .eq("job_id", JOB).eq("status", "active").maybeSingle();
if (linkErr) throw new Error(`customer_estimate_links: ${linkErr.message}`);
if (!link?.token) throw new Error(`no usable customer link was issued (syncStep3 -> ${synced.status}/${synced.mode})`);

writeFileSync(`${OUT}/token.txt`, link.token);
writeFileSync(`${OUT}/prep.json`, JSON.stringify({
  run: RUN, jobId: JOB, jobNumber: JOB_NUMBER, token: link.token,
  estimateId: link.current_estimate_id, expiresAt: link.expires_at, syncStep3: synced,
}, null, 2));

console.log(JSON.stringify({ run: RUN, jobId: JOB, jobNumber: JOB_NUMBER, stage: "preliminary_estimate_ready", link: `/estimate/${link.token}`, syncStep3: synced }, null, 2));

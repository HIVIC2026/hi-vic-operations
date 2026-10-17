// Brief N — READY CHECK SUCCESS PATH harness against the EXISTING disposable local Supabase stack.
//
// Reuses the environment Brief F/K already provisioned (no new database is created):
//   docker container supabase_db_hivic-uat-disposable  (PostgreSQL 17, host port 54332)
//   docker container supabase_kong_hivic-uat-disposable (PostgREST / GoTrue / Storage gateway, host port 54331)
//
// Two access paths are used deliberately, because they prove different things:
//   * `admin`  — the service-role client the application's own server modules use (`client.server.ts`).
//                Drives the real service functions: owner windows, offer dispatch, acceptance, ready check.
//   * `asUser` — a PostgREST client carrying a JWT minted with THIS stack's own secret and `sub` = the
//                synthetic user. PostgREST then runs every statement as role `authenticated`, so Row Level
//                Security, `auth.uid()` and `can_access_job()` are enforced by Postgres exactly as in
//                production. This is a real RLS test, not a mock — but it is NOT a GoTrue login, so the
//                password/magic-link sign-in flow is out of scope here (recorded in the report).
//
// Every fixture is synthetic, fixed-UUID and rewritten at the start of each run. The URL is asserted to be
// localhost before any write, and the shared/production project is never referenced.
import { createHmac } from "node:crypto";

export const DISPOSABLE_URL = "http://localhost:54331";
/** The disposable stack's own JWT secret; used only to mint local test tokens. */
const DISPOSABLE_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

type JwtRole = "service_role" | "anon" | "authenticated";

export function mintJwt(role: JwtRole, sub?: string): string {
  const iat = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = { role, iss: "supabase", iat, exp: iat + 3600 };
  if (sub) payload["sub"] = sub;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const signature = b64url(createHmac("sha256", DISPOSABLE_JWT_SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${signature}`;
}

/**
 * Point the app's server-side Supabase client at the DISPOSABLE local stack.
 * `client.server.ts` reads these lazily, so setting them at module load is enough — and it means nothing
 * can read the production URL out of .env while these tests run.
 */
export function installEnv(): void {
  process.env["SUPABASE_URL"] = DISPOSABLE_URL;
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = mintJwt("service_role");
  process.env["SUPABASE_ANON_KEY"] = mintJwt("anon");
  process.env["SUPABASE_PUBLISHABLE_KEY"] = mintJwt("anon");
  // A real Mitti call must be impossible: with no token the client fails closed instead of reaching the API.
  delete process.env["MITTI_API_TOKEN"];
}
installEnv();

/** Hard stop if anything has pointed the client at a hosted Supabase project. */
export function assertLocalOnly(): void {
  const url = process.env["SUPABASE_URL"] ?? "";
  if (!url.startsWith("http://localhost:")) {
    throw new Error(`Brief N refuses to run against a non-local Supabase URL (${url}). This harness writes fixtures.`);
  }
  if (url.includes("wvuffpykgnqliikhodzl")) throw new Error("Brief N refuses to touch the shared project.");
}

export async function preflight(): Promise<void> {
  assertLocalOnly();
  const res = await fetch(`${DISPOSABLE_URL}/rest/v1/`, {
    headers: { apikey: process.env["SUPABASE_SERVICE_ROLE_KEY"]! },
  }).catch(() => null);
  if (!res || res.status !== 200) {
    throw new Error(
      `The existing disposable Supabase is not reachable at ${DISPOSABLE_URL}. ` +
        `Brief N reuses the local stack — start/keep docker containers supabase_db_hivic-uat-disposable and supabase_kong_hivic-uat-disposable.`,
    );
  }
  const auth = await fetch(`${DISPOSABLE_URL}/auth/v1/health`).catch(() => null);
  if (!auth || auth.status !== 200) throw new Error(`GoTrue is not healthy at ${DISPOSABLE_URL}/auth/v1/health`);
}

/** bun shares `mock.module` across every test file in one process; fail loudly rather than test a stub. */
export async function assertAppClientIsReal(): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const probe = await supabaseAdmin.from("workflow_settings").select("id").eq("id", 1).maybeSingle();
  if (!probe || probe.error || (probe.data as { id?: number } | null)?.id !== 1) {
    throw new Error(
      "The app's Supabase client is stubbed in this process (bun shares mock.module across test files). " +
        "Run the Brief N integration suites in their own bun invocation, separate from component suites.",
    );
  }
}

export type Admin = Awaited<ReturnType<typeof serviceAdmin>>;

export async function serviceAdmin() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(DISPOSABLE_URL, process.env["SUPABASE_SERVICE_ROLE_KEY"]!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** PostgREST client running as role `authenticated` with auth.uid() = userId (real RLS). */
export async function asUser(userId: string) {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(DISPOSABLE_URL, mintJwt("authenticated", userId), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${mintJwt("authenticated", userId)}` } },
  });
}

export async function asAnon() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(DISPOSABLE_URL, mintJwt("anon"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------- fixture identifiers (fixed, so every run rewrites the same rows) ----------
export const ID = {
  officeProfile: "fa100000-0000-4000-8000-0000000000f1",
  installerAProfile: "fa100000-0000-4000-8000-0000000000f2",
  installerBProfile: "fa100000-0000-4000-8000-0000000000f3",
  /** Same business as installer A but has NO installer app-role — used by the "only an installer can accept" guard. */
  officeMemberProfile: "fa100000-0000-4000-8000-0000000000f4",

  bizA: "fa100000-0000-4000-8000-0000000000b1",
  bizB: "fa100000-0000-4000-8000-0000000000b2",
  /** approved=false: exists, active, covers the postcode — but not approved, so never a candidate. */
  bizUnapproved: "fa100000-0000-4000-8000-0000000000b3",

  workerA: "fa100000-0000-4000-8000-0000000000a1",
  workerB: "fa100000-0000-4000-8000-0000000000a2",
  certA: "fa100000-0000-4000-8000-0000000000c1",
  certB: "fa100000-0000-4000-8000-0000000000c2",

  property: "fa200000-0000-4000-8000-0000000000a1",
  owner: "fa200000-0000-4000-8000-0000000000b1",

  jobFlow: "fa300000-0000-4000-8000-000000000001",
  jobRepeat: "fa300000-0000-4000-8000-000000000002",
  jobWrongStage: "fa300000-0000-4000-8000-000000000003",
  jobNoWindows: "fa300000-0000-4000-8000-000000000004",
  jobAssigned: "fa300000-0000-4000-8000-000000000005",
  jobOpenOffer: "fa300000-0000-4000-8000-000000000006",
} as const;

export const ALL_JOBS = [
  ID.jobFlow, ID.jobRepeat, ID.jobWrongStage, ID.jobNoWindows, ID.jobAssigned, ID.jobOpenOffer,
];

const POSTCODE = "3121";

function must<T>(label: string, res: { error: { message: string } | null; data?: T }): T | undefined {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data;
}

async function has(admin: Admin, table: string, id: string) {
  const { data } = await admin.from(table).select("id").eq("id", id).maybeSingle();
  return !!data;
}

/**
 * Ensure-and-reset. `workflow_events` and `owner_contact_consents` are append-only in the real schema, and
 * `jobs` are referenced by those consent rows with ON DELETE RESTRICT — so the fixture is created once and
 * then re-driven, exactly like UAT data. Nothing protected is deleted to force a clean slate.
 */
export async function seedFixtures(admin: Admin): Promise<void> {
  // --- reset the mutable, job-scoped rows of the previous run (FK-safe order) ---
  must("clean contact_releases", await admin.from("contact_releases").delete().in("job_id", ALL_JOBS));
  must("clean ready_check_observations", await admin.from("ready_check_observations").delete().in("job_id", ALL_JOBS));
  must("clean ready_checks", await admin.from("ready_checks").delete().in("job_id", ALL_JOBS));
  must("clean partner_offers", await admin.from("partner_offers").delete().in("job_id", ALL_JOBS));
  must("clean ready_check_windows", await admin.from("ready_check_windows").delete().in("job_id", ALL_JOBS));
  // bookings.assignment_id references job_assignments, so bookings must be deleted first.
  must("clean bookings", await admin.from("bookings").delete().in("job_id", ALL_JOBS));
  must("clean job_assignments", await admin.from("job_assignments").delete().in("job_id", ALL_JOBS));
  must("clean ceiling_measurements", await admin.from("ceiling_measurements").delete().in("job_id", ALL_JOBS));
  must("clean evidence files", await admin.from("evidence_files").delete().in("job_id", ALL_JOBS));
  must("clean eligibility verifications", await admin.from("eligibility_verifications").delete().in("job_id", ALL_JOBS));
  // The standard evidence checklist is created with the job; re-open every required item for the new run.
  must("reset evidence requirements", await admin.from("evidence_requirements")
    .update({ status: "outstanding" }).in("job_id", ALL_JOBS).eq("required", true));

  // --- people ---
  const people: [string, string, string][] = [
    [ID.officeProfile, "Brief N Office", "office@brief-n.test"],
    [ID.installerAProfile, "Brief N Installer A", "installer-a@brief-n.test"],
    [ID.installerBProfile, "Brief N Installer B", "installer-b@brief-n.test"],
    [ID.officeMemberProfile, "Brief N Installer A Office", "installer-a-office@brief-n.test"],
  ];
  for (const [id, full_name, email] of people) {
    if (!(await has(admin, "profiles", id))) must("insert profile", await admin.from("profiles").insert({ id, full_name, email } as never));
  }

  // App roles: has_role(user, 'installer') is a hard precondition of respondToReadyCheckOffer.
  const roles: [string, string][] = [
    [ID.officeProfile, "admin"],
    [ID.installerAProfile, "installer"],
    [ID.installerBProfile, "installer"],
  ];
  for (const [user_id, role] of roles) {
    const { data } = await admin.from("user_roles").select("id").eq("user_id", user_id).eq("role", role as never).maybeSingle();
    if (!data) must("insert role", await admin.from("user_roles").insert({ user_id, role } as never));
  }

  // --- installer businesses (TEST partners: a qa_test job may only ever be offered to these) ---
  const business = (id: string, name: string, approved: boolean, extra: Record<string, unknown> = {}) => ({
    id, name, business_type: "eec_installer",
    is_active: true, onboarding_status: approved ? "approved" : "submitted",
    onboarding_notes: "[TEST PARTNER] Brief N synthetic fixture — disposable local DB only",
    free_measureups_for_hivic_quote_leads: true, coverage_verified_at: new Date().toISOString(),
    service_postcodes: [POSTCODE], accepting_new_jobs: true, receives_hivic_leads: true,
    base_suburb: "Richmond", coverage_lat: -37.8183, coverage_lng: 144.9986,
    ...extra,
  });
  if (!(await has(admin, "businesses", ID.bizA))) must("insert bizA", await admin.from("businesses").insert(business(ID.bizA, "Brief N Installers A", true) as never));
  if (!(await has(admin, "businesses", ID.bizB))) must("insert bizB", await admin.from("businesses").insert(business(ID.bizB, "Brief N Installers B", true) as never));
  if (!(await has(admin, "businesses", ID.bizUnapproved))) must("insert bizUnapproved", await admin.from("businesses").insert(business(ID.bizUnapproved, "Brief N Unapproved", false) as never));

  // A worker only counts as an installer with an office-verified CII certification at level "full".
  const worker = (id: string, business_id: string, email: string) => ({
    id, business_id, trade_role: "installer", full_legal_name: email,
    email, approval_status: "approved", certification_status: "verified",
    qualification: "Certificate III in Wall and Ceiling Lining",
  });
  const cert = (id: string, worker_id: string, email: string, n: string) => ({
    id, worker_id, worker_email: email, status: "verified",
    certificate_number: n, evidence_source: "certificate_sighted",
    evidence_note: "Brief N synthetic fixture certificate", recorded_by: ID.officeProfile,
  });
  const level = (certification_id: string, email: string) => ({
    certification_id, worker_email: email, level: "full", expires_on: "2027-12-31", recorded_by: ID.officeProfile,
  });

  for (const [wid, bid, email, cid, cn] of [
    [ID.workerA, ID.bizA, "installer-a@brief-n.test", ID.certA, "BRIEF-N-CERT-A"],
    [ID.workerB, ID.bizB, "installer-b@brief-n.test", ID.certB, "BRIEF-N-CERT-B"],
  ] as const) {
    if (!(await has(admin, "partner_workers", wid))) must("insert worker", await admin.from("partner_workers").insert(worker(wid, bid, email) as never));
    if (!(await has(admin, "partner_worker_certifications", cid))) must("insert cert", await admin.from("partner_worker_certifications").insert(cert(cid, wid, email, cn) as never));
    const { data: lv } = await admin.from("worker_certification_levels").select("id").eq("certification_id", cid).maybeSingle();
    if (!lv) must("insert cert level", await admin.from("worker_certification_levels").insert(level(cid, email) as never));
  }

  // business_members: required by accept_ready_check_offer (the accepting user must belong to the business).
  const members: [string, string, string][] = [
    [ID.bizA, ID.installerAProfile, "member"],
    [ID.bizB, ID.installerBProfile, "member"],
    [ID.bizA, ID.officeMemberProfile, "business_admin"],
  ];
  for (const [business_id, user_id, member_role] of members) {
    const { data } = await admin.from("business_members").select("id").eq("business_id", business_id).eq("user_id", user_id).maybeSingle();
    if (!data) must("insert member", await admin.from("business_members").insert({ business_id, user_id, member_role, active: true } as never));
  }

  // --- property + owner (shared by every synthetic job; created once) ---
  if (!(await has(admin, "owners", ID.owner))) {
    must("insert owner", await admin.from("owners").insert({
      id: ID.owner, full_name: "Brief N Owner", email: "owner@brief-n.test", phone: "0400000000",
    } as never));
  }
  if (!(await has(admin, "properties", ID.property))) {
    must("insert property", await admin.from("properties").insert({
      id: ID.property, owner_id: ID.owner, address_line: "1 Brief N Street", suburb: "Richmond",
      state: "VIC", postcode: POSTCODE,
    } as never));
  }

  // --- jobs ---
  const job = (id: string, number: string, stage: string, extra: Record<string, unknown> = {}) => ({
    id, job_number: number, property_id: ID.property, owner_id: ID.owner, business_unit: "hivic",
    stage, source: "qa_test", channel: "hivic_sourced", life_support: false, life_support_status: "no",
    // "Office picks" is a real product setting (setJobOfficePicks); it stops the owner's times from
    // auto-dispatching so the office dispatch step can be exercised explicitly.
    offer_dispatch_override: "office_picks",
    ...extra,
  });
  const jobRows = [
    job(ID.jobFlow, "BRIEF-N-FLOW-1", "ready_check_ready_to_schedule"),
    job(ID.jobRepeat, "BRIEF-N-FLOW-2", "ready_check_ready_to_schedule"),
    job(ID.jobWrongStage, "BRIEF-N-NEG-1", "preliminary_estimate_ready"),
    job(ID.jobNoWindows, "BRIEF-N-NEG-2", "ready_check_ready_to_schedule"),
    job(ID.jobAssigned, "BRIEF-N-NEG-3", "ready_check_ready_to_schedule"),
    job(ID.jobOpenOffer, "BRIEF-N-NEG-4", "ready_check_ready_to_schedule"),
  ];
  const missing: typeof jobRows = [];
  for (const row of jobRows) if (!(await has(admin, "jobs", row.id))) missing.push(row);
  if (missing.length) must("insert jobs", await admin.from("jobs").insert(missing as never));

  // Re-drive the happy-path jobs from a clean workflow state (fixture reset, not a business action).
  must("reset flow job", await admin.from("jobs").update({
    stage: "ready_check_ready_to_schedule", prior_stage: null, next_action: null,
    offer_dispatch_override: "office_picks", deleted_at: null, deleted_by: null, deleted_reason: null,
  }).in("id", [ID.jobFlow, ID.jobRepeat, ID.jobNoWindows, ID.jobAssigned, ID.jobOpenOffer]));
  must("reset wrong-stage job", await admin.from("jobs").update({
    stage: "preliminary_estimate_ready", prior_stage: null, next_action: null, offer_dispatch_override: "office_picks",
  }).eq("id", ID.jobWrongStage));

  // --- Gate A: the owner consented on site (append-only; created once) ---
  const { data: consented } = await admin
    .from("owner_contact_consents").select("job_id").in("job_id", ALL_JOBS as unknown as string[]);
  const done = new Set((consented ?? []).map((c) => (c as { job_id: string }).job_id));
  const need = ALL_JOBS.filter((j) => !done.has(j));
  if (need.length) {
    must("insert onsite consent", await admin.from("owner_contact_consents").insert(need.map((job_id) => ({
      job_id, owner_id: ID.owner, source: "onsite_ready_check", consent_status: "granted",
      consent_key: "onsite_ready_check", sha256: "brief-n-fixture", snapshot: { fixture: true },
    })) as never));
  }

  // --- negative-case fixtures ---
  // an installer is already assigned
  must("insert installer assignment", await admin.from("job_assignments").insert({
    job_id: ID.jobAssigned, user_id: ID.installerAProfile, role: "installer", active: true, business_id: ID.bizA,
  } as never));
  // open owner times PLUS an already-open offer: isolates the "offers are already open" guard.
  must("insert open-offer windows", await admin.from("ready_check_windows").insert(
    ["10-12", "12-14", "8-10"].map((slot, i) => {
      const start = new Date(Date.now() + (3 + i) * 86_400_000);
      return { job_id: ID.jobOpenOffer, round: 1, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 2 * 3_600_000).toISOString(), status: "open" };
    }) as never,
  ));
  must("insert open offer", await admin.from("partner_offers").insert({
    job_id: ID.jobOpenOffer, business_id: ID.bizA, kind: "ready_check", batch: 1,
    summary: { fixture: true }, offered_by: null,
  } as never));
}

// ---------- read-back helpers ----------
export async function offersFor(admin: Admin, jobId: string) {
  const { data } = await admin.from("partner_offers")
    .select("id, job_id, business_id, kind, status, batch, summary, offered_by, offered_at, expires_at, responded_by, responded_at, superseded_at")
    .eq("job_id", jobId).order("offered_at");
  return data ?? [];
}

export async function windowsFor(admin: Admin, jobId: string) {
  const { data } = await admin.from("ready_check_windows")
    .select("id, job_id, round, starts_at, ends_at, status, taken_offer_id, taken_by").eq("job_id", jobId).order("starts_at");
  return data ?? [];
}

export async function assignmentsFor(admin: Admin, jobId: string) {
  const { data } = await admin.from("job_assignments")
    .select("id, job_id, user_id, role, business_id, active, assigned_by, first_response_at, booking_confirmed_at")
    .eq("job_id", jobId);
  return data ?? [];
}

export async function eventsFor(admin: Admin, jobId: string) {
  const { data } = await admin.from("workflow_events")
    .select("id, job_id, actor_id, event_type, summary, details, to_stage, created_at").eq("job_id", jobId).order("created_at");
  return data ?? [];
}

export async function jobRow(admin: Admin, jobId: string) {
  const { data } = await admin.from("jobs").select("id, job_number, stage, next_action, offer_dispatch_override, source, channel").eq("id", jobId).single();
  return data as { id: string; job_number: string; stage: string; next_action: string | null; offer_dispatch_override: string | null; source: string; channel: string };
}

/** Counts every queued external action for a job — proves nothing was sent or scheduled to be sent. */
export async function externalActionsFor(admin: Admin, jobId: string) {
  const { data, error } = await admin.from("external_action_outbox").select("id, action_type, target_ref, status").eq("job_id", jobId);
  if (error) throw new Error(`external_action_outbox: ${error.message}`);
  return data ?? [];
}

/** Collect the message an action fails with (integration tests assert real production messages). */
export async function failure(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("expected the action to fail, but it succeeded");
}

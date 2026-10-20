// Explicit TEST preparation and access. Opening a persona never prepares, repairs or approves its records.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { WorkflowError } from "./workflow.server";
import { isTestPartner, TEST_PARTNER_MARK } from "./test-send.core";
import { assignBlocker, hashToken, newToken } from "./worker-links.core";
import { qaPersonaMissingMessage } from "./qa-role-link.core";
import { installerQualification } from "./partner-activation.core";

type Admin = SupabaseClient<Database>;
type Context = { supabase: Admin; userId: string };
type Role = "owner" | "installer" | "electrician";
const QA_DOMAIN = "@hivic-test.example";
const INSTALLER_EMAIL = "qa.installer.alpha@hivic-test.example";
const ELECTRICIAN_EMAIL = "qa.rec.delta@hivic-test.example";
const WORKER_EMAIL = "qa.worker.alpha@hivic-test.example";
const QA_WORKER_LINK_MS = 15 * 60_000;

function checked<T>(result: { data: T; error: { message: string } | null }, operation: string): T {
  if (result.error) throw new WorkflowError(`${operation}: ${result.error.message}`);
  return result.data;
}
function safeEmail(value: string | null | undefined): string {
  const email = (value ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@hivic-test\.example$/.test(email)) throw new WorkflowError("This TEST account is not safely isolated.");
  return email;
}
const randomPassword = () => `${crypto.randomUUID()}${crypto.randomUUID()}Aa1!`;

export async function requireQaAdmin(context: Context) {
  const result = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (checked(result, "Could not verify TEST administrator access") !== true) throw new WorkflowError("Admin only.");
}

export async function requireQaJob(admin: Admin, jobId: string) {
  const job = checked(await admin.from("jobs").select("id, owner_id, source, qa_archived_at, deleted_at").eq("id", jobId).maybeSingle(), "Could not read the TEST journey");
  if (!job || job.source !== "qa_test" || job.qa_archived_at || job.deleted_at) throw new WorkflowError("This action is only available for an active TEST journey.");
  return job;
}

async function qaIdentity(admin: Admin, userId: string, expectedEmail?: string, allowMissingProfile = false, allowBlocked = false) {
  const profile = checked(await admin.from("profiles").select("id, email, business_id, full_name").eq("id", userId).maybeSingle(), "Could not read the TEST profile");
  const auth = checked(await admin.auth.admin.getUserById(userId), "Could not verify the TEST sign-in identity").user;
  if (!auth || auth.id !== userId || auth.user_metadata?.qa_test !== true) throw new WorkflowError("This is not an approved TEST identity.");
  const email = safeEmail(auth.email);
  if ((expectedEmail && email !== safeEmail(expectedEmail)) || (!profile && !allowMissingProfile) ||
    (profile && (profile.id !== auth.id || safeEmail(profile.email) !== email))) throw new WorkflowError("The TEST profile and sign-in identity do not match.");
  const blockedUntil = (auth as typeof auth & { banned_until?: string }).banned_until;
  if (!allowBlocked && blockedUntil && Date.parse(blockedUntil) > Date.now()) throw new WorkflowError("This TEST sign-in is blocked. Its existing state has been retained.");
  return { userId, email, profile };
}

/** Lookup does not repair a partial account, reset a password or change metadata. */
async function findQaIdentity(admin: Admin, email: string, allowBlocked = false) {
  const expected = safeEmail(email);
  const profile = checked(await admin.from("profiles").select("id").eq("email", expected).maybeSingle(), "Could not find the TEST profile");
  if (profile) return qaIdentity(admin, profile.id, expected, false, allowBlocked);
  // An interrupted older preparation may have created Auth without its profile. Never create/reset over it.
  for (let page = 1; page <= 100; page++) {
    const listed = checked(await admin.auth.admin.listUsers({ page, perPage: 200 }), "Could not check for an existing TEST sign-in");
    const match = listed.users.find(user => user.email?.trim().toLowerCase() === expected);
    if (match) return qaIdentity(admin, match.id, expected, true, allowBlocked);
    if (listed.users.length < 200) return null;
  }
  throw new WorkflowError("Could not establish whether the TEST sign-in already exists. No account was created.");
}

async function rolesFor(admin: Admin, userId: string, role: Role, allowMissing = false) {
  const roles = checked(await admin.from("user_roles").select("role").eq("user_id", userId), "Could not check TEST account roles") ?? [];
  if (!roles.length && allowMissing) return false;
  if (roles.length !== 1 || roles[0].role !== role) throw new WorkflowError("The TEST account has a missing or conflicting role. Its existing roles have been retained.");
  return true;
}

async function qaBusiness(admin: Admin, businessId: string, role: "installer" | "electrician") {
  const business = checked(await admin.from("businesses").select("id, name, email, business_type, onboarding_notes, onboarding_status, is_active").eq("id", businessId).maybeSingle(), "Could not read the TEST business");
  if (!business || !isTestPartner(business) || business.business_type !== (role === "installer" ? "eec_installer" : "rec")) throw new WorkflowError("This persona is not associated with the expected TEST business.");
  if (business.is_active !== true || business.onboarding_status !== "approved") throw new WorkflowError("The TEST business is not currently approved and active. Its existing state has been retained.");
  return business;
}

async function membership(admin: Admin, userId: string, businessId: string, memberRole: "business_admin" | "field_worker", allowMissing = false) {
  const members = checked(await admin.from("business_members").select("business_id, user_id, member_role, active").eq("user_id", userId), "Could not check TEST business membership") ?? [];
  if (!members.length && allowMissing) return false;
  if (members.length !== 1 || members[0].business_id !== businessId || members[0].member_role !== memberRole || members[0].active !== true) {
    throw new WorkflowError("The TEST membership is missing, inactive or conflicting. Its existing state has been retained.");
  }
  return true;
}

async function tradeIdentity(admin: Admin, userId: string, businessId: string, role: "installer" | "electrician", memberRole: "business_admin" | "field_worker") {
  const identity = await qaIdentity(admin, userId);
  if (identity.profile?.business_id !== businessId) throw new WorkflowError("The TEST profile is associated with another business.");
  await rolesFor(admin, userId, role);
  await qaBusiness(admin, businessId, role);
  await membership(admin, userId, businessId, memberRole);
  return identity;
}

async function ownerIsolation(admin: Admin, ownerId: string | null, userId?: string | null) {
  if (!ownerId) throw new WorkflowError("The TEST owner record is missing.");
  const ownerRead = userId ? await admin.from("owners").select("id", { count: "exact" }).eq("user_id", userId) : { data: [], error: null, count: 0 };
  const owners = checked(ownerRead, "Could not verify TEST owner access scope") ?? [];
  if (ownerRead.count == null || ownerRead.count !== owners.length) throw new WorkflowError("The complete TEST owner access scope could not be verified. Nothing was changed.");
  const ownerIds = [...new Set([ownerId, ...owners.map(owner => owner.id)])];
  const jobRead = await admin.from("jobs").select("id, source", { count: "exact" }).in("owner_id", ownerIds);
  const jobs = checked(jobRead, "Could not verify TEST owner journey isolation") ?? [];
  if (jobRead.count == null || jobRead.count !== jobs.length) throw new WorkflowError("The complete TEST owner journey scope could not be verified. Nothing was changed.");
  if (jobs.some(job => job.source !== "qa_test")) throw new WorkflowError("This owner record is also associated with non-TEST work. TEST access was not issued or prepared.");
}

async function assignment(admin: Admin, jobId: string, role: "installer" | "electrician") {
  const rows = checked(await admin.from("job_assignments").select("id, user_id, business_id, role, active").eq("job_id", jobId).eq("role", role).eq("active", true), "Could not read the TEST assignment") ?? [];
  if (rows.length !== 1 || !rows[0].user_id || !rows[0].business_id) throw new WorkflowError(qaPersonaMissingMessage(role === "installer" ? "installer_boss" : "electrician"));
  return rows[0] as typeof rows[number] & { user_id: string; business_id: string };
}

/** Only called by an explicit preparation action. Existing attributes are preserved; missing links use checked CAS/insert. */
async function addIdentityAssociations(admin: Admin, actorId: string, identity: Awaited<ReturnType<typeof qaIdentity>>, name: string, role: Role, businessId?: string, memberRole?: "business_admin" | "field_worker") {
  const { userId, email, profile } = identity;
  if (!profile) {
    checked(await admin.from("profiles").insert({ id: userId, email, full_name: name, ...(businessId ? { business_id: businessId } : {}) }), "Could not add the missing TEST profile");
  } else if (businessId && profile.business_id === null) {
    const changed = checked(await admin.from("profiles").update({ business_id: businessId }).eq("id", userId).is("business_id", null).select("id").maybeSingle(), "Could not add the missing TEST business association");
    if (!changed) throw new WorkflowError("The TEST profile changed during preparation. Review its current association.");
  } else if ((profile.business_id ?? null) !== (businessId ?? null)) throw new WorkflowError("The TEST profile has a conflicting business association.");
  if (!(await rolesFor(admin, userId, role, true))) checked(await admin.from("user_roles").insert({ user_id: userId, role }), "Could not add the missing TEST role");
  if (businessId && memberRole && !(await membership(admin, userId, businessId, memberRole, true))) {
    checked(await admin.from("business_members").insert({ business_id: businessId, user_id: userId, member_role: memberRole, active: true, added_by: actorId }), "Could not add the missing TEST membership");
  }
}

async function createMissingIdentity(admin: Admin, email: string, name: string) {
  const existing = await findQaIdentity(admin, email);
  if (existing) return { ...existing, created: false };
  const result = checked(await admin.auth.admin.createUser({ email: safeEmail(email), password: randomPassword(), email_confirm: true, user_metadata: { full_name: name, qa_test: true } }), "Could not create the missing TEST sign-in");
  if (!result.user) throw new WorkflowError("The new TEST sign-in identity was not returned.");
  return { ...await qaIdentity(admin, result.user.id, email, true), created: true };
}

type TradeSpec = { name: string; email: string; phone: string; role: "installer" | "electrician"; businessType: "eec_installer" | "rec"; cardKind: "installer" | "electrical";
  items: Array<{ code: string; description: string; category: string; unit: string; display_unit?: string; r_value?: number | null; sort: number; unit_price_ex_gst: number }> };

export async function createQaTrades(admin: Admin, actorId: string, specs: TradeSpec[]) {
  const results: Array<{ name: string; role: string; status: "created" | "already existed" }> = [];
  for (const spec of specs) {
    const existing = await findQaIdentity(admin, spec.email, true);
    if (existing) { results.push({ name: spec.name, role: spec.role, status: "already existed" }); continue; }
    // No reuse of a partial/conflicting business by name: the explicit creator cannot change an existing fixture.
    const businessBefore = checked(await admin.from("businesses").select("id").eq("name", spec.name).maybeSingle(), "Could not check the TEST business");
    if (businessBefore) throw new WorkflowError(`${spec.name} already has a business record. Review its missing account association explicitly.`);
    const identity = await createMissingIdentity(admin, spec.email, spec.name);
    if (!identity.created) { results.push({ name: spec.name, role: spec.role, status: "already existed" }); continue; }
    const now = new Date().toISOString();
    const business = checked(await admin.from("businesses").insert({ name: spec.name, legal_name: spec.name, trading_name: spec.name,
      business_type: spec.businessType, email: spec.email, phone: spec.phone, commercial_route: "hivic_full_invoice", default_comms_owner: "hivic",
      onboarding_status: "approved", is_active: true, approved_by: actorId, approved_at: now, gst_registered: true,
      onboarding_notes: `${TEST_PARTNER_MARK} Test account created from the Test Centre. Not a real partner.` }).select("id").single(), "Could not create the TEST business");
    if (!business) throw new WorkflowError("The new TEST business was not returned.");
    await addIdentityAssociations(admin, actorId, identity, spec.name, spec.role, business.id, "business_admin");
    const card = checked(await admin.from("rate_cards").insert({ kind: spec.cardKind, business_id: business.id, name: `${spec.name} agreed rates`, version: 1, is_active: true }).select("id").single(), "Could not create the new TEST rate card");
    if (!card) throw new WorkflowError("The new TEST rate card was not returned.");
    checked(await admin.from("rate_card_items").insert(spec.items.map(item => ({ ...item, rate_card_id: card.id }))), "Could not create the new TEST rate items");
    results.push({ name: spec.name, role: spec.role, status: "created" });
  }
  return { results };
}

export async function prepareQaAccess(admin: Admin, actorId: string, jobId: string) {
  const job = await requireQaJob(admin, jobId);
  const owner = checked(await admin.from("owners").select("id, user_id, full_name, email").eq("id", job.owner_id).maybeSingle(), "Could not read the TEST owner");
  if (!owner) throw new WorkflowError("The TEST owner record is missing.");
  await ownerIsolation(admin, owner.id, owner.user_id);
  // Preflight all existing associations before any preparation. Ended/blocked fixtures are never restored here.
  const trades = [];
  for (const persona of [{ email: INSTALLER_EMAIL, role: "installer" as const }, { email: ELECTRICIAN_EMAIL, role: "electrician" as const }]) {
    const identity = await findQaIdentity(admin, persona.email);
    if (!identity?.profile?.business_id) throw new WorkflowError("Create the TEST trade accounts first.");
    const businessId = identity.profile.business_id;
    await tradeIdentity(admin, identity.userId, businessId, persona.role, "business_admin");
    const prior = checked(await admin.from("job_assignments").select("id, user_id, business_id, active").eq("job_id", jobId).eq("role", persona.role), "Could not check existing TEST assignments") ?? [];
    const active = prior.filter(row => row.active);
    if (prior.length && (active.length !== 1 || active[0].user_id !== identity.userId || active[0].business_id !== businessId)) {
      throw new WorkflowError("This TEST assignment is ended or belongs to another persona. Use the normal assignment controls to change it.");
    }
    trades.push({ ...persona, identity, businessId, missing: prior.length === 0 });
  }
  const installer = trades[0];
  const ownerEmail = owner.user_id ? null : `qa.owner.${jobId}${QA_DOMAIN}`;
  const ownerIdentity = owner.user_id ? await qaIdentity(admin, owner.user_id) : await findQaIdentity(admin, ownerEmail!);
  if (ownerIdentity) {
    await ownerIsolation(admin, owner.id, ownerIdentity.userId);
    if (ownerIdentity.profile?.business_id) throw new WorkflowError("The TEST owner has a conflicting business association.");
    await rolesFor(admin, ownerIdentity.userId, "owner", !owner.user_id);
    const associated = checked(await admin.from("owners").select("id").eq("user_id", ownerIdentity.userId), "Could not verify the existing TEST owner association") ?? [];
    if (associated.some(row => row.id !== owner.id)) throw new WorkflowError("That TEST owner account is already associated with another owner record.");
  }
  const workerIdentity = await findQaIdentity(admin, WORKER_EMAIL);
  if (workerIdentity) {
    if (workerIdentity.profile?.business_id && workerIdentity.profile.business_id !== installer.businessId) throw new WorkflowError("The TEST worker belongs to another business.");
    await rolesFor(admin, workerIdentity.userId, "installer", true);
    await membership(admin, workerIdentity.userId, installer.businessId, "field_worker", true);
  }
  const worker = checked(await admin.from("partner_workers").select("id, business_id, profile_id, full_legal_name, email, trade_role, approval_status, certification_status, removed_at").eq("business_id", installer.businessId).eq("email", WORKER_EMAIL).maybeSingle(), "Could not read the existing TEST worker");
  if (worker) {
    if (!workerIdentity || worker.profile_id !== workerIdentity.userId || worker.trade_role !== "installer") throw new WorkflowError("The TEST worker has a conflicting identity association.");
    const blocker = assignBlocker(worker, [installer.businessId]);
    if (blocker) throw new WorkflowError(blocker);
    await rejectRevokedWorkerFixture(admin, jobId, worker.id);
  }
  const ownerAccount = ownerIdentity ?? await createMissingIdentity(admin, ownerEmail!, `TEST ${owner.full_name}`);
  await addIdentityAssociations(admin, actorId, ownerAccount, `TEST ${owner.full_name}`, "owner");
  if (!owner.user_id) {
    const changed = checked(await admin.from("owners").update({ user_id: ownerAccount.userId }).eq("id", owner.id).is("user_id", null).select("id").maybeSingle(), "Could not add the missing TEST owner association");
    if (!changed) throw new WorkflowError("The TEST owner association changed during preparation. Existing access was retained.");
  }
  for (const trade of trades) if (trade.missing) {
    checked(await admin.from("job_assignments").insert({ job_id: jobId, user_id: trade.identity.userId, role: trade.role, business_id: trade.businessId, active: true, assigned_by: actorId }), "Could not add the missing TEST assignment");
  }
  const workerAccount = workerIdentity ?? await createMissingIdentity(admin, WORKER_EMAIL, "TEST Alpha Field Worker");
  await addIdentityAssociations(admin, actorId, workerAccount, "TEST Alpha Field Worker", "installer", installer.businessId, "field_worker");
  if (!worker) checked(await admin.from("partner_workers").insert({ business_id: installer.businessId, profile_id: workerAccount.userId, trade_role: "installer",
    full_legal_name: "TEST Alpha Field Worker", email: WORKER_EMAIL, mobile: "0400000199", qualification: installerQualification({}),
    approval_status: "pending", certification_status: "unverified", added_by: actorId }), "Could not add the missing TEST worker");
  return { message: worker ? "Missing TEST associations prepared. Existing access and verification states were retained."
    : "Missing TEST associations prepared. The new worker still needs Office approval and certificate verification." };
}

export async function issueQaRoleAccess(admin: Admin, jobId: string, persona: "owner" | "installer_boss" | "electrician") {
  const job = await requireQaJob(admin, jobId);
  let identity: Awaited<ReturnType<typeof qaIdentity>>;
  if (persona === "owner") {
    const owner = checked(await admin.from("owners").select("user_id").eq("id", job.owner_id).maybeSingle(), "Could not read the TEST owner association");
    if (!owner?.user_id) throw new WorkflowError(qaPersonaMissingMessage("owner"));
    await ownerIsolation(admin, job.owner_id, owner.user_id);
    identity = await qaIdentity(admin, owner.user_id);
    if (identity.profile?.business_id) throw new WorkflowError("The TEST owner has a conflicting business association.");
    await rolesFor(admin, identity.userId, "owner");
  } else {
    const role = persona === "installer_boss" ? "installer" : "electrician";
    const assigned = await assignment(admin, jobId, role);
    identity = await tradeIdentity(admin, assigned.user_id, assigned.business_id, role, "business_admin");
  }
  const link = checked(await admin.auth.admin.generateLink({ type: "magiclink", email: identity.email }), "Could not issue TEST role access");
  if (link.user?.id !== identity.userId || safeEmail(link.user?.email) !== identity.email || !link.properties?.hashed_token) throw new WorkflowError("The TEST access token did not match the verified identity.");
  return { tokenHash: link.properties.hashed_token, type: "magiclink" as const, next: "/home" };
}

async function rejectRevokedWorkerFixture(admin: Admin, jobId: string, workerId: string) {
  const latest = checked(await admin.from("worker_job_links").select("id, revoked_at").eq("worker_id", workerId).eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(), "Could not check existing TEST worker access");
  if (latest?.revoked_at) throw new WorkflowError("This TEST worker link was revoked. Use the normal access controls to issue replacement access explicitly.");
}

/** New short-lived access only. Never calls the regular issuer, which revokes links and invokes Mitti. */
export async function issueQaWorkerAccess(admin: Admin, actorId: string, jobId: string) {
  await requireQaJob(admin, jobId);
  const assigned = await assignment(admin, jobId, "installer");
  await tradeIdentity(admin, assigned.user_id, assigned.business_id, "installer", "business_admin");
  const worker = checked(await admin.from("partner_workers").select("id, business_id, profile_id, email, trade_role, approval_status, certification_status, removed_at").eq("business_id", assigned.business_id).eq("email", WORKER_EMAIL).maybeSingle(), "Could not read the TEST worker");
  if (!worker?.profile_id || worker.trade_role !== "installer") throw new WorkflowError("The existing TEST worker association is missing.");
  const identity = await tradeIdentity(admin, worker.profile_id, assigned.business_id, "installer", "field_worker");
  if (identity.email !== safeEmail(worker.email)) throw new WorkflowError("The TEST worker and sign-in identities do not match.");
  const blocker = assignBlocker(worker, [assigned.business_id]);
  if (blocker) throw new WorkflowError(blocker);
  await rejectRevokedWorkerFixture(admin, jobId, worker.id);
  const token = newToken();
  const expiresAt = new Date(Date.now() + QA_WORKER_LINK_MS).toISOString();
  checked(await admin.from("worker_job_links").insert({ worker_id: worker.id, business_id: assigned.business_id, job_id: jobId,
    token_hash: await hashToken(token), created_by: actorId, expires_at: expiresAt }), "Could not issue the TEST worker link");
  return { path: `/w/${token}`, expiresAt };
}

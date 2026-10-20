import { TEST_PARTNER_MARK } from "./test-send.core";
// Test Centre: create clearly-marked fake trade accounts (3 installers + 3 electricians) with
// different agreed rate cards, so staff can run example jobs end to end. Admin-only; every record
// is prefixed "TEST" and uses a non-routable test email domain. Idempotent: re-running skips
// accounts that already exist.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WorkflowError } from "./workflow.server";

const uuid = z.string().uuid();
const QA_DOMAIN = "@hivic-test.example";
const QA_INSTALLER_EMAIL = "qa.installer.alpha@hivic-test.example";
const QA_ELECTRICIAN_EMAIL = "qa.rec.delta@hivic-test.example";
const QA_WORKER_EMAIL = "qa.worker.alpha@hivic-test.example";
/** TEST accounts sign in by magic link only; each create/reset sets a fresh random password that is never stored or shown. */
const randomPassword = () => `${crypto.randomUUID()}${crypto.randomUUID().slice(0, 20)}Aa1!`;

type RateItem = { code: string; description: string; category: string; unit: string; display_unit?: string; r_value?: number | null; sort: number; unit_price_ex_gst: number };

type Spec = {
  key: string;
  role: "installer" | "electrician";
  businessType: "eec_installer" | "rec";
  cardKind: "installer" | "electrical";
  name: string;
  email: string;
  phone: string;
  items: RateItem[];
};

const SPECS: Spec[] = [
  {
    key: "alpha", role: "installer", businessType: "eec_installer", cardKind: "installer",
    name: "TEST Alpha Insulation", email: "qa.installer.alpha@hivic-test.example", phone: "0400000101",
    items: [
      { code: "R5_BATTS", description: "R5.0 ceiling batts supply & install", category: "product", unit: "m2", r_value: 5, sort: 1, unit_price_ex_gst: 11.5 },
      { code: "BATTS_REMOVAL", description: "Batts removal and disposal", category: "removal", unit: "m2", sort: 2, unit_price_ex_gst: 4.0 },
      { code: "LOOSE_FILL_REMOVAL", description: "Loose-fill removal and disposal", category: "removal", unit: "m2", sort: 3, unit_price_ex_gst: 6.5 },
      { code: "TILE_ROOF_ACCESS", description: "Tile roof access (lift & relay tiles)", category: "access", unit: "flat", sort: 10, unit_price_ex_gst: 250 },
      { code: "CALL_OUT_MINIMUM", description: "Minimum charge / call-out", category: "travel", unit: "flat", sort: 13, unit_price_ex_gst: 150 },
    ],
  },
  {
    key: "bravo", role: "installer", businessType: "eec_installer", cardKind: "installer",
    name: "TEST Bravo Insulation", email: "qa.installer.bravo@hivic-test.example", phone: "0400000102",
    items: [
      { code: "R5_BATTS", description: "R5.0 ceiling batts supply & install", category: "product", unit: "m2", r_value: 5, sort: 1, unit_price_ex_gst: 12.9 },
      { code: "BATTS_REMOVAL", description: "Batts removal and disposal", category: "removal", unit: "m2", sort: 2, unit_price_ex_gst: 4.5 },
      { code: "LOOSE_FILL_REMOVAL", description: "Loose-fill removal and disposal", category: "removal", unit: "m2", sort: 3, unit_price_ex_gst: 7.0 },
      { code: "DIFFICULT_ACCESS", description: "Difficult / restricted ceiling access", category: "access", unit: "flat", sort: 12, unit_price_ex_gst: 300 },
    ],
  },
  {
    key: "charlie", role: "installer", businessType: "eec_installer", cardKind: "installer",
    name: "TEST Charlie Insulation", email: "qa.installer.charlie@hivic-test.example", phone: "0400000103",
    items: [
      { code: "R5_BATTS", description: "R5.0 ceiling batts supply & install", category: "product", unit: "m2", r_value: 5, sort: 1, unit_price_ex_gst: 10.75 },
      { code: "BATTS_REMOVAL", description: "Batts removal and disposal", category: "removal", unit: "m2", sort: 2, unit_price_ex_gst: 3.8 },
      { code: "LOOSE_FILL_REMOVAL", description: "Loose-fill removal and disposal", category: "removal", unit: "m2", sort: 3, unit_price_ex_gst: 6.0 },
      { code: "METAL_ROOF_ACCESS", description: "Metal sheet roof access", category: "access", unit: "flat", sort: 11, unit_price_ex_gst: 220 },
    ],
  },
  {
    key: "delta", role: "electrician", businessType: "rec", cardKind: "electrical",
    name: "TEST Delta Electrical", email: "qa.rec.delta@hivic-test.example", phone: "0400000201",
    items: [
      { code: "PIESA", description: "Pre-insulation electrical safety assessment (PIESA)", category: "electrical", unit: "flat", sort: 1, unit_price_ex_gst: 349 },
      { code: "INSTALL_ATTENDANCE", description: "Installation-day electrical attendance", category: "electrical", unit: "flat", sort: 2, unit_price_ex_gst: 180 },
      { code: "DOWNLIGHT_UPGRADE", description: "Downlight upgrade to IC-4 LED", category: "electrical", unit: "each", display_unit: "light", sort: 10, unit_price_ex_gst: 45 },
      { code: "SWITCHBOARD_UPGRADE", description: "Switchboard upgrade", category: "electrical", unit: "each", display_unit: "switchboard", sort: 11, unit_price_ex_gst: 1200 },
      { code: "RCD_INSTALL", description: "RCD installation", category: "electrical", unit: "each", display_unit: "RCD", sort: 12, unit_price_ex_gst: 220 },
      { code: "TPS_CABLE_REPLACEMENT", description: "TPS cable replacement", category: "electrical", unit: "each", display_unit: "metre", sort: 13, unit_price_ex_gst: 18 },
      { code: "EXHAUST_CLEARANCE", description: "Exhaust fan clearance guard", category: "electrical", unit: "each", display_unit: "guard", sort: 14, unit_price_ex_gst: 60 },
      { code: "COES", description: "Certificate of Electrical Safety", category: "electrical", unit: "flat", sort: 20, unit_price_ex_gst: 66 },
    ],
  },
  {
    key: "echo", role: "electrician", businessType: "rec", cardKind: "electrical",
    name: "TEST Echo Electrical", email: "qa.rec.echo@hivic-test.example", phone: "0400000202",
    items: [
      { code: "PIESA", description: "Pre-insulation electrical safety assessment (PIESA)", category: "electrical", unit: "flat", sort: 1, unit_price_ex_gst: 349 },
      { code: "INSTALL_ATTENDANCE", description: "Installation-day electrical attendance", category: "electrical", unit: "flat", sort: 2, unit_price_ex_gst: 200 },
      { code: "DOWNLIGHT_UPGRADE", description: "Downlight upgrade to IC-4 LED", category: "electrical", unit: "each", display_unit: "light", sort: 10, unit_price_ex_gst: 52 },
      { code: "SWITCHBOARD_UPGRADE", description: "Switchboard upgrade", category: "electrical", unit: "each", display_unit: "switchboard", sort: 11, unit_price_ex_gst: 1350 },
      { code: "RCD_INSTALL", description: "RCD installation", category: "electrical", unit: "each", display_unit: "RCD", sort: 12, unit_price_ex_gst: 240 },
      { code: "TPS_CABLE_REPLACEMENT", description: "TPS cable replacement", category: "electrical", unit: "each", display_unit: "metre", sort: 13, unit_price_ex_gst: 22 },
      { code: "EXHAUST_CLEARANCE", description: "Exhaust fan clearance guard", category: "electrical", unit: "each", display_unit: "guard", sort: 14, unit_price_ex_gst: 75 },
      { code: "COES", description: "Certificate of Electrical Safety", category: "electrical", unit: "flat", sort: 20, unit_price_ex_gst: 66 },
    ],
  },
  {
    key: "foxtrot", role: "electrician", businessType: "rec", cardKind: "electrical",
    name: "TEST Foxtrot Electrical", email: "qa.rec.foxtrot@hivic-test.example", phone: "0400000203",
    items: [
      { code: "PIESA", description: "Pre-insulation electrical safety assessment (PIESA)", category: "electrical", unit: "flat", sort: 1, unit_price_ex_gst: 349 },
      { code: "INSTALL_ATTENDANCE", description: "Installation-day electrical attendance", category: "electrical", unit: "flat", sort: 2, unit_price_ex_gst: 165 },
      { code: "DOWNLIGHT_UPGRADE", description: "Downlight upgrade to IC-4 LED", category: "electrical", unit: "each", display_unit: "light", sort: 10, unit_price_ex_gst: 40 },
      { code: "SWITCHBOARD_UPGRADE", description: "Switchboard upgrade", category: "electrical", unit: "each", display_unit: "switchboard", sort: 11, unit_price_ex_gst: 1100 },
      { code: "RCD_INSTALL", description: "RCD installation", category: "electrical", unit: "each", display_unit: "RCD", sort: 12, unit_price_ex_gst: 200 },
      { code: "TPS_CABLE_REPLACEMENT", description: "TPS cable replacement", category: "electrical", unit: "each", display_unit: "metre", sort: 13, unit_price_ex_gst: 15 },
      { code: "EXHAUST_CLEARANCE", description: "Exhaust fan clearance guard", category: "electrical", unit: "each", display_unit: "guard", sort: 14, unit_price_ex_gst: 55 },
      { code: "COES", description: "Certificate of Electrical Safety", category: "electrical", unit: "flat", sort: 20, unit_price_ex_gst: 66 },
    ],
  },
];

export const createTestTradeAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new WorkflowError("Admin only.");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const results: { name: string; role: string; status: "created" | "already existed" }[] = [];
    for (const spec of SPECS) {
      let uid: string;
      const { data: existingProfile } = await admin.from("profiles").select("id").eq("email", spec.email).maybeSingle();
      if (existingProfile) {
        uid = existingProfile.id; // recover a half-created account from an earlier run
        const { error: resetError } = await admin.auth.admin.updateUserById(uid, {
          password: randomPassword(),
          email_confirm: true,
          user_metadata: { full_name: spec.name, qa_test: true },
        });
        if (resetError) throw new WorkflowError(`Could not reset ${spec.name}: ${resetError.message}`);
      } else {
        const { data: user, error: userError } = await admin.auth.admin.createUser({
          email: spec.email,
          password: randomPassword(),
          email_confirm: true,
          user_metadata: { full_name: spec.name, qa_test: true },
        });
        if (userError || !user.user) throw new WorkflowError(`Could not create ${spec.name}: ${userError?.message ?? "unknown error"}`);
        uid = user.user.id;
      }
      const now = new Date().toISOString();
      let businessId: string;
      const { data: existingBiz } = await admin.from("businesses").select("id").eq("name", spec.name).maybeSingle();
      if (existingBiz) {
        businessId = existingBiz.id;
      } else {
        const { data: business, error: bizError } = await admin.from("businesses").insert({
          name: spec.name, legal_name: spec.name, trading_name: spec.name, business_type: spec.businessType,
          email: spec.email, phone: spec.phone, commercial_route: "hivic_full_invoice", default_comms_owner: "hivic",
          onboarding_status: "approved", is_active: true, approved_by: context.userId, approved_at: now,
          gst_registered: true, onboarding_notes: `${TEST_PARTNER_MARK} Test account created from the Test Centre. Not a real partner.`,
        }).select("id").single();
        if (bizError || !business) throw new WorkflowError(`Could not create business for ${spec.name}: ${bizError?.message}`);
        businessId = business.id;
      }
      const { error: profileError } = await admin.from("profiles").upsert({ id: uid, full_name: spec.name, email: spec.email, phone: spec.phone, business_id: businessId });
      if (profileError) throw new WorkflowError(`Could not create profile for ${spec.name}: ${profileError.message}`);
      const { error: roleError } = await admin.from("user_roles").upsert({ user_id: uid, role: spec.role }, { onConflict: "user_id,role" });
      if (roleError) throw new WorkflowError(`Could not assign role for ${spec.name}: ${roleError.message}`);
      const { error: memberError } = await admin.from("business_members").upsert({ business_id: businessId, user_id: uid, member_role: "business_admin", active: true, added_by: context.userId }, { onConflict: "business_id,user_id" });
      if (memberError) throw new WorkflowError(`Could not link ${spec.name}: ${memberError.message}`);
      const { data: existingCard } = await admin.from("rate_cards").select("id").eq("business_id", businessId).eq("is_active", true).maybeSingle();
      if (!existingCard) {
        const { data: card, error: cardError } = await admin.from("rate_cards").insert({ kind: spec.cardKind, business_id: businessId, name: `${spec.name} agreed rates`, version: 1, is_active: true }).select("id").single();
        if (cardError || !card) throw new WorkflowError(`Could not create rate card for ${spec.name}: ${cardError?.message}`);
        const { error: itemError } = await admin.from("rate_card_items").insert(spec.items.map((item) => ({ ...item, rate_card_id: card.id })));
        if (itemError) throw new WorkflowError(`Could not create rates for ${spec.name}: ${itemError.message}`);
      }
      results.push({ name: spec.name, role: spec.role, status: "created" });
    }
    return { results };
  });

async function requireTestAdmin(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!isAdmin) throw new WorkflowError("Admin only.");
}

async function testJob(admin: SupabaseClient<Database>, jobId: string) {
  const { data: job } = await admin.from("jobs").select("id, owner_id, source, qa_archived_at").eq("id", jobId).maybeSingle();
  if (!job || job.source !== "qa_test" || job.qa_archived_at) throw new WorkflowError("This action is only available for an active TEST journey.");
  return job;
}

async function ensureQaUser(admin: SupabaseClient<Database>, email: string, name: string) {
  const safeEmail = email.trim().toLowerCase();
  if (!safeEmail.endsWith(QA_DOMAIN)) throw new WorkflowError("TEST role accounts must use the safe test email domain.");
  const { data: existing } = await admin.from("profiles").select("id").eq("email", safeEmail).maybeSingle();
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password: randomPassword(), email_confirm: true, user_metadata: { full_name: name, qa_test: true } });
    if (error) throw new WorkflowError(`Could not reset ${name}: ${error.message}`);
    return existing.id;
  }
  const { data, error } = await admin.auth.admin.createUser({ email: safeEmail, password: randomPassword(), email_confirm: true, user_metadata: { full_name: name, qa_test: true } });
  if (error || !data.user) throw new WorkflowError(`Could not create ${name}: ${error?.message ?? "unknown error"}`);
  return data.user.id;
}

/** Prepare real, RLS-scoped TEST personas for one isolated journey. */
export const prepareQaJourneyAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireTestAdmin(context);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const job = await testJob(admin, data.jobId);
    const { data: owner } = await admin.from("owners").select("id, full_name, email").eq("id", job.owner_id).maybeSingle();
    if (!owner) throw new WorkflowError("The TEST owner record is missing.");
    const ownerEmail = `qa.owner.${data.jobId.slice(0, 8)}${QA_DOMAIN}`;
    const ownerId = await ensureQaUser(admin, ownerEmail, `TEST ${owner.full_name}`);
    await admin.from("profiles").upsert({ id: ownerId, full_name: `TEST ${owner.full_name}`, email: ownerEmail });
    await admin.from("user_roles").upsert({ user_id: ownerId, role: "owner" }, { onConflict: "user_id,role" });
    await admin.from("owners").update({ user_id: ownerId }).eq("id", owner.id);

    const personas: Array<{ key: "installer_boss" | "electrician"; email: string; role: "installer" | "electrician" }> = [
      { key: "installer_boss", email: QA_INSTALLER_EMAIL, role: "installer" },
      { key: "electrician", email: QA_ELECTRICIAN_EMAIL, role: "electrician" },
    ];
    for (const persona of personas) {
      const { data: profile } = await admin.from("profiles").select("id, business_id").eq("email", persona.email).maybeSingle();
      if (!profile?.business_id) throw new WorkflowError("Create the TEST trade accounts first.");
      await admin.from("job_assignments").update({ active: false, ended_at: new Date().toISOString(), end_reason: "Replaced by Test Centre persona" }).eq("job_id", data.jobId).eq("role", persona.role).eq("active", true);
      const { error: assignmentError } = await admin.from("job_assignments").insert({ job_id: data.jobId, user_id: profile.id, role: persona.role, business_id: profile.business_id, active: true, assigned_by: context.userId });
      if (assignmentError) throw new WorkflowError(`Could not assign the TEST ${persona.role}: ${assignmentError.message}`);
    }

    const { data: installer } = await admin.from("profiles").select("id, business_id").eq("email", QA_INSTALLER_EMAIL).maybeSingle();
    if (!installer?.business_id) throw new WorkflowError("The TEST installer account is missing.");
    const workerUserId = await ensureQaUser(admin, QA_WORKER_EMAIL, "TEST Alpha Field Worker");
    await admin.from("profiles").upsert({ id: workerUserId, full_name: "TEST Alpha Field Worker", email: QA_WORKER_EMAIL, phone: "0400000199", business_id: installer.business_id });
    await admin.from("user_roles").upsert({ user_id: workerUserId, role: "installer" }, { onConflict: "user_id,role" });
    await admin.from("business_members").upsert({ business_id: installer.business_id, user_id: workerUserId, member_role: "field_worker", active: true, added_by: context.userId }, { onConflict: "business_id,user_id" });
    const workerDetails = {
      business_id: installer.business_id, trade_role: "installer", full_legal_name: "TEST Alpha Field Worker",
      email: QA_WORKER_EMAIL, mobile: "0400000199", profile_id: workerUserId, qualification: "TEST EEC Certified installer",
      approval_status: "approved", approved_by: context.userId, approved_at: new Date().toISOString(), certification_status: "verified",
      added_by: context.userId,
    } as const;
    const { data: existingWorker } = await admin.from("partner_workers").select("id").eq("business_id", installer.business_id).eq("email", workerDetails.email).maybeSingle();
    const workerResult = existingWorker
      ? await admin.from("partner_workers").update(workerDetails).eq("id", existingWorker.id).select("id").maybeSingle()
      : await admin.from("partner_workers").insert(workerDetails).select("id").maybeSingle();
    const worker = workerResult.data;
    if (!worker) throw new WorkflowError("Could not prepare the TEST worker.");
    const { newToken, hashToken, linkExpiry } = await import("./worker-links.core");
    await admin.from("worker_job_links").update({ revoked_at: new Date().toISOString(), revoked_by: context.userId }).eq("worker_id", worker.id).eq("job_id", data.jobId).is("revoked_at", null);
    const workerToken = newToken();
    await admin.from("worker_job_links").insert({ worker_id: worker.id, business_id: installer.business_id, job_id: data.jobId, token_hash: await hashToken(workerToken), created_by: context.userId, expires_at: linkExpiry(Date.now()) });
    return { ownerEmail, installerEmail: QA_INSTALLER_EMAIL, electricianEmail: QA_ELECTRICIAN_EMAIL, workerPath: `/w/${workerToken}` };
  });

/** Create a short-lived one-time TEST login link. Never accepts an arbitrary user id. */
export const issueQaPersonaLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, persona: z.enum(["owner", "installer_boss", "electrician"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireTestAdmin(context);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const job = await testJob(admin, data.jobId);
    let email: string | null = null;
    if (data.persona === "owner") {
      const { data: owner } = await admin.from("owners").select("user_id").eq("id", job.owner_id).maybeSingle();
      if (owner?.user_id) email = (await admin.from("profiles").select("email").eq("id", owner.user_id).maybeSingle()).data?.email ?? null;
    } else {
      const role = data.persona === "installer_boss" ? "installer" : "electrician";
      const { data: assignment } = await admin.from("job_assignments").select("user_id").eq("job_id", data.jobId).eq("role", role).eq("active", true).maybeSingle();
      if (assignment?.user_id) email = (await admin.from("profiles").select("email").eq("id", assignment.user_id).maybeSingle()).data?.email ?? null;
    }
    // Sign-in only: no provisioning, password reset, membership, assignment or certification change here.
    if (!email) throw new WorkflowError((await import("./qa-role-link.core")).qaPersonaMissingMessage(data.persona));
    if (!email.endsWith(QA_DOMAIN)) throw new WorkflowError("This TEST persona is not safely isolated.");
    const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const hashedToken = link.properties?.hashed_token;
    if (error || !hashedToken) throw new WorkflowError(`Could not open the TEST role: ${error?.message ?? "missing one-time token"}`);
    return { tokenHash: hashedToken, type: "magiclink" as const, next: "/home" };
  });

export const simulateQaJourneyTime = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, simulation: z.enum(["response_24h", "response_48h", "piesa_expired"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireTestAdmin(context);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    await testJob(admin, data.jobId);
    if (data.simulation === "piesa_expired") {
      const completed = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
      const { data: changed, error } = await admin.from("piesa_records").update({ completed_date: completed }).eq("job_id", data.jobId).eq("is_current", true).select("id");
      if (error || !changed?.length) throw new WorkflowError("Add a current PIESA result before testing expiry.");
    } else {
      const hours = data.simulation === "response_24h" ? 25 : 49;
      const assignedAt = new Date(Date.now() - hours * 3_600_000).toISOString();
      const { data: changed, error } = await admin.from("job_assignments").update({ assigned_at: assignedAt, first_response_at: null, booking_confirmed_at: null }).eq("job_id", data.jobId).eq("active", true).select("id");
      if (error || !changed?.length) throw new WorkflowError("Assign a TEST trade before simulating no response.");
    }
    return { ok: true };
  });

export const archiveQaJourney = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireTestAdmin(context);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    await testJob(admin, data.jobId);
    const now = new Date().toISOString();
    await admin.from("worker_job_links").update({ revoked_at: now, revoked_by: context.userId }).eq("job_id", data.jobId).is("revoked_at", null);
    await admin.from("job_assignments").update({ active: false, ended_at: now, end_reason: "TEST journey archived" }).eq("job_id", data.jobId).eq("active", true);
    const { error } = await admin.from("jobs").update({ qa_archived_at: now, stage: "cancelled", cancelled_reason: "TEST journey archived", next_action: "Archived TEST journey" }).eq("id", data.jobId).eq("source", "qa_test");
    if (error) throw new WorkflowError(`Could not archive this TEST journey: ${error.message}`);
    return { ok: true };
  });

/** TEST journeys only: record a simulated payment for the current accepted quote so PIESA → install can be tested. Audited; never Xero. */
export const simulateQaPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reason: z.string().trim().min(5).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireTestAdmin(context);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    await testJob(admin, data.jobId);
    const { currentApprovedQuote, logEvent } = await import("./workflow.server");
    const quote = await currentApprovedQuote(data.jobId);
    if (!quote) throw new WorkflowError("The owner hasn't accepted a quote on this TEST job yet.");
    await logEvent(data.jobId, context.userId, "qa_payment_simulated", "TEST only: payment simulated (no Xero, no money)", { quote_id: quote.id, reason: data.reason }, { internal: true });
    const { autoAdvanceJob } = await import("./autoadvance.server");
    await autoAdvanceJob(data.jobId, context.userId, "qa payment simulated");
    return { ok: true };
  });

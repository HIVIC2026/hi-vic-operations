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
      { code: "PIESA", description: "Pre Insulation Electrical Safety Assessment (PIESA)", category: "electrical", unit: "flat", sort: 1, unit_price_ex_gst: 349 },
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
      { code: "PIESA", description: "Pre Insulation Electrical Safety Assessment (PIESA)", category: "electrical", unit: "flat", sort: 1, unit_price_ex_gst: 349 },
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
      { code: "PIESA", description: "Pre Insulation Electrical Safety Assessment (PIESA)", category: "electrical", unit: "flat", sort: 1, unit_price_ex_gst: 349 },
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
    await requireTestAdmin(context);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { createQaTrades } = await import("./qa-access.server");
    return createQaTrades(admin, context.userId, SPECS);
  });

async function requireTestAdmin(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const { requireQaAdmin } = await import("./qa-access.server");
  await requireQaAdmin(context);
}

/** Journey actions only (Jo 30 Oct): admin or the TEST office login; trade-account creation stays admin-only. */
async function requireTestOfficeOrAdmin(context: { supabase: SupabaseClient<Database>; userId: string }, jobId: string) {
  const { requireQaJourneyActor } = await import("./qa-access.server");
  await requireQaJourneyActor(context);
  // Review 30 Oct: the same full TEST-isolation check every other TEST office action uses (admin passes as before).
  const { requireOfficeJob } = await import("./qa-office-access.server");
  await requireOfficeJob(context.supabase, jobId);
}

async function testJob(admin: SupabaseClient<Database>, jobId: string) {
  const { requireQaJob } = await import("./qa-access.server");
  return requireQaJob(admin, jobId);
}

/** Explicit preparation only. Adds missing safe TEST associations and preserves existing access decisions. */
export const prepareQaJourneyAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireTestOfficeOrAdmin(context, data.jobId);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { prepareQaAccess } = await import("./qa-access.server");
    return prepareQaAccess(admin, context.userId, data.jobId);
  });

/** One-time sign-in for an existing, verified TEST persona; never prepares records. */
export const issueQaPersonaLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, persona: z.enum(["owner", "installer_boss", "electrician"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireTestOfficeOrAdmin(context, data.jobId);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { issueQaRoleAccess } = await import("./qa-access.server");
    return issueQaRoleAccess(admin, data.jobId, data.persona);
  });

/** Short-lived worker access only; no link revocations, fixture preparation or external form calls. */
export const issueQaWorkerLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireTestOfficeOrAdmin(context, data.jobId);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { issueQaWorkerAccess } = await import("./qa-access.server");
    return issueQaWorkerAccess(admin, context.userId, data.jobId);
  });

export const simulateQaJourneyTime = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, simulation: z.enum(["response_24h", "response_48h", "piesa_expired"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireTestOfficeOrAdmin(context, data.jobId);
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
    await requireTestOfficeOrAdmin(context, data.jobId);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    await testJob(admin, data.jobId);
    const now = new Date().toISOString();
    const { error: linkError } = await admin.from("worker_job_links").update({ revoked_at: now, revoked_by: context.userId }).eq("job_id", data.jobId).is("revoked_at", null);
    if (linkError) throw new WorkflowError(`Could not revoke TEST access: ${linkError.message}`);
    const { error: assignmentError } = await admin.from("job_assignments").update({ active: false, ended_at: now, end_reason: "TEST journey archived" }).eq("job_id", data.jobId).eq("active", true);
    if (assignmentError) throw new WorkflowError(`Could not end TEST assignments: ${assignmentError.message}`);
    const { error } = await admin.from("jobs").update({ qa_archived_at: now, stage: "cancelled", cancelled_reason: "TEST journey archived", next_action: "Archived TEST journey" }).eq("id", data.jobId).eq("source", "qa_test");
    if (error) throw new WorkflowError(`Could not archive this TEST journey: ${error.message}`);
    return { ok: true };
  });

/** TEST journeys only: record a simulated payment for the current accepted quote so PIESA → install can be tested. Audited; never Xero. */
export const simulateQaPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reason: z.string().trim().min(5).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireTestOfficeOrAdmin(context, data.jobId);
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

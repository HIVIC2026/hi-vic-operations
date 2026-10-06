// Office-only: tidy partner profile preview, review flags and test marks for onboarding applications.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, WorkflowError } from "./workflow.server";
import { approvalFlags, buildPartnerProfile } from "./partner-profile.core";
import { melbourneToday } from "@/lib/melbourne-time.core";

const uuid = z.string().uuid();

export const getPartnerProfilePreview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ applicationId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { loadProfileInputs } = await import("./partner-profile.server");
    const inputs = await loadProfileInputs(admin, data.applicationId);
    const profile = buildPartnerProfile(inputs.meta, inputs.data, inputs.cii, inputs.existingCapabilities);
    return { profile, flags: approvalFlags(profile, inputs.peers, melbourneToday()), isTest: inputs.isTest, existingBusinessId: inputs.existingBusinessId, activatedBusinessId: inputs.activatedBusinessId, approvalMessage: inputs.approvalMessage };
  });

export const markApplicationTest = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ applicationId: uuid, reason: z.string().trim().min(3).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: act } = await admin.from("partner_activations").select("id").eq("application_id", data.applicationId).maybeSingle();
    if (act) throw new WorkflowError("This application is already an approved partner and cannot be marked as a test.");
    const { error } = await admin.from("onboarding_test_marks").upsert({ application_id: data.applicationId, reason: data.reason, marked_by: context.userId }, { onConflict: "application_id", ignoreDuplicates: true });
    if (error) throw new WorkflowError("Could not mark this application as a test.");
    return { ok: true };
  });

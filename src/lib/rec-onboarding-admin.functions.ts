// Admin-only view of a signed REC onboarding record: exact signed text + short-lived certificate link.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { signFile } from "./file-links.server";

export const getRecOnboardingRecord = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r, error } = await supabaseAdmin.from("rec_onboarding_applications")
      .select("id,status,data,agreement_version,agreement_text,agreement_sha256,acknowledgements,signer_name,signer_position,signer_email,signed_at,signed_ip,signed_user_agent,insurance_certificate_path")
      .eq("id", data.id).maybeSingle();
    if (error || !r) throw new Error("Onboarding record not found.");
    let certificateUrl: string | null = null;
    if (r.insurance_certificate_path) {
      const { data: s } = await signFile("partner-files", r.insurance_certificate_path, 600);
      certificateUrl = s?.signedUrl ?? null;
    }
    const { data: activation } = await supabaseAdmin.from("partner_activations").select("business_id,rate_card_id,activated_at,override_reason").eq("application_id", r.id).maybeSingle();
    const { insurance_certificate_path: _p, ...rest } = r;
    return { ...rest, certificateUrl, activation };
  });

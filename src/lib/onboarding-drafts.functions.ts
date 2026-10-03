// Office-only read view of unsigned REC/installer onboarding drafts. Read-only: never sends, edits or exposes resume tokens.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

export const listOnboardingDrafts = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("rec_onboarding_applications")
      .select("id,partner_type,step_key,data,test_mode,created_at,updated_at,insurance_certificate_path")
      .eq("status", "draft").order("updated_at", { ascending: false }).limit(500);
    if (error) throw new Error("Unfinished sign-ups could not be loaded.");
    return (data ?? []).map((r) => {
      const d = (r.data ?? {}) as Record<string, unknown>;
      const s = (k: string) => (typeof d[k] === "string" && (d[k] as string).trim() ? (d[k] as string).trim() : null);
      return {
        id: r.id, partner_type: r.partner_type, step_key: r.step_key, test_mode: !!r.test_mode,
        created_at: r.created_at, updated_at: r.updated_at,
        business: s("trading_name") ?? s("legal_entity_name"), contact: s("primary_contact_name"),
        phone: s("business_phone"), email: s("business_email"), abn: s("abn"),
        insurance_uploaded: !!r.insurance_certificate_path,
      };
    });
  });

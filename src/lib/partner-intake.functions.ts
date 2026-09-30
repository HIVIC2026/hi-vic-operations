// Public partner onboarding form intake (installer + electrician/REC). Writes ONLY
// partner_enquiries — never a job. Mirrors the Base44 handoff: same table, same
// validation, admin-only review.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { partnerSchema, partnerRow } from "./partner.core";

async function savePartnerApplication(data: Record<string, unknown>, enquiryType: "installer" | "electrician_rec", source: string) {
  // Reuse the exact Base44 partner validation/row shape so admin review is identical.
  const parsed = partnerSchema.parse({
    ...data,
    enquiry_type: enquiryType,
    submission_id: `portal-${enquiryType}-${crypto.randomUUID()}`,
    source,
    source_created_at: new Date().toISOString(),
    source_updated_at: new Date().toISOString(),
  });
  const row = { ...partnerRow(parsed, data), source_system: "portal_form" };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("partner_enquiries").insert(row);
  if (error) throw new Error("Could not save your application. Please try again.");
  return { ok: true as const };
}

const installerFormSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().min(1).max(50),
  company: z.string().trim().min(1).max(200),
  service_areas: z.string().trim().max(2000).nullish(),
  cii_certification_status: z.string().trim().max(100).nullish(),
  cii_certification_details: z.string().trim().max(2000).nullish(),
  estimated_r5_install_rate_per_sqm_inc_gst: z.coerce.number().min(0).max(100000).nullish(),
  estimated_batts_removal_rate_per_sqm_inc_gst: z.coerce.number().min(0).max(100000).nullish(),
  estimated_loose_fill_removal_rate_per_sqm_inc_gst: z.coerce.number().min(0).max(100000).nullish(),
  free_quotes_for_hivic_leads: z.union([z.boolean(), z.enum(["yes", "no"])]).nullish()
    .transform((v) => (v == null ? null : v === true || v === "yes")),
  booking_lead_time: z.string().trim().max(200).nullish(),
  weekly_capacity: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(5000).nullish(),
});

export const submitInstallerOnboarding = createServerFn({ method: "POST" })
  .inputValidator((data) => installerFormSchema.parse(data))
  .handler(async ({ data }) => {
    // Reuse the exact Base44 partner validation/row shape so admin review is identical.
    const parsed = partnerSchema.parse({
      ...data,
      enquiry_type: "installer",
      submission_id: `portal-installer-${crypto.randomUUID()}`,
      source: "portal_installer_onboarding",
      source_created_at: new Date().toISOString(),
      source_updated_at: new Date().toISOString(),
    });
    const row = { ...partnerRow(parsed, data), source_system: "portal_form" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("partner_enquiries").insert(row);
    if (error) throw new Error("Could not save your application. Please try again.");
    return { ok: true as const };
  });

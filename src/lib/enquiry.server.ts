import { z } from "zod";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

export const enquirySchema = z.object({
  external_enquiry_id: z.string().min(1).max(100).optional(),
  full_name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(40).optional().nullable(),
  address_line: z.string().trim().min(3).max(300),
  suburb: z.string().trim().max(100).optional().nullable(),
  postcode: z.string().trim().max(10).optional().nullable(),
  occupancy: z.enum(["owner_occupied", "rental"]).optional().nullable(),
  estimated_area_m2: z.number().positive().max(5000).optional().nullable(),
  area_unknown: z.boolean().optional(),
  life_support: z.boolean().optional(),
});
export type EnquiryInput = z.infer<typeof enquirySchema>;

/** Create/update owner, property and job from an enquiry. Idempotent on external_enquiry_id. */
export type JobOrigin = { channel: "hivic_sourced" } | { channel: "installer_sourced"; businessId: string; userId: string };

export async function upsertEnquiry(input: EnquiryInput, source: string, actorId: string | null, origin: JobOrigin = { channel: "hivic_sourced" }) {
  const email = input.email.toLowerCase();
  let { data: owner } = await admin.from("owners").select("id").ilike("email", email).maybeSingle();
  if (owner) {
    await admin.from("owners").update({ full_name: input.full_name, phone: input.phone ?? null }).eq("id", owner.id);
  } else {
    const { data, error } = await admin.from("owners").insert({ full_name: input.full_name, email, phone: input.phone ?? null }).select("id").single();
    if (error) throw new Error(error.message);
    owner = data;
    // link to an existing portal account if one exists
    const { data: prof } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
    if (prof) {
      await admin.from("owners").update({ user_id: prof.id }).eq("id", owner.id);
      await admin.from("user_roles").upsert({ user_id: prof.id, role: "owner" }, { onConflict: "user_id,role" });
    }
  }

  const existingJob = input.external_enquiry_id
    ? (await admin.from("jobs").select("id, property_id").eq("external_enquiry_id", input.external_enquiry_id).maybeSingle()).data
    : null;

  const propFields = { owner_id: owner!.id, address_line: input.address_line, suburb: input.suburb ?? null, postcode: input.postcode ?? null, occupancy: input.occupancy ?? null };
  const jobFields = {
    estimated_area_m2: input.area_unknown ? null : input.estimated_area_m2 ?? null,
    estimated_area_unknown: input.area_unknown ?? input.estimated_area_m2 == null,
    life_support: input.life_support ?? false,
  };

  if (existingJob) {
    await admin.from("properties").update(propFields).eq("id", existingJob.property_id);
    await admin.from("jobs").update(jobFields).eq("id", existingJob.id);
    await logEvent(existingJob.id, actorId, "enquiry_updated", `Enquiry updated from ${source}`);
    return { job_id: existingJob.id, created: false };
  }
  const { data: prop, error: pe } = await admin.from("properties").insert(propFields).select("id").single();
  if (pe) throw new Error(pe.message);
  const { data: job, error: je } = await admin
    .from("jobs")
    .insert({
      ...jobFields, property_id: prop.id, owner_id: owner!.id, source, external_enquiry_id: input.external_enquiry_id ?? null, next_action: "Review eligibility",
      business_unit: "hivic", // explicit: this portal only creates Home Insulation Victoria jobs
      channel: origin.channel,
      ...(origin.channel === "installer_sourced"
        ? { originating_installer_business_id: origin.businessId, originating_installer_user_id: origin.userId, commercial_model: "not_configured" as const }
        : {}),
    })
    .select("id, job_number")
    .single();
  if (je) throw new Error(je.message);
  await logEvent(job.id, actorId, "enquiry_received", `Enquiry received (${source})`, {}, { to: "new_enquiry" });
  await logEvent(job.id, actorId, "job_source_recorded",
    origin.channel === "installer_sourced" ? "Job source: Installer-sourced (attribution locked)" : "Job source: HI VIC-sourced",
    origin.channel === "installer_sourced" ? { channel: origin.channel, originating_installer_business_id: origin.businessId, originating_installer_user_id: origin.userId, commercial_model: "not_configured" } : { channel: origin.channel });
  return { job_id: job.id, job_number: job.job_number, created: true };
}

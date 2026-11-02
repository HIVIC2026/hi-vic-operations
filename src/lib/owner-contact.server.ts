// Reads the business (office) contact for a job's active installer or electrician. Never profiles or workers.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { businessContactFromRow, type BusinessContact } from "./owner-wording.core";

export async function businessContactForJob(jobId: string, role: "installer" | "electrician"): Promise<BusinessContact | null> {
  const { data: a } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", role).eq("active", true).maybeSingle();
  if (!a?.business_id) return null;
  const { data: b } = await admin.from("businesses").select("name, trading_name, phone, email").eq("id", a.business_id).maybeSingle();
  return businessContactFromRow(b);
}

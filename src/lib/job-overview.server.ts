// The job overview read behind `getJobOverview` (admin-records.functions) and the installer job bundle
// (trade-job-bundle.server). One body, called from both: the role check, the trade contact rule and the office
// cancelled-reason read are exactly the ones the server function has always applied.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireJobRole } from "./workflow.server";
import type { JobRole } from "./workflow";
import { overviewForViewer } from "./crew-no-price.core";

type Sb = SupabaseClient<Database>;

/** The overview row the caller may see, plus the role `my_job_role` gave them (the bundle seeds the page's role from it). */
export async function jobOverviewFor(sb: Sb, userId: string, jobId: string) {
  const role: JobRole = await requireJobRole(sb, jobId, ["admin", "owner", "electrician", "installer"]);
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await admin.from("job_overview").select("*").eq("id", jobId).maybeSingle();
  if (error) throw new Error(`Job could not be loaded: ${error.message}`);
  if (!row) throw new Error("Job not found or no longer available.");
  if (role === "electrician" || role === "installer") {
    // Trades see owner name/contact/exact address only while their own visit is current (SQL has_contact_release),
    // or on a partner-supplied job their own business originated.
    const { data: rel } = await admin.rpc("has_contact_release", { _job: jobId, _user: userId });
    let own = false;
    if (!rel && row.channel === "installer_sourced") {
      const { data: j } = await admin.from("jobs").select("originating_installer_business_id").eq("id", jobId).maybeSingle();
      const { data: m } = j?.originating_installer_business_id ? await admin.from("business_members").select("user_id").eq("business_id", j.originating_installer_business_id).eq("user_id", userId).maybeSingle() : { data: null };
      own = !!m;
    }
    // Jo 28 Oct 2026: installer crew never see a price — next_action / hold_reason can hold one (e.g. the repeat PIESA).
    const shown = role === "installer" ? overviewForViewer(row, (await (await import("./trade-view.server")).tradeContext(userId))?.boss === true) : row;
    if (!rel && !own) {
      const { data: p } = await admin.from("properties").select("suburb, postcode").eq("id", row.property_id!).maybeSingle();
      return { role, row: { ...shown, owner_name: null, owner_phone: null, owner_email: null, property_address: [p?.suburb, p?.postcode].filter(Boolean).join(" ") || "Address shared once the visit is arranged" } };
    }
    return { role, row: shown };
  }
  if (role === "admin" && row.stage === "cancelled") {
    const { data: c } = await admin.from("jobs").select("cancelled_reason").eq("id", jobId).maybeSingle();
    return { role, row: { ...row, cancelled_reason: c?.cancelled_reason ?? null } };
  }
  return { role, row };
}

// The job overview read behind `getJobOverview` (admin-records.functions) and the installer job bundle
// (trade-job-bundle.server). One body, called from both: the role check, the trade contact rule and the office
// cancelled-reason read are exactly the ones the server function has always applied.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireJobRole } from "./workflow.server";
import type { JobRole } from "./workflow";
import { contactVisible } from "./trade-view.core";

type Sb = SupabaseClient<Database>;

/** The overview row the caller may see, plus the role `my_job_role` gave them (the bundle seeds the page's role from it). */
export async function jobOverviewFor(sb: Sb, userId: string, jobId: string) {
  const role: JobRole = await requireJobRole(sb, jobId, ["admin", "owner", "electrician", "installer"]);
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: originalRow, error } = await admin.from("job_overview").select("*").eq("id", jobId).maybeSingle();
  if (error) throw new Error(`Job could not be loaded: ${error.message}`);
  if (!originalRow) throw new Error("Job not found or no longer available.");
  const dispatch = await (await import("./in-house-suppression.server")).inHouseDispatchSkip(jobId);
  const row = { ...originalRow, inHouseDispatch: dispatch };
  if (role === "electrician" || role === "installer") {
    // Trades see owner name/contact/exact address only while their own visit is current (SQL has_contact_release),
    // or on a partner-supplied job their own business originated.
    const { data: rel } = await admin.rpc("has_contact_release", { _job: jobId, _user: userId });
    let own = false;
    if (row.channel === "installer_sourced") {
      const { data: j } = await admin.from("jobs").select("originating_installer_business_id").eq("id", jobId).maybeSingle();
      const { data: m } = j?.originating_installer_business_id ? await admin.from("business_members").select("user_id").eq("business_id", j.originating_installer_business_id).eq("user_id", userId).maybeSingle() : { data: null };
      own = !!m;
    }
    if (!rel && !own) {
      const { data: p } = await admin.from("properties").select("suburb, postcode").eq("id", row.property_id!).maybeSingle();
      return { role, row: { ...row, owner_name: null, owner_phone: null, owner_email: null, property_address: [p?.suburb, p?.postcode].filter(Boolean).join(" ") || "Address shared once the visit is arranged" } };
    }
    if (role === "electrician" && rel && !own) {
      // C3 is electrician-only: installers keep the phone. Their own originated customer keeps the phone (skipped above). Same visit-current rule as the trade pages (contactVisible over this business's own bookings): no phone once every visit is done.
      let visible = false;
      try {
        const { requireTradeJob } = await import("./trade-view.server");
        const c = await requireTradeJob(userId, jobId);
        const { data: mine, error: mineErr } = await admin.from("bookings").select("status").eq("job_id", jobId).eq("business_id", c.biz.id);
        if (mineErr) console.error("jobOverviewFor: own bookings read failed", mineErr.code ?? "unknown");
        else visible = contactVisible(mine ?? []);
      } catch { visible = false; }
      if (!visible) return { role, row: { ...row, owner_phone: null } };
    }
  }
  if (role === "admin" && row.stage === "cancelled") {
    const { data: c } = await admin.from("jobs").select("cancelled_reason").eq("id", jobId).maybeSingle();
    return { role, row: { ...row, cancelled_reason: c?.cancelled_reason ?? null } };
  }
  return { role, row };
}

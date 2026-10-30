// The job overview read behind `getJobOverview` (admin-records.functions) and the installer job bundle
// (trade-job-bundle.server). One body, called from both: the role check, the trade contact rule and the office
// cancelled-reason read are exactly the ones the server function has always applied.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireJobRole } from "./workflow.server";
import type { JobRole } from "./workflow";
import { contactVisible } from "./trade-view.core";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { inHouseDispatchSkip } from "./in-house-suppression.server";
import { early } from "./early-read";

type Sb = SupabaseClient<Database>;

/** The overview row the caller may see, plus the role `my_job_role` gave them (the bundle seeds the page's role from it). */
export async function jobOverviewFor(sb: Sb, userId: string, jobId: string) {
  // Speed (installer screens, Task 6): the role check and every read that needs only the job id start together (two
  // rounds, not seven). Nothing read here is used, shaped or returned until the role check has passed, and its refusal
  // wins. The originating business, the contact release and the hidden-address read are the trade-only facts below.
  const roleP = early((async () => await requireJobRole(sb, jobId, ["admin", "owner", "electrician", "installer"]))());
  const rowP = early(admin.from("job_overview").select("*").eq("id", jobId).maybeSingle());
  const dispatchP = early(inHouseDispatchSkip(jobId));
  const relP = early(admin.rpc("has_contact_release", { _job: jobId, _user: userId }));
  // One jobs read serves both the originating business (trade) and the cancel reason (office).
  const jobP = early(admin.from("jobs").select("originating_installer_business_id, cancelled_reason").eq("id", jobId).maybeSingle());
  const memberP = early(jobP.then(async ({ data: j }) => j?.originating_installer_business_id ? await admin.from("business_members").select("user_id").eq("business_id", j.originating_installer_business_id).eq("user_id", userId).maybeSingle() : { data: null }));
  // Without a contact release the trade sees only the suburb: that read follows the row and the release check.
  const propsP = early(Promise.all([rowP, relP]).then(async ([{ data: r }, { data: rel }]) => !rel && r?.property_id ? await admin.from("properties").select("suburb, postcode").eq("id", r.property_id).maybeSingle() : { data: null }));
  const role: JobRole = await roleP;
  const { data: originalRow, error } = await rowP;
  if (error) throw new Error(`Job could not be loaded: ${error.message}`);
  if (!originalRow) throw new Error("Job not found or no longer available.");
  const dispatch = await dispatchP;
  const row = { ...originalRow, inHouseDispatch: dispatch };
  if (role === "electrician" || role === "installer") {
    const { data: rel } = await relP;
    let own = false;
    if (row.channel === "installer_sourced") {
      const { data: m } = await memberP;
      own = !!m;
    }
    if (!rel && !own) {
      const { data: p } = await propsP;
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
    const { data: c } = await jobP;
    return { role, row: { ...row, cancelled_reason: c?.cancelled_reason ?? null } };
  }
  return { role, row };
}

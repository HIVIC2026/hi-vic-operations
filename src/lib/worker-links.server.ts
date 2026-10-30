// Staff job links read behind `jobWorkerLinks` (worker-links.functions) and the installer job bundle
// (trade-job-bundle.server). One body, called from both; the office / own-business scoping is unchanged.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { myBusinesses } from "./pilot.server";
import { assignBlocker, linkState } from "./worker-links.core";
import { early } from "./early-read";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

type Sb = Pick<SupabaseClient<Database>, "rpc">;

export const WORKER_COLS = "id, business_id, full_legal_name, email, mobile, trade_role, licence_number, qualification, approval_status, approved_at, rejection_reason, removed_at, created_at, certification_status, certification, worker_role, profile_id";

export async function isAdminCaller(sb: Sb) {
  const { data } = await sb.rpc("is_admin");
  return data === true;
}

/** Businesses with an active assignment on the job. */
export async function jobBusinesses(jobId: string) {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("active", true).not("business_id", "is", null);
  return [...new Set((data ?? []).map((r) => r.business_id!))];
}

/** Office: every assigned business's staff and links; a trade: only their own business's, and only while assigned. */
export async function workerLinksFor(sb: Sb, userId: string, jobId: string) {
  // Speed (installer screens, Task 6): the office check, the job's businesses, the caller's own businesses and the Mitti
  // flag need only the caller and the job — one round. The caller's businesses are used (and their read errors raised)
  // only for a trade, exactly as before.
  const officeP = early(isAdminCaller(sb));
  const assignedP = early(jobBusinesses(jobId));
  const myP = early(myBusinesses(userId));
  const mevP = early(admin.from("workflow_events").select("event_type, summary").eq("job_id", jobId).in("event_type", ["mitti_access_needed", "mitti_audit_created", "mitti_audit_reshared"]).order("created_at", { ascending: false }).limit(1).maybeSingle());
  const office = await officeP;
  const assigned = await assignedP;
  const mine = office ? assigned : [...(await myP).keys()].filter((b) => assigned.includes(b));
  if (!office && !mine.length) return { workers: [], links: [], assignedBusinesses: 0 };
  const none = ["00000000-0000-0000-0000-000000000000"];
  const [{ data: workers }, { data: links }] = await Promise.all([
    admin.from("partner_workers").select(`${WORKER_COLS}, businesses(name)`).in("business_id", mine.length ? mine : none).is("removed_at", null),
    admin.from("worker_job_links").select("id, worker_id, business_id, created_at, expires_at, revoked_at, last_opened_at, open_count, partner_workers(full_legal_name, trade_role)").eq("job_id", jobId).in("business_id", mine.length ? mine : none).order("created_at", { ascending: false }),
  ]);
  const now = Date.now();
  // Office flag: last automatic Mitti attempt needs attention (cleared once a form is created/re-shared).
  const { data: mev } = await mevP;
  return {
    mittiFlag: office && mev?.event_type === "mitti_access_needed" ? mev.summary : null,
    assignedBusinesses: assigned.length,
    workers: (workers ?? []).map((w) => ({ ...w, blocker: assignBlocker(w, assigned) })),
    links: (links ?? []).map((l) => ({ ...l, state: linkState(l, now) })),
  };
}

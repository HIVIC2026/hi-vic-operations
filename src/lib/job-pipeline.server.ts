// Server-only reads behind the job LIST pages. Split out of portal.functions.ts so the service-role
// client is reached exclusively through a dynamic import inside a server-function handler, and so the
// paged loader can enrich only the rows on the current page.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { JOB_LIST_COLUMNS } from "./job-list-columns";

/** The raw job_overview read every job LIST shares; filter, search, sort and paging build on top. */
export const jobOverview = (count?: "exact") =>
  admin.from("office_job_list" as "job_overview").select(JOB_LIST_COLUMNS, count ? { count } : undefined);
export type JobOverviewRow = NonNullable<Awaited<ReturnType<typeof jobOverview>>["data"]>[number];

/** Office-archived TEST journeys never appear on a board. Tiny list, read once per board load. */
export async function archivedQaJobIds(): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("jobs").select("id").not("qa_archived_at", "is", null).order("id").range(from, from + 999);
    if (error) throw new Error(`Archived TEST jobs could not be read: ${error.message}`);
    out.push(...(data ?? []).map((r) => r.id));
    if (!data || data.length < 1000) return out;
  }
}

/**
 * Card enrichment shared by the full pipeline read and the server-paginated job list. It reads ONLY
 * the rows it is handed, so a 20-row page never touches the rest of the board.
 */
export async function enrichPipeline(base: JobOverviewRow[]) {
  const { LAUNCH_CAMPAIGN } = await import("./launch-campaign.core");
  const { enquiryStatus } = await import("./enquiry-groups.core");
  const { stuckReasons } = await import("./stuck.core");
  const { commsStatus } = await import("./comms-status.core");
  const ids = base.map((j) => j.id).filter((id): id is string => !!id);
  // Never send an empty `.in()`: PostgREST treats it as a syntax error, so query a non-existent id.
  const NONE = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
  const msgIds: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) msgIds.push(ids.slice(i, i + 100));
  const SENT_STATUSES = ["sent", "delivered_unrecorded", "sending"];
  // Independent reads run together; every one of them is scoped to the rows we were given.
  const [
    { data: inv },
    { data: rc },
    { data: bk },
    { data: asg },
    { data: ests },
    { data: mediaDocs },
    { data: intakeEvidence },
    { data: campRows },
    { data: sendRows },
    { data: facts },
    msgParts,
  ] = await Promise.all([
    admin.from("invoices").select("job_id,last_sync_error").in("job_id", NONE).not("last_sync_error", "is", null),
    admin.from("ready_check_payments").select("job_id,status,paid_at").in("job_id", NONE),
    admin.from("bookings").select("job_id,kind,scheduled_start").in("job_id", NONE).eq("status", "confirmed"),
    admin.from("job_assignments").select("job_id,user_id,assigned_at,active").in("job_id", NONE).eq("active", true),
    admin.from("indicative_estimates").select("job_id,area_m2,area_source,insulation_declared").in("job_id", NONE).eq("status", "current"),
    admin.from("documents").select("job_id").in("job_id", NONE).eq("kind", "intake_media"),
    admin.from("evidence_files").select("job_id,storage_path,mime_type").in("job_id", NONE).like("storage_path", "%/intake/%"),
    admin.from("lead_campaign_responses").select("job_id,spot_saved_at,opted_out_at").in("job_id", NONE),
    // The send log is filtered to the three purposes the office status actually reads (was: every send row).
    admin
      .from("customer_email_sends")
      .select("job_id,purpose,status,idempotency_key")
      .in("job_id", NONE)
      .in("purpose", [LAUNCH_CAMPAIGN, "preliminary_ineligible", "insulation_video_request"]),
    admin
      .from("jobs")
      .select("id, installer_quoted, installer_site_check, installer_site_check_date, installer_quoted_price_inc_gst, installer_price_includes")
      .in("id", NONE)
      .eq("channel", "installer_sourced"),
    // commsStatus() returns null for jobs with no active trade assignment, so messages for those jobs
    // are never read. Fetch messages only for the jobs on this page (was: every message row).
    Promise.all(
      msgIds.map((chunk) => admin.from("messages").select("job_id,sender_id,created_at,internal").in("job_id", chunk)),
    ),
  ]);
  const msgs = msgParts.flatMap(
    (r) => (r.data ?? []) as { job_id: string; sender_id: string | null; created_at: string; internal: boolean | null }[],
  );
  const savedSet = new Set((campRows ?? []).filter((c) => c.spot_saved_at && !c.opted_out_at).map((c) => c.job_id));
  const sendsByJob = new Map<string, { purpose: string; status: string; key: string | null }[]>();
  for (const s of sendRows ?? []) {
    const a = sendsByJob.get(s.job_id);
    const row = { purpose: s.purpose as string, status: s.status as string, key: (s.idempotency_key as string | null) ?? null };
    if (a) a.push(row); else sendsByJob.set(s.job_id, [row]);
  }
  const estBy = new Map((ests ?? []).map((e) => [e.job_id, e]));
  const mediaBy = new Map<string, number>();
  for (const d of mediaDocs ?? []) if (d.job_id) mediaBy.set(d.job_id, (mediaBy.get(d.job_id) ?? 0) + 1);
  for (const f of intakeEvidence ?? []) {
    if (!f.job_id || !f.storage_path) continue;
    if (/^(image|video)\//i.test(f.mime_type ?? "") && f.storage_path.startsWith(`${f.job_id}/intake/`)) {
      mediaBy.set(f.job_id, (mediaBy.get(f.job_id) ?? 0) + 1);
    }
  }
  // null (not 0) when the media read failed, so the card can say "not checked" instead of claiming "no media".
  const mediaKnown = mediaDocs !== null;
  const now = new Date();
  // Installer-sourced jobs: site check done? and the installer's own price (Jo, 7 Oct).
  const factBy = new Map((facts ?? []).map((f) => [f.id, { quoted: f.installer_quoted as "yes" | "no" | null, site_check: (f.installer_site_check as "yes" | "no" | null), site_check_date: f.installer_site_check_date, quoted_price_inc_gst: f.installer_quoted_price_inc_gst == null ? null : Number(f.installer_quoted_price_inc_gst), price_includes: f.installer_price_includes }]));
  // Group per-job rows ONCE (O(rows)) so building the list is O(jobs), not O(jobs × rows).
  const groupByJob = <T extends { job_id: string }>(arr: T[] | null): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const r of arr ?? []) { const a = m.get(r.job_id); if (a) a.push(r); else m.set(r.job_id, [r]); }
    return m;
  };
  const invBy = groupByJob(inv), rcBy = groupByJob(rc), bkBy = groupByJob(bk), asgBy = groupByJob(asg), msgBy = groupByJob(msgs);
  return base.filter((j) => j.id != null).map((j) => {
    const id = j.id!;
    const pays = rcBy.get(id) ?? [];
    const paid = pays.find((p) => p.status === "paid");
    const est = estBy.get(id);
    const declared = est?.insulation_declared;
    return {
      ...j,
      installer_facts: factBy.get(id) ?? null,
      enquiry_facts: {
        ceilingM2: est?.area_m2 == null ? null : Number(est.area_m2),
        ceilingAssumed: est?.area_source === "typical_default",
        insulation: declared === "none" || declared === "present" || declared === "unknown" ? (declared as "none" | "present" | "unknown") : null,
        mediaCount: mediaKnown ? mediaBy.get(id) ?? 0 : null,
      },
      comms_status: commsStatus(asgBy.get(id) ?? [], msgBy.get(id) ?? [], new Date()),
      office_status: (() => {
        const sent = (sendsByJob.get(id) ?? []).filter((s) => SENT_STATUSES.includes(s.status));
        const campSent = sent.filter((s) => s.purpose === LAUNCH_CAMPAIGN);
        return enquiryStatus({
          spotSaved: savedSet.has(id),
          ineligible: j.eligibility_outcome === "does_not_appear_eligible" || j.stage === "on_hold",
          ineligibleEmailSent: sent.some((s) => s.purpose === "preliminary_ineligible"),
          campaignSent: campSent.length > 0,
          insulationEmailSent: sent.some((s) => s.purpose === "insulation_video_request"),
          campaignGroup: campSent.length ? (campSent.some((s) => /:b(:|$)/.test(s.key ?? "")) ? "onsite" : "likely") : null,
        });
      })(),
      stuck_reasons: stuckReasons({
        stage: j.stage,
        lastActivityAt: j.last_activity_at,
        invoiceSyncErrors: (invBy.get(id) ?? []).map((i) => i.last_sync_error as string),
        readyCheckFailed: !paid && pays.some((p) => p.status === "failed"),
        readyCheckPaidAt: paid?.paid_at ?? null,
        confirmedBookings: bkBy.get(id) ?? [],
      }, now),
    };
  });
}

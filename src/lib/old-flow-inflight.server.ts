// Part 3 Task 18 + Part 4 Task 14: REAL jobs still at an old step (pre-acceptance and after-acceptance), optionally for
// one installer. READ-ONLY (selects only). Shared by scripts/old-flow-inflight-count.ts and the new-flow move check.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import {
  OLD_FLOW_STEPS_P3, OLD_FLOW_STEPS_P4, RUN_SLOT_END_EVENTS, jobsApprovingFixesQuote, jobsConfirmingRunWindow, jobsPickingFixesTime, jobsPickingInstallDays,
  jobsPickingPiesaTimes, jobsPickingReadyCheckTimes, jobsWithElectricianOfferOpen,
} from "./old-flow-steps.core";
import { READY_CHECK_TIME_NOTE } from "./ready-check-times.core";

const PAGE = 1000;
async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[]; out.push(...page);
    if (page.length < PAGE) return out;
  }
}

export type OldStepJobs = { step: string; count: number; jobNumbers: string[] };

/** One row per old step (Part 3 pre-acceptance steps first, then the Part 4 after-acceptance ones). With a businessId,
 *  only jobs that installer is assigned to (or started). Errors throw (fail closed). */
export async function oldStepJobs(businessId?: string, now = new Date()): Promise<OldStepJobs[]> {
  const nowIso = now.toISOString();
  const times = await all<{ job_id: string; status: string; starts_at: string }>((a, b) =>
    admin.from("appointment_proposals").select("job_id, status, starts_at").eq("kind", "ready_check").eq("note", READY_CHECK_TIME_NOTE).eq("status", "proposed").gt("starts_at", nowIso).range(a, b));
  const slots = await all<{ job_id: string; event_type: string; created_at: string }>((a, b) =>
    admin.from("workflow_events").select("job_id, event_type, created_at").in("event_type", ["run_slot_proposed", ...RUN_SLOT_END_EVENTS]).order("created_at", { ascending: true }).range(a, b));
  // Part 4: electrician offers, electrician-offered safety check times, issued fixes quotes, fixes windows, installer-offered install days.
  const offers = await all<{ job_id: string; status: string; expires_at: string | null }>((a, b) =>
    admin.from("partner_offers").select("job_id, status, expires_at").eq("kind", "piesa").eq("status", "pending").range(a, b));
  const piesaTimes = await all<{ job_id: string; proposer_role: string | null; status: string; starts_at: string; piesa_window_round: number | null; electrician_window: boolean | null; install_day: boolean | null }>((a, b) =>
    admin.from("appointment_proposals").select("job_id, proposer_role, status, starts_at, piesa_window_round, electrician_window, install_day").eq("kind", "assessment").eq("status", "proposed").gt("starts_at", nowIso).range(a, b));
  const fixesQuotes = await all<{ job_id: string; kind: string; status: string }>((a, b) =>
    admin.from("quotes").select("job_id, kind, status").eq("kind", "rectification").eq("status", "issued").range(a, b));
  const fixesWindows = await all<{ job_id: string; status: string; starts_at: string }>((a, b) =>
    admin.from("appointment_proposals").select("job_id, status, starts_at").eq("kind", "rectification").eq("electrician_window", true).eq("status", "proposed").gt("starts_at", nowIso).range(a, b));
  const installDays = await all<{ job_id: string; proposer_role: string | null; status: string; starts_at: string }>((a, b) =>
    admin.from("appointment_proposals").select("job_id, proposer_role, status, starts_at").eq("install_day", true).eq("status", "proposed").gt("starts_at", nowIso).range(a, b));
  const byStep: Record<string, string[]> = {
    "owner picking Ready Check times": jobsPickingReadyCheckTimes(times, now),
    "owner confirming a run window": jobsConfirmingRunWindow(slots),
    "electrician offer open": jobsWithElectricianOfferOpen(offers, now),
    "owner picking safety check times": jobsPickingPiesaTimes(piesaTimes, now),
    "owner approving an electrical fixes quote": jobsApprovingFixesQuote(fixesQuotes),
    "owner picking a fixes time": jobsPickingFixesTime(fixesWindows, now),
    "owner picking install days": jobsPickingInstallDays(installDays, now),
  };
  const candidates = [...new Set(Object.values(byStep).flat())];
  const real = new Map<string, string>();
  for (let i = 0; i < candidates.length; i += 200) {
    const ids = candidates.slice(i, i + 200);
    const { data, error } = await admin.from("jobs").select("id, job_number, source, stage, deleted_at, originating_installer_business_id").in("id", ids);
    if (error) throw new Error(`Could not read jobs: ${error.message}`);
    let mine: Set<string> | null = null;
    if (businessId) {
      const { data: asg, error: ae } = await admin.from("job_assignments").select("job_id").in("job_id", ids).eq("role", "installer").eq("active", true).eq("business_id", businessId);
      if (ae) throw new Error(`Could not read installer assignments: ${ae.message}`);
      mine = new Set((asg ?? []).map((a) => a.job_id));
    }
    for (const j of data ?? []) {
      if (j.deleted_at || j.source === "qa_test" || ["cancelled", "complete"].includes(String(j.stage))) continue;
      if (mine && !mine.has(j.id) && j.originating_installer_business_id !== businessId) continue;
      real.set(j.id, String(j.job_number ?? j.id));
    }
  }
  return [...OLD_FLOW_STEPS_P3, ...OLD_FLOW_STEPS_P4].map((s) => {
    const jobs = (byStep[s.step] ?? []).filter((id) => real.has(id));
    return { step: s.step, count: jobs.length, jobNumbers: jobs.map((id) => real.get(id)!) };
  });
}

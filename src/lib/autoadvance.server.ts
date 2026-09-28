// ONE authoritative auto-progression entry point. Uses transition() + stageEntryBlockers() only; never
// calls Xero or Mitti — it evaluates portal state already stored.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { assignmentStatus, getStage, stageEntryBlockers, transition, depositCleared, WorkflowError } from "./workflow.server";
import { generateInstallerQuotes } from "./quotes.server";
import { runAutoAdvance, type AdvanceFacts, type AdvanceResult } from "./autoadvance.core";

async function count(q: PromiseLike<{ count: number | null }>) { return (await q).count ?? 0; }

export async function loadAdvanceFacts(jobId: string): Promise<AdvanceFacts> {
  const head = { count: "exact" as const, head: true };
  const [{ data: job }, st] = await Promise.all([
    admin.from("jobs").select("eligibility_outcome, eligibility_set_by, eligibility_decision_source, installation_completed_at").eq("id", jobId).single(),
    assignmentStatus(jobId),
  ]);
  const q = (kind: "installation" | "rectification", status: "issued" | "accepted") => count(admin.from("quotes").select("id", head).eq("job_id", jobId).eq("kind", kind).eq("status", status));
  const booking = (kind: "assessment" | "rectification" | "installation") => count(admin.from("bookings").select("id", head).eq("job_id", jobId).eq("kind", kind).eq("status", "confirmed"));
  const [elec, rect, rqi, rqa, iqi, iqa, inv, ab, rb, ib, veec] = await Promise.all([
    count(admin.from("job_assignments").select("id", head).eq("job_id", jobId).eq("role", "electrician").eq("active", true)),
    count(admin.from("rectification_items").select("id", head).eq("job_id", jobId).eq("status", "required")),
    q("rectification", "issued"), q("rectification", "accepted"), q("installation", "issued"), q("installation", "accepted"),
    count(admin.from("invoices").select("id", head).eq("job_id", jobId).eq("kind", "installation")),
    booking("assessment"), booking("rectification"), booking("installation"),
    count(admin.from("veec_lodgements").select("id", head).eq("job_id", jobId).in("status", ["submitted", "approved"])),
  ]);
  return {
    eligibilityConfirmed: (!!job?.eligibility_set_by || job?.eligibility_decision_source === "system" || job?.eligibility_decision_source === "admin") && !!job?.eligibility_outcome && job.eligibility_outcome !== "does_not_appear_eligible",
    electricianAssigned: elec > 0,
    assessmentBookingConfirmed: ab > 0,
    openRectItems: rect,
    rectQuoteIssued: rqi > 0,
    rectQuoteAccepted: rqa > 0,
    installQuotesIssued: iqi > 0,
    installQuoteAccepted: iqa > 0,
    consumerSigned: !!st && st !== "draft",
    invoiceExists: inv > 0,
    depositCleared: await depositCleared(jobId),
    rectBookingConfirmed: rb > 0,
    installBookingConfirmed: ib > 0,
    installationCompleted: !!job?.installation_completed_at,
    installerDeclarationSigned: ["installer_signed_pending_install", "final_details_pending", "effective_complete"].includes(st ?? ""),
    veecLodged: veec > 0,
  };
}

/** Never throws for workflow reasons: a job that can't advance simply stays where it is with its blockers visible. */
export async function autoAdvanceJob(jobId: string, actorId: string | null, _reason: string, opts: { allowApPromotion?: boolean } = {}): Promise<AdvanceResult | null> {
  try {
    const { autoDecideEligibility } = await import("./eligibility.server");
    await autoDecideEligibility(jobId);
    return await runAutoAdvance({
      getStage: () => getStage(jobId),
      facts: () => loadAdvanceFacts(jobId),
      blockers: (to) => stageEntryBlockers(jobId, to),
      transition: (to, summary) => transition(jobId, to, actorId, summary, { auto: true }),
      completeSite: async () => {
        const { advanceSiteRequirements } = await import("./requirements.server");
        const pre = await stageEntryBlockers(jobId, "assessment_complete");
        if (pre.length) return false;
        return (await advanceSiteRequirements(jobId, actorId as string)).advanced;
      },
      generateQuotes: () => generateInstallerQuotes(jobId, actorId as string).then(() => undefined),
    }, opts);
  } catch (e) {
    if (e instanceof WorkflowError) return null;
    throw e;
  }
}

/** Sweep open jobs (portal state only). */
export async function autoAdvanceOpenJobs(actorId: string) {
  const { data } = await admin.from("jobs").select("id").not("stage", "in", "(complete,cancelled,on_hold,ap_review)");
  let moved = 0;
  for (const j of data ?? []) {
    const r = await autoAdvanceJob(j.id, actorId, "pipeline sweep");
    if (r?.steps.length) moved++;
  }
  return { checked: data?.length ?? 0, moved };
}

// Fix wave J5 (J3+J4 review (1), 4 Nov 2026): the automatic PIESA completion must not complete a safety check form that is
// still with a DIFFERENT electrician. Two facts, both from portal records (no Mitti call):
//  - the person the A3 was last handed to (the newest `mitti_audit_reshared` for that form, else the assignee it was created
//    for) must be the job's active electrician (in-house: the allocated Team worker; own job: the assignment's worker);
//  - no `own_job_swap_form_not_moved` (the swap could not move the form) may be newer than the last hand-over.
// TEST (qa_test) jobs hand every form to the one TEST Mitti identity, so they always match. Fails CLOSED: anything that
// cannot be read, or an electrician whose Mitti email is unknown, is reported as the same hold.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

/** Office-only wording (Needs me row reason, after "Safety check (PIESA) not completed by itself: "). */
export const PIESA_FORM_WITH_OTHER_ELECTRICIAN = "The safety check form is still with a different electrician";

type Ev = { event_type: string; summary: string | null; details: Record<string, unknown> | null; created_at: string };
const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Null = the form is with the job's electrician; a string = the hold reason (also on any read failure). */
export async function piesaFormHolderProblem(jobId: string, auditId: string | null, scope: "in_house" | "own_job"): Promise<string | null> {
  try {
    const { data: job, error: jobErr } = await admin.from("jobs").select("source").eq("id", jobId).maybeSingle();
    if (jobErr || !job) return PIESA_FORM_WITH_OTHER_ELECTRICIAN;
    const { data: evs, error: evErr } = await admin.from("workflow_events").select("event_type, summary, details, created_at").eq("job_id", jobId)
      .in("event_type", ["mitti_audit_reshared", "own_job_swap_form_not_moved"]).order("created_at", { ascending: false }).limit(50);
    if (evErr) return PIESA_FORM_WITH_OTHER_ELECTRICIAN;
    const events = (evs ?? []) as Ev[];
    const reshare = events.find((e) => e.event_type === "mitti_audit_reshared" && (!auditId || (e.details?.["audit_id"] ?? auditId) === auditId) && (e.details?.["kind"] ?? "piesa") !== "ready_check");
    const notMoved = events.find((e) => e.event_type === "own_job_swap_form_not_moved");
    if (notMoved && (!reshare || notMoved.created_at > reshare.created_at)) return PIESA_FORM_WITH_OTHER_ELECTRICIAN;
    if (job.source === "qa_test") return null; // one TEST Mitti identity holds every TEST form
    // Who holds the form now.
    let holder = lower(typeof reshare?.details?.["email"] === "string" ? (reshare.details["email"] as string) : reshare?.summary?.match(/(?:handed to|re-shared with) (\S+@\S+?)(?:\s|\)|$)/)?.[1]);
    if (!holder) {
      const { data: a, error: aErr } = await admin.from("assessments").select("mitti_assignee_email").eq("job_id", jobId).maybeSingle();
      if (aErr) return PIESA_FORM_WITH_OTHER_ELECTRICIAN;
      holder = lower(a?.mitti_assignee_email as string | null | undefined);
    }
    // Who should hold it: the job's active electrician's Mitti email.
    const { data: asg, error: asgErr } = await admin.from("job_assignments").select("user_id, business_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).order("assigned_at").limit(1).maybeSingle();
    if (asgErr || !asg) return PIESA_FORM_WITH_OTHER_ELECTRICIAN;
    let expected = "";
    if (scope === "in_house") {
      const workerId = await (await import("./in-house-electrician.server")).allocatedWorkerId(jobId);
      if (workerId) {
        const { data: w, error: wErr } = await admin.from("partner_workers").select("email").eq("id", workerId).is("removed_at", null).maybeSingle();
        if (wErr) return PIESA_FORM_WITH_OTHER_ELECTRICIAN;
        expected = lower(w?.email as string | null | undefined);
      }
    }
    if (!expected && asg.user_id && asg.business_id) {
      const { data: w, error: wErr } = await admin.from("partner_workers").select("email").eq("business_id", asg.business_id).eq("profile_id", asg.user_id).is("removed_at", null).limit(1).maybeSingle();
      if (wErr) return PIESA_FORM_WITH_OTHER_ELECTRICIAN;
      expected = lower(w?.email as string | null | undefined);
    }
    if (!expected && asg.user_id) {
      const { data: p, error: pErr } = await admin.from("profiles").select("email").eq("id", asg.user_id).maybeSingle();
      if (pErr) return PIESA_FORM_WITH_OTHER_ELECTRICIAN;
      expected = lower(p?.email as string | null | undefined);
    }
    if (!expected || !holder || expected !== holder) return PIESA_FORM_WITH_OTHER_ELECTRICIAN;
    return null;
  } catch (e) {
    console.error("PIESA form holder check failed", jobId, e instanceof Error ? e.message : String(e));
    return PIESA_FORM_WITH_OTHER_ELECTRICIAN;
  }
}

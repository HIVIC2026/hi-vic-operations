// ONE write path for "electrical fixes done + PIESA Section C signed" (the post_rectification PIESA record).
// Used by the portal "record fixes done" page (portal.functions recordPiesa) and, since decision 293 (Jo 25 Oct 2026),
// by the Mitti "A4 – Electrical fixes" form completion (fixes-day.server.ts). Callers validate first (role, stage,
// evidence, Section C dates); this module only writes the same records the portal page always wrote, in the same order:
// rectification items completed → piesa_records (new current post_rectification row) → piesa_recorded event → on a pass
// compliance checks, the fixes booking completed, the guarded transition to installation scheduling → autoAdvance →
// the one installer clearance notice (decision 186). Nothing here sends to the owner.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent, transition } from "./workflow.server";
import { autoAdvanceJob } from "./autoadvance.server";

export type PostRectificationRecord = {
  jobId: string;
  /** The person recording: the electrician / office user, or null for the Mitti form completion (actor = the form). */
  actorId: string | null;
  kind: "post_rectification" | "reassessment";
  outcome: "pass" | "fail";
  /** Melbourne calendar dates (YYYY-MM-DD). */
  completedDate: string;
  sectionCSignedDate?: string | null;
  notes?: string | null;
  /** Where the record came from, kept on the event (portal page or the Mitti fixes form's audit id). */
  source?: { kind: "portal" } | { kind: "mitti_fixes_form"; auditId: string };
};

/** Writes the PIESA record exactly as the portal page does. Returns the new piesa_records row id when returned. */
export async function applyPiesaRecord(r: PostRectificationRecord): Promise<{ recordId: string | null }> {
  const post = r.kind === "post_rectification";
  if (post) await admin.from("rectification_items").update({ status: "completed" }).eq("job_id", r.jobId).eq("status", "required");
  await admin.from("piesa_records").update({ is_current: false }).eq("job_id", r.jobId).eq("is_current", true);
  const { data: rec } = await admin.from("piesa_records").insert({
    job_id: r.jobId,
    kind: r.kind,
    outcome: r.outcome,
    completed_date: r.completedDate,
    signed_off_by: r.actorId,
    notes: r.notes ?? null,
    ...(post ? { rectification_completed_at: `${r.completedDate}T00:00:00.000Z` } : {}),
    ...(post && r.outcome === "pass" ? { section_c_signed_at: `${r.sectionCSignedDate!}T00:00:00.000Z` } : {}),
  }).select("id").maybeSingle();
  await logEvent(r.jobId, r.actorId, "piesa_recorded", `PIESA (${r.kind.replace("_", " ")}) ${r.outcome} on ${r.completedDate}${r.source?.kind === "mitti_fixes_form" ? " — from the Mitti electrical fixes form" : ""}`,
    r.source?.kind === "mitti_fixes_form" ? { source: "mitti_fixes_form", audit_id: r.source.auditId } : {});
  if (post && r.outcome === "pass") {
    await admin.from("compliance_checks").update({ status: "pass", checked_at: new Date().toISOString() }).eq("job_id", r.jobId).in("check_key", ["rectification", "electrical_assessment"]);
    await admin.from("bookings").update({ status: "completed" }).eq("job_id", r.jobId).eq("kind", "rectification").eq("status", "confirmed");
    await transition(r.jobId, "installation_scheduling", r.actorId, "Electrical fixes complete, PIESA passed – installation scheduling unlocked");
  }
  await autoAdvanceJob(r.jobId, r.actorId, "PIESA recorded");
  // Decision 186: fixes complete + Section C signed is electrical clearance — tell the installer once (nothing when not cleared).
  try { await (await import("./install-clearance.server")).notifyInstallerClearance(r.jobId); } catch (e) { console.error("install clearance notice failed", (e as Error).message); }
  return { recordId: (rec?.id as string | undefined) ?? null };
}

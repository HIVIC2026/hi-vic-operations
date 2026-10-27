import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { practiceAllowed, practiceAnswers, PRACTICE_FIELDS } from "./mitti-practice.core";
export async function practiceForm(userId: string, jobId: string, auditId: string, values?: Record<string, string>) {
  const [job, person, assignments, pointer] = await Promise.all([
    admin.from("jobs").select("source,qa_archived_at,job_number").eq("id", jobId).single(),
    admin.from("profiles").select("email").eq("id", userId).single(),
    admin.from("job_assignments").select("id").eq("job_id", jobId).eq("user_id", userId).eq("role", "installer").eq("active", true),
    admin.from("ceiling_measurements").select("external_id").eq("job_id", jobId).eq("external_source", "mitti").eq("is_current", true).maybeSingle(),
  ]);
  if (job.error || person.error || assignments.error || pointer.error || !practiceAllowed({ source: job.data?.source, email: person.data?.email, assigned: !!assignments.data?.length, audit: auditId, linkedAudit: pointer.data?.external_id, archived: job.data?.qa_archived_at })) throw new Error("This TEST form isn't assigned to you.");
  const store = admin as unknown as import("@supabase/supabase-js").SupabaseClient;
  const { data: audit, error } = await store.from("mitti_sim_audits").select("id,items,completed").eq("id", auditId).single();
  if (error || !audit) throw new Error("The TEST form could not be opened.");
  if (values) {
    if (PRACTICE_FIELDS.some(l => !values[l]?.trim())) throw new Error("Fill every TEST answer before completing the form.");
    const existing = Array.isArray(audit.items) ? audit.items as { item_id: string }[] : [];
    const added = practiceAnswers(values);
    const ids = new Set(added.map(x => x.item_id));
    const { error: writeError } = await store.from("mitti_sim_audits").update({ items: [...existing.filter(x => !ids.has(x.item_id)), ...added], completed: true, modified_at: new Date().toISOString() }).eq("id", auditId);
    if (writeError) throw new Error("The TEST form wasn't saved.");
    const { syncMittiAssessment } = await import("./mitti.server");
    const { persistentSimMittiCall } = await import("./mitti-sim-store.server");
    const result = await syncMittiAssessment(jobId, userId, persistentSimMittiCall);
    return { jobNumber: job.data?.job_number ?? "TEST", completed: true, issues: result.issues };
  }
  return { jobNumber: job.data?.job_number ?? "TEST", completed: audit.completed === true, issues: [] as string[] };
}
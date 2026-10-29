// AI replies step 3: reads the replies Jo sent (AI drafts she approved + her own Outlook replies on matched jobs) with the
// owner email each one answered, as style examples. Real jobs only, never the current job, scrubbed of the other owner's details.
// Best-effort: any failure gives [] so the reply still gets written without examples. At most 3 database round trips.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pickStyleExamples, scrubExample, topicWordsOf, type StyleExample } from "./ai-style.core";

const loose = admin as unknown as SupabaseClient;
type Comm = { job_id: string; body: string | null; created_at: string; direction?: string };
type JobRow = { id: string; job_number: string | null; source: string | null; owners: { full_name: string | null } | { full_name: string | null }[] | null };

export async function loadStyleExamples(jobId: string, ownerEmail: string): Promise<StyleExample[]> {
  try {
    const { data: sent, error: e1 } = await loose.from("job_communications").select("job_id, body, created_at")
      .eq("channel", "email").eq("direction", "outbound").neq("job_id", jobId)
      .or("source_event.eq.email_ai_draft_sent,and(provider.eq.outlook,source_event.like.outlook_sync:%)")
      .order("created_at", { ascending: false }).limit(60);
    if (e1) throw e1;
    const replies = ((sent ?? []) as Comm[]).filter((r) => r.job_id && r.body?.trim());
    if (!replies.length) return [];
    const ids = [...new Set(replies.map((r) => r.job_id))];
    const [jobsRes, inRes] = await Promise.all([
      loose.from("jobs").select("id, job_number, source, owners(full_name)").in("id", ids),
      loose.from("job_communications").select("job_id, body, created_at").eq("channel", "email").eq("direction", "inbound")
        .in("job_id", ids).order("created_at", { ascending: false }),
    ]);
    if (jobsRes.error) throw jobsRes.error;
    if (inRes.error) throw inRes.error;
    const jobs = new Map<string, JobRow>(((jobsRes.data ?? []) as JobRow[]).map((j) => [j.id, j]));
    const inbound = (inRes.data ?? []) as Comm[];
    const rows: StyleExample[] = [];
    for (const r of replies) {
      const j = jobs.get(r.job_id);
      if (!j || j.source === "qa_test" || /test/i.test(j.job_number ?? "")) continue;
      const theirs = inbound.find((m) => m.job_id === r.job_id && m.created_at < r.created_at && m.body?.trim());
      if (!theirs) continue;
      const o = Array.isArray(j.owners) ? j.owners[0] : j.owners;
      const owner = { name: o?.full_name ?? "" };
      rows.push({ theirEmail: scrubExample(theirs.body!, owner), reply: scrubExample(r.body!, owner), at: r.created_at });
    }
    return pickStyleExamples(rows, topicWordsOf(ownerEmail));
  } catch (e) {
    console.error("loadStyleExamples failed", e);
    return [];
  }
}

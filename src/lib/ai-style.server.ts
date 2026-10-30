// AI replies step 3: reads the replies Jo sent (AI drafts she approved + her own Outlook replies on matched jobs) with the
// owner email each one answered, as style examples. Real jobs only, never the current job, scrubbed of the other owner's details.
// Best-effort: any failure gives [] so the reply still gets written without examples. At most 3 database round trips.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cutAtSignOff, pickStyleExamples, scrubExample, topicWordsOf, type StyleExample } from "./ai-style.core";
import { latestReplyText } from "./outlook-correspondence.core";

const loose = admin as unknown as SupabaseClient;
type Comm = { job_id: string; body: string | null; created_at: string; sent_at?: string | null; received_at?: string | null };
type JobRow = { id: string; job_number: string | null; source: string | null; owners: { full_name: string | null } | { full_name: string | null }[] | null; properties: Prop | Prop[] | null };
type Prop = { address_line: string | null; suburb: string | null; postcode: string | null };

const INBOUND_CAP = 300;
// Outlook can file an owner's email a few minutes after Jo's reply in the same sync, so the inbound bound has a small margin.
const SYNC_MARGIN_MS = 10 * 60_000;
const when = (r: Comm) => r.sent_at ?? r.received_at ?? r.created_at;

export async function loadStyleExamples(jobId: string, ownerEmail: string): Promise<StyleExample[]> {
  try {
    const { data: sent, error: e1 } = await loose.from("job_communications").select("job_id, body, created_at, sent_at")
      .eq("channel", "email").eq("direction", "outbound").eq("visibility", "customer").neq("job_id", jobId)
      .or("source_event.eq.email_ai_draft_sent,and(provider.eq.outlook,source_event.like.outlook_sync:%)")
      .order("created_at", { ascending: false }).limit(60);
    if (e1) throw e1;
    const replies = ((sent ?? []) as Comm[]).filter((r) => r.job_id && r.body?.trim());
    if (!replies.length) return [];
    const ids = [...new Set(replies.map((r) => r.job_id))];
    const newest = replies.reduce((m, r) => (r.created_at > m ? r.created_at : m), replies[0]!.created_at);
    const bound = new Date(Date.parse(newest) + SYNC_MARGIN_MS).toISOString();
    const [jobsRes, inRes] = await Promise.all([
      loose.from("jobs").select("id, job_number, source, owners(full_name), properties(address_line, suburb, postcode)").in("id", ids).is("deleted_at", null),
      loose.from("job_communications").select("job_id, body, created_at, received_at").eq("channel", "email").eq("direction", "inbound")
        .in("job_id", ids).lte("created_at", bound).order("created_at", { ascending: false }).limit(INBOUND_CAP),
    ]);
    if (jobsRes.error) throw jobsRes.error;
    if (inRes.error) throw inRes.error;
    const jobs = new Map<string, JobRow>(((jobsRes.data ?? []) as JobRow[]).map((j) => [j.id, j]));
    // Newest first by when the email actually arrived (received_at), falling back to when it was stored.
    const inbound = ((inRes.data ?? []) as Comm[]).slice().sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0));
    const rows: StyleExample[] = [];
    for (const r of replies) {
      const j = jobs.get(r.job_id);
      if (!j || j.source === "qa_test" || /test/i.test(j.job_number ?? "")) continue;
      const at = when(r);
      const theirs = inbound.find((m) => m.job_id === r.job_id && when(m) < at && m.body?.trim());
      if (!theirs) continue;
      // Outlook bodies carry the quoted chain and Jo's signature: keep only the latest message, and Jo's words before her sign-off.
      const theirText = latestReplyText(theirs.body!);
      const replyText = cutAtSignOff(latestReplyText(r.body!));
      if (!theirText || !replyText) continue;
      const o = Array.isArray(j.owners) ? j.owners[0] : j.owners;
      const p = Array.isArray(j.properties) ? j.properties[0] : j.properties;
      const owner = { name: o?.full_name ?? "", address: p?.address_line ?? "", suburb: p?.suburb ?? "", postcode: p?.postcode ?? "" };
      rows.push({ theirEmail: scrubExample(theirText, owner), reply: scrubExample(replyText, owner), at });
    }
    return pickStyleExamples(rows, topicWordsOf(ownerEmail));
  } catch (e) {
    console.error("loadStyleExamples failed", e);
    return [];
  }
}

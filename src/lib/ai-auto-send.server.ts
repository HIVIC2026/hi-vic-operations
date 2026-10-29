// AI replies step 4 (Jo 30 Oct 2026): the auto-send on/off switch and the 10 sample replies Jo checks before turning it on.
// The switch is append-only `ai_auto_send_switched` events (latest wins). No event or any read error = OFF.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_EMAIL_DRAFT_DISCARDED_EVENT, AI_EMAIL_DRAFT_EVENT, AI_EMAIL_DRAFT_SENT_EVENT, AUTO_SEND_KINDS, latestDraftEdits, AI_EMAIL_DRAFT_EDITED_EVENT, type AiAutoKind } from "./ai-email-reply.core";
import { firstNameOf } from "./email-reply.core";

const loose = admin as unknown as SupabaseClient;
export const AUTO_SEND_SWITCH_EVENT = "ai_auto_send_switched";
export const AUTO_SEND_SAMPLES_NEEDED = 10;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

export type AutoSendSample = {
  eventId: string; at: string; body: string; kind: AiAutoKind; ownerFirstName: string | null; jobNumber: string | null;
  state: "sent_as_is" | "sent_edited" | "edited" | "discarded" | "waiting";
};

/** Is auto-send on? The latest switch event decides; none, or any error, means off. */
export async function autoSendOn(): Promise<boolean> {
  try {
    const { data, error } = await loose.from("workflow_events").select("details").eq("event_type", AUTO_SEND_SWITCH_EVENT)
      .order("created_at", { ascending: false }).limit(1);
    if (error) return false;
    const on = (data as { details: { on?: unknown } | null }[] | null)?.[0]?.details?.on;
    return on === true;
  } catch { return false; }
}

/** The latest drafts (up to 10) of an auto-send kind, leaving out QA/TEST jobs. */
export async function autoSendSamples(): Promise<AutoSendSample[]> {
  type Draft = { id: string; job_id: string | null; created_at: string; details: Record<string, unknown> | null };
  type JobRow = { id: string; job_number: string | null; source: string | null; owner_id: string | null };
  const jobById = new Map<string, JobRow>();
  const real: Draft[] = [];
  // Page through the newest drafts: QA/TEST jobs run every morning and can bury the real ones.
  for (let page = 0; page < MAX_PAGES && real.length < AUTO_SEND_SAMPLES_NEEDED; page++) {
    const { data: drafts, error } = await loose.from("workflow_events").select("id, job_id, created_at, details").eq("event_type", AI_EMAIL_DRAFT_EVENT)
      .in("details->>auto_kind", [...AUTO_SEND_KINDS]).order("created_at", { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (drafts ?? []) as Draft[];
    const rows = batch.filter((r) => r.job_id);
    const jobIds = [...new Set(rows.map((r) => r.job_id!))];
    for (let i = 0; i < jobIds.length; i += 50) {
      const { data: jobs, error: jobError } = await loose.from("jobs").select("id, job_number, source, owner_id").in("id", jobIds.slice(i, i + 50));
      if (jobError) throw new Error(jobError.message);
      for (const j of (jobs ?? []) as JobRow[]) jobById.set(j.id, j);
    }
    for (const r of rows) { const j = jobById.get(r.job_id!); if (j && j.source !== "qa_test" && real.length < AUTO_SEND_SAMPLES_NEEDED) real.push(r); }
    if (batch.length < PAGE_SIZE) break;
  }
  if (!real.length) return [];
  const ids = real.map((r) => r.id);
  const ownerIds = [...new Set(real.map((r) => jobById.get(r.job_id!)!.owner_id).filter((x): x is string => !!x))];
  const [ownersRes, doneRes, editsRes] = await Promise.all([
    ownerIds.length ? loose.from("owners").select("id, full_name").in("id", ownerIds) : Promise.resolve({ data: [], error: null }),
    loose.from("workflow_events").select("event_type, details").in("event_type", [AI_EMAIL_DRAFT_SENT_EVENT, AI_EMAIL_DRAFT_DISCARDED_EVENT]).in("details->>draft_event_id", ids),
    loose.from("workflow_events").select("created_at, details").eq("event_type", AI_EMAIL_DRAFT_EDITED_EVENT).in("details->>draft_event_id", ids),
  ]);
  for (const r of [ownersRes, doneRes, editsRes]) if (r.error) throw new Error(r.error.message);
  const nameById = new Map(((ownersRes.data ?? []) as { id: string; full_name: string | null }[]).map((o) => [o.id, o.full_name]));
  const done = new Map<string, string>();
  for (const e of (doneRes.data ?? []) as { event_type: string; details: { draft_event_id?: string } | null }[]) {
    const id = e.details?.draft_event_id; if (!id) continue;
    // A discard is final; otherwise a send stands.
    if (e.event_type === AI_EMAIL_DRAFT_DISCARDED_EVENT || !done.has(id)) done.set(id, e.event_type);
  }
  const edits = latestDraftEdits((editsRes.data ?? []) as Parameters<typeof latestDraftEdits>[0]);
  return real.map((r): AutoSendSample => {
    const j = jobById.get(r.job_id!)!;
    const edited = edits.has(r.id); const fin = done.get(r.id);
    const state = fin === AI_EMAIL_DRAFT_DISCARDED_EVENT ? "discarded" : fin === AI_EMAIL_DRAFT_SENT_EVENT ? (edited ? "sent_edited" : "sent_as_is") : edited ? "edited" : "waiting";
    return { eventId: r.id, at: r.created_at, body: edits.get(r.id) ?? String(r.details?.["body"] ?? ""), kind: r.details?.["auto_kind"] as AiAutoKind,
      ownerFirstName: firstNameOf(j.owner_id ? nameById.get(j.owner_id) ?? null : null), jobNumber: j.job_number, state };
  });
}

/** Turn auto-send on or off. Turning on needs 10 samples to have been written. Turning off is always allowed. */
export async function switchAutoSend(on: boolean, actorId: string): Promise<{ on: boolean }> {
  if (on) {
    const samples = await autoSendSamples();
    if (samples.length < AUTO_SEND_SAMPLES_NEEDED) throw new Error("Not enough samples yet");
  }
  const { error } = await loose.from("workflow_events").insert({ job_id: null, actor_id: actorId, event_type: AUTO_SEND_SWITCH_EVENT, internal: true,
    summary: on ? "Auto-send turned on" : "Auto-send turned off", details: { on } });
  if (error) throw new Error(error.message);
  return { on };
}

// AI replies step 4 (Jo 30 Oct 2026): the auto-send on/off switch and the 10 sample replies Jo checks before turning it on.
// The switch is append-only `ai_auto_send_switched` events (latest wins). No event or any read error = OFF.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AI_AUTO_DECISION_EVENT, AI_EMAIL_DRAFT_DISCARDED_EVENT, AI_EMAIL_DRAFT_EVENT, AI_EMAIL_DRAFT_SENT_EVENT, AUTO_SEND_KINDS, latestDraftEdits, AI_EMAIL_DRAFT_EDITED_EVENT,
  aiReplyProblems, aiSendQuietReason, autoSendDecision, autoSendKey, draftNeeds, latestAutoDecisions, type AiAutoKind,
} from "./ai-email-reply.core";
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
    // A new draft can shift the page window, so the same draft may come back on the next page: count it once.
    for (const r of rows) { const j = jobById.get(r.job_id!); if (j && j.source !== "qa_test" && real.length < AUTO_SEND_SAMPLES_NEEDED && !real.some((x) => x.id === r.id)) real.push(r); }
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

// ---- Sending (step 4, task 3) ----
// A saved draft is checked by the pure autoSendDecision with fresh facts; every outcome is an append-only
// `email_ai_auto_decision` event (newest wins) so the draft card can say what happened. "now" sends through the same
// sendAiDraft path Jo uses (same once-only key), marked via "ai". "at7am" waits for sweepHeldAutoReplies.

const AI_REPLY_GAP_MS = 30 * 60_000;
const HELD_LOOKBACK_MS = 3 * 24 * 3600_000;
export const ALREADY_REPLIED_REASON = "Already replied by AI in the last 30 minutes";
export const JOB_MOVED_REASON = "Job moved on — check before sending";
export const EMAILED_AGAIN_REASON = "Owner emailed again — check before sending";
export const ALREADY_REPLIED_BY_YOU_REASON = "You've already replied";
export const ALREADY_HANDLED_REASON = "Already handled";
export const STUCK_REASON = "Auto-send failed: didn't finish";
const STUCK_AFTER_MS = 60 * 60_000;
const SENT_LIKE = ["sent", "delivered", "delivered_unrecorded"] as const;

export type AutoSendResult = { send: "now" | "at7am" | "no"; reason: string; sent: boolean };

type DraftEvent = { id: string; job_id: string | null; event_type: string; created_at: string; details: Record<string, unknown> | null };

async function recordDecision(jobId: string | null, draftId: string, kind: AiAutoKind, decision: "now" | "at7am" | "no", reason: string): Promise<void> {
  const summary = decision === "now" ? "AI reply sending itself" : decision === "at7am" ? "AI reply waiting for 7am" : `AI reply left for Jo: ${reason}`;
  const { error } = await loose.from("workflow_events").insert({ job_id: jobId, actor_id: null, event_type: AI_AUTO_DECISION_EVENT, internal: true,
    summary, details: { draft_event_id: draftId, decision, reason, kind } });
  if (error) throw new Error(error.message);
}

/** Sent, discarded or edited (by Jo, or already auto-sent): never touched again. */
async function handled(draftId: string): Promise<boolean> {
  const { data, error } = await loose.from("workflow_events").select("id")
    .in("event_type", [AI_EMAIL_DRAFT_SENT_EVENT, AI_EMAIL_DRAFT_DISCARDED_EVENT, AI_EMAIL_DRAFT_EDITED_EVENT]).eq("details->>draft_event_id", draftId).limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** An AI reply already went to this owner (this job or their email) in the last 30 minutes. Unreadable = yes. */
async function recentAiReply(jobId: string, ownerEmail: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - AI_REPLY_GAP_MS).toISOString();
  const { data, error } = await loose.from("workflow_events").select("job_id, details").eq("event_type", AI_EMAIL_DRAFT_SENT_EVENT)
    .eq("details->>via", "ai").gte("created_at", since).limit(500);
  if (error) return true;
  const email = ownerEmail.trim().toLowerCase();
  return ((data ?? []) as { job_id: string | null; details: { to?: unknown } | null }[])
    .some((r) => r.job_id === jobId || (typeof r.details?.to === "string" && r.details.to.trim().toLowerCase() === email));
}

/** The owner unsubscribed from email or opted out of the list. Unreadable = opted out. */
async function ownerOptedOut(jobId: string): Promise<boolean> {
  const [opt, resp] = await Promise.all([
    loose.from("customer_email_optouts").select("opted_out_at").eq("job_id", jobId).limit(5),
    loose.from("lead_campaign_responses").select("opted_out_at").eq("job_id", jobId).limit(5),
  ]);
  if (opt.error || resp.error) return true;
  return [...(opt.data ?? []), ...(resp.data ?? [])].some((r) => !!(r as { opted_out_at: string | null }).opted_out_at);
}

/**
 * Decides whether one saved AI draft sends itself, records the decision, and sends it when the answer is "now".
 * `ownerText`: the owner's email (read from the job when not given). `held`: the 7am sweep — also re-checks that the job
 * hasn't moved stage and the owner hasn't emailed again. Returns null when the draft is gone or already handled.
 */
export async function autoSendDraft(draftId: string, o: { now?: Date; ownerText?: string; held?: boolean } = {}): Promise<AutoSendResult | null> {
  const now = o.now ?? new Date();
  const { data: evData, error: evErr } = await loose.from("workflow_events").select("id, job_id, event_type, created_at, details").eq("id", draftId).maybeSingle();
  if (evErr) throw new Error(evErr.message);
  const ev = evData as DraftEvent | null;
  // Gone or already dealt with. In the sweep, a final "no" stops it being checked again.
  const done = async () => { if (o.held) await recordDecision(ev?.job_id ?? null, draftId, "other", "no", ALREADY_HANDLED_REASON); return null; };
  if (!ev || ev.event_type !== AI_EMAIL_DRAFT_EVENT || !ev.job_id) return done();
  const det = ev.details ?? {};
  if (det["no_reply_needed"] === true || await handled(draftId)) return done();
  const jobId = ev.job_id;
  const kind: AiAutoKind = AUTO_SEND_KINDS.includes(det["auto_kind"] as AiAutoKind) ? det["auto_kind"] as AiAutoKind : "other";
  const body = String(det["body"] ?? "");
  const messageId = typeof det["message_id"] === "string" ? det["message_id"] : null;
  const leave = async (reason: string): Promise<AutoSendResult> => { await recordDecision(jobId, draftId, kind, "no", reason); return { send: "no", reason, sent: false }; };

  const { data: jobData, error: jobErr } = await loose.from("jobs").select("id, source, owner_id, channel, stage, deleted_at").eq("id", jobId).maybeSingle();
  if (jobErr) throw new Error(jobErr.message);
  const job = jobData as { id: string; owner_id: string | null; channel: string | null; stage: string | null; deleted_at: string | null } | null;
  if (!job || job.deleted_at) return leave("Job not found");

  if (o.held && det["job_stage"] !== job.stage) return leave(JOB_MOVED_REASON);
  // Still true? Not if the owner wrote again, or someone already replied (e.g. Jo from Outlook), since their email.
  const since = typeof det["received_at"] === "string" ? det["received_at"] : ev.created_at;
  const [inb, outb] = await Promise.all([
    loose.from("job_communications").select("provider_message_id").eq("job_id", jobId).eq("channel", "email").eq("direction", "inbound").gt("received_at", since).limit(20),
    // Only a real reply by a person: Outlook mail that went (Jo's Sent Items, office sends). Automatic portal emails,
    // failed rows and AI auto-sends don't count.
    loose.from("job_communications").select("source_event, created_by").eq("job_id", jobId).eq("channel", "email").eq("direction", "outbound")
      .eq("provider", "outlook").in("delivery_status", [...SENT_LIKE]).gt("sent_at", since).limit(20),
  ]);
  if (inb.error || outb.error) throw new Error((inb.error ?? outb.error)!.message);
  const byPerson = ((outb.data ?? []) as { source_event: string | null; created_by: string | null }[])
    .some((r) => !(r.source_event === AI_EMAIL_DRAFT_SENT_EVENT && r.created_by == null));
  if (byPerson) return leave(ALREADY_REPLIED_BY_YOU_REASON);
  if (((inb.data ?? []) as { provider_message_id: string | null }[]).some((r) => r.provider_message_id !== messageId)) return leave(EMAILED_AGAIN_REASON);

  let ownerText = o.ownerText;
  if (ownerText == null && messageId) {
    const { data: inbound, error: iErr } = await loose.from("job_communications").select("body").eq("job_id", jobId).eq("provider_message_id", messageId).limit(1);
    if (iErr) throw new Error(iErr.message);
    const b = ((inbound ?? []) as { body: string | null }[])[0]?.body;
    if (typeof b === "string") ownerText = b;
  }
  if (ownerText == null) return leave("Owner's email not found — check before sending");

  const { data: owner } = job.owner_id ? await loose.from("owners").select("email").eq("id", job.owner_id).maybeSingle() : { data: null };
  const ownerEmail = String((owner as { email: string | null } | null)?.email ?? "").trim();
  const { preReleaseFor } = await import("./ai-email-reply.server");
  const preRelease = await preReleaseFor(jobId, { channel: job.channel, stage: job.stage });
  const saved = Array.isArray(det["problems"]) ? (det["problems"] as unknown[]).map(String) : [];
  // Jo's rule (30 Oct): the AI-draft wording checks, run again right here.
  const problems = [...new Set([...saved, ...aiReplyProblems(body, { preRelease, aiDraft: true })])];
  const needs = draftNeeds(det);
  const actions = det["actions"];
  const hasActions = !!actions && typeof actions === "object" && Object.keys(actions as object).length > 0;
  let d = autoSendDecision({ switchOn: await autoSendOn(), kind, problems, needsAnswer: needs.needsAnswer, needsYou: needs.needsYou, hasActions,
    optedOut: await ownerOptedOut(jobId), ownerEmail, ownerText, nowIso: now.toISOString() });
  if (d.send !== "no" && await recentAiReply(jobId, ownerEmail, now)) d = { send: "no", reason: ALREADY_REPLIED_REASON };
  if (o.held && d.send === "at7am") return { ...d, sent: false }; // still quiet hours: keep waiting
  await recordDecision(jobId, draftId, kind, d.send, d.reason);
  if (d.send !== "now") return { ...d, sent: false };

  try {
    const { sendAiDraft } = await import("./ai-email-reply.server");
    const r = await sendAiDraft(draftId, body, null, { via: "ai" }, now);
    if (r.status === "rewritten") return { ...(await leave("Auto-send failed: the reply needed fixing — check it and press Send")) };
    return { ...d, sent: true };
  } catch (e) {
    // Another run already sent it (same once-only key): not a failure.
    if (await handled(draftId).catch(() => false)) return { ...d, sent: false };
    const why = (e instanceof Error ? e.message : String(e)).replace(/^Not sent — /, "");
    // This owner email already had its one auto-reply (another draft of it): not a failure either.
    if (why.startsWith("already attempted")) return leave("Already replied to this email by AI");
    return leave(`Auto-send failed: ${why}`);
  }
}

/** The 7am sweep (every 15-minute tick; acts only 7:00am–7:59pm Melbourne): each reply held overnight is checked
 *  again from scratch and sent, or left for Jo with the reason. A draft is only ever sent once. */
export async function sweepHeldAutoReplies(now = new Date()): Promise<{ checked: number; sent: number }> {
  const since = new Date(now.getTime() - HELD_LOOKBACK_MS).toISOString();
  await markStuckSends(now, since).catch((e) => console.error("stuck AI sends not checked", e instanceof Error ? e.message : e));
  if (aiSendQuietReason(now.toISOString())) return { checked: 0, sent: 0 };
  const { data, error } = await loose.from("workflow_events").select("details").eq("event_type", AI_AUTO_DECISION_EVENT)
    .eq("details->>decision", "at7am").gte("created_at", since).limit(500);
  if (error) throw new Error(error.message);
  const ids = [...new Set(((data ?? []) as { details: { draft_event_id?: unknown } | null }[]).map((r) => r.details?.draft_event_id).filter((x): x is string => typeof x === "string"))];
  let checked = 0; let sent = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const { data: all, error: allErr } = await loose.from("workflow_events").select("created_at, details").eq("event_type", AI_AUTO_DECISION_EVENT)
      .in("details->>draft_event_id", part).order("created_at", { ascending: true });
    if (allErr) throw new Error(allErr.message);
    const latest = latestAutoDecisions((all ?? []) as { created_at: string; details: Record<string, unknown> | null }[]);
    for (const id of part) {
      if (latest.get(id)?.decision !== "at7am") continue;
      checked++;
      try { if ((await autoSendDraft(id, { now, held: true }))?.sent) sent++; }
      catch (e) { console.error("held AI reply skipped", e instanceof Error ? e.message : e); }
    }
  }
  return { checked, sent };
}

/** A "now" decision over an hour old with no sent event (the run stopped part way). If the email service recorded the
 *  send under the draft's `:auto` key, the missing sent event is written; otherwise it is marked failed so the card
 *  stops saying it's sending. */
async function markStuckSends(now: Date, since: string): Promise<void> {
  const before = new Date(now.getTime() - STUCK_AFTER_MS).toISOString();
  const { data, error } = await loose.from("workflow_events").select("job_id, created_at, details").eq("event_type", AI_AUTO_DECISION_EVENT)
    .eq("details->>decision", "now").gte("created_at", since).lt("created_at", before).order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { job_id: string | null; created_at: string; details: Record<string, unknown> | null }[];
  const ids = [...new Set(rows.map((r) => r.details?.["draft_event_id"]).filter((x): x is string => typeof x === "string"))];
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const [allRes, doneRes, draftsRes] = await Promise.all([
      loose.from("workflow_events").select("created_at, details").eq("event_type", AI_AUTO_DECISION_EVENT).in("details->>draft_event_id", part).order("created_at", { ascending: true }),
      loose.from("workflow_events").select("details").in("event_type", [AI_EMAIL_DRAFT_SENT_EVENT, AI_EMAIL_DRAFT_DISCARDED_EVENT, AI_EMAIL_DRAFT_EDITED_EVENT]).in("details->>draft_event_id", part),
      loose.from("workflow_events").select("id, job_id, details").in("id", part),
    ]);
    for (const r of [allRes, doneRes, draftsRes]) if (r.error) throw new Error(r.error.message);
    const latest = latestAutoDecisions((allRes.data ?? []) as { created_at: string; details: Record<string, unknown> | null }[]);
    const done = new Set(((doneRes.data ?? []) as { details: { draft_event_id?: unknown } | null }[]).map((r) => r.details?.draft_event_id));
    const drafts = new Map(((draftsRes.data ?? []) as { id: string; job_id: string | null; details: Record<string, unknown> | null }[]).map((d) => [d.id, d]));
    const stuck = part.filter((id) => { const l = latest.get(id); return l?.decision === "now" && l.at < before && !done.has(id); });
    if (!stuck.length) continue;
    const keyOf = (id: string) => { const m = drafts.get(id)?.details?.["message_id"]; return typeof m === "string" ? autoSendKey(m) : null; };
    const keys = stuck.map(keyOf).filter((k): k is string => !!k);
    const { data: sendRows, error: sErr } = keys.length ? await loose.from("customer_email_sends").select("idempotency_key, status").in("idempotency_key", keys) : { data: [], error: null };
    if (sErr) throw new Error(sErr.message);
    const sendByKey = new Map(((sendRows ?? []) as { idempotency_key: string; status: string | null }[]).map((r) => [r.idempotency_key, r.status]));
    for (const id of stuck) {
      const draft = drafts.get(id); const key = keyOf(id); const st = key ? sendByKey.get(key) : undefined;
      const jobId = draft?.job_id ?? rows.find((r) => r.details?.["draft_event_id"] === id)?.job_id ?? null;
      if (draft && key && (st === "sent" || st === "delivered_unrecorded")) {
        const det = draft.details ?? {};
        const { error: ie } = await loose.from("workflow_events").insert({ job_id: jobId, actor_id: null, event_type: AI_EMAIL_DRAFT_SENT_EVENT, internal: true,
          summary: "Email reply sent to the owner (Sent by AI)",
          details: { draft_event_id: id, to: String(det["to"] ?? ""), subject: String(det["subject"] ?? ""), body: String(det["body"] ?? "").trim(),
            status: st === "sent" ? "sent" : "delivery uncertain — not retried", idempotency_key: key, via: "ai", recovered: true } });
        if (ie) throw new Error(ie.message);
        continue;
      }
      await recordDecision(jobId, id, latest.get(id)!.kind, "no", STUCK_REASON);
    }
  }
}

// AI email replies on each job (Jo 26 Oct 2026) — see ai-email-reply.core for the rules.
// writeAiReplyDraft: reads the job's facts, stage and full email history, asks the AI for a fresh reply and saves it as
// ONE `email_ai_draft` event on the job (one per Outlook message). Never sends. Best-effort: never throws to the copier.
// sendAiDraft / discardAiDraft: office-only, from the job page. Send goes through the guarded owner sender (TEST jobs →
// TEST inbox only), with a per-draft once-only key so the same email can never go twice.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailMessage } from "./outlook-correspondence.core";
import {
  AI_EMAIL_DRAFTS_ENABLED, AI_EMAIL_DRAFT_DISCARDED_EVENT, AI_EMAIL_DRAFT_EVENT, AI_EMAIL_DRAFT_SENT_EVENT, AI_EMAIL_REPLY_PURPOSE, AI_REPLY_INSTRUCTIONS,
  aiDraftKey, aiReplyEmailHtml, aiReplyProblems, aiReplyText, aiSendQuietReason, bookingChangeLink, buildAiReplyInput, finishAiReply, replySubject, type AiReplyKind,
} from "./ai-email-reply.core";

const loose = admin as unknown as SupabaseClient;

/** The AI call shared by job replies and the Emails tab no-job replies (decision 414). */
export async function aiText(input: string, instructions: string = AI_REPLY_INSTRUCTIONS): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured");
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { streamText } = await import("ai");
  const provider = createOpenAI({ baseURL: "https://ai.gateway.lovable.dev/v1", apiKey: key, headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" } });
  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    instructions,
    messages: [{ role: "user", content: input }],
    providerOptions: { openai: { forceReasoning: true, reasoningEffort: "low", reasoningSummary: "auto", store: false, include: ["reasoning.encrypted_content"] } },
  } as Parameters<typeof streamText>[0]);
  return (await result.text).trim();
}

export async function writeAiReplyDraft(p: { jobId: string; message: MailMessage; kind: AiReplyKind; reason: string }): Promise<"drafted" | "already" | "skipped"> {
  if (!AI_EMAIL_DRAFTS_ENABLED || p.message.direction !== "inbound") return "skipped";
  const m = p.message;
  try {
    const { data: dup } = await loose.from("workflow_events").select("id").eq("job_id", p.jobId).eq("event_type", AI_EMAIL_DRAFT_EVENT).contains("details", { message_id: m.providerMessageId }).limit(1);
    if ((dup ?? []).length) return "already";
    const { data: job } = await admin.from("jobs").select("id, job_number, stage, owner_id, deleted_at").eq("id", p.jobId).maybeSingle();
    if (!job || job.deleted_at) return "skipped";
    const { data: owner } = job.owner_id ? await admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle() : { data: null };
    if (!owner?.email) return "skipped";
    const { ownerJobFacts } = await import("./owner-email-auto-reply.server");
    const { STAGE_LABEL } = await import("./workflow");
    const { firstNameOf, slotText } = await import("./email-reply.core");
    const facts = await ownerJobFacts(p.jobId, owner.full_name ?? null, job.stage);
    const { data: hist } = await admin.from("job_communications").select("direction, subject, body, received_at, sent_at, created_at")
      .eq("job_id", p.jobId).eq("channel", "email").order("created_at", { ascending: true }).limit(40);
    const lines: string[] = [];
    lines.push(facts.spotSaved ? "Their spot is saved." : "Their spot is not saved yet.");
    if (facts.questionsAnswered) lines.push("They have answered the insulation questions.");
    if (facts.nextVisit) lines.push(`Next booked visit: ${facts.nextVisit.kind === "piesa" ? "Pre Insulation Electrical Safety Assessment (PIESA)" : facts.nextVisit.kind === "install" ? "install day" : "Ready Check"} on ${slotText(facts.nextVisit.slot)}.`);
    else lines.push("No visit is booked right now.");
    if (facts.quoteStatus) lines.push(`Quote: ${facts.quoteStatus === "issued" ? "sent, waiting for them to accept" : facts.quoteStatus}.`);
    const links = [
      ...(facts.myJobLink ? [{ label: "Their job page (status, quote, bookings)", url: facts.myJobLink }] : []),
      ...(facts.questionsLink && !facts.spotSaved ? [{ label: "Save My Spot / insulation questions", url: facts.questionsLink }] : []),
    ];
    const input = buildAiReplyInput({
      jobNumber: job.job_number, ownerFirstName: firstNameOf(owner.full_name), stageLabel: (STAGE_LABEL as Record<string, string>)[job.stage] ?? job.stage,
      facts: lines, links, changeLink: bookingChangeLink(facts.myJobLink, job.stage),
      history: ((hist ?? []) as { direction: string; subject: string | null; body: string; received_at: string | null; sent_at: string | null; created_at: string }[])
        .map((h) => ({ direction: h.direction === "outbound" ? "outbound" as const : "inbound" as const, at: h.received_at ?? h.sent_at ?? h.created_at, subject: h.subject, body: h.body ?? "" })),
      email: { from: m.from, subject: m.subject, body: m.body },
    });
    const body = finishAiReply(await aiText(input));
    const { error } = await loose.from("workflow_events").insert({ job_id: p.jobId, actor_id: null, event_type: AI_EMAIL_DRAFT_EVENT, internal: true,
      summary: `AI reply draft waiting for Jo (${p.kind === "simple" ? "simple email" : "needs a check"})`,
      details: { message_id: m.providerMessageId, thread_id: m.threadId, from: m.from, to: owner.email.trim(), their_subject: m.subject, subject: replySubject(m.subject),
        body, kind: p.kind, reason: p.reason, idempotency_key: aiDraftKey(m.providerMessageId) } });
    if (error) throw new Error(error.message);
    return "drafted";
  } catch (e) {
    console.error("AI reply draft skipped", e instanceof Error ? e.message : e);
    return "skipped";
  }
}

export type AiDraftRow = { eventId: string; at: string; from: string | null; to: string; subject: string; theirSubject: string | null; body: string; kind: AiReplyKind; status: "waiting" | "sent" | "discarded"; doneAt: string | null };

export async function listAiDrafts(jobId: string): Promise<AiDraftRow[]> {
  const [d, done] = await Promise.all([
    loose.from("workflow_events").select("id, created_at, details").eq("job_id", jobId).eq("event_type", AI_EMAIL_DRAFT_EVENT).order("created_at", { ascending: false }).limit(50),
    loose.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId).in("event_type", [AI_EMAIL_DRAFT_SENT_EVENT, AI_EMAIL_DRAFT_DISCARDED_EVENT]).limit(200),
  ]);
  if (d.error) throw new Error(d.error.message);
  const res = new Map<string, { type: string; at: string }>();
  for (const r of (done.data ?? []) as { event_type: string; created_at: string; details: { draft_event_id?: string } }[]) if (r.details?.draft_event_id) res.set(r.details.draft_event_id, { type: r.event_type, at: r.created_at });
  return ((d.data ?? []) as { id: string; created_at: string; details: Record<string, unknown> }[]).map((r) => {
    const x = res.get(r.id); const det = r.details;
    return { eventId: r.id, at: r.created_at, from: (det["from"] as string) ?? null, to: String(det["to"] ?? ""), subject: String(det["subject"] ?? ""), theirSubject: (det["their_subject"] as string) ?? null,
      body: String(det["body"] ?? ""), kind: det["kind"] === "simple" ? "simple" : "other", status: x ? (x.type === AI_EMAIL_DRAFT_SENT_EVENT ? "sent" : "discarded") : "waiting", doneAt: x?.at ?? null };
  });
}

async function openDraft(eventId: string) {
  const { data: ev } = await loose.from("workflow_events").select("id, job_id, event_type, details").eq("id", eventId).maybeSingle();
  if (!ev || ev.event_type !== AI_EMAIL_DRAFT_EVENT || !ev.job_id) throw new Error("That draft wasn't found.");
  const { data: done } = await loose.from("workflow_events").select("event_type").in("event_type", [AI_EMAIL_DRAFT_SENT_EVENT, AI_EMAIL_DRAFT_DISCARDED_EVENT]).contains("details", { draft_event_id: eventId }).limit(1);
  if ((done ?? []).length) throw new Error(done![0]!.event_type === AI_EMAIL_DRAFT_SENT_EVENT ? "This reply was already sent." : "This draft was discarded.");
  return ev as { id: string; job_id: string; details: Record<string, unknown> };
}

export async function sendAiDraft(eventId: string, body: string, actorId: string, now = new Date()): Promise<{ status: string }> {
  const quiet = aiSendQuietReason(now.toISOString());
  if (quiet) throw new Error(quiet);
  const problems = aiReplyProblems(body);
  if (problems.length) throw new Error(problems.join(" "));
  const ev = await openDraft(eventId);
  const { data: job } = await admin.from("jobs").select("id, source, owner_id").eq("id", ev.job_id).maybeSingle();
  if (!job) throw new Error("Job not found.");
  const { data: owner } = job.owner_id ? await admin.from("owners").select("email").eq("id", job.owner_id).maybeSingle() : { data: null };
  const to = (owner?.email ?? String(ev.details["to"] ?? "")).trim();
  if (!to) throw new Error("This owner has no email address.");
  const K = await import("./email-kit.core");
  const subject = String(ev.details["subject"] ?? replySubject(null));
  const key = `${aiDraftKey(String(ev.details["message_id"]))}:send:${eventId}`;
  const build = (unsubscribe: string | null, test = false) => ({
    subject,
    html: aiReplyEmailHtml(body, { subject, unsubscribe, test }),
    text: K.plainText(aiReplyText(body), { testLabel: test, unsubscribe }),
  });
  let status: string;
  if (job.source === "qa_test") {
    const mail = build(null, true);
    const { sendTestEmail } = await import("./test-send.server");
    const r = await sendTestEmail({ jobId: job.id, jobSource: job.source, partnerIsTest: false, label: `${AI_EMAIL_REPLY_PURPOSE}:${key}`, actorId }, to, mail.subject, mail.html, mail.text);
    status = r.status === "sent" ? "sent" : `test-send ${r.status}: ${r.detail}`;
  } else {
    await (await import("./comms.server")).assertCustomerDeliveryAllowed(job.id, "Email reply");
    status = await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId: job.id, jobSource: job.source, to, purpose: AI_EMAIL_REPLY_PURPOSE, key, build: (u) => build(u) });
  }
  const sent = status === "sent" || status.startsWith("delivery uncertain");
  if (!sent) throw new Error(`Not sent — ${status}`);
  await loose.from("workflow_events").insert({ job_id: job.id, actor_id: actorId, event_type: AI_EMAIL_DRAFT_SENT_EVENT, internal: true,
    summary: `Email reply sent to the owner (approved by office)`, details: { draft_event_id: eventId, to, subject, body: body.trim(), status, idempotency_key: key } });
  await admin.from("job_communications").insert({ job_id: job.id, channel: "email", direction: "outbound", provider: "resend", subject, body: body.trim(), recipients: [to] as never,
    delivery_status: "sent", sent_at: new Date().toISOString(), visibility: "customer", created_by: actorId, source_event: AI_EMAIL_DRAFT_SENT_EVENT, source_reference: eventId }).then(({ error }) => { if (error) console.error("AI reply not added to history", error.message); });
  return { status };
}

export async function discardAiDraft(eventId: string, actorId: string): Promise<void> {
  const ev = await openDraft(eventId);
  const { error } = await loose.from("workflow_events").insert({ job_id: ev.job_id, actor_id: actorId, event_type: AI_EMAIL_DRAFT_DISCARDED_EVENT, internal: true,
    summary: "AI reply draft discarded by office", details: { draft_event_id: eventId } });
  if (error) throw new Error(error.message);
}

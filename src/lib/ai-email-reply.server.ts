// AI email replies on each job (Jo 26 Oct 2026) — see ai-email-reply.core for the rules.
// writeAiReplyDraft: reads the job's facts, stage and full email history, asks the AI for a fresh reply and saves it as
// ONE `email_ai_draft` event on the job (one per Outlook message). Never sends. Best-effort: never throws to the copier.
// sendAiDraft / discardAiDraft: office-only, from the job page. Send goes through the guarded owner sender (TEST jobs →
// TEST inbox only), with a per-draft once-only key so the same email can never go twice.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailMessage } from "./outlook-correspondence.core";
import {
  AI_EMAIL_DRAFTS_ENABLED, NO_REPLY_NEEDED, AI_EMAIL_DRAFT_DISCARDED_EVENT, AI_EMAIL_DRAFT_EDITED_EVENT, latestDraftEdits, AI_EMAIL_DRAFT_EVENT, AI_EMAIL_DRAFT_SENT_EVENT, AI_EMAIL_REPLY_PURPOSE, AI_REPLY_INSTRUCTIONS, aiReplyInstructions, isPreRelease,
  aiDraftKey, aiReplyEmailHtml, aiReplyProblems, aiReplyText, bookingChangeLink, buildAiReplyInput, finishAiReply, replySubject, type AiReplyKind,
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
    // Decision 388: anything short of a released AND confirmed spot gets the spot-only prompt; an unreadable state counts as not released.
    const { spotReleaseStates } = await import("./spot-release.server");
    const preRelease = isPreRelease((await spotReleaseStates([p.jobId]).catch(() => null))?.get(p.jobId) ?? null);
    const lines: string[] = [];
    lines.push(facts.spotSaved ? "Their spot is saved." : "Their spot is not saved yet.");
    if (facts.questionsAnswered) lines.push("They have answered the insulation questions.");
    if (preRelease) { /* no visit talk before release */ } else if (facts.nextVisit) lines.push(`Next booked visit: ${facts.nextVisit.kind === "piesa" ? "Pre Insulation Electrical Safety Assessment (PIESA)" : facts.nextVisit.kind === "install" ? "install day" : "Ready Check"} on ${slotText(facts.nextVisit.slot)}.`);
    else lines.push("No visit is booked right now.");
    if (facts.quoteStatus) lines.push(`Quote: ${facts.quoteStatus === "issued" ? "sent, waiting for them to accept" : facts.quoteStatus}.`);
    lines.push(...(await estimateFacts(p.jobId)));
    // Jo 27 Oct 2026: the save link is the Save my spot page (/campaign), never the photo upload page.
    const saveLink = facts.questionsLink ? facts.questionsLink.replace(/\/video$/, "/campaign") : null;
    const links = [
      ...(facts.myJobLink ? [{ label: "Their job page (status, quote, bookings)", url: facts.myJobLink }] : []),
      ...(saveLink && !facts.spotSaved ? [{ label: "Save my free spot", url: saveLink }] : []),
    ];
    const input = buildAiReplyInput({
      jobNumber: job.job_number, ownerFirstName: firstNameOf(owner.full_name), stageLabel: (STAGE_LABEL as Record<string, string>)[job.stage] ?? job.stage,
      facts: lines, links, changeLink: bookingChangeLink(facts.myJobLink, job.stage),
      history: ((hist ?? []) as { direction: string; subject: string | null; body: string; received_at: string | null; sent_at: string | null; created_at: string }[])
        .map((h) => ({ direction: h.direction === "outbound" ? "outbound" as const : "inbound" as const, at: h.received_at ?? h.sent_at ?? h.created_at, subject: h.subject, body: h.body ?? "" })),
      email: { from: m.from, subject: m.subject, body: m.body },
    }, { preRelease });
    const raw = await aiText(input, aiReplyInstructions({ preRelease }));
    const noReply = raw.trim().replace(/[.\s]+$/, "") === NO_REPLY_NEEDED;
    const body = noReply ? "" : finishAiReply(raw);
    // Checked again on Send; a draft that fails is still saved so the office can reword it.
    const problems = noReply ? [] : aiReplyProblems(body, { preRelease });
    const { data: ins, error } = await loose.from("workflow_events").insert({ job_id: p.jobId, actor_id: null, event_type: AI_EMAIL_DRAFT_EVENT, internal: true,
      summary: noReply ? "No reply needed (owner said no thanks / thanks)" : `AI reply draft waiting for Jo (${p.kind === "simple" ? "simple email" : "needs a check"})`,
      details: { message_id: m.providerMessageId, thread_id: m.threadId, from: m.from, to: owner.email.trim(), their_subject: m.subject, subject: replySubject(m.subject),
        body, kind: p.kind, reason: p.reason, ...(problems.length ? { problems } : {}), idempotency_key: aiDraftKey(m.providerMessageId), ...(noReply ? { no_reply_needed: true } : {}) } }).select("id").single();
    if (error) throw new Error(error.message);
    // Jo 27 Oct 2026: a plain "no thanks" or "thanks" gets no reply; the draft is closed so the card just needs Done.
    if (noReply && ins) await loose.from("workflow_events").insert({ job_id: p.jobId, actor_id: null, event_type: AI_EMAIL_DRAFT_DISCARDED_EVENT, internal: true,
      summary: "No reply needed — filed away", details: { draft_event_id: (ins as { id: string }).id } });
    return "drafted";
  } catch (e) {
    console.error("AI reply draft skipped", e instanceof Error ? e.message : e);
    return "skipped";
  }
}

/** Their estimate in plain words for the AI (Jo 27 Oct 2026: replies must be specific to the job). */
async function estimateFacts(jobId: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const { data: spot } = await loose.from("lead_campaign_responses").select("spot_saved_at, saved_area_m2, saved_total, saved_veu_discount, saved_gross_total, saved_insulation").eq("job_id", jobId).maybeSingle();
    const s = spot as { spot_saved_at: string | null; saved_area_m2: number | null; saved_total: number | null; saved_veu_discount: number | null; saved_gross_total: number | null; saved_insulation: string | null } | null;
    const money = (n: number) => `$${Math.round(Number(n)).toLocaleString("en-AU")}`;
    const ins = (v: string | null | undefined) => v === "none" ? "no existing insulation" : v === "present" ? "some existing insulation" : v ? "existing insulation not known yet" : null;
    if (s?.spot_saved_at && s.saved_total != null) {
      out.push(`Saved price: ${s.saved_area_m2 != null ? `${Number(s.saved_area_m2)} m² ceiling, ` : ""}${money(s.saved_total)} after the ${money(s.saved_veu_discount ?? 0)} rebate${s.saved_gross_total != null ? ` (${money(s.saved_gross_total)} before)` : ""}, including GST.`);
      if (ins(s.saved_insulation)) out.push(`They told us: ${ins(s.saved_insulation)}.`);
      return out;
    }
    const { data: link } = await loose.from("customer_estimate_links").select("current_estimate_id").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle();
    const estId = (link as { current_estimate_id: string | null } | null)?.current_estimate_id;
    if (!estId) return out;
    const { data: est } = await loose.from("indicative_estimates").select("area_m2, insulation_declared, scenarios").eq("id", estId).maybeSingle();
    const e = est as { area_m2: number | null; insulation_declared: string | null; scenarios: { key: string; by_access?: { standard?: { pre_discount_total?: number; applied_discount?: number; estimated_customer_total?: number } } }[] | null } | null;
    const std = (e?.scenarios ?? []).find((x) => x.key === "can_remain")?.by_access?.standard ?? (e?.scenarios ?? [])[0]?.by_access?.standard;
    if (e && std?.estimated_customer_total != null) out.push(`Estimate: ${e.area_m2 != null ? `${Number(e.area_m2)} m² ceiling, ` : ""}${money(std.estimated_customer_total)} after the ${money(std.applied_discount ?? 0)} rebate (${money(std.pre_discount_total ?? 0)} before), including GST, if existing insulation can stay.`);
    if (ins(e?.insulation_declared)) out.push(`They told us: ${ins(e?.insulation_declared)}.`);
  } catch (err) { console.error("estimate facts skipped", err instanceof Error ? err.message : err); }
  return out;
}

export type AiDraftRow = { eventId: string; at: string; from: string | null; to: string; subject: string; theirSubject: string | null; body: string; kind: AiReplyKind; status: "waiting" | "sent" | "discarded"; doneAt: string | null };

/** Saved edits for these drafts: draft id -> newest body. */
export async function draftEditsFor(ids: string[]): Promise<Map<string, string>> {
  const out: { created_at: string; details: { draft_event_id?: string; body?: string } | null }[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const { data, error } = await loose.from("workflow_events").select("created_at, details").eq("event_type", AI_EMAIL_DRAFT_EDITED_EVENT).in("details->>draft_event_id", ids.slice(i, i + 50));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as typeof out));
  }
  return latestDraftEdits(out);
}

/** Save the office's edit to an open draft (job or no-job). Nothing is sent. */
export async function saveDraftEdit(eventId: string, body: string, actorId: string): Promise<{ ok: true }> {
  const { data: ev } = await loose.from("workflow_events").select("id, job_id, event_type").eq("id", eventId).maybeSingle();
  if (!ev || (ev.event_type !== AI_EMAIL_DRAFT_EVENT && ev.event_type !== "email_nojob_ai_draft")) throw new Error("That draft wasn't found.");
  const { data: done } = await loose.from("workflow_events").select("event_type").in("event_type", [AI_EMAIL_DRAFT_SENT_EVENT, AI_EMAIL_DRAFT_DISCARDED_EVENT, "email_nojob_reply_sent", "email_nojob_ai_draft_closed"]).eq("details->>draft_event_id", eventId).limit(1);
  if ((done ?? []).length) throw new Error("This reply has already been sent or closed.");
  const { error } = await loose.from("workflow_events").insert({ job_id: ev.job_id ?? null, actor_id: actorId, event_type: AI_EMAIL_DRAFT_EDITED_EVENT, internal: true,
    summary: "Reply draft edited by office", details: { draft_event_id: eventId, body } });
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function listAiDrafts(jobId: string): Promise<AiDraftRow[]> {
  const [d, done] = await Promise.all([
    loose.from("workflow_events").select("id, created_at, details").eq("job_id", jobId).eq("event_type", AI_EMAIL_DRAFT_EVENT).order("created_at", { ascending: false }).limit(50),
    loose.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId).in("event_type", [AI_EMAIL_DRAFT_SENT_EVENT, AI_EMAIL_DRAFT_DISCARDED_EVENT]).limit(200),
  ]);
  if (d.error) throw new Error(d.error.message);
  const edits = await draftEditsFor(((d.data ?? []) as { id: string }[]).map((r) => r.id));
  const res = new Map<string, { type: string; at: string }>();
  for (const r of (done.data ?? []) as { event_type: string; created_at: string; details: { draft_event_id?: string } }[]) if (r.details?.draft_event_id) res.set(r.details.draft_event_id, { type: r.event_type, at: r.created_at });
  return ((d.data ?? []) as { id: string; created_at: string; details: Record<string, unknown> }[]).map((r) => {
    const x = res.get(r.id); const det = r.details;
    return { eventId: r.id, at: r.created_at, from: (det["from"] as string) ?? null, to: String(det["to"] ?? ""), subject: String(det["subject"] ?? ""), theirSubject: (det["their_subject"] as string) ?? null,
      body: edits.get(r.id) ?? String(det["body"] ?? ""), kind: det["kind"] === "simple" ? "simple" : "other", status: x ? (x.type === AI_EMAIL_DRAFT_SENT_EVENT ? "sent" : "discarded") : "waiting", doneAt: x?.at ?? null };
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
  // Jo 27 Oct 2026: the office presses Send, so it goes whenever she chooses — no after-8pm hold on manual sends.
  void now;
  const basic = aiReplyProblems(body);
  if (basic.length) throw new Error(basic.join(" "));
  const ev = await openDraft(eventId);
  const { data: job } = await admin.from("jobs").select("id, source, owner_id").eq("id", ev.job_id).maybeSingle();
  if (!job) throw new Error("Job not found.");
  // Decision 388: owners not yet released and confirmed get spot-only wording, checked again here (unreadable state = not released).
  const { spotReleaseStates } = await import("./spot-release.server");
  const preRelease = isPreRelease((await spotReleaseStates([job.id]).catch(() => null))?.get(job.id) ?? null);
  const problems = aiReplyProblems(body, { preRelease });
  if (problems.length) throw new Error(problems.join(" "));
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
  await (await import("./outlook-sync.server")).archiveOutlookMessage(String(ev.details["message_id"] ?? "") || null, job.id, actorId);
  return { status };
}

export async function discardAiDraft(eventId: string, actorId: string): Promise<void> {
  const ev = await openDraft(eventId);
  const { error } = await loose.from("workflow_events").insert({ job_id: ev.job_id, actor_id: actorId, event_type: AI_EMAIL_DRAFT_DISCARDED_EVENT, internal: true,
    summary: "AI reply draft discarded by office", details: { draft_event_id: eventId } });
  if (error) throw new Error(error.message);
}

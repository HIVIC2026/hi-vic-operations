// AI email replies on each job (Jo 26 Oct 2026) — see ai-email-reply.core for the rules.
// writeAiReplyDraft: reads the job's facts, stage and full email history, asks the AI for a fresh reply and saves it as
// ONE `email_ai_draft` event on the job (one per Outlook message). Never sends. Best-effort: never throws to the copier.
// sendAiDraft / discardAiDraft: office-only, from the job page. Send goes through the guarded owner sender (TEST jobs →
// TEST inbox only), with a per-draft once-only key so the same email can never go twice.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailMessage } from "./outlook-correspondence.core";
import {
  AI_EMAIL_DRAFTS_ENABLED, NO_REPLY_NEEDED, AI_EMAIL_DRAFT_DISCARDED_EVENT, AI_EMAIL_DRAFT_EDITED_EVENT, latestDraftEdits, AI_EMAIL_DRAFT_EVENT, AI_EMAIL_DRAFT_SENT_EVENT, AI_EMAIL_REPLY_PURPOSE, AI_REPLY_INSTRUCTIONS, aiReplyInstructions, isPreReleaseOwner,
  aiDraftKey, aiReplyEmailHtml, aiReplyProblems, aiReplyText, bookingChangeLink, buildAiReplyInput, draftActions, draftNeeds, finishAiReply, fixUntilClean, higherRFacts, newSizeFacts, replySubject, splitAiOutput, type AiActions, type AiReplyKind,
} from "./ai-email-reply.core";
import { loadAiAnswers } from "./ai-answers.server";
import { loadStyleExamples } from "./ai-style.server";
import type { StyleExample } from "./ai-style.core";

const loose = admin as unknown as SupabaseClient;

/** Decision 388: is this job's owner still before release? Read fresh each time (draft creation and Send). Unreadable = pre-release only for our own early-stage leads.
 *  `known`: the job's channel/stage already read by the caller (Send), so a failing second read can't make it fail open. */
export async function preReleaseFor(jobId: string, known?: { channel: string | null; stage: string | null }): Promise<boolean> {
  const job = known ?? (await admin.from("jobs").select("channel, stage").eq("id", jobId).maybeSingle()).data;
  if (!job) return false;
  const { spotReleaseStates } = await import("./spot-release.server");
  const releaseState = (await spotReleaseStates([jobId]).catch(() => null))?.get(jobId) ?? null;
  return isPreReleaseOwner({ channel: job.channel, stage: job.stage, releaseState });
}

/** The AI call shared by job replies and the Emails tab no-job replies (decision 414). */
export async function aiText(input: string, instructions: string = AI_REPLY_INSTRUCTIONS, abortSignal?: AbortSignal): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured");
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { streamText } = await import("ai");
  const provider = createOpenAI({ baseURL: "https://ai.gateway.lovable.dev/v1", apiKey: key, headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" } });
  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    instructions,
    messages: [{ role: "user", content: input }],
    ...(abortSignal ? { abortSignal } : {}),
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
    const preRelease = await preReleaseFor(p.jobId);
    const lines: string[] = [];
    lines.push(facts.spotSaved ? "Their spot is saved." : "Their spot is not saved yet.");
    if (facts.questionsAnswered) lines.push("They have answered the insulation questions.");
    if (preRelease) { /* no visit talk before release */ } else if (facts.nextVisit) lines.push(`Next booked visit: ${facts.nextVisit.kind === "piesa" ? "Pre Insulation Electrical Safety Assessment (PIESA)" : facts.nextVisit.kind === "install" ? "install day" : "Ready Check"} on ${slotText(facts.nextVisit.slot)}.`);
    else lines.push("No visit is booked right now.");
    if (facts.quoteStatus) lines.push(`Quote: ${facts.quoteStatus === "issued" ? "sent, waiting for them to accept" : facts.quoteStatus}.`);
    const est = await estimateFacts(p.jobId);
    lines.push(...est.lines);
    // Jo 27 Oct 2026: the save link is the Save my spot page (/campaign), never the photo upload page.
    const saveLink = facts.questionsLink ? facts.questionsLink.replace(/\/video$/, "/campaign") : null;
    const links = [
      ...(facts.myJobLink ? [{ label: "Their job page (status, quote, bookings)", url: facts.myJobLink }] : []),
      ...(saveLink && !facts.spotSaved ? [{ label: "Save my free spot", url: saveLink }] : []),
    ];
    // Step 3: Jo's recent replies as style examples; any failure just means no examples.
    const [answersRes, style] = await Promise.all([loadAiAnswers(), loadStyleExamples(p.jobId, m.body).catch(() => [] as StyleExample[])]);
    const answers = answersRes.answers;
    const inputWith = (factLines: string[]) => buildAiReplyInput({
      jobNumber: job.job_number, ownerFirstName: firstNameOf(owner.full_name), stageLabel: (STAGE_LABEL as Record<string, string>)[job.stage] ?? job.stage,
      facts: factLines, links, changeLink: bookingChangeLink(facts.myJobLink, job.stage),
      history: ((hist ?? []) as { direction: string; subject: string | null; body: string; received_at: string | null; sent_at: string | null; created_at: string }[])
        .map((h) => ({ direction: h.direction === "outbound" ? "outbound" as const : "inbound" as const, at: h.received_at ?? h.sent_at ?? h.created_at, subject: h.subject, body: h.body ?? "" })),
      email: { from: m.from, subject: m.subject, body: m.body },
    }, { preRelease, answers, style });
    // The AI's notes to the office (NEEDS_JO / NEEDS_YOU / ACTIONS lines) come off first, so they never reach the fix loop or the owner.
    // The owner's first name: an installer note that names them is dropped (installers get owner details only once they accept).
    const ownerFirstName = firstNameOf(owner.full_name);
    let out = splitAiOutput(await aiText(inputWith(lines), aiReplyInstructions({ preRelease })), { ownerFirstName });
    // The owner gave a new ceiling size: price that size and write the reply once more, so it quotes their size.
    // The second pass's body and note are kept; its flags are merged with the first pass's (a "Needs you" or question
    // seen once is never lost — step 4 never auto-sends those); a size other than the one just priced is dropped.
    // If the second pass fails, the first draft stands, without its size: that draft never quoted the new size's prices.
    const size = out.actions.newAreaM2;
    if (size != null && size !== est.areaM2) {
      const extra = await newSizePriceFacts(p.jobId, size);
      if (extra.length) {
        try {
          const second = splitAiOutput(await aiText(inputWith([...lines, ...extra]), aiReplyInstructions({ preRelease })), { ownerFirstName });
          const actions = { ...second.actions };
          if (actions.newAreaM2 !== size) delete actions.newAreaM2;
          out = { body: second.body, needsYou: out.needsYou || second.needsYou, needsAnswer: [...new Set([...out.needsAnswer, ...second.needsAnswer])], actions };
        } catch (e) {
          console.error("AI reply new-size pass skipped", e instanceof Error ? e.message : e);
          const { newAreaM2: _dropped, ...rest } = out.actions; void _dropped;
          out = { ...out, actions: rest };
        }
      }
    }
    const noReply = out.body.replace(/[.\s]+$/, "") === NO_REPLY_NEEDED;
    // A draft that breaks a rule is rewritten (at most twice) before it is saved; what still fails is saved with it for the office.
    const first = noReply ? "" : finishAiReply(out.body);
    const fixed = noReply ? { body: "", problems: [] as string[] } : await fixUntilClean(first, preRelease, (i, ins) => aiText(i, ins, AbortSignal.timeout(25_000)), { aiDraft: true });
    const body = fixed.body;
    const problems = fixed.problems;
    const { data: ins, error } = await loose.from("workflow_events").insert({ job_id: p.jobId, actor_id: null, event_type: AI_EMAIL_DRAFT_EVENT, internal: true,
      summary: noReply ? "No reply needed (owner said thanks)" : `AI reply draft waiting for Jo (${p.kind === "simple" ? "simple email" : "needs a check"})`,
      details: { message_id: m.providerMessageId, thread_id: m.threadId, from: m.from, to: owner.email.trim(), their_subject: m.subject, subject: replySubject(m.subject),
        body, kind: p.kind, reason: p.reason, ...(problems.length ? { problems } : {}),
        ...(!noReply && out.needsAnswer.length ? { needs_answer: out.needsAnswer } : {}), ...(!noReply && out.needsYou ? { needs_you: true } : {}),
        ...(!noReply && Object.keys(out.actions).length ? { actions: out.actions } : {}), idempotency_key: aiDraftKey(m.providerMessageId), ...(noReply ? { no_reply_needed: true } : {}) } }).select("id").single();
    if (error) throw new Error(error.message);
    // Jo 27 Oct 2026: a plain "thanks" gets no reply; the draft is closed so the card just needs Done.
    if (noReply && ins) await loose.from("workflow_events").insert({ job_id: p.jobId, actor_id: null, event_type: AI_EMAIL_DRAFT_DISCARDED_EVENT, internal: true,
      summary: "No reply needed — filed away", details: { draft_event_id: (ins as { id: string }).id } });
    return "drafted";
  } catch (e) {
    console.error("AI reply draft skipped", e instanceof Error ? e.message : e);
    return "skipped";
  }
}

/** The office-set owner R5.0 price per m² ($30 if the settings can't be read). */
async function ownerR5Rate(): Promise<number> {
  const s = await (await import("./estimate.server")).currentRetailSettings().catch(() => null);
  const r = Number(s?.r5_install_inc_gst_per_m2);
  return r > 0 ? r : 30;
}

/** R5.0 / R6.0 / R7.0 prices for a size the owner gave by email; [] when the job's location or settings can't be read. */
async function newSizePriceFacts(jobId: string, areaM2: number): Promise<string[]> {
  try {
    const { data: j } = await admin.from("jobs").select("properties(postcode)").eq("id", jobId).maybeSingle();
    const postcode = String((j?.properties as { postcode: string | null } | null)?.postcode ?? "").trim();
    if (!postcode) return [];
    const [{ data: loc }, settings] = await Promise.all([
      loose.from("veu_location_variables").select("*").eq("postcode", postcode).maybeSingle(),
      (await import("./estimate.server")).currentRetailSettings(),
    ]);
    if (!loc || !settings) return [];
    const { whatIfEstimate } = await import("./estimate.core");
    const std = whatIfEstimate(areaM2, loc as never, null, settings)?.primary.by_access.standard;
    if (!std) return [];
    return newSizeFacts(areaM2, { before: std.pre_discount_total, rebate: std.applied_discount, after: std.estimated_customer_total }, Number(settings.r5_install_inc_gst_per_m2));
  } catch (e) { console.error("new size prices skipped", e instanceof Error ? e.message : e); return []; }
}

/** The job's AI-reply notes for the installer, newest first (installer job page and Ready Check texts). Never throws. */
export async function installerNotes(jobId: string): Promise<string[]> {
  try {
    const { data, error } = await loose.from("workflow_events").select("details, created_at").eq("job_id", jobId).eq("event_type", INSTALLER_NOTE_EVENT).order("created_at", { ascending: false }).limit(20);
    if (error) return [];
    return ((data ?? []) as { details: { note?: unknown } | null }[]).map((r) => (typeof r.details?.note === "string" ? r.details.note.trim() : "")).filter(Boolean);
  } catch { return []; }
}

/** Their estimate in plain words for the AI (Jo 27 Oct 2026: replies must be specific to the job), plus R6.0 / R7.0
 *  prices for the same size. `areaM2`: the size those prices are for (null when unknown). */
async function estimateFacts(jobId: string): Promise<{ lines: string[]; areaM2: number | null }> {
  const out: string[] = [];
  let areaM2: number | null = null;
  try {
    const { data: spot } = await loose.from("lead_campaign_responses").select("spot_saved_at, saved_area_m2, saved_total, saved_veu_discount, saved_gross_total, saved_insulation").eq("job_id", jobId).maybeSingle();
    const s = spot as { spot_saved_at: string | null; saved_area_m2: number | null; saved_total: number | null; saved_veu_discount: number | null; saved_gross_total: number | null; saved_insulation: string | null } | null;
    const money = (n: number) => `$${Math.round(Number(n)).toLocaleString("en-AU")}`;
    const ins = (v: string | null | undefined) => v === "none" ? "no existing insulation" : v === "present" ? "some existing insulation" : v ? "existing insulation not known yet" : null;
    if (s?.spot_saved_at && s.saved_total != null) {
      out.push(`Saved price: ${s.saved_area_m2 != null ? `${Number(s.saved_area_m2)} m² ceiling, ` : ""}${money(s.saved_total)} after the ${money(s.saved_veu_discount ?? 0)} rebate${s.saved_gross_total != null ? ` (${money(s.saved_gross_total)} before)` : ""}, including GST.`);
      if (s.saved_area_m2 != null) {
        areaM2 = Number(s.saved_area_m2);
        const rebate = Number(s.saved_veu_discount ?? 0);
        out.push(...higherRFacts(areaM2, { before: s.saved_gross_total != null ? Number(s.saved_gross_total) : Number(s.saved_total) + rebate, rebate }, await ownerR5Rate()));
      }
      if (ins(s.saved_insulation)) out.push(`They told us: ${ins(s.saved_insulation)}.`);
      return { lines: out, areaM2 };
    }
    const { data: link } = await loose.from("customer_estimate_links").select("current_estimate_id").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle();
    const estId = (link as { current_estimate_id: string | null } | null)?.current_estimate_id;
    if (!estId) return { lines: out, areaM2 };
    const { data: est } = await loose.from("indicative_estimates").select("area_m2, insulation_declared, scenarios").eq("id", estId).maybeSingle();
    const e = est as { area_m2: number | null; insulation_declared: string | null; scenarios: { key: string; by_access?: { standard?: { pre_discount_total?: number; applied_discount?: number; estimated_customer_total?: number } } }[] | null } | null;
    const std = (e?.scenarios ?? []).find((x) => x.key === "can_remain")?.by_access?.standard ?? (e?.scenarios ?? [])[0]?.by_access?.standard;
    if (e && std?.estimated_customer_total != null) {
      out.push(`Estimate: ${e.area_m2 != null ? `${Number(e.area_m2)} m² ceiling, ` : ""}${money(std.estimated_customer_total)} after the ${money(std.applied_discount ?? 0)} rebate (${money(std.pre_discount_total ?? 0)} before), including GST, if existing insulation can stay.`);
      if (e.area_m2 != null && std.pre_discount_total != null) {
        areaM2 = Number(e.area_m2);
        out.push(...higherRFacts(areaM2, { before: Number(std.pre_discount_total), rebate: Number(std.applied_discount ?? 0) }, await ownerR5Rate()));
      }
    }
    if (ins(e?.insulation_declared)) out.push(`They told us: ${ins(e?.insulation_declared)}.`);
  } catch (err) { console.error("estimate facts skipped", err instanceof Error ? err.message : err); }
  return { lines: out, areaM2 };
}

export type AiDraftRow = { eventId: string; at: string; from: string | null; to: string; subject: string; theirSubject: string | null; body: string; kind: AiReplyKind; status: "waiting" | "sent" | "discarded"; doneAt: string | null; needsAnswer: string[]; needsYou: boolean; actions: AiActions };

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
    const x = res.get(r.id); const det = r.details; const needs = draftNeeds(det);
    return { eventId: r.id, at: r.created_at, from: (det["from"] as string) ?? null, to: String(det["to"] ?? ""), subject: String(det["subject"] ?? ""), theirSubject: (det["their_subject"] as string) ?? null,
      body: edits.get(r.id) ?? String(det["body"] ?? ""), kind: det["kind"] === "simple" ? "simple" : "other", status: x ? (x.type === AI_EMAIL_DRAFT_SENT_EVENT ? "sent" : "discarded") : "waiting", doneAt: x?.at ?? null,
      needsAnswer: needs.needsAnswer, needsYou: needs.needsYou, actions: draftActions(det) };
  });
}

async function openDraft(eventId: string) {
  const { data: ev } = await loose.from("workflow_events").select("id, job_id, event_type, details").eq("id", eventId).maybeSingle();
  if (!ev || ev.event_type !== AI_EMAIL_DRAFT_EVENT || !ev.job_id) throw new Error("That draft wasn't found.");
  const { data: done } = await loose.from("workflow_events").select("event_type").in("event_type", [AI_EMAIL_DRAFT_SENT_EVENT, AI_EMAIL_DRAFT_DISCARDED_EVENT]).contains("details", { draft_event_id: eventId }).limit(1);
  if ((done ?? []).length) throw new Error(done![0]!.event_type === AI_EMAIL_DRAFT_SENT_EVENT ? "This reply was already sent." : "This draft was discarded.");
  return ev as { id: string; job_id: string; details: Record<string, unknown> };
}

/** Which of the draft's proposed actions Jo left ticked. Nothing is applied unless ticked. */
export type SendApply = { applyNote: boolean; applyArea: boolean };
export const INSTALLER_NOTE_EVENT = "installer_note";
export const CEILING_SIZE_FROM_EMAIL_EVENT = "ceiling_size_updated_from_email";

export async function sendAiDraft(eventId: string, body: string, actorId: string, apply: SendApply = { applyNote: false, applyArea: false }, now = new Date()): Promise<{ status: "sent" | `delivery uncertain${string}` } | { status: "rewritten"; body: string; problems: string[] }> {
  // Jo 27 Oct 2026: the office presses Send, so it goes whenever she chooses — no after-8pm hold on manual sends.
  void now;
  const ev = await openDraft(eventId);
  const { data: job } = await admin.from("jobs").select("id, source, owner_id, channel, stage, estimated_area_m2").eq("id", ev.job_id).maybeSingle();
  if (!job) throw new Error("Job not found.");
  // Decision 388: owners not yet released and confirmed get spot-only wording, checked again here (unreadable state = not released),
  // from the job just read (never a second read that could fail open).
  const preRelease = await preReleaseFor(job.id, { channel: job.channel ?? null, stage: job.stage ?? null });
  // A draft that breaks a rule is never sent: it is rewritten, saved for Jo to check, and she presses Send again.
  if (aiReplyProblems(body).length || aiReplyProblems(body, { preRelease }).length) {
    const fixed = await fixUntilClean(body, preRelease, (i, ins) => aiText(i, ins, AbortSignal.timeout(25_000)));
    await saveDraftEdit(eventId, fixed.body, actorId);
    return { status: "rewritten", body: fixed.body, problems: fixed.problems };
  }
  const { data: owner } = job.owner_id ? await admin.from("owners").select("email, full_name").eq("id", job.owner_id).maybeSingle() : { data: null };
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
  // Jo 28 Oct 2026: replies leave from the info@ Outlook mailbox as a reply to the owner's email (so Jo sees them in Sent
  // Items). Real and TEST jobs both use the guarded sender; it sends TEST jobs to the test address only, as a new message.
  let outlook: { messageId: string | null; internetMessageId: string | null } | null = null;
  if (job.source !== "qa_test") await (await import("./comms.server")).assertCustomerDeliveryAllowed(job.id, "Email reply");
  const status = await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId: job.id, jobSource: job.source, to, purpose: AI_EMAIL_REPLY_PURPOSE, key, build: (u) => build(u, job.source === "qa_test"),
    retryAfterDefiniteFailure: true, transport: { kind: "outlook", replyToMessageId: String(ev.details["message_id"] ?? "") || null }, onSent: (r) => { outlook = { messageId: r.messageId, internetMessageId: r.internetMessageId }; } });
  if (status === "failed: Outlook couldn't send it") throw new Error("Not sent — Outlook couldn't send it. Try again.");
  const sent = status === "sent" || status.startsWith("delivery uncertain");
  if (!sent) throw new Error(`Not sent — ${status}`);
  await loose.from("workflow_events").insert({ job_id: job.id, actor_id: actorId, event_type: AI_EMAIL_DRAFT_SENT_EVENT, internal: true,
    summary: `Email reply sent to the owner (approved by office)`, details: { draft_event_id: eventId, to, subject, body: body.trim(), status, idempotency_key: key } });
  await admin.from("job_communications").insert({ job_id: job.id, channel: "email", direction: "outbound", provider: "outlook", provider_message_id: (outlook as { messageId: string | null } | null)?.messageId ?? null, subject, body: body.trim(), recipients: [to] as never,
    delivery_status: "sent", sent_at: new Date().toISOString(), visibility: "customer", created_by: actorId, source_event: AI_EMAIL_DRAFT_SENT_EVENT, source_reference: (outlook as { internetMessageId: string | null } | null)?.internetMessageId ?? eventId }).select("id").single().then(async ({ data: hist, error }) => {
      if (error || !hist) { console.error("AI reply not added to history", error?.message ?? "no row"); return; }
      // Final review 3: link the guard's send row to this history row so contact history shows the reply once.
      // A failed link is logged only — the email has already gone.
      try {
        const { error: le } = await admin.from("customer_email_sends").update({ communication_id: (hist as { id: string }).id }).eq("idempotency_key", key).eq("job_id", job.id);
        if (le) console.error("AI reply send not linked to history", le.message);
      } catch (e) { console.error("AI reply send not linked to history", e instanceof Error ? e.message : "unknown"); }
    });
  await (await import("./outlook-sync.server")).archiveOutlookMessage(String(ev.details["message_id"] ?? "") || null, job.id, actorId);
  // The email went: now the actions Jo left ticked. A failure here is logged only — the reply has already gone.
  // The saved note is checked again against the owner's first name (installers get owner details only once they accept).
  const ownerFirstName = (await import("./email-reply.core")).firstNameOf((owner as { full_name?: string | null } | null)?.full_name ?? null);
  await applyDraftActions(job.id, eventId, draftActions(ev.details, ownerFirstName), apply, actorId, (job as { estimated_area_m2?: number | null }).estimated_area_m2 ?? null)
    .catch((e) => console.error("AI reply actions not applied", e instanceof Error ? e.message : e));
  return { status: status as "sent" | `delivery uncertain${string}` };
}

/** Applies the draft's ticked actions after a successful send: a note for the installer, and/or the owner's ceiling size. */
async function applyDraftActions(jobId: string, draftEventId: string, actions: AiActions, apply: SendApply, actorId: string, previousArea: number | null): Promise<void> {
  if (apply.applyNote && actions.installerNote) {
    const { error } = await loose.from("workflow_events").insert({ job_id: jobId, actor_id: actorId, event_type: INSTALLER_NOTE_EVENT, internal: true,
      summary: `Note for the installer: ${actions.installerNote}`, details: { note: actions.installerNote, source: "ai_reply", draft_event_id: draftEventId } });
    if (error) console.error("installer note not saved", error.message);
  }
  if (apply.applyArea && actions.newAreaM2 != null) {
    // Once the Ready Check has measured the ceiling, that measurement wins: the owner's emailed size is not applied.
    const { data: measured, error: mErr } = await admin.from("ceiling_measurements").select("id").eq("job_id", jobId).eq("is_current", true).limit(1);
    if (mErr) { console.error("ceiling size not updated: Ready Check measurement unreadable", mErr.message); return; }
    if ((measured ?? []).length) { console.warn(`ceiling size not updated to ${actions.newAreaM2} m²: the Ready Check has already measured job ${jobId}`); return; }
    const { error } = await admin.from("jobs").update({ estimated_area_m2: actions.newAreaM2, estimated_area_unknown: false }).eq("id", jobId);
    if (error) { console.error("ceiling size not updated", error.message); return; }
    await loose.from("workflow_events").insert({ job_id: jobId, actor_id: actorId, event_type: CEILING_SIZE_FROM_EMAIL_EVENT, internal: true,
      summary: `Ceiling size updated to ${actions.newAreaM2} m² (owner's email)`, details: { area_m2: actions.newAreaM2, previous_area_m2: previousArea == null ? null : Number(previousArea), draft_event_id: draftEventId } });
  }
}

export async function discardAiDraft(eventId: string, actorId: string): Promise<void> {
  const ev = await openDraft(eventId);
  const { error } = await loose.from("workflow_events").insert({ job_id: ev.job_id, actor_id: actorId, event_type: AI_EMAIL_DRAFT_DISCARDED_EVENT, internal: true,
    summary: "AI reply draft discarded by office", details: { draft_event_id: eventId } });
  if (error) throw new Error(error.message);
}

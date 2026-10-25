// Decision 292 (Jo 25 Oct 2026, replaces 255 for new senders): the ONE website reply to a new email sender. Called by
// the Outlook copier for unmatched human inbound mail right after decision 247's `email_unmatched` row is recorded
// (that row stays, so the office can still Match by hand). Never creates an enquiry, owner or link.
// - Decision: pure `decideNewSenderReply` (new-sender-reply.core) over read-only facts: is the address an owner,
//   partner (business, business signer, partner worker, partner applicant) or staff member; earlier
//   `email_new_sender_replied` events for the sender; the intent classifier.
// - Mode: pure `newSenderReplyMode` — NEW_SENDER_REPLY_APPROVED on; TEST mode → allow-listed sender only, through
//   test-send; live → the live email sender used for real owner emails (`resendSend`, from the office address with
//   reply-to info@) only when `customer_comms_enabled` is on AND the non-production recipient boundary allows it.
//   Never Outlook send/sendMail/reply (decision 244 forbids it); never a draft — this reply is sent.
// - Records: ONE job-less `email_new_sender_replied` per reply. Live: written BEFORE the send as the once-ever claim
//   (unique idempotency key per normalised sender address, migration new-sender-reply-events.sql — applied live 25 Oct 2026); nothing is
//   sent when it cannot be written. The delivery result goes to admin_config_events (the workflow log is append-only).
// Best-effort: never throws to the copier. Static imports stay harness-loadable (core + client only); senders and the
// comms switch are dynamic imports reached only when a send is actually due.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailMessage } from "./outlook-correspondence.core";
import {
  NEW_SENDER_REPLIED_EVENT, NEW_SENDER_REPLY_APPROVED, NEW_SENDER_REPLY_TEMPLATE, NEW_SENDER_REPLY_TEST_ONLY, NOT_KNOWN, SKIP_ALREADY_REPLIED,
  decideNewSenderReply, newSenderFirstName, newSenderReplyKey, newSenderReplyMode, newSenderTestReplyKey, normaliseSender, repliedSummary,
  type PriorReply,
} from "./new-sender-reply.core";

const loose = admin as unknown as SupabaseClient;

export type NewSenderReplyOutcome =
  | { status: "sent"; mode: "live" | "test"; detail: string }
  | { status: "held"; reason: string }
  | { status: "skipped"; reason: string };

/** The exact-address ILIKE pattern used elsewhere for sender lookups (wildcards stripped). */
const exactEmail = (email: string) => email.replace(/[%_\\,()*]/g, "");

async function recordReply(summary: string, details: Record<string, unknown>): Promise<"recorded" | "duplicate" | "not_recorded"> {
  const { error } = await loose.from("workflow_events").insert({ job_id: null, actor_id: null, event_type: NEW_SENDER_REPLIED_EVENT, internal: true, summary, details });
  if (!error) return "recorded";
  if (error.code === "23505") return "duplicate"; // the per-sender unique key: someone already claimed this sender
  // 23502 / 23514 = the new-sender-reply-events.sql migration is missing (applied live 25 Oct 2026; kept as a fail-safe for other databases): counted, not an error.
  if (error.code !== "23502" && error.code !== "23514") console.error("new sender reply not recorded", error.message);
  return "not_recorded";
}

async function knownSender(email: string) {
  const e = exactEmail(email);
  const [owners, businesses, signers, workers, applicants, staff] = await Promise.all([
    admin.from("owners").select("id").ilike("email", e).limit(1),
    admin.from("businesses").select("id").ilike("email", e).limit(1),
    admin.from("businesses").select("id").ilike("signer_email", e).limit(1),
    admin.from("partner_workers").select("id").ilike("email", e).limit(1),
    admin.from("partner_enquiries").select("id").ilike("email", e).limit(1),
    admin.from("profiles").select("id").ilike("email", e).limit(1),
  ]);
  for (const r of [owners, businesses, signers, workers, applicants, staff]) if (r.error) throw new Error(r.error.message);
  const any = (r: { data: unknown[] | null }) => (r.data ?? []).length > 0;
  return { owner: any(owners), partner: any(businesses) || any(signers) || any(workers) || any(applicants), staff: any(staff) };
}

export async function replyToNewSender(m: MailMessage, p: { mailbox: string | null; now?: Date; switches?: { approved: boolean; testOnly: boolean } } = { mailbox: null }): Promise<NewSenderReplyOutcome> {
  const now = p.now ?? new Date();
  const sw = p.switches ?? { approved: NEW_SENDER_REPLY_APPROVED, testOnly: NEW_SENDER_REPLY_TEST_ONLY };
  const mail = { direction: m.direction, from: m.from, fromName: m.fromName, subject: m.subject, body: m.body, at: m.at, providerMessageId: m.providerMessageId };
  // Cheapest guard first: junk, outbound, old, non-enquiry mail is decided without a single read.
  const first = decideNewSenderReply({ mail, known: NOT_KNOWN, priorReplies: [], now });
  if (first.kind === "skip") return { status: "skipped", reason: first.reason };
  try {
    const email = normaliseSender(m.from);
    const [known, replied] = await Promise.all([
      knownSender(email),
      loose.from("workflow_events").select("details").eq("event_type", NEW_SENDER_REPLIED_EVENT).contains("details", { from: email }).limit(20),
    ]);
    if (replied.error) throw new Error(replied.error.message);
    const priorReplies: PriorReply[] = ((replied.data ?? []) as { details: { mode?: string; message_id?: string | null } | null }[])
      .map((r) => ({ mode: r.details?.mode === "test" ? "test" as const : "live" as const, messageId: r.details?.message_id ?? null }));
    const decision = decideNewSenderReply({ mail, known, priorReplies, now });
    if (decision.kind === "skip") return { status: "skipped", reason: decision.reason };

    const needsSwitch = sw.approved && !sw.testOnly;
    const commsEnabled = needsSwitch ? await (await import("./comms.server")).customerCommsEnabled().catch(() => false) : null;
    const mode = newSenderReplyMode({ approved: sw.approved, testOnly: sw.testOnly, commsEnabled, from: email });
    if (mode.mode === "held") return { status: "held", reason: mode.reason };

    const base = {
      message_id: m.providerMessageId, internet_message_id: m.internetMessageId, thread_id: m.threadId, mailbox: p.mailbox,
      from: email, from_name: m.fromName, subject: m.subject, received_at: m.at, intents: decision.intents, template: NEW_SENDER_REPLY_TEMPLATE,
    };
    const { renderNewSenderReplyEmail } = await import("./new-sender-reply-email.core");
    const content = { theirSubject: m.subject, firstName: newSenderFirstName(m.fromName) };

    if (mode.mode === "test_send") {
      const out = renderNewSenderReplyEmail({ ...content, test: true });
      const { sendTestEmail } = await import("./test-send.server");
      const r = await sendTestEmail({ jobId: null, jobSource: null, partnerIsTest: true, label: `new_sender_reply:${NEW_SENDER_REPLY_TEMPLATE}`, actorId: null }, email, out.subject, out.html, out.text);
      if (r.status !== "sent") return { status: "held", reason: `Test send ${r.status}: ${r.detail}` };
      const rec = await recordReply(repliedSummary(email, "test"), { ...base, mode: "test", idempotency_key: newSenderTestReplyKey(m.providerMessageId), delivery: "sent", detail: r.detail });
      return { status: "sent", mode: "test", detail: rec === "recorded" ? r.detail : `${r.detail} (not recorded: pending migration)` };
    }

    // Live. The non-production recipient boundary is checked before the claim, so a blocked address never uses up its one claim.
    const { testRecipientBoundary } = await import("./comms-test-recipient.core");
    const boundary = testRecipientBoundary(email, null);
    if (boundary.status === "blocked") return { status: "held", reason: boundary.reason };
    const key = newSenderReplyKey(email);
    const claim = await recordReply(repliedSummary(email, "live"), { ...base, mode: "live", provider: "resend", idempotency_key: key });
    if (claim === "duplicate") return { status: "skipped", reason: SKIP_ALREADY_REPLIED };
    if (claim !== "recorded") return { status: "skipped", reason: "Reply not recorded (pending migration new-sender-reply-events.sql) — nothing sent" };
    const out = renderNewSenderReplyEmail(content);
    const { resendSend } = await import("./hot-leads-send.server");
    const d = await resendSend(email, out.subject, out.html, out.text, key, null).catch((e: unknown) => ({ outcome: "uncertain" as const, detail: e instanceof Error ? e.message : "send error" }));
    const failed = d.outcome === "rejected" || d.outcome === "not_attempted";
    await loose.from("admin_config_events").insert({ actor_id: null, event_type: "new_sender_reply_delivery",
      summary: `Website reply (${NEW_SENDER_REPLY_TEMPLATE}) to ${email}: ${failed ? "failed" : d.outcome === "accepted" ? "sent" : "delivery uncertain"}`,
      details: { ...base, idempotency_key: key, outcome: d.outcome, detail: d.detail, provider_message_id: "id" in d ? d.id ?? null : null } })
      .then(({ error }) => { if (error) console.error("new sender reply delivery not logged", error.message); });
    // A definite refusal is reported as held; the sender keeps their one claim (never retried automatically).
    if (failed) return { status: "held", reason: `Send failed: ${d.detail}` };
    return { status: "sent", mode: "live", detail: d.detail };
  } catch (e) {
    console.error("new sender reply skipped", e instanceof Error ? e.message : e);
    return { status: "skipped", reason: e instanceof Error ? e.message : "New sender reply failed" };
  }
}

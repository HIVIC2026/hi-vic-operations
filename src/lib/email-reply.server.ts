// Decision 244 (Jo 24 Oct 2026): inbox reply DRAFTER. For each new matched inbound Outlook email (copier sync, or the
// office's "Match this email"), and for unmatched mail from a partner or a new enquirer, write ONE reply draft into the
// shared mailbox in the same thread — Graph `createReply` then `PATCH` its body (fallback: POST /messages, a draft by
// default) through the existing connector gateway headers. Decision 250 confirmed draft create/delete on info@.
// NEVER sends: every write goes through `assertDraftOnlyRequest` (send/sendMail/reply/replyAll/forward refused) and
// no code path here calls a sender. Idempotent per Outlook message via the `email_reply_drafted` event.
// Switches: EMAIL_REPLY_DRAFTS_ENABLED (code constant, OFF) and TEST mode (allow-list sender + qa_test jobs only).
// Per-type automatic sending is NOT built (TODO in email-reply.core); only the pure `wouldAutoSend` decision is recorded.
// Best-effort: never throws to the copier or the office action. Matched mail: facts are read-only (no links minted, no
// estimates refreshed, no job changes). Decision 255: an unmatched NEW sender whose email is an enquiry or a price /
// rebate question gets the enquiry created from the email (email-enquiry.server: existing guarded intake, linked
// instead when the email is already an owner's) and the draft carries that enquiry's homeowner page — never the
// calculator. Created only behind the same switches (TEST mode: allow-listed sender → a qa_test enquiry).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OUTLOOK_REQUEST_REDIRECT, normaliseMailbox, outlookGatewayUrl, outlookMailboxPath } from "./outlook-connection.core";
import type { MailMessage } from "./outlook-correspondence.core";
import { classifyEmailIntents, recentEnoughForAction } from "./email-intent.core";
import { jobNumbersIn } from "./outlook-guess.core";
import {
  EMAIL_REPLY_DRAFTED_EVENT, EMAIL_REPLY_DRAFTS_ENABLED, EMAIL_REPLY_DRAFTS_TEST_ONLY, assertDraftOnlyRequest, composeReply, draftBlocker,
  draftCategories, isEnquiryStage, looksLikeNewEnquiry, pickReplyType, wouldAutoSend, type DueStep, type EmailEnquiryFacts, type OwnerFacts,
  type PartnerFacts, type ReplyDraft,
} from "./email-reply.core";
import { CUSTOMER_BASE } from "./engagement.core";
import { savedPriceFromEstimate } from "./launch-campaign.core";
import { isTestPartner } from "./test-send.core";

const loose = admin as unknown as SupabaseClient;
export type DraftOrigin = "sync" | "office_matched" | "unmatched";
export type DraftOutcome =
  | { status: "drafted"; draftId: string; type: ReplyDraft["type"]; checkBeforeSending: boolean; method: "createReply" | "new_message" }
  | { status: "skipped"; reason: string };

// ---------- Graph (draft-only writes) ----------
function gatewayHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]}`,
    "X-Connection-Api-Key": process.env["MICROSOFT_OUTLOOK_API_KEY"]!,
    Prefer: 'IdType="ImmutableId"',
    "Content-Type": "application/json",
  };
}

/** One draft-only Graph write. Never follows redirects; refuses any path that would send. */
async function graphDraftWrite<T>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<{ status: number; json: T | null }> {
  if (method === "DELETE") { if (!/^\/users\/[^/]+\/messages\/[^/]+$/.test(path)) throw new Error("Refused: only a just-created draft may be deleted."); }
  else assertDraftOnlyRequest(method, path);
  const res = await fetch(outlookGatewayUrl(path), {
    method, redirect: OUTLOOK_REQUEST_REDIRECT, signal: AbortSignal.timeout(20_000), headers: gatewayHeaders(),
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (res.status >= 300 && res.status < 400) throw new Error("Outlook tried to redirect; the request was not followed.");
  let json: T | null = null;
  try { json = res.status === 204 ? null : ((await res.json()) as T); } catch { json = null; }
  return { status: res.status, json };
}

type GraphDraft = { id?: string; isDraft?: boolean; body?: { contentType?: string; content?: string } };

/** Create the draft reply in the same thread; fall back to a new draft message when createReply is unavailable. */
async function writeDraft(mailbox: string, m: MailMessage, d: ReplyDraft): Promise<{ draftId: string; method: "createReply" | "new_message" }> {
  const base = `${outlookMailboxPath(mailbox)}/messages`;
  const categories = draftCategories(d);
  const created = await graphDraftWrite<GraphDraft>("POST", `${base}/${encodeURIComponent(m.providerMessageId)}/createReply`, {});
  if (created.status >= 200 && created.status < 300 && created.json?.id) {
    if (created.json.isDraft === false) throw new Error("Outlook returned a non-draft message for createReply; nothing more was done.");
    const draftId = created.json.id;
    // Keep the quoted thread Outlook put in the draft; our reply goes above it.
    const quoted = created.json.body?.contentType?.toLowerCase() === "html" ? (created.json.body.content ?? "") : "";
    const patched = await graphDraftWrite("PATCH", `${base}/${encodeURIComponent(draftId)}`, { body: { contentType: "HTML", content: `${d.html}${quoted}` }, categories });
    if (patched.status < 200 || patched.status >= 300) {
      await graphDraftWrite("DELETE", `${base}/${encodeURIComponent(draftId)}`).catch(() => null);
      throw new Error(`Outlook draft body could not be written (HTTP ${patched.status}); the empty draft was removed.`);
    }
    return { draftId, method: "createReply" };
  }
  if (![400, 403, 404, 405, 501].includes(created.status)) throw new Error(`Outlook createReply failed (HTTP ${created.status}).`);
  if (!m.from) throw new Error("The email has no sender address to reply to.");
  const subject = /^re:/i.test(m.subject ?? "") ? m.subject! : `RE: ${m.subject ?? ""}`.trim();
  const fresh = await graphDraftWrite<GraphDraft>("POST", base, {
    subject, body: { contentType: "HTML", content: d.html }, toRecipients: [{ emailAddress: { address: m.from } }], categories,
  });
  if (fresh.status < 200 || fresh.status >= 300 || !fresh.json?.id) throw new Error(`Outlook draft could not be created (HTTP ${fresh.status}).`);
  if (fresh.json.isDraft === false) throw new Error("Outlook returned a non-draft message; nothing more was done.");
  return { draftId: fresh.json.id, method: "new_message" };
}

// ---------- Facts (read-only) ----------
const STEP_KEYS = new Set(["safety_check", "fixes", "install_deposit", "balance"]);

export async function ownerFactsFor(jobId: string, matchedJobs: number, now = new Date()): Promise<OwnerFacts | null> {
  const { data: j, error } = await admin.from("jobs").select("id, job_number, stage, source, deleted_at, owners(full_name), properties(suburb)").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!j || j.deleted_at) return null;
  const [spot, books, quotes, est] = await Promise.all([
    loose.from("lead_campaign_responses").select("spot_saved_at, opted_out_at").eq("job_id", jobId).maybeSingle(),
    admin.from("bookings").select("kind, status, scheduled_start, scheduled_end").eq("job_id", jobId).eq("status", "confirmed").order("scheduled_start", { ascending: true }),
    admin.from("quotes").select("kind, status, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, sent_at, created_at").eq("job_id", jobId).in("status", ["issued", "accepted", "declined"]).order("created_at", { ascending: false }),
    admin.from("indicative_estimates").select("id, area_m2, insulation_declared, scenarios").eq("job_id", jobId).eq("status", "current").maybeSingle(),
  ]);
  if (books.error || quotes.error) throw new Error((books.error ?? quotes.error)!.message);
  const next = (kind: string) => {
    const b = (books.data ?? []).filter((x) => x.kind === kind && x.scheduled_start);
    const upcoming = b.find((x) => Date.parse(x.scheduled_end ?? x.scheduled_start!) > now.getTime() - 12 * 3_600_000) ?? null;
    return upcoming ? { start: upcoming.scheduled_start!, end: upcoming.scheduled_end ?? null } : null;
  };
  const inst = (quotes.data ?? []).find((q) => q.kind === "installation") ?? null;
  const fixesSent = (quotes.data ?? []).some((q) => q.kind === "rectification" && q.status === "issued");
  const saved = est.error ? null : savedPriceFromEstimate((est.data ?? null) as never);
  let paymentDue: DueStep | null = null, installHeldUntil: string | null = null;
  try {
    const pv = await (await import("./payments.server")).jobPaymentView(jobId, now);
    const st = pv?.due.step;
    if (st && STEP_KEYS.has(st.key) && (st.state === "requested" || st.state === "overdue")) paymentDue = { key: st.key, outstanding: st.outstandingCents / 100, dueAt: st.dueAt, state: st.state, cardAvailable: pv.stripe.available };
    if (pv?.provisional.decision === "provisional") installHeldUntil = pv.provisional.expiresAt;
  } catch { /* no payment facts → the reply says the office will confirm */ }
  let ownerLink: string | null = null;
  try { const path = await (await import("./estimatelink.server")).adminLinkPath(jobId); ownerLink = path ? `${CUSTOMER_BASE}${path}` : null; } catch { ownerLink = null; }
  const o = j.owners as { full_name: string | null } | null, p = j.properties as { suburb: string | null } | null;
  const declared = (est.data as { insulation_declared?: string | null } | null)?.insulation_declared ?? null;
  return {
    jobNumber: j.job_number, jobSource: j.source ?? null, stage: j.stage, spotSaved: !spot.error && !!spot.data?.spot_saved_at && !spot.data.opted_out_at,
    ownerFullName: o?.full_name ?? null, suburb: p?.suburb ?? null,
    readyCheck: next("ready_check"), piesa: next("assessment"), install: next("installation"),
    quote: inst ? { status: inst.status as "issued" | "accepted" | "declined", fullPrice: Number(inst.subtotal_inc_gst), rebate: Number(inst.veec_discount_inc_gst), youPay: Number(inst.customer_total_inc_gst) } : null,
    fixesQuoteSent: fixesSent,
    estimate: saved ? { fullPrice: saved.gross, rebate: saved.discount, youPay: saved.total, areaM2: saved.areaM2 } : null,
    insulationDeclared: declared === "none" || declared === "present" || declared === "unknown" ? declared : null,
    paymentDue, installHeldUntil, ownerLink, matchedJobs,
  };
}

type PartnerRow = { id: string; name: string; business_type: string; onboarding_notes: string | null };
async function partnerBusiness(from: string | null): Promise<PartnerRow | null> {
  if (!from) return null;
  const { data, error } = await admin.from("businesses").select("id, name, business_type, onboarding_notes").ilike("email", from.replace(/[%_\\,()*]/g, "")).limit(1);
  if (error) return null;
  return ((data ?? [])[0] as PartnerRow | undefined) ?? null;
}

export async function partnerFactsFor(b: PartnerRow | null, m: MailMessage, now = new Date()): Promise<PartnerFacts> {
  if (!b) return { businessName: null, kind: null, known: false, isTest: false, offers: [], pay: [], ownJobNumbers: [] };
  const kind = b.business_type === "eec_installer" ? "installer" as const : "electrician" as const;
  const isTest = isTestPartner(b);
  const mentioned = jobNumbersIn(`${m.subject ?? ""}\n${m.body}`);
  const [offers, asg] = await Promise.all([
    admin.from("partner_offers").select("kind, summary, expires_at, jobs(source)").eq("business_id", b.id).eq("status", "pending"),
    mentioned.length ? admin.from("job_assignments").select("jobs!inner(job_number, source)").eq("business_id", b.id).eq("active", true).in("jobs.job_number", mentioned) : Promise.resolve({ data: [], error: null }),
  ]);
  const okSource = (s: string | null | undefined) => (s === "qa_test") === isTest;
  const { partnerPayStates } = await import("./trade-view.server");
  const pay = await partnerPayStates(b.id, kind, isTest).catch(() => []);
  const myOffer = (k: string) => (kind === "installer" ? k === "ready_check" : k === "piesa" || k === "rectification");
  return {
    businessName: b.name, kind, known: true, isTest,
    offers: (offers.data ?? []).filter((o) => myOffer(o.kind) && okSource((o.jobs as { source?: string | null } | null)?.source) && (!o.expires_at || Date.parse(o.expires_at) > now.getTime()))
      .map((o) => ({ kind: o.kind, suburb: ((o.summary ?? {}) as { suburb?: string | null }).suburb ?? null, expiresAt: o.expires_at })),
    pay,
    ownJobNumbers: [...new Set(((asg.data ?? []) as { jobs: { job_number: string; source: string | null } | null }[]).filter((a) => a.jobs && okSource(a.jobs.source)).map((a) => a.jobs!.job_number))],
  };
}

// ---------- Idempotency + record ----------
async function alreadyDrafted(messageId: string): Promise<boolean> {
  const { data, error } = await loose.from("workflow_events").select("id").eq("event_type", EMAIL_REPLY_DRAFTED_EVENT).contains("details", { message_id: messageId }).limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

// ---------- Entry point ----------
/** Draft ONE reply for this Outlook message. `jobIds` = the jobs it was filed on (empty for unmatched mail).
 *  Never throws; never sends. */
export async function draftReplyForMessage(p: {
  message: MailMessage; mailbox: string | null; jobIds: string[]; origin: DraftOrigin; now?: Date;
  /** Tests only; production callers never pass it, so the code constants decide. */
  switches?: { enabled: boolean; testOnly: boolean };
}): Promise<DraftOutcome> {
  const m = p.message, now = p.now ?? new Date();
  const sw = p.switches ?? { enabled: EMAIL_REPLY_DRAFTS_ENABLED, testOnly: EMAIL_REPLY_DRAFTS_TEST_ONLY };
  // Cheapest guard first: with the switch off nothing is read, drafted or recorded.
  if (!sw.enabled) return { status: "skipped", reason: "Reply drafts are switched off (EMAIL_REPLY_DRAFTS_ENABLED)" };
  try {
    if (m.direction !== "inbound") return { status: "skipped", reason: "Only inbound mail gets a reply draft" };
    if (!recentEnoughForAction(m.at, now)) return { status: "skipped", reason: "Too old for a reply draft" };
    const mailbox = normaliseMailbox(p.mailbox);
    if (!mailbox) return { status: "skipped", reason: "No confirmed shared mailbox" };
    if (!process.env["LOVABLE_API_KEY"] || !process.env["MICROSOFT_OUTLOOK_API_KEY"]) return { status: "skipped", reason: "Outlook is not connected" };
    if (await alreadyDrafted(m.providerMessageId)) return { status: "skipped", reason: "A reply draft already exists for this email" };

    const biz = await partnerBusiness(m.from);
    let jobIds = [...new Set(p.jobIds)];
    // TEST mode first (allow-listed sender, qa_test jobs only, TEST partners only), before any job facts are read.
    const blockerFor = async (ids: string[]) => {
      const sources: (string | null)[] = [];
      if (ids.length) {
        const { data: js, error } = await admin.from("jobs").select("id, source").in("id", ids);
        if (error) throw new Error(error.message);
        sources.push(...(js ?? []).map((x) => x.source ?? null));
      }
      return draftBlocker({ enabled: sw.enabled, testOnly: sw.testOnly, from: m.from, jobSources: sources, partnerIsTest: biz ? isTestPartner(biz) : null });
    };
    const blocked = await blockerFor(jobIds);
    if (blocked) return { status: "skipped", reason: blocked };

    const hits = classifyEmailIntents({ subject: m.subject, body: m.body, direction: "inbound", from: m.from, fromPartner: !!biz });
    let emailEnquiry: EmailEnquiryFacts | null = null;
    if (!jobIds.length && !biz) {
      // Unmatched mail: partners get a draft below; a new sender's enquiry or price / rebate question gets its enquiry
      // created (decision 255); everyone else waits for the office's Match (decision 247).
      const unmatchedType = pickReplyType({ hits, fromPartner: false, matchedJob: false, stage: null, spotSaved: false, enquiryCue: looksLikeNewEnquiry(m.subject, m.body) });
      if (unmatchedType !== "new_enquiry" && unmatchedType !== "price_rebate_eligibility")
        return { status: "skipped", reason: "Unmatched email — drafted after the office matches it" };
      const made = await (await import("./email-enquiry.server")).enquiryFromEmail(m, { testOnly: sw.testOnly });
      if (made.status === "skipped") return { status: "skipped", reason: made.reason };
      jobIds = [made.jobId];
      if (made.status === "existing_owner") {
        // Linked to the owner already on file: the normal matched-owner reply, under the same TEST guard.
        const linkedBlocked = await blockerFor(jobIds);
        if (linkedBlocked) return { status: "skipped", reason: linkedBlocked };
      } else emailEnquiry = { created: true, addressFound: made.addressFound };
    }
    const owner = jobIds.length && !biz ? await ownerFactsFor(jobIds[0]!, jobIds.length, now) : null;
    if (owner && !emailEnquiry && hits.length === 0 && !isEnquiryStage(owner.stage, owner.spotSaved) && !looksLikeNewEnquiry(m.subject, m.body))
      return { status: "skipped", reason: "No question or request recognised" };
    const partner = biz || hits.some((h) => h.intent === "trade") ? await partnerFactsFor(biz, m, now) : null;

    const draft = composeReply({ subject: m.subject, body: m.body, from: m.from, fromName: m.fromName, hits, fromPartner: !!biz, owner, partner, emailEnquiry, now });
    if (!draft) return { status: "skipped", reason: "No reply type applies" };

    const written = await writeDraft(mailbox, m, draft);
    const details = {
      message_id: m.providerMessageId, internet_message_id: m.internetMessageId, thread_id: m.threadId, mailbox, from: m.from, subject: m.subject, received_at: m.at,
      origin: p.origin, draft_id: written.draftId, method: written.method, reply_type: draft.type, intents: draft.intents, flags: draft.flags,
      check_before_sending: draft.checkBeforeSending, would_auto_send: wouldAutoSend(draft), auto_send_built: false,
      job_ids: jobIds, partner_business_id: biz?.id ?? null, link: draft.link, email_enquiry_created: !!emailEnquiry,
    };
    const { error } = await loose.from("workflow_events").insert({ job_id: jobIds[0] ?? null, actor_id: null, event_type: EMAIL_REPLY_DRAFTED_EVENT, internal: true,
      summary: `Reply drafted in Outlook (${draft.type.replace(/_/g, " ")})${draft.checkBeforeSending ? " — check before sending" : ""}; not sent`, details });
    if (error) {
      // No draft without its record (the record is what keeps drafting idempotent): remove the draft we just made.
      await graphDraftWrite("DELETE", `${outlookMailboxPath(mailbox)}/messages/${encodeURIComponent(written.draftId)}`).catch(() => null);
      throw new Error(`Reply draft not recorded (${error.message}); the draft was removed.`);
    }
    return { status: "drafted", draftId: written.draftId, type: draft.type, checkBeforeSending: draft.checkBeforeSending, method: written.method };
  } catch (e) {
    console.error("email reply draft skipped", e instanceof Error ? e.message : e);
    return { status: "skipped", reason: e instanceof Error ? e.message : "Reply draft failed" };
  }
}

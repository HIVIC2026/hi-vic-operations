// Record-only Outlook copier: matched human inbound and outbound mail plus private attachments.
// Junk stays in Outlook; copying never closes, flags or creates an Enquiries row.
// Decision 247: unmatched human INBOUND mail is no longer dropped silently — it raises ONE job-less
// `email_unmatched` event (snippet + best-guess jobs) for Needs me "Match this email"; nothing is stored on a job
// until the office matches it (email-office.server). Decision 245: a matched inbound email that asks for a change
// (cancel, can't make it, new contact details, a photo/document) raises `email_change_request` on the job; the
// office applies or ignores it. Decision 337: a date/time change or cancel from the matched owner instead gets ONE sent
// reply with their own My job link (email-change-reply.server, guarded owner email path, TEST → test-send); the row then
// stays only for a cancel the owner can't do on My job. None of this ever closes or moves anything. Decision 244: new inbound mail may get ONE
// Outlook reply DRAFT (email-reply.server, behind EMAIL_REPLY_DRAFTS_ENABLED, never sent). Decision 292 (replaces 255):
// an unmatched NEW human sender asking an enquiry / price / rebate / eligibility question is SENT one website reply
// (new-sender-reply.server: TEST mode → allow-list only via test-send; live only behind the approved flag +
// customer_comms_enabled; never via Outlook); no enquiry, owner or link is ever created from an email, and the
// `email_unmatched` row stays. Decision 386: a matched OWNER's standard question (save my spot, is it saved, what next,
// when is my visit, where is my quote, how do I pay) is SENT one automatic reply before any draft
// (owner-email-auto-reply.server: TEST → test-send; real only behind OWNER_EMAIL_AUTO_REPLY_APPROVED + customer comms);
// anything unusual keeps the decision-244 draft plus ONE Needs me "reply needed" row; 337 keeps priority for changes.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isHumanOwnerEmail } from "./owner-email-presentation.core";
import { checkedOutlookHealth, normaliseMailbox, outlookGatewayUrl, outlookMailboxPath, uncheckedOutlookHealth, OUTLOOK_REQUEST_REDIRECT, type OutlookHealth } from "./outlook-connection.core";
import {
  attachmentIdentityKey, attachmentStoragePath, ATTACHMENT_MAX_FILE_BYTES, ATTACHMENT_MAX_MESSAGE_BYTES,
  counterpartEmails, extractJobNumbers, isPortalDuplicate, matchMessage, normaliseMessage,
  planAttachments, type AttachmentRef, type CandidateJob, type GraphMessage, type MailMessage, type MatchResult, type StoredAttachmentRef,
  OUR_DOMAINS,
} from "./outlook-correspondence.core";
import { EMAIL_UNMATCHED_EVENT, guessJobsForEmail, guessLookups, unmatchedSnippet, type GuessJob } from "./outlook-guess.core";
import { EMAIL_CHANGE_REQUEST_EVENT, changeRequestLabel, officeRowNeeded, proposedChanges, recentEnoughForAction } from "./email-intent.core";
import { EMAIL_REPLY_DRAFTS_ENABLED } from "./outlook-reply-drafts.core";

// New migration types are local until the database-generated types are refreshed on integration.
const syncAdmin = admin as SupabaseClient;
type Route = MatchResult;
type Work = { provider_message_id: string; mailbox: string; message: MailMessage; route: Route; attachments_complete: boolean; attachment_refs: StoredAttachmentRef[]; status: "pending" | "complete"; record_only: boolean };
type SyncState = {
  id: number; expected_mailbox: string | null; mailbox: string | null; backfill_from: string;
  inbox_cursor: string | null; sent_cursor: string | null; inbox_next_link: string | null; sent_next_link: string | null;
  all_inbound_cursor: string | null; all_inbound_next_link: string | null; all_outbound_cursor: string | null; all_outbound_next_link: string | null;
  catchup_from: string | null; catchup_inbound_cursor: string | null; catchup_inbound_next_link: string | null; catchup_outbound_cursor: string | null; catchup_outbound_next_link: string | null;
  updated_at: string; last_run_at: string | null; last_ok_at: string | null; last_error: string | null; last_counts: Record<string, number>;
};
type WorkResult = { stored?: boolean; unmatched?: boolean; closed?: boolean; flagged?: boolean; duplicate?: boolean; ignored?: boolean; replayed?: boolean };
type ClosureWindow = { inboxCompleteThrough: string | null; history?: boolean; backfillFrom?: string | null };
const SELECT = "id,conversationId,internetMessageId,subject,body,bodyPreview,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,hasAttachments,isDraft";
const BUCKET = "job-files";

/** `matched` = filed on a job this pass; `unmatched` = new job-less `email_unmatched` events (decision 247);
 *  `junk` = automatic/bulk mail skipped before matching; `unmatchedNotRecorded` = unmatched human inbound mail that
 *  could not be recorded (pending migration email-unmatched-events.sql not applied, or too old to raise a row);
 *  `notHomeowner` = other unmatched mail left in Outlook (outbound to non-customers). */
export type SyncCounts = { fetched: number; stored: number; duplicate: number; portalDuplicate: number; notHomeowner: number; unmatched: number; closed: number; flagged: number; files: number; filesSkipped: number; errors: number;
  matched?: number; junk?: number; unmatchedNotRecorded?: number; changeRequests?: number; replyDrafts?: number; newSenderReplies?: number; newSenderHeld?: number; ownerAutoReplies?: number };
const bump = (c: SyncCounts, k: "matched" | "junk" | "unmatchedNotRecorded" | "changeRequests" | "unmatched" | "replyDrafts" | "newSenderReplies" | "newSenderHeld" | "ownerAutoReplies", n = 1) => { c[k] = (c[k] ?? 0) + n; };

/** Job ids on a route. Rows reserved by the previous release carry a legacy single jobId. */
export function routeJobIds(route: Route): string[] {
  if (route.kind !== "job") return [];
  if (Array.isArray(route.jobIds) && route.jobIds.length) return route.jobIds;
  const legacy = (route as { jobId?: string }).jobId;
  return legacy ? [legacy] : [];
}

export function outlookConfigured(): boolean {
  return !!process.env["LOVABLE_API_KEY"] && !!process.env["MICROSOFT_OUTLOOK_API_KEY"];
}

async function graph<T>(path: string): Promise<T> {
  // Never follow redirects with connector credentials, or use an arbitrary provider next-link origin.
  const res = await fetch(outlookGatewayUrl(path), {
    method: "GET", redirect: OUTLOOK_REQUEST_REDIRECT, signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]}`,
      "X-Connection-Api-Key": process.env["MICROSOFT_OUTLOOK_API_KEY"]!,
      Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"',
    },
  });
  if (res.status >= 300 && res.status < 400) throw new Error("Outlook tried to redirect; the request was not followed.");
  if (!res.ok) throw new Error(`Outlook request failed (HTTP ${res.status}). Check the connector account and permissions.`);
  try { return (await res.json()) as T; }
  catch { throw new Error("Outlook returned an unreadable response."); }
}

/** Raw bytes of one attachment ($value). Never follows redirects; the URL goes through the approved-gateway check. */
async function attachmentBytes(mailbox: string, messageId: string, attachmentId: string): Promise<ArrayBuffer> {
  const res = await fetch(outlookGatewayUrl(`${outlookMailboxPath(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`), {
    method: "GET", redirect: OUTLOOK_REQUEST_REDIRECT, signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]}`,
      "X-Connection-Api-Key": process.env["MICROSOFT_OUTLOOK_API_KEY"]!,
    },
  });
  if (res.status >= 300 && res.status < 400) throw new Error("Outlook tried to redirect an attachment download; it was not followed.");
  if (!res.ok) throw new Error(`Outlook attachment download failed (HTTP ${res.status}).`);
  return res.arrayBuffer();
}

/** Account identity. Mail-only connections (no profile permission) cannot read /me; then the identity is
 *  the shared mailbox itself, and access is still proven by reading its Inbox and Sent Items. */
async function accountIdentity(mailbox: string | null): Promise<{ id?: string; mail?: string | null; userPrincipalName?: string | null; displayName?: string | null }> {
  try { return await graph("/me?$select=id,mail,userPrincipalName,displayName"); }
  catch (e) {
    const target = normaliseMailbox(mailbox);
    if (!target || !(e instanceof Error) || !/HTTP 403/.test(e.message)) throw e;
    await verifyMailboxReadAccess(target);
    return { id: `mailbox:${target}`, mail: target, displayName: null };
  }
}

export async function readOutlookSyncState(): Promise<SyncState> {
  const { data, error } = await syncAdmin.from("outlook_sync_state").select("*").eq("id", 1).single();
  if (error || !data) throw new Error(`Outlook sync settings unavailable: ${error?.message ?? "state row missing"}`);
  return data as SyncState;
}

/** Read-only: no sync, configuration write, cursor update, message import or job action. */
export async function checkOutlookConnection(candidateMailbox?: string): Promise<OutlookHealth> {
  const state = await readOutlookSyncState();
  const configured = outlookConfigured();
  const unchecked = uncheckedOutlookHealth(configured, state.expected_mailbox ?? null);
  if (!configured) return unchecked;
  const checkedAt = new Date().toISOString();
  const target = normaliseMailbox(candidateMailbox ?? state.expected_mailbox);
  let health: OutlookHealth = { ...unchecked, targetMailbox: target, checkedAt };
  try {
    const me = await accountIdentity(target);
    health = checkedOutlookHealth(configured, state.expected_mailbox ?? null, me, checkedAt);
    if (!target) return health;
    await verifyMailboxReadAccess(target);
    return checkedOutlookHealth(configured, state.expected_mailbox ?? null, me, checkedAt, target);
  } catch (e) {
    return { ...health, targetMailbox: target, status: "failed", readyForSync: false, mailboxReadable: false,
      problem: e instanceof Error ? e.message : "Outlook connection check failed." };
  }
}

async function verifyMailboxReadAccess(mailbox: string): Promise<void> {
  // /me identifies the delegate; it is not necessarily the shared mailbox. Read and discard one
  // message per required folder to check message/body access, including on empty mailboxes.
  for (const folder of ["inbox", "sentitems"]) {
    const response = await graph<{ value?: unknown[] }>(`${outlookMailboxPath(mailbox)}/mailFolders/${folder}/messages?$top=1&$select=id,body`);
    if (!Array.isArray(response.value)) throw new Error(`Outlook could not verify ${folder} access for the selected shared mailbox.`);
  }
}

/** Explicit Office configuration, separate from both the read-only health check and the sync action. */
export async function confirmOutlookMailbox(mailbox: string, actorId: string): Promise<void> {
  const expected = normaliseMailbox(mailbox);
  if (!expected) throw new Error("A valid mailbox address is required.");
  const health = await checkOutlookConnection(expected);
  if (!health.mailboxReadable || health.targetMailbox !== expected)
    throw new Error(health.problem ?? "Shared mailbox access could not be verified. Check the connection again.");
  const { error } = await syncAdmin.rpc("confirm_outlook_mailbox", { _mailbox: expected, _actor: actorId });
  if (error) throw new Error(`Mailbox confirmation was not saved: ${error.message}`);
}

export async function pendingOutlookWorkCount(): Promise<number> {
  const { count, error } = await syncAdmin.from("outlook_message_work").select("provider_message_id", { count: "exact", head: true }).eq("status", "pending");
  if (error || count == null) throw new Error(`Outlook pending work unavailable: ${error?.message ?? "exact count missing"}`);
  return count;
}

async function attachmentsFor(id: string, mailbox: string): Promise<AttachmentRef[]> {
  const refs: AttachmentRef[] = [];
  let url: string | null = `${outlookMailboxPath(mailbox)}/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline`;
  const visited = new Set<string>();
  while (url) {
    const canonical = outlookGatewayUrl(url);
    if (visited.has(canonical)) throw new Error("Outlook repeated an attachment continuation.");
    visited.add(canonical);
    const r: { value: { id: string; name: string; contentType?: string; size?: number; isInline?: boolean }[]; "@odata.nextLink"?: string } = await graph(canonical);
    if (!Array.isArray(r.value)) throw new Error("Outlook returned an invalid attachment response.");
    if (r.value.some(a => typeof a.id !== "string" || !a.id || typeof a.name !== "string"))
      throw new Error("Outlook returned incomplete attachment metadata.");
    refs.push(...r.value.map((a) => ({ id: a.id, name: a.name, contentType: a.contentType ?? null, size: a.size ?? null, isInline: !!a.isInline })));
    url = r["@odata.nextLink"] ? outlookGatewayUrl(r["@odata.nextLink"]) : null;
  }
  return refs;
}

/** SHA-256 hex of raw bytes: proves a re-used storage object really is the same file. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Downloads and privately stores each attachment. Size limits apply to the actual downloaded bytes
 *  (a file whose size the provider did not report is still checked), an existing object is only reused
 *  after its bytes are verified against the mailbox copy, and every skipped file keeps a visible reason
 *  — a file that was not stored is never presented as preserved. */
async function storeAttachments(work: Work, refs: AttachmentRef[], jobIds: string[]): Promise<{ refs: StoredAttachmentRef[]; stored: number; skipped: number }> {
  const prefix = jobIds[0] ?? "unmatched";
  const plan = planAttachments(refs);
  const skippedIds = new Set(plan.skipped.map((s) => s.ref.id));
  const reasonById = new Map(plan.skipped.map((s) => [s.ref.id, s.reason]));
  const stored: StoredAttachmentRef[] = [];
  let storedCount = 0;
  let actualTotal = 0;
  for (const [i, ref] of refs.entries()) {
    if (skippedIds.has(ref.id)) { stored.push({ ...ref, path: null, storedAt: null, skipped: reasonById.get(ref.id) ?? "skipped", contentHash: null }); continue; }
    const bytes = new Uint8Array(await attachmentBytes(work.mailbox, work.provider_message_id, ref.id));
    if (bytes.byteLength > ATTACHMENT_MAX_FILE_BYTES) { stored.push({ ...ref, path: null, storedAt: null, skipped: `over the ${Math.round(ATTACHMENT_MAX_FILE_BYTES / 1048576)} MB per-file limit`, contentHash: null }); continue; }
    if (actualTotal + bytes.byteLength > ATTACHMENT_MAX_MESSAGE_BYTES) { stored.push({ ...ref, path: null, storedAt: null, skipped: "over the per-message attachment budget", contentHash: null }); continue; }
    const path = attachmentStoragePath(prefix, attachmentIdentityKey(work.mailbox, work.provider_message_id, ref.id), i, ref.name);
    const contentHash = await sha256Hex(bytes);
    const { error } = await (admin.storage.from(BUCKET) as unknown as {
      upload: (p: string, body: Uint8Array, o: { contentType: string; upsert: boolean }) => Promise<{ error: { message: string } | null }>;
    }).upload(path, bytes, { contentType: ref.contentType ?? "application/octet-stream", upsert: false });
    if (error) {
      if (!/exist/i.test(error.message)) throw new Error(`Outlook attachment was not stored: ${error.message}`);
      // A retry may re-upload the same bytes to the same deterministic path; only reuse the object when
      // its stored bytes match the mailbox copy — never assume an "already exists" error means the same file.
      const { data: have, error: de } = await (admin.storage.from(BUCKET) as unknown as {
        download: (p: string) => Promise<{ data: Blob | null; error: { message: string } | null }>;
      }).download(path);
      if (de || !have) throw new Error(`Stored Outlook attachment could not be re-checked: ${de?.message ?? "object missing"}`);
      const existing = new Uint8Array(await have.arrayBuffer());
      if (existing.byteLength !== bytes.byteLength || (await sha256Hex(existing)) !== contentHash)
        throw new Error("A different file already exists at the Outlook attachment path; it was not overwritten.");
    }
    actualTotal += bytes.byteLength;
    stored.push({ ...ref, path, storedAt: new Date().toISOString(), skipped: null, contentHash });
    storedCount++;
  }
  return { refs: stored, stored: storedCount, skipped: stored.filter((s) => s.skipped).length };
}

/** Idempotent byte/inline repair for mail stored by the metadata-only era (or completed work whose files
 *  were never downloaded). No workflow changes: already-verified files are reused, missing ones are
 *  fetched and stored, and each job row keeps its existing stored paths. */
async function repairAttachments(work: Work): Promise<{ stored: number } | null> {
  const jobIds = routeJobIds(work.route);
  if (!jobIds.length) return null;
  const refs = await attachmentsFor(work.provider_message_id, work.mailbox);
  if (!refs.length) return null;
  const storedRefs = await storeAttachments(work, refs, jobIds);
  for (const jobId of jobIds) {
    const { data: rows, error } = await syncAdmin.from("job_communications").select("id, attachment_refs")
      .eq("provider", "outlook").eq("provider_message_id", work.provider_message_id).eq("job_id", jobId);
    if (error) throw new Error(`Correspondence attachments unavailable: ${error.message}`);
    for (const row of rows ?? []) {
      const current = (row.attachment_refs as StoredAttachmentRef[] | null) ?? [];
      const byId = new Map(storedRefs.refs.map((r) => [r.id, r]));
      const merged = (current.length ? current : storedRefs.refs).map((r) => (r.path ? r : byId.get(r.id) ?? r));
      const { error: ue } = await syncAdmin.from("job_communications")
        .update({ attachment_refs: merged, updated_at: new Date().toISOString() }).eq("id", row.id);
      if (ue) throw new Error(`Correspondence attachment repair was not saved: ${ue.message}`);
    }
  }
  if (!work.attachments_complete) {
    const { error } = await syncAdmin.from("outlook_message_work")
      .update({ attachment_refs: storedRefs.refs }).eq("provider_message_id", work.provider_message_id);
    if (error) throw new Error(`Attachment metadata was not saved: ${error.message}`);
  }
  return { stored: storedRefs.stored };
}

async function loadCandidates(msgs: MailMessage[], mailbox: string) {
  const numbers = [...new Set(msgs.flatMap((m) => extractJobNumbers(`${m.subject ?? ""}\n${m.body}`)))];
  const emails = [...new Set(msgs.flatMap((m) => counterpartEmails(m, mailbox, OUR_DOMAINS)))];
  const threads = [...new Set(msgs.map((m) => m.threadId).filter((t): t is string => !!t))];
  const sel = "id, job_number, stage, deleted_at, owners!inner(email), properties(address_line, postcode)";
  const toCand = (j: Record<string, unknown>): CandidateJob => {
    const o = j["owners"] as { email: string | null } | null, p = j["properties"] as { address_line: string | null; postcode: string | null } | null;
    return { id: String(j["id"]), jobNumber: String(j["job_number"]), ownerEmail: o?.email?.toLowerCase() ?? null, addressLine: p?.address_line ?? null, postcode: p?.postcode ?? null };
  };
  const byNumber = new Map<string, CandidateJob>(), byEmail = new Map<string, CandidateJob[]>(), byThread = new Map<string, CandidateJob[]>(), byId = new Map<string, CandidateJob>();
  for (let i = 0; i < numbers.length; i += 100) {
    const { data, error } = await admin.from("jobs").select(sel).in("job_number", numbers.slice(i, i + 100)).is("deleted_at", null).neq("source", "qa_test");
    if (error) throw new Error(error.message);
    for (const j of data ?? []) { const c = toCand(j as never); byNumber.set(c.jobNumber, c); byId.set(c.id, c); }
  }
  for (let i = 0; i < emails.length; i += 50) {
    const chunk = emails.slice(i, i + 50);
    const { data: owners, error: oe } = await admin.from("owners").select("id, email").or(chunk.map((e) => `email.ilike.${e.replace(/[,()*%\\]/g, "")}`).join(","));
    if (oe) throw new Error(oe.message);
    const ids = (owners ?? []).filter((o) => o.email && chunk.includes(o.email.toLowerCase())).map((o) => o.id);
    if (!ids.length) continue;
    const { data, error } = await admin.from("jobs").select(sel).in("owner_id", ids).is("deleted_at", null).neq("source", "qa_test");
    if (error) throw new Error(error.message);
    for (const j of data ?? []) {
      const c = toCand(j as never);
      if (!c.ownerEmail) continue;
      byEmail.set(c.ownerEmail, [...(byEmail.get(c.ownerEmail) ?? []), c]);
      byId.set(c.id, c);
    }
  }
  // Threads already stored on jobs: a reply in a known conversation links even from a family/manager
  // address. Candidate details are kept so a multi-job thread can be corroborated against the sender.
  const threadRows: { thread: string; jobId: string }[] = [];
  for (let i = 0; i < threads.length; i += 100) {
    const { data, error } = await admin.from("job_communications").select("job_id, provider_thread_id")
      .eq("provider", "outlook").in("provider_thread_id", threads.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const c of data ?? []) {
      const t = c.provider_thread_id as string | null;
      if (t) threadRows.push({ thread: t, jobId: String(c.job_id) });
    }
  }
  const threadJobIds = [...new Set(threadRows.map((r) => r.jobId))];
  const threadCands = new Map<string, CandidateJob>();
  for (let i = 0; i < threadJobIds.length; i += 100) {
    const { data, error } = await admin.from("jobs").select(sel).in("id", threadJobIds.slice(i, i + 100)).is("deleted_at", null).neq("source", "qa_test");
    if (error) throw new Error(error.message);
    for (const j of data ?? []) { const c = toCand(j as never); threadCands.set(c.id, c); byId.set(c.id, c); }
  }
  for (const { thread, jobId } of threadRows) {
    const c = threadCands.get(jobId);
    if (c) byThread.set(thread, [...new Map([...(byThread.get(thread) ?? []), c].map((x) => [x.id, x])).values()]);
  }
  return { byNumber, byEmail, byThread, byId };
}

/** Stores one matched message on its job. Returns the new communication id, or null when it was already
 *  stored (per-job uniqueness makes a repeated assignment idempotent). Visibility is "customer" only when
 *  the counterpart is a confirmed participant of that job; family/property-manager mail is staff-visible. */
export async function storeOnJob(jobId: string, m: MailMessage, how: string, visibility: "customer" | "internal" = "customer"): Promise<string | null> {
  const { data, error } = await admin.from("job_communications").insert({
    job_id: jobId, direction: m.direction, channel: "email", sender_text: m.fromName ? `${m.fromName} <${m.from}>` : m.from, recipients: [...m.to, ...m.cc],
    subject: m.subject, body: m.body || "(no text)", provider: "outlook", provider_message_id: m.providerMessageId, provider_thread_id: m.threadId,
    sent_at: m.direction === "outbound" ? m.at : null, received_at: m.direction === "inbound" ? m.at : null,
    delivery_status: m.direction === "inbound" ? "received" : "sent", visibility, attachment_refs: m.attachments,
    source_event: `outlook_sync:${how}`, source_reference: m.internetMessageId, created_by: null,
  }).select("id").single();
  if (error) { if (error.code === "23505") return null; throw new Error(error.message); }
  return data.id;
}

/** Jobs to score as the best guess for an unmatched email (bounded lookups; any failure = no guesses). */
async function guessCandidates(m: MailMessage, extraIds: string[]): Promise<GuessJob[]> {
  const look = guessLookups(m);
  const ids = new Set(extraIds);
  const clean = (v: string) => v.replace(/[%_\\,()*]/g, "");
  const sel = "id, job_number, deleted_at, source, owners(full_name, email), properties(address_line, suburb, postcode)";
  const rows: Record<string, unknown>[] = [];
  if (look.jobNumbers.length) {
    const { data, error } = await admin.from("jobs").select(sel).in("job_number", look.jobNumbers.slice(0, 10));
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
  }
  for (const frag of look.addresses) {
    const [num, word] = frag.split(" ");
    if (!num || !word) continue;
    const { data, error } = await admin.from("properties").select("id").ilike("address_line", `%${clean(num)} ${clean(word)}%`).limit(10);
    if (error) throw new Error(error.message);
    const pids = (data ?? []).map((p) => p.id);
    if (pids.length) { const { data: js } = await admin.from("jobs").select("id").in("property_id", pids).limit(20); for (const j of js ?? []) ids.add(j.id); }
  }
  for (const surname of look.surnames) {
    const { data, error } = await admin.from("owners").select("id").ilike("full_name", `%${clean(surname)}%`).limit(20);
    if (error) throw new Error(error.message);
    const oids = (data ?? []).map((o) => o.id);
    if (oids.length) { const { data: js } = await admin.from("jobs").select("id").in("owner_id", oids).limit(20); for (const j of js ?? []) ids.add(j.id); }
  }
  const more = [...ids].slice(0, 60);
  if (more.length) {
    const { data, error } = await admin.from("jobs").select(sel).in("id", more);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
  }
  const seen = new Map<string, GuessJob>();
  for (const j of rows) {
    if (j["deleted_at"] || j["source"] === "qa_test") continue;
    const o = j["owners"] as { full_name?: string | null; email?: string | null } | null, p = j["properties"] as { address_line?: string | null; suburb?: string | null; postcode?: string | null } | null;
    seen.set(String(j["id"]), { id: String(j["id"]), jobNumber: String(j["job_number"]), ownerName: o?.full_name ?? null, ownerEmail: o?.email?.toLowerCase() ?? null, addressLine: p?.address_line ?? null, suburb: p?.suburb ?? null, postcode: p?.postcode ?? null });
  }
  return [...seen.values()];
}

/** Decision 247: ONE job-less `email_unmatched` event per Outlook message (idempotent by message id). Never throws:
 *  "not_recorded" when the pending migration (job-less events) is not applied or the write failed. */
async function recordUnmatched(m: MailMessage, mailbox: string, candidateJobIds: string[], reason: string): Promise<"recorded" | "duplicate" | "not_recorded"> {
  try {
    const { data: dup, error: de } = await syncAdmin.from("workflow_events").select("id").eq("event_type", EMAIL_UNMATCHED_EVENT).contains("details", { message_id: m.providerMessageId }).limit(1);
    if (de) throw new Error(de.message);
    if ((dup ?? []).length) return "duplicate";
    let guesses: ReturnType<typeof guessJobsForEmail> = [];
    try { guesses = guessJobsForEmail(m, await guessCandidates(m, candidateJobIds)); }
    catch (e) { console.error("unmatched email guess skipped", e instanceof Error ? e.message : e); }
    const details = {
      message_id: m.providerMessageId, internet_message_id: m.internetMessageId, thread_id: m.threadId, mailbox, direction: m.direction,
      from: m.from, from_name: m.fromName, to: m.to, cc: m.cc, subject: m.subject, snippet: unmatchedSnippet(m.body), received_at: m.at,
      has_attachments: m.hasAttachments, reason, candidate_job_ids: candidateJobIds,
      best_guess_job_ids: guesses.map((g) => g.jobId), guesses: guesses.map((g) => ({ job_id: g.jobId, job_number: g.jobNumber, score: g.score, why: g.why })),
    };
    const { error } = await syncAdmin.from("workflow_events").insert({ job_id: null, actor_id: null, event_type: EMAIL_UNMATCHED_EVENT, internal: true,
      summary: `Email from ${m.fromName ? `${m.fromName} <${m.from}>` : m.from ?? "unknown sender"} could not be matched to a job — match it or mark Not a customer`, details });
    if (error) {
      if (error.code !== "23502" && error.code !== "23514") console.error("unmatched email not recorded", error.message);
      return "not_recorded";
    }
    return "recorded";
  } catch (e) {
    console.error("unmatched email not recorded", e instanceof Error ? e.message : e);
    return "not_recorded";
  }
}

/** Is this sender one of our partner businesses (installer/electrician)? Partners never cancel an owner's job by email. */
async function fromPartner(from: string | null): Promise<boolean> {
  if (!from) return false;
  const { data, error } = await admin.from("businesses").select("id").ilike("email", from.replace(/[%_\\,()*]/g, "")).limit(1);
  return !error && (data ?? []).length > 0;
}

/** Decision 245: matched inbound mail asking for a change → one `email_change_request` per job and intent
 *  (idempotent by message id + intent). Best-effort: returns how many were raised, never throws. */
export async function recordChangeRequests(jobIds: string[], m: MailMessage, attachments: AttachmentRef[] = []): Promise<number> {
  if (m.direction !== "inbound" || !jobIds.length || !recentEnoughForAction(m.at)) return 0;
  let raised = 0;
  try {
    const partner = await fromPartner(m.from);
    let changes = proposedChanges({ subject: m.subject, body: m.body, direction: m.direction, from: m.from, hasAttachments: m.hasAttachments,
      attachments: (attachments.length ? attachments : m.attachments).map((a) => ({ name: a.name, contentType: a.contentType, isInline: a.isInline })), fromPartner: partner });
    // Decision 337: a date/time change or cancel from the matched owner gets ONE automatic reply with their My job link;
    // the Apply/Ignore row is then raised only for a cancel the owner can't do themselves (or when the reply didn't go).
    const replied = new Map<string, { sent: boolean; keepOfficeRow: boolean }>();
    // Jo 27 Oct 2026: a clear decline on an unbooked, unpaid enquiry closes the job itself — no reply, no Apply card.
    if (changes.some((c) => c.intent === "cancel")) {
      try {
        const r = await (await import("./email-decline-close.server")).closeOnDeclineEmail({ jobIds, message: m, fromPartner: partner });
        if (r.closed) changes = changes.filter((c) => c.intent !== "cancel");
      } catch (e) { console.error("decline auto-close skipped", e instanceof Error ? e.message : e); } // the Apply card is raised as before
    }
    for (const c of changes) {
      if (c.intent !== "reschedule" && c.intent !== "cancel") continue;
      try {
        const r = await (await import("./email-change-reply.server")).replyToChangeRequest({ jobIds, message: m, intent: c.intent, fromPartner: partner });
        replied.set(c.intent, { sent: r.sent, keepOfficeRow: r.keepOfficeRow });
      } catch (e) {
        console.error("email change reply skipped", e instanceof Error ? e.message : e); // the office row is raised as before
      }
    }
    for (const jobId of jobIds) for (const c of changes) {
      if (!officeRowNeeded(c.intent, replied.get(c.intent) ?? null)) continue;
      const { data: dup, error: de } = await syncAdmin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", EMAIL_CHANGE_REQUEST_EVENT).contains("details", { message_id: m.providerMessageId, intent: c.intent }).limit(1);
      if (de) throw new Error(de.message);
      if ((dup ?? []).length) continue;
      const { intent, phrase, ...proposed } = c;
      const { error } = await syncAdmin.from("workflow_events").insert({ job_id: jobId, actor_id: null, event_type: EMAIL_CHANGE_REQUEST_EVENT, internal: true,
        summary: `${changeRequestLabel(c)} — “${phrase}” (Apply / Ignore)`,
        details: { message_id: m.providerMessageId, internet_message_id: m.internetMessageId, thread_id: m.threadId, from: m.from, subject: m.subject, received_at: m.at, intent, phrase, proposed, label: changeRequestLabel(c) } });
      if (error) throw new Error(error.message);
      raised++;
    }
  } catch (e) {
    console.error("email change request skipped", e instanceof Error ? e.message : e);
  }
  return raised;
}

/** Decision 337 already SENT the owner their change link for this message (then no AI draft is needed). */
async function changeReplied(jobId: string, messageId: string): Promise<boolean> {
  const { data } = await (admin as unknown as import("@supabase/supabase-js").SupabaseClient).from("workflow_events").select("event_type").eq("job_id", jobId).in("event_type", ["email_change_replied", "email_change_reply_held"]).contains("details", { message_id: messageId }).limit(5);
  const t = ((data ?? []) as { event_type: string }[]).map((r) => r.event_type);
  return t.includes("email_change_replied") && !t.includes("email_change_reply_held");
}

/** Decision 386: ONE automatic reply to a matched owner's standard question, before any decision-244 draft. Returns
 *  whether the draft must be skipped (a reply went, or none is needed). Never throws: any failure = the draft as before. */
async function ownerAutoReply(jobIds: string[], m: MailMessage, mailbox: string | null, counts?: SyncCounts): Promise<boolean> {
  if (m.direction !== "inbound" || !jobIds.length) return false;
  try {
    // Jo 27 Oct 2026: a plain decline that closed the job gets no reply and no AI draft.
    const closedByDecline = jobIds.length === 1 ? await (async () => { try { return await (await import("./email-decline-close.server")).declineClosedFor(jobIds[0]!, m.providerMessageId); } catch { return false; } })() : false;
    if (closedByDecline) return true;
    const r = await (await import("./owner-email-auto-reply.server")).autoReplyToOwner({ jobIds, message: m, mailbox });
    if (r.status === "sent" && counts) bump(counts, "ownerAutoReplies");
    // Jo 26 Oct: anything not sent gets ONE fresh AI reply draft saved on the job for Jo to approve and send.
    // Simple = standard questions and thanks; a change/cancel ask is left to decision 337 unless it didn't reply.
    if (r.status !== "sent" && r.status !== "already" && r.detail !== "sender is not the owner on file" && r.detail !== "not a matched inbound email" && r.detail !== "too old for an automatic reply" && r.detail !== "job not found" && !/partner or staff/.test(r.detail)) {
      const changeAsk = r.status === "skip" && /245\/337/.test(r.detail);
      const replied337 = changeAsk ? await changeReplied(jobIds[0]!, m.providerMessageId) : false;
      if (!replied337) {
        const kind = r.status === "none" || changeAsk || /approval|comms are switched off/.test(r.detail) ? "simple" : "other";
        await (await import("./ai-email-reply.server")).writeAiReplyDraft({ jobId: jobIds[0]!, message: m, kind, reason: r.detail });
      }
    }
    return r.suppressDraft;
  } catch (e) {
    console.error("owner auto reply skipped", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Decision 244: one reply DRAFT per new inbound email (never sent). Switch off = nothing loaded or done. Never throws. */
async function draftReply(m: MailMessage, mailbox: string | null, jobIds: string[], origin: "sync" | "office_matched" | "unmatched"): Promise<string | null> {
  if (!EMAIL_REPLY_DRAFTS_ENABLED || m.direction !== "inbound") return null;
  try {
    const r = await (await import("./email-reply.server")).draftReplyForMessage({ message: m, mailbox, jobIds, origin });
    return r.status === "drafted" ? r.draftId : null;
  } catch (e) {
    console.error("email reply draft skipped", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Decision 292: ONE website reply to a new human sender whose unmatched mail is an enquiry / price / rebate question
 *  (never an enquiry; held in TEST mode unless allow-listed). Runs right after the `email_unmatched` row so the office can still Match.
 *  Never throws. */
async function newSenderReply(m: MailMessage, mailbox: string, counts: SyncCounts): Promise<void> {
  if (m.direction !== "inbound") return;
  try {
    const r = await (await import("./new-sender-reply.server")).replyToNewSender(m, { mailbox });
    if (r.status === "sent") bump(counts, "newSenderReplies");
    else if (r.status === "held") bump(counts, "newSenderHeld");
  } catch (e) {
    console.error("new sender reply skipped", e instanceof Error ? e.message : e);
  }
}

/** Office matched an unmatched email (decision 247): re-read the full message from Outlook (read-only), store its
 *  files privately for this job, file it on the job with the copier's own storeOnJob, then raise any change request.
 *  Idempotent per job (storeOnJob returns null when already filed). Throws when Outlook can't be read — nothing filed. */
export async function fileOutlookMessageOnJob(d: { message_id: string; mailbox?: string | null }, jobId: string, visibility: "customer" | "internal"): Promise<{ communicationId: string | null; message: MailMessage; changeRequests: number; replyDraftId: string | null }> {
  if (!outlookConfigured()) throw new Error("Outlook is not connected, so the email can't be read to file it.");
  const mailbox = normaliseMailbox(d.mailbox ?? (await readOutlookSyncState()).expected_mailbox);
  if (!mailbox) throw new Error("No shared mailbox is confirmed for Outlook.");
  const g = await graph<GraphMessage>(`${outlookMailboxPath(mailbox)}/messages/${encodeURIComponent(d.message_id)}?$select=${SELECT}`);
  const m = normaliseMessage(g, mailbox, OUR_DOMAINS);
  if (!m || m.providerMessageId !== d.message_id) throw new Error("Outlook returned a different message; nothing was filed.");
  let refs: StoredAttachmentRef[] = [];
  if (m.hasAttachments) {
    const work: Work = { provider_message_id: m.providerMessageId, mailbox, message: m, route: { kind: "job", jobIds: [jobId], how: "thread" }, attachments_complete: false, attachment_refs: [], status: "pending", record_only: true };
    refs = (await storeAttachments(work, await attachmentsFor(m.providerMessageId, mailbox), [jobId])).refs;
  }
  const filed = { ...m, attachments: refs };
  const communicationId = await storeOnJob(jobId, filed, "office_matched", visibility);
  const changeRequests = await recordChangeRequests([jobId], filed, refs);
  const replied = await ownerAutoReply([jobId], filed, mailbox);
  const replyDraftId = replied ? null : await draftReply(filed, mailbox, [jobId], "office_matched");
  return { communicationId, message: m, changeRequests, replyDraftId };
}

async function finishWork(work: Work, counts: SyncCounts, window: ClosureWindow): Promise<void> {
  if (work.route.kind !== "job" || !isHumanOwnerEmail({...work.message,provider:"outlook",channel:"email"})) return;
  try {
    if (!work.attachments_complete) {
      const refs = await attachmentsFor(work.provider_message_id, work.mailbox);
      const storedRefs = await storeAttachments(work, refs, routeJobIds(work.route));
      const { data, error } = await syncAdmin.from("outlook_message_work")
        .update({ attachments_complete: true, attachment_refs: storedRefs.refs, last_error: null })
        .eq("provider_message_id", work.provider_message_id).eq("status", "pending")
        .eq("attachments_complete", false).select("provider_message_id");
      if (error) throw new Error(`Attachment metadata was not saved: ${error.message}`);
      if (!data?.length) {
        const { data: current, error: ce } = await syncAdmin.from("outlook_message_work").select("*").eq("provider_message_id", work.provider_message_id).single();
        if (ce || !current) throw new Error(`Outlook work unavailable: ${ce?.message ?? "row missing"}`);
        if (current.status === "complete") { counts.duplicate++; return; }
        if (!current.attachments_complete) throw new Error("Attachment metadata remains pending.");
      } else {
        work.attachment_refs = storedRefs.refs;
        counts.files += storedRefs.stored;
        counts.filesSkipped += storedRefs.skipped;
      }
    } else if (work.message.hasAttachments && (work.attachment_refs ?? []).some((r) => r.path === null && r.skipped === null)) {
      // Work completed by the metadata-only era: its files were never downloaded. Repair them
      // idempotently (verified existing objects are reused). No workflow changes.
      const repaired = await repairAttachments(work);
      if (repaired) counts.files += repaired.stored;
    }
    const decision = { action: "none" };
    const { data, error } = await syncAdmin.rpc("finish_outlook_message", { _message_id: work.provider_message_id, _decision: decision });
    if (error || !data) throw new Error(`Outlook message processing is unfinished: ${error?.message ?? "result missing"}`);
    const result = data as WorkResult;
    if (result.replayed || result.duplicate) counts.duplicate++;
    else {
      if (result.stored) { counts.stored++; bump(counts, "matched"); }
      if (result.stored && !window.history) bump(counts, "changeRequests", await recordChangeRequests(routeJobIds(work.route), work.message, work.attachment_refs ?? []));
      const replied = result.stored && !window.history ? await ownerAutoReply(routeJobIds(work.route), { ...work.message, attachments: work.attachment_refs?.length ? work.attachment_refs : work.message.attachments }, work.mailbox, counts) : false;
      if (result.stored && !window.history && !replied && await draftReply(work.message, work.mailbox, routeJobIds(work.route), "sync")) bump(counts, "replyDrafts");
      if (result.unmatched) counts.unmatched++;
      if (result.closed) counts.closed++;
      if (result.flagged) counts.flagged++;
      if (result.ignored) counts.notHomeowner++;
    }
  } catch (e) {
    counts.errors++;
    const problem = e instanceof Error ? e.message : "Outlook processing failed.";
    const { error } = await syncAdmin.from("outlook_message_work").update({ last_error: problem.slice(0, 500) })
      .eq("provider_message_id", work.provider_message_id).eq("status", "pending");
    if (error) throw new Error(`${problem} The retry record could not be updated: ${error.message}`);
  }
}

async function portalDuplicate(m: MailMessage, jobId: string): Promise<boolean> {
  if (m.direction !== "outbound") return false;
  const centre = Date.parse(m.at);
  if (!Number.isFinite(centre)) throw new Error("Outlook message timestamp is invalid.");
  // Scope + paginate history; a provider/API row cap must not hide a prior portal delivery.
  for (let from = 0; ; from += 200) {
    const { data, error } = await syncAdmin.from("job_communications")
      .select("id,provider,subject,recipients,sent_at,direction,body").eq("job_id", jobId).eq("direction", "outbound")
      .neq("provider", "outlook").gte("sent_at", new Date(centre - 15 * 60_000).toISOString())
      .lte("sent_at", new Date(centre + 15 * 60_000).toISOString()).order("id").range(from, from + 199);
    if (error || !data) throw new Error(`Outbound correspondence unavailable: ${error?.message ?? "rows missing"}`);
    if (isPortalDuplicate(m, data.map((c) => ({ provider: c.provider, subject: c.subject, recipients: c.recipients ?? [], at: c.sent_at, direction: c.direction, body: c.body })))) return true;
    if (data.length < 200) return false;
  }
}

export async function processMessages(raw: GraphMessage[], mailbox: string, counts: SyncCounts,
  window: ClosureWindow = { inboxCompleteThrough: null }) {
  const normalised = raw.map((g) => normaliseMessage(g, mailbox, OUR_DOMAINS)).filter((m): m is MailMessage => !!m);
  const msgs = normalised.filter((m) => isHumanOwnerEmail({...m,provider:"outlook",channel:"email"}));
  bump(counts, "junk", normalised.length - msgs.length);
  if (!msgs.length) return;
  if (msgs.some(m => !m.providerMessageId || !Number.isFinite(Date.parse(m.at)) || Date.parse(m.at) <= 0))
    throw new Error("Outlook returned a message without a usable identity or timestamp.");
  const { byNumber, byEmail, byThread, byId } = await loadCandidates(msgs, mailbox);
  const work: Work[] = [];
  const recordOnly = true;
  // Reserve the entire page before decisions, so a later reply on this page is visible to earlier declines.
  for (const m of msgs) {
    // A mutable old id whose immutable internetMessageId matches an already-stored message is the same
    // original under a changed id; its files are repaired idempotently. Distinct emails keep distinct
    // internetMessageIds and are never merged.
    if (m.internetMessageId) {
      const { data: aliases, error: ae } = await syncAdmin.from("job_communications").select("job_id")
        .eq("provider", "outlook").eq("source_reference", m.internetMessageId).neq("provider_message_id", m.providerMessageId).limit(20);
      if (ae) throw new Error(`Outlook identity history unavailable: ${ae.message}`);
      const aliasIds = [...new Set((aliases ?? []).map((a) => String(a.job_id)))];
      if (aliasIds.length) {
        counts.duplicate++;
        if (m.hasAttachments) {
          try {
            const r = await repairAttachments({ provider_message_id: m.providerMessageId, mailbox, message: m, route: { kind: "job", jobIds: aliasIds, how: "thread" }, attachments_complete: true, attachment_refs: [], status: "complete", record_only: true });
            if (r) counts.files += r.stored;
          } catch { counts.filesSkipped++; } // visible in the counts; retried naturally on the next sync
        }
        continue;
      }
    }
    let route: Route = matchMessage(m, counterpartEmails(m, mailbox, OUR_DOMAINS), byNumber, byEmail, byThread);
    if (route.kind !== "job") {
      // Decision 247: unmatched human inbound mail → one job-less `email_unmatched` event (never on a job until matched).
      // History catch-ups and old mail stay record-only in Outlook, as before.
      if (route.kind === "unmatched" && m.direction === "inbound") {
        const r = !window.history && recentEnoughForAction(m.at) ? await recordUnmatched(m, mailbox, route.candidateJobIds, route.reason) : "not_recorded";
        if (r === "recorded") {
          bump(counts, "unmatched");
          if (await draftReply(m, mailbox, [], "unmatched")) bump(counts, "replyDrafts");
          await newSenderReply(m, mailbox, counts); // decision 292: website reply, never an enquiry
        }
        else if (r === "duplicate") counts.duplicate++;
        else { counts.notHomeowner++; bump(counts, "unmatchedNotRecorded"); }
      } else counts.notHomeowner++;
      continue;
    }
    // Our own outbound copy of an email the portal already recorded is not new history on that job.
    if (route.kind === "job" && m.direction === "outbound") {
      const remaining: string[] = [];
      for (const jid of routeJobIds(route)) if (!(await portalDuplicate(m, jid))) remaining.push(jid);
      if (!remaining.length) { counts.portalDuplicate++; continue; }
      route = { ...route, jobIds: remaining };
    }
    const { data: existing, error: ee } = await syncAdmin.from("outlook_message_work").select("*")
      .eq("provider_message_id", m.providerMessageId).maybeSingle();
    if (ee) throw new Error(`Outlook processing history unavailable: ${ee.message}`);
    if (existing) {
      if (existing.mailbox !== mailbox) throw new Error("Outlook message belongs to a different mailbox.");
      if (existing.status === "pending") work.push(existing as Work); else counts.duplicate++;
      continue;
    }
    const { data, error } = await syncAdmin.rpc("begin_outlook_message", { _mailbox: mailbox, _message: m, _route: route, _record_only: recordOnly });
    if (error || !data) throw new Error(`Outlook message could not be reserved: ${error?.message ?? "result missing"}`);
    if (data.state === "pending") {
      work.push(data.work as Work);
      // A family reply later in the same batch must find the thread its first message just created.
      if (m.threadId && route.kind === "job") {
        const cands = routeJobIds(route).map((id) => byId.get(id)).filter((c): c is CandidateJob => !!c);
        byThread.set(m.threadId, [...new Map([...(byThread.get(m.threadId) ?? []), ...cands].map((c) => [c.id, c])).values()]);
      }
    } else {
      counts.duplicate++;
      // Mail stored by the metadata-only era: repair its missing files idempotently, no workflow changes.
      if (route.kind === "job" && m.hasAttachments) {
        try {
          const r = await repairAttachments({ provider_message_id: m.providerMessageId, mailbox, message: m, route, attachments_complete: true, attachment_refs: [], status: "complete", record_only: true });
          if (r) counts.files += r.stored;
        } catch { counts.filesSkipped++; }
      }
    }
  }
  for (const item of work.sort((a, b) => Date.parse(a.message.at) - Date.parse(b.message.at))) await finishWork(item, counts, window);
}

/** Retry only explicitly pending new imports, never unmarked legacy correspondence. No mailbox reread required. */
async function resumePending(mailbox: string, counts: SyncCounts, window: ClosureWindow): Promise<void> {
  const { data, error } = await syncAdmin.from("outlook_message_work").select("*")
    .eq("mailbox", mailbox).eq("status", "pending").order("created_at").limit(200);
  if (error || !data) throw new Error(`Outlook retry queue unavailable: ${error?.message ?? "rows missing"}`);
  // This queue is independent of timestamp cursors: unresolved old work is never silently skipped.
  for (const work of data as Work[]) await finishWork(work, counts, window);
}

/** A failed/concurrent status save is an error, never a successful sync. */
async function saveSyncState(state: SyncState, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await syncAdmin.from("outlook_sync_state")
    .update({ ...patch, updated_at: new Date(Math.max(Date.now(), Date.parse(state.updated_at) + 1)).toISOString() })
    .eq("id", 1).eq("updated_at", state.updated_at).select("id");
  if (error || data?.length !== 1) throw new Error(`Outlook sync state was not saved: ${error?.message ?? "another run changed it; retry from its saved cursor"}`);
}

/** Bounded import. Successful bounded stops save the provider continuation, including equal-timestamp pages. */
export async function runOutlookSync(opts: { maxPages?: number; pageSize?: number } = {}): Promise<{ ok: boolean; blocker?: string; counts: SyncCounts }> {
  const counts: SyncCounts = { fetched: 0, stored: 0, duplicate: 0, portalDuplicate: 0, notHomeowner: 0, unmatched: 0, closed: 0, flagged: 0, files: 0, filesSkipped: 0, errors: 0, matched: 0, junk: 0, unmatchedNotRecorded: 0, changeRequests: 0 };
  let state: SyncState | null = null;
  const now = new Date().toISOString();
  try {
    state = await readOutlookSyncState();
    if (!outlookConfigured()) throw new Error("Outlook credentials are not configured for this project.");
    if (!state.expected_mailbox) throw new Error("Enter, check and confirm the intended shared business mailbox address before importing correspondence.");
    const me = await accountIdentity(state.expected_mailbox);
    await verifyMailboxReadAccess(state.expected_mailbox);
    const health = checkedOutlookHealth(true, state.expected_mailbox, me, now, state.expected_mailbox);
    if (!health.readyForSync || !health.targetMailbox) throw new Error(health.problem ?? "Shared mailbox access could not be verified.");
    const mailbox = health.targetMailbox;
    const maxPages = Math.max(1, Math.min(10, Math.floor(opts.maxPages ?? 10)));
    const pageSize = Math.max(1, Math.min(50, Math.floor(opts.pageSize ?? 50)));
    const cursors: Record<string, string | null> = {};

    // One folder-agnostic pull per direction: mail moved to Archive or a custom folder is still listed,
    // so a move between runs can never create a gap (already-imported messages dedupe by provider id).
    const pull = async (field: "receivedDateTime" | "sentDateTime", cursorKey: keyof SyncState, nextKey: keyof SyncState,
      since: string, window: ClosureWindow, completeWhenFresh: string | null) => {
      if (!Number.isFinite(Date.parse(since))) throw new Error("Outlook has an invalid saved timestamp; Office must review the cursor.");
      const savedNext = state![nextKey] as string | null;
      const freshUrl = `${outlookMailboxPath(mailbox)}/messages?$select=${SELECT}&$filter=${field} ge ${new Date(since).toISOString()} and ${field} le ${now}&$orderby=${field} asc&$top=${pageSize}`;
      let url: string | null = savedNext ? outlookGatewayUrl(savedNext) : freshUrl;
      let usingSavedNext = !!savedNext;
      let recovered = false;
      let last = since;
      const visited = new Set<string>();
      for (let page = 0; url && page < maxPages; page++) {
        const canonical = outlookGatewayUrl(url);
        if (visited.has(canonical)) throw new Error("Outlook repeated a continuation; the cursor was not advanced.");
        visited.add(canonical);
        let response: { value: GraphMessage[]; "@odata.nextLink"?: string };
        try { response = await graph(canonical); }
        catch (e) {
          // An expired or invalid saved continuation is recovered by replaying that stream from its saved
          // timestamp — already-imported messages dedupe by provider id, so nothing is skipped or repeated.
          if (usingSavedNext && !recovered) { recovered = true; usingSavedNext = false; url = freshUrl; continue; }
          throw e;
        }
        if (!Array.isArray(response.value)) throw new Error("Outlook returned an invalid message page.");
        // Validate continuation before committing effects from the page.
        const next = response["@odata.nextLink"] ? outlookGatewayUrl(response["@odata.nextLink"]) : null;
        // A saved continuation belongs to an older cutoff. Even its final page cannot prove that
        // newer replies are absent. Such declines get Office review, never an automatic closure.
        // Inbound is processed first, so outbound and pending retries receive the same proven window.
        const win: ClosureWindow = completeWhenFresh && !usingSavedNext && !next ? { ...window, inboxCompleteThrough: completeWhenFresh } : window;
        counts.fetched += response.value.length;
        await processMessages(response.value, mailbox, counts, win);
        if (counts.errors) throw new Error(`${counts.errors} message(s) remain unfinished; the cursor was not advanced.`);
        const tail = response.value.at(-1);
        const tailAt = tail ? (field === "receivedDateTime" ? tail.receivedDateTime : tail.sentDateTime) : null;
        if (tailAt) {
          if (!Number.isFinite(Date.parse(tailAt))) throw new Error("Outlook returned an invalid page timestamp.");
          if (Date.parse(tailAt) > Date.parse(last)) last = tailAt;
        }
        url = next;
      }
      cursors[cursorKey as string] = last;
      cursors[nextKey as string] = url;
      return url;
    };

    if (state.catchup_from) {
      // Historical catch-up: record-only before backfill_from, resumable across runs, then cleared.
      let done = 0;
      const historyWindow: ClosureWindow = { inboxCompleteThrough: null, history: true, backfillFrom: state.backfill_from };
      const streams = [
        ["receivedDateTime", "catchup_inbound_cursor", "catchup_inbound_next_link"],
        ["sentDateTime", "catchup_outbound_cursor", "catchup_outbound_next_link"],
      ] as const;
      for (const [field, cursorKey, nextKey] of streams) {
        const since = (state[cursorKey] as string | null) ?? state.catchup_from;
        const remaining = await pull(field, cursorKey, nextKey, since, historyWindow, null);
        if (!remaining) done++;
      }
      if (done === 2) {
        cursors["catchup_from"] = null;
        cursors["catchup_inbound_cursor"] = null; cursors["catchup_inbound_next_link"] = null;
        cursors["catchup_outbound_cursor"] = null; cursors["catchup_outbound_next_link"] = null;
      }
      await resumePending(mailbox, counts, historyWindow);
    } else {
      let inboxCompleteThrough: string | null = null;
      const inboundRemaining = await pull("receivedDateTime", "all_inbound_cursor", "all_inbound_next_link",
        state.all_inbound_cursor ?? state.backfill_from, { inboxCompleteThrough: null }, now);
      if (!state.all_inbound_next_link && !inboundRemaining) inboxCompleteThrough = now;
      await pull("sentDateTime", "all_outbound_cursor", "all_outbound_next_link",
        state.all_outbound_cursor ?? state.backfill_from, { inboxCompleteThrough }, null);
      await resumePending(mailbox, counts, { inboxCompleteThrough });
    }
    if (counts.errors) throw new Error(`${counts.errors} message(s) remain unfinished; the cursor was not advanced.`);
    await saveSyncState(state, { ...cursors, mailbox, last_run_at: now, last_ok_at: now, last_error: null, last_counts: counts });
    return { ok: true, counts };
  } catch (e) {
    let problem = e instanceof Error ? e.message : "Outlook sync failed.";
    if (state) {
      try { await saveSyncState(state, { last_run_at: now, last_error: problem.slice(0, 500), last_counts: counts }); }
      catch (saveError) { problem += ` ${saveError instanceof Error ? saveError.message : "The failure status could not be saved."}`; }
    }
    return { ok: false, blocker: problem, counts };
  }
}

/** Office-set historical catch-up start (null stops it). Explicit only — there is never a silent cutoff.
 *  All catch-up work is record-only; completion clears the cursors automatically in the normal run.
 *  Setting this does not start anything by itself: the next scheduled/manual run picks it up. */
export async function setCatchupFrom(from: string | null): Promise<void> {
  const state = await readOutlookSyncState();
  if (from !== null && !Number.isFinite(Date.parse(from))) throw new Error("A valid catch-up start date is required.");
  if (from !== null && Date.parse(from) > Date.now()) throw new Error("The catch-up start date cannot be in the future.");
  await saveSyncState(state, {
    catchup_from: from,
    catchup_inbound_cursor: null, catchup_inbound_next_link: null,
    catchup_outbound_cursor: null, catchup_outbound_next_link: null,
  });
}


/**
 * Jo 27 Oct 2026: once an owner email has been answered (Send) or dealt with (Done), move it out of the
 * Outlook inbox into Archive. Immutable ids mean the portal still recognises it there. Never throws: a failure
 * is logged on the job so the office can see it, and the email simply stays in the inbox.
 */
export async function archiveOutlookMessage(messageId: string | null | undefined, jobId: string | null, actorId: string | null): Promise<"archived" | "skipped" | "failed"> {
  if (!messageId || !outlookConfigured()) return "skipped";
  const loose = admin as unknown as SupabaseClient;
  try {
    const { data: already } = await loose.from("workflow_events").select("id").eq("event_type", "email_archived_in_outlook").eq("details->>message_id", messageId).limit(1);
    if ((already ?? []).length) return "archived";
    const mailbox = normaliseMailbox((await readOutlookSyncState()).expected_mailbox);
    if (!mailbox) return "skipped";
    const res = await fetch(outlookGatewayUrl(`${outlookMailboxPath(mailbox)}/messages/${encodeURIComponent(messageId)}/move`), {
      method: "POST", redirect: OUTLOOK_REQUEST_REDIRECT, signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]}`,
        "X-Connection-Api-Key": process.env["MICROSOFT_OUTLOOK_API_KEY"]!,
        Prefer: 'IdType="ImmutableId"',
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ destinationId: "archive" }),
    });
    if (!res.ok) throw new Error(`Outlook move failed (HTTP ${res.status})`);
    await loose.from("workflow_events").insert({ job_id: jobId, actor_id: actorId, event_type: "email_archived_in_outlook", internal: true, summary: "Email moved to the Outlook Archive after it was dealt with", details: { message_id: messageId } });
    return "archived";
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error("Outlook archive failed", why);
    await loose.from("workflow_events").insert({ job_id: jobId, actor_id: actorId, event_type: "email_archive_failed", internal: true, summary: "Couldn't move the email to the Outlook Archive — it's still in the inbox", details: { message_id: messageId, error: why.slice(0, 300) } });
    return "failed";
  }
}

// Outlook correspondence sync (read-only on the mailbox — it never sends). Pulls the whole mailbox
// (folder-agnostic, so mail moved to Archive or custom folders is never skipped), stores each homeowner
// email once per relevant job (job_communications, provider=outlook), preserves attachments in private
// storage, queues ambiguous ones for Office, and closes early-stage records only on an explicit
// "not proceeding" email. Historical catch-up is record-only before backfill_from.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkedOutlookHealth, normaliseMailbox, outlookGatewayUrl, outlookMailboxPath, uncheckedOutlookHealth, type OutlookHealth } from "./outlook-connection.core";
import {
  attachmentStoragePath, classifyIntent, closureDecision, counterpartEmails, extractJobNumbers, isPortalDuplicate, matchMessage, normaliseMessage,
  planAttachments, type AttachmentRef, type CandidateJob, type GraphMessage, type MailMessage, type MatchResult, type StoredAttachmentRef,
} from "./outlook-correspondence.core";

// New migration types are local until the database-generated types are refreshed on integration.
const syncAdmin = admin as SupabaseClient;
type Route = Exclude<MatchResult, { kind: "not_homeowner" }>;
type Work = { provider_message_id: string; mailbox: string; message: MailMessage; route: Route; attachments_complete: boolean; attachment_refs: StoredAttachmentRef[]; status: "pending" | "complete" };
type SyncState = {
  id: number; expected_mailbox: string | null; mailbox: string | null; backfill_from: string;
  inbox_cursor: string | null; sent_cursor: string | null; inbox_next_link: string | null; sent_next_link: string | null;
  all_inbound_cursor: string | null; all_inbound_next_link: string | null; all_outbound_cursor: string | null; all_outbound_next_link: string | null;
  catchup_from: string | null; catchup_inbound_cursor: string | null; catchup_inbound_next_link: string | null; catchup_outbound_cursor: string | null; catchup_outbound_next_link: string | null;
  updated_at: string; last_run_at: string | null; last_ok_at: string | null; last_error: string | null; last_counts: Record<string, number>;
};
type WorkResult = { stored?: boolean; unmatched?: boolean; closed?: boolean; flagged?: boolean; duplicate?: boolean; ignored?: boolean; replayed?: boolean };
type ClosureWindow = { inboxCompleteThrough: string | null; history?: boolean; backfillFrom?: string | null };
const OUR_DOMAINS = ["homeinsulationvictoria.com.au"];
const SELECT = "id,conversationId,internetMessageId,subject,body,bodyPreview,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,hasAttachments,isDraft";
const BUCKET = "job-files";

export type SyncCounts = { fetched: number; stored: number; duplicate: number; portalDuplicate: number; notHomeowner: number; unmatched: number; closed: number; flagged: number; files: number; filesSkipped: number; errors: number };

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
    method: "GET", redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]}`,
      "X-Connection-Api-Key": process.env["MICROSOFT_OUTLOOK_API_KEY"]!,
      Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"',
    },
  });
  if (!res.ok) throw new Error(`Outlook request failed (HTTP ${res.status}). Check the connector account and permissions.`);
  try { return (await res.json()) as T; }
  catch { throw new Error("Outlook returned an unreadable response."); }
}

/** Raw bytes of one attachment ($value). Never follows redirects; the URL goes through the approved-gateway check. */
async function attachmentBytes(mailbox: string, messageId: string, attachmentId: string): Promise<ArrayBuffer> {
  const res = await fetch(outlookGatewayUrl(`${outlookMailboxPath(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`), {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]}`,
      "X-Connection-Api-Key": process.env["MICROSOFT_OUTLOOK_API_KEY"]!,
    },
  });
  if (!res.ok) throw new Error(`Outlook attachment download failed (HTTP ${res.status}).`);
  return res.arrayBuffer();
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
    const me = await graph<{ id?: string; mail?: string | null; userPrincipalName?: string | null; displayName?: string | null }>("/me?$select=id,mail,userPrincipalName,displayName");
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

/** Downloads and privately stores each attachment (retry-safe: an existing object is kept, never duplicated). */
async function storeAttachments(work: Work, refs: AttachmentRef[]): Promise<{ refs: StoredAttachmentRef[]; stored: number; skipped: number }> {
  const prefix = work.route.kind === "job" ? (routeJobIds(work.route)[0] ?? "unmatched") : "unmatched";
  const plan = planAttachments(refs);
  const skippedIds = new Set(plan.skipped.map((s) => s.ref.id));
  const reasonById = new Map(plan.skipped.map((s) => [s.ref.id, s.reason]));
  const stored: StoredAttachmentRef[] = [];
  let storedCount = 0;
  for (const [i, ref] of refs.entries()) {
    if (skippedIds.has(ref.id)) { stored.push({ ...ref, path: null, storedAt: null, skipped: reasonById.get(ref.id) ?? "skipped" }); continue; }
    const bytes = await attachmentBytes(work.mailbox, work.provider_message_id, ref.id);
    const path = attachmentStoragePath(prefix, work.provider_message_id, i, ref.name);
    const { error } = await (admin.storage.from(BUCKET) as unknown as {
      upload: (p: string, body: Uint8Array, o: { contentType: string; upsert: boolean }) => Promise<{ error: { message: string } | null }>;
    }).upload(path, new Uint8Array(bytes), { contentType: ref.contentType ?? "application/octet-stream", upsert: false });
    // A retry after a crash re-uploads the same bytes to the same deterministic path; that is the same file.
    if (error && !/exist/i.test(error.message)) throw new Error(`Outlook attachment was not stored: ${error.message}`);
    stored.push({ ...ref, path, storedAt: new Date().toISOString(), skipped: null });
    storedCount++;
  }
  return { refs: stored, stored: storedCount, skipped: plan.skipped.length };
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
  const byNumber = new Map<string, CandidateJob>(), byEmail = new Map<string, CandidateJob[]>(), byThread = new Map<string, string[]>();
  for (let i = 0; i < numbers.length; i += 100) {
    const { data, error } = await admin.from("jobs").select(sel).in("job_number", numbers.slice(i, i + 100)).is("deleted_at", null).neq("source", "qa_test");
    if (error) throw new Error(error.message);
    for (const j of data ?? []) { const c = toCand(j as never); byNumber.set(c.jobNumber, c); }
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
    }
  }
  // Threads already stored on jobs: a reply in a known conversation links even from a family/manager address.
  for (let i = 0; i < threads.length; i += 100) {
    const { data, error } = await admin.from("job_communications").select("job_id, provider_thread_id")
      .eq("provider", "outlook").in("provider_thread_id", threads.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const c of data ?? []) {
      const t = c.provider_thread_id as string | null;
      if (!t) continue;
      byThread.set(t, [...new Set([...(byThread.get(t) ?? []), String(c.job_id)])]);
    }
  }
  return { byNumber, byEmail, byThread };
}

/** Stores one matched message on its job. Returns the new communication id, or null when it was already stored. */
export async function storeOnJob(jobId: string, m: MailMessage, how: string): Promise<string | null> {
  const { data, error } = await admin.from("job_communications").insert({
    job_id: jobId, direction: m.direction, channel: "email", sender_text: m.fromName ? `${m.fromName} <${m.from}>` : m.from, recipients: [...m.to, ...m.cc],
    subject: m.subject, body: m.body || "(no text)", provider: "outlook", provider_message_id: m.providerMessageId, provider_thread_id: m.threadId,
    sent_at: m.direction === "outbound" ? m.at : null, received_at: m.direction === "inbound" ? m.at : null,
    delivery_status: m.direction === "inbound" ? "received" : "sent", visibility: "customer", attachment_refs: m.attachments,
    source_event: `outlook_sync:${how}`, source_reference: m.internetMessageId, created_by: null,
  }).select("id").single();
  if (error) { if (error.code === "23505") return null; throw new Error(error.message); }
  return data.id;
}

/** Determine a new message's decision from current facts. Missing/error counts must never become zero. */
async function decisionFor(work: Work, window: ClosureWindow): Promise<Record<string, unknown>> {
  const m = work.message;
  const jobIds = routeJobIds(work.route);
  // Workflow decisions only ever apply to a single confirmed job and to live mail, never to historical catch-up.
  if (work.route.kind !== "job" || jobIds.length !== 1 || m.direction !== "inbound") return { action: "none" };
  if (window.history && window.backfillFrom && Date.parse(m.at) < Date.parse(window.backfillFrom)) return { action: "none" };
  const jobId = jobIds[0]!;
  const intent = classifyIntent(m.body);
  if (intent.kind === "none") return { action: "none" };
  const { data: job, error: je } = await syncAdmin.from("jobs").select("stage").eq("id", jobId).single();
  if (je || !job) throw new Error(`Job state unavailable for Outlook decision: ${je?.message ?? "job missing"}`);
  const [history, pending] = await Promise.all([
    syncAdmin.from("job_communications").select("id", { count: "exact", head: true })
      .eq("job_id", jobId).eq("direction", "inbound").gt("received_at", m.at),
    syncAdmin.from("outlook_message_work").select("provider_message_id", { count: "exact", head: true })
      .eq("job_id", jobId).eq("message->>direction", "inbound").gt("message_at", m.at),
  ]);
  for (const result of [history, pending]) if (result.error || result.count == null)
    throw new Error(`Later correspondence unavailable: ${result.error?.message ?? "exact count missing"}`);
  let d = closureDecision(job.stage, intent, { laterInbound: history.count! + pending.count! > 0 });
  if (d.action === "close" && (!window.inboxCompleteThrough
    || !Number.isFinite(Date.parse(window.inboxCompleteThrough)) || Date.parse(m.at) > Date.parse(window.inboxCompleteThrough))) {
    d = { action: "flag", kind: "possible_not_proceeding",
      reason: `${d.reason} — later Inbox correspondence has not been fully checked through this sync window; Office to decide` };
  }
  return { ...d, expectedStage: job.stage, phrase: intent.phrase, inboxCompleteThrough: window.inboxCompleteThrough,
    ...(d.action === "flag" && intent.kind === "not_proceeding" ? { suggestedReason: d.reason } : {}) };
}

async function finishWork(work: Work, counts: SyncCounts, window: ClosureWindow): Promise<void> {
  try {
    if (!work.attachments_complete) {
      const refs = await attachmentsFor(work.provider_message_id, work.mailbox);
      const storedRefs = await storeAttachments(work, refs);
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
    }
    const decision = await decisionFor(work, window);
    const { data, error } = await syncAdmin.rpc("finish_outlook_message", { _message_id: work.provider_message_id, _decision: decision });
    if (error || !data) throw new Error(`Outlook message processing is unfinished: ${error?.message ?? "result missing"}`);
    const result = data as WorkResult;
    if (result.replayed || result.duplicate) counts.duplicate++;
    else {
      if (result.stored) counts.stored++;
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
      .select("id,provider,subject,recipients,sent_at,direction").eq("job_id", jobId).eq("direction", "outbound")
      .neq("provider", "outlook").gte("sent_at", new Date(centre - 15 * 60_000).toISOString())
      .lte("sent_at", new Date(centre + 15 * 60_000).toISOString()).order("id").range(from, from + 199);
    if (error || !data) throw new Error(`Outbound correspondence unavailable: ${error?.message ?? "rows missing"}`);
    if (isPortalDuplicate(m, data.map((c) => ({ provider: c.provider, subject: c.subject, recipients: c.recipients ?? [], at: c.sent_at, direction: c.direction })))) return true;
    if (data.length < 200) return false;
  }
}

export async function processMessages(raw: GraphMessage[], mailbox: string, counts: SyncCounts,
  window: ClosureWindow = { inboxCompleteThrough: null }) {
  const msgs = raw.map((g) => normaliseMessage(g, mailbox, OUR_DOMAINS)).filter((m): m is MailMessage => !!m);
  if (!msgs.length) return;
  if (msgs.some(m => !m.providerMessageId || !Number.isFinite(Date.parse(m.at)) || Date.parse(m.at) <= 0))
    throw new Error("Outlook returned a message without a usable identity or timestamp.");
  const { byNumber, byEmail, byThread } = await loadCandidates(msgs, mailbox);
  const work: Work[] = [];
  // Reserve the entire page before decisions, so a later reply on this page is visible to earlier declines.
  for (const m of msgs) {
    let route: Route | null = matchMessage(m, counterpartEmails(m, mailbox, OUR_DOMAINS), byNumber, byEmail, byThread);
    if (route.kind === "not_homeowner") { counts.notHomeowner++; continue; }
    // Our own outbound copy of an email the portal already recorded is not new history on that job.
    if (route.kind === "job" && m.direction === "outbound") {
      const remaining: string[] = [];
      for (const jid of routeJobIds(route)) if (!(await portalDuplicate(m, jid))) remaining.push(jid);
      if (!remaining.length) { counts.portalDuplicate++; continue; }
      route = { kind: "job", jobIds: remaining, how: route.how };
    }
    const { data: existing, error: ee } = await syncAdmin.from("outlook_message_work").select("*")
      .eq("provider_message_id", m.providerMessageId).maybeSingle();
    if (ee) throw new Error(`Outlook processing history unavailable: ${ee.message}`);
    if (existing) {
      if (existing.mailbox !== mailbox) throw new Error("Outlook message belongs to a different mailbox.");
      if (existing.status === "pending") work.push(existing as Work); else counts.duplicate++;
      continue;
    }
    const { data, error } = await syncAdmin.rpc("begin_outlook_message", { _mailbox: mailbox, _message: m, _route: route });
    if (error || !data) throw new Error(`Outlook message could not be reserved: ${error?.message ?? "result missing"}`);
    if (data.state === "pending") work.push(data.work as Work); else counts.duplicate++;
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
  const counts: SyncCounts = { fetched: 0, stored: 0, duplicate: 0, portalDuplicate: 0, notHomeowner: 0, unmatched: 0, closed: 0, flagged: 0, files: 0, filesSkipped: 0, errors: 0 };
  let state: SyncState | null = null;
  const now = new Date().toISOString();
  try {
    state = await readOutlookSyncState();
    if (!outlookConfigured()) throw new Error("Outlook credentials are not configured for this project.");
    if (!state.expected_mailbox) throw new Error("Enter, check and confirm the intended shared business mailbox address before importing correspondence.");
    const me = await graph<{ id?: string; mail?: string; userPrincipalName?: string; displayName?: string }>("/me?$select=id,mail,userPrincipalName,displayName");
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
      let url: string | null = savedNext ? outlookGatewayUrl(savedNext)
        : `${outlookMailboxPath(mailbox)}/messages?$select=${SELECT}&$filter=${field} ge ${new Date(since).toISOString()} and ${field} le ${now}&$orderby=${field} asc&$top=${pageSize}`;
      let last = since;
      const visited = new Set<string>();
      for (let page = 0; url && page < maxPages; page++) {
        const canonical = outlookGatewayUrl(url);
        if (visited.has(canonical)) throw new Error("Outlook repeated a continuation; the cursor was not advanced.");
        visited.add(canonical);
        const response: { value: GraphMessage[]; "@odata.nextLink"?: string } = await graph(canonical);
        if (!Array.isArray(response.value)) throw new Error("Outlook returned an invalid message page.");
        // Validate continuation before committing effects from the page.
        const next = response["@odata.nextLink"] ? outlookGatewayUrl(response["@odata.nextLink"]) : null;
        // A saved continuation belongs to an older cutoff. Even its final page cannot prove that
        // newer replies are absent. Such declines get Office review, never an automatic closure.
        // Inbound is processed first, so outbound and pending retries receive the same proven window.
        const win: ClosureWindow = completeWhenFresh && !savedNext && !next ? { ...window, inboxCompleteThrough: completeWhenFresh } : window;
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
      await resumePending(mailbox, counts, { inboxCompleteThrough: null });
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

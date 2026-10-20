// Outlook correspondence sync (read-only on the mailbox — it never sends). Pulls Inbox + Sent Items through the
// Microsoft Outlook connector, stores each homeowner email once on its job (job_communications, provider=outlook),
// queues ambiguous ones for Office, and closes early-stage records only on an explicit "not proceeding" email.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkedOutlookHealth, normaliseMailbox, outlookGatewayUrl, outlookMailboxPath, uncheckedOutlookHealth, type OutlookHealth } from "./outlook-connection.core";
import {
  classifyIntent, closureDecision, counterpartEmails, extractJobNumbers, isPortalDuplicate, matchMessage, normaliseMessage,
  type AttachmentRef, type CandidateJob, type GraphMessage, type MailMessage, type MatchResult,
} from "./outlook-correspondence.core";

// New migration types are local until the database-generated types are refreshed on integration.
const syncAdmin = admin as SupabaseClient;
type Work = { provider_message_id: string; mailbox: string; message: MailMessage; route: Exclude<MatchResult, { kind: "not_homeowner" }>; attachments_complete: boolean; attachment_refs: AttachmentRef[]; status: "pending" | "complete" };
type SyncState = { id: number; expected_mailbox: string | null; mailbox: string | null; backfill_from: string; inbox_cursor: string | null; sent_cursor: string | null; inbox_next_link: string | null; sent_next_link: string | null; updated_at: string; last_run_at: string | null; last_ok_at: string | null; last_error: string | null; last_counts: Record<string, number> };
type WorkResult = { stored?: boolean; unmatched?: boolean; closed?: boolean; flagged?: boolean; duplicate?: boolean; ignored?: boolean; replayed?: boolean };
type ClosureWindow = { inboxCompleteThrough: string | null };
const OUR_DOMAINS = ["homeinsulationvictoria.com.au"];
const SELECT = "id,conversationId,internetMessageId,subject,body,bodyPreview,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,hasAttachments,isDraft";

export type SyncCounts = { fetched: number; stored: number; duplicate: number; portalDuplicate: number; notHomeowner: number; unmatched: number; closed: number; flagged: number; errors: number };

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

async function loadCandidates(msgs: MailMessage[], mailbox: string) {
  const numbers = [...new Set(msgs.flatMap((m) => extractJobNumbers(`${m.subject ?? ""}\n${m.body}`)))];
  const emails = [...new Set(msgs.flatMap((m) => counterpartEmails(m, mailbox, OUR_DOMAINS)))];
  const sel = "id, job_number, stage, deleted_at, owners!inner(email), properties(address_line, postcode)";
  const toCand = (j: Record<string, unknown>): CandidateJob => {
    const o = j["owners"] as { email: string | null } | null, p = j["properties"] as { address_line: string | null; postcode: string | null } | null;
    return { id: String(j["id"]), jobNumber: String(j["job_number"]), ownerEmail: o?.email?.toLowerCase() ?? null, addressLine: p?.address_line ?? null, postcode: p?.postcode ?? null };
  };
  const byNumber = new Map<string, CandidateJob>(), byEmail = new Map<string, CandidateJob[]>();
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
  return { byNumber, byEmail };
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
  if (work.route.kind !== "job" || m.direction !== "inbound") return { action: "none" };
  const intent = classifyIntent(m.body);
  if (intent.kind === "none") return { action: "none" };
  const { data: job, error: je } = await syncAdmin.from("jobs").select("stage").eq("id", work.route.jobId).single();
  if (je || !job) throw new Error(`Job state unavailable for Outlook decision: ${je?.message ?? "job missing"}`);
  const [history, pending] = await Promise.all([
    syncAdmin.from("job_communications").select("id", { count: "exact", head: true })
      .eq("job_id", work.route.jobId).eq("direction", "inbound").gt("received_at", m.at),
    syncAdmin.from("outlook_message_work").select("provider_message_id", { count: "exact", head: true })
      .eq("job_id", work.route.jobId).eq("message->>direction", "inbound").gt("message_at", m.at),
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
      const { data, error } = await syncAdmin.from("outlook_message_work")
        .update({ attachments_complete: true, attachment_refs: refs, last_error: null })
        .eq("provider_message_id", work.provider_message_id).eq("status", "pending")
        .eq("attachments_complete", false).select("provider_message_id");
      if (error) throw new Error(`Attachment metadata was not saved: ${error.message}`);
      if (!data?.length) {
        const { data: current, error: ce } = await syncAdmin.from("outlook_message_work").select("*").eq("provider_message_id", work.provider_message_id).single();
        if (ce || !current) throw new Error(`Outlook work unavailable: ${ce?.message ?? "row missing"}`);
        if (current.status === "complete") { counts.duplicate++; return; }
        if (!current.attachments_complete) throw new Error("Attachment metadata remains pending.");
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
  const { byNumber, byEmail } = await loadCandidates(msgs, mailbox);
  const work: Work[] = [];
  // Reserve the entire page before decisions, so a later reply on this page is visible to earlier declines.
  for (const m of msgs) {
    const route = matchMessage(m, counterpartEmails(m, mailbox, OUR_DOMAINS), byNumber, byEmail);
    if (route.kind === "not_homeowner") { counts.notHomeowner++; continue; }
    const { data: existing, error: ee } = await syncAdmin.from("outlook_message_work").select("*")
      .eq("provider_message_id", m.providerMessageId).maybeSingle();
    if (ee) throw new Error(`Outlook processing history unavailable: ${ee.message}`);
    if (existing) {
      if (existing.mailbox !== mailbox) throw new Error("Outlook message belongs to a different mailbox.");
      if (existing.status === "pending") work.push(existing as Work); else counts.duplicate++;
      continue;
    }
    if (route.kind === "job" && await portalDuplicate(m, route.jobId)) { counts.portalDuplicate++; continue; }
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
  const counts: SyncCounts = { fetched: 0, stored: 0, duplicate: 0, portalDuplicate: 0, notHomeowner: 0, unmatched: 0, closed: 0, flagged: 0, errors: 0 };
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
    let inboxCompleteThrough: string | null = null;
    for (const [folder, field, key, continuation] of [
      ["inbox", "receivedDateTime", "inbox_cursor", "inbox_next_link"],
      ["sentitems", "sentDateTime", "sent_cursor", "sent_next_link"],
    ] as const) {
      const since = state[key] ?? state.backfill_from;
      if (!Number.isFinite(Date.parse(since))) throw new Error("Outlook has an invalid saved timestamp; Office must review the cursor.");
      let url: string | null = state[continuation] ? outlookGatewayUrl(state[continuation])
        : `${outlookMailboxPath(mailbox)}/mailFolders/${folder}/messages?$select=${SELECT}&$filter=${field} ge ${new Date(since).toISOString()} and ${field} le ${now}&$orderby=${field} asc&$top=${pageSize}`;
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
        // Inbox is processed first, so Sent Items and pending retries receive the same proven window.
        if (folder === "inbox" && !state.inbox_next_link && !next) inboxCompleteThrough = now;
        counts.fetched += response.value.length;
        await processMessages(response.value, mailbox, counts, { inboxCompleteThrough });
        if (counts.errors) throw new Error(`${counts.errors} message(s) remain unfinished; the cursor was not advanced.`);
        const tail = response.value.at(-1);
        const tailAt = tail ? (field === "receivedDateTime" ? tail.receivedDateTime : tail.sentDateTime) : null;
        if (tailAt) {
          if (!Number.isFinite(Date.parse(tailAt))) throw new Error("Outlook returned an invalid page timestamp.");
          if (Date.parse(tailAt) > Date.parse(last)) last = tailAt;
        }
        url = next;
      }
      cursors[key] = last;
      cursors[continuation] = url;
    }
    await resumePending(mailbox, counts, { inboxCompleteThrough });
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

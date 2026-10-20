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

async function applyClosure(jobId: string, m: MailMessage, commId: string, counts: SyncCounts) {
  const intent = classifyIntent(m.body);
  if (intent.kind === "none") return;
  const { data: job } = await admin.from("jobs").select("stage").eq("id", jobId).single();
  if (!job) return;
  const { count } = await admin.from("job_communications").select("id", { count: "exact", head: true })
    .eq("job_id", jobId).eq("direction", "inbound").gt("received_at", m.at);
  const d = closureDecision(job.stage, intent, { laterInbound: (count ?? 0) > 0 });
  if (d.action === "flag") { await queueReview(m, d.kind, d.reason, { jobId, commId, suggested: intent.kind === "not_proceeding" ? d.reason : undefined }); counts.flagged++; return; }
  if (d.action !== "close") return;
  const { data: moved, error } = await admin.from("jobs").update({ stage: "cancelled", prior_stage: job.stage, cancelled_reason: d.reason, next_action: "Closed — customer not proceeding (from their email)" })
    .eq("id", jobId).eq("stage", job.stage).select("id");
  if (error) throw new Error(error.message);
  if (!moved?.length) return;
  await logEvent(jobId, null, "stage_changed", `Closed: ${d.reason}`, { source: "outlook_sync", communication_id: commId, phrase: intent.kind === "not_proceeding" ? intent.phrase : null }, { from: job.stage as never, to: "cancelled" });
  counts.closed++;
}

export async function processMessages(raw: GraphMessage[], mailbox: string, counts: SyncCounts, fetchAttachments = true) {
  const msgs = raw.map((g) => normaliseMessage(g, mailbox, OUR_DOMAINS)).filter((m): m is MailMessage => !!m);
  if (!msgs.length) return;
  const { byNumber, byEmail } = await loadCandidates(msgs, mailbox);
  msgs.sort((a, b) => a.at.localeCompare(b.at));
  for (const m of msgs) {
    try {
      const r = matchMessage(m, counterpartEmails(m, mailbox, OUR_DOMAINS), byNumber, byEmail);
      if (r.kind === "not_homeowner") { counts.notHomeowner++; continue; }
      const { data: seen } = await admin.from("job_communications").select("id").eq("provider", "outlook").eq("provider_message_id", m.providerMessageId).maybeSingle();
      if (seen) { counts.duplicate++; continue; }
      if (fetchAttachments && m.hasAttachments) m.attachments = await attachmentsFor(m.providerMessageId).catch(() => []);
      if (r.kind === "unmatched") { await queueReview(m, "unmatched", r.reason, { candidates: r.candidateJobIds }); counts.unmatched++; continue; }
      if (m.direction === "outbound") {
        const { data: ex } = await admin.from("job_communications").select("provider, subject, recipients, sent_at, direction").eq("job_id", r.jobId).eq("direction", "outbound").neq("provider", "outlook");
        if (isPortalDuplicate(m, (ex ?? []).map((c) => ({ provider: c.provider, subject: c.subject, recipients: (c.recipients as string[]) ?? [], at: c.sent_at, direction: c.direction })))) { counts.portalDuplicate++; continue; }
      }
      const id = await storeOnJob(r.jobId, m, r.how);
      if (!id) { counts.duplicate++; continue; }
      counts.stored++;
      if (m.direction === "inbound") await applyClosure(r.jobId, m, id, counts);
    } catch (e) {
      counts.errors++;
      console.error("outlook message failed", (e as Error).message);
    }
  }
}

/** One bounded sync pass. Backfills from outlook_sync_state.backfill_from, then continues from each folder's cursor. */
export async function runOutlookSync(opts: { maxPages?: number } = {}): Promise<{ ok: boolean; blocker?: string; counts: SyncCounts }> {
  const counts: SyncCounts = { fetched: 0, stored: 0, duplicate: 0, portalDuplicate: 0, notHomeowner: 0, unmatched: 0, closed: 0, flagged: 0, errors: 0 };
  const now = new Date().toISOString();
  if (!outlookConfigured()) {
    await admin.from("outlook_sync_state").update({ last_run_at: now, last_error: "Outlook is not connected to this project", updated_at: now }).eq("id", 1);
    return { ok: false, blocker: "not_connected", counts };
  }
  const { data: st } = await admin.from("outlook_sync_state").select("*").eq("id", 1).single();
  try {
    const me = await graph<{ mail?: string; userPrincipalName?: string }>("/me?$select=mail,userPrincipalName");
    const mailbox = (me.mail ?? me.userPrincipalName ?? "").toLowerCase();
    const cursors: Record<string, string> = {};
    for (const [folder, field, key] of [["inbox", "receivedDateTime", "inbox_cursor"], ["sentitems", "sentDateTime", "sent_cursor"]] as const) {
      const since = (st?.[key] as string | null) ?? st?.backfill_from ?? "2026-10-01T00:00:00+11:00";
      let url: string | null = `/me/mailFolders/${folder}/messages?$select=${SELECT}&$filter=${field} ge ${new Date(since).toISOString()}&$orderby=${field} asc&$top=50`;
      let last = since;
      for (let page = 0; url && page < (opts.maxPages ?? 10); page++) {
        const res: { value: GraphMessage[]; "@odata.nextLink"?: string } = await graph(url);
        counts.fetched += res.value.length;
        await processMessages(res.value, mailbox, counts);
        const tail = res.value.at(-1);
        if (tail) last = (field === "receivedDateTime" ? tail.receivedDateTime : tail.sentDateTime) ?? last;
        url = res["@odata.nextLink"] ?? null;
      }
      cursors[key] = last;
    }
    const ok = counts.errors === 0;
    // Cursors move only after a clean pass, so a failed message is re-read next time (dedupe makes that safe).
    await admin.from("outlook_sync_state").update({ ...(ok ? cursors : {}), mailbox, last_run_at: now, ...(ok ? { last_ok_at: now, last_error: null } : { last_error: `${counts.errors} message(s) failed` }), last_counts: counts, updated_at: now }).eq("id", 1);
    return { ok, counts };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await admin.from("outlook_sync_state").update({ last_run_at: now, last_error: msg, last_counts: counts, updated_at: now }).eq("id", 1);
    return { ok: false, blocker: msg, counts };
  }
}

// ESC collection notice (decision 130) — WRITE + SEND side. Kept apart from esc-collection-notice.server.ts so that no
// module on the autoAdvanceJob graph can reach a sender (tests/comms.test.ts). Writes: one acknowledgement event by the
// person themself (secure link or own sign-in), link-issued events (token SHA-256 only) and link-sent events. Every send
// goes through the existing guarded senders: TEST partners → test-send.server; real partners → sendRealSms (type
// `esc_notice_link`, decision 146 wording, gated by customer_comms_enabled + its switch) / sendOfficeEmail behind
// COLLECTION_NOTICE_SEND_APPROVED (on since decision 154; the office email master switch still applies).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { hashToken, newToken } from "./worker-links.core";
import { isTestPartner } from "./test-send.core";
import {
  COLLECTION_NOTICE_EMAIL_APPROVED, COLLECTION_NOTICE_EVENT, COLLECTION_NOTICE_LINK_EVENT, COLLECTION_NOTICE_SEND_APPROVED, COLLECTION_NOTICE_SEND_EVENT, COLLECTION_NOTICE_SMS_TYPE,
  collectionNoticeEmail, noticeAckSubmissionErrors, noticeEmailKey, noticeEventDetails, noticeLinkDetails, noticeLinkEmail, noticeLinkSmsBody, noticeLinkState, noticeLinkUrl, noticeSendPlan,
  type NoticeStatus,
} from "./esc-collection-notice.core";
import { NOTICE_WORKER_COLS, businessNoticeStatuses, findNoticeLink, loadNoticeWorkers, noticeAckMap, noticeSendHistory, selfNoticeWorker, type NoticeWorkerRow } from "./esc-collection-notice.server";

/** The signed-in trade's view: their business's installers (boss) or their own row, plus which row is theirs to acknowledge.
 *  Lives here (not in the read module) because trade-view.server pulls Mitti/sender modules into the import graph. */
export async function tradeNoticeView(userId: string) {
  const { tradeContext } = await import("./trade-view.server");
  const c = await tradeContext(userId);
  if (!c) throw new WorkflowError("Your sign-in isn't linked to an approved business yet.");
  const workers = await loadNoticeWorkers([c.biz.id]);
  const statuses = await businessNoticeStatuses(c.biz.id, workers);
  const me = selfNoticeWorker(workers, userId, c.profile?.email);
  return { kind: c.kind, boss: c.boss, isTest: c.isTest, selfWorkerId: me?.id ?? null, statuses: c.boss ? statuses : statuses.filter((s) => s.workerId === me?.id) };
}

/** The installer person acknowledges the current notice for themself from My business (append-only event). Never for someone else. */
export async function tradeAcknowledgeNotice(userId: string, now = new Date()) {
  const { tradeContext } = await import("./trade-view.server");
  const c = await tradeContext(userId);
  if (!c) throw new WorkflowError("Your sign-in isn't linked to an approved business yet.");
  const me = selfNoticeWorker(await loadNoticeWorkers([c.biz.id]), userId, c.profile?.email);
  if (!me) throw new WorkflowError("Only a listed installer can acknowledge the notice for themself. Ask the office if you install and aren't listed.");
  return recordAcknowledgement({ worker: me, actorId: userId, source: "my_business", now });
}

/** Public: the one tick + typed name on the person's secure link. Recorded with time, IP and user agent against the current notice sha. */
export async function noticeLinkAcknowledge(p: { token: string; ticked: boolean; typedName: string; ip: string | null; userAgent: string | null }, now = new Date()) {
  const l = await findNoticeLink(p.token);
  if (!l) throw new WorkflowError("This link isn't valid any more. Ask your business owner or the office to send a new one.");
  const [status] = (await businessNoticeStatuses(l.worker.business_id, [l.worker])) as [NoticeStatus | undefined];
  if (status?.state === "acknowledged") return { ok: true, at: status.at!, email: { status: "blocked" as const, detail: "Already acknowledged." } };
  if (noticeLinkState(l.details, false, now) === "expired") throw new WorkflowError("This link has expired. Ask your business owner or the office to send a new one.");
  const errors = noticeAckSubmissionErrors({ ticked: p.ticked, typedName: p.typedName, listedName: l.worker.full_legal_name });
  if (errors.length) throw new WorkflowError(errors.join(" "));
  return recordAcknowledgement({ worker: l.worker, actorId: null, source: "secure_link", ip: p.ip, userAgent: p.userAgent, linkId: l.id, typedName: p.typedName, now });
}

async function recordAcknowledgement(p: { worker: NoticeWorkerRow; actorId: string | null; source: "my_business" | "secure_link"; ip?: string | null; userAgent?: string | null; linkId?: string | null; typedName?: string | null; now?: Date }) {
  const ev = noticeEventDetails({ businessId: p.worker.business_id, workerId: p.worker.id, workerEmail: p.worker.email, byName: (p.typedName?.trim() || p.worker.full_legal_name), source: p.source, ip: p.ip ?? null, userAgent: p.userAgent ?? null, linkId: p.linkId ?? null, now: p.now ?? new Date() });
  const { error } = await admin.from("admin_config_events").insert({ actor_id: p.actorId, event_type: COLLECTION_NOTICE_EVENT, summary: ev.summary, details: ev.details });
  if (error) throw new WorkflowError("Could not record the acknowledgement. Please try again.");
  const { data: b } = await admin.from("businesses").select("onboarding_notes").eq("id", p.worker.business_id).maybeSingle();
  const email = await sendNoticeCopy({ actorId: p.actorId, businessId: p.worker.business_id, partnerIsTest: isTestPartner(b), to: p.worker.email, name: p.worker.full_legal_name, acknowledgedAt: ev.details.at }).catch((e: Error) => ({ status: "failed" as const, detail: e.message }));
  return { ok: true, at: ev.details.at, email };
}

/**
 * Issue a fresh link for one installer person and send it by text + email (attempt number from the send history).
 * `actorId` null = the scheduled sweep. Business owner / office use this for a manual re-send too (`manual`: the text gets its
 * own one-off idempotency key, so a key consumed by an earlier held attempt can never turn a re-send into "already" — decision 154).
 */
export async function issueAndSendNoticeLink(p: { worker: NoticeWorkerRow; actorId: string | null; attempt: 1 | 2 | 3; reminder: boolean; manual?: boolean; now?: Date }) {
  const now = p.now ?? new Date();
  const { data: b } = await admin.from("businesses").select("name, trading_name, onboarding_notes").eq("id", p.worker.business_id).maybeSingle();
  const test = isTestPartner(b);
  const token = newToken();
  const link = noticeLinkDetails({ businessId: p.worker.business_id, workerId: p.worker.id, workerEmail: p.worker.email, tokenHash: await hashToken(token), now });
  const { error } = await admin.from("admin_config_events").insert({ actor_id: p.actorId, event_type: COLLECTION_NOTICE_LINK_EVENT, summary: `ESC notice link issued to ${p.worker.full_legal_name} (attempt ${p.attempt})`, details: link });
  if (error) throw new WorkflowError("Could not issue the link.");
  const base = test ? (await import("./test-send.server")).TEST_APP_BASE : (await import("./engagement.core")).CUSTOMER_BASE;
  const url = noticeLinkUrl(base, token);
  const first = p.worker.full_legal_name.trim().split(/\s+/)[0] ?? null;
  const mail = noticeLinkEmail({ firstName: first, businessName: b?.trading_name ?? b?.name ?? "your business", url, reminder: p.reminder });
  const { partnerEmailLayout } = await import("./partner-email.core");
  const rendered = partnerEmailLayout({ subject: mail.subject, heading: mail.heading, blocks: mail.blocks, test });
  let sms: { status: string; detail: string }, email: { status: string; detail: string };
  if (test) {
    const { sendTestSms, sendTestEmail } = await import("./test-send.server");
    const ctx = { jobId: null, jobSource: null, partnerIsTest: true, label: `esc_notice_link:${p.attempt}`, actorId: p.actorId };
    sms = p.worker.mobile ? await sendTestSms(ctx, p.worker.mobile, noticeLinkSmsBody(first, url)) : { status: "blocked", detail: "No mobile on the worker record." };
    email = await sendTestEmail(ctx, p.worker.email, mail.subject, rendered.html, rendered.text);
  } else {
    const { sendRealSms } = await import("./sms.server");
    // Decision 165 (`window` type): attempts 1/2/3 are planned from the recorded send history (held ones included), so a
    // switch flip never re-fires an old attempt; held attempts no longer claim the key, and the manual re-send keeps its own key.
    const key = p.manual ? `esc-notice-link:v1:${p.worker.id}:manual:${link.token_hash.slice(0, 16)}` : `esc-notice-link:v1:${p.worker.id}:${p.attempt}`;
    const r = await sendRealSms({ type: COLLECTION_NOTICE_SMS_TYPE, idempotencyKey: key, to: p.worker.mobile, body: noticeLinkSmsBody(first, url), businessId: p.worker.business_id });
    sms = { status: r.status, detail: r.detail };
    if (!COLLECTION_NOTICE_SEND_APPROVED) email = { status: "blocked", detail: "Email wording waiting for Jo's approval (COLLECTION_NOTICE_SEND_APPROVED)." };
    else {
      const r2 = await (await import("./office-email.server")).sendOfficeEmail({ actorId: p.actorId ?? "", recipient: "partner", to: p.worker.email, contactName: p.worker.full_legal_name, subject: mail.subject, message: rendered.text, label: "esc_notice_link", record: { businessId: p.worker.business_id }, html: rendered.html, text: rendered.text });
      email = { status: r2.status, detail: r2.detail };
    }
  }
  await admin.from("admin_config_events").insert({ actor_id: p.actorId, event_type: COLLECTION_NOTICE_SEND_EVENT, summary: `ESC notice link to ${p.worker.full_legal_name}: text ${sms.status}, email ${email.status} (attempt ${p.attempt}${p.reminder ? ", reminder" : ""})`,
    details: { business_id: p.worker.business_id, worker_id: p.worker.id, worker_email: noticeEmailKey(p.worker.email), attempt: p.attempt, reminder: p.reminder, manual: p.manual === true, at: now.toISOString(), sms, email, is_test: test } });
  return { sms, email, attempt: p.attempt };
}

/** Business owner (own business) or office: send / re-send one person's link now. Counted as the next attempt that actually
 *  LEFT (held attempts — every channel blocked — don't count, decision 154); the text uses a one-off key, so it always goes
 *  when the guards allow it. */
export async function sendNoticeLinkFor(actorId: string, workerId: string, isAdmin: boolean) {
  const { data: w, error } = await admin.from("partner_workers").select(NOTICE_WORKER_COLS).eq("id", workerId).maybeSingle();
  if (error || !w || (w as NoticeWorkerRow).removed_at || (w as NoticeWorkerRow).trade_role !== "installer") throw new WorkflowError("That installer wasn't found.");
  const worker = w as NoticeWorkerRow;
  if (!isAdmin) { const { requireMember } = await import("./pilot.server"); await requireMember(actorId, worker.business_id, true); }
  const [status] = await businessNoticeStatuses(worker.business_id, [worker]);
  if (status?.state === "acknowledged") throw new WorkflowError(`${worker.full_legal_name} has already acknowledged the notice.`);
  const history = await noticeSendHistory([worker.id]);
  const delivered = (history.get(worker.id) ?? []).filter((h) => !h.held).length;
  const n = Math.min(3, delivered + 1) as 1 | 2 | 3;
  return issueAndSendNoticeLink({ worker, actorId, attempt: n, reminder: n > 1, manual: true });
}

/**
 * 15-minute tick (allocation-tick): every approved installer business's installer who has not acknowledged gets the
 * first link straight away, then reminders at 3 and 7 days (`noticeSendPlan`). Attempts are recorded even when the
 * senders hold them (unapproved wording), so a real partner is never texted three times the moment a flag turns on;
 * the owner/office "Send notice link" button covers those people. Counts only — never PII.
 */
export async function sweepCollectionNoticeLinks(now = new Date()) {
  const { data: bizs, error } = await admin.from("businesses").select("id").eq("onboarding_status", "approved").eq("is_active", true).or("business_type.eq.eec_installer,capabilities.cs.{installer}");
  if (error) throw new WorkflowError("Could not read partner businesses.");
  const ids = (bizs ?? []).map((b) => b.id);
  if (!ids.length) return { checked: 0, pending: 0, sent: 0, failed: 0 };
  const workers = await loadNoticeWorkers(ids);
  const ack = await noticeAckMap(workers);
  const pending = workers.filter((w) => ack.get(w.id) === false);
  const history = await noticeSendHistory(pending.map((w) => w.id));
  let sent = 0, failed = 0;
  for (const w of pending) {
    const plan = noticeSendPlan(history.get(w.id) ?? [], now);
    if (!plan) continue;
    try { await issueAndSendNoticeLink({ worker: w, actorId: null, attempt: plan.attempt, reminder: plan.reminder, now }); sent++; }
    catch (e) { failed++; console.error("esc notice link send failed", (e as Error).message); }
  }
  return { checked: workers.length, pending: pending.length, sent, failed };
}

/** Emailed copy of the notice on acknowledgement. Off until Jo approves; TEST partners go through the test sender (allowlist decides). */
export async function sendNoticeCopy(p: { actorId: string | null; businessId: string; partnerIsTest: boolean; to: string; name: string | null; acknowledgedAt: string }): Promise<{ status: "sent" | "blocked" | "failed"; detail: string }> {
  const { partnerEmailLayout } = await import("./partner-email.core");
  const copy = collectionNoticeEmail({ firstName: p.name?.trim().split(/\s+/)[0] ?? null, acknowledgedAt: p.acknowledgedAt });
  const mail = partnerEmailLayout({ subject: copy.subject, heading: copy.heading, blocks: copy.blocks, test: p.partnerIsTest });
  if (p.partnerIsTest) {
    const { sendTestEmail } = await import("./test-send.server");
    const r = await sendTestEmail({ jobId: null, jobSource: null, partnerIsTest: true, label: "esc_collection_notice_copy", actorId: p.actorId }, p.to, copy.subject, mail.html, mail.text);
    return { status: r.status, detail: r.detail };
  }
  if (!COLLECTION_NOTICE_EMAIL_APPROVED) {
    await admin.from("admin_config_events").insert({ actor_id: p.actorId, event_type: "esc_collection_notice_copy", summary: `ESC notice copy to ${noticeEmailKey(p.to)}: blocked (not approved)`, details: { business_id: p.businessId, to: noticeEmailKey(p.to), status: "blocked", detail: "COLLECTION_NOTICE_EMAIL_APPROVED is off" } });
    return { status: "blocked", detail: "Emailing the notice copy is not switched on yet." };
  }
  const { sendOfficeEmail } = await import("./office-email.server");
  const r = await sendOfficeEmail({ actorId: p.actorId ?? "", recipient: "partner", to: p.to, contactName: p.name, subject: copy.subject, message: mail.text, label: "esc_collection_notice_copy", record: { businessId: p.businessId }, html: mail.html, text: mail.text });
  return { status: r.status, detail: r.detail };
}

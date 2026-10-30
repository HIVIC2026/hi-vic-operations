// ESC collection notice records for approved partner businesses (decision 130) — READ side only. Reads both record
// sources (signed onboarding data and business-scoped append-only admin_config_events) and resolves a person's secure
// link. It imports no sender, so the offer / crew / pre-start readers on the autoAdvanceJob graph may use it.
// Every write and every send lives in esc-collection-notice-send.server.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { hashToken, isTokenShape } from "./worker-links.core";
import {
  COLLECTION_NOTICE_EVENT, COLLECTION_NOTICE_LINK_EVENT, COLLECTION_NOTICE_SEND_EVENT, ackFromEventDetails, acksFromApplicationData, collectionNoticeStatus, noticeAckByWorkerId, noticeAttemptHeld,
  noticeEmailKey, noticeLinkState, type NoticeAck, type NoticeStatus, type NoticeWorker,
} from "./esc-collection-notice.core";

export type NoticeWorkerRow = { id: string; business_id: string; email: string | null; full_legal_name: string; trade_role: string; removed_at: string | null; mobile?: string | null; profile_id?: string | null; worker_role?: string | null };
export const NOTICE_WORKER_COLS = "id, business_id, email, full_legal_name, trade_role, removed_at, mobile, profile_id, worker_role";

/** Every current record for the given businesses: onboarding stamps from their activated application(s) plus later events. */
export async function loadNoticeAcks(businessIds: readonly string[]): Promise<Map<string, NoticeAck[]>> {
  const out = new Map<string, NoticeAck[]>(businessIds.map((b) => [b, []]));
  if (!businessIds.length) return out;
  const [{ data: events, error: e1 }, { data: acts, error: e2 }] = await Promise.all([
    admin.from("admin_config_events").select("details").eq("event_type", COLLECTION_NOTICE_EVENT),
    admin.from("partner_activations").select("application_id, business_id").in("business_id", [...businessIds]),
  ]);
  if (e1 || e2) throw new WorkflowError("Could not read the ESC notice records.");
  const appIds = [...new Set((acts ?? []).map((a) => a.application_id).filter((x): x is string => !!x))];
  const { data: apps, error: e3 } = appIds.length ? await admin.from("rec_onboarding_applications").select("id, data").in("id", appIds) : { data: [], error: null };
  if (e3) throw new WorkflowError("Could not read the ESC notice records.");
  const bizOfApp = new Map((acts ?? []).map((a) => [a.application_id, a.business_id]));
  for (const a of apps ?? []) { const b = bizOfApp.get(a.id); if (b && out.has(b)) out.get(b)!.push(...acksFromApplicationData(a.data)); }
  for (const e of events ?? []) {
    const b = (e.details as { business_id?: string } | null)?.business_id;
    const a = ackFromEventDetails(e.details);
    if (b && a && out.has(b)) out.get(b)!.push(a);
  }
  return out;
}
export const loadBusinessNoticeAcks = async (businessId: string) => (await loadNoticeAcks([businessId])).get(businessId) ?? [];

/**
 * Per installer worker of the business (not removed). Stable entry point for office screens, the offer/crew paths and the
 * VEEC assignment AP prerequisite build (pass the result to `collectionNoticeBlockers`).
 */
export async function businessNoticeStatuses(businessId: string, workers?: readonly NoticeWorker[]): Promise<NoticeStatus[]> {
  const list = workers ?? (await loadNoticeWorkers([businessId]));
  return collectionNoticeStatus(list, await loadBusinessNoticeAcks(businessId));
}

/** worker id → acknowledged?, across businesses, for offer filtering and crew rosters. */
export async function noticeAckMap(workers: readonly (NoticeWorker & { id: string; business_id: string })[], preloaded?: Map<string, NoticeAck[]>): Promise<Map<string, boolean>> {
  const ids = [...new Set(workers.map((w) => w.business_id))];
  // `preloaded`: the same records already read for these businesses (speed: read alongside the workers); else read here.
  const acks = preloaded && ids.every((b) => preloaded.has(b)) ? preloaded : await loadNoticeAcks(ids);
  const out = new Map<string, boolean>();
  for (const b of ids) for (const [id, ok] of noticeAckByWorkerId(collectionNoticeStatus(workers.filter((w) => w.business_id === b), acks.get(b) ?? []))) out.set(id, ok);
  return out;
}

export async function loadNoticeWorkers(businessIds: readonly string[]): Promise<NoticeWorkerRow[]> {
  const { data, error } = await admin.from("partner_workers").select(NOTICE_WORKER_COLS).in("business_id", [...businessIds]).eq("trade_role", "installer").is("removed_at", null);
  if (error) throw new WorkflowError("Could not read the business's installers.");
  return (data ?? []) as NoticeWorkerRow[];
}

/** The caller's own installer row: linked profile first, else the row whose email is the caller's sign-in email. */
export function selfNoticeWorker(workers: NoticeWorkerRow[], userId: string, profileEmail: string | null | undefined): NoticeWorkerRow | null {
  return workers.find((w) => w.profile_id === userId) ?? (profileEmail ? workers.find((w) => noticeEmailKey(w.email) === noticeEmailKey(profileEmail)) ?? null : null);
}

/** Resolve a secure-link token (SHA-256 lookup) to its worker; null when unknown, revoked by removal, or malformed. */
export async function findNoticeLink(token: string) {
  if (!isTokenShape(token)) return null;
  const { data, error } = await admin.from("admin_config_events").select("id, details, created_at").eq("event_type", COLLECTION_NOTICE_LINK_EVENT).contains("details", { token_hash: await hashToken(token) }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new WorkflowError("Could not open this link.");
  if (!data) return null;
  const d = data.details as { business_id: string; worker_id: string; worker_email: string; expires_at: string };
  const { data: w } = await admin.from("partner_workers").select(NOTICE_WORKER_COLS).eq("id", d.worker_id).maybeSingle();
  if (!w || (w as NoticeWorkerRow).removed_at) return null;
  return { id: data.id, details: d, worker: w as NoticeWorkerRow };
}

/** Public: the person's page. Name, business and state only — never other workers or business facts. */
export async function noticeLinkPage(token: string, now = new Date()) {
  const l = await findNoticeLink(token);
  if (!l) throw new WorkflowError("This link isn't valid any more. Ask your business owner or the office to send a new one.");
  const [status] = (await businessNoticeStatuses(l.worker.business_id, [l.worker])) as [NoticeStatus | undefined];
  const { data: b } = await admin.from("businesses").select("name, trading_name").eq("id", l.worker.business_id).maybeSingle();
  const state = noticeLinkState(l.details, status?.state === "acknowledged", now);
  return { name: l.worker.full_legal_name, business: b?.trading_name ?? b?.name ?? "", state, acknowledgedAt: status?.at ?? null };
}

/** Send history per worker (attempt numbers and times), for the reminder plan and the manual re-send button. */
/** Send attempts per worker. `held` = neither the text nor the email left (every sender blocked/failed/"already"), so the
 *  person never got that attempt (decision 154: held attempts don't count towards the three for a manual re-send). */
export async function noticeSendHistory(workerIds: readonly string[]): Promise<Map<string, { attempt: number; at: string; held: boolean }[]>> {
  const out = new Map<string, { attempt: number; at: string; held: boolean }[]>();
  if (!workerIds.length) return out;
  const { data, error } = await admin.from("admin_config_events").select("details").eq("event_type", COLLECTION_NOTICE_SEND_EVENT);
  if (error) throw new WorkflowError("Could not read the ESC notice send history.");
  const want = new Set(workerIds);
  for (const e of data ?? []) {
    const d = e.details as { worker_id?: string; attempt?: number; at?: string; sms?: { status?: string }; email?: { status?: string } } | null;
    if (!d?.worker_id || !want.has(d.worker_id) || typeof d.attempt !== "number" || !d.at) continue;
    if (!out.has(d.worker_id)) out.set(d.worker_id, []);
    out.get(d.worker_id)!.push({ attempt: d.attempt, at: d.at, held: noticeAttemptHeld(d) });
  }
  return out;
}

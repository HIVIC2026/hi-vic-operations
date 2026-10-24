// O7 Communications reads + "Cancel these / Cancel all held" (decisions 16, 159, 165, 248). Server-only; callers are
// admin-checked server functions. Nothing here sends or retries. TEST (qa_test) and deleted jobs are left out.
// Held texts are RECORDS of blocked attempts (decision 165: they never send on their own), so cancelling one is recorded
// as an office decision (append-only admin_config_events) and hides it; a queued follow-up email is stopped for real
// (customer_followups → suppressed, reason office_cancelled).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { SMS_MESSAGE_TYPES, claimKeyOf, isHeldAttemptKey, type SmsMessageType } from "./sms.core";
import { failureReason, groupHeld, heldReason, outlookState, splitHeldKeys, type HeldItem } from "./office-comms.core";

const db = admin as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const chunks = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const DAY = 86_400_000;
export const HELD_CANCELLED_EVENT = "held_messages_cancelled";
const FOLLOWUP_LABEL: Record<string, string> = { estimate_unopened_3d: "Your estimate — still interested?" };

async function jobFacts(ids: string[]) {
  const out = new Map<string, { number: string; owner: string | null; live: boolean }>();
  for (const part of chunks([...new Set(ids)])) {
    const { data } = await db.from("jobs").select("id, job_number, source, deleted_at, owners(full_name)").in("id", part);
    for (const j of (data ?? []) as { id: string; job_number: string; source: string | null; deleted_at: string | null; owners: { full_name: string | null } | null }[])
      out.set(j.id, { number: j.job_number, owner: j.owners?.full_name ?? null, live: j.source !== "qa_test" && !j.deleted_at });
  }
  return out;
}
async function businessNames(ids: string[]) {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data } = await db.from("businesses").select("id, name, trading_name").in("id", [...new Set(ids)]);
  for (const b of (data ?? []) as { id: string; name: string; trading_name: string | null }[]) out.set(b.id, b.trading_name || b.name);
  return out;
}
async function cancelledKeys(): Promise<Set<string>> {
  const { data, error } = await db.from("admin_config_events").select("details").eq("event_type", HELD_CANCELLED_EVENT).order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(`Could not read cancelled held messages: ${error.message}`);
  const out = new Set<string>();
  for (const e of (data ?? []) as { details: { keys?: string[] } | null }[]) for (const k of e.details?.keys ?? []) out.add(k);
  return out;
}

/** Held & queued, grouped by message type. Window: the last 30 days of held attempts; queued follow-ups not yet due. */
export async function heldAndQueued(now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY).toISOString();
  const [sms, fu, jc, cancelled] = await Promise.all([
    db.from("sms_messages").select("id, message_type, idempotency_key, job_id, business_id, to_number, status, detail, created_at").eq("status", "blocked").gte("created_at", since).order("created_at", { ascending: false }).limit(3000),
    db.from("customer_followups").select("id, job_id, kind, status, blocked_reason, due_at").in("status", ["pending", "queued"]).limit(3000),
    db.from("job_communications").select("id, job_id, subject, delivery_status, source_event, source_reference, created_at").eq("direction", "outbound").eq("channel", "email").eq("delivery_status", "blocked_prelaunch").gte("created_at", since).limit(2000),
    cancelledKeys(),
  ]);
  for (const [r, what] of [[sms, "held texts"], [fu, "queued emails"], [jc, "held emails"]] as const) if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  // A held attempt whose key later went for real is history, not "held".
  const heldRows = ((sms.data ?? []) as { id: string; message_type: string; idempotency_key: string; job_id: string | null; business_id: string | null; to_number: string; detail: string | null; created_at: string }[]).filter((r) => isHeldAttemptKey(r.idempotency_key));
  const claimKeys = [...new Set(heldRows.map((r) => claimKeyOf(r.idempotency_key)))];
  const went = new Set<string>();
  for (const part of chunks(claimKeys, 200)) { const { data } = await db.from("sms_messages").select("idempotency_key").in("idempotency_key", part); for (const r of (data ?? []) as { idempotency_key: string }[]) went.add(r.idempotency_key); }
  const latest = new Map<string, (typeof heldRows)[number]>();
  for (const r of heldRows) { const k = claimKeyOf(r.idempotency_key); if (!went.has(k) && !latest.has(k)) latest.set(k, r); }
  const smsRows = [...latest.values()];
  const fuRows = ((fu.data ?? []) as { id: string; job_id: string; kind: string; status: string; blocked_reason: string | null; due_at: string }[]);
  const jcRows = ((jc.data ?? []) as { id: string; job_id: string; subject: string | null; source_event: string | null; source_reference: string | null; created_at: string }[]);
  const jobs = await jobFacts([...smsRows.map((r) => r.job_id), ...fuRows.map((r) => r.job_id), ...jcRows.map((r) => r.job_id)].filter((x): x is string => !!x));
  const biz = await businessNames(smsRows.map((r) => r.business_id).filter((x): x is string => !!x));
  const items: HeldItem[] = [];
  for (const r of smsRows) {
    const key = `sms:${r.id}`;
    if (cancelled.has(key)) continue;
    const j = r.job_id ? jobs.get(r.job_id) : null;
    if (r.job_id && (!j || !j.live)) continue;
    const t = SMS_MESSAGE_TYPES[r.message_type as SmsMessageType];
    items.push({ key, source: "sms", type: r.message_type, label: (t?.label ?? r.message_type).replace(/\s*\(.*$/, "").replace(/ – .*$/, ""), channel: "text", audience: t?.audience === "partner" ? "partner" : "owner", state: "held", reason: heldReason(r.detail, "text"),
      who: j?.owner ?? (r.business_id ? biz.get(r.business_id) ?? "Partner" : r.to_number), jobId: r.job_id, jobNumber: j?.number ?? null, at: r.created_at });
  }
  for (const r of fuRows) {
    const key = `fu:${r.id}`;
    const j = jobs.get(r.job_id);
    if (cancelled.has(key) || !j || !j.live) continue;
    items.push({ key, source: "followup", type: `followup:${r.kind}`, label: FOLLOWUP_LABEL[r.kind] ?? r.kind.replace(/_/g, " "), channel: "email", audience: "owner", state: r.blocked_reason ? "held" : "queued",
      reason: r.blocked_reason ? heldReason(r.blocked_reason, "email") : `sends ${new Date(r.due_at).toLocaleString("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" })}`, who: j.owner ?? "Owner", jobId: r.job_id, jobNumber: j.number, at: r.due_at });
  }
  for (const r of jcRows) {
    const key = `jc:${r.id}`;
    const j = jobs.get(r.job_id);
    if (cancelled.has(key) || !j || !j.live) continue;
    items.push({ key, source: "message", type: `email:${r.source_event ?? r.subject ?? "email"}`, label: r.subject ?? (r.source_event ?? "Email").replace(/[:_]/g, " "), channel: "email", audience: "owner", state: "held", reason: heldReason(r.source_reference, "email"), who: j.owner ?? "Owner", jobId: r.job_id, jobNumber: j.number, at: r.created_at });
  }
  const groups = groupHeld(items);
  return { groups, held: items.filter((i) => i.state === "held").length, queued: items.filter((i) => i.state === "queued").length };
}

/** Cancel held/queued messages by key. Follow-up emails are stopped; held text/email records are hidden (they never send on their own). */
export async function cancelHeld(keys: string[], actorId: string, scope: string) {
  const s = splitHeldKeys(keys);
  if (s.invalid.length) throw new Error(`Unrecognised message keys: ${s.invalid.slice(0, 3).join(", ")}`);
  let stopped = 0;
  for (const part of chunks(s.followups)) {
    const { data, error } = await db.from("customer_followups").update({ status: "suppressed", suppression_reason: "office_cancelled", lease_until: null }).in("id", part).in("status", ["pending", "queued"]).select("id");
    if (error) throw new Error(`Could not cancel queued emails: ${error.message}`);
    stopped += (data ?? []).length;
  }
  const recorded = [...s.sms.map((id) => `sms:${id}`), ...s.messages.map((id) => `jc:${id}`), ...s.followups.map((id) => `fu:${id}`)];
  const { error } = await db.from("admin_config_events").insert({ actor_id: actorId, event_type: HELD_CANCELLED_EVENT, summary: `Office cancelled ${recorded.length} held/queued message${recorded.length === 1 ? "" : "s"} (${scope})`, details: { keys: recorded, scope, followups_stopped: stopped } });
  if (error) throw new Error(`The cancellation could not be recorded: ${error.message}`);
  return { cancelled: recorded.length, followupsStopped: stopped };
}

/** Sent in the last 48 hours: texts, portal emails and Office-recorded emails; state shown only when it hasn't arrived. */
export async function recentlySent(now = new Date()) {
  const since = new Date(now.getTime() - 2 * DAY).toISOString();
  const [sms, mail] = await Promise.all([
    db.from("sms_messages").select("id, message_type, job_id, business_id, to_number, status, created_at, idempotency_key").in("status", ["sent", "delivered", "queued", "sending", "sent_unknown"]).gte("created_at", since).order("created_at", { ascending: false }).limit(300),
    db.from("customer_email_sends").select("id, job_id, purpose, status, sent_at, created_at").in("status", ["sent", "delivered", "delivered_unrecorded"]).gte("created_at", since).order("created_at", { ascending: false }).limit(300),
  ]);
  for (const r of [sms, mail]) if (r.error) throw new Error(`Could not read sent messages: ${r.error.message}`);
  const smsRows = ((sms.data ?? []) as { id: string; message_type: string; job_id: string | null; business_id: string | null; to_number: string; status: string; created_at: string; idempotency_key: string }[]).filter((r) => !isHeldAttemptKey(r.idempotency_key));
  const mailRows = (mail.data ?? []) as { id: string; job_id: string; purpose: string; status: string; sent_at: string | null; created_at: string }[];
  const jobs = await jobFacts([...smsRows.map((r) => r.job_id), ...mailRows.map((r) => r.job_id)].filter((x): x is string => !!x));
  const biz = await businessNames(smsRows.map((r) => r.business_id).filter((x): x is string => !!x));
  const rows = [
    ...smsRows.filter((r) => !r.job_id || jobs.get(r.job_id)?.live).map((r) => ({ id: `sms:${r.id}`, at: r.created_at, to: (r.job_id ? jobs.get(r.job_id)?.owner : null) ?? (r.business_id ? biz.get(r.business_id) : null) ?? r.to_number, message: (SMS_MESSAGE_TYPES[r.message_type as SmsMessageType]?.label ?? r.message_type).replace(/\s*\(.*$/, ""), channel: "text" as const, jobId: r.job_id, jobNumber: r.job_id ? jobs.get(r.job_id)?.number ?? null : null, state: r.status === "delivered" ? null : r.status === "sent_unknown" ? "May have sent — not retried" : "Not delivered yet" })),
    ...mailRows.filter((r) => jobs.get(r.job_id)?.live).map((r) => ({ id: `mail:${r.id}`, at: r.sent_at ?? r.created_at, to: jobs.get(r.job_id)?.owner ?? "Owner", message: r.purpose.replace(/_/g, " "), channel: "email" as const, jobId: r.job_id, jobNumber: jobs.get(r.job_id)?.number ?? null, state: r.status === "delivered_unrecorded" ? "Delivery unconfirmed" : null })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return { rows };
}

/** Could not be delivered (last 30 days). No retry button anywhere: fix the number/address, then send again from the job. */
export async function failedMessages(now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY).toISOString();
  const [sms, mail] = await Promise.all([
    db.from("sms_messages").select("id, message_type, job_id, business_id, to_number, status, detail, created_at").in("status", ["failed", "undelivered"]).gte("created_at", since).order("created_at", { ascending: false }).limit(300),
    db.from("customer_email_sends").select("id, job_id, purpose, status, error, created_at").in("status", ["failed", "bounced"]).gte("created_at", since).order("created_at", { ascending: false }).limit(300),
  ]);
  for (const r of [sms, mail]) if (r.error) throw new Error(`Could not read failed messages: ${r.error.message}`);
  const smsRows = (sms.data ?? []) as { id: string; message_type: string; job_id: string | null; business_id: string | null; to_number: string; detail: string | null; created_at: string }[];
  const mailRows = (mail.data ?? []) as { id: string; job_id: string; purpose: string; error: string | null; created_at: string }[];
  const jobs = await jobFacts([...smsRows.map((r) => r.job_id), ...mailRows.map((r) => r.job_id)].filter((x): x is string => !!x));
  const biz = await businessNames(smsRows.map((r) => r.business_id).filter((x): x is string => !!x));
  const rows = [
    ...smsRows.filter((r) => !r.job_id || jobs.get(r.job_id)?.live).map((r) => ({ id: `sms:${r.id}`, at: r.created_at, to: (r.job_id ? jobs.get(r.job_id)?.owner : null) ?? (r.business_id ? biz.get(r.business_id) : null) ?? r.to_number, message: (SMS_MESSAGE_TYPES[r.message_type as SmsMessageType]?.label ?? r.message_type).replace(/\s*\(.*$/, ""), channel: "text" as const, jobId: r.job_id, jobNumber: r.job_id ? jobs.get(r.job_id)?.number ?? null : null, why: failureReason(r.detail) })),
    ...mailRows.filter((r) => jobs.get(r.job_id)?.live).map((r) => ({ id: `mail:${r.id}`, at: r.created_at, to: jobs.get(r.job_id)?.owner ?? "Owner", message: r.purpose.replace(/_/g, " "), channel: "email" as const, jobId: r.job_id, jobNumber: jobs.get(r.job_id)?.number ?? null, why: failureReason(r.error) })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return { rows };
}

/** Outlook copier (record-only): the latest human mail and whether it was matched to a job. */
export async function outlookMail() {
  const { data, error } = await db.from("outlook_message_work").select("provider_message_id, message, message_at, route, status, record_only").order("message_at", { ascending: false }).limit(60);
  if (error) throw new Error(`Could not read Outlook mail: ${error.message}`);
  const rows = (data ?? []) as { provider_message_id: string; message: { direction?: string; from?: string | null; fromName?: string | null; to?: string[]; subject?: string | null }; message_at: string; route: { kind?: string; jobIds?: string[] } | null; status: string }[];
  const ids = rows.flatMap((r) => (r.route?.kind === "job" ? r.route.jobIds ?? [] : []));
  const jobs = await jobFacts(ids);
  return {
    rows: rows.map((r) => {
      const jid = r.route?.kind === "job" ? r.route.jobIds?.[0] ?? null : null;
      const outbound = r.message?.direction === "outbound";
      return { id: r.provider_message_id, at: r.message_at, from: outbound ? `Office → ${r.message?.to?.[0] ?? ""}` : r.message?.fromName || r.message?.from || "Unknown sender", subject: r.message?.subject ?? "(no subject)", jobId: jid, jobNumber: jid ? jobs.get(jid)?.number ?? null : null, state: outlookState(r.route, r.message?.direction, r.status) };
    }),
  };
}

import type { Database } from "@/integrations/supabase/types";
import type { OutboxDispatchResult } from "./external-action-outbox.server";
import { SMS_MESSAGE_TYPES, type SmsMessageType } from "./sms.core";
import type { RealSmsInput } from "./sms.server";

type OutboxRow = Database["public"]["Tables"]["external_action_outbox"]["Row"];

type EmailResult = { sent: true; communicationId?: string | null } | { sent: false; reason: string };
type SmsResult = { status: "sent" | "blocked" | "failed" | "sent_unknown" | "already"; detail: string; sid: string | null };

export type ExternalActionDispatchDeps = {
  sendInitialEstimateEmail: (jobId: string, actorId: string | null) => Promise<EmailResult>;
  sendPreliminaryIneligibleEmail: (jobId: string, actorId?: string | null) => Promise<EmailResult>;
  sendRealSms: (input: RealSmsInput) => Promise<SmsResult>;
};

export async function defaultExternalActionDispatchDeps(): Promise<ExternalActionDispatchDeps> {
  const [followups, sms] = await Promise.all([import("./followups.server"), import("./sms.server")]);
  return {
    sendInitialEstimateEmail: followups.sendInitialEstimateEmail,
    sendPreliminaryIneligibleEmail: followups.sendPreliminaryIneligibleEmail,
    sendRealSms: sms.sendRealSms,
  };
}

export function createExternalActionDispatcher(depsFactory: () => Promise<ExternalActionDispatchDeps> = defaultExternalActionDispatchDeps) {
  return async function dispatchExternalAction(row: OutboxRow): Promise<OutboxDispatchResult> {
    const deps = await depsFactory();
    if (row.action_type === "customer_email") return dispatchCustomerEmail(row, deps);
    if (row.action_type === "customer_sms") return dispatchCustomerSms(row, deps);
    return { ok: false, code: "UNAPPROVED_NOTIFICATION_TYPE", retryable: false };
  };
}

export const dispatchExternalAction = createExternalActionDispatcher();

async function dispatchCustomerEmail(row: OutboxRow, deps: ExternalActionDispatchDeps): Promise<OutboxDispatchResult> {
  const ref = parseRef(row.payload_ref);
  let result: EmailResult;
  if (ref.kind === "step3_estimate" && ref.id === row.job_id) result = await deps.sendInitialEstimateEmail(row.job_id, null);
  else if (ref.kind === "preliminary_ineligible" && ref.id === row.job_id) result = await deps.sendPreliminaryIneligibleEmail(row.job_id, null);
  else return { ok: false, code: "UNAPPROVED_NOTIFICATION_TYPE", retryable: false };
  if (result.sent) return { ok: true, completedRef: result.communicationId ? `email:${result.communicationId}` : `email:${row.idempotency_key}` };
  return emailFailure(result.reason);
}

async function dispatchCustomerSms(row: OutboxRow, deps: ExternalActionDispatchDeps): Promise<OutboxDispatchResult> {
  const input = parseSmsPayload(row);
  if (!input) return { ok: false, code: "PERMANENT_VALIDATION", retryable: false };
  const result = await deps.sendRealSms(input);
  if (result.status === "sent") return { ok: true, completedRef: result.sid ? `sms:${result.sid}` : `sms:${row.idempotency_key}` };
  if (result.status === "already") return { ok: true, completedRef: `sms:already:${row.idempotency_key}` };
  if (result.status === "sent_unknown") return { ok: false, code: "DELIVERY_UNKNOWN", retryable: false };
  if (result.status === "blocked") return { ok: false, code: smsBlockCode(result.detail), retryable: false };
  return { ok: false, code: "PROVIDER_REJECTED", retryable: true };
}

function parseRef(ref: string): { kind: string; id: string } {
  const i = ref.indexOf(":");
  return i < 1 ? { kind: "", id: "" } : { kind: ref.slice(0, i), id: ref.slice(i + 1) };
}

function emailFailure(reason: string): OutboxDispatchResult {
  if (reason === "already_sent") return { ok: true, completedRef: "email:already_sent" };
  if (["provider_not_configured", "comms_disabled", "backlog_cutoff_not_set"].includes(reason)) return { ok: false, code: "PERMANENT_CONFIG", retryable: false };
  if (["no_consent", "unsubscribed", "email_bounced", "email_complained", "complaint", "opted_out"].includes(reason)) return { ok: false, code: "PERMANENT_CONSENT", retryable: false };
  if (["delivered_unrecorded"].includes(reason)) return { ok: false, code: "DELIVERY_UNKNOWN", retryable: false };
  if (["delivery_failed"].includes(reason)) return { ok: false, code: "PROVIDER_REJECTED", retryable: true };
  return { ok: false, code: "PERMANENT_VALIDATION", retryable: false };
}

function parseSmsPayload(row: OutboxRow): RealSmsInput | null {
  const ref = parseRef(row.payload_ref);
  if (ref.kind !== "real_sms") return null;
  const second = ref.id.indexOf(":");
  if (second < 1) return null;
  const type = ref.id.slice(0, second);
  if (!(type in SMS_MESSAGE_TYPES)) return null;
  try {
    const json = JSON.parse(Buffer.from(ref.id.slice(second + 1), "base64url").toString("utf8")) as Partial<RealSmsInput>;
    if (json.type !== type || typeof json.body !== "string") return null;
    return { type: type as SmsMessageType, idempotencyKey: row.idempotency_key, to: json.to, body: json.body, jobId: json.jobId ?? row.job_id, businessId: json.businessId ?? null };
  } catch {
    return null;
  }
}

function smsBlockCode(detail: string): string {
  if (/consent|STOP|opted out|not approved/i.test(detail)) return "PERMANENT_CONSENT";
  if (/switched off|not set up|not configured|sender|Wording not approved/i.test(detail)) return "PERMANENT_CONFIG";
  return "PERMANENT_VALIDATION";
}

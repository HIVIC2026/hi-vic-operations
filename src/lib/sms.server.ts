// The ONE real SMS sender (Twilio AU1 direct, twilio-au1.server.ts) (Jo, 7 Oct). OFF unless customer_comms_enabled AND the message type's own switch are on.
// TEST records never come here (they use test-send.server.ts, unchanged). Sends at most once per idempotency key,
// never retries an ambiguous send, and logs delivery status against the job or partner.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { customerCommsEnabled, hasCurrentOwnerContactConsent } from "./comms.server";
import { SMS_MESSAGE_TYPES, brandSmsBody, smsBlocker, toAuE164, type SmsMessageType } from "./sms.core";

const db = admin as any;
const WEBHOOK_BASE = "https://estimate.homeinsulationvictoria.com.au";

export type RealSmsInput = {
  type: SmsMessageType;
  idempotencyKey: string;
  to: string | null | undefined;
  body: string;
  jobId?: string | null;
  businessId?: string | null;
};
export type RealSmsResult = { status: "sent" | "blocked" | "failed" | "sent_unknown" | "already"; detail: string; sid: string | null };

/** Australian sending number from TWILIO_FROM_NUMBER (read per call). Alphanumeric sender names are not accepted. */
export function sendingNumber(): string | null {
  const n = toAuE164(process.env["TWILIO_FROM_NUMBER"] ?? "") ?? (/^\+61[0-9]{9}$/.test(process.env["TWILIO_FROM_NUMBER"] ?? "") ? process.env["TWILIO_FROM_NUMBER"]! : null);
  return n;
}

async function typeSwitchOn(type: SmsMessageType): Promise<boolean> {
  const { data } = await db.from("workflow_settings").select("sms_message_switches, daily_mitti_text_enabled").eq("id", 1).maybeSingle();
  if (!data) return false;
  if (type === "daily_mitti" || type === "daily_mitti_update") return data.daily_mitti_text_enabled === true && data.sms_message_switches?.[type] === true;
  return data.sms_message_switches?.[type] === true;
}

async function isOptedOut(phone: string): Promise<boolean> {
  const { data } = await db.from("sms_optouts").select("opted_out_at, opted_in_at").eq("phone", phone).maybeSingle();
  if (!data) return false;
  return !data.opted_in_at || Date.parse(data.opted_in_at) < Date.parse(data.opted_out_at);
}

async function consentAndTest(input: RealSmsInput): Promise<{ consent: boolean; isTest: boolean }> {
  const audience = SMS_MESSAGE_TYPES[input.type].audience;
  let isTest = false;
  if (input.jobId) {
    const { data: j } = await db.from("jobs").select("source").eq("id", input.jobId).maybeSingle();
    if (!j || j.source === "qa_test") isTest = true;
  }
  if (audience === "owner") return { consent: input.jobId ? await hasCurrentOwnerContactConsent(input.jobId) : false, isTest };
  if (!input.businessId) return { consent: false, isTest };
  const { data: b } = await db.from("businesses").select("is_active, approved_at, onboarding_notes").eq("id", input.businessId).maybeSingle();
  if (!b || String(b.onboarding_notes ?? "").includes("[TEST PARTNER]")) isTest = true;
  return { consent: b?.is_active === true && !!b?.approved_at, isTest };
}

async function logJob(input: RealSmsInput, to: string, status: string, detail: string) {
  if (!input.jobId) return;
  await db.from("job_communications").insert({
    job_id: input.jobId, direction: "outbound", channel: "sms", recipients: [to], subject: null, body: brandSmsBody(input.body), provider: "twilio",
    sent_at: status === "sent" ? new Date().toISOString() : null, delivery_status: status === "blocked" ? "blocked_prelaunch" : status,
    visibility: SMS_MESSAGE_TYPES[input.type].audience === "owner" ? "customer" : "trade", source_event: `sms:${input.type}`, source_reference: detail.slice(0, 200),
  }).then(() => null, () => null);
}

/** Send one real SMS. Every check runs first; blocked attempts are logged and never reach Twilio. */
export async function sendRealSms(input: RealSmsInput, blast?: { claimId: string; adminSpotReminderBlast: true }): Promise<RealSmsResult> {
  const blastAllowed = input.type === "save_spot_reminder" && blast?.adminSpotReminderBlast === true &&
    input.idempotencyKey === `save-spot-reminder-blast:v1:${input.jobId}`;
  if (blast && !blastAllowed) throw new Error("Invalid one-off SMS authorization");
  const to = toAuE164(input.to);
  const from = sendingNumber();
  const { consent, isTest } = await consentAndTest(input);
  const blocked = smsBlocker({
    type: input.type, to: input.to, commsEnabled: await customerCommsEnabled(), typeSwitchOn: await typeSwitchOn(input.type),
    senderConfigured: !!from, optedOut: to ? await isOptedOut(to) : false, consent, isTestRecord: isTest,
    adminSpotReminderBlast: blastAllowed,
  });
  // Claim the idempotency key first (unique). An existing claim means this message was already handled.
  const { data: row, error } = await db.from("sms_messages").insert({
    ...(blastAllowed && blast ? { id: blast.claimId } : {}),
    message_type: input.type, idempotency_key: input.idempotencyKey, job_id: input.jobId ?? null, business_id: input.businessId ?? null,
    to_number: to ?? String(input.to ?? ""), from_sender: from, body: brandSmsBody(input.body), status: blocked ? "blocked" : "sending", detail: blocked,
  }).select("id").maybeSingle();
  if (error || !row) {
    if (error && error.code !== "23505") throw new Error("Could not reserve SMS safely; nothing sent");
    return { status: "already", detail: "Already handled for this key – not sent again", sid: null };
  }
  if (blocked) { await logJob(input, to ?? String(input.to ?? ""), "blocked", blocked); return { status: "blocked", detail: blocked, sid: null }; }

  { const { jobDeletedBlocker } = await import("./job-live.server"); const del = await jobDeletedBlocker(input.jobId ?? null);
    if (del) { await db.from("sms_messages").update({ status: "blocked", detail: del }).eq("id", row.id); await logJob(input, to ?? String(input.to ?? ""), "blocked", del); return { status: "blocked", detail: del, sid: null }; } }
  const hook = process.env["SMS_WEBHOOK_TOKEN"];
  const { au1Configured, au1SendMessage } = await import("./twilio-au1.server");
  let r: RealSmsResult;
  if (!au1Configured()) r = { status: "failed", detail: "Twilio AU1 is not set up", sid: null };
  else {
    if (!to || !from) throw new Error("SMS recipient or sender unavailable");
    const params = new URLSearchParams({ To: to, From: from, Body: brandSmsBody(input.body) });
    if (hook) params.set("StatusCallback", `${WEBHOOK_BASE}/api/public/twilio/status?t=${encodeURIComponent(hook)}`);
    try {
      const res = await au1SendMessage(params);
      if (res.ok) r = { status: "sent", detail: "Twilio AU1 accepted", sid: (JSON.parse(res.text) as { sid?: string }).sid ?? null };
      else if (res.status >= 500) r = { status: "sent_unknown", detail: `Twilio ${res.status} – may have sent, not retried: ${res.text.slice(0, 250)}`, sid: null };
      else r = { status: "failed", detail: `Twilio ${res.status}: ${res.text.slice(0, 300)}`, sid: null };
    } catch (e) {
      r = { status: "sent_unknown", detail: `No answer from Twilio – may have sent, not retried: ${(e as Error).message}`, sid: null };
    }
  }
  await db.from("sms_messages").update({ status: r.status, detail: r.detail, provider_sid: r.sid, updated_at: new Date().toISOString() }).eq("id", row.id);
  await logJob(input, to ?? "", r.status, r.detail);
  return r;
}

/** Twilio delivery callback → sms_messages status. */
export async function recordSmsStatus(sid: string, status: string, errorCode: string | null) {
  const { mapTwilioStatus } = await import("./sms.core");
  const s = mapTwilioStatus(status);
  if (!s) return;
  await db.from("sms_messages").update({ status: s, detail: errorCode ? `Twilio error ${errorCode}` : `Twilio: ${status}`, status_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("provider_sid", sid);
}

/** Inbound STOP / START reply. */
export async function recordInboundReply(from: string, body: string, sid?: string | null) {
  const { stopKeyword } = await import("./sms.core");
  const phone = toAuE164(from);
  const k = stopKeyword(body);
  // Every reply (including STOP/START) is saved on the job of the latest text we sent that number (Jo, 8 Oct). Internal only.
  if (phone) {
    const { data: last } = await db.from("sms_messages").select("job_id").eq("to_number", phone).not("job_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last?.job_id) {
      const dup = sid ? (await db.from("job_communications").select("id").eq("provider_message_id", sid).maybeSingle()).data : null;
      if (!dup) await db.from("job_communications").insert({
        job_id: last.job_id, direction: "inbound", channel: "sms", recipients: [], body: body.slice(0, 1600), provider: "twilio",
        provider_message_id: sid ?? null, received_at: new Date().toISOString(), delivery_status: "received", visibility: "internal",
        sender_text: phone, source_event: "sms:reply",
      }).then(() => null, () => null);
    }
  }
  if (!phone || !k) return k;
  const now = new Date().toISOString();
  if (k === "stop") await db.from("sms_optouts").upsert({ phone, opted_out_at: now, opted_in_at: null, source: "stop_reply", last_message: body.slice(0, 160) });
  else await db.from("sms_optouts").update({ opted_in_at: now, last_message: body.slice(0, 160) }).eq("phone", phone);
  return k;
}

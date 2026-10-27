// Test-only email (Resend) + SMS (Twilio) sender. Every call goes through testSendBlocker first;
// anything not on the allowlist is recorded as blocked and never reaches a provider.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { normaliseAuMobile, normaliseEmail, testSendBlocker } from "./test-send.core";
import { brandSmsBody } from "./sms.core";
import { RESEND_FETCH_TIMEOUT_MS, timeoutSignal } from "./network-timeout.core";

export const TEST_APP_BASE = "https://id-preview--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app";
const FROM_EMAIL = "Home Insulation Victoria <jobs@homeinsulationvictoria.com.au>";

type Ctx = { jobId: string | null; jobSource: string | null; partnerIsTest: boolean; label: string; actorId: string | null };
export type SendResult = { channel: "sms" | "email"; to: string; status: "sent" | "blocked" | "failed"; detail: string };

async function record(ctx: Ctx, r: SendResult, subject: string | null, body: string) {
  if (ctx.jobId) {
    await admin.from("job_communications").insert({
      job_id: ctx.jobId, direction: "outbound", channel: r.channel, recipients: [r.to], subject, body, provider: r.channel === "sms" ? "twilio_test" : "resend_test",
      sent_at: new Date().toISOString(), delivery_status: r.status === "sent" ? "sent" : r.status === "blocked" ? "blocked_prelaunch" : "failed",
      visibility: "trade", source_event: `jo_tradie:${ctx.label}`, source_reference: r.detail.slice(0, 200), created_by: ctx.actorId,
    });
  }
  await admin.from("admin_config_events").insert({ actor_id: ctx.actorId, event_type: "test_send", summary: `TEST ${r.channel} ${ctx.label}: ${r.status}`, details: { ...r, job_id: ctx.jobId } });
}

function gw() {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY is not configured");
  return key;
}

export async function sendTestSms(ctx: Ctx, to: string, rawBody: string): Promise<SendResult> {
  const body = brandSmsBody(rawBody);
  const norm = normaliseAuMobile(to) ?? to;
  const blocked = ctx.jobSource === "qa_test" || (await import("./qa-context.server")).qaContextActive() ? "TEST delivery recorded only; no SMS service called" : testSendBlocker({ channel: "sms", to, jobSource: ctx.jobSource, partnerIsTest: ctx.partnerIsTest });
  let r: SendResult;
  if (blocked) r = { channel: "sms", to: norm, status: "blocked", detail: blocked };
  else {
    try {
      const { au1SendMessage } = await import("./twilio-au1.server");
      const from = process.env["TWILIO_FROM_NUMBER"];
      if (!from) throw new Error("No Australian sending number set (TWILIO_FROM_NUMBER)");
      const res = await au1SendMessage(new URLSearchParams({ To: norm, From: from, Body: body }));
      const sid = res.ok ? (JSON.parse(res.text) as { sid?: string }).sid ?? "" : "";
      r = res.ok ? { channel: "sms", to: norm, status: "sent", detail: `Twilio AU1 accepted ${sid}` } : { channel: "sms", to: norm, status: "failed", detail: `Twilio AU1 ${res.status}: ${res.text.slice(0, 300)}` };
    } catch (e) { r = { channel: "sms", to: norm, status: "failed", detail: (e as Error).message }; }
  }
  await record(ctx, r, null, body);
  return r;
}

/** Same recipient+subject+body => same key, so Resend drops an accidental repeat for 24h. */
async function idemKey(to: string, subject: string, html: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${to}\n${subject}\n${html}`));
  return `hiv-test-${Array.from(new Uint8Array(b)).slice(0, 16).map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export async function sendTestEmail(ctx: Ctx, to: string, subject: string, html: string, text: string, opts: { attachments?: import("./email-kit.core").EmailAttachment[] } = {}): Promise<SendResult> {
  const norm = normaliseEmail(to);
  const blocked = ctx.jobSource === "qa_test" || (await import("./qa-context.server")).qaContextActive() ? "TEST delivery recorded only; no email service called" : testSendBlocker({ channel: "email", to, jobSource: ctx.jobSource, partnerIsTest: ctx.partnerIsTest });
  let r: SendResult;
  if (blocked) r = { channel: "email", to: norm, status: "blocked", detail: blocked };
  else {
    try {
      const resend = process.env["RESEND_API_KEY"];
      if (!resend) throw new Error("Email is not connected");
      const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${gw()}`, "X-Connection-Api-Key": resend, "Content-Type": "application/json", "Idempotency-Key": await idemKey(norm, subject, html) },
        body: JSON.stringify({ from: FROM_EMAIL, to: [norm], subject: subject.startsWith("[TEST") ? subject : `[TEST] ${subject}`, html, text, ...(opts.attachments?.length ? { attachments: opts.attachments.map((a) => ({ filename: a.filename, content: a.content, content_type: a.contentType })) } : {}) }),
        signal: timeoutSignal(RESEND_FETCH_TIMEOUT_MS),
      });
      const t = await res.text();
      r = res.ok ? { channel: "email", to: norm, status: "sent", detail: `Resend accepted${(() => { try { const id = (JSON.parse(t) as { id?: string }).id; return id ? ` (id ${id})` : ""; } catch { return ""; } })()}` } : { channel: "email", to: norm, status: "failed", detail: `Resend ${res.status}: ${t.slice(0, 300)}` };
    } catch (e) { r = { channel: "email", to: norm, status: "failed", detail: `sent_unknown (no clear answer from Resend; do not retry by hand within 24h — Resend drops an identical repeat): ${(e as Error).message}` }; }
  }
  await record(ctx, r, subject, text);
  return r;
}

// Pure renderer shared directly with campaign emails.
export { simpleEmail } from "./simple-email.core";

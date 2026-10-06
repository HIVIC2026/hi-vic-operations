// Test-only email (Resend) + SMS (Twilio) sender. Every call goes through testSendBlocker first;
// anything not on the allowlist is recorded as blocked and never reaches a provider.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { normaliseAuMobile, normaliseEmail, testSendBlocker } from "./test-send.core";

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

export async function sendTestSms(ctx: Ctx, to: string, body: string): Promise<SendResult> {
  const norm = normaliseAuMobile(to) ?? to;
  const blocked = testSendBlocker({ channel: "sms", to, jobSource: ctx.jobSource, partnerIsTest: ctx.partnerIsTest });
  let r: SendResult;
  if (blocked) r = { channel: "sms", to: norm, status: "blocked", detail: blocked };
  else {
    try {
      const twilio = process.env["TWILIO_API_KEY"];
      if (!twilio) throw new Error("Texting is not connected");
      const res = await fetch("https://connector-gateway.lovable.dev/twilio/Messages.json", {
        method: "POST",
        headers: { Authorization: `Bearer ${gw()}`, "X-Connection-Api-Key": twilio, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: norm, From: process.env["TWILIO_FROM_NUMBER"] || "HIV", Body: body }),
      });
      const text = await res.text();
      r = res.ok ? { channel: "sms", to: norm, status: "sent", detail: "Twilio accepted" } : { channel: "sms", to: norm, status: "failed", detail: `Twilio ${res.status}: ${text.slice(0, 300)}` };
    } catch (e) { r = { channel: "sms", to: norm, status: "failed", detail: (e as Error).message }; }
  }
  await record(ctx, r, null, body);
  return r;
}

export async function sendTestEmail(ctx: Ctx, to: string, subject: string, html: string, text: string): Promise<SendResult> {
  const norm = normaliseEmail(to);
  const blocked = testSendBlocker({ channel: "email", to, jobSource: ctx.jobSource, partnerIsTest: ctx.partnerIsTest });
  let r: SendResult;
  if (blocked) r = { channel: "email", to: norm, status: "blocked", detail: blocked };
  else {
    try {
      const resend = process.env["RESEND_API_KEY"];
      if (!resend) throw new Error("Email is not connected");
      const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${gw()}`, "X-Connection-Api-Key": resend, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM_EMAIL, to: [norm], subject: `[TEST] ${subject}`, html, text }),
      });
      const t = await res.text();
      r = res.ok ? { channel: "email", to: norm, status: "sent", detail: `Resend accepted${(() => { try { const id = (JSON.parse(t) as { id?: string }).id; return id ? ` (id ${id})` : ""; } catch { return ""; } })()}` } : { channel: "email", to: norm, status: "failed", detail: `Resend ${res.status}: ${t.slice(0, 300)}` };
    } catch (e) { r = { channel: "email", to: norm, status: "failed", detail: (e as Error).message }; }
  }
  await record(ctx, r, subject, text);
  return r;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
/** Simple branded email: navy heading, body lines, one green button. */
export function simpleEmail(heading: string, lines: string[], button?: { label: string; url: string }) {
  const html = `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#22376B;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" style="max-width:520px;background:#FBFCFA;border:1px solid #E4E9F5;border-radius:22px;" cellpadding="0" cellspacing="0"><tr><td style="padding:28px 24px;">
<div style="font-size:13px;font-weight:bold;color:#3C51C4;">Home Insulation Victoria</div>
<div style="display:inline-block;margin-top:6px;background:#FDF2F6;color:#22376B;font-size:11px;font-weight:bold;padding:3px 8px;border-radius:999px;">TEST — only sent to Jo</div>
<h1 style="font-size:24px;line-height:1.25;margin:14px 0 12px;">${esc(heading)}</h1>
${lines.map((l) => `<p style="font-size:15px;line-height:1.55;margin:0 0 12px;">${esc(l)}</p>`).join("")}
${button ? `<p style="margin:20px 0 4px;"><a href="${esc(button.url)}" style="display:inline-block;background:#07BF61;color:#ffffff;font-weight:bold;text-decoration:none;padding:14px 22px;border-radius:14px;font-size:16px;">${esc(button.label)}</a></p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
  const text = [heading, "", ...lines, ...(button ? ["", `${button.label}: ${button.url}`] : []), "", "TEST — only sent to Jo."].join("\n");
  return { html, text };
}

// Jo 23 Oct 2026: installer approval of the drafted owner quote. Callers authorise first. Never sends to owners.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import {
  INSTALLER_QUOTE_APPROVAL_CODE, WAITING_ON_INSTALLER, approvalState, canApprove, formFingerprint, quoteFingerprint, readApprovalEvents, reminderDue,
  INSTALLER_QUOTE_REMINDER_ENABLED, type ApprovalState,
} from "./installer-quote-approval.core";

const QUOTE_COLS = "id, job_id, status, sent_at, release_state, release_hold_reason, option_code, created_at, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, quote_items(code, description, explanation, quantity, unit, unit_price_inc_gst, line_total_inc_gst, sort)";

export type QuoteApproval = {
  applies: boolean; quote: any | null; state: ApprovalState; sent: boolean; quoteFp: string; formFp: string; channel: string | null; readyAt: string | null; approvedAt: string | null;
};

/** Latest unsent or just-sent installer quote and its approval state. */
export async function loadQuoteApproval(jobId: string): Promise<QuoteApproval> {
  const [{ data: job }, { data: qs, error }, { data: m }, { data: ev }] = await Promise.all([
    admin.from("jobs").select("channel").eq("id", jobId).maybeSingle(),
    admin.from("quotes").select(QUOTE_COLS).eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]).order("created_at", { ascending: false }).limit(1),
    admin.from("ceiling_measurements").select("raw_snapshot").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("workflow_events").select("created_at, actor_id, details").eq("job_id", jobId).eq("event_type", "installer_quote_approved").order("created_at", { ascending: false }),
  ]);
  if (error) throw new WorkflowError("Quote could not be read.");
  const q = qs?.[0] ?? null;
  const channel = job?.channel ?? null;
  if (!q || q.option_code !== INSTALLER_QUOTE_APPROVAL_CODE) return { applies: false, quote: null, state: "needs_check", sent: false, quoteFp: "", formFp: "", channel, readyAt: null, approvedAt: null };
  const lines = [...(q.quote_items ?? [])].sort((a, b) => a.sort - b.sort);
  const quoteFp = quoteFingerprint(q, lines), formFp = formFingerprint(m?.raw_snapshot);
  const approvals = readApprovalEvents(ev ?? []);
  const latest = approvals.find((a) => a.quoteId === q.id);
  let adjustedAfter = false;
  if (latest) {
    const { data: adj } = await admin.from("quote_adjustments").select("created_at").eq("quote_id", q.id).gt("created_at", latest.at).limit(1);
    adjustedAfter = !!adj?.length;
  }
  const state = approvalState({ quoteId: q.id, quoteFp, formFp, approvals, adjustedAfterApproval: adjustedAfter });
  return { applies: true, quote: { ...q, quote_items: lines }, state, sent: !!q.sent_at, quoteFp, formFp, channel, readyAt: q.created_at, approvedAt: state === "approved" ? latest?.at ?? null : null };
}

/** Office Send is blocked until the installer approves the current version. */
export async function installerApprovalBlocker(jobId: string, quote: { id: string; option_code?: string | null }): Promise<string | null> {
  if (quote.option_code !== INSTALLER_QUOTE_APPROVAL_CODE) return null;
  const a = await loadQuoteApproval(jobId);
  if (!a.applies || a.quote?.id !== quote.id) return null;
  return a.state === "approved" ? null : WAITING_ON_INSTALLER;
}

/** Installer taps "Quote is ready to send" / "Measurements are final": records who/when. */
export async function approveInstallerQuote(jobId: string, quoteId: string, userId: string) {
  const a = await loadQuoteApproval(jobId);
  if (!a.applies || a.quote?.id !== quoteId || a.sent) throw new WorkflowError("This quote changed or was already sent. Reload it.");
  const blockers = await (await import("./office-quote-review.server")).officeQuoteBlockers(jobId, a.quote);
  if (!canApprove(blockers)) throw new WorkflowError(blockers.filter((b) => b !== WAITING_ON_INSTALLER).join(" • "));
  await logEvent(jobId, userId, "installer_quote_approved", "Installer checked the owner quote and approved it for the office", { quote_id: quoteId, quote_fp: a.quoteFp, form_fp: a.formFp }, { internal: true });
  return { approved: true as const };
}

/** One reminder EMAIL per quote version to the installer, 48 h after the quote was ready. Switched OFF. */
export async function sweepInstallerQuoteReminders(opts: { now?: number; enabled?: boolean; send?: (to: string, subject: string, text: string) => Promise<boolean> } = {}) {
  const enabled = opts.enabled ?? INSTALLER_QUOTE_REMINDER_ENABLED;
  if (!enabled) return { enabled: false, sent: 0 };
  const now = opts.now ?? Date.now();
  const { data: qs } = await admin.from("quotes").select("job_id").eq("option_code", INSTALLER_QUOTE_APPROVAL_CODE).eq("status", "draft").is("sent_at", null).limit(500);
  let sent = 0;
  for (const jobId of [...new Set((qs ?? []).map((q) => q.job_id))]) {
    const a = await loadQuoteApproval(jobId);
    if (!a.applies || !a.readyAt) continue;
    const { data: rem } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "installer_quote_reminder");
    const remindedFps = (rem ?? []).map((r) => String((r.details as { quote_fp?: string } | null)?.quote_fp ?? ""));
    if (!reminderDue({ readyAt: a.readyAt, now, state: a.state, sent: a.sent, remindedFps, quoteFp: a.quoteFp, enabled })) continue;
    const { data: asg } = await admin.from("job_assignments").select("user_id, profiles:user_id(email, full_name)").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle();
    const prof = (asg as { profiles?: { email?: string | null; full_name?: string | null } } | null)?.profiles;
    if (!prof?.email) continue;
    const { data: job } = await admin.from("jobs").select("job_number").eq("id", jobId).single();
    const link = `https://estimate.homeinsulationvictoria.com.au/field/${jobId}`;
    const ok = await (opts.send ?? sendReminderEmail)(prof.email, `Please check the quote for ${job?.job_number ?? "your job"}`,
      `Hi ${prof.full_name?.split(" ")[0] ?? "there"},\n\nThe owner quote for ${job?.job_number ?? "your job"} is ready for you to check. Open the job and tap "Check quote":\n${link}\n\nHome Insulation Victoria`);
    await logEvent(jobId, null, "installer_quote_reminder", `Quote check reminder email to installer: ${ok ? "sent" : "failed"}`, { quote_id: a.quote.id, quote_fp: a.quoteFp, status: ok ? "sent" : "failed" }, { internal: true });
    if (ok) sent++;
  }
  return { enabled: true, sent };
}

async function sendReminderEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env["RESEND_API_KEY"], gw = process.env["LOVABLE_API_KEY"];
  if (!key || !gw) return false;
  const { simpleEmail } = await import("./simple-email.core");
  const mail = simpleEmail(subject, text.split("\n\n"), undefined, { testLabel: false });
  const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
    method: "POST", headers: { Authorization: `Bearer ${gw}`, "X-Connection-Api-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Home Insulation Victoria <jobs@homeinsulationvictoria.com.au>", to: [to], subject, html: mail.html, text: mail.text }),
  }).catch(() => null);
  return !!res?.ok;
}

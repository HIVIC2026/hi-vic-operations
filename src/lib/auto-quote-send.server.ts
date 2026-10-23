// Jo 24 Oct 2026: installer marks the Mitti Ready Check Complete → the owner's quote goes out automatically when
// every check passes; otherwise it is held for the office with the reasons (one office note per quote version).
// Delivery goes only through the shared guarded release (office-quote-review.server.ts releaseQuoteToOwner).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { AUTO_QUOTE_SEND_ENABLED, CHANGED_AFTER_SEND, autoSendDecision } from "./auto-quote-send.core";
import { INSTALLER_QUOTE_CODE } from "./installer-quote.server";

export type AutoSendResult = { sent: boolean; reasons: string[] };

export async function maybeAutoSendInstallerQuote(jobId: string, opts: { formCompleted: boolean; formModifiedAt: string | null; enabled?: boolean }): Promise<AutoSendResult> {
  const enabled = opts.enabled ?? AUTO_QUOTE_SEND_ENABLED;
  const { data: quotes, error } = await admin.from("quotes").select("id, status, sent_at, release_state, release_hold_reason, created_at, option_code")
    .eq("job_id", jobId).eq("kind", "installation").order("created_at", { ascending: false });
  if (error) throw new Error("Quotes could not be read for the automatic send.");
  const sent = (quotes ?? []).filter((q) => q.sent_at);
  const lastSentAt = sent.map((q) => String(q.sent_at)).sort().pop() ?? null;

  // A form edited after a quote went out: the sent quote stands; the office is told once per form edit.
  if (lastSentAt && opts.formModifiedAt && opts.formModifiedAt > lastSentAt) await noteOnce(jobId, `changed:${opts.formModifiedAt}`, [CHANGED_AFTER_SEND]);

  const draft = (quotes ?? []).find((q) => q.status === "draft" && !q.sent_at && q.option_code === INSTALLER_QUOTE_CODE);
  if (!draft) return { sent: false, reasons: [] };
  const { officeQuoteBlockers, releaseQuoteToOwner } = await import("./office-quote-review.server");
  const blockers = await officeQuoteBlockers(jobId, draft);
  const d = autoSendDecision({ enabled, formCompleted: opts.formCompleted, quoteReady: true, blockers, sentBefore: !!lastSentAt });
  if (!d.send) {
    if (!d.quiet) await noteOnce(jobId, `held:${draft.id}:${d.reasons.join("|")}`, d.reasons, draft.id);
    return { sent: false, reasons: d.reasons };
  }
  try {
    await releaseQuoteToOwner(jobId, draft.id, null, "auto");
    return { sent: true, reasons: [] };
  } catch (e) {
    const why = e instanceof Error ? e.message : "send failed";
    await noteOnce(jobId, `failed:${draft.id}:${why}`, [`Automatic quote send stopped: ${why}`], draft.id);
    return { sent: false, reasons: [why] };
  }
}

/** One office note per distinct situation (the 15-minute sync must not repeat it). Shown on Quotes to check. */
async function noteOnce(jobId: string, key: string, reasons: string[], quoteId?: string) {
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "quote_auto_send_held").contains("details", { auto_send_key: key });
  if (count) return;
  await logEvent(jobId, null, "quote_auto_send_held", `Quote not sent automatically: ${reasons.join(" · ")}`, { auto_send_key: key, reasons, quote_id: quoteId ?? null, needs_office: true }, { internal: true });
}

// Batch 3a Task 2: "Send me a new quote" (spec section 2). I/O only — rules in new-quote-request.core.ts.
// The owner's secure My job token is the only credential. One claim per expired quote (`new_quote_requested`, key = the
// expired quote's id). Refused (nothing written) unless the job is still closed with "Quote expired (14 days)" and was not
// reopened since. Then: the claim, reopen to the quote stage through stageEntryBlockers + a compare-and-swap on the closed
// job, put back the installer the expiry cancel ended, and
// - our leads: the HIV quote builder prices it at today's rates from the same measurement; while the request has no sent
//   quote after it the builder (any caller) makes a HELD draft without accepted fixes lines → Quotes to check → office
//   Send. Installer not back → Needs me "New quote asked for — choose installer".
// - installer leads: nothing priced; the installer's "Your price" card asks again (prices — portal or old form — from
//   before the request are not read any more, installer-price.server.ts) and the normal installer-quote path prepares it
//   for office Send. Installer business not back → Needs me "New quote asked for — installer no longer active".
// Nothing is sent to anyone here.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  EXPIRY_CANCEL_END_REASON_PREFIX, NEW_QUOTE_NEEDS_INSTALLER_EVENT, NEW_QUOTE_REQUESTED_EVENT, NEW_QUOTE_STAGE, NEW_QUOTE_UNFINISHED_EVENT, NEW_QUOTE_UNFINISHED_PREFIX,
  expiredQuoteClose, newQuoteAlreadyRequested, newQuoteRequestBlocker, type NewQuoteEventRow, type NewQuoteLead, type NewQuoteResult,
} from "./new-quote-request.core";
import { QUOTE_EXPIRED_CANCELLED_EVENT, QUOTE_EXPIRED_CANCEL_REASON, QUOTE_EXPIRED_CLOSED_EVENT } from "./quote-expiry.core";

const THANKS: NewQuoteResult = { kind: "thanks" };
const REFUSED: NewQuoteResult = { kind: "refused" };

/** The job behind an ACTIVE, unexpired step3_estimate My job link; null for anything else. */
export async function ownerJobFromToken(token: string): Promise<string | null> {
  const { isWellFormedToken, LINK_PURPOSE, linkUsable } = await import("./estimatelink.core");
  if (!isWellFormedToken(token)) return null;
  const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", token).eq("purpose", LINK_PURPOSE).eq("status", "active").maybeSingle();
  return l && linkUsable(l) ? String(l.job_id) : null;
}

async function historyFor(jobId: string): Promise<NewQuoteEventRow[]> {
  const { data, error } = await admin.from("workflow_events").select("event_type, created_at, details, to_stage").eq("job_id", jobId)
    .in("event_type", [QUOTE_EXPIRED_CANCELLED_EVENT, QUOTE_EXPIRED_CLOSED_EVENT, NEW_QUOTE_REQUESTED_EVENT, "stage_changed"]);
  if (error) throw new Error(`Could not read the job history: ${error.message}`);
  return (data ?? []).map((e) => ({ event_type: String(e.event_type), created_at: String(e.created_at), details: (e.details ?? null) as Record<string, unknown> | null, to_stage: (e.to_stage as string | null) ?? null }));
}

/** Owner: "Send me a new quote". Returns the same thanks on a second tap; refused writes nothing.
 *  Order: every check → the claim (so a re-tap always gets the thanks) → compare-and-swap reopen → the rest inside one
 *  try/catch: any failure there leaves ONE office note (`new_quote_unfinished`, Needs me) instead of a half-reopened job
 *  nobody sees. A claim whose reopen never happened (write failed in between) is finished by the next tap. */
export async function requestNewQuote(token: string): Promise<NewQuoteResult> {
  const jobId = await ownerJobFromToken(token);
  if (!jobId) return REFUSED;
  const [{ data: job, error }, events] = await Promise.all([
    admin.from("jobs").select("id, stage, cancelled_reason, channel, job_number").eq("id", jobId).maybeSingle(),
    historyFor(jobId),
  ]);
  if (error) throw new Error(error.message);
  if (!job) return REFUSED;
  const close = expiredQuoteClose(events);
  if (!close) return REFUSED;
  const claimed = newQuoteAlreadyRequested(events, close.quoteId);
  if (newQuoteRequestBlocker({ stage: job.stage, cancelledReason: job.cancelled_reason ?? null, events })) return claimed ? THANKS : REFUSED;
  // The usual guard for entering the quote stage, checked before anything is written.
  const { stageEntryBlockers } = await import("./workflow.server");
  const blockers = await stageEntryBlockers(jobId, NEW_QUOTE_STAGE as never, null);
  if (blockers.length) return claimed ? THANKS : REFUSED;
  const ourLead = job.channel !== "installer_sourced";
  if (!claimed) {
    await logEvent(jobId, null, NEW_QUOTE_REQUESTED_EVENT, `Owner asked for a new quote after their quote expired — ${ourLead ? "pricing a new draft for office Send" : "waiting for the installer's new price"}`,
      { quote_id: close.quoteId, idempotency_key: close.quoteId, channel: job.channel ?? null }, { internal: true });
  }
  // Compare-and-swap: only the request that moves the still-closed job goes on; a parallel tap stops here.
  const { data: moved, error: me } = await admin.from("jobs").update({ stage: NEW_QUOTE_STAGE as never, prior_stage: null, cancelled_reason: null })
    .eq("id", jobId).eq("stage", "cancelled").eq("cancelled_reason", QUOTE_EXPIRED_CANCEL_REASON).select("id");
  if (me) throw new Error(me.message);
  if ((moved?.length ?? 0) !== 1) return THANKS;

  try {
    await logEvent(jobId, null, "stage_changed", "Reopened: owner asked for a new quote after the quote expired", { reason: NEW_QUOTE_REQUESTED_EVENT, quote_id: close.quoteId }, { from: "cancelled", to: NEW_QUOTE_STAGE as never, internal: true });
    const installerBack = await reactivateInstaller(jobId);
    if (!installerBack) {
      const lead: NewQuoteLead = ourLead ? "ours" : "installer";
      await logEvent(jobId, null, NEW_QUOTE_NEEDS_INSTALLER_EVENT, ourLead ? "New quote asked for, but the installer is no longer active — choose an installer" : "New quote asked for, but the installer business is no longer active",
        { quote_id: close.quoteId, lead, needs_office: true }, { internal: true });
      return THANKS;
    }
    // Our leads: priced now. The builder itself holds it and leaves out accepted fixes lines (new-quote request on file).
    if (ourLead) await (await import("./quotes.server")).generateInstallerQuotes(jobId, null);
  } catch (e) {
    const reason = e instanceof Error ? e.message : "unknown error";
    await logEvent(jobId, null, NEW_QUOTE_UNFINISHED_EVENT, `${NEW_QUOTE_UNFINISHED_PREFIX}: ${reason}`, { quote_id: close.quoteId, reason, needs_office: true }, { internal: true })
      .catch((le) => console.error("new quote: office note not written", (le as Error).message));
  }
  return THANKS;
}

/** Put back the installer the expiry cancel ended, when that business is still active and approved. true = an installer
 *  is active on the job afterwards. */
async function reactivateInstaller(jobId: string): Promise<boolean> {
  const { count } = await admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", "installer").eq("active", true);
  if ((count ?? 0) > 0) return true;
  const { data: ended, error } = await admin.from("job_assignments").select("id, business_id, businesses(is_active, onboarding_status)").eq("job_id", jobId).eq("role", "installer").eq("active", false)
    .like("end_reason", `${EXPIRY_CANCEL_END_REASON_PREFIX}%`).order("ended_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not read the job's installer: ${error.message}`);
  const biz = (ended?.businesses ?? null) as { is_active?: boolean | null; onboarding_status?: string | null } | null;
  if (!ended || !biz?.is_active || biz.onboarding_status !== "approved") return false;
  const { data: back, error: ue } = await admin.from("job_assignments").update({ active: true, ended_at: null, end_reason: null } as never).eq("id", ended.id).eq("active", false).select("id");
  if (ue) throw new Error(`Could not put the installer back on the job: ${ue.message}`);
  if ((back?.length ?? 0) === 1) await logEvent(jobId, null, "assignment_reactivated", "Installer put back on the job for the new quote", { assignment_id: ended.id, business_id: ended.business_id ?? null }, { internal: true });
  return (back?.length ?? 0) === 1;
}

// Jo 24 Oct 2026: the latest Ready Check owner quote and its status for the installer (no approval step). Read-only;
// callers authorise first. Never sends to owners and never reads or writes the retired installer approval events.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { isReadyCheckQuote, type InstallerQuoteFacts } from "./installer-quote-status.core";
import { isNotOnboardedReason } from "./rec-onboarded.core";

/** Decision 303: the hold reason on an unsent draft names an electrician who is not an approved REC yet. */
const notOnboardedHold = (q: { sent_at: string | null; status: string; release_hold_reason: string | null }) =>
  !q.sent_at && q.status === "draft" && (q.release_hold_reason ?? "").split(" · ").some((r) => isNotOnboardedReason(r));
/** Jo 27 Oct 2026 (HV-3129): with no quote (the not-onboarded hold drafts none) the flag comes from the latest
 *  `installer_quote_held` event's `electrician_not_onboarded` details. */
const heldNotOnboarded = (details: unknown) => !!(details as { electrician_not_onboarded?: unknown } | null)?.electrician_not_onboarded;
/** No quote yet, but the latest hold says the electrician must finish onboarding: the installer sees that line. */
const NOT_ONBOARDED_NO_QUOTE = (channel: string | null, formCompleted: boolean): InstallerQuote => ({ applies: true, quote: null, channel, sent: false, accepted: false, declined: false, held: false, electricianNotOnboarded: true, formCompleted });

const QUOTE_COLS = "id, job_id, status, sent_at, release_state, release_hold_reason, option_code, created_at, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, quote_items(code, description, explanation, quantity, unit, unit_price_inc_gst, line_total_inc_gst, sort)";

export type InstallerQuote = InstallerQuoteFacts & { applies: boolean; quote: any | null; channel: string | null };

const NONE = (channel: string | null): InstallerQuote => ({ applies: false, quote: null, channel, sent: false, accepted: false, declined: false, held: false, formCompleted: false });

/** Latest Ready Check installation quote on the job (draft, sent, accepted or declined) and its plain status. */
export async function loadInstallerQuote(jobId: string): Promise<InstallerQuote> {
  const [{ data: job }, { data: qs, error }, { data: m }, { data: basics, error: be }] = await Promise.all([
    admin.from("jobs").select("channel").eq("id", jobId).maybeSingle(),
    admin.from("quotes").select(QUOTE_COLS).eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted", "declined"]).order("created_at", { ascending: false }).limit(1),
    admin.from("ceiling_measurements").select("external_source,external_id").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "ready_check_basics").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error || be) throw new WorkflowError("Quote could not be read.");
  const q = qs?.[0] ?? null;
  const channel = job?.channel ?? null;
  if (!q) {
    const { data: lastHeld, error: le } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "installer_quote_held").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (le) throw new WorkflowError("Quote hold could not be checked.");
    return heldNotOnboarded(lastHeld?.details) ? NOT_ONBOARDED_NO_QUOTE(channel, (basics?.details as { completed?: boolean } | null)?.completed === true) : NONE(channel);
  }
  if (!isReadyCheckQuote(q.option_code, m)) return NONE(channel);
  const lines = [...(q.quote_items ?? [])].sort((a, b) => a.sort - b.sort);
  let held = false;
  if (!q.sent_at) {
    const { count, error: he } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "quote_auto_send_held").contains("details", { quote_id: q.id });
    if (he) throw new WorkflowError("Quote hold could not be checked.");
    held = !!count;
  }
  return {
    applies: true, quote: { ...q, quote_items: lines }, channel,
    sent: !!q.sent_at, accepted: q.status === "accepted", declined: q.status === "declined", held, electricianNotOnboarded: notOnboardedHold(q),
    formCompleted: (basics?.details as { completed?: boolean } | null)?.completed === true,
  };
}

const QUOTE_STATUSES = ["draft", "issued", "accepted", "declined"] as const;

/** Speed (decision 280): the same facts as `loadInstallerQuote`, for many jobs in five reads instead of five per job.
 *  Per job the result is identical: latest Ready Check installation quote, its plain status, hold and form completion. */
export async function loadInstallerQuotes(jobIds: string[]): Promise<Map<string, InstallerQuote>> {
  const out = new Map<string, InstallerQuote>();
  const ids = [...new Set(jobIds)];
  if (!ids.length) return out;
  const [{ data: jobs }, { data: qs, error }, { data: ms }, { data: basicsRows, error: be }] = await Promise.all([
    admin.from("jobs").select("id, channel").in("id", ids),
    admin.from("quotes").select(QUOTE_COLS).in("job_id", ids).eq("kind", "installation").in("status", QUOTE_STATUSES).order("created_at", { ascending: false }),
    admin.from("ceiling_measurements").select("job_id, external_source, external_id").in("job_id", ids).eq("is_current", true),
    admin.from("workflow_events").select("job_id, details, created_at").in("job_id", ids).eq("event_type", "ready_check_basics").order("created_at", { ascending: false }),
  ]);
  if (error || be) throw new WorkflowError("Quote could not be read.");
  const channelOf = new Map((jobs ?? []).map((j) => [j.id, j.channel ?? null]));
  const latestQuote = new Map<string, NonNullable<typeof qs>[number]>();
  for (const q of qs ?? []) if (q.job_id && !latestQuote.has(q.job_id)) latestQuote.set(q.job_id, q); // ordered newest first
  const measurement = new Map((ms ?? []).map((m) => [m.job_id, m]));
  const latestBasics = new Map<string, { completed?: boolean } | null>();
  for (const b of basicsRows ?? []) if (b.job_id && !latestBasics.has(b.job_id)) latestBasics.set(b.job_id, (b.details as { completed?: boolean } | null) ?? null);
  // Hold events only for unsent Ready Check quotes (the single loader checks `details @> {quote_id}`; same test here).
  const unsent = [...latestQuote.values()].filter((q) => !q.sent_at && q.job_id && isReadyCheckQuote(q.option_code, measurement.get(q.job_id) ?? null));
  const unsentJobIds = [...new Set(unsent.map((q) => q.job_id as string))];
  const { data: holds, error: he } = unsentJobIds.length
    ? await admin.from("workflow_events").select("job_id, details").in("job_id", unsentJobIds).eq("event_type", "quote_auto_send_held")
    : { data: [] as { job_id: string | null; details: unknown }[], error: null };
  if (he) throw new WorkflowError("Quote hold could not be checked.");
  const heldQuoteIds = new Set((holds ?? []).map((h) => String((h.details as { quote_id?: unknown } | null)?.quote_id ?? "")));
  // Jobs with no quote: the latest installer_quote_held says whether the electrician must finish onboarding.
  const noQuoteIds = ids.filter((id) => !latestQuote.has(id));
  const { data: heldRows, error: qhe } = noQuoteIds.length
    ? await admin.from("workflow_events").select("job_id, details, created_at").in("job_id", noQuoteIds).eq("event_type", "installer_quote_held").order("created_at", { ascending: false })
    : { data: [] as { job_id: string | null; details: unknown }[], error: null };
  if (qhe) throw new WorkflowError("Quote hold could not be checked.");
  const latestHeld = new Map<string, unknown>();
  for (const h of heldRows ?? []) if (h.job_id && !latestHeld.has(h.job_id)) latestHeld.set(h.job_id, h.details); // newest first
  for (const id of ids) {
    const channel = channelOf.get(id) ?? null;
    const q = latestQuote.get(id) ?? null;
    if (!q) { out.set(id, heldNotOnboarded(latestHeld.get(id)) ? NOT_ONBOARDED_NO_QUOTE(channel, latestBasics.get(id)?.completed === true) : NONE(channel)); continue; }
    if (!isReadyCheckQuote(q.option_code, measurement.get(id) ?? null)) { out.set(id, NONE(channel)); continue; }
    const lines = [...(q.quote_items ?? [])].sort((a, b) => a.sort - b.sort);
    out.set(id, {
      applies: true, quote: { ...q, quote_items: lines }, channel,
      sent: !!q.sent_at, accepted: q.status === "accepted", declined: q.status === "declined", held: !q.sent_at && heldQuoteIds.has(q.id), electricianNotOnboarded: notOnboardedHold(q),
      formCompleted: latestBasics.get(id)?.completed === true,
    });
  }
  return out;
}

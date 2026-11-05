// Jo 24 Oct 2026: the latest Ready Check owner quote and its status for the installer (no approval step). Read-only;
// callers authorise first. Never sends to owners and never reads or writes the retired installer approval events.
import { jobAdmin as admin } from "./job-facts.server"; // speed (Task 11): the admin client; inside the job page bundle it answers from the job's rows
import { WorkflowError } from "./workflow.server";
import { isReadyCheckQuote, type InstallerQuoteFacts } from "./installer-quote-status.core";
import { isNotOnboardedReason } from "./rec-onboarded.core";

/** Decision 303: the hold reason on an unsent draft names an electrician who is not an approved REC yet. */
const notOnboardedHold = (q: { sent_at: string | null; status: string; release_hold_reason: string | null }) =>
  !q.sent_at && q.status === "draft" && (q.release_hold_reason ?? "").split(" · ").some((r) => isNotOnboardedReason(r));

const QUOTE_COLS = "id, job_id, status, sent_at, accepted_at, expired_at, release_state, release_hold_reason, option_code, created_at, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, quote_items(code, description, explanation, quantity, unit, unit_price_inc_gst, line_total_inc_gst, sort)";

export type InstallerQuote = InstallerQuoteFacts & { applies: boolean; quote: any | null; channel: string | null };

const NONE = (channel: string | null): InstallerQuote => ({ applies: false, quote: null, channel, sent: false, accepted: false, declined: false, held: false, formCompleted: false });

/** Latest Ready Check installation quote on the job (draft, sent, accepted or declined) and its plain status. */
export async function loadInstallerQuote(jobId: string): Promise<InstallerQuote> {
  const [{ data: job }, { data: qs, error }, { data: m }, { data: basics, error: be }] = await Promise.all([
    admin.from("jobs").select("channel").eq("id", jobId).maybeSingle(),
    admin.from("quotes").select(QUOTE_COLS).eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted", "declined", "expired"]).order("created_at", { ascending: false }).limit(1),
    admin.from("ceiling_measurements").select("external_source,external_id").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "ready_check_basics").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error || be) throw new WorkflowError("Quote could not be read.");
  const q = qs?.[0] ?? null;
  const channel = job?.channel ?? null;
  if (!q || !isReadyCheckQuote(q.option_code, m)) return NONE(channel);
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

const QUOTE_STATUSES = ["draft", "issued", "accepted", "declined", "expired"] as const;

/** Speed (decision 280): the same facts as `loadInstallerQuote`, for many jobs in five reads instead of five per job.
 *  Per job the result is identical: latest Ready Check installation quote, its plain status, hold and form completion. */
/** Speed (portal speed step 2B): reads the installer home already makes for the same jobs, handed in so they are not
 *  made twice. Each must be exactly the read it replaces (same columns, filters and order) for the same `jobIds`. */
export type SharedQuoteReads = {
  /** `jobs.channel` per job id (from rows already read). */
  channels?: Map<string, string | null>;
  /** `ceiling_measurements` (job_id, external_source, external_id), current rows for these jobs. */
  measurements?: PromiseLike<{ data: { job_id: string; external_source: string | null; external_id: string | null }[] | null }>;
  /** `workflow_events` ready_check_basics (job_id, details, created_at), newest first, for these jobs. */
  basics?: PromiseLike<{ data: { job_id: string | null; details: unknown; created_at: string }[] | null; error?: unknown }>;
};

export async function loadInstallerQuotes(jobIds: string[], shared?: SharedQuoteReads): Promise<Map<string, InstallerQuote>> {
  const out = new Map<string, InstallerQuote>();
  const ids = [...new Set(jobIds)];
  if (!ids.length) return out;
  // Speed (installer screens, Task 5): the hold events are read with the rest (for every job) and used only for the unsent
  // Ready Check quotes, as before — one round instead of two. A failed hold read still fails only when it is needed.
  const [{ data: jobs }, { data: qs, error }, { data: ms }, { data: basicsRows, error: be }, { data: holdRows, error: holdError }] = await Promise.all([
    shared?.channels ? Promise.resolve({ data: ids.map((id) => ({ id, channel: shared.channels!.get(id) ?? null })) }) : admin.from("jobs").select("id, channel").in("id", ids),
    admin.from("quotes").select(QUOTE_COLS).in("job_id", ids).eq("kind", "installation").in("status", QUOTE_STATUSES).order("created_at", { ascending: false }),
    shared?.measurements ?? admin.from("ceiling_measurements").select("job_id, external_source, external_id").in("job_id", ids).eq("is_current", true),
    shared?.basics ?? admin.from("workflow_events").select("job_id, details, created_at").in("job_id", ids).eq("event_type", "ready_check_basics").order("created_at", { ascending: false }),
    admin.from("workflow_events").select("job_id, details").in("job_id", ids).eq("event_type", "quote_auto_send_held"),
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
  const unsentSet = new Set(unsentJobIds);
  const holds = unsentJobIds.length ? (holdRows ?? []).filter((h) => h.job_id && unsentSet.has(h.job_id)) : [];
  if (unsentJobIds.length && holdError) throw new WorkflowError("Quote hold could not be checked.");
  const heldQuoteIds = new Set((holds ?? []).map((h) => String((h.details as { quote_id?: unknown } | null)?.quote_id ?? "")));
  for (const id of ids) {
    const channel = channelOf.get(id) ?? null;
    const q = latestQuote.get(id) ?? null;
    if (!q || !isReadyCheckQuote(q.option_code, measurement.get(id) ?? null)) { out.set(id, NONE(channel)); continue; }
    const lines = [...(q.quote_items ?? [])].sort((a, b) => a.sort - b.sort);
    out.set(id, {
      applies: true, quote: { ...q, quote_items: lines }, channel,
      sent: !!q.sent_at, accepted: q.status === "accepted", declined: q.status === "declined", held: !q.sent_at && heldQuoteIds.has(q.id), electricianNotOnboarded: notOnboardedHold(q),
      formCompleted: latestBasics.get(id)?.completed === true,
    });
  }
  return out;
}

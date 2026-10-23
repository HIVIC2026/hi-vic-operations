// Ready Check drafts stay private for Office review. No automatic approval, timer or delivery.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

const NEEDS_OFFICE = "ready_check_needs_office";

/** One item per distinct reason set: the same failure never floods the office list on every sync. */
export async function recordNeedsOffice(jobId: string, actorId: string | null, quoteId: string | null, reasons: string[]) {
  const { data: last } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", NEEDS_OFFICE)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prior = ((last?.details as { reasons?: string[] } | null)?.reasons ?? []).join(" | ");
  if (prior === reasons.join(" | ")) return;
  await logEvent(jobId, actorId, NEEDS_OFFICE, `Ready Check finished — the office must act before the owner quote: ${reasons.join("; ")}`,
    { quote_id: quoteId, reasons, needs_office: true }, { internal: true });
}

export type AutoQuoteResult = { action: "off" | "review" | "held" | "blocked"; reasons?: string[] };

/**
 * Called by the Mitti sync right after a completed Ready Check has drafted the installer's owner quote.
 * Checks the form's own answers (below R2, photos, life support, contact permission, price, electrician),
 * Legacy compatibility only: automatic queueing has been retired.
 */

/** A2 uses the existing owner-price builder for a draft only; no measurement acceptance or send. */
export async function draftHivReadyCheckQuote(jobId: string, actorId: string | null, auditId: string, modifiedAt: string | null, entries: { label: string; value: unknown }[]) {
  const [{ data: job, error: je }, { data: quotes, error: qe }, { data: last, error: le }] = await Promise.all([
    admin.from("jobs").select("channel, life_support_status, properties(enrichment)").eq("id", jobId).maybeSingle(),
    admin.from("quotes").select("id, status").eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_a2_quote_drafted").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (je || qe || le) throw new Error("Ready Check quote history could not be checked.");
  if (!job || job.channel === "installer_sourced" || quotes?.some(q => q.status !== "draft")) return;
  const ra = await import("./ready-check-answers.core");
  const prop = job.properties as { enrichment?: { base44?: { declared?: { over_five_years?: string } } } } | null;
  const stops = [...ra.readyCheckStopReasons(entries, { ownerAnsweredOnWebsite: true }), ...ra.websiteStopReasons({ lifeSupportStatus: job.life_support_status, overFiveYears: prop?.enrichment?.base44?.declared?.over_five_years ?? null })];
  if (stops.length) { await recordNeedsOffice(jobId, actorId, null, stops); return; }
  const prior = last?.details as { audit_id?: string; modified_at?: string | null } | null;
  if (quotes?.length && prior?.audit_id === auditId && prior.modified_at === modifiedAt) return;
  try {
    const ids = await (await import("./quotes.server")).generateInstallerQuotes(jobId, actorId, { mittiDraft: true });
    await logEvent(jobId, actorId, "mitti_a2_quote_drafted", "Ready Check owner quote drafted for office review", { audit_id: auditId, modified_at: modifiedAt, quote_ids: ids }, { internal: true });
  } catch (e) {
    await recordNeedsOffice(jobId, actorId, null, [e instanceof Error ? e.message : "Quote could not be drafted"]);
    throw e;
  }
}

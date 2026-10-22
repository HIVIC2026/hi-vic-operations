// Stage 6 (Jo 22 Oct 2026): when a Ready Check finishes cleanly, prepare the owner quote, then hold it for
// 15 minutes so the office can still stop it. OFF by default: workflow_settings.mitti_auto_quote_enabled
// (pending migration — the code fails closed while the column is missing, exactly like the auto-pickup switch).
// Nothing here sends anything: the only release path stays releaseQueuedQuotes(), which re-checks the launch
// switches, consent, intake readiness and electrical billing on every run.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { readyCheckFactsFromEntries, readyCheckCompletionChecks } from "./ready-check-complete.core";
import { armQuoteHold } from "./quote-hold.server";

const NEEDS_OFFICE = "ready_check_needs_office";

/** One item per distinct reason set: the same failure never floods the office list on every sync. */
async function recordNeedsOffice(jobId: string, actorId: string | null, quoteId: string | null, reasons: string[]) {
  const { data: last } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", NEEDS_OFFICE)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prior = ((last?.details as { reasons?: string[] } | null)?.reasons ?? []).join(" | ");
  if (prior === reasons.join(" | ")) return;
  await logEvent(jobId, actorId, NEEDS_OFFICE, `Ready Check finished — the office must act before the owner quote: ${reasons.join("; ")}`,
    { quote_id: quoteId, reasons, needs_office: true }, { internal: true });
}

/** Auto-send is OFF until Jo switches it on; an absent column or unreadable settings means OFF. */
async function autoQuoteEnabled(): Promise<boolean> {
  const { data } = await admin.from("workflow_settings").select("mitti_auto_quote_enabled").eq("id", 1).maybeSingle();
  return (data as { mitti_auto_quote_enabled?: boolean } | null)?.mitti_auto_quote_enabled === true;
}

export type AutoQuoteResult = { action: "off" | "review" | "held" | "blocked"; reasons?: string[] };

/**
 * Called by the Mitti sync right after a completed Ready Check has drafted the installer's owner quote.
 * Checks the form's own answers (below R2, photos, life support, contact permission, price, electrician),
 * then the same send guards the office button runs, then arms the 15-minute window.
 */
export async function maybeAutoQueueReadyCheckQuote(jobId: string, actorId: string | null, entries: { label: string; value: unknown }[], formComplete: boolean): Promise<AutoQuoteResult> {
  if (!(await autoQuoteEnabled())) return { action: "off" };
  const { data: job } = await admin.from("jobs").select("channel, electrician_choice, owner_id").eq("id", jobId).maybeSingle();
  if (!job || job.channel !== "installer_sourced") return { action: "off" };

  const { data: quote } = await admin.from("quotes").select("id, status, release_state, option_code")
    .eq("job_id", jobId).eq("kind", "installation").eq("option_code", "INSTALLER_A1").in("status", ["draft", "issued"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  const { quotedPriceFromEntries } = await import("./installer-led.core");
  const facts = readyCheckFactsFromEntries(entries, {
    formComplete,
    electricianDecided: job.electrician_choice === "installer_own" || job.electrician_choice === "hivic_organise",
    priceKnown: quotedPriceFromEntries(entries as never, null).ok,
  });
  const checks = readyCheckCompletionChecks(facts);
  if (!checks.ready) {
    await recordNeedsOffice(jobId, actorId, quote?.id ?? null, checks.reasons);
    return { action: "review", reasons: checks.reasons };
  }
  if (!quote || quote.status !== "draft" || quote.release_state !== "held") return { action: "review", reasons: ["No held installer quote to release"] };

  // The same guards the office "Send" button runs — the automatic path is never weaker than the manual one.
  const { intakeSendBlockers } = await import("./installer-intake.server");
  const blockers = await intakeSendBlockers(jobId).catch(() => ["Intake readiness could not be checked"]);
  const bb = await (await import("./installer-quote.server")).quoteBillingBlocker(quote.id).catch(() => "Electrical billing could not be checked");
  if (bb) blockers.push(bb);
  if (blockers.length) {
    await recordNeedsOffice(jobId, actorId, quote.id, blockers);
    return { action: "blocked", reasons: blockers };
  }

  const now = new Date().toISOString();
  const { data: armed } = await admin.from("quotes").update({ status: "issued", release_state: "queued", release_hold_reason: null, office_reviewed_at: now, office_reviewed_by: null })
    .eq("id", quote.id).eq("status", "draft").eq("release_state", "held").select("id").maybeSingle();
  if (!armed) return { action: "review", reasons: ["The quote changed during preparation — office review required"] };
  await armQuoteHold(jobId, actorId, quote.id, now);
  await logEvent(jobId, actorId, "installer_quote_queued", "Owner quote prepared automatically — held 15 minutes so the office can stop it",
    { quote_id: quote.id, auto: true }, { internal: true });
  return { action: "held" };
}

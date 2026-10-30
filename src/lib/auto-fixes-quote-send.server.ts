// Decision 354 (Jo 25 Oct 2026): the electrician-priced (A3) electrical fixes quote goes to the owner automatically
// when the A3 is complete and every existing check passes. Rules: auto-fixes-quote-send.core.ts. Delivery goes ONLY
// through the shared release (fixes-quote-release.server.ts `releaseFixesQuote`, the same path as the office Send
// button: same checks, same O29 owner email + link, TEST jobs → test-send). Idempotent: a quote is issued once (the
// status flips only from draft) and a held reason is recorded once per quote + reason.
// Triggers: the A3 sync when the form is Complete (mitti.server `syncMittiAssessment`), the electrician giving the fixes
// times (rectification.server `recordRectificationWindows`) and the 15-minute tick (`sweepAutoFixesQuotes`, catch-up).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { AUTO_FIXES_QUOTE_HELD_EVENT, AUTO_FIXES_QUOTE_SEND_ENABLED, AUTO_FIXES_STAGES, autoFixesSendDecision, type AutoFixesDecision } from "./auto-fixes-quote-send.core";

export type AutoFixesOutcome = { jobId: string; result: "sent" | "held" | "waiting" | "error"; reason: string | null; quoteId: string | null };

async function heldOnce(jobId: string, quoteId: string, reason: string) {
  const { count, error } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", AUTO_FIXES_QUOTE_HELD_EVENT).contains("details", { quote_id: quoteId, reason });
  if (error) throw new Error(`Could not read the fixes quote hold history: ${error.message}`);
  if (count) return;
  await logEvent(jobId, null, AUTO_FIXES_QUOTE_HELD_EVENT, `Electrical fixes quote not sent automatically: ${reason}`, { quote_id: quoteId, reason, needs_office: true, rule: "decision 354" }, { internal: true });
}

/**
 * One job. `generate`: when the A3 is Complete with the electrician's repair price and the job has no fixes quote yet,
 * prepare it first (generateRectificationQuote, A3-price path only — rate-card quotes stay with the office).
 * Never throws: a failure is returned as `error` (callers are best-effort).
 */
export async function maybeAutoSendFixesQuote(jobId: string, opts: { actorId?: string | null; generate?: boolean; enabled?: boolean } = {}): Promise<AutoFixesOutcome> {
  const enabled = opts.enabled ?? AUTO_FIXES_QUOTE_SEND_ENABLED;
  const out = (result: AutoFixesOutcome["result"], reason: string | null, quoteId: string | null): AutoFixesOutcome => ({ jobId, result, reason, quoteId });
  try {
    if (!enabled) return out("waiting", "switched off", null);
    const [{ data: job, error: je }, { data: a, error: ae }, { data: quotes, error: qe }] = await Promise.all([
      admin.from("jobs").select("source, stage, deleted_at").eq("id", jobId).maybeSingle(),
      admin.from("assessments").select("mitti_completed, mitti_raw_snapshot").eq("job_id", jobId).maybeSingle(),
      admin.from("quotes").select("id, job_id, kind, status, sent_at, office_reviewed_at, created_at, quote_internals(calc_snapshot)").eq("job_id", jobId).eq("kind", "rectification").neq("status", "superseded").order("created_at", { ascending: false }),
    ]);
    if (je || ae || qe) throw new Error((je ?? ae ?? qe)!.message);
    if (!job || job.deleted_at || !(AUTO_FIXES_STAGES as readonly string[]).includes(job.stage)) return out("waiting", "job not at a fixes-quote stage", null);
    const a4Completed = a?.mitti_completed === true;
    let quote = (quotes ?? [])[0] ?? null;
    if (!quote) {
      if (!opts.generate || !a4Completed) return out("waiting", "no fixes quote", null);
      const entries = Array.isArray(a?.mitti_raw_snapshot) ? (a!.mitti_raw_snapshot as { label: string; value: string | null }[]).filter((e) => e && typeof e.label === "string") : [];
      const { shortAnswersFromEntries } = await import("./official-short.core");
      const { fixesPriceSource } = await import("./fixes-price.core");
      if (fixesPriceSource(shortAnswersFromEntries("piesa", entries)).path !== "a4_price") return out("waiting", "no electrician repair price on the A3", null);
      const quoteId = await (await import("./quotes.server")).generateRectificationQuote(jobId, opts.actorId ?? null);
      if (typeof quoteId !== "string") return out("waiting", "in_house_partner_bills", null);
      const { data: fresh, error: fe } = await admin.from("quotes").select("id, job_id, kind, status, sent_at, office_reviewed_at, created_at, quote_internals(calc_snapshot)").eq("id", quoteId).maybeSingle();
      if (fe) throw new Error(fe.message);
      quote = fresh;
      if (!quote) return out("waiting", "no fixes quote", null);
    }
    const qi = quote.quote_internals as unknown as { calc_snapshot?: { pricing_source?: string } | null } | { calc_snapshot?: { pricing_source?: string } | null }[] | null;
    const snap = (Array.isArray(qi) ? qi[0] : qi)?.calc_snapshot ?? null;
    const { A4_FIXES_PRICING_SOURCE } = await import("./fixes-price.core");
    const isDraft = quote.status === "draft" && !quote.sent_at;
    const rel = await import("./fixes-quote-release.server");
    const sendBlocker = isDraft ? await rel.fixesQuoteSendBlocker(quote, "auto", { ignoreTimesHold: true }) : null;
    const waitingForTimes = isDraft ? !!(await (await import("./rectification.server")).fixesTimesHoldFor(jobId)) : false;
    const isTestJob = job.source === "qa_test";
    const commsEnabled = isTestJob || !isDraft ? true : await (await import("./comms.server")).customerCommsEnabled();
    const d: AutoFixesDecision = autoFixesSendDecision({ enabled, a4Completed, a4Priced: snap?.pricing_source === A4_FIXES_PRICING_SOURCE, quote, isTestJob, commsEnabled, sendBlocker, waitingForTimes });
    if (d.action === "wait") return out("waiting", d.reason, quote.id);
    if (d.action === "hold") { await heldOnce(jobId, quote.id, d.reason); return out("held", d.reason, quote.id); }
    try {
      await rel.releaseFixesQuote(quote.id, opts.actorId ?? null, "auto");
      return out("sent", null, quote.id);
    } catch (e) {
      const why = `Automatic send stopped: ${e instanceof Error ? e.message : "send failed"}`;
      await heldOnce(jobId, quote.id, why);
      return out("held", why, quote.id);
    }
  } catch (e) {
    console.error("automatic fixes quote send skipped", (e as Error).message);
    return out("error", (e as Error).message, null);
  }
}

/** 15-minute tick catch-up: every live job at a fixes-quote stage with a completed A3 (bounded, one job at a time). */
export async function sweepAutoFixesQuotes(limit = 100) {
  if (!AUTO_FIXES_QUOTE_SEND_ENABLED) return { checked: 0, sent: 0, held: 0, errors: 0 };
  const { data: jobs, error } = await admin.from("jobs").select("id").in("stage", [...AUTO_FIXES_STAGES]).is("deleted_at", null).is("qa_archived_at", null).order("updated_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Could not read jobs for the automatic fixes quote send: ${error.message}`);
  const ids = (jobs ?? []).map((j) => j.id);
  const { data: done, error: de } = ids.length ? await admin.from("assessments").select("job_id").in("job_id", ids).eq("mitti_completed", true) : { data: [] as { job_id: string }[], error: null };
  if (de) throw new Error(`Could not read the A3 forms for the automatic fixes quote send: ${de.message}`);
  const res = { checked: 0, sent: 0, held: 0, errors: 0 };
  for (const { job_id } of done ?? []) {
    const r = await maybeAutoSendFixesQuote(job_id, { actorId: null, generate: true });
    res.checked++;
    if (r.result === "sent") res.sent++; else if (r.result === "held") res.held++; else if (r.result === "error") res.errors++;
  }
  return res;
}

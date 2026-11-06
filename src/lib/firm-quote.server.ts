// Token-bound firm-quote reads/writes. Atomic writer stays pending; never delivers messages.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFirmQuoteJob, firmQuoteDueBy } from "./firm-quote.core";
import { hasOwnerMedia, type OwnerMediaDoc } from "./photo-quote.core";
import { isWellFormedToken, LINK_PURPOSE, linkUsable } from "./estimatelink.core";

export async function firmQuoteLiveAt(): Promise<string | null> {
  const { data, error } = await admin.from("workflow_settings").select("firm_quote_flow_live_at").limit(1).maybeSingle();
  if (error) {
    const missing = error.code === "42703" || error.code === "PGRST204";
    if (missing && /firm_quote_flow_live_at/.test(error.message)) return null;
    throw new Error("Could not read firm-quote activation.");
  }
  const value = (data as unknown as { firm_quote_flow_live_at?: unknown } | null)?.firm_quote_flow_live_at;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

export async function isFirmQuoteJobId(jobId: string): Promise<boolean> {
  const liveAt = await firmQuoteLiveAt();
  if (liveAt === null) return false;
  const { data: job, error } = await admin.from("jobs").select("source,created_at").eq("id", jobId).maybeSingle();
  if (error) throw new Error("Could not verify firm-quote job facts.");
  if (!job) return false;
  // Website and TEST jobs share the same activation/media rules; retain source for guarded TEST-inbox delivery.
  const facts = { source: job.source, createdAt: job.created_at, liveAt };
  if (!isFirmQuoteJob({ ...facts, hasMedia: true })) return false;
  const docs = await admin.from("documents").select("kind,mime_type,storage_path").eq("job_id", jobId).eq("kind", "intake_media");
  if (docs.error) throw new Error("Could not verify owner media for firm quote.");
  return isFirmQuoteJob({ ...facts, hasMedia: hasOwnerMedia(docs.data ?? []) });
}

/** Batched isFirmQuoteJobId over job rows and owner media the caller already read: ONE activation read and no per-job
 *  queries (switch off = nothing else checked). Same rules; `media` null means the caller's media read failed, which
 *  throws (fail closed) only when a job could be a firm-quote job. */
export async function firmQuoteJobIdsFrom(
  jobs: readonly { id: string; source: string | null; created_at: string }[],
  media: readonly (OwnerMediaDoc & { job_id: string })[] | null,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!jobs.length) return out;
  const liveAt = await firmQuoteLiveAt();
  if (liveAt === null) return out;
  const candidates = jobs.filter(j => isFirmQuoteJob({ source: j.source, createdAt: j.created_at, liveAt, hasMedia: true }));
  if (!candidates.length) return out;
  if (media === null) throw new Error("Could not verify owner media for firm quote.");
  const byJob = new Map<string, OwnerMediaDoc[]>();
  for (const m of media) byJob.set(m.job_id, [...(byJob.get(m.job_id) ?? []), m]);
  for (const j of candidates) if (hasOwnerMedia(byJob.get(j.id) ?? [])) out.add(j.id);
  return out;
}

/** Batched check for callers that only have job ids: the switch is read once (off = no other read), then jobs and owner
 *  media are read in paged id chunks and handed to firmQuoteJobIdsFrom. Any failed read throws (fail closed). */
export async function firmQuoteJobIdsFor(jobIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(jobIds)];
  if (!ids.length || (await firmQuoteLiveAt()) === null) return new Set();
  const paged = async <T>(read: (c: string[], a: number, b: number) => PromiseLike<{ data: unknown; error: unknown }>, c: string[]): Promise<T[]> => {
    const all: T[] = [];
    for (let a = 0; ; a += 200) {
      const r = await read(c, a, a + 199);
      if (r.error) throw new Error("Could not verify firm-quote job facts.");
      const page = (r.data ?? []) as T[];
      all.push(...page);
      if (page.length < 200) return all;
    }
  };
  const jobs: { id: string; source: string | null; created_at: string }[] = [];
  const media: (OwnerMediaDoc & { job_id: string })[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const c = ids.slice(i, i + 100);
    jobs.push(...await paged<{ id: string; source: string | null; created_at: string }>((cc, a, b) => admin.from("jobs").select("id,source,created_at").in("id", cc).order("id").range(a, b), c));
    media.push(...await paged<OwnerMediaDoc & { job_id: string }>((cc, a, b) => admin.from("documents").select("job_id,kind,mime_type,storage_path").in("job_id", cc).eq("kind", "intake_media").order("id").range(a, b), c));
  }
  return firmQuoteJobIdsFrom(jobs, media);
}

/** Shared fail-closed exclusion for spot messages; null preserves the existing delivery path. */
export async function skipSpotMessage(jobId: string): Promise<{ status: "skipped"; reason: "firm_quote_job" } | null> {
  return await isFirmQuoteJobId(jobId) ? { status: "skipped", reason: "firm_quote_job" } : null;
}

export type FirmQuoteRequestResult = { ok: true; dueBy: string; already: boolean } |
  { ok: false; reason: "closed" | "opted_out" | "quoted" | "not_firm_quote" };

/** Only the atomic RPC can write. No non-atomic fallback, inline intelligence or confirmation sender. */
export async function requestFirmQuote(jobId: string, linkId?: string, requestedAtIso = new Date().toISOString()): Promise<FirmQuoteRequestResult> {
  if (!await isFirmQuoteJobId(jobId)) return { ok: false, reason: "not_firm_quote" };
  if (!linkId) {
    const { data, error } = await admin.from("customer_estimate_links").select("id")
      .eq("job_id", jobId).eq("purpose", LINK_PURPOSE).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error("We couldn't check your request. Please try again.");
    if (!data) return { ok: false, reason: "not_firm_quote" };
    linkId = data.id;
  }
  const { data, error } = await (admin as SupabaseClient).rpc("request_firm_quote_atomic", {
    p_job: jobId, p_link: linkId, p_due_by: firmQuoteDueBy(requestedAtIso),
  });
  if (error) throw new Error("We couldn't save your request just now. Please try again.");
  const result = data as FirmQuoteRequestResult | null;
  if (result?.ok === true && /^\d{4}-\d{2}-\d{2}$/.test(result.dueBy) && typeof result.already === "boolean") return result;
  if (result?.ok === false && ["closed", "opted_out", "quoted", "not_firm_quote"].includes(result.reason)) return result;
  throw new Error("We couldn't confirm your request. Please try again.");
}

async function firmQuoteToken(token: unknown) {
  if (!isWellFormedToken(token)) return null;
  const { data: link, error } = await admin.from("customer_estimate_links").select("id,job_id,status,expires_at")
    .eq("token", token).eq("purpose", LINK_PURPOSE).maybeSingle();
  if (error) throw new Error("We couldn't check this link. Please try again.");
  if (!link || !linkUsable(link)) return null;
  // Missing activation column returns off before any private owner read or mutation.
  if (!await isFirmQuoteJobId(link.job_id)) return null;
  const { data: job, error: jobError } = await admin.from("jobs").select("source,stage,owners(full_name)").eq("id", link.job_id).maybeSingle();
  if (jobError) throw new Error("We couldn't check this request. Please try again.");
  if (!job) return null;
  const owner = job.owners as { full_name: string | null } | null;
  return { link, source: job.source, stage: (job as { stage?: string | null }).stage ?? null, firstName: owner?.full_name?.trim().split(/\s+/)[0] || null };
}

/** Recorded request due date (read-only), so "already asked" shows the same confirmation without another tap. */
async function recordedFirmQuoteDueBy(jobId: string): Promise<string | null> {
  const { data, error } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "firm_quote_requested")
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error("We couldn't check this request. Please try again.");
  const due = (data as { details?: { due_by?: unknown } } | null)?.details?.due_by;
  return typeof due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null;
}

/** Read-only arming of the one-tap page; crawlers/preloads never record a request. */
export async function firmQuoteRequestPage(token: unknown) {
  const c = await firmQuoteToken(token);
  if (!c || (c.stage && CLOSED_STAGES.includes(c.stage))) return { available: false as const, firstName: null, dueBy: null };
  return { available: true as const, firstName: c.firstName, dueBy: await recordedFirmQuoteDueBy(c.link.job_id) };
}

export async function requestFirmQuoteToken(token: unknown, preview: boolean) {
  const c = await firmQuoteToken(token);
  if (!c || (preview && c.source !== "qa_test")) return { ok: false as const, reason: "not_firm_quote" as const, firstName: null };
  const result = await requestFirmQuote(c.link.job_id, c.link.id);
  return { ...result, firstName: result.ok ? c.firstName : null };
}
/** Task 9: facts for the firm-quote-ready email. Owner m² from the intake (null if unknown), confirmed/removal m² from the
 *  current photo-quote measurement, removal rate from current pricing settings. Throws when any required fact is missing. */
export async function firmQuoteReadyFacts(jobId: string): Promise<{ ownerM2: number | null; confirmedM2: number; removalM2: number; removalRatePerM2: number }> {
  const [job, m, settings] = await Promise.all([
    admin.from("jobs").select("estimated_area_m2, estimated_area_unknown").eq("id", jobId).maybeSingle(),
    admin.from("ceiling_measurements").select("measured_area_m2, removal_m2").eq("job_id", jobId).eq("is_current", true).eq("external_source", "photo_quote").maybeSingle(),
    admin.from("retail_estimator_settings").select("removal_inc_gst_per_m2").eq("is_current", true).maybeSingle(),
  ]);
  if (job.error || !job.data) throw new Error("Firm quote: owner estimate could not be read.");
  if (m.error || !m.data) throw new Error("Firm quote: photo quote measurement not found.");
  const rate = (settings.data as { removal_inc_gst_per_m2?: unknown } | null)?.removal_inc_gst_per_m2;
  if (settings.error || typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) throw new Error("Firm quote: current removal pricing required.");
  const j = job.data as { estimated_area_m2: unknown; estimated_area_unknown: boolean | null };
  const owner = j.estimated_area_unknown ? null : Number(j.estimated_area_m2);
  const md = m.data as { measured_area_m2: unknown; removal_m2: unknown };
  const confirmed = Number(md.measured_area_m2);
  if (!Number.isFinite(confirmed) || confirmed <= 0) throw new Error("Firm quote: photo quote install m² missing.");
  const removal = Number(md.removal_m2 ?? 0);
  return { ownerM2: owner !== null && Number.isFinite(owner) && owner > 0 ? owner : null, confirmedM2: confirmed, removalM2: Number.isFinite(removal) && removal > 0 ? removal : 0, removalRatePerM2: rate };
}

// ---------- Task 10: day 4 "Your firm quote is on its way" email ----------
export type Day4Deps = {
  liveAt: () => Promise<string | null>;
  requests: () => Promise<{ job_id: string; created_at: string; due_by: string | null }[]>;
  isFirm: (jobId: string) => Promise<boolean>;
  job: (jobId: string) => Promise<{ closed: boolean; source: string | null; email: string | null; firstName: string | null } | null>;
  quoteSentAt: (jobId: string) => Promise<string | null>;
  day4SentAt: (jobId: string) => Promise<string | null>;
  commsOn: () => Promise<boolean>;
  consent: (jobId: string) => Promise<boolean>;
  send: (p: { jobId: string; jobSource: string | null; to: string; key: string; firstName: string; dueDate: string }) => Promise<string>;
  record: (jobId: string, dueBy: string) => Promise<void>;
};

const CLOSED_STAGES = ["cancelled", "complete", "on_hold"];

function realDay4Deps(): Day4Deps {
  return {
    liveAt: firmQuoteLiveAt,
    isFirm: isFirmQuoteJobId,
    async requests() {
      const { data, error } = await admin.from("workflow_events").select("job_id,created_at,details").eq("event_type", "firm_quote_requested").order("created_at").limit(500);
      if (error) throw new Error("Could not read firm quote requests.");
      return (data ?? []).filter(r => r.job_id).map(r => ({ job_id: r.job_id as string, created_at: r.created_at, due_by: ((r.details ?? {}) as { due_by?: unknown }).due_by as string ?? null }));
    },
    async job(jobId) {
      const { data, error } = await admin.from("jobs").select("stage,source,deleted_at,qa_archived_at,owners(email,full_name)").eq("id", jobId).maybeSingle();
      if (error) throw new Error("Could not read job.");
      if (!data) return null;
      const o = data.owners as { email: string | null; full_name: string | null } | null;
      return { closed: !!data.deleted_at || !!(data as { qa_archived_at?: string | null }).qa_archived_at || CLOSED_STAGES.includes(data.stage as string),
        source: data.source, email: o?.email ?? null, firstName: (o?.full_name ?? "").trim().split(/\s+/)[0] || null };
    },
    async quoteSentAt(jobId) {
      const { data, error } = await admin.from("customer_email_sends").select("sent_at,status").eq("job_id", jobId).eq("purpose", "quote_ready").in("status", ["sent", "sending", "delivered_unrecorded"]).limit(1).maybeSingle();
      if (error) throw new Error("Could not read quote email log.");
      return data ? (data.sent_at ?? "attempted") : null;
    },
    async day4SentAt(jobId) {
      const [ev, log] = await Promise.all([
        admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", "firm_quote_day4_sent").limit(1).maybeSingle(),
        admin.from("customer_email_sends").select("id").eq("idempotency_key", `firm-quote-day4:v1:${jobId}`).maybeSingle(),
      ]);
      if (ev.error || log.error) throw new Error("Could not read day 4 history.");
      return ev.data?.created_at ?? (log.data ? "attempted" : null);
    },
    async commsOn() {
      const { data, error } = await admin.from("workflow_settings").select("customer_comms_enabled").eq("id", 1).maybeSingle();
      return !error && (data as { customer_comms_enabled?: boolean } | null)?.customer_comms_enabled === true;
    },
    consent: async (jobId) => (await import("./comms.server")).hasCurrentOwnerContactConsent(jobId),
    async send(p) {
      const { firmQuoteOnItsWayEmail } = await import("./firm-quote-emails.core");
      const { withUnsubscribe } = await import("./emailsafety.core");
      return (await import("./owner-email-send.server")).sendGuardedOwnerEmail({
        jobId: p.jobId, jobSource: p.jobSource, to: p.to, purpose: "firm_quote_day4", key: p.key,
        build: (unsubscribe) => {
          const m0 = firmQuoteOnItsWayEmail({ firstName: p.firstName, dueDate: p.dueDate });
          const m = unsubscribe ? withUnsubscribe(m0, unsubscribe) : m0;
          return { subject: m.subject, html: m.html, text: m.plainText };
        },
      });
    },
    async record(jobId, dueBy) {
      const { FIRM_QUOTE_DAY4_EVENT } = await import("./firm-quote.core");
      const { error } = await admin.from("workflow_events").insert({ job_id: jobId, event_type: FIRM_QUOTE_DAY4_EVENT, summary: "Firm quote on its way email sent (day 4)", details: { due_by: dueBy }, internal: true });
      if (error) console.error("firm quote day 4 record failed", error.message);
    },
  };
}

/** Post-intake tick. Never throws per job; a switched-off flow reads nothing beyond the switch. */
export async function sweepFirmQuoteDay4(now = new Date(), deps: Day4Deps = realDay4Deps()) {
  const out: { jobId: string; status: string }[] = [];
  if (await deps.liveAt() === null) return { held: false, results: out };
  const { smsQuietReason } = await import("./quote-hold.core");
  if (smsQuietReason(now.toISOString())) return { held: true, results: out };
  if (!await deps.commsOn()) return { held: false, results: out };
  const { firmQuoteDay4Due } = await import("./firm-quote.core");
  const seen = new Set<string>();
  for (const r of await deps.requests()) {
    if (seen.has(r.job_id)) continue; seen.add(r.job_id);
    try {
      if (!r.due_by || !await deps.isFirm(r.job_id)) continue;
      const job = await deps.job(r.job_id);
      if (!job || !job.email || !job.firstName) continue;
      const due = firmQuoteDay4Due({ requestedAt: r.created_at, now, closed: job.closed, quoteSentAt: await deps.quoteSentAt(r.job_id), day4SentAt: await deps.day4SentAt(r.job_id) });
      if (!due) continue;
      if (!await deps.consent(r.job_id)) { out.push({ jobId: r.job_id, status: "no_consent" }); continue; }
      const status = await deps.send({ jobId: r.job_id, jobSource: job.source, to: job.email, key: `firm-quote-day4:v1:${r.job_id}`, firstName: job.firstName, dueDate: r.due_by });
      if (status === "sent") await deps.record(r.job_id, r.due_by);
      out.push({ jobId: r.job_id, status });
    } catch (e) { out.push({ jobId: r.job_id, status: `error: ${e instanceof Error ? e.message : "unknown"}` }); }
  }
  return { held: false, results: out };
}

// Token-bound firm-quote reads/writes. Atomic writer stays pending; never delivers messages.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFirmQuoteJob, firmQuoteDueBy } from "./firm-quote.core";
import { hasOwnerMedia } from "./photo-quote.core";
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
  if (!job || !isFirmQuoteJob({ source: job.source, createdAt: job.created_at, liveAt, hasMedia: true })) return false;
  const docs = await admin.from("documents").select("kind,mime_type,storage_path").eq("job_id", jobId).eq("kind", "intake_media");
  if (docs.error) throw new Error("Could not verify owner media for firm quote.");
  return isFirmQuoteJob({ source: job.source, createdAt: job.created_at, liveAt, hasMedia: hasOwnerMedia(docs.data ?? []) });
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
  const { data: job, error: jobError } = await admin.from("jobs").select("source,owners(full_name)").eq("id", link.job_id).maybeSingle();
  if (jobError) throw new Error("We couldn't check this request. Please try again.");
  if (!job) return null;
  const owner = job.owners as { full_name: string | null } | null;
  return { link, source: job.source, firstName: owner?.full_name?.trim().split(/\s+/)[0] || null };
}

/** Read-only arming of the one-tap page; crawlers/preloads never record a request. */
export async function firmQuoteRequestPage(token: unknown) {
  const c = await firmQuoteToken(token);
  return c ? { available: true as const, firstName: c.firstName } : { available: false as const, firstName: null };
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

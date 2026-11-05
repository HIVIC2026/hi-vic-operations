// Photo-quote installers Part 2 (Jo 5 Nov 2026): a "From photos" installer's OWN customer gets the photo quote on Add a job.
// Reads/writes behind own-photo-quote.core; the quote itself goes through the existing own-customer draft
// (installer-quote.server intake-price path) and the one guarded auto-send. No senders here.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { quoteMethodOf, isMissingQuoteMethodColumn, PHOTO_QUOTE_SUBMITTED_EVENT, sqm1, type QuoteMethod } from "./photo-quote.core";
import { OWN_PHOTO_QUOTE_WORDS, defaultPhotoTicks, ownPhotoPriceRecord, ownPhotoQuotePreview, ownPhotoQuoteProblems, type OwnPhotoPreview, type OwnPhotoQuoteInput } from "./own-photo-quote.core";
import type { InstallerPriceRecord } from "./installer-price.core";
import { insulationProduct } from "./insulation-product.core";
import { isUniqueViolation, stableUuid } from "./mitti-create-claim.core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

/** How the business quotes; a missing column (pending SQL) reads as Ready Check. A real read failure throws. */
export async function businessQuoteMethod(businessId: string, db: Db = admin as unknown as Db): Promise<QuoteMethod> {
  const r = await db.from("businesses").select("quote_method").eq("id", businessId).maybeSingle();
  if (r.error) { if (isMissingQuoteMethodColumn(r.error)) return "ready_check"; throw new Error("Couldn't check how this installer quotes."); }
  return quoteMethodOf(r.data as { quote_method?: string | null } | null);
}

/** The live quote box on Add a job. Price-seeing people of a From photos business only. */
export async function ownPhotoQuotePreviewFor(userId: string, i: { businessId: string; priceIncGst: number; installM2: number; removeM2: number | null; postcode: string; product: string | null; included?: string[] | null | undefined; includedOther?: string | null | undefined }): Promise<OwnPhotoPreview> {
  const c = await (await import("./trade-view.server")).pricesOrThrow(userId);
  if (c.biz.id !== i.businessId) throw new WorkflowError("You are not part of this business.");
  if ((await businessQuoteMethod(i.businessId)) !== "photos") throw new WorkflowError("This installer quotes from a Ready Check.");
  const m2 = sqm1(i.installM2);
  if (!(m2 && m2 > 0) || !(i.priceIncGst > 0)) return { held: "Enter the sqm and your price" };
  const [{ data: loc }, { data: rs }, piesa] = await Promise.all([
    admin.from("veu_location_variables").select("*").eq("postcode", i.postcode.trim()).maybeSingle(),
    admin.from("retail_estimator_settings").select("indicative_veec_value, minimum_customer_copayment_inc_gst").eq("is_current", true).maybeSingle(),
    (await import("./installer-paid-electricians.server")).installerSafetyCheckPrice(i.businessId),
  ]);
  const { wholeVeecDiscount } = await import("./estimate.core");
  const wholeVeec = loc && rs ? wholeVeecDiscount(m2, loc as never, Number(rs.indicative_veec_value)) : null;
  if (!wholeVeec) return { held: "Check the postcode — the rebate can't be worked out" };
  return ownPhotoQuotePreview({ underR2: true, priceIncGst: i.priceIncGst, installM2: m2, removeM2: i.removeM2, product: i.product, included: i.included ?? [], includedOther: i.includedOther ?? null, piesaIncGst: piesa,
    wholeVeec, metropolitan: (loc as { metropolitan_or_regional?: string }).metropolitan_or_regional === "Metropolitan", minCopay: rs ? Number(rs.minimum_customer_copayment_inc_gst) : 200 });
}

/** Refuses before any write: a photos business must send the photo quote fields and they must be right; a Ready Check
 *  business must not send them. */
export function ownPhotoQuoteGate(method: QuoteMethod, i: OwnPhotoQuoteInput | null | undefined): string[] {
  if (method !== "photos") return i ? ["This installer quotes from a Ready Check."] : [];
  if (!i) return ["Fill in the photo quote: existing insulation, sqm and your price."];
  return ownPhotoQuoteProblems(i);
}

type Logger = (jobId: string, actorId: string | null, type: string, summary: string, details?: Record<string, unknown>, opts?: { internal?: boolean }) => Promise<unknown>;
export type OwnPhotoDeps = {
  db: Db; logEvent: Logger;
  draft: (jobId: string, userId: string, ref: string, price: { totalIncGst: number; includes: string; areaM2: number; photo: { record: InstallerPriceRecord; product: string; removeM2: number } }) => Promise<unknown>;
  autoSend: (jobId: string, o: { formCompleted: true; formModifiedAt: string | null; entries: []; enabled?: boolean }) => Promise<{ sent: boolean; reasons: string[] }>;
  sendOnPress: boolean;
  getStage: (jobId: string) => Promise<string>;
  stageEntryBlockers: (jobId: string, to: "ready_check_complete") => Promise<string[]>;
  transition: (jobId: string, to: "ready_check_complete", actorId: string | null, summary: string, details?: Record<string, unknown>) => Promise<unknown>;
};
function ownPhotoDeps(): OwnPhotoDeps {
  return {
    db: admin as unknown as Db,
    logEvent: async (...a) => (await import("./workflow.server")).logEvent(...(a as Parameters<typeof import("./workflow.server").logEvent>)),
    draft: async (jobId, userId, ref, price) => (await import("./installer-quote.server")).draftInstallerQuoteFromReadyCheck(jobId, userId, [], ref, price),
    autoSend: async (jobId, o) => (await import("./auto-quote-send.server")).maybeAutoSendInstallerQuote(jobId, o),
    sendOnPress: false,
    getStage: async (jobId) => (await import("./workflow.server")).getStage(jobId),
    stageEntryBlockers: async (jobId, to) => (await import("./workflow.server")).stageEntryBlockers(jobId, to),
    transition: async (jobId, to, actorId, summary, details) => (await import("./workflow.server")).transition(jobId, to, actorId, summary, details ?? {}),
  };
}

export const OWN_PHOTO_REF = "photo:own";
export type OwnPhotoInputs = { underR2: true; removeM2: number; installM2: number; product: string; priceIncGst: number;
  /** Jo 5 Nov 16:44: the Your price card's ticks (canonical labels) and "Other" words. Claims before then have none. */ included?: string[]; includedOther?: string | null };
/** The stored form of the Add a job photo quote (what the claim row and the price record carry). */
export function ownPhotoInputs(i: OwnPhotoQuoteInput): OwnPhotoInputs {
  const product = insulationProduct(i.product);
  const installM2 = sqm1(i.installM2);
  if (!product || !(installM2 && installM2 > 0) || !(typeof i.priceIncGst === "number" && i.priceIncGst > 0)) throw new WorkflowError(ownPhotoQuoteProblems(i)[0] ?? "Fill in the photo quote.");
  const problems = ownPhotoQuoteProblems(i);
  if (problems.length) throw new WorkflowError(problems[0]!);
  const record = ownPhotoPriceRecord(i);
  return { underR2: true, removeM2: sqm1(i.removeM2) ?? 0, installM2, product: product.option, priceIncGst: Math.round(i.priceIncGst * 100) / 100, included: record.included, includedOther: record.included_other };
}
const sameInputs = (a: unknown, b: OwnPhotoInputs) => !!a && typeof a === "object" && (["removeM2", "installM2", "product", "priceIncGst"] as const).every((k) => (a as Record<string, unknown>)[k] === b[k])
  && JSON.stringify((a as OwnPhotoInputs).included ?? null) === JSON.stringify(b.included ?? null) && ((a as OwnPhotoInputs).includedOther ?? null) === (b.includedOther ?? null);

/** Fix round (review IMPORTANT 1b): the photo quote's claim row, written in the SAME request straight after the Add a job
 *  save, so a crash before the quote records still leaves the inputs for the 15-minute tick (`sweepOwnPhotoQuotes`).
 *  One row per job (stable id). A Try again with changed answers updates the row while no quote exists yet; once a quote
 *  exists it is refused with a plain line (the price can't silently differ from the quote). */
export async function claimOwnPhotoQuote(jobId: string, userId: string, businessId: string, i: OwnPhotoQuoteInput, db: Db = admin as unknown as Db): Promise<OwnPhotoInputs> {
  const inputs = ownPhotoInputs(i);
  const claimId = await stableUuid(`photo-quote:${jobId}:own`);
  const details = { own_customer: true, business_id: businessId, ref: OWN_PHOTO_REF, inputs };
  const summary = `Photo quote on Add a job: ${inputs.installM2} m² to install, ${inputs.removeM2} m² to remove, ${inputs.product}, $${inputs.priceIncGst}`;
  const read = async () => {
    const r = await db.from("workflow_events").select("id, details").eq("id", claimId).maybeSingle();
    if (r.error) throw new Error("Could not read the photo quote.");
    return r.data as { id: string; details: { inputs?: unknown } | null } | null;
  };
  let have = await read();
  if (!have) {
    const ins = await db.from("workflow_events").insert({ id: claimId, job_id: jobId, actor_id: userId, event_type: PHOTO_QUOTE_SUBMITTED_EVENT, internal: true, summary, details });
    if (!ins.error) return inputs;
    if (!isUniqueViolation(ins.error)) throw new Error(`The photo quote could not be saved: ${ins.error.message}`);
    have = await read();
  }
  if (!have || sameInputs(have.details?.inputs, inputs)) return inputs;
  const q = await db.from("quotes").select("id").eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]).limit(1);
  if (q.error) throw new Error("Could not check the job's quote.");
  if (((q.data ?? []) as unknown[]).length) throw new WorkflowError(OWN_PHOTO_QUOTE_WORDS.changedAfterQuote);
  const up = await db.from("workflow_events").update({ summary, details }).eq("id", claimId);
  if (up.error) throw new Error("The changed photo quote could not be saved.");
  return inputs;
}

/** After the Add a job save: the claim (see above), then the photo quote's measurement, product, eligibility and the
 *  boss's price (each written once per set of answers — a Try again resumes; changed answers before any quote replace
 *  them), then the own-customer draft and the one guarded release (send-on-press rule unchanged). */
export async function recordOwnPhotoQuote(jobId: string, userId: string, businessId: string, i: OwnPhotoQuoteInput, over: Partial<OwnPhotoDeps> = {}): Promise<{ sent: boolean; held: string[] }> {
  const d = await depsWith(over);
  const inputs = await claimOwnPhotoQuote(jobId, userId, businessId, i, d.db);
  return finishOwnPhotoQuote(jobId, userId, businessId, inputs, d);
}

async function depsWith(over: Partial<OwnPhotoDeps>): Promise<OwnPhotoDeps> {
  const { OWN_CUSTOMER_SEND_ON_PRESS_ENABLED } = await import("./auto-quote-send.core");
  return { ...ownPhotoDeps(), sendOnPress: OWN_CUSTOMER_SEND_ON_PRESS_ENABLED, ...over };
}

async function finishOwnPhotoQuote(jobId: string, userId: string, businessId: string, inputs: OwnPhotoInputs, d: OwnPhotoDeps): Promise<{ sent: boolean; held: string[] }> {
  const { removeM2, installM2, priceIncGst: price } = inputs;
  const product = insulationProduct(inputs.product)!;
  const cur = await d.db.from("ceiling_measurements").select("id,external_source,measured_area_m2,removal_m2").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  if (cur.error) throw new Error("Could not read the job's measurement.");
  const c = cur.data as { id: string; external_source?: string; measured_area_m2?: number | string | null; removal_m2?: number | string | null } | null;
  if (!(c?.external_source === "photo_quote" && Number(c.measured_area_m2) === installM2 && Number(c.removal_m2 ?? 0) === removeM2)) {
    if (c) await d.db.from("ceiling_measurements").update({ is_current: false }).eq("id", c.id).eq("is_current", true);
    const m = await d.db.from("ceiling_measurements").insert({ job_id: jobId, is_current: true, status: "complete", completed_at: new Date().toISOString(), completed_by: userId, created_by: userId,
      source_role: "installer", measured_by_business_id: businessId, external_source: "photo_quote", external_id: OWN_PHOTO_REF,
      measured_area_m2: installM2, removal_required: removeM2 > 0, removal_m2: removeM2, insulation_present: removeM2 > 0, access_difficulty: "easy", review_flags: [], raw_snapshot: { photo_quote: inputs } });
    if (m.error) throw new Error(`The photo quote measurement could not be saved: ${m.error.message}`);
  }
  const prior = await d.db.from("workflow_events").select("event_type, details, created_at").eq("job_id", jobId).in("event_type", ["mitti_product_recorded", "ready_check_form_eligible", "installer_price_set"]).contains("details", { source_ref: OWN_PHOTO_REF }).order("created_at", { ascending: true });
  if (prior.error) throw new Error("Could not read the photo quote records.");
  const rows = (prior.data ?? []) as { event_type: string; details: Record<string, unknown> | null }[];
  const latest = (type: string) => rows.filter((e) => e.event_type === type).at(-1)?.details ?? null;
  const lastProduct = latest("mitti_product_recorded") as { product?: { option?: string } } | null;
  if (lastProduct?.product?.option !== product.option) await d.logEvent(jobId, userId, "mitti_product_recorded", `Insulation product recorded from the photo quote (declared, not verified): ${product.option}`, { ready: true, product, source: "photo_quote", reasons: [], declared_not_verified: true, source_ref: OWN_PHOTO_REF }, { internal: true });
  if (!latest("ready_check_form_eligible")) await d.logEvent(jobId, userId, "ready_check_form_eligible", "Eligible from the installer's photo quote (existing insulation under R2)", { audit_id: OWN_PHOTO_REF, basis: "photo_quote", source_ref: OWN_PHOTO_REF, ruleset: "photo-quote-v1" }, { internal: true });
  // Review IMPORTANT 1d: a Try again with a changed price (allowed only before a quote exists) writes a new price record
  // (latest wins), so the price record and the quote never disagree.
  // Jo 5 Nov 16:44: the price record is built exactly as the "Your price" card builds it (validateInstallerPrice) from
  // the installer's own ticks; an old claim without ticks gets the base tick (+ removal when there is removal).
  const record = ownPhotoPriceRecord({ underR2: true, removeM2, installM2, product: product.option, priceIncGst: price, included: inputs.included ?? defaultPhotoTicks(removeM2), includedOther: inputs.includedOther ?? null });
  const lastPrice = latest("installer_price_set") as { photo_inputs?: unknown } | null;
  if (!lastPrice || !sameInputs(lastPrice.photo_inputs, inputs))
    await d.logEvent(jobId, userId, "installer_price_set", `Price set on Add a job (photo quote): $${price}`, { ...record, business_id: businessId, set_by: userId, declared_not_verified: true, source_ref: OWN_PHOTO_REF, photo_inputs: inputs }, { internal: true });
  // Like a completed Mitti Ready Check: the job moves to Ready Check complete (guarded), so the release can take it to the
  // quote stage. A refusal is held for the office; the quote is still drafted.
  if ((await d.getStage(jobId)) === "ready_check_ready_to_schedule") {
    const blockers = await d.stageEntryBlockers(jobId, "ready_check_complete");
    if (!blockers.length) await d.transition(jobId, "ready_check_complete", userId, "Photo quote added with the job (no Ready Check visit)", { basis: "photo_quote", ref: OWN_PHOTO_REF });
    else await d.logEvent(jobId, userId, "own_photo_quote_failed", `Photo quote saved but the job couldn't move on: ${blockers.join(" • ")}`.slice(0, 500), { needs_office: true, blockers }, { internal: true });
  }
  await d.draft(jobId, userId, OWN_PHOTO_REF, { totalIncGst: price, includes: record.included.join(", "), areaM2: installM2, photo: { record, product: product.option, removeM2 } });
  const r = await d.autoSend(jobId, { formCompleted: true, formModifiedAt: new Date().toISOString(), entries: [], ...(d.sendOnPress ? { enabled: true } : {}) });
  await markOwnPhotoQuoteFinished(jobId, d.db);
  return { sent: r.sent, held: r.reasons };
}

/** Re-review (5 Nov): once the draft and the release have run, the claim carries `finished_at`, so the tick never
 *  re-drafts it — whatever later happens to the quote (declined, expired, superseded). Best effort: a failed write is
 *  covered by the tick's own "any quote / drafted / held" check. */
async function markOwnPhotoQuoteFinished(jobId: string, db: Db): Promise<void> {
  const claimId = await stableUuid(`photo-quote:${jobId}:own`);
  const r = await db.from("workflow_events").select("details").eq("id", claimId).maybeSingle();
  if (r.error || !r.data) return;
  const details = (r.data as { details: Record<string, unknown> | null }).details ?? {};
  if (details["finished_at"]) return;
  const up = await db.from("workflow_events").update({ details: { ...details, finished_at: new Date().toISOString() } }).eq("id", claimId);
  if (up.error) console.error("own photo quote: finished marker not written", up.error.message);
}

export const OWN_PHOTO_SWEEP_MAX = 5;
/** Re-review (5 Nov): claims younger than this are left to the live Add a job request that wrote them. */
export const OWN_PHOTO_SWEEP_MIN_AGE_MS = 10 * 60_000;
/** Review IMPORTANT 1b: the 15-minute tick finishes every Add a job photo quote whose claim exists but whose photo
 *  measurement or quote never got written (a crash or failure after the save). Re-review (5 Nov): a claim is
 *  finished once it carries `finished_at`, or (older claims) the job has an installation quote in ANY status or an
 *  installer_quote_drafted / held event — so a declined, expired or superseded quote is never re-drafted; claims under
 *  10 minutes old are left to the live Add a job request. A failure is flagged to the office at most
 *  once a day per job. Never sends anything itself (the release is the existing guarded one). */
export async function sweepOwnPhotoQuotes(opts: { now?: Date } = {}, over: Partial<OwnPhotoDeps> = {}): Promise<{ checked: number; finished: string[]; failed: string[] }> {
  const d = await depsWith(over);
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const claims = await d.db.from("workflow_events").select("job_id, actor_id, details, created_at").eq("event_type", PHOTO_QUOTE_SUBMITTED_EVENT).contains("details", { own_customer: true }).gte("created_at", since).order("created_at", { ascending: true }).limit(500);
  if (claims.error) throw new Error("Own photo quote sweep could not read the photo quotes.");
  // Re-review: finished claims (marker) and claims under 10 minutes old are never touched.
  const list = ((claims.data ?? []) as { job_id: string; actor_id: string | null; created_at?: string | null; details: { business_id?: string; inputs?: OwnPhotoInputs; finished_at?: string } | null }[])
    .filter((c) => !c.details?.finished_at && !!c.created_at && now.getTime() - new Date(c.created_at).getTime() >= OWN_PHOTO_SWEEP_MIN_AGE_MS);
  const out = { checked: list.length, finished: [] as string[], failed: [] as string[] };
  if (!list.length) return out;
  const { chunkIds } = await import("./sweep-batch.core");
  const ids = [...new Set(list.map((c) => c.job_id))];
  const jobs: { id: string; stage: string | null; deleted_at: string | null; qa_archived_at: string | null }[] = [];
  const quoted = new Set<string>();
  const failures: { job_id: string; created_at: string | null }[] = [];
  for (const chunk of chunkIds(ids)) {
    const [j, q, e] = await Promise.all([
      d.db.from("jobs").select("id, stage, deleted_at, qa_archived_at").in("id", chunk),
      // Re-review: ANY installation quote, whatever its status, means the photo quote was made (older claims with no marker).
      d.db.from("quotes").select("job_id").in("job_id", chunk).eq("kind", "installation"),
      d.db.from("workflow_events").select("job_id, event_type, created_at").in("job_id", chunk).in("event_type", ["installer_quote_drafted", "installer_quote_held", "own_photo_quote_failed"]),
    ]);
    if (j.error || q.error || e.error) throw new Error("Own photo quote sweep could not read job facts.");
    jobs.push(...(j.data ?? []));
    for (const r of (q.data ?? []) as { job_id: string }[]) quoted.add(r.job_id);
    for (const r of (e.data ?? []) as { job_id: string; event_type: string; created_at: string | null }[]) {
      if (r.event_type === "own_photo_quote_failed") failures.push(r); else quoted.add(r.job_id);
    }
  }
  const { isClosedOrArchivedJob } = await import("./mitti.core");
  for (const c of list) {
    if (out.finished.length + out.failed.length >= OWN_PHOTO_SWEEP_MAX) break;
    const job = jobs.find((j) => j.id === c.job_id);
    if (!job || isClosedOrArchivedJob(job)) continue;
    if (quoted.has(c.job_id)) continue;
    const businessId = c.details?.business_id, inputs = c.details?.inputs;
    try {
      if (!businessId || !inputs || !c.actor_id) throw new Error("The photo quote's answers are missing.");
      await finishOwnPhotoQuote(c.job_id, c.actor_id, businessId, inputs, d);
      out.finished.push(c.job_id);
    } catch (e) {
      out.failed.push(c.job_id);
      const recent = failures.some((f) => f.job_id === c.job_id && (!f.created_at || now.getTime() - new Date(f.created_at).getTime() < 86_400_000));
      if (!recent) await d.logEvent(c.job_id, null, "own_photo_quote_failed", `Photo quote on Add a job not finished: ${(e as Error).message}`.slice(0, 500), { needs_office: true, from: "tick" }, { internal: true }).catch(console.error);
    }
  }
  return out;
}

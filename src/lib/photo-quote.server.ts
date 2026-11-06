// Photo-quote installers (Jo 5 Nov 2026): reads and the photo quote write behind the pure photo-quote.core rules. No senders here
// (the quote's own automatic send runs through auto-quote-send.server, as for a completed Mitti Ready Check).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { PHOTO_QUOTE_GIVE_EVENT, PHOTO_QUOTE_SUBMITTED_EVENT, PHOTO_QUOTE_WORDS, photoGiveFrom, photoQuoteProblems, sqm1, type GiveEventRow, type PhotoGive, type PhotoQuoteInput } from "./photo-quote.core";
import { insulationProduct } from "./insulation-product.core";
import { isUniqueViolation, stableUuid } from "./mitti-create-claim.core";

/** Same value as verified-eligibility.server FORM_ELIGIBLE_EVENT (kept literal so this module doesn't load that one). */
const FORM_ELIGIBLE = "ready_check_form_eligible";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

/** The job's current "From photos" give, or null (Ready Check / not given / handed back). A failed read throws. */
export async function photoGiveFor(jobId: string, db: Db = admin as unknown as Db): Promise<PhotoGive | null> {
  const [events, assignments] = await Promise.all([
    db.from("workflow_events").select("event_type,created_at,details").eq("job_id", jobId).in("event_type", ["in_house_batch_sent", PHOTO_QUOTE_GIVE_EVENT]).order("created_at"),
    db.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true),
  ]);
  if (events.error || assignments.error) throw new Error("Could not read how this job is quoted.");
  return photoGiveFrom((events.data ?? []) as GiveEventRow[], ((assignments.data ?? []) as { business_id: string }[]).map((a) => a.business_id));
}

// ---------------------------------------------------------------- Task 5: the installer sends the photo quote

export type SubmitPhotoQuoteResult = { ok: true; sent: boolean; held: string[] } | { ok: false; message: string };
type Logger = (jobId: string, actorId: string | null, type: string, summary: string, details?: Record<string, unknown>, opts?: { internal?: boolean }) => Promise<unknown>;
export type PhotoQuoteDeps = {
  db: Db;
  /** Throws when the user can't act on this job for its business (trade access check). Returns the user's business id. */
  access: (jobId: string, userId: string) => Promise<string>;
  photoGive: (jobId: string) => Promise<PhotoGive | null>;
  logEvent: Logger;
  getStage: (jobId: string) => Promise<string>;
  stageEntryBlockers: (jobId: string, to: "ready_check_complete" | "measured_estimate_ready") => Promise<string[]>;
  transition: (jobId: string, to: "ready_check_complete" | "measured_estimate_ready", actorId: string | null, summary: string, details?: Record<string, unknown>) => Promise<unknown>;
  ensureForms: (jobId: string, actorId: string | null) => Promise<unknown>;
  generateQuotes: (jobId: string, actorId: string | null) => Promise<unknown>;
  autoSend: (jobId: string, o: { formCompleted: true; formModifiedAt: string | null; entries: [] }) => Promise<{ sent: boolean; reasons: string[] }>;
  held: (jobId: string, key: string, reasons: string[]) => Promise<unknown>;
  now: () => Date;
};
function photoQuoteDeps(): PhotoQuoteDeps {
  const wf = () => import("./workflow.server");
  return {
    db: admin as unknown as Db,
    access: async (jobId, userId) => (await (await import("./trade-view.server")).requireTradeJob(userId, jobId)).biz.id,
    photoGive: (jobId) => photoGiveFor(jobId),
    logEvent: async (...a) => (await wf()).logEvent(...(a as Parameters<Awaited<ReturnType<typeof wf>>["logEvent"]>)),
    getStage: async (jobId) => (await wf()).getStage(jobId),
    stageEntryBlockers: async (jobId, to) => (await wf()).stageEntryBlockers(jobId, to),
    transition: async (jobId, to, actorId, summary, details) => (await wf()).transition(jobId, to, actorId, summary, details as never),
    ensureForms: async (jobId, actorId) => (await import("./in-house-forms.server")).ensurePhotoJobForms(jobId, actorId),
    generateQuotes: async (jobId, actorId) => (await import("./quotes.server")).generateInstallerQuotes(jobId, actorId, { mittiDraft: true }),
    autoSend: async (jobId, o) => (await import("./auto-quote-send.server")).maybeAutoSendInstallerQuote(jobId, o),
    held: async (jobId, key, reasons) => (await import("./auto-quote-send.server")).held(jobId, key, reasons),
    now: () => new Date(),
  };
}

/** The recorded inputs, normalised (sqm to 1 decimal place, product as its approved label). */
function recordedInputs(i: PhotoQuoteInput) {
  return { underR2: i.underR2 === true, removeM2: sqm1(i.removeM2) ?? 0, installM2: sqm1(i.installM2) ?? 0, product: insulationProduct(i.product)?.option ?? null };
}
const sameInputs = (a: unknown, b: ReturnType<typeof recordedInputs>) => JSON.stringify(a) === JSON.stringify(b);
export const photoQuoteRef = (give: PhotoGive) => `photo:${give.batchId}`;
const INSTALL_QUOTE_STATES = ["draft", "issued", "accepted"];

async function installQuoteExists(db: Db, jobId: string): Promise<boolean> {
  const r = await db.from("quotes").select("id").eq("job_id", jobId).eq("kind", "installation").in("status", INSTALL_QUOTE_STATES).limit(1);
  if (r.error) throw new Error("Could not check the job's quotes.");
  return ((r.data ?? []) as unknown[]).length > 0;
}

/** Spec decisions 4/7: the installer's photo quote writes the SAME records a completed Mitti Ready Check writes, then the
 *  normal quote builder and automatic send run. Once per give (a repeat with the same answers changes nothing). */
export async function submitPhotoQuote(jobId: string, userId: string, i: PhotoQuoteInput, over: Partial<PhotoQuoteDeps> = {}): Promise<SubmitPhotoQuoteResult> {
  const d = { ...photoQuoteDeps(), ...over };
  let business: string;
  try { business = await d.access(jobId, userId); } catch { return { ok: false, message: "This job isn't assigned to you." }; }
  const give = await d.photoGive(jobId);
  if (!give || give.businessId !== business) return { ok: false, message: "This job isn't quoted from photos." };
  const problems = photoQuoteProblems(i);
  if (problems.length) return { ok: false, message: problems.join(" • ") };
  const inputs = recordedInputs(i);
  const ref = photoQuoteRef(give);
  const claimId = await stableUuid(`photo-quote:${jobId}:${give.batchId}`);

  const readClaim = async () => {
    const r = await d.db.from("workflow_events").select("id,details,created_at").eq("id", claimId).maybeSingle();
    if (r.error) throw new Error("Could not check the photo quote.");
    return r.data as { details: { inputs?: unknown } | null; created_at: string } | null;
  };
  const refuseOrResume = async (c: { details: { inputs?: unknown } | null }) => {
    if (sameInputs(c.details?.inputs, inputs)) return null; // a repeat: finish anything left, add nothing
    return { ok: false as const, message: await installQuoteExists(d.db, jobId) ? PHOTO_QUOTE_WORDS.quoteGone : PHOTO_QUOTE_WORDS.alreadySent };
  };

  let claim = await readClaim();
  if (claim) { const stop = await refuseOrResume(claim); if (stop) return stop; }
  else {
    if ((await d.getStage(jobId)) !== "ready_check_ready_to_schedule") return { ok: false, message: PHOTO_QUOTE_WORDS.notReady };
    // The claim (one per job + give) is written first, so two taps or two tabs make one measurement and one quote.
    const ins = await d.db.from("workflow_events").insert({ id: claimId, job_id: jobId, actor_id: userId, event_type: PHOTO_QUOTE_SUBMITTED_EVENT, internal: true,
      summary: `Photo quote sent for quote: ${inputs.installM2} m² to install, ${inputs.removeM2} m² to remove, ${inputs.product}`, details: { batch_id: give.batchId, business_id: give.businessId, ref, inputs } });
    if (ins.error) {
      if (!isUniqueViolation(ins.error)) throw new Error(`The photo quote could not be saved: ${ins.error.message}`);
      claim = await readClaim();
      const stop = claim ? await refuseOrResume(claim) : { ok: false as const, message: "Try again." };
      if (stop) return stop;
    }
    claim = claim ?? { details: { inputs }, created_at: d.now().toISOString() };
  }
  const at = claim.created_at;

  // 1. Measurement: one current complete row from the photo quote (the job's earlier current row is kept as history).
  const cur = await d.db.from("ceiling_measurements").select("id,external_source,external_id").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  if (cur.error) throw new Error("Could not read the job's measurement.");
  const current = cur.data as { id: string; external_source: string | null; external_id: string | null } | null;
  if (!(current?.external_source === "photo_quote" && current.external_id === ref)) {
    if (current) {
      const u = await d.db.from("ceiling_measurements").update({ is_current: false }).eq("id", current.id).eq("is_current", true);
      if (u.error) throw new Error(`The earlier measurement could not be kept as history: ${u.error.message}`);
    }
    const m = await d.db.from("ceiling_measurements").insert({ job_id: jobId, is_current: true, status: "complete", completed_at: d.now().toISOString(), completed_by: userId, created_by: userId,
      source_role: "installer", measured_by_business_id: give.businessId, external_source: "photo_quote", external_id: ref,
      measured_area_m2: inputs.installM2, removal_required: inputs.removeM2 > 0, removal_m2: inputs.removeM2, insulation_present: inputs.removeM2 > 0,
      access_difficulty: "easy", review_flags: [], raw_snapshot: { photo_quote: inputs, batch_id: give.batchId } });
    if (m.error) throw new Error(`The photo quote measurement could not be saved: ${m.error.message}`);
    await d.logEvent(jobId, userId, "measurement_completed", `Photo quote — measurements recorded (${inputs.installM2} m²)`, { basis: "photo_quote", ref }, { internal: true });
  }
  // 2. Product + eligibility, as a completed Ready Check records them (once each).
  const prior = await d.db.from("workflow_events").select("event_type,details").eq("job_id", jobId).in("event_type", ["mitti_product_recorded", FORM_ELIGIBLE]).contains("details", { source_ref: ref });
  if (prior.error) throw new Error("Could not read the photo quote records.");
  const have = new Set(((prior.data ?? []) as { event_type: string }[]).map((e) => e.event_type));
  const product = insulationProduct(inputs.product)!;
  if (!have.has("mitti_product_recorded"))
    await d.logEvent(jobId, userId, "mitti_product_recorded", `Insulation product recorded from the photo quote (declared, not verified): ${product.option}`, { ready: true, product, source: "photo_quote", reasons: [], declared_not_verified: true, source_ref: ref }, { internal: true });
  if (!have.has(FORM_ELIGIBLE))
    await d.logEvent(jobId, userId, FORM_ELIGIBLE, "Eligible from the installer's photo quote (existing insulation under R2)", { audit_id: ref, basis: "photo_quote", source_ref: ref, ruleset: "photo-quote-v1" }, { internal: true });

  // 3. Stage: to the quote stage (guarded; a refusal is held for the office, the measurement stays).
  for (const to of ["ready_check_complete", "measured_estimate_ready"] as const) {
    const stage = await d.getStage(jobId);
    if (stage === to || (to === "ready_check_complete" && stage !== "ready_check_ready_to_schedule")) continue;
    if (to === "measured_estimate_ready" && stage !== "ready_check_complete") continue;
    const blockers = await d.stageEntryBlockers(jobId, to);
    if (blockers.length) { await d.held(jobId, `photo:${ref}:stage:${to}:${blockers.join("|")}`, blockers); return { ok: false, message: blockers.join(" • ") }; }
    await d.transition(jobId, to, userId, to === "ready_check_complete" ? "Photo quote sent by the installer" : "Quote stage: photo quote in and eligible", { basis: "photo_quote", ref });
  }
  // 4. PIESA + upgrades forms (never blocks the quote).
  try { await d.ensureForms(jobId, userId); }
  catch (e) { await d.logEvent(jobId, userId, "in_house_form_sync_failed", `PIESA/upgrades forms not made after the photo quote: ${e instanceof Error ? e.message : "error"}`.slice(0, 500), { reason: e instanceof Error ? e.message : "error", needs_office: true }, { internal: true }).catch(() => undefined); }
  // 5. The owner's quote through the normal builder and automatic send.
  if (!(await installQuoteExists(d.db, jobId))) await d.generateQuotes(jobId, userId);
  const r = await d.autoSend(jobId, { formCompleted: true, formModifiedAt: at, entries: [] });
  return { ok: true, sent: r.sent, held: r.reasons };
}

/** "Can't do this one" on a photo job is refused once its quote exists (the sent quote stands). Null = allowed. */
export async function photoQuoteHandBackBlocker(jobId: string, db: Db = admin as unknown as Db): Promise<string | null> {
  const give = await photoGiveFor(jobId, db);
  if (!give) return null;
  return await installQuoteExists(db, jobId) ? PHOTO_QUOTE_WORDS.quoteGone : null;
}

// ---------------------------------------------------------------- Task 6: what the installer sees to quote from

export type PhotoQuoteMedia = { media: { id: string; kind: "photo" | "video"; url: string; name: string }[]; ownerSaid: [string, string | null][] };
/** The owner's photos/videos (1-hour app links, never storage-domain links) and what the owner told us on the website — the
 *  same rows as the Give email. No prices, no quote, nothing else. The caller has already checked the trade's access. */
export async function photoQuoteMediaFor(jobId: string, db: Db = admin as unknown as Db, sign?: (path: string) => Promise<string | null>): Promise<PhotoQuoteMedia> {
  const signer = sign ?? (async (path: string) => (await (await import("./file-links.server")).signFile("job-files", path, 3600)).data?.signedUrl ?? null);
  const [docs, job, saved] = await Promise.all([
    db.from("documents").select("id, kind, mime_type, storage_path, title, created_at").eq("job_id", jobId).eq("kind", "intake_media").order("created_at"),
    db.from("jobs").select("id, estimated_area_m2, properties(enrichment)").eq("id", jobId).maybeSingle(),
    db.from("lead_campaign_responses").select("saved_insulation").eq("job_id", jobId).limit(1),
  ]);
  if (docs.error) throw new Error("Could not read the owner's photos.");
  const { mediaType } = await import("./group-b-media.core");
  const media: PhotoQuoteMedia["media"] = [];
  for (const d of (docs.data ?? []) as { id: string; mime_type: string | null; storage_path: string | null; title: string | null }[]) {
    if (!d.storage_path || !mediaType(d.mime_type, d.storage_path)) continue;
    const url = await signer(d.storage_path);
    if (!url) continue;
    const video = /^video\//i.test(d.mime_type ?? "") || /\.(mp4|mov|webm|m4v)$/i.test(d.storage_path);
    media.push({ id: d.id, kind: video ? "video" : "photo", url, name: d.title?.trim() || d.storage_path.split("/").pop() || "file" });
  }
  let ownerSaid: [string, string | null][] = [];
  try {
    const r = job.data as { estimated_area_m2: number | string | null; properties: { enrichment: Record<string, unknown> | null } | { enrichment: Record<string, unknown> | null }[] | null } | null;
    const prop = Array.isArray(r?.properties) ? r?.properties[0] : r?.properties;
    const b44 = (prop?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> }; declared?: Record<string, unknown> };
    const savedIns = ((saved.data ?? []) as { saved_insulation: string | null }[])[0]?.saved_insulation ?? null;
    ownerSaid = (await import("./owner-said.core")).ownerSaidRows({ answers: b44.raw?.answers ?? null, declared: b44.declared ?? null, savedInsulation: savedIns, estimatedAreaM2: r?.estimated_area_m2 ?? null });
  } catch (e) { console.error("Photo quote: owner-said rows skipped", e instanceof Error ? e.message : "error"); }
  return { media, ownerSaid };
}

/** Firm quote Task 8: the read-only size check for a photo job (owner's intake estimate, the CURRENT Google Solar footprint
 *  row, the newest stored floor plan). Callers only reach this for photo jobs. Never a price. */
export async function photoSizeCheckFor(jobId: string, db: Db = admin as unknown as Db, sign?: (path: string) => Promise<string | null>): Promise<import("./photo-quote-size-check.core").SizeCheck> {
  const signer = sign ?? (async (path: string) => (await (await import("./file-links.server")).signFile("job-files", path, 3600)).data?.signedUrl ?? null);
  const { sizeCheckFrom, SOLAR_FOOTPRINT_METHOD } = await import("./photo-quote-size-check.core");
  const [job, areas, plans] = await Promise.all([
    db.from("jobs").select("estimated_area_m2").eq("id", jobId).maybeSingle(),
    db.from("property_area_estimates").select("method, net_m2, is_current").eq("job_id", jobId).eq("is_current", true).eq("method", SOLAR_FOOTPRINT_METHOD),
    db.from("property_floorplans").select("storage_path, storage_policy, retrieved_at").eq("job_id", jobId).order("retrieved_at", { ascending: false }),
  ]);
  const plan = ((plans.data ?? []) as { storage_path: string | null; storage_policy: string }[]).find((p) => p.storage_path && p.storage_policy === "store_permitted");
  let floorplanUrl: string | null = null;
  if (plan?.storage_path) { try { floorplanUrl = await signer(plan.storage_path); } catch { floorplanUrl = null; } }
  return sizeCheckFrom({ ownerEstimate: (job.data as { estimated_area_m2?: unknown } | null)?.estimated_area_m2 ?? null, areaRows: (areas.data ?? []) as never, floorplanUrl });
}

/** A photo job, for owner wording: given From photos (`fromPhotos`, an HIV lead whose owner sent photos) or a From photos
 *  installer's OWN customer (the Add a job photo quote claim; `fromPhotos` false — that owner sent no photos). Null = a
 *  Ready Check job. `installer` = the name the owner sees. Throws on a failed read. */
export async function photoQuoteJobFor(jobId: string, db: Db = admin as unknown as Db): Promise<{ installer: string; fromPhotos: boolean } | null> {
  const give = await photoGiveFor(jobId, db);
  let fromPhotos = !!give;
  if (!give) {
    const own = await db.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", PHOTO_QUOTE_SUBMITTED_EVENT).contains("details", { own_customer: true }).limit(1);
    if (own.error) throw new Error("Could not read how this job is quoted.");
    if (!((own.data ?? []) as unknown[]).length) return null;
    fromPhotos = false;
  }
  const c = await (await import("./owner-contact.server")).businessContactForJob(jobId, "installer");
  const { displayName } = await import("./display-name.core");
  return { installer: displayName(c?.tradingName || c?.name || null) || "your installer", fromPhotos };
}

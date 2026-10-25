import { exactLike } from "./email-match";
import { enqueueInitialGate1, processPostIntakeWork } from "./postintake.server";
import { eligibilityFactsVersion } from "./postintake.core";
import { runAfterResponse } from "./background.server";
import { addressHash } from "./intelligence.core";
import { z } from "zod";
import type { Json, TablesUpdate } from "@/integrations/supabase/types";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { buildBase44Evidence, buildBase44Raw, retainOriginalMedia, normaliseState, planBase44Job, properAddress, properName } from "./enquiry.core";
import { recordContactConsent, importBase44Media } from "./intake.server";

/** A JSON object snapshot capped at 60KB serialised. */
const boundedJson = z.record(z.string(), z.unknown()).refine((o) => JSON.stringify(o).length <= 60_000, "snapshot too large");

export const enquirySchema = z.object({
  external_enquiry_id: z.string().min(1).max(100).optional(),
  full_name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(40).optional().nullable(),
  address_line: z.string().trim().min(3).max(300),
  suburb: z.string().trim().max(100).optional().nullable(),
  postcode: z.string().trim().max(10).optional().nullable(),
  occupancy: z.enum(["owner_occupied", "rental"]).optional().nullable(),
  // Signed Base44 intake still requires a numeric ceiling area. Authenticated manual (portal) intake
  // may record an unknown size as null + area_unknown true; the per-source rule lives in intakeJobFacts.
  estimated_area_m2: z.number({ required_error: "estimated_area_m2 is required" }).finite().positive().max(5000).nullable(),
  area_unknown: z.boolean().optional(),
  life_support: z.boolean().optional(),
  // Base44 preliminary eligibility (website result only; admin still confirms)
  eligibility_outcome: z.enum(["likely_eligible", "needs_onsite_confirmation", "does_not_appear_eligible"]).optional().nullable(),
  eligibility_reason: z.string().trim().max(2000).optional().nullable(),
  source_reference: z.string().trim().max(100).optional().nullable(),
  life_support_status: z.enum(["yes", "no", "unknown"]).optional().nullable(),
  preliminary_outcome: z.enum(["likely_eligible", "needs_onsite_confirmation", "does_not_appear_eligible"]).optional().nullable(),
  preliminary_reasons: z.array(z.string().max(500)).max(20).optional().nullable(),
  // Gate 1 evidence (Base44). Declarations stay declared; research is kept with its own status/provenance.
  declared_property_type: z.string().trim().max(60).optional().nullable(),
  declared_over_five_years: z.enum(["yes", "no", "unknown"]).optional().nullable(),
  declared_previous_upgrade: z.enum(["yes", "no", "unknown"]).optional().nullable(),
  property_research: z.object({
    status: z.string().trim().max(40).optional().nullable(),
    evidence_summary: z.string().trim().max(2000).optional().nullable(),
    formatted_address: z.string().trim().max(300).optional().nullable(),
    state: z.string().trim().max(10).optional().nullable(),
    postcode: z.string().trim().max(10).optional().nullable(),
    premises_classification: z.string().trim().max(100).optional().nullable(),
    first_appearance_year: z.number().int().min(1800).max(2100).optional().nullable(),
    age_evidence_source: z.string().trim().max(300).optional().nullable(),
    flat_roof_detected: z.boolean().optional().nullable(),
    access_concern_detected: z.boolean().optional().nullable(),
    verified_floor_plan_url: z.string().trim().url().max(1000).refine((u) => u.startsWith("https://"), "https only").optional().nullable(),
  }).optional().nullable(),
  // Full Base44 handoff (0028). Snapshots are bounded JSON objects; declarations stay declared.
  state: z.string().trim().max(10).optional().nullable(),
  contact_consent: z.boolean().optional().nullable(),
  contact_consent_version: z.string().trim().max(60).optional().nullable(),
  contact_consented_at: z.string().datetime({ offset: true }).optional().nullable(),
  age_confirmed: z.boolean().optional().nullable(),
  assistance: z.enum(["none", "interpreter", "contract_support", "both"]).optional().nullable(),
  contact_preference: z.string().trim().max(60).optional().nullable(),
  base44_answers: boundedJson.optional().nullable(),
  base44_screening: boundedJson.optional().nullable(),
  base44_ai_observations: boundedJson.optional().nullable(),
  property_research_raw: boundedJson.optional().nullable(),
  media: z.array(z.object({
    source_id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(300),
    mime_type: z.string().trim().max(100),
    signed_url: z.string().trim().url().max(4000).refine((u) => u.startsWith("https://"), "https only"),
  })).max(10).optional().nullable(),
  media_manifest_complete: z.boolean().optional().nullable(),
});
export type EnquiryInput = z.infer<typeof enquirySchema>;

/** Jo 23 Oct 2026: a website enquiry whose ONLY problem is a mistyped email is kept (not lost) when it has a phone number.
 *  Returns the typed email text when that is the case, otherwise null (normal rejection stands). */
export function mistypedEmailOnly(json: unknown, error: z.ZodError): string | null {
  if (!error.issues.length || !error.issues.every((i) => i.path.length === 1 && i.path[0] === "email")) return null;
  const o = (json && typeof json === "object" ? json : {}) as { email?: unknown; phone?: unknown };
  if (typeof o.phone !== "string" || !o.phone.trim()) return null;
  return typeof o.email === "string" ? o.email.trim().slice(0, 255) : "";
}
export const enquiryWithoutEmailSchema = enquirySchema.extend({ email: z.unknown().transform(() => null) });

/** Create/update owner, property and job from an enquiry. Idempotent on external_enquiry_id. */
export type JobOrigin = { channel: "hivic_sourced" } | { channel: "installer_sourced"; businessId: string; userId: string };


/** Step 1 intake → durable enqueue. Initial Property Intelligence + first official Gate 1 run in the post-intake processor. */
/** Installer Add job may register a job BEFORE any measure-up (area null). Every other origin still needs an area. */
/** Pure intake fact guards (Jo, 22 Oct 2026): only authenticated manual (portal) intake may record an
 *  unknown ceiling size (null + area_unknown) or an unknown life-support status. Signed Base44 intake
 *  keeps its locked numeric-area invariant, and no origin ever fabricates a fact or its provenance. */
export function intakeJobFacts(input: { estimated_area_m2: number | null | undefined; area_unknown?: boolean | undefined; life_support?: boolean | undefined; life_support_status?: string | null | undefined }, source: string, origin: JobOrigin, opts: { emailIntake?: boolean } = {}) {
  // Decision 255: an enquiry created from an owner's email (source 'email'; its TEST twin is qa_test) never knows the
  // ceiling size either, so it records it as unknown exactly like manual portal intake — never a made-up number.
  const unknownAllowed = source === "portal" || (opts.emailIntake === true && (source === "email" || source === "qa_test"));
  const manualUnknownArea = unknownAllowed && input.area_unknown === true;
  if (input.estimated_area_m2 == null && origin.channel !== "installer_sourced" && !manualUnknownArea) throw new Error("estimated_area_m2 is required");
  if (!unknownAllowed && input.area_unknown === true) throw new Error("Only manual portal intake may record an unknown ceiling area.");
  // jobs.life_support is the legacy boolean projection; the explicit truth carrier is life_support_status.
  // An unknown answer is stored as status 'unknown' (never invented as a verified 'no'), matching the
  // signed Base44 handling. Manual intake never sets a boolean true/false it was not told.
  return {
    estimated_area_m2: input.estimated_area_m2 ?? null,
    estimated_area_unknown: manualUnknownArea,
    life_support: input.life_support ?? false,
    life_support_status: input.life_support_status ?? (input.life_support === true ? "yes" : null),
  };
}

export async function upsertEnquiry(input: Omit<EnquiryInput, "estimated_area_m2" | "email"> & { estimated_area_m2: number | null; email: string | null }, source: string, actorId: string | null, origin: JobOrigin = { channel: "hivic_sourced" }, opts: { mistypedEmail?: string | undefined; emailIntake?: boolean } = {}) {
  const facts = intakeJobFacts(input, source, origin, { emailIntake: opts.emailIntake === true });
  // Email may be null only for Mitti pick-ups marked "Needs finishing" (Jo 22 Oct): a fresh owner row, never matched.
  // Also for a website enquiry whose email was mistyped (Jo 23 Oct): kept so the lead isn't lost; office fixes the email.
  const mistyped = source === "base44" && opts.mistypedEmail != null;
  if (input.email == null && !mistyped && source !== "installer_mitti" && !(source === "qa_test" && origin.channel === "installer_sourced")) throw new Error("Owner email is required.");
  const result = await upsertEnquiryInner(input, source, actorId, origin, facts);
  if (mistyped) await logEvent(result.job_id, actorId, MISTYPED_EMAIL_EVENT, `Website email looked wrong ("${opts.mistypedEmail}") — enquiry kept without an email. Check the owner's email.`, { typed_email: opts.mistypedEmail, needs_office: true }, { internal: true });
  return result;
}

export const MISTYPED_EMAIL_EVENT = "website_email_invalid";

async function upsertEnquiryInner(input: Omit<EnquiryInput, "estimated_area_m2" | "email"> & { estimated_area_m2: number | null; email: string | null }, source: string, actorId: string | null, origin: JobOrigin, facts: ReturnType<typeof intakeJobFacts>) {
  const email = input.email?.toLowerCase() ?? null;
  const preserveEntered = origin.channel === "installer_sourced";
  const enteredText = (await import("./mitti-quote-release.core")).installerEnteredText;
  const fullName = preserveEntered ? enteredText(input.full_name) : properName(input.full_name);
  let { data: owner } = email ? await admin.from("owners").select("id").ilike("email", exactLike(email)).maybeSingle() : { data: null };
  if (owner) {
    await admin.from("owners").update({ full_name: fullName, phone: input.phone ?? null }).eq("id", owner.id);
  } else {
    const { data, error } = await admin.from("owners").insert({ full_name: fullName, email, phone: input.phone ?? null }).select("id").single();
    if (error) throw new Error(error.message);
    owner = data;
    // link to an existing portal account if one exists
    const { data: prof } = email ? await admin.from("profiles").select("id").ilike("email", exactLike(email)).maybeSingle() : { data: null };
    if (prof) {
      await admin.from("owners").update({ user_id: prof.id }).eq("id", owner.id);
      await admin.from("user_roles").upsert({ user_id: prof.id, role: "owner" }, { onConflict: "user_id,role" });
    }
  }

  const byExternal = input.external_enquiry_id
    ? (await admin.from("jobs").select("id, property_id, stage, job_number").eq("external_enquiry_id", input.external_enquiry_id).maybeSingle()).data
    : null;
  // Jo (6 Oct 2026): the same owner (email or mobile) + same address filling in the public calculator again
  // attaches to their existing OPEN job — never a second job.
  let existingJob = byExternal;
  let repeatOf: string | null = null;
  let repeatArea: number | null = null;
  if (!existingJob && (source === "base44" || source === "qa_test")) {
    const repeat = await findOpenRepeatJob(source, email ?? "", input.phone ?? null, properAddress(input.address_line), input.suburb ? properAddress(input.suburb) : null, input.postcode ?? null);
    if (repeat) { existingJob = repeat; repeatOf = input.external_enquiry_id ?? "unknown"; repeatArea = repeat.area; }
  }

  if (!owner) throw new Error("Owner could not be saved.");
  // Decision 216: every address is stored as street / suburb / postcode the same way for every source. A website
  // one-line address with no suburb is split by the pure tidy (never inventing a suburb or postcode); installers'
  // own entries are kept exactly as typed.
  const split = !preserveEntered && !input.suburb?.trim() ? (await import("./name-address-tidy.core")).splitAddress(input.address_line, null, input.postcode ?? null) : null;
  const splitOk = !!split && !!split.street && !!split.suburb;
  const propFields = { owner_id: owner.id, address_line: preserveEntered ? enteredText(input.address_line) : splitOk ? split!.street : properAddress(input.address_line), suburb: input.suburb ? preserveEntered ? enteredText(input.suburb) : properAddress(input.suburb) : splitOk ? split!.suburb : null, postcode: input.postcode ?? (splitOk && split!.postcode ? split!.postcode : null), occupancy: input.occupancy ?? null, ...(normaliseState(input.state) ? { state: normaliseState(input.state)! } : {}) };
  const jobFields = facts;
  // Preliminary eligibility / life-support status are accepted only from the signed Base44 webhook.
  const plan = source === "base44" ? planBase44Job(input, existingJob ? { stage: existingJob.stage } : null) : null;

  if (existingJob) {
    const { data: before } = await admin.from("properties").select("address_line, suburb, postcode, enrichment").eq("id", existingJob.property_id).single();
    await admin.from("properties").update({ ...propFields, ...(source === "base44" || source === "qa_test" ? { enrichment: mergeEvidence(before?.enrichment, input as EnquiryInput) } : {}) }).eq("id", existingJob.property_id);
    const addrChanged = !!before && addressHash(before.address_line, before.suburb, before.postcode) !== addressHash(propFields.address_line, propFields.suburb, propFields.postcode);
    const update = { ...jobFields, ...(plan?.patch ?? {}) } as TablesUpdate<"jobs">; // never changes stage
    const { error: ue } = await admin.from("jobs").update(update).eq("id", existingJob.id);
    if (ue) throw new Error(ue.message);
    if (repeatOf) {
      const before = repeatArea;
      const after = jobFields.estimated_area_m2 == null ? null : Number(jobFields.estimated_area_m2);
      const sizeNote = before !== after && after != null ? ` Ceiling size changed from ${before ?? "unknown"} to ${after} m².` : "";
      await logEvent(existingJob.id, actorId, "repeat_enquiry_attached", `Same owner filled in the calculator again; attached to this job instead of creating a new one.${sizeNote}`, { repeat_external_enquiry_id: repeatOf, previous_area_m2: before, area_m2: after });
    }
    await logEvent(existingJob.id, actorId, "enquiry_updated", `Enquiry updated from ${source}`, plan?.details ?? {});
    if (addrChanged) await completeAddressAtIntake(existingJob.id, propFields, source, preserveEntered);
    if (source === "base44") await completeIntake(existingJob.id, owner!.id, input as EnquiryInput);
    if (source === "qa_test") return { job_id: existingJob.id, job_number: existingJob.job_number, created: false, post_intake: "none" as const };
    const queued = await enqueueInitialGate1(existingJob.id, await eligibilityFactsVersion(input), addrChanged ? "address changed" : "eligibility facts changed");
    if (queued !== "none") runAfterResponse(() => processPostIntakeWork({ jobId: existingJob.id })); // best-effort; scheduled worker is the durable fallback
    return { job_id: existingJob.id, job_number: existingJob.job_number, created: false, post_intake: queued };
  }
  const { data: prop, error: pe } = await admin.from("properties").insert({ ...propFields, ...(source === "base44" || source === "qa_test" ? { enrichment: mergeEvidence(null, input as EnquiryInput) } : {}) }).select("id").single();
  if (pe) throw new Error(pe.message);
  const { data: job, error: je } = await admin
    .from("jobs")
    .insert({
      ...jobFields, property_id: prop.id, owner_id: owner!.id, source, external_enquiry_id: input.external_enquiry_id ?? null, next_action: "Review eligibility",
      ...((plan ? { ...plan.patch, stage: "new_enquiry" } : {}) as TablesUpdate<"jobs">),
      business_unit: "hivic", // explicit: this portal only creates Home Insulation Victoria jobs
      channel: origin.channel,
      ...(origin.channel === "installer_sourced"
        ? { originating_installer_business_id: origin.businessId, originating_installer_user_id: origin.userId, commercial_model: "not_configured" as const }
        : {}),
    })
    .select("id, job_number")
    .single();
  if (je) throw new Error(je.message);
  await logEvent(job.id, actorId, "enquiry_received", `Enquiry received (${source})`, plan?.details ?? {}, { to: "new_enquiry" });
  if (plan) {
    await logEvent(job.id, actorId, "preliminary_eligibility_recorded",
      plan.outcome
        ? `Website preliminary result: ${plan.outcome.replace(/_/g, " ")} (Gate 1 admin review required)`
        : "Website enquiry received without a preliminary result (Gate 1 admin review required)",
      plan.details); // informational only — no stage transition
  }
  await logEvent(job.id, actorId, "job_source_recorded",
    origin.channel === "installer_sourced" ? "Job source: Installer-sourced (attribution locked)" : "Job source: Home Insulation Victoria-sourced",
    origin.channel === "installer_sourced" ? { channel: origin.channel, originating_installer_business_id: origin.businessId, originating_installer_user_id: origin.userId, commercial_model: "not_configured" } : { channel: origin.channel });
  await completeAddressAtIntake(job.id, propFields, source, preserveEntered);
  if (source === "base44") await completeIntake(job.id, owner!.id, input as EnquiryInput);
  // QA records stay permanently isolated from live post-intake automation.
  if (source === "qa_test") return { job_id: job.id, job_number: job.job_number, created: true, post_intake: "none" as const };
  // Durable hand-off: initial Property Intelligence + the first official Gate 1 run in the post-intake processor.
  const queued = await enqueueInitialGate1(job.id, await eligibilityFactsVersion(input), "new enquiry");
  if (queued !== "none") runAfterResponse(() => processPostIntakeWork({ jobId: job.id })); // best-effort; scheduled worker is the durable fallback
  return { job_id: job.id, job_number: job.job_number, created: true, post_intake: queued };
}

/**
 * Decision 281: a website / phone / email enquiry whose suburb or Victorian postcode is still blank after the split is
 * completed from the address lookup NOW (bounded 4s, same provider as Add a job, fills blanks only, audited as
 * `address_completed` / `address_lookup_unresolved`); the 15-minute tick retries later. Installer-entered addresses
 * are kept as typed and TEST jobs never call the live provider. Never fails intake.
 */
async function completeAddressAtIntake(jobId: string, p: { suburb: string | null; postcode: string | null }, source: string, preserveEntered: boolean) {
  if (preserveEntered || source === "qa_test") return;
  if ((p.suburb ?? "").trim() && /^[38]\d{3}$/.test((p.postcode ?? "").trim())) return;
  try { await (await import("./address-complete.server")).completeJobAddress(jobId, { trigger: "intake" }); }
  catch (e) { console.error("address completion at intake skipped", e instanceof Error ? e.message : e); }
}

/** Merge Base44 Gate 1 evidence under enrichment.base44 without touching other keys (e.g. verified portal facts). */
function mergeEvidence(existing: unknown, input: EnquiryInput): Json {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};
  const old = (base['base44'] as { raw?: unknown } | undefined)?.raw;
  const raw = retainOriginalMedia(old, buildBase44Raw(input));
  return { ...base, base44: { ...buildBase44Evidence(input), raw } } as unknown as Json;
}

/** Consent + media are stored before Gate 1/intelligence run. Media failures never fail the enquiry. */
async function completeIntake(jobId: string, ownerId: string, input: EnquiryInput) {
  await recordContactConsent(jobId, ownerId, input);
  try { await importBase44Media(jobId, input.media ?? []); }
  catch (e) { console.error("base44 media import failed", (e as Error).message); }
}

/** Open job for the same owner (email or AU mobile) at the same address. Pure match rules live in enquiry-repeat.core.ts. */
async function findOpenRepeatJob(source: string, email: string, phone: string | null, address: string | null, suburb: string | null, postcode: string | null) {
  const { repeatKey, sameOwner } = await import("./enquiry-repeat.core");
  const key = repeatKey(address, suburb, postcode);
  if (!key) return null;
  // Addresses split at intake (decision 216) store only the street: match a repeat one-line address on its street too.
  const altKey = suburb ? null : repeatKey((await import("./name-address-tidy.core")).splitAddress(address, null, postcode).street, null, postcode);
  const { data } = await admin.from("jobs").select("id, property_id, stage, job_number, created_at, estimated_area_m2, owners(email, phone), properties!inner(address_line, suburb, postcode)")
    .eq("channel", "hivic_sourced").eq("source", source).not("stage", "in", "(cancelled,complete)").eq("properties.postcode", postcode ?? "").order("created_at", { ascending: false }).limit(200);
  const hit = (data ?? []).find((j) => {
    const o = j.owners as { email: string | null; phone: string | null } | null;
    const p = j.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
    const stored = p ? repeatKey(p.address_line, p.suburb, p.postcode) : null;
    return !!p && (stored === key || (!!altKey && stored === altKey)) && sameOwner({ email, phone }, o);
  });
  return hit ? { id: hit.id, property_id: hit.property_id, stage: hit.stage, job_number: hit.job_number, area: hit.estimated_area_m2 == null ? null : Number(hit.estimated_area_m2) } : null;
}

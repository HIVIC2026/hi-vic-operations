// A48 batch 2 (spec part 1 + Jo's 30 Oct amendment): the owner's quick taps on My job `?screen=taps`. I/O only — the
// rules are in quick-taps.core.ts. Every function takes ONLY the owner's secure My job link token (the ACTIVE
// step3_estimate customer_estimate_links row); the job comes from the token, never from the page.
// - quickTapsState: what the screen shows. Not in a batch asking for taps (or the job is closed) → `none`.
// - saveQuickTapsDetails: the name / address taps ("Change it" or typed). Saved through the ONE audited enquiry details
//   save (office-actions.server saveEnquiryDetails, event `quick_taps_details_saved`). A home whose current location was
//   found for another address is re-located (old `coordinates` fact superseded, ensurePropertyCoordinates; decided by
//   locationNeedsRefresh, so a retry after a half-finished move still re-locates); over 10 km from the batch centre → the home leaves the
//   batch (area-batch.server leaveBatchIfMoved) and goes back in the pool — the owner is not told and carries on.
// - saveQuickTaps: the answers. ONE `quick_taps_answered {batch_id, answers, consent_share, outcome}` per job + batch,
//   claimed before anything else happens (a second save, or a second device, gets the same outcome and nothing more).
//   Blank website answers are written onto enrichment.base44.declared (blanks only, never overwriting). Pass → the
//   existing `trade_contact_share` owner gate (the "Yes, let's go" tap is the consent) and, first, ONE
//   owner_contact_consents row (source `quick_taps_reconsent`, given at the answer's time) naming Home Insulation Victoria
//   and the batch installer (Task 5, Jo 2 Nov 2026). Phone consent older than 3 months → the go tap reads
//   "Yes, {installer} can call me" (quickTapsGoLabel); the in-house hand-off waits for a current consent. Declines → cancelJobFully with the
//   matching reason (no O69 cancel notice: the owner gets this decline email instead) + the matching approved email
//   (TEST → test-send; real → customer comms + consent, then the guarded owner email sender with a once-only key).
//   The email goes only AFTER the job is closed: a failed close sends nothing and records `quick_taps_close_failed`.
// - finishDecline(jobId): close + email for a decline answer, idempotent — what saveQuickTaps runs, and what a later
//   sweep calls again for decline answers whose job isn't cancelled yet.
// - Task 19 (Jo 2 Nov 2026, answers 7, 22, 24): while RENTAL_TAPS_APPROVED, the owner is also asked "Do you live there or is
//   it rented?" (+ tenant, who lets us in) after the website answers and before the go tap; the answers are stored in the
//   same `quick_taps_answered` details (`answers.rental`), read by rental-answers.server. An installer's own customer
//   (no batch) answers ONLY those questions via `?only=rental` (`opts.only`), stored the same way.
// Nothing here raises a Needs me row.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkflowError, logEvent } from "./workflow.server";
import { AREA_BATCH_EVENTS, AREA_BATCH_SENT_EVENT, tapsBatchId, type AreaBatchEventRow } from "./area-batch.core";
import { contactConsentRecord, contactConsentSnapshot, phoneConsentCurrent } from "./contact-consent-record.core";
import {
  QUICK_TAPS_ANSWERED_EVENT, QUICK_TAPS_DECLINE_REASON, QUICK_TAPS_RECONSENT_SOURCE, quickTapsGoLabel, locationAddress, locationNeedsRefresh, tapOutcome, websiteQuestions,
  type AddressParts, type FinalOutcome, type QuickTapAnswers, type QuickTapsView, type WebsiteAnswers, type WebsiteFacts, type WebsiteKey,
} from "./quick-taps.core";
import { formatPropertyAddress } from "./address";
import { declaredExtras } from "./enquiry.core";
import { RENTAL_TAPS_APPROVED, buildRentalAnswers, rentalAnswersFromTaps, rentalAnswersProblems } from "./rental-answers.core";
import { normaliseInsulation } from "./eligibility.core";
import { parseStreet } from "./address-complete.core";
import { FULL_STREET_NEEDED } from "./address-request.core";
import { propertyPoint } from "./geo.core";

const loose = admin as unknown as SupabaseClient;
/** Existing owner-link wording (spot-release / address pages). */
const DEAD = "This link isn't working any more. Please reply to our email.";
const NAME_NEEDED = "Please type your full name.";
const NOT_FOUND = "We couldn't find that address. Please try again.";

type Owner = { full_name: string | null; email: string | null; phone?: string | null } | null;
type Prop = { id: string; address_line: string | null; suburb: string | null; state: string | null; postcode: string | null; enrichment: Record<string, unknown> | null } | null;
type Job = { id: string; owner_id: string | null; stage: string; source: string | null; channel: string | null; deleted_at: string | null; property_id: string | null; owners: Owner; properties: Prop };
type Ev = AreaBatchEventRow & { job_id?: string };
type Consent = { consent_key: string; consent_status: string; consented_at: string | null; snapshot: unknown; source: string };
type Ctx = { job: Job; events: Ev[]; savedInsulation: string | null; consents: Consent[] };
/** Injected clock (tests); defaults to now. */
export type QuickTapsOpts = {
  now?: Date;
  /** Ask the rental questions (default: RENTAL_TAPS_APPROVED). */
  rental?: boolean;
  /** An installer's own customer answering only the rental questions (Jo 2 Nov, answer 24). */
  only?: "rental";
};
const rentalAsked = (opts: QuickTapsOpts) => opts.rental ?? RENTAL_TAPS_APPROVED;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const bid = (e: Ev) => str((e.details as { batch_id?: unknown } | null)?.batch_id);

async function jobForToken(token: string): Promise<string | null> {
  const { isWellFormedToken, LINK_PURPOSE, linkUsable } = await import("./estimatelink.core");
  if (!isWellFormedToken(token)) return null;
  const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", token).eq("purpose", LINK_PURPOSE).eq("status", "active").maybeSingle();
  return l && linkUsable(l) ? l.job_id : null;
}

async function load(jobId: string): Promise<Ctx | null> {
  const [{ data: job, error }, { data: events, error: ee }, { data: saved }, { data: consents, error: ce }] = await Promise.all([
    admin.from("jobs").select("id, owner_id, stage, source, channel, deleted_at, property_id, owners(full_name, email, phone), properties(id, address_line, suburb, state, postcode, enrichment)").eq("id", jobId).maybeSingle(),
    loose.from("workflow_events").select("job_id, event_type, created_at, details").eq("job_id", jobId).in("event_type", [...AREA_BATCH_EVENTS, QUICK_TAPS_ANSWERED_EVENT]),
    admin.from("lead_campaign_responses").select("saved_insulation").eq("job_id", jobId).maybeSingle(),
    admin.from("owner_contact_consents").select("consent_key, consent_status, consented_at, snapshot, source").eq("job_id", jobId),
  ]);
  if (error) throw new Error(`Could not read the job: ${error.message}`);
  if (ee) throw new Error(`Could not read the batch history: ${ee.message}`);
  if (ce) throw new Error(`Could not read the contact consent: ${ce.message}`);
  if (!job) return null;
  return { job: job as unknown as Job, events: (events ?? []) as Ev[], savedInsulation: str((saved as { saved_insulation?: unknown } | null)?.saved_insulation), consents: (consents ?? []) as Consent[] };
}

/** The batch the taps belong to, and the stored answer for it (if any). */
function batchOf(c: Ctx): { batchId: string | null; answered: Ev | null; installer: string | null } {
  const batchId = tapsBatchId(c.events);
  const latestSent = c.events.filter((e) => e.event_type === AREA_BATCH_SENT_EVENT).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const forBatch = batchId ?? (latestSent ? bid(latestSent) : null);
  let answered = forBatch ? c.events.find((e) => e.event_type === QUICK_TAPS_ANSWERED_EVENT && bid(e) === forBatch) ?? null : null;
  // Put in this batch carrying a pass from a batch they left (Task 4 fix round 1): not asked again — the pass stands.
  const carried = forBatch && c.events.some((e) => e.event_type === AREA_BATCH_SENT_EVENT && bid(e) === forBatch && (e.details as { carried_pass?: unknown } | null)?.carried_pass === true);
  if (!answered && carried) answered = c.events.filter((e) => e.event_type === QUICK_TAPS_ANSWERED_EVENT).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  // Jo 2 Nov 2026: the installer the owner's current batch was sent for (shown on the pass screen).
  const sentFor = forBatch ? c.events.find((e) => e.event_type === AREA_BATCH_SENT_EVENT && bid(e) === forBatch) : undefined;
  const installer = str((sentFor?.details as { installer_name?: unknown } | null)?.installer_name);
  return { batchId, answered, installer };
}

const fullStreet = (p: Prop) => parseStreet(p?.address_line) !== null && /^\d{4}$/.test((p?.postcode ?? "").trim());
const addressText = (p: Prop) => (p && fullStreet(p) ? formatPropertyAddress(p) || null : null);

function websiteFacts(c: Ctx): WebsiteFacts {
  const base = ((c.job.properties?.enrichment ?? {})["base44"] ?? {}) as { declared?: Record<string, unknown> | null; raw?: { answers?: Record<string, unknown> | null } | null };
  const d = base.declared ?? {};
  const extras = declaredExtras(base.raw?.answers ?? null);
  return {
    property_type: str(d["property_type"]),
    top_floor: str(d["top_floor"]) ?? extras.top_floor,
    over_five_years: str(d["over_five_years"]),
    insulation: str(d["insulation"]) ?? c.savedInsulation ?? normaliseInsulation(extras.existing_insulation),
  };
}

/** Phone consent is current: the latest granted consent was given in the last 3 months. */
function consentCurrent(c: Ctx, now: Date): boolean {
  const record = contactConsentRecord(c.consents.filter((r) => r.consent_status === "granted"), []);
  return phoneConsentCurrent(record?.consentedAt ?? null, now.toISOString());
}

function viewOf(c: Ctx, now: Date = new Date(), rental = false): QuickTapsView {
  const { batchId, answered, installer } = batchOf(c);
  if (answered) {
    const o = str((answered.details as { outcome?: unknown } | null)?.outcome);
    if (o === "pass") return { kind: "done", outcome: "pass", installer };
    if (o) return { kind: "done", outcome: o as FinalOutcome };
  }
  const j = c.job;
  if (!batchId || j.stage === "cancelled" || j.deleted_at || j.channel !== "hivic_sourced") return { kind: "none" };
  return { kind: "ask", name: str(j.owners?.full_name), address: addressText(j.properties), website: websiteFacts(c), installer: batchOf(c).installer, consentCurrent: consentCurrent(c, now), rental };
}

/** Answer 24: an installer's own customer (no batch) answers only the rental questions. Open while the job is live;
 *  once any rental answers are recorded the first answer stands. */
function rentalOnlyView(c: Ctx): QuickTapsView {
  const j = c.job;
  if (j.channel !== "installer_sourced" || j.stage === "cancelled" || j.deleted_at) return { kind: "none" };
  return c.events.some((e) => e.event_type === QUICK_TAPS_ANSWERED_EVENT && rentalAnswersFromTaps(e.details)) ? { kind: "rental_done" } : { kind: "rental_ask" };
}

/** What My job `?screen=taps` shows. */
export async function quickTapsState(token: string, opts: QuickTapsOpts = {}): Promise<QuickTapsView> {
  const jobId = await jobForToken(token);
  if (!jobId) return { kind: "none" };
  const c = await load(jobId);
  if (!c) return { kind: "none" };
  if (opts.only === "rental") return rentalOnlyView(c);
  const view = viewOf(c, opts.now, rentalAsked(opts));
  if (view.kind === "done" && view.outcome === "pass" && (reconsentMissing(c) || !await sharingSignature(jobId))) return { kind: "retry" };
  return view;
}

type PassDetails = { consent_share?: boolean; answers?: { name?: string }; batch_id?: string; go_label?: string; consent_installer?: string | null };
const reconsentKey = (batchId: string, jobId: string) => `${QUICK_TAPS_RECONSENT_SOURCE}:${batchId}:${jobId}`;
/** A pass that showed a go label (every pass since Task 5) whose consent row is not recorded yet. */
function reconsentMissing(c: Ctx): boolean {
  const d = batchOf(c).answered?.details as PassDetails | null;
  return !!d?.go_label && !!d.batch_id && !c.consents.some((r) => r.consent_key === reconsentKey(d.batch_id!, c.job.id));
}

/** The pass tap's consent row: Home Insulation Victoria + the batch installer, given when the owner tapped, in the
 *  wording they tapped. Once per job + batch (consent_key). Older passes (no go label recorded) record nothing. */
async function recordReconsent(c: Ctx, answered: Ev) {
  const d = answered.details as PassDetails | null;
  if (!d?.go_label || !d.batch_id || !reconsentMissing(c)) return;
  if (!c.job.owner_id) throw new Error("Could not save the contact consent: no owner on the job");
  const installer = str(d.consent_installer);
  const snapshot = contactConsentSnapshot({ who: ["Home Insulation Victoria", ...(installer ? [installer] : [])], givenAt: answered.created_at, wording: d.go_label });
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(d.go_label)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const { error } = await admin.from("owner_contact_consents").insert({
    job_id: c.job.id, owner_id: c.job.owner_id, source: QUICK_TAPS_RECONSENT_SOURCE, consent_key: reconsentKey(d.batch_id, c.job.id), consent_status: "granted",
    contact_consent: true, consented_at: answered.created_at, snapshot: snapshot as never, sha256,
  });
  if (error && (error as { code?: string }).code !== "23505") {
    await logEvent(c.job.id, null, "quick_taps_reconsent_not_recorded", `Quick taps: contact consent could not be saved: ${error.message}`, { batch_id: d.batch_id }, { internal: true });
    throw new Error(`Could not save the contact consent: ${error.message}`);
  }
}

async function sharingSignature(jobId: string) {
  const { gateDoc } = await import("./owner-gates.core");
  const { data, error } = await admin.from("owner_gate_signatures").select("id").eq("job_id", jobId).eq("doc_key", "trade_contact_share").eq("doc_version", gateDoc("trade_contact_share").version).limit(1).maybeSingle();
  if (error) throw new Error(`Could not check sharing consent: ${error.message}`);
  return data;
}

async function finishSharing(jobId: string, c: Ctx, meta: { ip: string | null; userAgent: string | null }) {
  const { answered } = batchOf(c);
  const d = answered?.details as PassDetails | null;
  if (!answered || d?.consent_share !== true || !d.answers?.name) throw new WorkflowError("Please answer each question.");
  await recordReconsent(c, answered);
  if (await sharingSignature(jobId)) return;
  const { signGateDoc } = await import("./owner-gates.server");
  try {
    await signGateDoc({ jobId, key: "trade_contact_share", signatoryName: d.answers.name, ticked: true, answers: {}, method: "link_code", signedBy: null, ip: meta.ip, userAgent: meta.userAgent, ...(d.batch_id ? { quickTapsBatchId: d.batch_id } : {}) });
  } catch (error) {
    await logEvent(jobId, null, "quick_taps_share_not_recorded", `Quick taps: sharing consent could not be saved: ${error instanceof Error ? error.message : "error"}`, { batch_id: d.batch_id }, { internal: true });
    throw error;
  }
}

async function asking(token: string): Promise<{ jobId: string; c: Ctx; batchId: string } | null> {
  const jobId = await jobForToken(token);
  const c = jobId ? await load(jobId) : null;
  if (!jobId || !c || viewOf(c).kind !== "ask") return null;
  return { jobId, c, batchId: batchOf(c).batchId! };
}

/** The address search on the address tap (the same provider as the owner's address page). */
export async function searchQuickTapsAddress(token: string, query: string) {
  if (!(await asking(token))) throw new Error(DEAD);
  const q = query.trim();
  if (q.length < 4) return []; // the address service finds nothing under 4 characters
  const { searchAddressSuggestions } = await import("./address-lookup.server");
  return searchAddressSuggestions(q);
}

export type QuickTapsDetailsResult = { ok: true; name: string; address: string } | { ok: false; error: string };
const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase().replace(/\s+/g, " ") === (b ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** The name / address taps. `fullName` = a changed or typed name (else the name on file); `placeId` = the picked
 *  address (else the address on file, which must then be a full street address). */
export async function saveQuickTapsDetails(token: string, input: { fullName?: string | null; placeId?: string | null }): Promise<QuickTapsDetailsResult> {
  const a = await asking(token);
  if (!a) return { ok: false, error: DEAD };
  const { jobId, c, batchId } = a;
  const prop = c.job.properties;
  const name = str(input.fullName) ?? str(c.job.owners?.full_name);
  if (!name || name.length < 2) return { ok: false, error: NAME_NEEDED };
  let street: string, suburb: string, postcode: string;
  if (input.placeId) {
    const { lookupAddressDetails } = await import("./address-lookup.server");
    const place = await lookupAddressDetails(input.placeId);
    if (!place) return { ok: false, error: NOT_FOUND };
    if (parseStreet(place.street ?? "") === null) return { ok: false, error: FULL_STREET_NEEDED };
    street = place.street ?? ""; suburb = place.suburb ?? ""; postcode = place.postcode ?? "";
  } else {
    if (!fullStreet(prop)) return { ok: false, error: FULL_STREET_NEEDED };
    street = prop!.address_line ?? ""; suburb = prop!.suburb ?? ""; postcode = prop!.postcode ?? "";
  }
  const before = { name: c.job.owners?.full_name ?? null, street: prop?.address_line ?? null, suburb: prop?.suburb ?? null, postcode: prop?.postcode ?? null };
  const nameChanged = !same(name, before.name);
  const { saveEnquiryDetails } = await import("./office-actions.server");
  let saved: { fullName: string; street: string; suburb: string; postcode: string };
  try {
    saved = await saveEnquiryDetails(jobId, null, { fullName: name, street, suburb, postcode }, {
      type: "quick_taps_details_saved", summary: `Owner confirmed their name and address for their quote (quick taps): ${name} · ${street}`,
      details: { batch_id: batchId, name_changed: nameChanged, address_changed: !same(street, before.street) || !same(suburb, before.suburb) || !same(postcode, before.postcode), source: "quick_taps" },
    });
  } catch (e) {
    if (e instanceof WorkflowError) return { ok: false, error: e.message };
    throw e;
  }
  const changedNow = !same(saved.street, before.street) || !same(saved.suburb, before.suburb) || !same(saved.postcode, before.postcode);
  const moved = prop?.id ? await needsNewLocation(jobId, prop.id, { address_line: saved.street, suburb: saved.suburb, postcode: saved.postcode }, changedNow) : false;
  if (moved && prop?.id) {
    // The old location belongs to the old address: superseded (kept as history), then the new one is looked up once.
    // If that fails, stop: looking up now would just hand back the old address's location.
    const { error: se } = await loose.from("property_facts").update({ is_current: false, superseded_at: new Date().toISOString() }).eq("property_id", prop.id).eq("fact_key", "coordinates").eq("is_current", true);
    if (se) throw new Error(`Could not update the home's location: ${se.message}`);
    const { ensurePropertyCoordinates } = await import("./property-coordinates.server");
    const B = await import("./area-batch.server");
    const point = propertyPoint(await ensurePropertyCoordinates(jobId, prop.id)) ?? (await B.postcodeCentre(saved.postcode));
    await B.leaveBatchIfMoved(jobId, batchId, point);
  }
  return { ok: true, name: saved.fullName, address: formatPropertyAddress({ address_line: saved.street, suburb: saved.suburb, state: "VIC", postcode: saved.postcode }) };
}

/** "Moved" = the current location was found for a different address (locationNeedsRefresh): a retry after the old
 *  location couldn't be superseded (address already saved) still re-locates the home. */
async function needsNewLocation(jobId: string, propertyId: string, saved: AddressParts, changedNow: boolean): Promise<boolean> {
  const [{ data: fact, error: fe }, { data: earlier, error: ee }] = await Promise.all([
    loose.from("property_facts").select("raw_snapshot").eq("property_id", propertyId).eq("fact_key", "coordinates").eq("is_current", true).limit(1).maybeSingle(),
    loose.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", "quick_taps_details_saved").contains("details", { address_changed: true }).limit(1),
  ]);
  if (fe) throw new Error(`Could not read the home's location: ${fe.message}`);
  if (ee) throw new Error(`Could not read the address history: ${ee.message}`);
  return locationNeedsRefresh({ locationAddress: locationAddress((fact as { raw_snapshot?: unknown } | null)?.raw_snapshot), saved, changedNow, changedBefore: (earlier ?? []).length > 0 });
}

/** Blank website answers onto enrichment.base44.declared (blanks only; the owner's website answers are never changed). */
async function storeWebsiteAnswers(c: Ctx, given: WebsiteAnswers, keys: readonly WebsiteKey[]) {
  const prop = c.job.properties;
  if (!prop?.id || !keys.length) return;
  const { data: fresh, error } = await admin.from("properties").select("enrichment").eq("id", prop.id).maybeSingle();
  if (error) throw new Error(`Could not read the website answers: ${error.message}`);
  const enrichment = { ...((fresh as { enrichment?: Record<string, unknown> | null } | null)?.enrichment ?? {}) };
  const base44 = { ...((enrichment["base44"] ?? {}) as Record<string, unknown>) };
  const declared = { ...((base44["declared"] ?? {}) as Record<string, unknown>) };
  const filled: string[] = [];
  for (const k of keys) if (!str(declared[k]) && given[k]) { declared[k] = given[k]; filled.push(k); }
  if (!filled.length) return;
  declared["quick_taps_filled"] = [...new Set([...(((declared["quick_taps_filled"] ?? []) as string[])), ...filled])];
  base44["declared"] = declared; enrichment["base44"] = base44;
  const { error: ue } = await admin.from("properties").update({ enrichment: enrichment as never }).eq("id", prop.id);
  if (ue) throw new Error(`Could not save the answers: ${ue.message}`);
}

/** The decline email's once-only claim (written before the send). */
const QUICK_TAPS_EMAIL_CLAIM_EVENT = "quick_taps_email_claimed";

/** One claim per job + key: false = already claimed (unique key, or the read-then-insert check). */
async function claimOnce(jobId: string, eventType: string, details: Record<string, unknown>, summary: string): Promise<boolean> {
  const key = String(details["idempotency_key"]);
  const { data: prior, error: pe } = await loose.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", eventType).contains("details", { idempotency_key: key }).limit(1);
  if (pe) throw new Error(`Could not check the answers: ${pe.message}`);
  if ((prior ?? []).length) return false;
  const { error } = await loose.from("workflow_events").insert({ job_id: jobId, actor_id: null, event_type: eventType, summary, details, internal: true });
  if (error) { if (error.code === "23505") return false; throw new Error(`Could not save the answers: ${error.message}`); }
  return true;
}
const claimAnswer = (jobId: string, details: Record<string, unknown>, summary: string) => claimOnce(jobId, QUICK_TAPS_ANSWERED_EVENT, details, summary);

const SUMMARY: Record<FinalOutcome, string> = {
  pass: "Quick taps: owner passed and said yes, let's go (consent to share name and number with the installer)",
  decline_access: "Quick taps: no roof access — job closed, owner emailed",
  decline_5yr: "Quick taps: built or ceiling replaced in the last 5 years — job closed, owner emailed",
  no_thanks: "Quick taps: owner said no thanks — job closed, owner emailed",
};

/** The owner's answers. Returns the outcome screen; a repeat (or a second device) gets the first outcome, nothing more. */
export async function saveQuickTaps(token: string, answers: QuickTapAnswers, meta: { ip: string | null; userAgent: string | null } = { ip: null, userAgent: null }, opts: QuickTapsOpts = {}): Promise<QuickTapsView> {
  const jobId = await jobForToken(token);
  const c = jobId ? await load(jobId) : null;
  if (!jobId || !c) throw new WorkflowError(DEAD);
  if (opts.only === "rental") return saveRentalOnly(jobId, c, answers);
  const askRental = rentalAsked(opts);
  const view = viewOf(c, opts.now, askRental);
  if (view.kind === "done") {
    if (view.outcome === "pass") await finishSharing(jobId, c, meta);
    return view;
  }
  if (view.kind !== "ask") throw new WorkflowError(DEAD);
  if (!view.name) throw new WorkflowError(NAME_NEEDED);
  if (!view.address) throw new WorkflowError(FULL_STREET_NEEDED);
  const batchId = batchOf(c).batchId!;
  const blanks = websiteQuestions(view.website, answers.website ?? {});
  const outcome = tapOutcome(answers, blanks, { rental: askRental });
  if (outcome === "incomplete") throw new WorkflowError("Please answer each question.");
  const website = Object.fromEntries(blanks.filter((k) => answers.website?.[k]).map((k) => [k, answers.website![k]!]));
  await storeWebsiteAnswers(c, website, blanks);
  const stored = {
    name: view.name, address: view.address, hatch: answers.hatch ?? null, roof: answers.roof ?? null, five_years: answers.five_years ?? null, go: answers.go ?? null,
    ...(Object.keys(website).length ? { website } : {}),
    // Task 19: a decline never reaches the rental questions.
    ...(askRental && (outcome === "pass" || outcome === "no_thanks") ? { rental: buildRentalAnswers(answers.rental ?? {}, { name: view.name, phone: c.job.owners?.phone ?? null }) } : {}),
  };
  // The go label the owner tapped (and the installer it names) — recorded with the answer so the consent row says exactly that.
  const consent = outcome === "pass" ? { go_label: quickTapsGoLabel(view), consent_installer: view.installer } : {};
  const won = await claimAnswer(jobId, { batch_id: batchId, answers: stored, consent_share: outcome === "pass", outcome, ...consent, idempotency_key: `quick-taps:v1:${batchId}:${jobId}:answered` }, SUMMARY[outcome]);
  if (!won) {
    const again = await load(jobId);
    if (!again) return { kind: "none" };
    const result = viewOf(again);
    if (result.kind === "done" && result.outcome === "pass") await finishSharing(jobId, again, meta);
    return result;
  }

  if (outcome === "pass") {
    const recorded = await load(jobId);
    if (!recorded) throw new WorkflowError(DEAD);
    await finishSharing(jobId, recorded, meta);
    return { kind: "done", outcome, installer: batchOf(recorded).installer };
  }
  await finishDecline(jobId);
  return { kind: "done", outcome };
}

/** Answer 24: the rental questions only, for an installer's own customer. One `quick_taps_answered` per job (claimed first). */
async function saveRentalOnly(jobId: string, c: Ctx, answers: QuickTapAnswers): Promise<QuickTapsView> {
  const view = rentalOnlyView(c);
  if (view.kind !== "rental_ask") { if (view.kind === "rental_done") return view; throw new WorkflowError(DEAD); }
  if (rentalAnswersProblems(answers.rental).length) throw new WorkflowError("Please answer each question.");
  const rental = buildRentalAnswers(answers.rental ?? {}, { name: c.job.owners?.full_name ?? null, phone: c.job.owners?.phone ?? null });
  await claimAnswer(jobId, { answers: { rental }, rental_only: true, outcome: "rental_only", idempotency_key: `rental-taps:v1:${jobId}:answered` },
    rental.rented ? "Owner answered the rental questions: rented" : "Owner answered the rental questions: lives there");
  return { kind: "rental_done" };
}

export type FinishDeclineResult = "finished" | "cancel_failed" | "nothing_to_do";

/** Finish a decline answer: close the job (cancelJobFully with the matching reason, no O69 notice), THEN the matching
 *  decline email, once. If the close fails, nothing is sent and `quick_taps_close_failed` is recorded — so a later sweep
 *  can simply call this again for decline answers whose job isn't cancelled. Safe to call any number of times: a job
 *  already cancelled is not cancelled again, and the email is claimed once per job + batch before it is sent.
 *  Acts only when the job's latest quick-taps answer is a decline. */
export async function finishDecline(jobId: string): Promise<FinishDeclineResult> {
  const c = await load(jobId);
  if (!c) return "nothing_to_do";
  const latest = c.events.filter((e) => e.event_type === QUICK_TAPS_ANSWERED_EVENT).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const outcome = str((latest?.details as { outcome?: unknown } | null)?.outcome) as FinalOutcome | null;
  const batchId = latest ? bid(latest) : null;
  if (!latest || !batchId || !outcome || !(outcome in QUICK_TAPS_DECLINE_REASON)) return "nothing_to_do";
  const decline = outcome as Exclude<FinalOutcome, "pass">;
  if (c.job.stage !== "cancelled") {
    try {
      const { cancelJobFully } = await import("./office-actions.server");
      await cancelJobFully(jobId, QUICK_TAPS_DECLINE_REASON[decline], null, { tell: { owner: false, installer: false } });
    } catch (e) {
      // Recorded once per job + batch (a later retry that fails again adds nothing).
      await claimOnce(jobId, "quick_taps_close_failed", { batch_id: batchId, outcome: decline, error: (e as Error).message, idempotency_key: `quick-taps:v1:${batchId}:${jobId}:close_failed` }, `Quick taps: the job could not be closed (no email sent yet): ${(e as Error).message}`);
      return "cancel_failed";
    }
  }
  await emailDecline(c, batchId, decline);
  return "finished";
}

/** The matching approved decline email, once per job + batch (claimed before the send; TEST → test-send; real → guarded
 *  owner email with a once-only key). */
async function emailDecline(c: Ctx, batchId: string, outcome: Exclude<FinalOutcome, "pass">) {
  const jobId = c.job.id;
  const claimed = await claimOnce(jobId, QUICK_TAPS_EMAIL_CLAIM_EVENT, { batch_id: batchId, outcome, idempotency_key: `quick-taps:v1:${batchId}:${jobId}:email` }, `Quick taps email (${outcome.replace("_", " ")}): sending`);
  if (!claimed) return;
  const to = str(c.job.owners?.email);
  const { renderQuickTapsDeclineEmail } = await import("./quick-taps-email.core");
  const build = (unsubscribeUrl: string | null, test: boolean) => renderQuickTapsDeclineEmail({ outcome, firstName: c.job.owners?.full_name ?? null, unsubscribeUrl, test });
  let status: string;
  if (!to) status = "not sent — no owner email";
  else if (c.job.source === "qa_test") {
    const sent = c.events.find((e) => e.event_type === AREA_BATCH_SENT_EVENT && bid(e) === batchId);
    const businessId = str((sent?.details as { installer_business_id?: unknown } | null)?.installer_business_id);
    const { data: biz } = businessId ? await admin.from("businesses").select("onboarding_notes").eq("id", businessId).maybeSingle() : { data: null };
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail } = await import("./test-send.server");
    const m = build(null, true);
    const r = await sendTestEmail({ jobId, jobSource: c.job.source, partnerIsTest: isTestPartner(biz ?? null), label: `quick_taps_${outcome}:${batchId}`, actorId: null }, to, m.subject, m.html, m.text);
    status = `${r.status}: ${r.detail}`;
  } else {
    try {
      await (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, "Quick taps email");
      status = await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: c.job.source, to, purpose: `quick_taps_${outcome}`, key: `quick-taps:v1:${batchId}:${jobId}:email`, build: (u) => build(u, false) });
    } catch (e) { status = `not sent — ${(e as Error).message}`; }
  }
  await logEvent(jobId, null, "quick_taps_email", `Quick taps email (${outcome.replace("_", " ")}): ${status}`, { batch_id: batchId, outcome, status }, { internal: true });
}


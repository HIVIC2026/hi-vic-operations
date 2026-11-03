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
//   `answers.access` = who lets the installer in, normalised (tenant name trimmed, mobile +61…), stored on a pass only;
//   a given but invalid answer is refused (even on a decline) and nothing is saved. The tenant is never texted or emailed.
//   Blank website answers are written onto enrichment.base44.declared (blanks only, never overwriting). Pass → the
//   existing `trade_contact_share` owner gate (the "Yes, let's go" tap is the consent). Declines → cancelJobFully with the
//   matching reason (no O69 cancel notice: the owner gets this decline email instead) + the matching approved email
//   (TEST → test-send; real → customer comms + consent, then the guarded owner email sender with a once-only key).
//   The email goes only AFTER the job is closed: a failed close sends nothing and records `quick_taps_close_failed`.
// - finishDecline(jobId): close + email for a decline answer, idempotent — what saveQuickTaps runs, and what a later
//   sweep calls again for decline answers whose job isn't cancelled yet.
// Nothing here raises a Needs me row.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkflowError, logEvent } from "./workflow.server";
import { AREA_BATCH_EVENTS, AREA_BATCH_LEFT_EVENT, AREA_BATCH_SENT_EVENT, tapsBatchId, type AreaBatchEventRow } from "./area-batch.core";
import {
  QUICK_TAPS_ANSWERED_EVENT, QUICK_TAPS_COPY, reaskText, QUICK_TAPS_DECLINE_REASON, locationAddress, normaliseAccess, locationNeedsRefresh, tapOutcome, websiteQuestions,
  type AddressParts, type FinalOutcome, type QuickTapAnswers, type QuickTapsView, type WebsiteAnswers, type WebsiteFacts, type WebsiteKey,
} from "./quick-taps.core";
import { formatPropertyAddress } from "./address";
import { declaredExtras } from "./enquiry.core";
import { normaliseInsulation } from "./eligibility.core";
import { parseStreet } from "./address-complete.core";
import { FULL_STREET_NEEDED } from "./address-request.core";
import { propertyPoint } from "./geo.core";

const loose = admin as unknown as SupabaseClient;
/** Existing owner-link wording (spot-release / address pages). */
const DEAD = "This link isn't working any more. Please reply to our email.";
const NAME_NEEDED = "Please type your full name.";
const NOT_FOUND = "We couldn't find that address. Please try again.";
const TENANT_NEEDED = QUICK_TAPS_COPY.access.needBoth;

type Owner = { full_name: string | null; email: string | null } | null;
type Prop = { id: string; address_line: string | null; suburb: string | null; state: string | null; postcode: string | null; enrichment: Record<string, unknown> | null } | null;
type Job = { id: string; stage: string; source: string | null; channel: string | null; deleted_at: string | null; property_id: string | null; owners: Owner; properties: Prop };
type Ev = AreaBatchEventRow & { job_id?: string };
type Ctx = { job: Job; events: Ev[]; savedInsulation: string | null };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const bid = (e: Ev) => str((e.details as { batch_id?: unknown } | null)?.batch_id);

async function jobForToken(token: string): Promise<string | null> {
  const { isWellFormedToken, LINK_PURPOSE, linkUsable } = await import("./estimatelink.core");
  if (!isWellFormedToken(token)) return null;
  const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", token).eq("purpose", LINK_PURPOSE).eq("status", "active").maybeSingle();
  return l && linkUsable(l) ? l.job_id : null;
}

async function load(jobId: string): Promise<Ctx | null> {
  const [{ data: job, error }, { data: events, error: ee }, { data: saved }] = await Promise.all([
    admin.from("jobs").select("id, stage, source, channel, deleted_at, property_id, owners(full_name, email), properties(id, address_line, suburb, state, postcode, enrichment)").eq("id", jobId).maybeSingle(),
    loose.from("workflow_events").select("job_id, event_type, created_at, details").eq("job_id", jobId).in("event_type", [...AREA_BATCH_EVENTS, QUICK_TAPS_ANSWERED_EVENT]),
    admin.from("lead_campaign_responses").select("saved_insulation").eq("job_id", jobId).maybeSingle(),
  ]);
  if (error) throw new Error(`Could not read the job: ${error.message}`);
  if (ee) throw new Error(`Could not read the batch history: ${ee.message}`);
  if (!job) return null;
  return { job: job as unknown as Job, events: (events ?? []) as Ev[], savedInsulation: str((saved as { saved_insulation?: unknown } | null)?.saved_insulation) };
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

function viewOf(c: Ctx): QuickTapsView {
  const { batchId, answered, installer } = batchOf(c);
  if (answered) {
    const o = str((answered.details as { outcome?: unknown } | null)?.outcome);
    if (o === "pass") return { kind: "done", outcome: "pass", installer };
    if (o) return { kind: "done", outcome: o as FinalOutcome };
  }
  const j = c.job;
  if (!batchId || j.stage === "cancelled" || j.deleted_at || j.channel !== "hivic_sourced") return { kind: "none" };
  return { kind: "ask", name: str(j.owners?.full_name), address: addressText(j.properties), website: websiteFacts(c) };
}

/** What My job `?screen=taps` shows. */
export async function quickTapsState(token: string): Promise<QuickTapsView> {
  const jobId = await jobForToken(token);
  if (!jobId) return { kind: "none" };
  const c = await load(jobId);
  if (!c) return { kind: "none" };
  const view = viewOf(c);
  if (view.kind === "done" && view.outcome === "pass" && !await sharingSignature(jobId)) return { kind: "retry" };
  return view;
}

async function sharingSignature(jobId: string) {
  const { gateDoc } = await import("./owner-gates.core");
  const { data, error } = await admin.from("owner_gate_signatures").select("id").eq("job_id", jobId).eq("doc_key", "trade_contact_share").eq("doc_version", gateDoc("trade_contact_share").version).limit(1).maybeSingle();
  if (error) throw new Error(`Could not check sharing consent: ${error.message}`);
  return data;
}

async function finishSharing(jobId: string, c: Ctx, meta: { ip: string | null; userAgent: string | null }) {
  const { answered } = batchOf(c);
  const d = answered?.details as { consent_share?: boolean; answers?: { name?: string }; batch_id?: string } | null;
  if (d?.consent_share !== true || !d.answers?.name) throw new WorkflowError("Please answer each question.");
  if (await sharingSignature(jobId)) return;
  const { signGateDoc } = await import("./owner-gates.server");
  try {
    await signGateDoc({ jobId, key: "trade_contact_share", signatoryName: d.answers.name, ticked: true, answers: {}, method: "quick_tap_link", signedBy: null, ip: meta.ip, userAgent: meta.userAgent, ...(d.batch_id ? { quickTapsBatchId: d.batch_id } : {}) });
  } catch (error) {
    await logEvent(jobId, null, "quick_taps_share_not_recorded", `Quick taps: sharing consent could not be saved: ${error instanceof Error ? error.message : "error"}`, { batch_id: d.batch_id }, { internal: true });
    throw error;
  }
}

/** Jo 2 Nov 2026 (HV-2730): owners whose "Yes, let's go" was saved but whose OK to share details was refused by the
 *  database before the quick_tap_link fix. Lists them (dry run) or saves each OK once from the recorded answer, through
 *  the same finishSharing path as the owner's own tap. Never touches declines, cancelled/deleted jobs or saved OKs. */
export async function repairQuickTapsSharing(opts: { apply: boolean }): Promise<{ jobId: string; name: string; batchId: string }[]> {
  const { data, error } = await loose.from("workflow_events").select("job_id, details").eq("event_type", QUICK_TAPS_ANSWERED_EVENT).contains("details", { outcome: "pass", consent_share: true });
  if (error) throw new Error(`Could not read quick taps answers: ${error.message}`);
  const out: { jobId: string; name: string; batchId: string }[] = [];
  for (const jobId of [...new Set((data ?? []).map((r) => str((r as { job_id?: unknown }).job_id)).filter((j): j is string => !!j))]) {
    if (await sharingSignature(jobId)) continue;
    const c = await load(jobId);
    if (!c || c.job.stage === "cancelled" || c.job.deleted_at) continue;
    const { answered } = batchOf(c);
    const d = answered?.details as { outcome?: unknown; consent_share?: unknown; answers?: { name?: unknown }; batch_id?: unknown } | null;
    const name = str(d?.answers?.name); const batchId = str(d?.batch_id);
    if (d?.outcome !== "pass" || d.consent_share !== true || !name || !batchId) continue;
    out.push({ jobId, name, batchId });
    if (!opts.apply) continue;
    await finishSharing(jobId, c, { ip: null, userAgent: "quick-taps repair" });
    await logEvent(jobId, null, "quick_taps_share_repaired", "Quick taps: owner's OK to share details saved from their recorded yes", { batch_id: batchId }, { internal: true });
  }
  return out;
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
export async function saveQuickTaps(token: string, answers: QuickTapAnswers, meta: { ip: string | null; userAgent: string | null } = { ip: null, userAgent: null }): Promise<QuickTapsView> {
  const jobId = await jobForToken(token);
  const c = jobId ? await load(jobId) : null;
  if (!jobId || !c) throw new WorkflowError(DEAD);
  const view = viewOf(c);
  if (view.kind === "done") {
    if (view.outcome === "pass") await finishSharing(jobId, c, meta);
    return view;
  }
  if (view.kind !== "ask") throw new WorkflowError(DEAD);
  if (!view.name) throw new WorkflowError(NAME_NEEDED);
  if (!view.address) throw new WorkflowError(FULL_STREET_NEEDED);
  const batchId = batchOf(c).batchId!;
  // Who lets the installer in: a given answer must be valid (a bad tenant name or mobile saves nothing), and is saved
  // normalised (name trimmed, mobile +61…). The tenant is never texted or emailed.
  const access = answers.access === undefined ? null : normaliseAccess(answers.access);
  if (answers.access !== undefined && !access) throw new WorkflowError(TENANT_NEEDED);
  const blanks = websiteQuestions(view.website, answers.website ?? {});
  const outcome = tapOutcome({ ...answers, access: access ?? undefined }, blanks);
  if (outcome === "incomplete") throw new WorkflowError("Please answer each question.");
  const website = Object.fromEntries(blanks.filter((k) => answers.website?.[k]).map((k) => [k, answers.website![k]!]));
  await storeWebsiteAnswers(c, website, blanks);
  const stored = {
    name: view.name, address: view.address, hatch: answers.hatch ?? null, roof: answers.roof ?? null, five_years: answers.five_years ?? null, go: answers.go ?? null,
    ...(Object.keys(website).length ? { website } : {}),
    // Final review 4: kept only on a pass (the installer needs it); a decline never stores the tenant's details.
    ...(access && outcome === "pass" ? { access } : {}),
  };
  const won = await claimAnswer(jobId, { batch_id: batchId, answers: stored, consent_share: outcome === "pass", outcome, idempotency_key: `quick-taps:v1:${batchId}:${jobId}:answered` }, SUMMARY[outcome]);
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

// ---- One-off re-ask (Jo 3 Nov 2026, Mia HV-1405) --------------------------------------------------------------------
export type ReaskResult = { oldBatchId: string | null; answered: string | null; installerId: string | null; installer: string | null; reopened: boolean; newBatchId: string | null; text: string | null };

/** Let an owner answer the quick taps again. History can't be changed (workflow_events is append-only), so the owner gets a
 *  FRESH batch for the same installer: reopen a cancelled job, mark it as having left its old batch, then the normal
 *  sendBatch with Jo's approved re-ask text and no email. Their old answer stays with the old batch. Dry run unless
 *  `apply`. Once done, the old batch is no longer the open one, so a second run finds nothing to re-ask. */
/** The owner's My job link works now, or — for a cancelled job — will work again once it's reopened: the live rule
 *  trg_owner_links_follow_cancel revokes links on cancel (reason `job_cancelled`) and restores the latest one on reopen. */
async function linkWorksAfterReopen(jobId: string, cancelled: boolean, now: Date): Promise<boolean> {
  if (!cancelled) return !!await (await import("./veec-copy-email.server")).ownerMyJobLink(jobId);
  const { LINK_PURPOSE } = await import("./estimatelink.core");
  const { data, error } = await loose.from("customer_estimate_links").select("expires_at").eq("job_id", jobId).eq("purpose", LINK_PURPOSE).eq("status", "revoked").eq("revocation_reason", "job_cancelled");
  if (error) throw new Error(`Could not check the owner's link: ${error.message}`);
  return ((data ?? []) as { expires_at: string | null }[]).some((l) => !l.expires_at || Date.parse(l.expires_at) > now.getTime());
}

export async function reaskQuickTaps(jobId: string, opts: { apply: boolean; actorId: string; now?: Date }): Promise<ReaskResult> {
  const now = opts.now ?? new Date();
  const c = await load(jobId);
  if (!c) throw new WorkflowError("Job not found.");
  // Her LATEST answer decides (review I1: the old batch may already be closed). Only a Flat-roof decline is re-asked
  // (review I2), and only once: a batch sent after that answer means it was already re-asked.
  const answer = c.events.filter((e) => e.event_type === QUICK_TAPS_ANSWERED_EVENT).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  const ad = (answer?.details ?? {}) as { outcome?: unknown; answers?: { roof?: unknown } | null };
  if (!answer || ad.outcome !== "decline_access" || ad.answers?.roof !== "flat")
    throw new WorkflowError("This re-ask is only for an owner who tapped Flat for the roof — nothing to re-ask.");
  if (c.events.some((e) => e.event_type === AREA_BATCH_SENT_EVENT && e.created_at > answer.created_at))
    throw new WorkflowError("Already re-asked (a newer batch was sent after the Flat answer) — nothing to re-ask.");
  const oldBatchId = bid(answer);
  const sent = oldBatchId ? c.events.find((e) => e.event_type === AREA_BATCH_SENT_EVENT && bid(e) === oldBatchId) : undefined;
  const sd = (sent?.details ?? {}) as { installer_business_id?: unknown; installer_name?: unknown };
  const out: ReaskResult = {
    oldBatchId, answered: "decline_access", installerId: str(sd.installer_business_id), installer: str(sd.installer_name),
    reopened: c.job.stage === "cancelled", newBatchId: null, text: null,
  };
  if (!out.installerId) throw new WorkflowError("Can't find the installer the owner's batch was sent for — nothing to re-ask.");
  // Review I3: the checks sendBatch would refuse on, BEFORE anything is changed.
  const { smsQuietReason } = await import("./quote-hold.core");
  if (c.job.source !== "qa_test") {
    if (smsQuietReason(now.toISOString())) throw new WorkflowError("It's quiet hours (8pm–7am) — run it again after 7am. Nothing was changed.");
    const { data: ws } = await admin.from("workflow_settings").select("customer_comms_enabled, sms_message_switches").eq("id", 1).maybeSingle();
    const w = ws as { customer_comms_enabled?: boolean | null; sms_message_switches?: Record<string, boolean> | null } | null;
    if (w?.customer_comms_enabled !== true || w?.sms_message_switches?.["quick_taps"] !== true) throw new WorkflowError("Customer messages or the quick taps texts are switched off. Nothing was changed.");
  }
  if (!await linkWorksAfterReopen(jobId, c.job.stage === "cancelled", now)) throw new WorkflowError("The owner has no working My job link. Nothing was changed.");
  if (!opts.apply) return out;

  if (c.job.stage === "cancelled") {
    const { reopenJob } = await import("./office-actions.server");
    await reopenJob(jobId, "Quick taps re-asked: flat roof tapped by mistake (Jo 3 Nov 2026)", opts.actorId);
  }
  await claimOnce(jobId, AREA_BATCH_LEFT_EVENT, { batch_id: oldBatchId, reason: "quick_taps_reask", idempotency_key: `quick-taps-reask:v1:${oldBatchId}:${jobId}:left` },
    "Quick taps re-asked (owner tapped flat roof by mistake) — out of the old batch, into a fresh one for the same installer");
  const { sendBatch } = await import("./area-batch.server");
  const { firstName } = await import("./worker-links.core");
  // If this send is refused after the reopen, running the script again (e.g. after 7am) finishes it.
  const r = await sendBatch([jobId], out.installerId, opts.actorId, { now, ownerText: (name, link) => reaskText(firstName(name) || "there", link), emailOwner: false, reask: true });
  out.newBatchId = r.batchId;
  out.text = r.texts.map((t) => `${t.status}: ${t.detail}`).join("; ") || null;
  return out;
}

// A48 batch 2 (spec part 1 + Jo's 30 Oct amendment): the owner's quick taps on My job `?screen=taps`. I/O only — the
// rules are in quick-taps.core.ts. Every function takes ONLY the owner's secure My job link token (the ACTIVE
// step3_estimate customer_estimate_links row); the job comes from the token, never from the page.
// - quickTapsState: what the screen shows. Not in a batch asking for taps (or the job is closed) → `none`.
// - saveQuickTapsDetails: the name / address taps ("Change it" or typed). Saved through the ONE audited enquiry details
//   save (office-actions.server saveEnquiryDetails, event `quick_taps_details_saved`). A changed address is re-located
//   (old `coordinates` fact superseded, ensurePropertyCoordinates); over 10 km from the batch centre → the home leaves the
//   batch (area-batch.server leaveBatchIfMoved) and goes back in the pool — the owner is not told and carries on.
// - saveQuickTaps: the answers. ONE `quick_taps_answered {batch_id, answers, consent_share, outcome}` per job + batch,
//   claimed before anything else happens (a second save, or a second device, gets the same outcome and nothing more).
//   Blank website answers are written onto enrichment.base44.declared (blanks only, never overwriting). Pass → the
//   existing `trade_contact_share` owner gate (the "Yes, let's go" tap is the consent). Declines → cancelJobFully with the
//   matching reason (no O69 cancel notice: the owner gets this decline email instead) + the matching approved email
//   (TEST → test-send; real → customer comms + consent, then the guarded owner email sender with a once-only key).
// Nothing here raises a Needs me row.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkflowError, logEvent } from "./workflow.server";
import { AREA_BATCH_EVENTS, AREA_BATCH_SENT_EVENT, tapsBatchId, type AreaBatchEventRow } from "./area-batch.core";
import {
  QUICK_TAPS_ANSWERED_EVENT, QUICK_TAPS_DECLINE_REASON, tapOutcome, websiteQuestions,
  type FinalOutcome, type QuickTapAnswers, type QuickTapsView, type WebsiteAnswers, type WebsiteFacts, type WebsiteKey,
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
function batchOf(c: Ctx): { batchId: string | null; answered: Ev | null } {
  const batchId = tapsBatchId(c.events);
  const latestSent = c.events.filter((e) => e.event_type === AREA_BATCH_SENT_EVENT).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const forBatch = batchId ?? (latestSent ? bid(latestSent) : null);
  const answered = forBatch ? c.events.find((e) => e.event_type === QUICK_TAPS_ANSWERED_EVENT && bid(e) === forBatch) ?? null : null;
  return { batchId, answered };
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
  const { batchId, answered } = batchOf(c);
  if (answered) {
    const o = str((answered.details as { outcome?: unknown } | null)?.outcome);
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
  return c ? viewOf(c) : { kind: "none" };
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
  const moved = !same(saved.street, before.street) || !same(saved.suburb, before.suburb) || !same(saved.postcode, before.postcode);
  if (moved && prop?.id) {
    // The old location belongs to the old address: superseded (kept as history), then the new one is looked up once.
    await loose.from("property_facts").update({ is_current: false, superseded_at: new Date().toISOString() }).eq("property_id", prop.id).eq("fact_key", "coordinates").eq("is_current", true);
    const { ensurePropertyCoordinates } = await import("./property-coordinates.server");
    const B = await import("./area-batch.server");
    const point = propertyPoint(await ensurePropertyCoordinates(jobId, prop.id)) ?? (await B.postcodeCentre(saved.postcode));
    await B.leaveBatchIfMoved(jobId, batchId, point);
  }
  return { ok: true, name: saved.fullName, address: formatPropertyAddress({ address_line: saved.street, suburb: saved.suburb, state: "VIC", postcode: saved.postcode }) };
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

/** One claim per job + batch: false = already answered (unique key, or the read-then-insert check). */
async function claimAnswer(jobId: string, details: Record<string, unknown>, summary: string): Promise<boolean> {
  const key = String(details["idempotency_key"]);
  const { data: prior, error: pe } = await loose.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", QUICK_TAPS_ANSWERED_EVENT).contains("details", { idempotency_key: key }).limit(1);
  if (pe) throw new Error(`Could not check the answers: ${pe.message}`);
  if ((prior ?? []).length) return false;
  const { error } = await loose.from("workflow_events").insert({ job_id: jobId, actor_id: null, event_type: QUICK_TAPS_ANSWERED_EVENT, summary, details, internal: true });
  if (error) { if (error.code === "23505") return false; throw new Error(`Could not save the answers: ${error.message}`); }
  return true;
}

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
  if (view.kind === "done") return view;
  if (view.kind !== "ask") throw new WorkflowError(DEAD);
  if (!view.name) throw new WorkflowError(NAME_NEEDED);
  if (!view.address) throw new WorkflowError(FULL_STREET_NEEDED);
  const batchId = batchOf(c).batchId!;
  const blanks = websiteQuestions(view.website, answers.website ?? {});
  const outcome = tapOutcome(answers, blanks);
  if (outcome === "incomplete") throw new WorkflowError("Please answer each question.");
  const website = Object.fromEntries(blanks.filter((k) => answers.website?.[k]).map((k) => [k, answers.website![k]!]));
  await storeWebsiteAnswers(c, website, blanks);
  const stored = {
    name: view.name, address: view.address, hatch: answers.hatch ?? null, roof: answers.roof ?? null, five_years: answers.five_years ?? null, go: answers.go ?? null,
    ...(Object.keys(website).length ? { website } : {}),
  };
  const won = await claimAnswer(jobId, { batch_id: batchId, answers: stored, consent_share: outcome === "pass", outcome, idempotency_key: `quick-taps:v1:${batchId}:${jobId}:answered` }, SUMMARY[outcome]);
  if (!won) { const again = await load(jobId); return again ? viewOf(again) : { kind: "none" }; }

  if (outcome === "pass") {
    // The "Yes, let's go — you can share my name and number…" tap is the owner's consent: the existing owner gate record.
    try {
      const { signGateDoc } = await import("./owner-gates.server");
      await signGateDoc({ jobId, key: "trade_contact_share", signatoryName: view.name, ticked: true, answers: {}, method: "link_code", signedBy: null, ip: meta.ip, userAgent: meta.userAgent });
    } catch (e) {
      await logEvent(jobId, null, "quick_taps_share_not_recorded", `Quick taps: the owner's consent to share is in their answers, but the "Sharing with your tradies" record could not be saved: ${(e as Error).message}`, { batch_id: batchId, error: (e as Error).message }, { internal: true });
    }
    return { kind: "done", outcome };
  }
  try {
    const { cancelJobFully } = await import("./office-actions.server");
    await cancelJobFully(jobId, QUICK_TAPS_DECLINE_REASON[outcome], null, { tell: { owner: false, installer: false } });
  } catch (e) {
    await logEvent(jobId, null, "quick_taps_close_failed", `Quick taps: the job could not be closed: ${(e as Error).message}`, { batch_id: batchId, outcome, error: (e as Error).message }, { internal: true });
  }
  await emailDecline(c, batchId, outcome);
  return { kind: "done", outcome };
}

/** The matching approved decline email, once (TEST → test-send; real → guarded owner email with a once-only key). */
async function emailDecline(c: Ctx, batchId: string, outcome: Exclude<FinalOutcome, "pass">) {
  const jobId = c.job.id;
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


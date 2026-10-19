import { partnerAllowedForJob } from "./test-send.core";
// Contractor allocation + direct coordination persistence. Pure rules: allocation.core.ts.
// Never moves stages itself; acceptance is atomic in SQL (accept_partner_offer, migration 0086).
import { workerOfferBlocker } from "./worker-compliance.core";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { WorkflowError, logEvent, piesaRequestFacts } from "./workflow.server";
import { credentialState, electricianWorkEligibility, requiredCredentialKinds, verifiedServiceAreaMatch, partnerWorkBlocker, type BusinessLike } from "./pilot.core";
import {
  ACCEPT_OUTCOME_MESSAGE, OWNER_CONTACT_NOTICE, TRADE_CONTACT_NOTICE, anonymisedOffer, coordinationState, electricalClearance,
  nextOfferBatch, offerExpiryBusinessHours, piesaOfferBlockers, rankRecCandidates, recEligibilityBlocker, type RecCandidate, type VisitKind,
} from "./allocation.core";
import { melbourneYmd } from "./piesa-windows.core";
import { melbourneToday } from "@/lib/melbourne-time.core";

const NONE = ["00000000-0000-0000-0000-000000000000"];

async function settings() {
  const { data } = await admin.from("workflow_settings").select("rec_offer_business_hours, rec_offer_batch_size").eq("id", 1).maybeSingle();
  return { businessHours: Number(data?.rec_offer_business_hours ?? 4), batchSize: Number(data?.rec_offer_batch_size ?? 3) };
}

/** Facts used to judge each REC for a job. Price is loaded for display only. */
export async function recCandidatesFor(jobId: string): Promise<{ postcode: string | null; installerSourced: boolean; candidates: (RecCandidate & { blocker: string | null })[] }> {
  const { data: job } = await admin.from("jobs").select("id, source, channel, properties(postcode)").eq("id", jobId).single();
  const postcode = (job?.properties as { postcode: string | null } | null)?.postcode ?? null;
  const installerSourced = job?.channel === "installer_sourced";
  const { data: allBizs } = await admin.from("businesses").select("*").or("business_type.eq.rec,capabilities.cs.{electrician}");
  const bizs = (allBizs ?? []).filter((b) => partnerAllowedForJob(b, job?.source));
  const ids = (bizs ?? []).map((b) => b.id);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  // Owner's current PIESA windows (if any): availability, daily limit and "nearby that day" are judged on these.
  const win = await currentWindowRound(jobId);
  const { data: winRows } = win.round > 0
    ? await admin.from("appointment_proposals").select("starts_at, ends_at").eq("job_id", jobId).eq("piesa_window_round", win.round).eq("status", "proposed")
    : { data: [] as { starts_at: string; ends_at: string | null }[] };
  const windows = (winRows ?? []).map((w) => ({ s: Date.parse(w.starts_at), e: Date.parse(w.ends_at ?? w.starts_at), day: melbourneYmd(new Date(w.starts_at)) }));
  const windowDays = new Set(windows.map((w) => w.day));
  const [{ data: creds }, { data: workers }, { data: asg }, { data: offers }, { data: prefs }, { data: bks }] = await Promise.all([
    admin.from("business_credentials").select("business_id,kind,label,expires_at,critical,verification").in("business_id", ids.length ? ids : NONE),
    admin.from("partner_workers").select("business_id, trade_role, licence_expires_on").eq("trade_role", "electrician").eq("approval_status", "approved").is("removed_at", null).in("business_id", ids.length ? ids : NONE),
    admin.from("job_assignments").select("business_id").eq("role", "electrician").eq("active", true).in("business_id", ids.length ? ids : NONE),
    admin.from("partner_offers").select("business_id, status, offered_at, responded_at").in("kind", ["piesa", "rectification"]).gte("offered_at", since).in("business_id", ids.length ? ids : NONE),
    admin.from("partner_relationships").select("electrician_business_id, installer_business_id").eq("active", true),
    windows.length
      ? admin.from("bookings").select("business_id, scheduled_start, scheduled_end, jobs!inner(deleted_at, properties(postcode))").is("jobs.deleted_at", null).eq("status", "confirmed").in("business_id", ids.length ? ids : NONE)
          .gte("scheduled_start", new Date(Math.min(...windows.map((w) => w.s)) - 86_400_000).toISOString())
          .lte("scheduled_start", new Date(Math.max(...windows.map((w) => w.e)) + 86_400_000).toISOString())
      : Promise.resolve({ data: [] as { business_id: string | null; scheduled_start: string; scheduled_end: string | null; jobs: unknown }[] }),
  ]);
  const { data: inst } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  // The installer's choice on this job is offered first; otherwise their preferred electricians (Jo, 7 Oct).
  const { firstOfferedElectrician } = await import("./job-electrician.core");
  const preferred = firstOfferedElectrician(await (await import("./job-electrician.server")).jobChosenElectrician(jobId), (prefs ?? [])
    .filter((r) => r.installer_business_id === inst?.business_id).map((r) => r.electrician_business_id));
  const rel = await (await import("./visit-events.server")).reliabilityFor(ids);
  const { acceptanceWithCancellations } = await import("./visit-events.core");
  const candidates = (bizs ?? []).map((b) => {
    const bc = (creds ?? []).filter((c) => c.business_id === b.id);
    const mine = (offers ?? []).filter((o) => o.business_id === b.id);
    const answered = mine.filter((o) => o.status !== "pending");
    const accepted = mine.filter((o) => o.status === "accepted" && o.responded_at);
    const myBookings = (bks ?? []).filter((k) => k.business_id === b.id).map((k) => ({
      s: Date.parse(k.scheduled_start), e: Date.parse(k.scheduled_end ?? k.scheduled_start), day: melbourneYmd(new Date(k.scheduled_start)),
      postcode: ((k.jobs as { properties?: { postcode?: string | null } | null } | null)?.properties?.postcode) ?? null,
    }));
    const perDay = new Map<string, number>();
    for (const k of myBookings) if (windowDays.has(k.day)) perDay.set(k.day, (perDay.get(k.day) ?? 0) + 1);
    const covers = (pc: string | null) => !!pc && (pc === postcode || !!b.service_postcodes?.includes(pc));
    const licenceKinds = requiredCredentialKinds(b as unknown as BusinessLike).filter((k) => k === "electrical_licence" || k === "rec_registration");
    const verifiedCurrent = (kind: string) => bc.some((c) => c.kind === kind && c.verification === "verified" && credentialState(c) !== "expired");
    const c: RecCandidate = {
      business_id: b.id, name: b.name, is_active: b.is_active, onboarding_status: b.onboarding_status,
      accepting_new_jobs: b.accepting_new_jobs ?? null, receives_hivic_leads: b.receives_hivic_leads ?? null,
      coverage_verified: !!b.coverage_verified_at, covers_postcode: verifiedServiceAreaMatch(b, postcode),
      exact_postcode: !!postcode && !!b.service_postcodes?.includes(postcode),
      // G: a non-empty licence/rec number is NOT proof of a verified, current licence.
      // Only verified, unexpired electrical_licence / rec_registration credentials count.
      has_valid_licence: !!b.rec_number && licenceKinds.every(verifiedCurrent) && !partnerWorkBlocker(b as unknown as BusinessLike, bc),
      // Expired electrical licence: that electrician can't receive new offers.
      approved_workers: (workers ?? []).filter((w) => w.business_id === b.id && !workerOfferBlocker(w as never, melbourneYmd(new Date()))).length,
      weekly_capacity: b.weekly_capacity ?? null, open_jobs: (asg ?? []).filter((a) => a.business_id === b.id).length,
      recent_offers_30d: mine.length, acceptance_rate: acceptanceWithCancellations(answered.filter((o) => o.status === "accepted").length, answered.length, rel.get(b.id)?.trade_cancellations ?? 0),
      preferred: preferred.has(b.id),
      free_in_window: windows.length ? windows.some((w) => !myBookings.some((k) => k.s < w.e && k.e > w.s)) : null,
      nearby_job_that_day: myBookings.some((k) => windowDays.has(k.day) && covers(k.postcode)),
      no_shows: rel.get(b.id)?.no_shows ?? 0, evidence_rejections: rel.get(b.id)?.evidence_rejections ?? 0,
      recent_jobs_30d: accepted.length,
      avg_accept_hours: accepted.length ? accepted.reduce((t, o) => t + (Date.parse(o.responded_at!) - Date.parse(o.offered_at)) / 3_600_000, 0) / accepted.length : null,
    };
    return { ...c, blocker: recEligibilityBlocker(c) };
  });
  return { postcode, installerSourced, candidates };
}

async function offerFacts(jobId: string) {
  const [{ data: j }, { data: m }, { data: rc }] = await Promise.all([
    admin.from("jobs").select("job_number, properties(suburb, postcode)").eq("id", jobId).single(),
    admin.from("ceiling_measurements").select("measured_area_m2, verified_area_m2, access_difficulty, evidence_notes").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("rectification_items").select("description").eq("job_id", jobId).limit(6),
  ]);
  const p = j?.properties as { suburb: string | null; postcode: string | null } | null;
  return anonymisedOffer({
    job_number: j?.job_number ?? "", suburb: p?.suburb ?? null, postcode: p?.postcode ?? null,
    measured_area_m2: m?.verified_area_m2 ?? m?.measured_area_m2 ?? null,
    access_summary: m?.access_difficulty ? `Ceiling access: ${String(m.access_difficulty).replace(/_/g, " ")}` : null,
    observations: (rc ?? []).map((r) => r.description).filter((d): d is string => !!d),
    electrician_rate_inc_gst: null, // filled per electrician from their own agreed rate card (never the customer price)
  });
}

/** Office starts (or continues) PIESA allocation. Refuses before the PIESA gate is satisfied. */
/** Each electrician's own agreed rate for this visit, from their active (non-test) approved rate card. Missing = null. */
/** Current ACTIVE office-approved rate per business for this offer kind (electrician_rates, migration 0089).
 *  Fails closed: if the rate table is missing or unreadable every electrician counts as "rate missing". */
export async function agreedElectricianRates(businessIds: string[], kind: "piesa" | "rectification") {
  const out = new Map<string, { id: string; rate: number }>();
  if (!businessIds.length) return out;
  const { OFFER_RATE_SERVICE, selectAgreedRate } = await import("./allocation.core");
  const service = OFFER_RATE_SERVICE[kind];
  const { data, error } = await (admin as unknown as { from: (t: string) => any }).from("electrician_rates") // eslint-disable-line @typescript-eslint/no-explicit-any
    .select("id, business_id, service_type, rate_inc_gst, status, effective_from, effective_to").eq("status", "active").eq("service_type", service).in("business_id", businessIds);
  if (error) return out;
  const today = melbourneToday();
  for (const b of businessIds) {
    const r = selectAgreedRate(data ?? [], b, service, today);
    if (r) out.set(b, { id: r.id, rate: Number(r.rate_inc_gst) });
  }
  return out;
}

/**
 * Taking one of the owner's PIESA times is two steps: the database takes the offer AND the time atomically
 * (`accept_partner_offer_slot`), then `confirmBooking` writes the visit and moves the job to `piesa_scheduled`.
 * If the second step never finishes — the request is cut off, or a later gate throws — the job is left holding a
 * confirmed visit while the office still reads "Waiting for an electrician to take one of the owner's PIESA times",
 * and the electrician already reads "Booked". Nothing repaired that: new offers are refused while an active
 * electrician exists, so the job could never catch up (P1 UAT DEF-09, HV-2594).
 *
 * This moves the stage only when the evidence for the move already exists (a confirmed assessment visit AND an
 * electrician assignment whose visit is confirmed) and the normal stage-entry blockers are clear. Idempotent:
 * it does nothing at any other stage, and a blocked job stays where it is.
 */
export async function healStrandedPiesaStage(jobId: string, actorId: string | null): Promise<boolean> {
  const { data: j } = await admin.from("jobs").select("stage").eq("id", jobId).single();
  if (j?.stage !== "piesa_and_install_window_pending") return false;
  const [{ data: bk }, { data: asg }] = await Promise.all([
    admin.from("bookings").select("id, scheduled_start").eq("job_id", jobId).eq("kind", "assessment").eq("status", "confirmed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("job_assignments").select("id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).not("booking_confirmed_at", "is", null).maybeSingle(),
  ]);
  if (!bk?.scheduled_start || !asg) return false;
  const when = new Date(bk.scheduled_start).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" });
  const { transition } = await import("./workflow.server");
  try {
    await transition(jobId, "piesa_scheduled", actorId, `PIESA booked for ${when} — stage caught up with the booking`, { booking_id: bk.id, assignment_id: asg.id, healed: true });
    return true;
  } catch {
    return false; // still blocked: leave the job exactly as it is and let the gate speak for itself
  }
}

export async function startPiesaAllocation(jobId: string, actorId: string | null, kind: "piesa" | "rectification" = "piesa", opts: { rateToConfirm?: boolean; onlyBusiness?: string | string[]; adding?: boolean } = {}): Promise<PiesaAllocationResult> {
  // Catch up a job whose acceptance was taken but never moved the stage (see healStrandedPiesaStage).
  // Without this the office's next click was refused with "An electrician has already accepted this PIESA."
  // and the job had no way back to piesa_scheduled.
  if (await healStrandedPiesaStage(jobId, actorId)) return { offered: 0, exhausted: false, healed: true };
  const [facts, { count: elec }, { count: open }] = await Promise.all([
    piesaRequestFacts(jobId),
    // Only an electrician who actually CONFIRMED a visit counts as "already accepted": a pre-assignment
    // (e.g. a Test Centre persona row) is not a booking, so it must not block new PIESA offers (DEF-07).
    admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", "electrician").eq("active", true).not("booking_confirmed_at", "is", null),
    admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", kind).eq("status", "pending"),
  ]);
  const blockers = piesaOfferBlockers({ ...facts, hasActiveElectrician: !!elec, hasOpenOffers: !!open && !opts.adding });
  if (blockers.length) throw new WorkflowError(`${kind === "piesa" ? "PIESA" : "Fix-up"} offers cannot start: ${blockers.join(" ")}`);
  await (await import("./owner-gates.server")).assertGateA(jobId, kind === "piesa" ? "Safety check offers" : "Fix-up offers");
  if (kind === "piesa") {
    // The job must be able to ENTER the PIESA stage before any offer goes out; otherwise offers are sent and the
    // stage move afterwards is refused (Gate B etc.), stranding live offers on a job electricians cannot book.
    const { data: cur } = await admin.from("jobs").select("stage").eq("id", jobId).single();
    if (cur?.stage === "measured_quote_accepted") {
      const entry = await (await import("./workflow.server")).stageEntryBlockers(jobId, "piesa_and_install_window_pending", actorId);
      if (entry.length) throw new WorkflowError(`PIESA offers cannot start: ${entry.join(" ")}`);
    }
  }
  if (!opts.adding && !(await claimRecOfferBatch(jobId, kind))) throw new WorkflowError("Offers are already being prepared for this job. Refresh in a moment.");
  const res = await offerNextBatch(jobId, actorId, kind, !!opts.rateToConfirm, opts.onlyBusiness);
  // Offers started: move the accepted-quote job to the PIESA stage so electricians can accept a time.
  if (kind === "piesa" && res.offered > 0) {
    const { data: j } = await admin.from("jobs").select("stage").eq("id", jobId).single();
    if (j?.stage === "measured_quote_accepted") await (await import("./workflow.server")).transition(jobId, "piesa_and_install_window_pending", actorId, "PIESA offers sent to electricians", { kind });
  }
  // Nothing was actually sent: say so instead of reporting success (P1 UAT DEF-08).
  if (res.offered === 0) {
    const { noOfferMessage } = await import("./allocation.core");
    throw new WorkflowError(noOfferMessage(kind, res.reason ?? "coverage"));
  }
  return res;
}

async function claimRecOfferBatch(jobId: string, kind: "piesa" | "rectification") {
  const { data, error } = await admin.rpc("claim_rec_offer_batch" as never, { _job: jobId, _kind: kind } as never);
  if (error) {
    // Staged migration 0203 not applied yet: keep the pre-0203 behaviour (no extra lock; the existing one-pending-offer
    // per business rule and atomic acceptance still apply) instead of blocking every PIESA / fix-up offer.
    const { isMissingDbObject } = await import("./schema-compat.core");
    if (isMissingDbObject(error)) { console.warn("claim_rec_offer_batch not deployed (staged 0203); continuing without the batch lock"); return true; }
    throw new Error(error.message);
  }
  return data === true;
}

/** What one allocation attempt actually did. `reason` explains a zero-offer result (P1 UAT DEF-08). */
export type OfferBatchResult = { offered: number; exhausted: boolean; reason?: "owner_times" | "coverage" };
/** `healed` = the call repaired a stranded acceptance instead of sending new offers (P1 UAT DEF-09). */
export type PiesaAllocationResult = OfferBatchResult & { healed?: boolean };

async function offerNextBatch(jobId: string, actorId: string | null, kind: "piesa" | "rectification", rateToConfirm = false, onlyBusiness?: string | string[]): Promise<OfferBatchResult> {
  const { businessHours, batchSize } = await settings();
  const [{ candidates, installerSourced }, { data: prior }] = await Promise.all([
    recCandidatesFor(jobId),
    admin.from("partner_offers").select("business_id, batch, offered_at").eq("job_id", jobId).eq("kind", kind),
  ]);
  const batchNo = Math.max(0, ...(prior ?? []).map((o) => o.batch)) + 1;
  const rates = await agreedElectricianRates(candidates.map((c) => c.business_id), kind);
  const { offerRateBlocker } = await import("./allocation.core");
  const summary = await offerFacts(jobId);
  const expires = offerExpiryBusinessHours(new Date(), businessHours);
  const row = (id: string, chosen: boolean) => ({ job_id: jobId, business_id: id, kind, batch: batchNo,
    summary: { ...summary, electrician_rate_inc_gst: rates.get(id)?.rate ?? null, electrician_rate_id: rates.get(id)?.id ?? null, electrician_rate_snapshot_at: new Date().toISOString(), rate_to_confirm: !rates.has(id) && rateToConfirm, ...(chosen ? { office_choice: true } : {}) } as unknown as Json, offered_by: actorId, expires_at: expires });
  if (onlyBusiness) {
    // Office picked these electricians: same offer card and owner times, sent only to them.
    const picks = Array.isArray(onlyBusiness) ? onlyBusiness : [onlyBusiness];
    const chosen = picks.map((id) => {
      const c = candidates.find((x) => x.business_id === id);
      if (!c) throw new WorkflowError("One of those electricians isn't an approved electrician for this job.");
      if (c.blocker) throw new WorkflowError(`${c.name} can't take this job: ${c.blocker}`);
      if (offerRateBlocker(rates.get(c.business_id)?.rate ?? null, rateToConfirm)) throw new WorkflowError(`${c.name} has no agreed electrician rate recorded. Add their rate first, or offer with rate to be confirmed.`);
      return c;
    });
    const exp = await (await import("./offer-dispatch.server")).chosenOfferExpiry();
    await (await import("./offer-guard.server")).assertOfferPairsAllowed(jobId, chosen.map((c) => c.business_id));
    const { error } = await admin.from("partner_offers").insert(chosen.map((c) => ({ ...row(c.business_id, true), expires_at: exp })));
    if (error) throw new Error(error.message);
    await logEvent(jobId, actorId, "trade_chosen_by_office", `Office chose ${chosen.map((c) => c.name).join(", ")} for the ${kind === "piesa" ? "PIESA" : "fix-up"} — offer sent only to ${chosen.length === 1 ? "them" : `these ${chosen.length}`}`, { kind, business_ids: chosen.map((c) => c.business_id), business_names: chosen.map((c) => c.name), business_id: chosen[0]?.business_id, business_name: chosen[0]?.name, expires_at: exp }, { internal: true });
    return { offered: chosen.length, exhausted: false };
  }
  // Owner-picked times: a fresh round (owner gave more times) re-offers to every approved electrician.
  const win = kind === "piesa" ? await currentWindowRound(jobId) : null;
  const priorInRound = (prior ?? []).filter((o) => !win?.roundStart || ((o as { offered_at?: string }).offered_at ?? "") >= win.roundStart);
  const offered = new Set(priorInRound.map((o) => o.business_id));
  const noRate = candidates.filter((c) => offerRateBlocker(rates.get(c.business_id)?.rate ?? null, rateToConfirm));
  if (noRate.length) await logEvent(jobId, actorId, "rec_offer_rate_missing", `${noRate.length} electrician(s) skipped: no agreed electrician rate recorded`, { kind, businesses: noRate.map((c) => c.business_id) }, { internal: true });
  const priced = candidates.filter((c) => !noRate.includes(c));
  const batch = nextOfferBatch(rankRecCandidates(priced, { installerSourced }), offered, batchSize, { installerSourced });
  if (!batch.length) {
    if (win && win.round > 0 && await windowsNoTaker(jobId, actorId, win.round)) return { offered: 0, exhausted: true, reason: "owner_times" as const };
    await logEvent(jobId, actorId, "rec_coverage_exhausted", `No approved electrician left to offer the ${kind} to — needs Home Insulation Victoria`, { kind, offered: [...offered] }, { internal: true });
    await admin.from("jobs").update({ next_action: "Needs Home Insulation Victoria: no approved electrician coverage" }).eq("id", jobId);
    return { offered: 0, exhausted: true, reason: "coverage" as const };
  }
  await (await import("./offer-guard.server")).assertOfferPairsAllowed(jobId, batch.map((b) => b.business_id));
  const { error } = await admin.from("partner_offers").insert(batch.map((b) => row(b.business_id, false)));
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, "rec_offers_made", `${kind === "piesa" ? "PIESA" : "Rectification"} offered to ${batch.length} approved electrician(s), batch ${batchNo}`, { kind, batch: batchNo, businesses: batch.map((b) => b.business_id), expires_at: expires }, { internal: true });
  return { offered: batch.length, exhausted: false };
}

/** True when the latest offer of this kind was an office pick that was declined/expired: stop auto-refill, wait for the office. */
export async function officePickUnanswered(jobId: string, kind: "piesa" | "rectification" | "ready_check") {
  const { data } = await admin.from("partner_offers").select("kind, status, offered_at, summary").eq("job_id", jobId).eq("kind", kind).order("offered_at", { ascending: false }).limit(1);
  const { chosenTradeNoAnswer } = await import("./trade-choice.core");
  return !!chosenTradeNoAnswer(data ?? [], kind);
}

/** Expire overdue electrician offers and automatically offer the next batch. Idempotent; safe to call often. */
export async function sweepRecOffers(actorId: string | null = null) {
  const nowIso = new Date().toISOString();
  const { data: expired } = await admin.from("partner_offers").update({ status: "expired" }).in("kind", ["piesa", "rectification"]).eq("status", "pending").lt("expires_at", nowIso).select("job_id, kind");
  for (const o of expired ?? []) await logEvent(o.job_id, actorId, "partner_offer_expired", `An electrician ${o.kind} offer expired without a response`, { kind: o.kind }, { internal: true });
  const jobs = new Map((expired ?? []).map((o) => [`${o.job_id}:${o.kind}`, o]));
  for (const o of jobs.values()) await refillIfNeeded(o.job_id, o.kind as "piesa" | "rectification", actorId);
  await sweepPiesaWindows(actorId);
  const started = await autoStartPiesaOffers(actorId);
  await flagUnapprovedElectricians(actorId);
  // Stranded acceptances (P1 UAT DEF-09): a confirmed PIESA visit on a job still reading "waiting for an electrician".
  // Bounded, idempotent, and only ever moves a job whose visit evidence already exists.
  const { data: stranded } = await admin.from("bookings").select("job_id, jobs!inner(stage)").eq("kind", "assessment").eq("status", "confirmed").eq("jobs.stage", "piesa_and_install_window_pending").limit(50);
  let healed = 0;
  for (const s of stranded ?? []) if (await healStrandedPiesaStage(s.job_id, actorId)) healed++;
  return { expired: expired?.length ?? 0, started, healed };
}

/** Jobs that have genuinely reached PIESA (gate cleared) with no electrician and no offers yet get the first batch automatically.
 *  startPiesaAllocation re-checks every upstream gate; any blocker means the job is skipped, never forced. */
async function autoStartPiesaOffers(actorId: string | null) {
  const { data: waiting } = await admin.from("jobs").select("id").eq("stage", "piesa_and_install_window_pending").neq("source", "qa_test");
  let started = 0;
  for (const j of waiting ?? []) {
    const { count: any } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", j.id).eq("kind", "piesa");
    if (any) continue; // already allocated once; refill/exhaustion handles the rest
    if (await (await import("./offer-dispatch.server")).jobOfficePicks(j.id)) continue; // waits in Needs me: "Choose trades for this job"
    try { await startPiesaAllocation(j.id, actorId); started++; } catch { /* gate not cleared: stay put */ }
  }
  return started;
}

/** Assigned electrician who is no longer an approved/eligible REC -> one Needs Home Insulation Victoria event (no silent stall, no auto-swap). */
async function flagUnapprovedElectricians(actorId: string | null) {
  const stages = ["piesa_and_install_window_pending", "piesa_scheduled", "piesa_complete", "electrical_variation_pending", "rectification_required", "awaiting_owner_rectification_approval", "rectification_scheduling", "rectification_booked"];
  const { data: asg } = await admin.from("job_assignments").select("job_id, business_id, jobs!inner(stage, source)").eq("role", "electrician").eq("active", true).not("business_id", "is", null).in("jobs.stage", stages as never);
  for (const a of asg ?? []) {
    if ((a.jobs as { source: string | null }).source === "qa_test") continue;
    const { candidates } = await recCandidatesFor(a.job_id);
    const c = candidates.find((x) => x.business_id === a.business_id);
    // Capacity is irrelevant once assigned; only approval, credentials, workers and coverage matter here.
    const blocker = c ? recEligibilityBlocker({ ...c, accepting_new_jobs: true, free_in_window: null }) : "Business is no longer an approved REC.";
    if (!blocker) continue;
    const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", a.job_id).eq("event_type", "rec_no_longer_approved").contains("details", { business_id: a.business_id });
    if (!count) await logEvent(a.job_id, actorId, "rec_no_longer_approved", "Assigned electrician is no longer an approved REC — needs Home Insulation Victoria", { business_id: a.business_id, blocker }, { internal: true });
  }
}

async function refillIfNeeded(jobId: string, kind: "piesa" | "rectification", actorId: string | null) {
  const [{ count: open }, { count: elec }] = await Promise.all([
    admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", kind).eq("status", "pending"),
    admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", "electrician").eq("active", true),
  ]);
  if (open || elec) return;
  if (kind === "piesa") {
    // Only re-offer while the job is genuinely waiting for a PIESA electrician and its PIESA gate is still clear.
    const { data: j } = await admin.from("jobs").select("stage").eq("id", jobId).single();
    if (j?.stage !== "piesa_and_install_window_pending") return;
    const { piesaRequestBlockers } = await import("./payment-gate.core");
    if (piesaRequestBlockers(await piesaRequestFacts(jobId)).length) return;
  }
  // Office-picked trade said no / ran out: Needs me shows "Pick another" or "Send to all". Never auto-widen.
  if (await officePickUnanswered(jobId, kind)) return;
  if (await (await import("./offer-dispatch.server")).jobOfficePicks(jobId)) return; // office picks: Needs me shows "add more trades"
  if (!(await claimRecOfferBatch(jobId, kind))) return;
  await offerNextBatch(jobId, actorId, kind);
}

/** Electrician accepts/declines a PIESA or rectification offer. Acceptance is atomic in SQL. */
export async function respondToRecOffer(offerId: string, userId: string, accept: boolean, reason: string | null, proposalId: string | null = null) {
  const { data: o } = await admin.from("partner_offers").select("id, job_id, kind, status, business_id, summary").eq("id", offerId).single();
  if (!o) throw new WorkflowError("Offer not found.");
  if (accept) {
    const { offerRateBlocker } = await import("./allocation.core");
    const sm = (o.summary ?? {}) as { electrician_rate_inc_gst?: number | null; rate_to_confirm?: boolean };
    if (offerRateBlocker(sm.electrician_rate_inc_gst ?? null, !!sm.rate_to_confirm)) throw new WorkflowError("This offer has no agreed electrician rate yet. Home Insulation Victoria will confirm the rate before it can be accepted.");
  }
  if (!accept) {
    const { data: d } = await admin.from("partner_offers").update({ status: "declined", responded_by: userId, responded_at: new Date().toISOString(), decline_reason: reason }).eq("id", o.id).eq("status", "pending").select("id").maybeSingle();
    if (!d) throw new WorkflowError("This offer is no longer open.");
    await logEvent(o.job_id, userId, "partner_offer_declined", `Electrician declined the ${o.kind} offer`, { reason, business_id: o.business_id }, { internal: true });
    await refillIfNeeded(o.job_id, o.kind as "piesa" | "rectification", null);
    return { ok: true };
  }
  const { data: isElec } = await admin.rpc("has_role", { _user_id: userId, _role: "electrician" });
  if (!isElec) throw new WorkflowError("Only a licensed electrician team member can accept this job.");
  // Phase 2 compliance: the accepting REC must still satisfy mandatory electrician eligibility before the
  // atomic SQL acceptance inserts a job_assignment / triggers downstream notifications.
  if (o.business_id) {
    const [{ data: business }, { data: creds }, { data: workers }] = await Promise.all([
      admin.from("businesses").select("*").eq("id", o.business_id).maybeSingle(),
      admin.from("business_credentials").select("kind,label,expires_at,critical,verification").eq("business_id", o.business_id),
      admin.from("partner_workers").select("trade_role,licence_expires_on,approval_status,removed_at").eq("business_id", o.business_id).eq("trade_role", "electrician"),
    ]);
    const blocker = electricianWorkEligibility(business as never, creds as never, workers as never);
    if (blocker) throw new WorkflowError(`Electrician offer acceptance blocked: ${blocker}`);
  }
  if (o.kind === "piesa") {
    const { piesaRequestFacts } = await import("./workflow.server");
    const { piesaRequestBlockers } = await import("./payment-gate.core");
    const gate = piesaRequestBlockers(await piesaRequestFacts(o.job_id));
    if (gate.length) throw new WorkflowError(`This job is not ready for a PIESA: ${gate.join(" ")}`);
    // Self-heal a stranded allocation: an earlier offer may have been created while the job could not yet enter the
    // PIESA stage (a stage-entry gate — owner paperwork or the safety-check payment — was not met then). The database
    // acceptance is guarded on the job being exactly at piesa_and_install_window_pending, so the offer would be stuck
    // and the electrician would see "This job is no longer ready for this visit." Bring the job up to the PIESA stage
    // first; the guarded, idempotent move re-checks every gate, so a genuinely blocked job still surfaces exactly what
    // is outstanding instead of failing opaquely. (Restored after the 19 Oct working-tree overlay dropped it.)
    const { data: j } = await admin.from("jobs").select("stage").eq("id", o.job_id).single();
    if (j?.stage === "measured_quote_accepted")
      await (await import("./workflow.server")).transition(o.job_id, "piesa_and_install_window_pending", userId, "PIESA offers sent to electricians", { kind: o.kind });
  }
  if (proposalId && o.kind === "piesa") {
    // Tapping one of the owner's times: accept + take the time in one locked database step; first tap wins.
    const { data, error } = await admin.rpc("accept_partner_offer_slot" as never, { _offer: offerId, _user: userId, _proposal: proposalId } as never);
    if (error) throw new Error(error.message);
    const outcome = ((data as unknown as { outcome: string }[] | null)?.[0]?.outcome) ?? "not_found";
    if (outcome === "slot_unavailable") throw new WorkflowError("That time is no longer available. Please choose another time.");
    if (outcome === "already_assigned" || outcome === "already_withdrawn" || outcome === "already_accepted") throw new WorkflowError("This job has just been taken.");
    if (outcome !== "accepted") throw new WorkflowError(ACCEPT_OUTCOME_MESSAGE[outcome] ?? "This offer could not be accepted.");
    const { data: p } = await admin.from("appointment_proposals").select("starts_at").eq("id", proposalId).single();
    try {
      const { confirmBooking } = await import("./booking.server");
      await confirmBooking(o.job_id, "assessment", p!.starts_at, userId, "electrician (owner's chosen time)");
      return { ok: true, booked: true };
    } catch (e) {
      // The time is already taken in the database, so the visit may already be written: confirmBooking inserts the
      // booking BEFORE it moves the stage. Catch the job up rather than telling the office to arrange a time that
      // already exists (P1 UAT DEF-09). Only when there is no confirmed visit does the old fallback apply.
      if (await healStrandedPiesaStage(o.job_id, userId)) return { ok: true, booked: true };
      await logEvent(o.job_id, userId, "piesa_window_booking_blocked", `Owner's time taken but booking not confirmed: ${(e as Error).message}`, { proposal_id: proposalId }, { internal: true });
      await admin.from("jobs").update({ next_action: "Owner and electrician to agree a PIESA time" }).eq("id", o.job_id);
      return { ok: true, booked: false };
    }
  }
  const { data, error } = await admin.rpc("accept_partner_offer" as never, { _offer: offerId, _user: userId } as never);
  if (error) throw new Error(error.message);
  const outcome = ((data as unknown as { outcome: string }[] | null)?.[0]?.outcome) ?? "not_found";
  if (outcome !== "accepted") throw new WorkflowError(ACCEPT_OUTCOME_MESSAGE[outcome] ?? "This offer could not be accepted.");
  // Fallback path (none of the owner's times work, or no times given): close the owner's windows, arrange a time.
  await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", o.job_id).not("piesa_window_round", "is", null).eq("status", "proposed");
  await admin.from("jobs").update({ next_action: "Owner and electrician to agree a PIESA time" }).eq("id", o.job_id);
  return { ok: true, booked: false };
}

/** Contacts for the caller's active visit only. Server-side: no release = nothing returned. */
export async function visitContacts(jobId: string, userId: string, role: string) {
  const { data: rel } = await admin.from("contact_releases").select("id, visit_kind, released_at, assignment_id, job_assignments!inner(user_id, role, business_id, active)").eq("job_id", jobId).is("revoked_at", null);
  const { data: job } = await admin.from("jobs").select("stage, owners(user_id, full_name, phone, email)").eq("id", jobId).single();
  const { visitIsCurrent } = await import("./allocation.core");
  const live = (rel ?? []).filter((r) => (r.job_assignments as { active: boolean }).active && visitIsCurrent(r.visit_kind, job?.stage ?? ""));
  const owner = job?.owners as { user_id: string | null; full_name: string | null; phone: string | null; email: string | null } | null;
  // Trades never see owner details until the owner has signed Gate A (incl. consent to share with trades).
  if (role !== "owner" && !(await (await import("./owner-gates.server")).gateAComplete(jobId))) return { releases: [] };
  if (role === "owner") {
    if (owner?.user_id !== userId) return { releases: [] };
    const trades = await Promise.all(live.map(async (r) => {
      const a = r.job_assignments as { user_id: string; role: string; business_id: string | null };
      const [{ data: b }, { data: p }] = await Promise.all([
        a.business_id ? admin.from("businesses").select("name, phone, email").eq("id", a.business_id).maybeSingle() : Promise.resolve({ data: null }),
        admin.from("profiles").select("full_name, phone").eq("id", a.user_id).maybeSingle(),
      ]);
      return { visit: r.visit_kind as VisitKind, role: a.role, business: b?.name ?? null, contact: p?.full_name ?? null, phone: p?.phone ?? b?.phone ?? null, email: b?.email ?? null };
    }));
    return { notice: OWNER_CONTACT_NOTICE, releases: trades };
  }
  const mine = live.filter((r) => (r.job_assignments as { user_id: string }).user_id === userId);
  if (!mine.length || !owner) return { releases: [] };
  return { notice: TRADE_CONTACT_NOTICE, releases: mine.map((r) => ({ visit: r.visit_kind as VisitKind, role: "owner", business: null, contact: owner.full_name, phone: owner.phone, email: owner.email })) };
}

/** Release installation contacts — only once electrical clearance is valid. */
export async function releaseInstallationContacts(jobId: string, actorId: string | null) {
  const c = electricalClearance(await clearanceFacts(jobId));
  if (!c.cleared) throw new WorkflowError(`Installation cannot be arranged yet: ${c.blocker}`);
  const { data: a } = await admin.from("job_assignments").select("id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (!a) throw new WorkflowError("No agreed installer is assigned. Needs Home Insulation Victoria.");
  const { error } = await admin.from("contact_releases").upsert({ job_id: jobId, assignment_id: a.id, visit_kind: "installation", released_by: actorId, owner_notice: OWNER_CONTACT_NOTICE, trade_notice: TRADE_CONTACT_NOTICE }, { onConflict: "assignment_id,visit_kind", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, "contact_released", "Owner and installer contact details released for the installation visit only", { assignment_id: a.id, visit_kind: "installation" }, { internal: true });
  return { ok: true };
}

export async function clearanceFacts(jobId: string) {
  const [{ data: initial }, { data: rect }, { data: rq }] = await Promise.all([
    admin.from("piesa_records").select("outcome, completed_date, signed_off_by").eq("job_id", jobId).eq("kind", "initial").eq("is_current", true).maybeSingle(),
    admin.from("piesa_records").select("rectification_completed_at, section_c_signed_at, outcome").eq("job_id", jobId).neq("kind", "initial").eq("is_current", true).maybeSingle(),
    admin.from("quotes").select("status").eq("job_id", jobId).eq("kind", "rectification").in("status", ["issued", "accepted"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const { count: items } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", jobId);
  return {
    piesaOutcome: (initial?.outcome as "pass" | "fail" | null) ?? null,
    piesaCompletedAt: initial?.completed_date && initial.signed_off_by ? initial.completed_date : null,
    rectificationRequired: (items ?? 0) > 0 || initial?.outcome === "fail",
    rectificationQuoteAccepted: rq?.status === "accepted",
    rectificationCompletedAt: rect?.rectification_completed_at ?? null,
    sectionCSignedAt: rect?.section_c_signed_at ?? null,
  };
}

/** 24h reminders (queued, sending switches decide delivery) for released visits with no proposed time. */
export async function sweepCoordination(actorId: string | null = null) {
  const { data: rel } = await admin.from("contact_releases").select("job_id, visit_kind, released_at, assignment_id, job_assignments!inner(active, booking_confirmed_at)").is("revoked_at", null).in("visit_kind", ["ready_check", "piesa", "rectification", "installation"]);
  let reminders = 0;
  for (const r of rel ?? []) {
    const a = r.job_assignments as { active: boolean; booking_confirmed_at: string | null };
    if (!a.active) continue;
    const bookingKind = r.visit_kind === "piesa" ? "assessment" : r.visit_kind;
    const [{ data: prop }, { data: rem }] = await Promise.all([
      admin.from("appointment_proposals").select("created_at").eq("job_id", r.job_id).eq("kind", bookingKind as never).order("created_at").limit(1).maybeSingle(),
      admin.from("workflow_events").select("created_at").eq("job_id", r.job_id).eq("event_type", "coordination_reminder").contains("details", { assignment_id: r.assignment_id, visit_kind: r.visit_kind }).limit(1).maybeSingle(),
    ]);
    const s = coordinationState({ releasedAt: r.released_at, firstProposalAt: prop?.created_at ?? null, confirmedAt: a.booking_confirmed_at, reminderSentAt: rem?.created_at ?? null });
    if (s.state === "remind") {
      await logEvent(r.job_id, actorId, "coordination_reminder", `24h reminder: no ${r.visit_kind} time proposed yet (prepared; delivery follows the sending switches)`, { assignment_id: r.assignment_id, visit_kind: r.visit_kind }, { internal: true });
      // Queue through the existing launch-control outbox: lands as EXECUTION_NOT_RELEASED and is only delivered once sending is released.
      const { data: ev } = await admin.from("workflow_events").select("id").eq("job_id", r.job_id).eq("event_type", "coordination_reminder").contains("details", { assignment_id: r.assignment_id, visit_kind: r.visit_kind }).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (ev) {
        const { error } = await admin.rpc("enqueue_external_action", {
          _job: r.job_id, _event: ev.id, _action: "booking_messages", _target: `job_assignment:${r.assignment_id}`, _basis: "transactional_job_coordination",
          _version: "coordination-reminder-v1", _payload: `contact_release:${r.visit_kind}`, _facts: await sha256Hex(`${r.assignment_id}-${r.visit_kind}`), _key: `coord-reminder-${r.assignment_id}-${r.visit_kind}`,
        });
        if (error) console.error("reminder outbox enqueue skipped", error.message); // e.g. TEST job suppression
      }
      reminders++;
    }
  }
  return { reminders };
}

/** Installer planning-only notice after a CONFIRMED PIESA booking. Queued in the launch-control outbox
 *  (EXECUTION_NOT_RELEASED until sending is released). Idempotent per assignment + PIESA time. Never changes stage. */
export async function queueInstallerPlanningNotice(jobId: string, installerAssignmentId: string, piesaStart: string) {
  const { data: ev } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", "installer_planning_notice")
    .contains("details", { assignment_id: installerAssignmentId, piesa_start: piesaStart }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!ev) throw new Error("planning notice event missing");
  const raw = `${installerAssignmentId}-${Date.parse(piesaStart)}`;
  const facts = await sha256Hex(raw);
  const { data, error } = await admin.rpc("enqueue_external_action", {
    _job: jobId, _event: ev.id, _action: "partner_notifications", _target: `job_assignment:${installerAssignmentId}`,
    _basis: "transactional_job_coordination", _version: "installer-planning-notice-v1", _payload: "notice:installer_planning_notice",
    _facts: facts, _key: `installer-planning-${raw}`,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

async function sha256Hex(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}


// ---------- Owner-picked PIESA windows ----------
/** Latest owner window round for a job: round number, when it started, and how many of its times are still open and in the future. */
export async function currentWindowRound(jobId: string) {
  const { data } = await admin.from("appointment_proposals").select("piesa_window_round, created_at, status, starts_at").eq("job_id", jobId).not("piesa_window_round", "is", null);
  const rows = data ?? [];
  const round = Math.max(0, ...rows.map((r) => r.piesa_window_round ?? 0));
  const inRound = rows.filter((r) => r.piesa_window_round === round);
  const roundStart = inRound.length ? inRound.map((r) => r.created_at).sort()[0]! : null;
  const now = Date.now();
  const futureOpen = inRound.filter((r) => r.status === "proposed" && new Date(r.starts_at).getTime() > now).length;
  return { round, roundStart, futureOpen };
}

/** Nobody took the owner's times: round 1 -> ask the owner for more times (queued only); round 2 -> needs attention. Idempotent per round. */
async function windowsNoTaker(jobId: string, actorId: string | null, round: number): Promise<boolean> {
  const { noTakerStep, PIESA_NO_TAKER_DETAIL } = await import("./piesa-windows.core");
  const step = noTakerStep(round);
  if (step === "none") return false;
  if (step === "ask_owner_for_more_times") {
    const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "piesa_more_times_requested").contains("details", { round });
    if (count) return true;
    await admin.from("partner_offers").update({ status: "withdrawn", superseded_at: new Date().toISOString() }).eq("job_id", jobId).eq("kind", "piesa").eq("status", "pending");
    await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("piesa_window_round", round).eq("status", "proposed");
    await logEvent(jobId, actorId, "piesa_more_times_requested", "No electrician could take the owner's PIESA times — owner asked to pick more times (prepared; delivery follows the sending switches)", { round }, { internal: true });
    const { data: ev } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", "piesa_more_times_requested").contains("details", { round }).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ev) {
      const { error } = await admin.rpc("enqueue_external_action", {
        _job: jobId, _event: ev.id, _action: "customer_email", _target: `job:${jobId}`, _basis: "transactional_job_coordination",
        _version: "piesa-more-times-v1", _payload: `piesa_windows:round${round}`, _facts: await sha256Hex(`${jobId}-piesa-more-times-${round}`), _key: `piesa-more-times-${jobId}-r${round}`,
      });
      if (error) console.error("more-times outbox enqueue skipped", error.message); // e.g. TEST job suppression
    }
    await admin.from("jobs").update({ next_action: "Waiting for the owner to pick more PIESA times" }).eq("id", jobId);
    return true;
  }
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "rec_coverage_exhausted").contains("details", { owner_times_round: round });
  if (!count) await logEvent(jobId, actorId, "rec_coverage_exhausted", `${PIESA_NO_TAKER_DETAIL} Needs Home Insulation Victoria`, { kind: "piesa", owner_times_round: round, reason: "owner_times" }, { internal: true });
  await admin.from("partner_offers").update({ status: "withdrawn", superseded_at: new Date().toISOString() }).eq("job_id", jobId).eq("kind", "piesa").eq("status", "pending");
  await admin.from("jobs").update({ next_action: "Needs Home Insulation Victoria: no electrician could take the owner's times" }).eq("id", jobId);
  return true;
}

/** Timer: close owner times that have passed; if a whole round has passed with no electrician, run the no-taker step. */
async function sweepPiesaWindows(actorId: string | null) {
  const nowIso = new Date().toISOString();
  const { data: passed } = await admin.from("appointment_proposals").update({ status: "superseded" }).not("piesa_window_round", "is", null).eq("status", "proposed").lt("starts_at", nowIso).select("job_id");
  const jobs = new Set((passed ?? []).map((p) => p.job_id));
  for (const jobId of jobs) {
    const [{ count: elec }, { data: job }] = await Promise.all([
      admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", "electrician").eq("active", true),
      admin.from("jobs").select("stage").eq("id", jobId).single(),
    ]);
    if (elec || job?.stage !== "piesa_and_install_window_pending") continue;
    const w = await currentWindowRound(jobId);
    if (w.round > 0 && w.futureOpen === 0) await windowsNoTaker(jobId, actorId, w.round);
  }
}

/** Owner submits 3–5 PIESA windows (round 1 at acceptance; round 2 only when asked for more times). */
export async function submitOwnerPiesaWindows(jobId: string, userId: string, picks: { date: string; slot: import("./piesa-windows.core").PiesaSlot }[]) {
  const { piesaWindowBlockers, windowBounds, PIESA_MAX_ROUNDS } = await import("./piesa-windows.core");
  const b = piesaWindowBlockers(picks);
  if (b.length) throw new WorkflowError(b.join(" "));
  const [{ data: job }, { count: elec }, w] = await Promise.all([
    admin.from("jobs").select("stage, source").eq("id", jobId).single(),
    // Same rule as PIESA offers: only a confirmed booking means an electrician is already arranging this visit (DEF-07).
    admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", "electrician").eq("active", true).not("booking_confirmed_at", "is", null),
    currentWindowRound(jobId),
  ]);
  if (!job || !["measured_quote_accepted", "piesa_and_install_window_pending"].includes(job.stage)) throw new WorkflowError("PIESA times can be chosen once the quote has been accepted.");
  if (elec) throw new WorkflowError("An electrician is already arranging this visit.");
  if (w.futureOpen > 0) throw new WorkflowError("Your PIESA times are already with our electricians.");
  const reopened = await (await import("./visit-events.server")).timesReopenedSince(jobId, "assessment", w.roundStart);
  if (!reopened && w.round >= PIESA_MAX_ROUNDS) throw new WorkflowError("Home Insulation Victoria will contact you to arrange this visit.");
  if (!reopened && w.round === 1) {
    const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "piesa_more_times_requested");
    if (!count) throw new WorkflowError("Your PIESA times are already with our electricians.");
  }
  const round = w.round + 1;
  const rows = picks.map((p) => ({ job_id: jobId, kind: "assessment" as const, proposed_by: userId, proposer_role: "owner", piesa_window_round: round, ...windowBounds(p.date, p.slot) }));
  const { error } = await admin.from("appointment_proposals").insert(rows as never);
  if (error) throw new Error(error.message);
  await logEvent(jobId, userId, "piesa_windows_chosen", `Owner chose ${picks.length} PIESA times (round ${round})`, { round, count: picks.length });
  await admin.from("jobs").update({ next_action: "Waiting for an electrician to take one of the owner's PIESA times" }).eq("id", jobId);
  // Round 2: restart offers straight away if the job is at the PIESA stage (gates re-checked; blocked = stays put).
  if ((round > 1 || reopened) && job.stage === "piesa_and_install_window_pending") {
    try { await startPiesaAllocation(jobId, null); } catch { /* gate not cleared: timer retries */ }
  }
  return { ok: true, round };
}

/** Owner view: whether to show the time picker, plus their chosen times (no electrician details). */
export async function ownerPiesaWindowState(jobId: string) {
  const [{ data: job }, { count: elec }, w, { data: rows }, { count: asked }] = await Promise.all([
    admin.from("jobs").select("stage").eq("id", jobId).single(),
    // Only a confirmed booking means an electrician is already arranging this visit (see startPiesaAllocation, DEF-07).
    admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", "electrician").eq("active", true).not("booking_confirmed_at", "is", null),
    currentWindowRound(jobId),
    admin.from("appointment_proposals").select("id, starts_at, ends_at, status, piesa_window_round").eq("job_id", jobId).not("piesa_window_round", "is", null).order("starts_at"),
    admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "piesa_more_times_requested"),
  ]);
  const stageOk = !!job && ["measured_quote_accepted", "piesa_and_install_window_pending"].includes(job.stage);
  const reopened = await (await import("./visit-events.server")).timesReopenedSince(jobId, "assessment", w.roundStart);
  const canPick = stageOk && !elec && w.futureOpen === 0 && (w.round === 0 || (w.round === 1 && !!asked) || reopened);
  return { canPick, moreTimes: w.round === 1 && !!asked, round: w.round, windows: (rows ?? []).filter((r) => r.piesa_window_round === w.round) };
}

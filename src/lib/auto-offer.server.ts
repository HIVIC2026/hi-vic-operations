// Decision 246 (Jo 24 Oct 2026): automatic offers by coverage. Reads facts, asks pure `auto-offer.core` who is
// next, then sends through the EXISTING guarded senders only — officePickReadyCheckInstaller (Ready Check, one
// installer, 24h, text + email to that installer) and startPiesaAllocation with one business (PIESA). Both switches
// live in workflow_settings (`auto_installer_offers`, `auto_electrician_offers`; pending migration
// docs/pending-migrations/auto-offer-switches.sql) and are read defensively: a missing column, unreadable row or
// anything but `true` is OFF, and with a switch off this file never sends or writes anything.
// Run from the 15-minute allocation tick, and straight after a "Not for me" (so the next match is not left waiting).
// TEST jobs (source qa_test) ARE offered automatically, but only to [TEST PARTNER] businesses (`isTestPartner`), and a
// live job never reaches a TEST partner: the pure parity rule filters candidates here, the candidate readers already
// apply `partnerAllowedForJob`, and `assertOfferPairsAllowed` refuses any mismatch before a row is written. Offer
// texts/emails for qa_test jobs go through test-send only (ready-check-offer-text.server), so nothing real is sent.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent, stageEntryBlockers } from "./workflow.server";
import { isTestPartner } from "./test-send.core";
import {
  AUTO_OFFER_FLAG, AUTO_OFFER_READY_STAGES, AUTO_OFFER_RETURNED_EVENT, autoOfferBlocked, autoOfferPreferredElectrician, autoOfferReturnedSummary, autoOfferStageReady, autoOfferStep, autoOfferSwitchOn,
  type AutoOfferCandidate, type AutoOfferKind, type AutoOfferRow, type AutoOfferStep,
} from "./auto-offer.core";

const loose = admin as unknown as SupabaseClient;
const NONE = ["00000000-0000-0000-0000-000000000000"];

/** Both switches, fail-closed (missing columns before the pending migration = off). */
export async function readAutoOfferSwitches(): Promise<{ ready_check: boolean; piesa: boolean; readyCheckBooking: boolean }> {
  const { data, error } = await loose.from("workflow_settings").select("auto_installer_offers, auto_electrician_offers, ready_check_booking_enabled").eq("id", 1).maybeSingle();
  if (error || !data) return { ready_check: false, piesa: false, readyCheckBooking: false };
  const row = data as Record<string, unknown>;
  return { ready_check: autoOfferSwitchOn(row, "ready_check"), piesa: autoOfferSwitchOn(row, "piesa"), readyCheckBooking: row["ready_check_booking_enabled"] === true };
}

async function activeJobCounts(businessIds: string[], role: "installer" | "electrician"): Promise<Map<string, number>> {
  const { data } = await admin.from("job_assignments").select("business_id, jobs!inner(stage, deleted_at)").eq("active", true).eq("role", role).in("business_id", businessIds.length ? businessIds : NONE);
  const out = new Map<string, number>();
  for (const a of data ?? []) {
    const j = a.jobs as unknown as { stage: string; deleted_at: string | null } | null;
    if (!a.business_id || !j || j.deleted_at || j.stage === "complete" || j.stage === "cancelled") continue;
    out.set(a.business_id, (out.get(a.business_id) ?? 0) + 1);
  }
  return out;
}

/** Per business: straight-line km to the job postcode (null = unknown) and the canonical TEST-partner mark. */
async function businessFacts(businessIds: string[], postcode: string | null): Promise<{ km: Map<string, number | null>; test: Map<string, boolean> }> {
  const km = new Map<string, number | null>();
  const test = new Map<string, boolean>();
  if (!businessIds.length) return { km, test };
  const [{ default: centroids }, { distanceKm }, { data: bizs }] = await Promise.all([
    import("@/data/vic-postcode-centroids.json"), import("./offer-dispatch.core"),
    admin.from("businesses").select("id, coverage_lat, coverage_lng, onboarding_notes").in("id", businessIds),
  ]);
  const c = postcode ? (centroids as unknown as Record<string, [number, number]>)[postcode] ?? null : null;
  for (const b of bizs ?? []) {
    km.set(b.id, c ? distanceKm({ lat: c[0], lng: c[1] }, { lat: b.coverage_lat ?? null, lng: b.coverage_lng ?? null }) : null);
    test.set(b.id, isTestPartner(b));
  }
  return { km, test };
}
/** Unknown business → treated as a TEST partner, so a live job can never reach it (and a TEST job's parity check still fails closed in the senders). */
const testFlag = (test: Map<string, boolean>, id: string) => test.get(id) ?? true;

async function installerCandidates(jobId: string): Promise<AutoOfferCandidate[]> {
  const { postcode, candidates } = await (await import("./readycheck-booking.server")).installerCandidatesFor(jobId);
  const ids = candidates.map((c) => c.business_id);
  const [jobs, { km, test }] = await Promise.all([activeJobCounts(ids, "installer"), businessFacts(ids, postcode)]);
  return candidates.map((c) => ({
    business_id: c.business_id, name: c.name, coversPostcode: c.coverage_verified && c.covers_postcode, paused: c.accepting_new_jobs === false,
    credentialsOk: c.has_valid_licence, workersCleared: c.approved_workers > 0, blocker: c.blocker, activeJobs: jobs.get(c.business_id) ?? 0, distanceKm: km.get(c.business_id) ?? null,
    testPartner: testFlag(test, c.business_id),
  }));
}

async function electricianCandidates(jobId: string, channel: string | null): Promise<{ candidates: AutoOfferCandidate[]; usualBusinessId: string | null }> {
  const alloc = await import("./allocation.server");
  const { postcode, candidates } = await alloc.recCandidatesFor(jobId);
  const ids = candidates.map((c) => c.business_id);
  const [jobs, { km, test }, rates] = await Promise.all([
    activeJobCounts(ids, "electrician"), businessFacts(ids, postcode), alloc.agreedElectricianRates(ids, "piesa"),
  ]);
  // Decision 374: our leads — nobody goes first, the nearest approved REC covering the postcode gets it (even when the
  // quoted installer has a usual electrician). The installer's own customers (A1): the electrician the installer chose
  // for this job / their preferred REC.
  const usualBusinessId = autoOfferPreferredElectrician({ channel, a1PreferredBusinessId: candidates.find((c) => c.preferred && !c.blocker)?.business_id ?? null });
  return {
    usualBusinessId,
    candidates: candidates.map((c) => ({
      business_id: c.business_id, name: c.name, coversPostcode: c.coverage_verified && c.covers_postcode, paused: c.accepting_new_jobs === false,
      credentialsOk: c.has_valid_licence, workersCleared: c.approved_workers > 0, activeJobs: jobs.get(c.business_id) ?? 0, distanceKm: km.get(c.business_id) ?? null,
      testPartner: testFlag(test, c.business_id),
      // The guarded sender refuses an electrician without an agreed (onboarding) rate.
      blocker: c.blocker ?? (rates.has(c.business_id) ? null : "No agreed electrician rate recorded."),
    })),
  };
}

export type AutoOfferOutcome = { jobId: string; kind: AutoOfferKind; step: AutoOfferStep["action"]; reason?: string; businessId?: string; error?: string };

/** One job, one kind: offer the next match, hand the job back to the office, or do nothing. Never throws for a
 *  refused send (the guarded sender's reason is returned); with the switch off it reads the switch and stops. */
export async function autoOfferForJob(jobId: string, kind: AutoOfferKind, switches?: Awaited<ReturnType<typeof readAutoOfferSwitches>>): Promise<AutoOfferOutcome> {
  const sw = switches ?? await readAutoOfferSwitches();
  if (!sw[kind]) return { jobId, kind, step: "none", reason: "switch_off" };
  if (kind === "ready_check" && !sw.readyCheckBooking) return { jobId, kind, step: "none", reason: "ready_check_booking_off" };
  const [{ data: job }, { data: offers }, { count: trades }, { data: returned }] = await Promise.all([
    admin.from("jobs").select("id, stage, channel, source, deleted_at, offer_dispatch_override").eq("id", jobId).maybeSingle(),
    admin.from("partner_offers").select("business_id, status, offered_at, summary").eq("job_id", jobId).eq("kind", kind),
    admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", kind === "ready_check" ? "installer" : "electrician").eq("active", true),
    admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", AUTO_OFFER_RETURNED_EVENT).contains("details", { kind }).limit(1),
  ]);
  if (!job) return { jobId, kind, step: "none", reason: "job_not_found" };
  const mode = kind === "piesa" ? await (await import("./offer-dispatch.server")).dispatchMode() : null;
  let jobReady = !job.deleted_at && autoOfferStageReady(kind, job.stage)
    && (kind === "ready_check" ? job.channel === "hivic_sourced" : mode !== "automatic" && job.offer_dispatch_override !== "office_picks");
  // PIESA: a job still in measured_quote_accepted is ready only once it may ENTER the PIESA stage (decisions 139–141:
  // $349 safety check recorded, quote approved, verified eligible …) — the same entry check startPiesaAllocation makes,
  // so an unpaid acceptance is "not ready" rather than a refused send every tick.
  // Decision 389: nothing reaches an installer before the owner confirms their released spot (Jo releases by hand).
  if (jobReady && kind === "ready_check") {
    const s = await (await import("./spot-release.server")).spotReleaseStateFor(jobId).catch(() => null);
    if (s?.state !== "confirmed") return { jobId, kind, step: "none", reason: "owner_not_confirmed" };
  }
  if (jobReady && kind === "piesa" && job.stage === "measured_quote_accepted") {
    const entry = await stageEntryBlockers(jobId, "piesa_and_install_window_pending", null).catch(() => ["unreadable"]);
    if (entry.length) jobReady = false;
  }
  const rows: AutoOfferRow[] = (offers ?? []).map((o) => ({ business_id: o.business_id, status: o.status, offered_at: o.offered_at, auto: !!o.summary && (o.summary as Record<string, unknown>)[AUTO_OFFER_FLAG] === true }));
  const facts = { kind, switchOn: true, jobReady, jobIsTest: job.source === "qa_test", hasTrade: (trades ?? 0) > 0, returned: (returned ?? []).length > 0, rows };
  const pre = autoOfferBlocked(facts);
  let step: AutoOfferStep;
  if (pre) step = pre;
  else if (kind === "ready_check") step = autoOfferStep({ ...facts, candidates: await installerCandidates(jobId) });
  else { const e = await electricianCandidates(jobId, job.channel); step = autoOfferStep({ ...facts, candidates: e.candidates, usualBusinessId: e.usualBusinessId }); }

  if (step.action === "none") return { jobId, kind, step: "none", reason: step.reason };
  if (step.action === "return_to_office") {
    await logEvent(jobId, null, AUTO_OFFER_RETURNED_EVENT, autoOfferReturnedSummary(kind, step.reason, step.misses), { kind, reason: step.reason, misses: step.misses, tried_business_ids: step.tried }, { internal: true });
    await admin.from("jobs").update({ next_action: kind === "ready_check" ? "Needs Home Insulation Victoria: choose an installer for the Ready Check" : "Needs Home Insulation Victoria: choose an electrician for the PIESA" }).eq("id", jobId).in("stage", AUTO_OFFER_READY_STAGES[kind] as never[]);
    return { jobId, kind, step: "return_to_office", reason: step.reason };
  }
  const meta = { attempt: step.attempt, basis: step.basis, activeJobs: step.activeJobs, distanceKm: step.distanceKm };
  try {
    if (kind === "ready_check") await (await import("./ready-check-times.server")).officePickReadyCheckInstaller(jobId, null, [step.businessId], { auto: meta });
    else await (await import("./allocation.server")).startPiesaAllocation(jobId, null, "piesa", { onlyBusiness: step.businessId, auto: meta });
    return { jobId, kind, step: "offer", businessId: step.businessId };
  } catch (e) {
    // A guard refused (gate, pairing, paperwork …): nothing was sent; the next tick looks again.
    return { jobId, kind, step: "none", reason: "sender_refused", businessId: step.businessId, error: (e as Error).message };
  }
}

/** 15-minute tick: every job waiting for an installer (our leads' Ready Check) or a PIESA electrician, TEST jobs
 *  included (they can only be matched with TEST partners). Counts only. */
export async function sweepAutoOffers(): Promise<{ enabled: { installer: boolean; electrician: boolean }; offered: number; returned: number; refused: number }> {
  const sw = await readAutoOfferSwitches();
  const out = { enabled: { installer: sw.ready_check, electrician: sw.piesa }, offered: 0, returned: 0, refused: 0 };
  const kinds = (["ready_check", "piesa"] as const).filter((k) => sw[k] && (k !== "ready_check" || sw.readyCheckBooking));
  for (const kind of kinds) {
    let q = admin.from("jobs").select("id").in("stage", AUTO_OFFER_READY_STAGES[kind] as never[]).is("deleted_at", null);
    if (kind === "ready_check") q = q.eq("channel", "hivic_sourced");
    const { data: jobs } = await q.order("created_at").limit(200);
    for (const j of jobs ?? []) {
      try {
        const r = await autoOfferForJob(j.id, kind, sw);
        if (r.step === "offer") out.offered++;
        else if (r.step === "return_to_office") out.returned++;
        else if (r.reason === "sender_refused") out.refused++;
      } catch (e) {
        out.refused++;
        console.error("automatic offer failed", kind, (e as Error).message);
      }
    }
  }
  return out;
}

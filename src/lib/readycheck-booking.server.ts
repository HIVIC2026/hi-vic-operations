import { partnerAllowedForJob } from "./test-send.core";
// Ready Check booking persistence: owner windows, installer matching/offers, one-tap booking, rounds, timer.
// Rules: readycheck-booking.core.ts. Atomic acceptance in SQL: accept_ready_check_offer (migration 0099).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { WorkflowError, logEvent } from "./workflow.server";
import { verifiedServiceAreaMatch, partnerWorkBlocker, type BusinessLike } from "./pilot.core";
import { ACCEPT_OUTCOME_MESSAGE, offerExpiryBusinessHours } from "./allocation.core";
import { melbourneYmd, piesaWindowBlockers, windowBounds, PIESA_MAX_ROUNDS } from "./piesa-windows.core";
import {
  READY_CHECK_NO_TAKER_DETAIL, READY_CHECK_UNPAID_NOTE, READY_CHECK_WINDOW_STAGES, fullCurrentCert, installerCandidate,
  installerEligibilityBlocker, nextInstallerBatch, readyCheckNoTakerStep, readyCheckStartBlockers,
} from "./readycheck-booking.core";

const NONE = ["00000000-0000-0000-0000-000000000000"];
type Pick = { date: string; slot: import("./piesa-windows.core").PiesaSlot };

async function settings() {
  const { data } = await admin.from("workflow_settings").select("rec_offer_business_hours, rec_offer_batch_size").eq("id", 1).maybeSingle();
  return { businessHours: Number(data?.rec_offer_business_hours ?? 4), batchSize: Number(data?.rec_offer_batch_size ?? 3) };
}

async function sha256Hex(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function readyCheckWindowRound(jobId: string) {
  const { data } = await admin.from("ready_check_windows").select("id, round, created_at, status, starts_at, ends_at").eq("job_id", jobId);
  const rows = data ?? [];
  const round = Math.max(0, ...rows.map((r) => r.round));
  const inRound = rows.filter((r) => r.round === round);
  const now = Date.now();
  const open = inRound.filter((r) => r.status === "open" && Date.parse(r.starts_at) > now);
  return { round, roundStart: inRound.length ? inRound.map((r) => r.created_at).sort()[0]! : null, open, all: inRound };
}

async function hasActiveInstaller(jobId: string) {
  const { count } = await admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", "installer").eq("active", true);
  return !!count;
}

/** Owner chooses 3–5 Ready Check windows (round 1 with the request; round 2 only when asked for more times). */
export async function submitReadyCheckWindows(jobId: string, picks: Pick[], now = new Date()) {
  const b = piesaWindowBlockers(picks, now);
  if (b.length) throw new WorkflowError(b.join(" "));
  const [{ data: job }, inst, w] = await Promise.all([admin.from("jobs").select("stage").eq("id", jobId).single(), hasActiveInstaller(jobId), readyCheckWindowRound(jobId)]);
  if (!job || !(READY_CHECK_WINDOW_STAGES as readonly string[]).includes(job.stage)) throw new WorkflowError("Ready Check times can't be chosen at this point.");
  // Installer-supplied customer whose installer asked us to collect the owner's times (Jo, 7 Oct 6pm).
  const ownInstaller = inst && (await import("./installer-ready-check.server")).ownerTimesRequested(jobId);
  if (inst && !(await ownInstaller)) throw new WorkflowError("An installer is already arranging your Ready Check.");
  if (w.open.length) throw new WorkflowError("Your Ready Check times are already with our installers.");
  const reopened = await (await import("./visit-events.server")).timesReopenedSince(jobId, "ready_check", w.roundStart);
  if (!reopened && w.round >= PIESA_MAX_ROUNDS) throw new WorkflowError("Home Insulation Victoria will contact you to arrange your Ready Check.");
  if (!reopened && w.round === 1) {
    const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "ready_check_more_times_requested");
    if (!count) throw new WorkflowError("Your Ready Check times are already with our installers.");
  }
  const round = w.round + 1;
  const { error } = await admin.from("ready_check_windows").insert(picks.map((p) => ({ job_id: jobId, round, ...windowBounds(p.date, p.slot) })));
  if (error) throw new Error(error.message);
  await logEvent(jobId, null, "ready_check_windows_chosen", `Owner chose ${picks.length} Ready Check times (round ${round})`, { round, count: picks.length });
  if (inst) { // never offered to anyone else: the supplying installer picks one of these times
    await admin.from("jobs").update({ next_action: "Installer to tap one of the owner's Ready Check times" }).eq("id", jobId);
    return { ok: true, round };
  }
  await admin.from("jobs").update({ next_action: "Waiting for an installer to take one of the owner's Ready Check times" }).eq("id", jobId);
  if (job.stage === "ready_check_ready_to_schedule" && !(await (await import("./offer-dispatch.server")).jobOfficePicks(jobId))) { try { await startReadyCheckOffers(jobId, null); } catch { /* timer retries */ } }
  return { ok: true, round };
}

/** Owner view (no installer details). */
export async function ownerReadyCheckWindowState(jobId: string) {
  const [{ data: job }, inst, w, { count: asked }] = await Promise.all([
    admin.from("jobs").select("stage").eq("id", jobId).single(), hasActiveInstaller(jobId), readyCheckWindowRound(jobId),
    admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "ready_check_more_times_requested"),
  ]);
  const stageOk = !!job && (READY_CHECK_WINDOW_STAGES as readonly string[]).includes(job.stage);
  const reopened = await (await import("./visit-events.server")).timesReopenedSince(jobId, "ready_check", w.roundStart);
  const ownInstaller = inst && (await (await import("./installer-ready-check.server")).ownerTimesRequested(jobId));
  const canPick = stageOk && (!inst || ownInstaller) && w.open.length === 0 && (w.round === 0 || (w.round === 1 && !!asked) || reopened);
  return { canPick, moreTimes: w.round === 1 && !!asked, round: w.round, windows: w.all.map((r) => ({ starts_at: r.starts_at, ends_at: r.ends_at, status: r.status })) };
}

/** Approved installer businesses judged for this Ready Check. Price is never loaded. */
export async function installerCandidatesFor(jobId: string) {
  const { data: job } = await admin.from("jobs").select("id, source, properties(postcode)").eq("id", jobId).single();
  const postcode = (job?.properties as { postcode: string | null } | null)?.postcode ?? null;
  const { data: allBizs } = await admin.from("businesses").select("*").or("business_type.eq.eec_installer,capabilities.cs.{installer}");
  const bizs = (allBizs ?? []).filter((b) => partnerAllowedForJob(b, job?.source));
  const ids = (bizs ?? []).map((b) => b.id);
  const inIds = ids.length ? ids : NONE;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const w = await readyCheckWindowRound(jobId);
  const windows = w.open.map((r) => ({ s: Date.parse(r.starts_at), e: Date.parse(r.ends_at), day: melbourneYmd(new Date(r.starts_at)) }));
  const windowDays = new Set(windows.map((x) => x.day));
  const [{ data: creds }, { data: workers }, { data: offers }, { data: bks }] = await Promise.all([
    admin.from("business_credentials").select("business_id,kind,label,expires_at,critical,verification").in("business_id", inIds),
    admin.from("partner_workers").select("id, business_id, email, trade_role, piisa_status, piisa_certificate_path, piisa_verified_at").eq("trade_role", "installer").eq("approval_status", "approved").is("removed_at", null).in("business_id", inIds),
    admin.from("partner_offers").select("business_id, status, offered_at, responded_at").eq("kind", "ready_check").gte("offered_at", since).in("business_id", inIds),
    windows.length
      ? admin.from("bookings").select("business_id, scheduled_start, scheduled_end, jobs!inner(deleted_at, properties(postcode))").is("jobs.deleted_at", null).eq("status", "confirmed").in("business_id", inIds)
          .gte("scheduled_start", new Date(Math.min(...windows.map((x) => x.s)) - 86_400_000).toISOString())
          .lte("scheduled_start", new Date(Math.max(...windows.map((x) => x.e)) + 86_400_000).toISOString())
      : Promise.resolve({ data: [] as { business_id: string | null; scheduled_start: string; scheduled_end: string | null; jobs: unknown }[] }),
  ]);
  // Certification: latest record per worker (by id or email) + latest office-recorded level.
  // PIISA: installers who said No (or uploaded but not yet verified) can't be offered jobs.
  const { workerOfferBlocker } = await import("./worker-compliance.core");
  const wk = (workers ?? []).filter((x) => !workerOfferBlocker(x as never, melbourneYmd(new Date())));
  const emails = wk.map((x) => x.email.trim().toLowerCase());
  const { data: certs } = wk.length
    ? await admin.from("partner_worker_certifications").select("id, worker_id, worker_email, status, recorded_at").or(`worker_id.in.(${wk.map((x) => x.id).join(",")}),worker_email.in.(${emails.map((e) => `"${e}"`).join(",")})`).order("recorded_at", { ascending: false })
    : { data: [] as { id: string; worker_id: string | null; worker_email: string; status: string; recorded_at: string }[] };
  const certIds = (certs ?? []).map((c) => c.id);
  const { data: levels } = certIds.length
    ? await admin.from("worker_certification_levels").select("certification_id, level, expires_on, recorded_at").in("certification_id", certIds).order("recorded_at", { ascending: false })
    : { data: [] as { certification_id: string; level: string; expires_on: string; recorded_at: string }[] };
  const today = melbourneYmd(new Date());
  const fullWorker = (x: { id: string; email: string }) => {
    const c = (certs ?? []).find((r) => r.worker_id === x.id || r.worker_email.trim().toLowerCase() === x.email.trim().toLowerCase());
    if (!c) return false;
    const l = (levels ?? []).find((r) => r.certification_id === c.id);
    return fullCurrentCert({ status: c.status, level: l?.level ?? null, expiresOn: l?.expires_on ?? null }, today);
  };
  const rel = await (await import("./visit-events.server")).reliabilityFor(ids);
  const { acceptanceWithCancellations } = await import("./visit-events.core");
  const candidates = (bizs ?? []).map((b) => {
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
    const c = installerCandidate({
      business_id: b.id, name: b.name, is_active: b.is_active, onboarding_status: b.onboarding_status,
      accepting_new_jobs: b.accepting_new_jobs ?? null, receives_hivic_leads: b.receives_hivic_leads ?? null,
      coverage_verified: !!b.coverage_verified_at, covers_postcode: verifiedServiceAreaMatch(b, postcode),
      exact_postcode: !!postcode && !!b.service_postcodes?.includes(postcode),
      credentialsOk: !partnerWorkBlocker(b as unknown as BusinessLike, (creds ?? []).filter((x) => x.business_id === b.id)),
      fullCertifiedInstallers: wk.filter((x) => x.business_id === b.id && fullWorker(x)).length,
      freeMeasureUps: b.free_measureups_for_hivic_quote_leads ?? null,
      weekly_capacity: null, open_jobs: 0, recent_offers_30d: mine.length,
      acceptance_rate: acceptanceWithCancellations(answered.filter((o) => o.status === "accepted").length, answered.length, rel.get(b.id)?.trade_cancellations ?? 0),
      free_in_window: windows.length ? windows.some((x) => !myBookings.some((k) => k.s < x.e && k.e > x.s)) : null,
      
      nearby_job_that_day: myBookings.some((k) => windowDays.has(k.day) && covers(k.postcode)),
      no_shows: rel.get(b.id)?.no_shows ?? 0, evidence_rejections: rel.get(b.id)?.evidence_rejections ?? 0, recent_jobs_30d: accepted.length,
      avg_accept_hours: accepted.length ? accepted.reduce((t, o) => t + (Date.parse(o.responded_at!) - Date.parse(o.offered_at)) / 3_600_000, 0) / accepted.length : null,
    });
    return { ...c, blocker: installerEligibilityBlocker(c) };
  });
  return { postcode, candidates };
}

/** Start (or continue) Ready Check offers. Refuses unless the job is waiting for a Ready Check booking with open owner times. */
export async function startReadyCheckOffers(jobId: string, actorId: string | null, onlyBusiness?: string | string[], opts: { adding?: boolean } = {}) {
  const [{ data: job }, inst, w, { count: open }] = await Promise.all([
    admin.from("jobs").select("stage").eq("id", jobId).single(), hasActiveInstaller(jobId), readyCheckWindowRound(jobId),
    admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "pending"),
  ]);
  const b = readyCheckStartBlockers({ stage: job?.stage ?? "", hasInstaller: inst, openWindows: w.open.length, hasOpenOffers: !!open && !opts.adding });
  if (b.length) throw new WorkflowError(`Ready Check offers cannot start: ${b.join(" ")}`);
  return offerNextReadyCheckBatch(jobId, actorId, onlyBusiness);
}

async function offerNextReadyCheckBatch(jobId: string, actorId: string | null, onlyBusiness?: string | string[]) {
  const { businessHours, batchSize } = await settings();
  const [{ candidates }, w, { data: prior }, { data: j }] = await Promise.all([
    installerCandidatesFor(jobId), readyCheckWindowRound(jobId),
    admin.from("partner_offers").select("business_id, batch, offered_at").eq("job_id", jobId).eq("kind", "ready_check"),
    admin.from("jobs").select("job_number, properties(suburb, postcode)").eq("id", jobId).single(),
  ]);
  let batch: { business_id: string; name?: string }[];
  const picks = onlyBusiness ? (Array.isArray(onlyBusiness) ? onlyBusiness : [onlyBusiness]) : null;
  if (picks) {
    batch = picks.map((id) => {
      const c = candidates.find((x) => x.business_id === id);
      if (!c) throw new WorkflowError("One of those installers isn't an approved installer for this job.");
      if (c.blocker) throw new WorkflowError(`${c.name} can't take this Ready Check: ${c.blocker}`);
      return c;
    });
  } else {
    const inRound = (prior ?? []).filter((o) => !w.roundStart || o.offered_at >= w.roundStart);
    batch = nextInstallerBatch(candidates, new Set(inRound.map((o) => o.business_id)), batchSize);
  }
  if (!batch.length) {
    if (w.round > 0) await readyCheckNoTaker(jobId, actorId, w.round);
    return { offered: 0, exhausted: true };
  }
  const batchNo = Math.max(0, ...(prior ?? []).map((o) => o.batch)) + 1;
  const p = j?.properties as { suburb: string | null; postcode: string | null } | null;
  const summary = { job_number: j?.job_number ?? "", suburb: p?.suburb ?? null, postcode: p?.postcode ?? null, visit: "ready_check", unpaid_note: READY_CHECK_UNPAID_NOTE, ...(onlyBusiness ? { office_choice: true } : {}) };
  const expires = picks ? await (await import("./offer-dispatch.server")).chosenOfferExpiry() : offerExpiryBusinessHours(new Date(), businessHours);
  await (await import("./offer-guard.server")).assertOfferPairsAllowed(jobId, batch.map((b) => b.business_id), "ready_check");
  const { error } = await admin.from("partner_offers").insert(batch.map((b) => ({ job_id: jobId, business_id: b.business_id, kind: "ready_check", batch: batchNo, summary: summary as unknown as Json, offered_by: actorId, expires_at: expires })));
  if (error) throw new Error(error.message);
  if (picks) await logEvent(jobId, actorId, "trade_chosen_by_office", `Office chose ${batch.map((b) => b.name ?? "an installer").join(", ")} for the Ready Check — offer sent only to ${batch.length === 1 ? "them" : `these ${batch.length}`}`, { kind: "ready_check", business_ids: batch.map((b) => b.business_id), business_names: batch.map((b) => b.name ?? null), business_id: batch[0]!.business_id, business_name: batch[0]!.name ?? null, expires_at: expires }, { internal: true });
  else await logEvent(jobId, actorId, "ready_check_offers_made", `Ready Check offered to ${batch.length} approved installer(s), batch ${batchNo}`, { batch: batchNo, businesses: batch.map((b) => b.business_id), expires_at: expires }, { internal: true });
  return { offered: batch.length, exhausted: false };
}

/** No installer took the owner's times: round 1 → ask the owner once for more times (queued only); round 2 → needs attention. Idempotent. */
async function readyCheckNoTaker(jobId: string, actorId: string | null, round: number) {
  const step = readyCheckNoTakerStep(round);
  if (step === "none") return;
  const nowIso = new Date().toISOString();
  await admin.from("partner_offers").update({ status: "withdrawn", superseded_at: nowIso }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "pending");
  await admin.from("ready_check_windows").update({ status: "closed" }).eq("job_id", jobId).eq("round", round).eq("status", "open");
  if (step === "ask_owner_for_more_times") {
    const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "ready_check_more_times_requested");
    if (count) return;
    await logEvent(jobId, actorId, "ready_check_more_times_requested", "No installer could take the owner's Ready Check times — owner asked to pick more times (prepared; delivery follows the sending switches)", { round }, { internal: true });
    const { data: ev } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", "ready_check_more_times_requested").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ev) {
      const { error } = await admin.rpc("enqueue_external_action", {
        _job: jobId, _event: ev.id, _action: "customer_email", _target: `job:${jobId}`, _basis: "transactional_job_coordination",
        _version: "ready-check-more-times-v1", _payload: `ready_check_windows:round${round}`, _facts: await sha256Hex(`${jobId}-rc-more-times-${round}`), _key: `rc-more-times-${jobId}-r${round}`,
      });
      if (error) console.error("ready check more-times enqueue skipped", error.message);
    }
    await admin.from("jobs").update({ next_action: "Waiting for the owner to pick more Ready Check times" }).eq("id", jobId);
    return;
  }
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "ready_check_no_taker");
  if (!count) await logEvent(jobId, actorId, "ready_check_no_taker", `${READY_CHECK_NO_TAKER_DETAIL} Needs Home Insulation Victoria`, { round }, { internal: true });
  await admin.from("jobs").update({ next_action: "Needs Home Insulation Victoria: no installer could take the owner's Ready Check times" }).eq("id", jobId);
}

async function refill(jobId: string, actorId: string | null) {
  const { data: job } = await admin.from("jobs").select("stage").eq("id", jobId).single();
  if (job?.stage !== "ready_check_ready_to_schedule") return;
  const [{ count: open }, inst] = await Promise.all([
    admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "pending"),
    hasActiveInstaller(jobId),
  ]);
  if (open || inst) return;
  // Office-picked installer said no / ran out: wait for "Pick another" or "Send to all" in Needs me.
  if (await (await import("./allocation.server")).officePickUnanswered(jobId, "ready_check")) return;
  if (await (await import("./offer-dispatch.server")).jobOfficePicks(jobId)) return; // office picks: Needs me shows "add more trades"
  const w = await readyCheckWindowRound(jobId);
  if (!w.open.length) { if (w.round > 0) await readyCheckNoTaker(jobId, actorId, w.round); return; }
  await offerNextReadyCheckBatch(jobId, actorId);
}

/** Installer responds to a Ready Check offer. windowId = tap one of the owner's times (booked); null = accept and arrange a time. */
export async function respondToReadyCheckOffer(offerId: string, userId: string, accept: boolean, reason: string | null, windowId: string | null) {
  const { data: o } = await admin.from("partner_offers").select("id, job_id, kind, business_id").eq("id", offerId).single();
  if (!o || o.kind !== "ready_check") throw new WorkflowError("Offer not found.");
  if (!accept) {
    const { data: d } = await admin.from("partner_offers").update({ status: "declined", responded_by: userId, responded_at: new Date().toISOString(), decline_reason: reason }).eq("id", o.id).eq("status", "pending").select("id").maybeSingle();
    if (!d) throw new WorkflowError("This offer is no longer open.");
    await logEvent(o.job_id, userId, "partner_offer_declined", "Installer declined the Ready Check offer", { reason, business_id: o.business_id }, { internal: true });
    await refill(o.job_id, null);
    return { ok: true };
  }
  const { data: isInstaller } = await admin.rpc("has_role", { _user_id: userId, _role: "installer" });
  if (!isInstaller) throw new WorkflowError("Only an installer team member can accept a Ready Check.");
  const { data, error } = await admin.rpc("accept_ready_check_offer", { _offer: offerId, _user: userId, _window: windowId as string });
  if (error) throw new Error(error.message);
  const outcome = data?.[0]?.outcome ?? "not_found";
  if (outcome === "slot_unavailable") throw new WorkflowError("That time is no longer available. Please choose another time.");
  if (outcome === "already_assigned" || outcome === "already_withdrawn" || outcome === "already_accepted") throw new WorkflowError("This Ready Check has just been taken.");
  if (outcome === "not_qualified") throw new WorkflowError("Your business needs an approved installer with a Full, current EEC certification recorded by Home Insulation Victoria.");
  if (outcome !== "accepted") throw new WorkflowError(ACCEPT_OUTCOME_MESSAGE[outcome] ?? "This offer could not be accepted.");
  if (!windowId) {
    await admin.from("jobs").update({ next_action: "Owner and installer to agree a Ready Check time" }).eq("id", o.job_id);
    return { ok: true, booked: false };
  }
  const { data: w } = await admin.from("ready_check_windows").select("starts_at").eq("id", windowId).single();
  try {
    const { confirmBooking } = await import("./booking.server");
    await confirmBooking(o.job_id, "ready_check", w!.starts_at, userId, "installer (owner's chosen time)");
    await (await import("./mitti-create.server")).onReadyCheckBooked(o.job_id, userId).catch((e) => console.error("ready check form not scheduled", (e as Error).message)); // T3: confirmed booking starts the form in the background
    return { ok: true, booked: true };
  } catch (e) {
    await logEvent(o.job_id, userId, "ready_check_window_booking_blocked", `Owner's time taken but booking not confirmed: ${(e as Error).message}`, { window_id: windowId }, { internal: true });
    await admin.from("jobs").update({ next_action: "Owner and installer to agree a Ready Check time" }).eq("id", o.job_id);
    return { ok: true, booked: false };
  }
}

/** Open owner windows for these jobs (times only, never owner details) — for the installer dashboard. */
export async function readyCheckOfferWindows(jobIds: string[]) {
  if (!jobIds.length) return [];
  const { data } = await admin.from("ready_check_windows").select("id, job_id, starts_at, ends_at").in("job_id", jobIds).eq("status", "open").gt("starts_at", new Date().toISOString()).order("starts_at");
  return data ?? [];
}

/** 15-minute timer: expire offers → next batch; close passed times → no-taker step; start offers for jobs waiting with owner times. */
export async function sweepReadyCheckOffers(actorId: string | null = null) {
  const nowIso = new Date().toISOString();
  const { data: expired } = await admin.from("partner_offers").update({ status: "expired" }).eq("kind", "ready_check").eq("status", "pending").lt("expires_at", nowIso).select("job_id");
  for (const o of expired ?? []) await logEvent(o.job_id, actorId, "partner_offer_expired", "An installer Ready Check offer expired without a response", { kind: "ready_check" }, { internal: true });
  await admin.from("ready_check_windows").update({ status: "closed" }).eq("status", "open").lt("starts_at", nowIso);
  const { data: waiting } = await admin.from("jobs").select("id").eq("stage", "ready_check_ready_to_schedule").neq("source", "qa_test");
  const touched = new Set([...(expired ?? []).map((o) => o.job_id), ...(waiting ?? []).map((j) => j.id)]);
  let started = 0;
  for (const jobId of touched) {
    const w = await readyCheckWindowRound(jobId);
    if (w.round === 0) continue; // old path (no owner times): unchanged
    const before = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "pending");
    await refill(jobId, actorId).catch((e) => console.error("ready check refill failed", (e as Error).message));
    const after = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "pending");
    if ((after.count ?? 0) > (before.count ?? 0)) started++;
  }
  return { expired: expired?.length ?? 0, started };
}

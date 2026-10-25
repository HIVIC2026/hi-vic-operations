import { partnerAllowedForJob } from "./test-send.core";
// Ready Check booking persistence: installer matching, the office-picked offer (one installer, 24 hours), the timer, and
// the legacy owner windows (installer-supplied customers only; kept as history on our leads).
// Jo 24 Oct 2026: on our leads the office picks the installer and the installer offers the owner the times
// (ready-check-times.server); there are no automatic batch offers and owners no longer give Ready Check times.
// Rules: readycheck-booking.core.ts + ready-check-times.core.ts. Atomic acceptance in SQL: accept_ready_check_offer.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { verifiedServiceAreaMatch, partnerWorkBlocker, type BusinessLike } from "./pilot.core";
import { melbourneYmd, piesaWindowBlockers, windowBounds, PIESA_MAX_ROUNDS } from "./piesa-windows.core";
import { READY_CHECK_WINDOW_STAGES, fullCurrentCert, installerCandidate, installerEligibilityBlocker } from "./readycheck-booking.core";
import { publicLiabilityBlocker } from "./worker-compliance.core";
import { latestExpiry } from "./trade-view.core";
import { expiredBusinessDocsBlocker } from "./trade-expiry.core";

const NONE = ["00000000-0000-0000-0000-000000000000"];
type Pick = { date: string; slot: import("./piesa-windows.core").PiesaSlot };

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
  await (await import('./ready-check-booking-access.server')).assertOwnerReadyCheckBooking(jobId);
  const b = piesaWindowBlockers(picks, now);
  if (b.length) throw new WorkflowError(b.join(" "));
  const [{ data: job }, inst, w] = await Promise.all([admin.from("jobs").select("stage, channel").eq("id", jobId).single(), hasActiveInstaller(jobId), readyCheckWindowRound(jobId)]);
  // Jo 24 Oct 2026 (decision 53): owners of our leads no longer give Ready Check times — the installer offers them.
  if (job?.channel === "hivic_sourced") throw new WorkflowError(OWNER_WAITS_FOR_INSTALLER_TIMES);
  if (!job || !(READY_CHECK_WINDOW_STAGES as readonly string[]).includes(job.stage)) throw new WorkflowError("Ready Check times can't be chosen at this point.");
  // An assigned installer (installer-supplied customer) arranges the visit directly (decision 180): the owner never picks windows here.
  if (inst) throw new WorkflowError("An installer is already arranging your Ready Check.");
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
  // No installer and not our lead: nothing is offered automatically (office picks the installer).
  await admin.from("jobs").update({ next_action: "Waiting for Home Insulation Victoria to choose an installer" }).eq("id", jobId);
  return { ok: true, round };
}

export const OWNER_WAITS_FOR_INSTALLER_TIMES = "Your installer will offer you Ready Check times. We'll send you a link to choose one.";

/** Owner view (no installer details). */
export async function ownerReadyCheckWindowState(jobId: string) {
  const access = await (await import('./ready-check-booking-access.server')).readyCheckBookingAccess(jobId);
  const [{ data: job }, inst, w, { count: asked }] = await Promise.all([
    admin.from("jobs").select("stage, channel").eq("id", jobId).single(), hasActiveInstaller(jobId), readyCheckWindowRound(jobId),
    admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "ready_check_more_times_requested"),
  ]);
  // Our leads: the owner never picks Ready Check windows (decision 53); old windows stay as read-only history.
  const stageOk = !!job && job.channel !== "hivic_sourced" && (READY_CHECK_WINDOW_STAGES as readonly string[]).includes(job.stage);
  const reopened = await (await import("./visit-events.server")).timesReopenedSince(jobId, "ready_check", w.roundStart);
  const canPick = access.allowed && stageOk && !inst && w.open.length === 0 && (w.round === 0 || (w.round === 1 && !!asked) || reopened);
  return { bookingAllowed: access.allowed, canPick, moreTimes: access.allowed && w.round === 1 && !!asked, round: w.round, windows: w.all.map((r) => ({ starts_at: r.starts_at, ends_at: r.ends_at, status: r.status })) };
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
    // Decision 153: clearance is derived below from the verified certification + recorded level/expiry; approval_status (logins only) is not a filter.
    admin.from("partner_workers").select("id, business_id, email, full_legal_name, removed_at, trade_role, piisa_status, piisa_certificate_path, piisa_verified_at").eq("trade_role", "installer").is("removed_at", null).in("business_id", inIds),
    admin.from("partner_offers").select("business_id, status, offered_at, responded_at").eq("kind", "ready_check").gte("offered_at", since).in("business_id", inIds),
    windows.length
      ? admin.from("bookings").select("business_id, scheduled_start, scheduled_end, jobs!inner(deleted_at, properties(postcode))").is("jobs.deleted_at", null).eq("status", "confirmed").in("business_id", inIds)
          .gte("scheduled_start", new Date(Math.min(...windows.map((x) => x.s)) - 86_400_000).toISOString())
          .lte("scheduled_start", new Date(Math.max(...windows.map((x) => x.e)) + 86_400_000).toISOString())
      : Promise.resolve({ data: [] as { business_id: string | null; scheduled_start: string; scheduled_end: string | null; jobs: unknown }[] }),
  ]);
  // Certification: latest record per worker (by id or email) + latest office-recorded level.
  // PIISA: installers who said No (or uploaded but not yet verified) can't be offered jobs.
  // ESC collection notice (decision 130): a person who has not acknowledged it is not offered work either.
  const { workerOfferBlocker } = await import("./worker-compliance.core");
  const noticeAck = await (await import("./esc-collection-notice.server")).noticeAckMap((workers ?? []) as never);
  const wk = (workers ?? []).filter((x) => !workerOfferBlocker({ ...x, collection_notice_acknowledged: noticeAck.get(x.id) ?? null } as never, melbourneYmd(new Date())));
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
      // H3 (24 Oct 2026): a lapsed public liability certificate blocks new offers like an expired CII, whatever its `critical` flag.
      // Decision 371: so does a lapsed business installer certificate (latest stored date per document).
      credentialsOk: !partnerWorkBlocker(b as unknown as BusinessLike, (creds ?? []).filter((x) => x.business_id === b.id))
        && !publicLiabilityBlocker(latestExpiry((creds ?? []).filter((x) => x.business_id === b.id).map((x) => ({ kind: x.kind, label: x.label, expires: x.expires_at, verified: x.verification === "verified" })), "public_liability_insurance"), today)
        && !expiredBusinessDocsBlocker((creds ?? []).filter((x) => x.business_id === b.id).map((x) => ({ kind: x.kind, label: x.label, expires: x.expires_at, verified: x.verification === "verified" })), today, ["public_liability_insurance", "installer_certification"]),
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

/** Office picks ONE installer for an our-lead Ready Check (Jo 24 Oct 2026, decisions 49–51). No automatic batches: this
 *  is the only way a Ready Check offer is made. Logic: ready-check-times.server (officePickReadyCheckInstaller). */
export async function startReadyCheckOffers(jobId: string, actorId: string | null, onlyBusiness?: string | string[], _opts: { adding?: boolean } = {}) {
  const picks = onlyBusiness ? (Array.isArray(onlyBusiness) ? onlyBusiness : [onlyBusiness]) : [];
  return (await import("./ready-check-times.server")).officePickReadyCheckInstaller(jobId, actorId, picks);
}

/** Installer answers a Ready Check offer. "Not for me" closes it and returns the job to the office. Accepting is only by
 *  offering the owner 3 times (ready-check-times.server acceptOfferWithTimes). */
export async function respondToReadyCheckOffer(offerId: string, userId: string, accept: boolean, reason: string | null, _windowId: string | null) {
  if (accept) throw new WorkflowError("To accept, offer the owner 3 Ready Check times.");
  return (await import("./ready-check-times.server")).declineReadyCheckOffer(offerId, userId, reason);
}


/** Open owner windows for these jobs (times only, never owner details) — for the installer dashboard. */
export async function readyCheckOfferWindows(jobIds: string[]) {
  if (!jobIds.length) return [];
  const { data } = await admin.from("ready_check_windows").select("id, job_id, starts_at, ends_at").in("job_id", jobIds).eq("status", "open").gt("starts_at", new Date().toISOString()).order("starts_at");
  return data ?? [];
}

/** 15-minute timer (allocation tick): Ready Check offers with no times after 24 hours close and go back to the office.
 *  Never starts or widens offers. Logic: ready-check-times.server (sweepOfficePickedOffers). */
export async function sweepReadyCheckOffers(actorId: string | null = null, now = new Date()) {
  return (await import("./ready-check-times.server")).sweepOfficePickedOffers(actorId, now);
}

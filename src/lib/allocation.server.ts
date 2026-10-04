// Contractor allocation + direct coordination persistence. Pure rules: allocation.core.ts.
// Never moves stages itself; acceptance is atomic in SQL (accept_partner_offer, migration 0086).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { WorkflowError, logEvent, piesaRequestFacts } from "./workflow.server";
import { verifiedServiceAreaMatch, partnerWorkBlocker, type BusinessLike } from "./pilot.core";
import {
  ACCEPT_OUTCOME_MESSAGE, OWNER_CONTACT_NOTICE, TRADE_CONTACT_NOTICE, anonymisedOffer, coordinationState, electricalClearance,
  nextOfferBatch, offerExpiry, piesaOfferBlockers, rankRecCandidates, recEligibilityBlocker, type RecCandidate, type VisitKind,
} from "./allocation.core";

const NONE = ["00000000-0000-0000-0000-000000000000"];

async function settings() {
  const { data } = await admin.from("workflow_settings").select("rec_offer_expiry_hours, rec_offer_batch_size").eq("id", 1).maybeSingle();
  return { expiryHours: Number(data?.rec_offer_expiry_hours ?? 2), batchSize: Number(data?.rec_offer_batch_size ?? 3) };
}

/** Facts used to judge each REC for a job. Price is loaded for display only. */
export async function recCandidatesFor(jobId: string): Promise<{ postcode: string | null; candidates: (RecCandidate & { blocker: string | null })[] }> {
  const { data: job } = await admin.from("jobs").select("id, properties(postcode)").eq("id", jobId).single();
  const postcode = (job?.properties as { postcode: string | null } | null)?.postcode ?? null;
  const { data: bizs } = await admin.from("businesses").select("*").or("business_type.eq.rec,capabilities.cs.{electrician}");
  const ids = (bizs ?? []).map((b) => b.id);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: creds }, { data: workers }, { data: asg }, { data: offers }, { data: prefs }] = await Promise.all([
    admin.from("business_credentials").select("business_id,kind,label,expires_at,critical,verification").in("business_id", ids.length ? ids : NONE),
    admin.from("partner_workers").select("business_id").eq("trade_role", "electrician").eq("approval_status", "approved").in("business_id", ids.length ? ids : NONE),
    admin.from("job_assignments").select("business_id").eq("role", "electrician").eq("active", true).in("business_id", ids.length ? ids : NONE),
    admin.from("partner_offers").select("business_id, status").in("kind", ["piesa", "rectification"]).gte("offered_at", since).in("business_id", ids.length ? ids : NONE),
    admin.from("partner_relationships").select("electrician_business_id, installer_business_id").eq("active", true),
  ]);
  const { data: inst } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  const preferred = new Set((prefs ?? [])
    .filter((r) => r.installer_business_id === inst?.business_id).map((r) => r.electrician_business_id));
  const candidates = (bizs ?? []).map((b) => {
    const bc = (creds ?? []).filter((c) => c.business_id === b.id);
    const mine = (offers ?? []).filter((o) => o.business_id === b.id);
    const answered = mine.filter((o) => o.status !== "pending");
    const c: RecCandidate = {
      business_id: b.id, name: b.name, is_active: b.is_active, onboarding_status: b.onboarding_status,
      accepting_new_jobs: b.accepting_new_jobs ?? null, receives_hivic_leads: b.receives_hivic_leads ?? null,
      coverage_verified: !!b.coverage_verified_at, covers_postcode: verifiedServiceAreaMatch(b, postcode),
      exact_postcode: !!postcode && !!b.service_postcodes?.includes(postcode),
      has_valid_licence: !!(b.licence_number || b.rec_number) && !partnerWorkBlocker(b as unknown as BusinessLike, bc),
      approved_workers: (workers ?? []).filter((w) => w.business_id === b.id).length,
      weekly_capacity: b.weekly_capacity ?? null, open_jobs: (asg ?? []).filter((a) => a.business_id === b.id).length,
      recent_offers_30d: mine.length, acceptance_rate: answered.length ? answered.filter((o) => o.status === "accepted").length / answered.length : null,
      preferred: preferred.has(b.id),
    };
    return { ...c, blocker: recEligibilityBlocker(c) };
  });
  return { postcode, candidates };
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
async function agreedElectricianRates(businessIds: string[], kind: "piesa" | "rectification") {
  const out = new Map<string, { id: string; rate: number }>();
  if (!businessIds.length) return out;
  const { OFFER_RATE_SERVICE, selectAgreedRate } = await import("./allocation.core");
  const service = OFFER_RATE_SERVICE[kind];
  const { data, error } = await (admin as unknown as { from: (t: string) => any }).from("electrician_rates") // eslint-disable-line @typescript-eslint/no-explicit-any
    .select("id, business_id, service_type, rate_inc_gst, status, effective_from, effective_to").eq("status", "active").eq("service_type", service).in("business_id", businessIds);
  if (error) return out;
  const today = new Date().toISOString().slice(0, 10);
  for (const b of businessIds) {
    const r = selectAgreedRate(data ?? [], b, service, today);
    if (r) out.set(b, { id: r.id, rate: Number(r.rate_inc_gst) });
  }
  return out;
}

export async function startPiesaAllocation(jobId: string, actorId: string | null, kind: "piesa" | "rectification" = "piesa", opts: { rateToConfirm?: boolean } = {}) {
  const [facts, { count: elec }, { count: open }] = await Promise.all([
    piesaRequestFacts(jobId),
    admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", "electrician").eq("active", true),
    admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", kind).eq("status", "pending"),
  ]);
  const blockers = piesaOfferBlockers({ ...facts, hasActiveElectrician: !!elec, hasOpenOffers: !!open });
  if (blockers.length) throw new WorkflowError(`PIESA offers cannot start: ${blockers.join(" ")}`);
  return offerNextBatch(jobId, actorId, kind, !!opts.rateToConfirm);
}

async function offerNextBatch(jobId: string, actorId: string | null, kind: "piesa" | "rectification", rateToConfirm = false) {
  const { expiryHours, batchSize } = await settings();
  const [{ candidates }, { data: prior }] = await Promise.all([
    recCandidatesFor(jobId),
    admin.from("partner_offers").select("business_id, batch").eq("job_id", jobId).eq("kind", kind),
  ]);
  const offered = new Set((prior ?? []).map((o) => o.business_id));
  const batchNo = Math.max(0, ...(prior ?? []).map((o) => o.batch)) + 1;
  const rates = await agreedElectricianRates(candidates.map((c) => c.business_id), kind);
  const { offerRateBlocker } = await import("./allocation.core");
  const noRate = candidates.filter((c) => offerRateBlocker(rates.get(c.business_id)?.rate ?? null, rateToConfirm));
  if (noRate.length) await logEvent(jobId, actorId, "rec_offer_rate_missing", `${noRate.length} electrician(s) skipped: no agreed electrician rate recorded`, { kind, businesses: noRate.map((c) => c.business_id) }, { internal: true });
  const priced = candidates.filter((c) => !noRate.includes(c));
  const batch = nextOfferBatch(rankRecCandidates(priced), offered, batchSize);
  if (!batch.length) {
    await logEvent(jobId, actorId, "rec_coverage_exhausted", `No approved electrician left to offer the ${kind} to — needs Home Insulation Victoria`, { kind, offered: [...offered] }, { internal: true });
    await admin.from("jobs").update({ next_action: "Needs Home Insulation Victoria: no approved electrician coverage" }).eq("id", jobId);
    return { offered: 0, exhausted: true };
  }
  const summary = await offerFacts(jobId);
  const expires = offerExpiry(new Date(), expiryHours);
  const { error } = await admin.from("partner_offers").insert(batch.map((b) => ({ job_id: jobId, business_id: b.business_id, kind, batch: batchNo,
    summary: { ...summary, electrician_rate_inc_gst: rates.get(b.business_id)?.rate ?? null, electrician_rate_id: rates.get(b.business_id)?.id ?? null, electrician_rate_snapshot_at: new Date().toISOString(), rate_to_confirm: !rates.has(b.business_id) && rateToConfirm } as unknown as Json, offered_by: actorId, expires_at: expires })));
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, "rec_offers_made", `${kind === "piesa" ? "PIESA" : "Rectification"} offered to ${batch.length} approved electrician(s), batch ${batchNo}`, { kind, batch: batchNo, businesses: batch.map((b) => b.business_id), expires_at: expires }, { internal: true });
  return { offered: batch.length, exhausted: false };
}

/** Expire overdue electrician offers and automatically offer the next batch. Idempotent; safe to call often. */
export async function sweepRecOffers(actorId: string | null = null) {
  const nowIso = new Date().toISOString();
  const { data: expired } = await admin.from("partner_offers").update({ status: "expired" }).in("kind", ["piesa", "rectification"]).eq("status", "pending").lt("expires_at", nowIso).select("job_id, kind");
  for (const o of expired ?? []) await logEvent(o.job_id, actorId, "partner_offer_expired", `An electrician ${o.kind} offer expired without a response`, { kind: o.kind }, { internal: true });
  const jobs = new Map((expired ?? []).map((o) => [`${o.job_id}:${o.kind}`, o]));
  for (const o of jobs.values()) await refillIfNeeded(o.job_id, o.kind as "piesa" | "rectification", actorId);
  const started = await autoStartPiesaOffers(actorId);
  await flagUnapprovedElectricians(actorId);
  return { expired: expired?.length ?? 0, started };
}

/** Jobs that have genuinely reached PIESA (gate cleared) with no electrician and no offers yet get the first batch automatically.
 *  startPiesaAllocation re-checks every upstream gate; any blocker means the job is skipped, never forced. */
async function autoStartPiesaOffers(actorId: string | null) {
  const { data: waiting } = await admin.from("jobs").select("id").eq("stage", "piesa_and_install_window_pending").neq("source", "qa_test");
  let started = 0;
  for (const j of waiting ?? []) {
    const { count: any } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", j.id).eq("kind", "piesa");
    if (any) continue; // already allocated once; refill/exhaustion handles the rest
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
    const blocker = c ? recEligibilityBlocker({ ...c, accepting_new_jobs: true }) : "Business is no longer an approved REC.";
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
  if (!open && !elec) await offerNextBatch(jobId, actorId, kind);
}

/** Electrician accepts/declines a PIESA or rectification offer. Acceptance is atomic in SQL. */
export async function respondToRecOffer(offerId: string, userId: string, accept: boolean, reason: string | null) {
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
  if (o.kind === "piesa") {
    const { piesaRequestFacts } = await import("./workflow.server");
    const { piesaRequestBlockers } = await import("./payment-gate.core");
    const gate = piesaRequestBlockers(await piesaRequestFacts(o.job_id));
    if (gate.length) throw new WorkflowError(`This job is not ready for a PIESA: ${gate.join(" ")}`);
  }
  const { data, error } = await admin.rpc("accept_partner_offer" as never, { _offer: offerId, _user: userId } as never);
  if (error) throw new Error(error.message);
  const outcome = ((data as unknown as { outcome: string }[] | null)?.[0]?.outcome) ?? "not_found";
  if (outcome !== "accepted") throw new WorkflowError(ACCEPT_OUTCOME_MESSAGE[outcome] ?? "This offer could not be accepted.");
  await admin.from("jobs").update({ next_action: "Owner and electrician to agree a PIESA time" }).eq("id", o.job_id);
  return { ok: true };
}

/** Contacts for the caller's active visit only. Server-side: no release = nothing returned. */
export async function visitContacts(jobId: string, userId: string, role: string) {
  const { data: rel } = await admin.from("contact_releases").select("id, visit_kind, released_at, assignment_id, job_assignments!inner(user_id, role, business_id, active)").eq("job_id", jobId).is("revoked_at", null);
  const { data: job } = await admin.from("jobs").select("stage, owners(user_id, full_name, phone, email)").eq("id", jobId).single();
  const { visitIsCurrent } = await import("./allocation.core");
  const live = (rel ?? []).filter((r) => (r.job_assignments as { active: boolean }).active && visitIsCurrent(r.visit_kind, job?.stage ?? ""));
  const owner = job?.owners as { user_id: string | null; full_name: string | null; phone: string | null; email: string | null } | null;
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
  const { data: rel } = await admin.from("contact_releases").select("job_id, visit_kind, released_at, assignment_id, job_assignments!inner(active, booking_confirmed_at)").is("revoked_at", null).in("visit_kind", ["piesa", "rectification", "installation"]);
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

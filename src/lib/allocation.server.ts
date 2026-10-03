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
    piesa_rate_inc_gst: null, // shown only once a live agreed per-partner PIESA rate exists
  });
}

/** Office starts (or continues) PIESA allocation. Refuses before the PIESA gate is satisfied. */
export async function startPiesaAllocation(jobId: string, actorId: string | null, kind: "piesa" | "rectification" = "piesa") {
  const [facts, { count: elec }, { count: open }] = await Promise.all([
    piesaRequestFacts(jobId),
    admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", "electrician").eq("active", true),
    admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", kind).eq("status", "pending"),
  ]);
  const blockers = piesaOfferBlockers({ ...facts, hasActiveElectrician: !!elec, hasOpenOffers: !!open });
  if (blockers.length) throw new WorkflowError(`PIESA offers cannot start: ${blockers.join(" ")}`);
  return offerNextBatch(jobId, actorId, kind);
}

async function offerNextBatch(jobId: string, actorId: string | null, kind: "piesa" | "rectification") {
  const { expiryHours, batchSize } = await settings();
  const [{ candidates }, { data: prior }] = await Promise.all([
    recCandidatesFor(jobId),
    admin.from("partner_offers").select("business_id, batch").eq("job_id", jobId).eq("kind", kind),
  ]);
  const offered = new Set((prior ?? []).map((o) => o.business_id));
  const batchNo = Math.max(0, ...(prior ?? []).map((o) => o.batch)) + 1;
  const batch = nextOfferBatch(rankRecCandidates(candidates), offered, batchSize);
  if (!batch.length) {
    await logEvent(jobId, actorId, "rec_coverage_exhausted", `No approved electrician left to offer the ${kind} to — needs Home Insulation Victoria`, { kind, offered: [...offered] }, { internal: true });
    await admin.from("jobs").update({ next_action: "Needs Home Insulation Victoria: no approved electrician coverage" }).eq("id", jobId);
    return { offered: 0, exhausted: true };
  }
  const summary = await offerFacts(jobId);
  const expires = offerExpiry(new Date(), expiryHours);
  const { error } = await admin.from("partner_offers").insert(batch.map((b) => ({ job_id: jobId, business_id: b.business_id, kind, batch: batchNo, summary: summary as unknown as Json, offered_by: actorId, expires_at: expires })));
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, "rec_offers_made", `${kind === "piesa" ? "PIESA" : "Rectification"} offered to ${batch.length} approved electrician(s), batch ${batchNo}`, { kind, batch: batchNo, businesses: batch.map((b) => b.business_id), expires_at: expires }, { internal: true });
  return { offered: batch.length, exhausted: false };
}

/** Expire overdue electrician offers and automatically offer the next batch. Idempotent; safe to call often. */
export async function sweepRecOffers(actorId: string | null = null) {
  const nowIso = new Date().toISOString();
  const { data: expired } = await admin.from("partner_offers").update({ status: "expired" }).in("kind", ["piesa", "rectification"]).eq("status", "pending").lt("expires_at", nowIso).select("job_id, kind");
  const jobs = new Map((expired ?? []).map((o) => [`${o.job_id}:${o.kind}`, o]));
  for (const o of jobs.values()) await refillIfNeeded(o.job_id, o.kind as "piesa" | "rectification", actorId);
  return { expired: expired?.length ?? 0 };
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
  const { data: o } = await admin.from("partner_offers").select("id, job_id, kind, status, business_id").eq("id", offerId).single();
  if (!o) throw new WorkflowError("Offer not found.");
  if (!accept) {
    const { data: d } = await admin.from("partner_offers").update({ status: "declined", responded_by: userId, responded_at: new Date().toISOString(), decline_reason: reason }).eq("id", o.id).eq("status", "pending").select("id").maybeSingle();
    if (!d) throw new WorkflowError("This offer is no longer open.");
    await logEvent(o.job_id, userId, "partner_offer_declined", `Electrician declined the ${o.kind} offer`, { reason, business_id: o.business_id }, { internal: true });
    await refillIfNeeded(o.job_id, o.kind as "piesa" | "rectification", null);
    return { ok: true };
  }
  const { data: isElec } = await admin.rpc("has_role", { _user_id: userId, _role: "electrician" });
  if (!isElec) throw new WorkflowError("Only a licensed electrician team member can accept this job.");
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
  const live = (rel ?? []).filter((r) => (r.job_assignments as { active: boolean }).active);
  const { data: job } = await admin.from("jobs").select("owners(user_id, full_name, phone, email)").eq("id", jobId).single();
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
      reminders++;
    }
  }
  return { reminders };
}

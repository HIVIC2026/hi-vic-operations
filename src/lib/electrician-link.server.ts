// Part 2 (Jo 3 Nov 2026): the electrician's no-login link for an installer's own job. The token is the only credential:
// only its SHA-256 is stored (`electrician_job_links`, pending SQL 2026-11-03_electrician_job_links.sql). Every call
// re-checks the link (not revoked, not expired) AND that its electrician business is still the job's active electrician.
// Until the table exists everything fails closed: no link is made and every link says it isn't working.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingDbObject } from "./schema-compat.core";
import { hashToken, isTokenShape, linkExpiry, newToken } from "./worker-links.core";
import {
  JOB_NOT_GOING_AHEAD, LINK_NOT_ASSIGNED, LINK_UNAVAILABLE, OWN_JOB_PIESA_CANT_DO_EMAIL_APPROVED, OWN_JOB_PIESA_HANDED_BACK_EVENT,
  CANT_DO_REASONS, cantDoReasonLabel, electricianLinkPath, electricianLinkRefusal, electricianStep, officeCantDoEmail, piesaBookingProblem, piesaDoneAtStage, upgradesDayNotReady,
  type CantDoReason, type ElectricianStep,
} from "./electrician-link.core";
import { OWN_JOB_PIESA_HANDED_EVENT } from "./own-job-piesa.core";
import type { CertificateFacts } from "./certificate-later.server";
import {
  CERTIFICATE_ADDED_EVENT, CERTIFICATE_TOO_BIG, CERTIFICATE_UPLOAD_MAX_BYTES, CERTIFICATE_WRONG_TYPE, UPGRADES_DAY_LINK_CLAIM_EVENT, certificateFileExt, certificateProblem, certificateRejectedLine, certificateUploadPath,
  parseCertificateUploadPath, upgradesDayProblem,
} from "./certificate-later.core";
import { SET_PASSWORD_BASE } from "./set-password-link.core";

// Local schema overlay: the table is pending SQL, so generated types are not deployment proof.
const db = admin as unknown as SupabaseClient;

type LinkRow = { id: string; job_id: string; electrician_business_id: string; expires_at: string; revoked_at: string | null };
type Assignment = { id: string; user_id: string; business_id: string | null; booking_confirmed_at: string | null };
type Resolved =
  | { ok: true; jobId: string; electricianBusinessId: string; step: ElectricianStep; link: LinkRow; assignment: Assignment; stage: string; bookedStart: string | null; /** Part 3: the booked upgrades visit, when there is one. */ upgradesStart: string | null; /** Part 3: null until the safety check is done. */ certificate: CertificateFacts | null }
  | { ok: false; reason: string };

/** Make a 30-day link for this job and electrician business. Throws if the link can't be saved (e.g. table missing). */
export async function createElectricianLink(jobId: string, electricianBusinessId: string, now: number = Date.now()): Promise<{ id: string; url: string }> {
  const token = newToken();
  const { data, error } = await db.from("electrician_job_links")
    .insert({ job_id: jobId, electrician_business_id: electricianBusinessId, token_hash: await hashToken(token), expires_at: linkExpiry(now) })
    .select("id").single();
  if (error || !data) throw new Error(`The electrician's link could not be saved: ${error?.message ?? "no row"}`);
  return { id: (data as { id: string }).id, url: `${SET_PASSWORD_BASE}${electricianLinkPath(token)}` };
}

export async function createElectricianJobLink(jobId: string, electricianBusinessId: string): Promise<{ url: string }> {
  const { url } = await createElectricianLink(jobId, electricianBusinessId);
  return { url };
}

/** Switch off links: one link, or every open link on the job (optionally only one electrician business's). */
export async function revokeElectricianLinks(jobId: string, reason: string, opts: { linkId?: string; electricianBusinessId?: string } = {}, now: Date = new Date()): Promise<number> {
  let q = db.from("electrician_job_links").update({ revoked_at: now.toISOString(), revoked_reason: reason }).eq("job_id", jobId).is("revoked_at", null);
  if (opts.linkId) q = q.eq("id", opts.linkId);
  if (opts.electricianBusinessId) q = q.eq("electrician_business_id", opts.electricianBusinessId);
  const { data, error } = await q.select("id");
  if (error) { if (isMissingDbObject(error)) return 0; throw new Error(error.message); } // table not applied yet: nothing to switch off
  return (data ?? []).length;
}

async function resolveFull(token: string, now: Date): Promise<Resolved> {
  const refuse = (reason: string): Resolved => ({ ok: false, reason });
  if (!isTokenShape(token)) return refuse(electricianLinkRefusal({ found: false, revokedAt: null, expiresAt: now.toISOString(), now, stillAssigned: false })!);
  const { data: l, error } = await db.from("electrician_job_links").select("id, job_id, electrician_business_id, expires_at, revoked_at").eq("token_hash", await hashToken(token)).maybeSingle();
  if (error) return refuse(LINK_UNAVAILABLE);
  const link = l as LinkRow | null;
  if (!link) return refuse(electricianLinkRefusal({ found: false, revokedAt: null, expiresAt: now.toISOString(), now, stillAssigned: false })!);
  const [{ data: job, error: je }, { data: rows, error: ae }] = await Promise.all([
    admin.from("jobs").select("stage, deleted_at").eq("id", link.job_id).maybeSingle(),
    admin.from("job_assignments").select("id, user_id, business_id, booking_confirmed_at").eq("job_id", link.job_id).eq("role", "electrician").eq("active", true),
  ]);
  if (je || ae) return refuse(LINK_UNAVAILABLE);
  const assignment = ((rows ?? []) as Assignment[]).find((a) => a.business_id === link.electrician_business_id) ?? null;
  const refusal = electricianLinkRefusal({ found: true, revokedAt: link.revoked_at, expiresAt: link.expires_at, now, stillAssigned: !!assignment });
  if (refusal) return refuse(refusal);
  if (!job || job.deleted_at || job.stage === "cancelled") return refuse(JOB_NOT_GOING_AHEAD);
  const { data: b, error: be } = await admin.from("bookings").select("scheduled_start").eq("job_id", link.job_id).eq("kind", "assessment").eq("status", "confirmed").eq("business_id", link.electrician_business_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (be) return refuse(LINK_UNAVAILABLE);
  const bookedStart = (b?.scheduled_start as string | null | undefined) ?? null;
  const stage = job.stage as string;
  const piesaDone = piesaDoneAtStage(stage);
  // Part 3 (Task 3): once the safety check is done, the upgrades / certificate facts decide the step (read-only facts).
  let certificate: CertificateFacts | null = null, upgradesStart: string | null = null;
  if (piesaDone) {
    const [facts, { data: ub, error: ue }] = await Promise.all([
      (await import("./certificate-later.server")).jobCertificateFacts(link.job_id).catch(() => null),
      admin.from("bookings").select("scheduled_start").eq("job_id", link.job_id).eq("kind", "rectification").in("status", ["confirmed", "completed"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!facts || ue) return refuse(LINK_UNAVAILABLE);
    certificate = facts;
    upgradesStart = (ub?.scheduled_start as string | null | undefined) ?? null;
  }
  const step = electricianStep({
    booked: !!bookedStart || stage === "piesa_scheduled", piesaDone,
    // A certificate the office rejected is not "in": the link asks for a new one.
    ...(certificate ? { upgradesNeeded: certificate.upgradesNeeded, upgradesToday: certificate.upgradesToday, upgradesDaySet: certificate.upgradesDaySet, partCRecorded: certificate.partCRecorded, certificateIn: !!certificate.certificateFileAt && certificate.certificateRejectedWhy == null } : {}),
  });
  return { ok: true, jobId: link.job_id, electricianBusinessId: link.electrician_business_id, step, link, assignment: assignment!, stage, bookedStart, upgradesStart, certificate };
}

/** The link's job and next step, or why it can't be used. */
export async function resolveElectricianLink(token: string, now: Date = new Date()): Promise<{ ok: true; jobId: string; electricianBusinessId: string; step: ElectricianStep } | { ok: false; reason: string }> {
  const r = await resolveFull(token, now);
  return r.ok ? { ok: true, jobId: r.jobId, electricianBusinessId: r.electricianBusinessId, step: r.step } : r;
}

/** When the owner paid for the safety check. First round: the REAL paid time — the payment that took the safety check step
 *  to its amount (`stepPaidAt` over the payment ledger, the same facts `jobPaymentView` uses). A repeat round (job reopened) or
 *  any case where that isn't readable: the hand-over time of the current round (`own_job_piesa_handed`, written once the fee
 *  is paid). Null = not handed over. */
async function paidAtFor(jobId: string): Promise<string | null> {
  const { data, error } = await admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", OWN_JOB_PIESA_HANDED_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const handedAt = (data?.created_at as string | undefined) ?? null;
  if (!handedAt) return null;
  try {
    if (await (await import("./repeat-piesa.server")).latestReopenAt(jobId)) return handedAt; // repeat round: its own fee, own time
    const [{ jobPaymentView }, { stepPaidAt }] = await Promise.all([import("./payments.server"), import("./payments.core")]);
    const v = await jobPaymentView(jobId);
    const real = v ? stepPaidAt(v.plan, "safety_check", (v.ledger ?? []).filter((l) => l.kind !== "reversal").map((l) => ({ amountCents: l.amountCents, paidAt: l.paidAt }))) : null;
    return real ?? handedAt;
  } catch { return handedAt; }
}

/** The electrician's own worker row (the assignment's profile), else the business, for names and phone. */
async function electricianPerson(a: Assignment, businessId: string): Promise<{ id: string; name: string; phone: string | null }> {
  const [{ data: w }, { data: b }] = await Promise.all([
    admin.from("partner_workers").select("id, full_legal_name, mobile").eq("business_id", businessId).eq("profile_id", a.user_id).is("removed_at", null).limit(1).maybeSingle(),
    admin.from("businesses").select("name, trading_name, phone").eq("id", businessId).maybeSingle(),
  ]);
  const { displayName } = await import("./display-name.core");
  const bizName = displayName(b?.trading_name || b?.name) || "Your electrician";
  return { id: (w?.id as string | undefined) ?? a.user_id, name: displayName(w?.full_legal_name as string | null | undefined) || bizName, phone: (w?.mobile as string | null | undefined) || (b?.phone as string | null | undefined) || null };
}

/** Owner contacts for this assignment's safety check only (same release as an accepted offer). Idempotent. */
async function releaseOwnerContacts(jobId: string, assignmentId: string) {
  const { data: ex, error } = await admin.from("contact_releases").select("id").eq("job_id", jobId).eq("assignment_id", assignmentId).eq("visit_kind", "piesa").is("revoked_at", null).maybeSingle();
  if (error) throw new Error(error.message);
  if (ex) return;
  const { OWNER_CONTACT_NOTICE, TRADE_CONTACT_NOTICE } = await import("./allocation.core");
  const { error: ie } = await admin.from("contact_releases").upsert({ job_id: jobId, assignment_id: assignmentId, visit_kind: "piesa", released_by: null, owner_notice: OWNER_CONTACT_NOTICE, trade_notice: TRADE_CONTACT_NOTICE }, { onConflict: "assignment_id,visit_kind", ignoreDuplicates: true });
  if (ie) throw new Error(ie.message);
}

export type ElectricianLinkView =
  | { ok: false; reason: string }
  | { ok: true; step: ElectricianStep; jobNumber: string | null; address: string | null; ownerName: string | null; ownerMobile: string | null; bookedStart: string | null; firstDay: string; lastDay: string | null; electricianName: string;
      /** Part 3: the booked upgrades visit (do_upgrades_in_mitti), and the upload limit for the certificate step. */ upgradesStart: string | null; certificateMaxBytes: number;
      /** Fix round 1: the office rejected the current certificate — the line the certificate step shows (null = none). */ certificateRejected: string | null };

/** What the /e/<token> page shows: only the next step. Owner contacts only while the safety check is still to book. */
export async function electricianLinkView(token: string, now: Date = new Date()): Promise<ElectricianLinkView> {
  const r = await resolveFull(token, now);
  if (!r.ok) return r;
  const [{ data: j }, who, paidAt] = await Promise.all([
    admin.from("job_overview").select("job_number, property_address, owner_name, owner_phone").eq("id", r.jobId).maybeSingle(),
    electricianPerson(r.assignment, r.electricianBusinessId),
    paidAtFor(r.jobId),
  ]);
  const booking = r.step === "book_piesa";
  if (booking) await releaseOwnerContacts(r.jobId, r.assignment.id);
  const [{ melbourneToday, addMelbourneCalendarDays }, { melbourneYmd }] = await Promise.all([import("./melbourne-time.core"), import("./piesa-windows.core")]);
  const { displayName } = await import("./display-name.core");
  return {
    ok: true, step: r.step, jobNumber: (j?.job_number as string | null | undefined) ?? null, address: (j?.property_address as string | null | undefined) ?? null,
    ownerName: booking ? displayName(j?.owner_name as string | null | undefined) || null : null,
    ownerMobile: booking ? (j?.owner_phone as string | null | undefined) ?? null : null,
    bookedStart: r.bookedStart, firstDay: melbourneToday(now), lastDay: paidAt ? melbourneYmd(new Date(addMelbourneCalendarDays(paidAt, 30))) : null,
    electricianName: who.name, upgradesStart: r.upgradesStart, certificateMaxBytes: CERTIFICATE_UPLOAD_MAX_BYTES,
    certificateRejected: r.certificate?.certificateRejectedWhy != null ? certificateRejectedLine(r.certificate.certificateRejectedWhy) : null,
  };
}

/** The ONE place an own job's safety check is booked (the electrician's link and the installer office both come here):
 *  check the time → claim (one booking per assignment) → confirmBooking (kind assessment; the contractor is always the job's
 *  active electrician assignment) → supersede any open proposed times (as an office reassignment does) → the owner's booking
 *  notice. `actorId` is who pressed Book; `by` names them in the job history. */
export async function bookOwnJobPiesa(p: { jobId: string; assignment: Assignment; electricianBusinessId: string; startIso: string; actorId: string; by: string; now: Date }): Promise<{ ok: true; start: string }> {
  const { jobId, assignment, startIso, now } = p;
  const paidAt = await paidAtFor(jobId);
  if (!paidAt) throw new Error("This job isn't ready to book yet. Call the installer.");
  const problem = piesaBookingProblem(startIso, now, paidAt);
  if (problem) throw new Error(problem);
  const who = await electricianPerson(assignment, p.electricianBusinessId);
  // Claim first (a double tap or two phones): one stable event per assignment; a second claim is "already booked".
  const { stableUuid } = await import("./mitti-create-claim.core");
  // The claim is per assignment AND per booking history: a cancelled booking (electrician still assigned) opens a new claim.
  const { data: lastCancelled, error: lcErr } = await admin.from("bookings").select("id").eq("job_id", jobId).eq("kind", "assessment").eq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (lcErr) throw new Error(lcErr.message);
  const claimId = await stableUuid(`own_job_piesa_link_booked:${assignment.id}:${(lastCancelled?.id as string | undefined) ?? "none"}`);
  const { error: claimError } = await admin.from("workflow_events").insert({ id: claimId, job_id: jobId, actor_id: null, event_type: "own_job_piesa_link_booked", summary: "Safety check being booked", details: { assignment_id: assignment.id, start: startIso, by: p.by }, internal: true });
  if (claimError) { if (claimError.code === "23505") throw new Error("The safety check is already booked."); throw new Error(claimError.message); }
  try {
    const { confirmBooking } = await import("./booking.server");
    await confirmBooking(jobId, "assessment", startIso, p.actorId, p.by);
  } catch (e) {
    const { error: rel } = await admin.from("workflow_events").delete().eq("id", claimId); // nothing was booked: let them try again
    if (rel) console.error("booking claim not released", jobId, rel.message);
    throw e;
  }
  const { error } = await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "assessment").eq("status", "proposed");
  if (error) console.error("open safety check times not superseded", jobId, error.message);
  const { notifyOwnerBooked } = await import("./in-house-booking.server");
  await notifyOwnerBooked(jobId, "piesa", startIso, who, now).catch((e) => console.error("owner booking notice held", jobId, (e as Error).message));
  return { ok: true, start: startIso };
}

/** "Book it" from the electrician's link. */
export async function linkBookPiesa(token: string, startIso: string, now: Date = new Date()): Promise<{ ok: true; start: string }> {
  const r = await resolveFull(token, now);
  if (!r.ok) throw new Error(r.reason);
  if (r.step !== "book_piesa") throw new Error(r.step === "done" ? "The safety check is already done." : "The safety check is already booked.");
  const who = await electricianPerson(r.assignment, r.electricianBusinessId);
  return bookOwnJobPiesa({ jobId: r.jobId, assignment: r.assignment, electricianBusinessId: r.electricianBusinessId, startIso, actorId: r.assignment.user_id, by: `${who.name} (electrician's link)`, now });
}

export type CantDoResult = { ok: true; officeEmail: string };

/** "Can't do this one": end the electrician's assignment, switch off the link, log the hand-back (one office item) and
 *  email the installer office (held until Jo approves the wording). */
export async function linkCantDo(token: string, reason: CantDoReason, note?: string | null, now: Date = new Date()): Promise<CantDoResult> {
  if (!(CANT_DO_REASONS as readonly string[]).includes(reason)) throw new Error("Pick a reason.");
  const cleanNote = (note ?? "").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  if (reason === "other" && !cleanNote) throw new Error("Tell us why you can't do this one.");
  const r = await resolveFull(token, now);
  if (!r.ok) throw new Error(r.reason);
  if (r.step !== "book_piesa") throw new Error("The safety check is already booked. Call the installer to change it.");
  const label = cantDoReasonLabel(reason, cleanNote);
  const who = await electricianPerson(r.assignment, r.electricianBusinessId);
  // Claim first (a double tap): one stable event per assignment; a second claim is "already sent back".
  const { stableUuid } = await import("./mitti-create-claim.core");
  const claimId = await stableUuid(`own_job_piesa_link_cant_do:${r.assignment.id}`);
  const { error: claimError } = await admin.from("workflow_events").insert({ id: claimId, job_id: r.jobId, actor_id: null, event_type: "own_job_piesa_link_cant_do_claim", summary: "Electrician sending the safety check back from their link", details: { assignment_id: r.assignment.id }, internal: true });
  if (claimError) { if (claimError.code === "23505") throw new Error("Already sent back."); throw new Error(claimError.message); }
  const undo = async (withEvent: boolean) => {
    if (withEvent) { const { error } = await admin.from("workflow_events").delete().eq("job_id", r.jobId).eq("event_type", OWN_JOB_PIESA_HANDED_BACK_EVENT).contains("details", { assignment_id: r.assignment.id }); if (error) console.error("hand-back item not removed", r.jobId, error.message); }
    const { error } = await admin.from("workflow_events").delete().eq("id", claimId);
    if (error) console.error("can't-do claim not released", r.jobId, error.message);
  };
  const { logEvent } = await import("./workflow.server");
  try {
    await logEvent(r.jobId, null, OWN_JOB_PIESA_HANDED_BACK_EVENT, `${who.name} can't do the safety check (PIESA): ${label}. The installer picks another electrician or books it`,
      { reason, note: cleanNote, electrician_business_id: r.electricianBusinessId, assignment_id: r.assignment.id, needs_office: true }, { internal: true });
  } catch (e) { await undo(false); throw e; }
  const { data: ended, error } = await admin.from("job_assignments").update({ active: false, ended_at: now.toISOString(), end_reason: `Electrician can't do this one: ${label}` })
    .eq("id", r.assignment.id).eq("active", true).select("id");
  if (error || !(ended ?? []).length) { await undo(true); throw new Error(error ? error.message : LINK_NOT_ASSIGNED); }
  await revokeElectricianLinks(r.jobId, "cant_do", { electricianBusinessId: r.electricianBusinessId }, now);
  await admin.from("contact_releases").update({ revoked_at: now.toISOString() }).eq("assignment_id", r.assignment.id).is("revoked_at", null);
  let officeEmail = "not_sent";
  try {
    const { data: job } = await admin.from("jobs").select("originating_installer_business_id").eq("id", r.jobId).maybeSingle();
    const { data: ov } = await admin.from("job_overview").select("property_address, job_number").eq("id", r.jobId).maybeSingle();
    const installerId = (job?.originating_installer_business_id as string | null | undefined) ?? null;
    if (!installerId) officeEmail = "no_installer";
    else {
      const address = (ov?.property_address as string | null | undefined) || (ov?.job_number as string | null | undefined) || "this job";
      const mail = officeCantDoEmail({ address, electrician: who.name, reason: label, jobUrl: `${SET_PASSWORD_BASE}/field/${r.jobId}` });
      const { emailInstallerOffice } = await import("./own-job-piesa-notices.server");
      const out = await emailInstallerOffice({ jobId: r.jobId, businessId: installerId, key: `own-job-piesa:v1:${r.assignment.id}:cant-do`, subject: mail.subject, text: mail.text, jobUrl: `${SET_PASSWORD_BASE}/field/${r.jobId}`, approved: OWN_JOB_PIESA_CANT_DO_EMAIL_APPROVED });
      officeEmail = out.status;
    }
  } catch (e) { console.error("can't-do office email skipped", r.jobId, (e as Error).message); }
  return { ok: true, officeEmail };
}


// ====================================================================================================
// Part 3 Task 3 (Jo 3 Nov 2026): the upgrades day and the certificate from the electrician's link.
// ====================================================================================================

/** An upgrades-day claim with no booking behind it older than this is stale (a crash mid-booking), not a second tap in flight. */
const STALE_CLAIM_MS = 2 * 60_000;

/** "Enter the upgrades day": claim (one per assignment and booking round) → confirmBooking kind rectification (the real one,
 *  which also makes the A4 form — decision 293) → the owner's "You're booked" (held until Jo approves the wording). */
export async function linkEnterUpgradesDay(token: string, startIso: string, now: Date = new Date()): Promise<{ ok: true; start: string }> {
  const r = await resolveFull(token, now);
  if (!r.ok) throw new Error(r.reason);
  if (r.step !== "enter_upgrades_day") throw new Error(r.step === "do_upgrades_in_mitti" ? "The upgrades day is already set." : r.step === "add_certificate" ? "The upgrades are already recorded — add the certificate." : r.step === "done" ? "This job is all done." : "The safety check comes first.");
  const problem = upgradesDayProblem(startIso, now);
  if (problem) throw new Error(problem);
  // Part 3 final fix wave: the upgrades day is booked only at the upgrades-booking stages. A job still parked at PIESA
  // complete (e.g. completed before this fix) is moved on by the normal guarded auto-advance first; if it still isn't
  // there, the electrician gets a plain reason and nothing is claimed or booked.
  const { autoAdvanceJob } = await import("./autoadvance.server");
  const { getStage, WorkflowError } = await import("./workflow.server");
  const { officePhone } = await import("./office-phone.server");
  const upgradesStages = ["rectification_scheduling", "rectification_booked"];
  if (!upgradesStages.includes(r.stage)) {
    await autoAdvanceJob(r.jobId, null, "upgrades day from the electrician's link").catch((e) => console.error("upgrades day auto-advance failed", r.jobId, (e as Error).message));
    const now2 = await getStage(r.jobId).catch(() => null);
    if (!now2 || !upgradesStages.includes(now2)) {
      console.warn("upgrades day refused: job not at the upgrades booking", r.jobId, now2);
      throw new Error(upgradesDayNotReady(officePhone()));
    }
  }
  const who = await electricianPerson(r.assignment, r.electricianBusinessId);
  const { stableUuid } = await import("./mitti-create-claim.core");
  // One claim per assignment AND per booking history: a cancelled upgrades booking (electrician still assigned) opens a new claim.
  const { data: lastCancelled, error: lcErr } = await admin.from("bookings").select("id").eq("job_id", r.jobId).eq("kind", "rectification").eq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (lcErr) throw new Error(lcErr.message);
  const claimId = await stableUuid(`${UPGRADES_DAY_LINK_CLAIM_EVENT}:${r.assignment.id}:${(lastCancelled?.id as string | undefined) ?? "none"}`);
  const claimRow = (stale = false) => ({ id: claimId, job_id: r.jobId, actor_id: null, event_type: UPGRADES_DAY_LINK_CLAIM_EVENT, summary: "Electrical upgrades day being entered from the electrician's link", details: { assignment_id: r.assignment.id, start: startIso, by: `${who.name} (electrician's link)`, ...(stale ? { stale_claim_reset: true } : {}) }, internal: true });
  let { error: claimError } = await admin.from("workflow_events").insert(claimRow());
  if (claimError?.code === "23505") {
    // Fix round 1: a claim with no booking behind it and older than the in-flight window is a crash between the claim and the
    // booking — reset it (logged) so the step isn't locked. A younger claim is a second tap in flight: "already set".
    const [{ data: prior }, { data: booked }] = await Promise.all([
      admin.from("workflow_events").select("created_at").eq("id", claimId).maybeSingle(),
      admin.from("bookings").select("id").eq("job_id", r.jobId).eq("kind", "rectification").eq("business_id", r.electricianBusinessId).in("status", ["confirmed", "completed"]).limit(1),
    ]);
    const age = prior?.created_at ? now.getTime() - Date.parse(prior.created_at as string) : 0;
    if (!(booked ?? []).length && age > STALE_CLAIM_MS) {
      console.warn("stale upgrades-day claim reset", r.jobId, claimId, `${Math.round(age / 1000)}s old, no booking`);
      // Task 4: the delete only takes a claim that is STILL stale. Two taps that both saw the stale claim: the second one's
      // delete finds nothing (the first tap's new claim is fresh) and is "already set" — never a second booking.
      const { data: gone, error: del } = await admin.from("workflow_events").delete().eq("id", claimId).lt("created_at", new Date(now.getTime() - STALE_CLAIM_MS).toISOString()).select("id");
      if (del) throw new Error(del.message);
      if (((gone ?? []) as unknown[]).length) ({ error: claimError } = await admin.from("workflow_events").insert(claimRow(true)));
    }
  }
  if (claimError) { if (claimError.code === "23505") throw new Error("The upgrades day is already set."); throw new Error(claimError.message); }
  try {
    const { confirmBooking } = await import("./booking.server");
    await confirmBooking(r.jobId, "rectification", startIso, r.assignment.user_id, `${who.name} (electrician's link)`);
  } catch (e) {
    const { error: rel } = await admin.from("workflow_events").delete().eq("id", claimId); // nothing was booked: let them try again
    if (rel) console.error("upgrades day claim not released", r.jobId, rel.message);
    // A booking-rule refusal (stage moved, a guard) is shown in plain words; the real reason stays in the server log.
    if (e instanceof WorkflowError) { console.warn("upgrades day refused", r.jobId, e.message); throw new Error(upgradesDayNotReady(officePhone())); }
    throw e;
  }
  const { notifyOwnerBooked } = await import("./in-house-booking.server");
  await notifyOwnerBooked(r.jobId, "upgrades", startIso, who, now).catch((e) => console.error("owner upgrades booking notice held", r.jobId, (e as Error).message));
  return { ok: true, start: startIso };
}

/** A signed upload URL for the certificate (photo or PDF, ≤25 MB), minted only for a valid link at the certificate step. */
export async function linkStartCertificateUpload(token: string, f: { fileName: string; mime: string; size: number }, now: Date = new Date()): Promise<{ path: string; token: string; mime: string }> {
  const r = await resolveFull(token, now);
  if (!r.ok) throw new Error(r.reason);
  if (r.step !== "add_certificate") throw new Error(r.step === "done" ? "The certificate is already in." : "The upgrades aren't recorded yet.");
  const { allowedUpload } = await import("./upload-safety.core");
  const mime = allowedUpload(f.fileName, f.mime);
  const ext = mime ? certificateFileExt(mime) : null;
  if (!mime || !ext) throw new Error(CERTIFICATE_WRONG_TYPE);
  if (!(f.size > 0)) throw new Error("That file is empty.");
  if (f.size > CERTIFICATE_UPLOAD_MAX_BYTES) throw new Error(CERTIFICATE_TOO_BIG);
  const path = certificateUploadPath(r.jobId, crypto.randomUUID(), mime);
  const { data, error } = await admin.storage.from("job-files").createSignedUploadUrl(path);
  if (error || !data) throw new Error("Could not start the upload. Check your connection and try again.");
  return { path, token: data.token, mime };
}

/** "Add your Certificate of Electrical Safety": the stored upload is checked (bytes match a photo/PDF), then filed as the
 *  portal `rectification_completion` evidence — the place coes-check.server `currentCoes` reads (source "portal") — the number
 *  and date go onto the PIESA answers (Part C), and the existing certificate check runs (AI tick or one office row, owner copy).
 *  Part C was already recorded (A4 or same-day A3), so no second PIESA record is written. One claim per upload. */
export async function linkAddCertificate(token: string, c: { number: string; date: string; filePath: string; fileName?: string | null }, now: Date = new Date()): Promise<{ ok: true; result: string }> {
  const r = await resolveFull(token, now);
  if (!r.ok) throw new Error(r.reason);
  if (r.step !== "add_certificate") throw new Error(r.step === "done" ? "The certificate is already in." : "The upgrades aren't recorded yet.");
  const { melbourneToday } = await import("./melbourne-time.core");
  const problem = certificateProblem({ number: c.number, date: c.date, hasFile: !!c.filePath, today: melbourneToday(now) });
  if (problem) throw new Error(problem);
  const uploadId = parseCertificateUploadPath(r.jobId, c.filePath);
  if (!uploadId) throw new Error("That upload doesn't belong to this job. Add the file again.");
  // The stored object: present, a real size, within the limit, and its first bytes a photo or PDF (deleted if not).
  const folder = c.filePath.slice(0, c.filePath.lastIndexOf("/"));
  const { data: objs, error: le } = await admin.storage.from("job-files").list(folder, { search: uploadId });
  if (le) throw new Error("Could not check the upload. Try again.");
  const obj = (objs ?? []).find((o) => c.filePath.endsWith(`/${o.name}`));
  if (!obj) throw new Error("The upload didn't finish. Check your connection and add the file again.");
  const size = Number((obj.metadata as { size?: number } | null)?.size ?? 0);
  const { allowedUpload } = await import("./upload-safety.core");
  const mime = allowedUpload(c.filePath, (obj.metadata as { mimetype?: string } | null)?.mimetype ?? null) ?? allowedUpload(c.filePath, null);
  if (!mime || !certificateFileExt(mime) || size <= 0 || size > CERTIFICATE_UPLOAD_MAX_BYTES) {
    await admin.storage.from("job-files").remove([c.filePath]).catch(() => null);
    throw new Error(size > CERTIFICATE_UPLOAD_MAX_BYTES ? CERTIFICATE_TOO_BIG : CERTIFICATE_WRONG_TYPE);
  }
  const { verifyStoredUpload } = await import("./upload-safety.server");
  await verifyStoredUpload("job-files", c.filePath, mime);
  // The portal evidence requirement this certificate is filed under (seeded with every job; made here if an old job lacks it).
  const { data: reqRows, error: re } = await admin.from("evidence_requirements").select("id").eq("job_id", r.jobId).eq("category", "rectification_completion").order("id").limit(1);
  if (re) throw new Error(re.message);
  let requirementId = ((reqRows ?? []) as { id: string }[])[0]?.id ?? null;
  if (!requirementId) {
    const { stableUuid } = await import("./mitti-create-claim.core");
    const newId = await stableUuid(`evidence_requirement:rectification_completion:${r.jobId}`);
    const { error: ie } = await admin.from("evidence_requirements").insert({ id: newId, job_id: r.jobId, category: "rectification_completion", gate: "electrical", label: "Rectification completion evidence", required: true, responsible_role: "electrician", status: "outstanding", sort: 4 } as never);
    if (ie && ie.code !== "23505") throw new Error(ie.message);
    requirementId = newId;
  }
  // Claim first (a double tap): one stable event per upload; a second claim is "already added".
  const { stableUuid } = await import("./mitti-create-claim.core");
  const claimId = await stableUuid(`${CERTIFICATE_ADDED_EVENT}:${c.filePath}`);
  const who = await electricianPerson(r.assignment, r.electricianBusinessId);
  const { error: claimError } = await admin.from("workflow_events").insert({ id: claimId, job_id: r.jobId, actor_id: null, event_type: CERTIFICATE_ADDED_EVENT, summary: `${who.name} added the Certificate of Electrical Safety (${c.number.trim()}, certified ${c.date}) through their link`, details: { assignment_id: r.assignment.id, upload_id: uploadId, path: c.filePath, coes_number: c.number.trim(), cert_date: c.date, size_bytes: size, mime_type: mime }, internal: true });
  if (claimError) { if (claimError.code === "23505") throw new Error("That certificate is already added."); throw new Error(claimError.message); }
  const release = async () => { const { error } = await admin.from("workflow_events").delete().eq("id", claimId); if (error) console.error("certificate claim not released", r.jobId, error.message); };
  try {
    const { persistEvidenceConfirmation } = await import("./evidence-confirmation.server");
    const safeName = (c.fileName ?? "").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || `certificate.${certificateFileExt(mime)}`;
    await persistEvidenceConfirmation(admin as never, {
      requirement_id: requirementId, job_id: r.jobId, storage_path: c.filePath, file_name: safeName, mime_type: mime, size_bytes: size, uploaded_by: r.assignment.user_id,
      lat: null, lng: null, location_accuracy_m: null, captured_at: null, distance_m: null, location_source: "not_required",
    }, async () => undefined);
    // Part C: the number and date onto the stored PIESA answers (the file stays the portal evidence above).
    const { data: a, error: ae } = await admin.from("assessments").select("id, mitti_raw_snapshot").eq("job_id", r.jobId).maybeSingle();
    if (ae) throw new Error(ae.message);
    if (a) {
      const snap = Array.isArray(a.mitti_raw_snapshot) ? (a.mitti_raw_snapshot as { label: string; value: string | null }[]).filter((e) => e && typeof e.label === "string") : [];
      const { mergeCertificateIntoPiesaSnapshot } = await import("./fixes-day.core");
      const merged = mergeCertificateIntoPiesaSnapshot(snap, { number: c.number, date: c.date });
      const { error: ue } = await admin.from("assessments").update({ mitti_raw_snapshot: merged as never }).eq("id", a.id);
      if (ue) throw new Error(ue.message);
    }
  } catch (e) { await release(); throw e; }
  // The existing certificate check (AI tick or one office row) and the owner's copy, through their own guards. Never throws.
  const result = await (await import("./coes-check.server")).checkCurrentCoes(r.jobId, r.assignment.user_id);
  return { ok: true, result };
}

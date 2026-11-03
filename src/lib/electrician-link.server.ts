// Part 2 (Jo 3 Nov 2026): the electrician's no-login link for an installer's own job. The token is the only credential:
// only its SHA-256 is stored (`electrician_job_links`, pending SQL 2026-11-03_electrician_job_links.sql). Every call
// re-checks the link (not revoked, not expired) AND that its electrician business is still the job's active electrician.
// Until the table exists everything fails closed: no link is made and every link says it isn't working.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashToken, isTokenShape, linkExpiry, newToken } from "./worker-links.core";
import {
  JOB_NOT_GOING_AHEAD, LINK_NOT_ASSIGNED, LINK_UNAVAILABLE, OWN_JOB_PIESA_CANT_DO_EMAIL_APPROVED, OWN_JOB_PIESA_HANDED_BACK_EVENT,
  CANT_DO_REASONS, cantDoReasonLabel, electricianLinkPath, electricianLinkRefusal, electricianStep, officeCantDoEmail, piesaBookingProblem, piesaDoneAtStage,
  type CantDoReason, type ElectricianStep,
} from "./electrician-link.core";
import { OWN_JOB_PIESA_HANDED_EVENT } from "./own-job-piesa.core";
import { SET_PASSWORD_BASE } from "./set-password-link.core";

// Local schema overlay: the table is pending SQL, so generated types are not deployment proof.
const db = admin as unknown as SupabaseClient;

type LinkRow = { id: string; job_id: string; electrician_business_id: string; expires_at: string; revoked_at: string | null };
type Assignment = { id: string; user_id: string; business_id: string | null; booking_confirmed_at: string | null };
type Resolved =
  | { ok: true; jobId: string; electricianBusinessId: string; step: ElectricianStep; link: LinkRow; assignment: Assignment; stage: string; bookedStart: string | null }
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
  if (error) throw new Error(error.message);
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
  const step = electricianStep({ booked: !!bookedStart || stage === "piesa_scheduled", piesaDone: piesaDoneAtStage(stage) });
  return { ok: true, jobId: link.job_id, electricianBusinessId: link.electrician_business_id, step, link, assignment: assignment!, stage, bookedStart };
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
  | { ok: true; step: ElectricianStep; jobNumber: string | null; address: string | null; ownerName: string | null; ownerMobile: string | null; bookedStart: string | null; firstDay: string; lastDay: string | null; electricianName: string };

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
    electricianName: who.name,
  };
}

/** "Book it": resolve → check the time → confirmBooking (kind assessment, as the electrician) → supersede any open
 *  proposed times (as an office reassignment does) → the owner's booking notice. */
export async function linkBookPiesa(token: string, startIso: string, now: Date = new Date()): Promise<{ ok: true; start: string }> {
  const r = await resolveFull(token, now);
  if (!r.ok) throw new Error(r.reason);
  if (r.step !== "book_piesa") throw new Error(r.step === "done" ? "The safety check is already done." : "The safety check is already booked.");
  const paidAt = await paidAtFor(r.jobId);
  if (!paidAt) throw new Error("This job isn't ready to book yet. Call the installer.");
  const problem = piesaBookingProblem(startIso, now, paidAt);
  if (problem) throw new Error(problem);
  const who = await electricianPerson(r.assignment, r.electricianBusinessId);
  // Claim first (a double tap or two phones): one stable event per assignment; a second claim is "already booked".
  const { stableUuid } = await import("./mitti-create-claim.core");
  // The claim is per assignment AND per booking history: a cancelled booking (electrician still assigned) opens a new claim.
  const { data: lastCancelled, error: lcErr } = await admin.from("bookings").select("id").eq("job_id", r.jobId).eq("kind", "assessment").eq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (lcErr) throw new Error(lcErr.message);
  const claimId = await stableUuid(`own_job_piesa_link_booked:${r.assignment.id}:${(lastCancelled?.id as string | undefined) ?? "none"}`);
  const { error: claimError } = await admin.from("workflow_events").insert({ id: claimId, job_id: r.jobId, actor_id: null, event_type: "own_job_piesa_link_booked", summary: "Electrician booking the safety check from their link", details: { assignment_id: r.assignment.id, start: startIso }, internal: true });
  if (claimError) { if (claimError.code === "23505") throw new Error("The safety check is already booked."); throw new Error(claimError.message); }
  try {
    const { confirmBooking } = await import("./booking.server");
    await confirmBooking(r.jobId, "assessment", startIso, r.assignment.user_id, `${who.name} (electrician's link)`);
  } catch (e) {
    const { error: rel } = await admin.from("workflow_events").delete().eq("id", claimId); // nothing was booked: let them try again
    if (rel) console.error("booking claim not released", r.jobId, rel.message);
    throw e;
  }
  const { error } = await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", r.jobId).eq("kind", "assessment").eq("status", "proposed");
  if (error) console.error("open safety check times not superseded", r.jobId, error.message);
  const { notifyOwnerBooked } = await import("./in-house-booking.server");
  await notifyOwnerBooked(r.jobId, "piesa", startIso, who, now).catch((e) => console.error("owner booking notice held", r.jobId, (e as Error).message));
  return { ok: true, start: startIso };
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


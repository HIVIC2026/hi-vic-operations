// Part 2 (Jo 3 Nov 2026): an installer's own job (channel installer_sourced, not held by an in-house partner) skips the
// safety check offer. Once the owner's safety check (PIESA) fee is paid the job goes straight to the installer's chosen
// electrician: one active electrician assignment, the PIESA stage, one `own_job_piesa_handed` event (keyed per job and
// round, so a double payment or two sweeps hand it over once), then the notices. A missing electrician or portal
// profile becomes one office item instead. HIV leads and in-house partner jobs never come here.
// Static imports stay light (no workflow import graph); the rest is loaded when used.
import { jobAdmin as admin } from "./job-facts.server"; // speed (Task 11): the admin client; inside the job page bundle it answers from the job's rows
import { inHouseDispatchSkip, readInHouseDispatchState, type InHouseDispatchState } from "./in-house-suppression.server";
import { OWN_JOB_HANDOFF_STAGES, OWN_JOB_OFFER_MESSAGE, OWN_JOB_PIESA_HANDED_EVENT, OWN_JOB_PIESA_HELD_EVENT, OWN_JOB_PIESA_NOT_BOOKED_EVENT, deadlineAction, isOwnJobCallAndBook, ownJobHandoffKey, ownJobHandoffPlan } from "./own-job-piesa.core";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OwnJobHandoffOutcome = "handed" | "waiting" | "held" | "already";

/** True when this job is an installer's own call-and-book job. Read failures return null (callers fail closed). */
export async function ownJobCallAndBook(jobId: string, inHouseState?: InHouseDispatchState): Promise<boolean | null> {
  try {
    const skip = await inHouseDispatchSkip(jobId, inHouseState);
    if (skip === "in_house_read_failed") return null;
    const { data, error } = await admin.from("jobs").select("channel").eq("id", jobId).maybeSingle();
    if (error) return null;
    return isOwnJobCallAndBook({ channel: (data?.channel as string | null | undefined) ?? null, heldInHouse: skip === "in_house" });
  } catch {
    return null;
  }
}

/** The same "paid" fact afterPaymentsChanged uses before onSafetyCheckPaid / the installer "Owner accepted" email. */
async function safetyCheckFeePaid(jobId: string, now: Date): Promise<boolean> {
  try {
    const [{ jobPaymentView }, { isStepPaid }] = await Promise.all([import("./payments.server"), import("./payments.core")]);
    const v = await jobPaymentView(jobId, now);
    return !!v && isStepPaid(v.steps, "safety_check");
  } catch {
    return false;
  }
}

/** The chosen electrician business's approved electrician worker with a portal profile (oldest first), or null. */
export async function electricianProfile(businessId: string): Promise<string | null> {
  const { data, error } = await admin.from("partner_workers").select("profile_id")
    .eq("business_id", businessId).eq("trade_role", "electrician").eq("approval_status", "approved").is("removed_at", null).not("profile_id", "is", null)
    .order("created_at").limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.profile_id as string | null | undefined) ?? null;
}

async function eventWithKey(jobId: string, eventType: string, key: string): Promise<boolean> {
  const { count, error } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", eventType).contains("details", { key });
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/** One office item per job, round and reason. */
async function holdOnce(jobId: string, handKey: string, reason: string, electricianBusinessId: string | null) {
  const key = `${handKey}:${reason}`;
  if (await eventWithKey(jobId, OWN_JOB_PIESA_HELD_EVENT, key)) return;
  const { logEvent } = await import("./workflow.server");
  await logEvent(jobId, null, OWN_JOB_PIESA_HELD_EVENT, `Safety check (PIESA) not handed to the installer's electrician: ${reason}. Needs Home Insulation Victoria`,
    { key, reason, electrician_business_id: electricianBusinessId, needs_office: true }, { internal: true });
}

type Electrician = { kind: "found"; businessId: string } | { kind: "none"; notSignedUp: boolean } | { kind: "mitti_hold" };

/** The installer's chosen electrician; else, like the old offer path, a Mitti pickup's approved usual electrician
 *  (mittiElectricianAtSafetyCheck, which raises its own "Installer to choose electrician" office item on a hold). */
async function resolveElectrician(jobId: string): Promise<Electrician> {
  const chosen = await (await import("./job-electrician.server")).jobChosenElectrician(jobId);
  if (chosen) return { kind: "found", businessId: chosen };
  // An open nomination for an electrician not onboarded yet (no business): say so instead of "no electrician".
  const { data: pending, error } = await admin.from("electrician_nominations").select("id").eq("job_id", jobId).is("ended_at", null).is("business_id", null).limit(1);
  if (error) throw new Error(error.message);
  if ((pending ?? []).length) return { kind: "none", notSignedUp: true };
  const m = await (await import("./mitti-electrician.server")).mittiElectricianAtSafetyCheck(jobId);
  if (m.action === "use_usual") return { kind: "found", businessId: m.businessId };
  if (m.action === "hold") return { kind: "mitti_hold" };
  return { kind: "none", notSignedUp: false };
}

type ActiveElectrician = { id: string; business_id: string | null; user_id: string; assigned_at: string; booking_confirmed_at: string | null };

/** Log the hand-over (due 2 business days from `now`) and send the notices. The event key makes this once per round. */
async function recordHandoff(jobId: string, key: string, a: { business_id: string | null; user_id: string }, now: Date, repaired: boolean) {
  const [{ logEvent }, { addMelbourneBusinessDays }] = await Promise.all([import("./workflow.server"), import("./melbourne-time.core")]);
  await logEvent(jobId, null, OWN_JOB_PIESA_HANDED_EVENT, "Safety check (PIESA) handed to the installer's electrician to book within 2 business days",
    { key, electrician_business_id: a.business_id, electrician_user_id: a.user_id, due_at: addMelbourneBusinessDays(now.toISOString(), 2), ...(repaired ? { repaired: true } : {}) }, { internal: true });
  const { sendOwnJobPiesaNotices } = await import("./own-job-piesa-notices.server");
  await sendOwnJobPiesaNotices(jobId).catch((e) => console.error("own job safety check notices skipped", jobId, (e as Error).message));
}

/** Hand one own job's safety check to the installer's chosen electrician. Idempotent per job and round. Covers:
 *  - first time: paid job in measured_quote_accepted → assignment, stage move, event, notices;
 *  - a new round (reopen / repeat check) or an in-flight job at the PIESA stage with no electrician for this round →
 *    once the PIESA request gate is clear (incl. a repeat check's payment): assignment, event, notices;
 *  - repair: at the PIESA stage with this round's electrician assigned (not yet booked) but no hand-over event (a
 *    half-done hand-over) → the event and notices, once. */
export async function handOwnJobPiesa(jobId: string, now: Date = new Date(), inHouseState?: InHouseDispatchState): Promise<OwnJobHandoffOutcome> {
  const { data: job, error: je } = await admin.from("jobs").select("id, stage, deleted_at").eq("id", jobId).maybeSingle();
  if (je || !job || job.deleted_at) return "waiting";
  const stage = job.stage as string;
  if (!(OWN_JOB_HANDOFF_STAGES as readonly string[]).includes(stage)) return "waiting";
  if ((await ownJobCallAndBook(jobId, inHouseState)) !== true) return "waiting";
  const roundStart = await (await import("./repeat-piesa.server")).latestReopenAt(jobId);
  const key = ownJobHandoffKey(jobId, roundStart);
  if (await eventWithKey(jobId, OWN_JOB_PIESA_HANDED_EVENT, key)) return "already";
  const { data: activeRows, error: ae } = await admin.from("job_assignments").select("id, business_id, user_id, assigned_at, booking_confirmed_at").eq("job_id", jobId).eq("role", "electrician").eq("active", true);
  if (ae) return "waiting";
  const active = (activeRows ?? []) as ActiveElectrician[];
  const thisRound = active.filter((a) => !roundStart || a.assigned_at >= roundStart);
  const atPiesa = stage === "piesa_and_install_window_pending";
  if (atPiesa && thisRound.length) {
    // Repair a half-done hand-over. Already booked (e.g. an in-flight offer the electrician took and booked) → nothing to hand.
    if (thisRound.some((a) => a.booking_confirmed_at)) return "waiting";
    // Never log a hand-over (and its notices) for a round that isn't paid.
    const [{ piesaRequestFacts }, { piesaRequestBlockers }] = await Promise.all([import("./workflow.server"), import("./payment-gate.core")]);
    const repairPaid = await piesaRequestFacts(jobId).then((f) => piesaRequestBlockers(f).length === 0).catch(() => false);
    if (!repairPaid) return "waiting";
    await recordHandoff(jobId, key, thisRound[0]!, now, true);
    return "handed";
  }
  if (!atPiesa && active.length) return "waiting"; // someone is already on it before the PIESA stage: the office decides
  if (atPiesa) {
    // An in-flight offer from the old path: let it run out first (no two electricians on one job).
    const { count: open, error: oe } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "piesa").eq("status", "pending");
    if (oe || open) return "waiting";
  }
  // Paid: first time = the safety check step on the installation invoice; at the PIESA stage = the full PIESA request
  // gate (original payment, or a repeat check's choice/acceptance/payment) — the same gate the old refill uses.
  let paid: boolean;
  if (!atPiesa) paid = await safetyCheckFeePaid(jobId, now);
  else {
    const [{ piesaRequestFacts }, { piesaRequestBlockers }] = await Promise.all([import("./workflow.server"), import("./payment-gate.core")]);
    paid = await piesaRequestFacts(jobId).then((f) => piesaRequestBlockers(f).length === 0).catch(() => false);
  }
  if (!paid) return "waiting";
  const el = await resolveElectrician(jobId);
  if (el.kind === "mitti_hold") return "held";
  const electricianBusinessId = el.kind === "found" ? el.businessId : null;
  const electricianUserId = electricianBusinessId ? await electricianProfile(electricianBusinessId) : null;
  const plan = ownJobHandoffPlan({ paid, stage, electricianBusinessId, electricianUserId, alreadyHanded: false, electricianNotSignedUp: el.kind === "none" && el.notSignedUp });
  if (plan.kind === "wait") return "waiting";
  if (plan.kind === "hold") { await holdOnce(jobId, key, plan.reason, electricianBusinessId); return "held"; }
  const wf = await import("./workflow.server");
  // First time: the job must be able to enter the PIESA stage (quote accepted, gates clear), like the offer path.
  if (!atPiesa && (await wf.stageEntryBlockers(jobId, "piesa_and_install_window_pending", null).catch(() => ["unreadable"])).length) return "waiting";
  const assignment = { business_id: electricianBusinessId, user_id: electricianUserId as string };
  if (atPiesa) {
    // A new round: the earlier round's electrician no longer holds the job (same as an office reassignment).
    const old = active.map((a) => a.id);
    if (old.length) {
      const { error: ue } = await admin.from("job_assignments").update({ active: false, ended_at: now.toISOString(), end_reason: "reassigned" }).in("id", old).eq("active", true);
      if (ue) throw new Error(ue.message);
    }
  }
  const { data: ins, error: ie } = await admin.from("job_assignments")
    .insert({ job_id: jobId, role: "electrician", business_id: electricianBusinessId, user_id: assignment.user_id, active: true })
    .select("id").single();
  if (ie || !ins) throw new Error(ie?.message ?? "Could not assign the electrician");
  const insertedId = ins.id as string;
  if (atPiesa) {
    // No stage move to claim with: of two racing hand-overs the earliest row wins; the other removes its own.
    const { data: rows } = await admin.from("job_assignments").select("id, assigned_at").eq("job_id", jobId).eq("role", "electrician").eq("active", true).order("assigned_at").order("id");
    const winner = (rows ?? [])[0]?.id;
    if (winner && winner !== insertedId) { await admin.from("job_assignments").delete().eq("id", insertedId); return "already"; }
  } else {
    try {
      // The guarded stage move is the claim: of two hand-overs racing, only one moves the job.
      await wf.transition(jobId, "piesa_and_install_window_pending", null, "Safety check (PIESA) handed to the installer's electrician to book", { own_job: true, electrician_business_id: electricianBusinessId });
    } catch (e) {
      await admin.from("job_assignments").delete().eq("id", insertedId);
      if (await eventWithKey(jobId, OWN_JOB_PIESA_HANDED_EVENT, key).catch(() => false)) return "already";
      console.warn("own job safety check not handed yet", jobId, (e as Error).message);
      return "waiting";
    }
  }
  // If this fails after the move, the next sweep's repair branch logs it and sends the notices.
  await recordHandoff(jobId, key, assignment, now, false);
  return "handed";
}

/** Office offer buttons: an installer's own job is never offered — say so plainly. Unreadable = refused. */
export async function refuseOfficeOfferForOwnJob(jobId: string): Promise<void> {
  const own = await ownJobCallAndBook(jobId);
  const { WorkflowError } = await import("./workflow.server");
  if (own === null) throw new WorkflowError("Couldn't check whose job this is — please try again.");
  if (own) throw new WorkflowError(OWN_JOB_OFFER_MESSAGE);
}

/** 15-minute tick: own jobs whose safety check fee has cleared go to their electrician — first time (measured quote
 *  accepted), a new round or in-flight job at the PIESA stage, and any half-done hand-over (repair). Already handed
 *  jobs get their notices re-checked (retry of anything not yet sent). */
export async function sweepOwnJobPiesaHandoffs(now: Date = new Date()): Promise<Record<OwnJobHandoffOutcome | "failed", number>> {
  const out = { handed: 0, waiting: 0, held: 0, already: 0, failed: 0 };
  const inHouseState = await readInHouseDispatchState();
  if (inHouseState.failed) return out;
  const { data: jobs, error } = await admin.from("jobs").select("id").eq("channel", "installer_sourced").in("stage", [...OWN_JOB_HANDOFF_STAGES]).is("deleted_at", null).order("created_at").limit(500);
  if (error) throw new Error(error.message);
  for (const j of jobs ?? []) {
    if (inHouseState.held.has(j.id)) continue;
    let r: OwnJobHandoffOutcome;
    try { r = await handOwnJobPiesa(j.id, now, inHouseState); out[r]++; } catch (e) { out.failed++; console.error("own job safety check hand-over failed", j.id, (e as Error).message); continue; }
    // Task 3 (carried decision a): a hand-over whose notices failed after the event was logged is retried here. The
    // notices skip anything already sent (one key per job, round and channel) and stop once the job is booked.
    if (r === "already") {
      const { sendOwnJobPiesaNotices } = await import("./own-job-piesa-notices.server");
      await sendOwnJobPiesaNotices(j.id).catch((e) => console.error("own job safety check notices retry skipped", j.id, (e as Error).message));
    }
  }
  return out;
}

const PIESA_STAGE = "piesa_and_install_window_pending";
type OfficeBookingAccess = { allowed: boolean; assignment?: ActiveElectrician; bookings?: { id: string; kind: string; scheduled_start: string | null; status: string }[] };

/** Can this person book the safety check (PIESA) for the installer's own job? Yes when: the job is an own call-and-book
 *  job (not in-house, not an HIV lead), waiting at the PIESA stage with the installer's electrician assigned and not yet
 *  booked, the person is an active member of the installer business that supplied the job, and that installer's "who books"
 *  setting is office or either. Everything else (including unreadable) is "no". `client` does the membership read (RLS). */
export async function ownJobOfficeBookingAccess(userId: string, jobId: string, client: SupabaseClient = admin as unknown as SupabaseClient): Promise<OfficeBookingAccess> {
  const no: OfficeBookingAccess = { allowed: false };
  const { data: job, error } = await admin.from("jobs").select("stage, deleted_at, source, originating_installer_business_id").eq("id", jobId).maybeSingle();
  if (error || !job || job.deleted_at || job.source === "qa_test" || job.stage !== PIESA_STAGE) return no;
  const installerId = (job.originating_installer_business_id as string | null) ?? null;
  if (!installerId) return no;
  if ((await ownJobCallAndBook(jobId)) !== true) return no;
  const { whoBooksFor } = await import("./who-books.server");
  if ((await whoBooksFor(installerId)) === "electrician") return no;
  const { data: member, error: me } = await client.from("business_members").select("business_id").eq("user_id", userId).eq("business_id", installerId).eq("active", true).maybeSingle();
  if (me || !member) return no;
  const { data: rows, error: ae } = await admin.from("job_assignments").select("id, business_id, user_id, assigned_at, booking_confirmed_at").eq("job_id", jobId).eq("role", "electrician").eq("active", true);
  const active = (rows ?? []) as ActiveElectrician[];
  if (ae || active.length !== 1 || !active[0]!.business_id || active[0]!.booking_confirmed_at) return no;
  const { data: bookings, error: be } = await admin.from("bookings").select("id, kind, scheduled_start, status").eq("job_id", jobId).neq("status", "cancelled").order("created_at", { ascending: false });
  if (be) return no;
  return { allowed: true, assignment: active[0]!, bookings: bookings ?? [] };
}

/** The installer office books the safety check on its own job. Same booking function as the electrician's link. */
export async function officeBookOwnJobPiesa(userId: string, jobId: string, startIso: string, now: Date = new Date(), client?: SupabaseClient): Promise<{ ok: true; start: string }> {
  const access = await ownJobOfficeBookingAccess(userId, jobId, client);
  if (!access.allowed || !access.assignment?.business_id) throw new Error("You can't book this safety check.");
  const { bookOwnJobPiesa } = await import("./own-job-electrician-link.server");
  return bookOwnJobPiesa({ jobId, assignment: access.assignment, electricianBusinessId: access.assignment.business_id, startIso, actorId: userId, by: "installer office", now });
}

/** Email the installer office "Not booked yet". One key per hand-over event (a swap logs a new one, which restarts the clock), so it goes once (held wording is retried). */
async function sendNotBookedEmail(jobId: string, installerId: string, handedEventId: string): Promise<void> {
  const [{ officeNotBookedEmail, OWN_JOB_PIESA_NOT_BOOKED_EMAIL_APPROVED }, { emailInstallerOffice }, { SET_PASSWORD_BASE }] = await Promise.all([import("./own-job-electrician-link.core"), import("./own-job-piesa-notices.server"), import("./set-password-link.core")]);
  const { data: ov, error } = await admin.from("job_overview").select("property_address, job_number").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  const address = (ov?.property_address as string | null | undefined) || (ov?.job_number as string | null | undefined) || "this job";
  const jobUrl = `${SET_PASSWORD_BASE}/field/${jobId}`;
  const mail = officeNotBookedEmail({ address, jobUrl });
  await emailInstallerOffice({ jobId, businessId: installerId, key: `own-job-piesa:v1:${handedEventId}:not-booked`, subject: mail.subject, text: mail.text, jobUrl, approved: OWN_JOB_PIESA_NOT_BOOKED_EMAIL_APPROVED });
}

/** 15-minute tick: an own job handed to its electrician, still unbooked after the hand-over's due date (2 business days),
 *  is returned to the installer office once: one `own_job_piesa_not_booked` event (stable id per round) and one email.
 *  The electrician's link stays usable. An email that was held or failed is retried on later ticks (the email is sent once per key). */
export async function sweepOwnJobPiesaDeadlines(now: Date = new Date()): Promise<{ returned: number; none: number; failed: number }> {
  const out = { returned: 0, none: 0, failed: 0 };
  const inHouseState = await readInHouseDispatchState();
  if (inHouseState.failed) return out;
  const { data: jobs, error } = await admin.from("jobs").select("id, originating_installer_business_id").eq("channel", "installer_sourced").eq("stage", PIESA_STAGE).is("deleted_at", null).order("created_at").limit(500);
  if (error) throw new Error(error.message);
  const { stableUuid } = await import("./mitti-create-claim.core");
  for (const j of jobs ?? []) {
    if (inHouseState.held.has(j.id)) continue;
    try {
      const installerId = (j.originating_installer_business_id as string | null) ?? null;
      const { data: handed, error: he } = await admin.from("workflow_events").select("id, details").eq("job_id", j.id).eq("event_type", OWN_JOB_PIESA_HANDED_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (he) throw new Error(he.message);
      const hd = (handed?.details ?? null) as { key?: string; due_at?: string } | null;
      const handedId = (handed?.id as string | undefined) ?? null;
      if (!installerId || !handedId || !hd?.due_at) { out.none++; continue; }
      const { data: rows, error: ae } = await admin.from("job_assignments").select("id, booking_confirmed_at").eq("job_id", j.id).eq("role", "electrician").eq("active", true);
      if (ae) throw new Error(ae.message);
      const a = (rows ?? [])[0] as { id: string; booking_confirmed_at: string | null } | undefined;
      if (!a) { out.none++; continue; } // no electrician now: the "handed back" / "held" office items cover it
      const booked = (rows ?? []).some((r) => (r as { booking_confirmed_at: string | null }).booking_confirmed_at);
      const returnedId = await stableUuid(`${OWN_JOB_PIESA_NOT_BOOKED_EVENT}:${handedId}`);
      const { data: prior, error: pe } = await admin.from("workflow_events").select("id").eq("id", returnedId).maybeSingle();
      if (pe) throw new Error(pe.message);
      const alreadyReturned = !!prior;
      const action = deadlineAction({ dueAt: hd.due_at, booked, alreadyReturned, now });
      if (action === "return") {
        // The stable event id is the claim: of two sweeps only one inserts it (the other gets a duplicate-key error).
        const { error: ce } = await admin.from("workflow_events").insert({ id: returnedId, job_id: j.id, actor_id: null, event_type: OWN_JOB_PIESA_NOT_BOOKED_EVENT,
          summary: "Safety check (PIESA) not booked within 2 business days of the hand-over. Installer office told", details: { handed_event_id: handedId, due_at: hd.due_at, assignment_id: a.id }, internal: true });
        if (ce) { if (ce.code === "23505") { out.none++; continue; } throw new Error(ce.message); }
        out.returned++;
      } else if (alreadyReturned && !booked) out.none++;
      else { out.none++; continue; }
      await sendNotBookedEmail(j.id, installerId, handedId).catch((e) => console.error("own job not-booked email skipped", j.id, (e as Error).message));
    } catch (e) { out.failed++; console.error("own job safety check deadline failed", j.id, (e as Error).message); }
  }
  return out;
}

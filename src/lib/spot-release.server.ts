// Decision 389 (Jo, owner, 25 Oct 2026): the release step. I/O only — every rule is in spot-release.core.ts.
// - releaseSpot: Jo picks an installer and presses Release. A confirmed owner goes straight to the existing one-installer
//   offer (officePickReadyCheckInstaller, unchanged). Otherwise the same offer checks run FIRST (nothing written if the
//   offer could never go), then ONE `spot_released` claim (key job + release number) and the owner's "It's your turn"
//   email O77 + text. The installer is NOT contacted. REAL jobs refuse while the wording is unapproved; TEST jobs go
//   through test-send end to end.
// - confirmSpotRelease / declineSpotRelease: the owner's two buttons on My job `?screen=turn`; both claim the ONE
//   "outcome" slot first, so confirm, decline and the day-5 lapse can never both win. Confirm runs the installer offer
//   once; decline closes the job (stage cancelled, prior_stage kept, one stage_changed event) and sends nothing.
// - sweepSpotReleases (15-minute tick): day-2 reminder (email + text), the 7am release text when Jo released during quiet
//   hours, and the day-5 lapse (one Needs me row, nothing sent). Reads batched by job id; due jobs run a few at a time.
// Real delivery: sendGuardedOwnerEmail (opt-outs, suppression, recipient boundary, once-only key) after
// assertCustomerDeliveryAllowed (customer_comms_enabled + consent), and the one real SMS sender (STOP, quiet hours, its
// own `spot_released` switch, wording approval).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkflowError, logEvent } from "./workflow.server";
import {
  DECLINE_REASON, LAPSED_NEEDS_LINE, SPOT_RELEASED_APPROVED, SPOT_RELEASED_EVENT, SPOT_RELEASED_PURPOSE, SPOT_RELEASED_SMS_TYPE,
  SPOT_RELEASE_CONFIRMED_EVENT, SPOT_RELEASE_DECLINED_EVENT, SPOT_RELEASE_EVENTS, SPOT_RELEASE_LAPSED_EVENT, SPOT_RELEASE_REMINDED_EVENT,
  jobWaitingForInstaller, nextReleaseSeq, ownerTurnView, releasePlan, spotReleaseDue, spotReleaseKey, spotReleasePageLink, spotReleaseState, spotReleasedText,
  type OwnerTurnView, type SpotReleaseDue, type SpotReleaseEventRow, type SpotReleaseState,
} from "./spot-release.core";
import { SMS_MESSAGE_TYPES } from "./sms.core";
import { smsQuietReason } from "./quote-hold.core";

const loose = admin as unknown as SupabaseClient;

// ---- reads -------------------------------------------------------------------------------------------------------

async function eventsFor(jobId: string): Promise<SpotReleaseEventRow[]> {
  const { data, error } = await loose.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId).in("event_type", [...SPOT_RELEASE_EVENTS]);
  if (error) throw new Error(`Could not read the release history: ${error.message}`);
  return (data ?? []) as SpotReleaseEventRow[];
}
export const spotReleaseStateFor = async (jobId: string): Promise<SpotReleaseState> => spotReleaseState(await eventsFor(jobId));

/** Release state for many jobs: batched by job id (chunks of 150, a few in flight). */
export async function spotReleaseStates(jobIds: string[]): Promise<Map<string, SpotReleaseState>> {
  const out = new Map<string, SpotReleaseState>();
  if (!jobIds.length) return out;
  const { readByJobIds } = await import("./sweep-batch.server");
  const rows = await readByJobIds<SpotReleaseEventRow & { job_id: string }>("release history", jobIds, (c) => loose.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", c).in("event_type", [...SPOT_RELEASE_EVENTS]));
  const by = new Map<string, SpotReleaseEventRow[]>();
  for (const r of rows) { const k = String(r.job_id); if (!by.has(k)) by.set(k, []); by.get(k)!.push(r); }
  for (const id of jobIds) out.set(id, spotReleaseState(by.get(id) ?? []));
  return out;
}

async function jobFacts(jobId: string) {
  const [{ data: job, error }, { count: inst }] = await Promise.all([
    admin.from("jobs").select("id, stage, channel, source, owner_id, deleted_at, job_number").eq("id", jobId).maybeSingle(),
    admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", "installer").eq("active", true),
  ]);
  if (error) throw new Error(error.message);
  if (!job) return null;
  return { ...job, hasInstaller: (inst ?? 0) > 0, waiting: jobWaitingForInstaller({ channel: job.channel, stage: job.stage, hasInstaller: (inst ?? 0) > 0, deleted: !!job.deleted_at }) };
}

/** Insert one spot-release event as a claim. false = this slot was already claimed (unique key, or the read-then-insert check). */
async function claim(jobId: string, actorId: string | null, type: string, summary: string, details: Record<string, unknown>): Promise<boolean> {
  const key = String(details["idempotency_key"]);
  const { data: prior, error: pe } = await loose.from("workflow_events").select("id").eq("job_id", jobId).in("event_type", [...SPOT_RELEASE_EVENTS]).contains("details", { idempotency_key: key }).limit(1);
  if (pe) throw new Error(`Could not check the release history: ${pe.message}`);
  if ((prior ?? []).length) return false;
  const { error } = await loose.from("workflow_events").insert({ job_id: jobId, actor_id: actorId, event_type: type, summary, details, internal: true });
  if (error) { if (error.code === "23505") return false; throw new Error(`Could not record the release: ${error.message}`); }
  return true;
}

// ---- sending -----------------------------------------------------------------------------------------------------

type Step = "released" | "reminder" | "release_text";
/** The owner's email (released / reminder) and text for one release step. Records nothing (the caller claimed the step). */
async function sendTurnMessages(jobId: string, s: Extract<SpotReleaseState, { state: "pending" }> | { seq: number; businessId: string }, step: Step, link: string, opts: { approved?: { email: boolean; sms: boolean } } = {}): Promise<string> {
  const { data: job } = await admin.from("jobs").select("owner_id, source").eq("id", jobId).maybeSingle();
  if (!job) return "skipped — job not found";
  const [{ data: owner }, { data: biz }] = await Promise.all([
    job.owner_id ? admin.from("owners").select("full_name, email, phone").eq("id", job.owner_id).maybeSingle() : Promise.resolve({ data: null as { full_name: string | null; email: string | null; phone: string | null } | null }),
    admin.from("businesses").select("onboarding_notes").eq("id", s.businessId).maybeSingle(),
  ]);
  const page = spotReleasePageLink(link);
  const reminder = step === "reminder";
  const smsBody = spotReleasedText(page, reminder);
  const key = spotReleaseKey(jobId, s.seq, step);
  const withEmail = step !== "release_text";
  const { renderSpotReleasedEmail } = await import("./spot-release-email.core");
  const { firstName } = await import("./worker-links.core");
  const build = (unsubscribeUrl: string | null, test: boolean) => renderSpotReleasedEmail({ firstName: firstName(owner?.full_name ?? null), confirmUrl: page, unsubscribeUrl, reminder, test });
  const out: string[] = [];
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail, sendTestSms } = await import("./test-send.server");
    const ctx = { jobId, jobSource: job.source, partnerIsTest: isTestPartner(biz ?? null), label: `${SPOT_RELEASED_PURPOSE}:${s.seq}:${step}`, actorId: null };
    if (withEmail) { const mail = build(null, true); const e = await sendTestEmail(ctx, owner?.email ?? "", mail.subject, mail.html, mail.text); out.push(`email ${e.status}: ${e.detail}`); }
    const t = await sendTestSms(ctx, owner?.phone ?? "", smsBody);
    out.push(`sms ${t.status}: ${t.detail}`);
    return out.join("; ");
  }
  const emailApproved = opts.approved?.email ?? SPOT_RELEASED_APPROVED;
  if (withEmail) {
    if (!emailApproved) out.push("email not sent — wording awaiting approval");
    else if (!owner?.email) out.push("email not sent — no owner email");
    else {
      try {
        await (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, "It's your turn email");
        out.push(`email ${await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to: owner.email, purpose: `${SPOT_RELEASED_PURPOSE}:${step}`, key: `${key}:email`, build: (u) => build(u, false) })}`);
      } catch (e) { out.push(`email not sent — ${(e as Error).message}`); }
    }
  }
  // The one real text sender: switch, wording approval, quiet hours, consent and STOP all live there (held = recorded, never sent).
  const { sendRealSms } = await import("./sms.server");
  const t = await sendRealSms({ type: SPOT_RELEASED_SMS_TYPE, idempotencyKey: `${key}:sms`, to: owner?.phone ?? null, body: smsBody, jobId });
  out.push(`sms ${t.status}: ${t.detail}`);
  return out.join("; ");
}

// ---- Release (office) --------------------------------------------------------------------------------------------

export type ReleaseResult = { mode: "released"; installer: string; detail: string } | { mode: "offered"; installer: string };

/** Jo presses Release for one installer. Since 30 Oct 2026 only an owner who already confirmed can go (straight to the
 *  installer); "It's your turn" is retired for website owners (`releasePlan`). Tests may pass `approved` / `retired`
 *  (production uses the code constants). */
export async function releaseSpot(jobId: string, actorId: string | null, businessId: string, opts: { approved?: { email: boolean; sms: boolean }; now?: Date; retired?: boolean } = {}): Promise<ReleaseResult> {
  const now = opts.now ?? new Date();
  const [job, events, hasRateCard] = await Promise.all([jobFacts(jobId), eventsFor(jobId), installerHasActiveRateCard(businessId)]);
  if (!job || job.deleted_at) throw new WorkflowError("This job is no longer available.");
  const state = spotReleaseState(events);
  const approved = opts.approved ?? { email: SPOT_RELEASED_APPROVED, sms: SMS_MESSAGE_TYPES[SPOT_RELEASED_SMS_TYPE].wordingApproved as boolean };
  const plan = releasePlan({ state, testJob: job.source === "qa_test", emailApproved: approved.email, smsApproved: approved.sms, hasRateCard, ...(opts.retired === undefined ? {} : { retired: opts.retired }) });
  if (plan.mode === "refused") throw new WorkflowError(plan.reason);
  const offer = (await import("./ready-check-times.server")).officePickReadyCheckInstaller;
  if (plan.mode === "direct_offer") {
    // Decision 389: the owner already confirmed (their last installer said Not for me / didn't answer) — never asked again.
    await offer(jobId, actorId, [businessId]);
    const name = await businessName(businessId);
    return { mode: "offered", installer: name };
  }
  // Every check the installer offer will make, BEFORE the owner is told anything (so Confirm can't hit a refusal we knew about).
  const { readyCheckOfferStartBlockers } = await import("./ready-check-times.core");
  const { count: open } = await admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "pending");
  const b = readyCheckOfferStartBlockers({ channel: job.channel, stage: job.stage, deleted: !!job.deleted_at, hasInstaller: job.hasInstaller, openOffers: open ?? 0, picks: 1 });
  if (b.length) throw new WorkflowError(`The spot can't be released: ${b.join(" ")}`);
  const { candidates } = await (await import("./readycheck-booking.server")).installerCandidatesFor(jobId);
  const c = candidates.find((x) => x.business_id === businessId);
  if (!c) throw new WorkflowError("That installer isn't an approved installer for this job.");
  if (c.blocker) throw new WorkflowError(`${c.name} can't take this Ready Check: ${c.blocker}`);
  await (await import("./offer-guard.server")).assertOfferPairsAllowed(jobId, [businessId], "ready_check");
  const link = await (await import("./veec-copy-email.server")).ownerMyJobLink(jobId);
  if (!link) throw new WorkflowError("The owner has no working My job link, so they can't be asked to confirm — nothing was sent.");
  if (job.source !== "qa_test") await (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, "It's your turn message");
  // Every other check passed: Jo's Release opens this job's Ready Check booking (the office per-job opening the installer
  // offer and the owner's time pick require; the global switch still applies), then the same access check as before.
  const access = await import("./ready-check-booking-access.server");
  try { await access.openOwnerReadyCheckBooking(jobId, actorId); } catch (e) { throw new WorkflowError(`The spot can't be released: ${(e as Error).message}`); }
  await access.assertOwnerReadyCheckBooking(jobId);

  const seq = nextReleaseSeq(events);
  const key = spotReleaseKey(jobId, seq, "released");
  const textWaitsForMorning = job.source !== "qa_test" && smsQuietReason(now.toISOString()) != null;
  const claimed = await claim(jobId, actorId, SPOT_RELEASED_EVENT, `Spot released to ${c.name} — "It's your turn" sent to the owner; the installer is offered the job only once the owner confirms`,
    { release_seq: seq, business_id: businessId, business_name: c.name, released_by: actorId, idempotency_key: key, text_waits_for_morning: textWaitsForMorning, decision: 389 });
  if (!claimed) throw new WorkflowError("This spot has just been released — refresh to see it.");
  const detail = await sendTurnMessages(jobId, { seq, businessId }, "released", link, { approved });
  await admin.from("jobs").update({ next_action: `Waiting for the owner to confirm their Ready Check (released to ${c.name})` }).eq("id", jobId);
  return { mode: "released", installer: c.name, detail };
}

/** Decision 399: the chosen business has an ACTIVE installer rate card — the same read the quote builder prices from
 *  (`rate_cards` kind installer, is_active, business_id). A read error refuses the Release (nothing recorded). */
export async function installerHasActiveRateCard(businessId: string): Promise<boolean> {
  if (!businessId) return false;
  const { count, error } = await loose.from("rate_cards").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("kind", "installer").eq("is_active", true);
  if (error) throw new WorkflowError(`Could not check the installer's rate card: ${error.message}`);
  return (count ?? 0) > 0;
}

async function businessName(id: string): Promise<string> {
  const { data } = await admin.from("businesses").select("name, trading_name").eq("id", id).maybeSingle();
  return (data?.trading_name || data?.name || "the installer").trim();
}

// ---- owner page --------------------------------------------------------------------------------------------------

export async function ownerTurnState(jobId: string): Promise<OwnerTurnView> {
  const [job, state] = await Promise.all([jobFacts(jobId), spotReleaseStateFor(jobId)]);
  if (!job) return { kind: "closed" };
  return ownerTurnView(state, { waiting: job.waiting, cancelled: job.stage === "cancelled" });
}

/** Owner: "Yes, I'd still like my free Ready Check". Claims the outcome, then runs the installer offer exactly once. */
export async function confirmSpotRelease(jobId: string, now = new Date()): Promise<OwnerTurnView> {
  const [job, state] = await Promise.all([jobFacts(jobId), spotReleaseStateFor(jobId)]);
  if (!job) throw new WorkflowError("This link isn't working any more. Please reply to our email.");
  const view = ownerTurnView(state, { waiting: job.waiting, cancelled: job.stage === "cancelled" });
  if (view.kind !== "ask" || state.state !== "pending") return view; // already answered (double tap) → same page, nothing run
  const won = await claim(jobId, null, SPOT_RELEASE_CONFIRMED_EVENT, `Owner confirmed their free Ready Check — offering it to ${state.businessName ?? "the installer"}`,
    { release_seq: state.seq, business_id: state.businessId, business_name: state.businessName, idempotency_key: spotReleaseKey(jobId, state.seq, "outcome"), confirmed_at: now.toISOString(), decision: 389 });
  if (!won) return ownerTurnState(jobId);
  try {
    await (await import("./ready-check-times.server")).officePickReadyCheckInstaller(jobId, state.releasedBy, [state.businessId]);
  } catch (e) {
    // The confirmation stands; the job is back on the waiting list as "Owner confirmed — choose installer".
    await logEvent(jobId, null, "spot_release_offer_failed", `Owner confirmed, but the offer to ${state.businessName ?? "the installer"} couldn't be sent: ${(e as Error).message} — choose an installer`, { release_seq: state.seq, business_id: state.businessId, error: (e as Error).message, decision: 389 }, { internal: true });
    await admin.from("jobs").update({ next_action: "Needs Home Insulation Victoria: owner confirmed — choose an installer for the Ready Check" }).eq("id", jobId);
  }
  return { kind: "confirmed", installer: state.businessName };
}

/** Owner: "I'm no longer interested". Claims the outcome, closes the job; never sends anything. */
export async function declineSpotRelease(jobId: string, now = new Date()): Promise<OwnerTurnView> {
  const [job, state] = await Promise.all([jobFacts(jobId), spotReleaseStateFor(jobId)]);
  if (!job) throw new WorkflowError("This link isn't working any more. Please reply to our email.");
  const view = ownerTurnView(state, { waiting: job.waiting, cancelled: job.stage === "cancelled" });
  if (view.kind !== "ask" || state.state !== "pending") return view;
  const won = await claim(jobId, null, SPOT_RELEASE_DECLINED_EVENT, `Owner said they're no longer interested when their spot was released to ${state.businessName ?? "an installer"}`,
    { release_seq: state.seq, business_id: state.businessId, business_name: state.businessName, idempotency_key: spotReleaseKey(jobId, state.seq, "outcome"), declined_at: now.toISOString(), decision: 389 });
  if (!won) return ownerTurnState(jobId);
  const { data: changed, error } = await admin.from("jobs").update({ stage: "cancelled", prior_stage: job.stage, cancelled_reason: DECLINE_REASON, next_action: null } as never)
    .eq("id", jobId).eq("stage", job.stage).select("id").maybeSingle();
  if (error) throw new Error(`Could not close the spot: ${error.message}`);
  if (changed) await logEvent(jobId, null, "stage_changed", `Cancelled: ${DECLINE_REASON}`, { reason: DECLINE_REASON, source: "spot_release", release_seq: state.seq, decision: 389 }, { from: job.stage as never, to: "cancelled", internal: true });
  return { kind: "declined" };
}

// ---- 15-minute tick ----------------------------------------------------------------------------------------------

export type SpotReleaseSweep = { pending: number; reminded: number; releaseTexts: number; lapsed: number; failed: number };

/** Day-2 reminder, 7am release text, day-5 lapse. Reads batched; due jobs run four at a time (never one long serial loop). */
export async function sweepSpotReleases(now = new Date(), opts: { approved?: { email: boolean; sms: boolean } } = {}): Promise<SpotReleaseSweep> {
  const out: SpotReleaseSweep = { pending: 0, reminded: 0, releaseTexts: 0, lapsed: 0, failed: 0 };
  // Releases from the last 30 days (a release lapses at day 5, so older ones are settled).
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const recent: { job_id: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await loose.from("workflow_events").select("job_id").eq("event_type", SPOT_RELEASED_EVENT).gte("created_at", since).order("created_at").range(from, from + 999);
    if (error) throw new Error(`Could not read released spots: ${error.message}`);
    recent.push(...((data ?? []) as { job_id: string }[]));
    if (!data || data.length < 1000) break;
  }
  const ids = [...new Set(recent.map((r) => String(r.job_id)))];
  if (!ids.length) return out;
  const { readByJobIds } = await import("./sweep-batch.server");
  const [states, jobs, inst] = await Promise.all([
    spotReleaseStates(ids),
    readByJobIds<{ id: string; stage: string; channel: string | null; deleted_at: string | null }>("released jobs", ids, (c) => admin.from("jobs").select("id, stage, channel, deleted_at").in("id", c)),
    readByJobIds<{ job_id: string }>("released jobs' installers", ids, (c) => admin.from("job_assignments").select("job_id").in("job_id", c).eq("role", "installer").eq("active", true)),
  ]);
  const withInst = new Set(inst.map((a) => String(a.job_id)));
  const due: { jobId: string; state: Extract<SpotReleaseState, { state: "pending" }>; what: SpotReleaseDue }[] = [];
  for (const j of jobs) {
    const s = states.get(j.id);
    if (!s || s.state !== "pending") continue;
    out.pending++;
    const what = spotReleaseDue(s, now, { waiting: jobWaitingForInstaller({ channel: j.channel, stage: j.stage, hasInstaller: withInst.has(j.id), deleted: !!j.deleted_at }) });
    if (what) due.push({ jobId: j.id, state: s, what });
  }
  const run = async (d: (typeof due)[number]) => {
    try {
      const r = await runDue(d.jobId, d.state, d.what, opts);
      if (r) { if (d.what === "lapse") out.lapsed++; else if (d.what === "reminder") out.reminded++; else out.releaseTexts++; }
    } catch (e) { out.failed++; console.error("spot release step failed", d.jobId, (e as Error).message); }
  };
  for (let i = 0; i < due.length; i += 4) await Promise.all(due.slice(i, i + 4).map(run));
  return out;
}

async function runDue(jobId: string, s: Extract<SpotReleaseState, { state: "pending" }>, what: SpotReleaseDue, opts: { approved?: { email: boolean; sms: boolean } }): Promise<boolean> {
  const base = { release_seq: s.seq, business_id: s.businessId, business_name: s.businessName, decision: 389 };
  if (what === "lapse") {
    const won = await claim(jobId, null, SPOT_RELEASE_LAPSED_EVENT, `${LAPSED_NEEDS_LINE} (released to ${s.businessName ?? "an installer"} 5 days ago)`,
      { ...base, idempotency_key: spotReleaseKey(jobId, s.seq, "outcome"), needs_office: true });
    if (won) await admin.from("jobs").update({ next_action: "Needs Home Insulation Victoria: the owner didn't confirm after release — release to someone else or leave" }).eq("id", jobId).eq("stage", "ready_check_ready_to_schedule");
    return won;
  }
  const slot = what === "reminder" ? "reminder" : "release_text";
  const won = await claim(jobId, null, SPOT_RELEASE_REMINDED_EVENT, what === "reminder" ? "Day-2 reminder: \"Just checking — it's your turn\" to the owner (email + text)" : "Release text sent at 7am (the spot was released during quiet hours)",
    { ...base, step: slot, idempotency_key: spotReleaseKey(jobId, s.seq, slot) });
  if (!won) return false;
  const link = await (await import("./veec-copy-email.server")).ownerMyJobLink(jobId);
  if (!link) { await logEvent(jobId, null, "spot_release_not_sent", "No working owner job link, so the owner could not be reminded to confirm their Ready Check", { ...base, step: slot }, { internal: true }); return true; }
  await sendTurnMessages(jobId, s, slot, link, opts);
  return true;
}

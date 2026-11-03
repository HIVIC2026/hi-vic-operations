import { inHouseDispatchSkip } from "./in-house-suppression.server";
// Approved one-off installer texts (built per decision 193), same shape as decision 186 (`install-clearance.server.ts`):
// ONE `installer_text_prepared` workflow event per text + key is recorded BEFORE anything is sent; TEST jobs / TEST
// partners → test-send only; real partners → the ONE real SMS sender (`sendRealSms`: explicitly selected connection, no
// fallback, no retry; a held attempt never claims the key — 165).
// Live: the install-tomorrow text (decision #47, Jo 2 Nov 2026, to the Lead Installer only) from the 15-minute allocation
// tick (`sweepInstallerTexts`); the owner-changed-visit text (decision 337); the team member invite (decision 251).
// Retired by Part 7 Task 9 (Jo 2 Nov 2026): the decision 79 "owner suggested other days" and decision 82 "Booked: Ready
// Check" installer texts — nothing sends them, old `installer_text_prepared` rows are history.
// Rules and wording: installer-texts.core.ts. Nothing here changes a booking, a turn or a stage.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  INSTALLER_TEXT_EVENT, INSTALL_TOMORROW_HELD_EVENT, INSTALL_TOMORROW_HOLDS, INSTALL_TOMORROW_HOLD_SUMMARY, installTomorrowDue, installTomorrowKey, installTomorrowText,
  installerTextAddress, tomorrowMelbourneYmd,
} from "./installer-texts.core";

type JobRow = { id: string; job_number: string; source: string | null; channel: string | null; deleted_at: string | null; properties: { address_line: string | null; suburb: string | null } | null };
type BizRow = { id: string; name: string | null; signer_mobile: string | null; phone: string | null; onboarding_notes: string | null };

async function jobAndInstaller(jobId: string): Promise<{ job: JobRow; businessId: string; biz: BizRow | null } | null> {
  const [{ data: job }, { data: asg }] = await Promise.all([
    admin.from("jobs").select("id, job_number, source, channel, deleted_at, properties(address_line, suburb)").eq("id", jobId).maybeSingle(),
    admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle(),
  ]);
  if (!job || job.deleted_at || !asg?.business_id) return null;
  const { data: biz } = await admin.from("businesses").select("id, name, signer_mobile, phone, onboarding_notes").eq("id", asg.business_id).maybeSingle();
  return { job: job as unknown as JobRow, businessId: asg.business_id, biz: (biz ?? null) as BizRow | null };
}

async function alreadyPrepared(jobId: string, key: string): Promise<boolean> {
  const { data } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", INSTALLER_TEXT_EVENT).contains("details", { key }).limit(1).maybeSingle();
  return !!data;
}

const jobLink = async (jobId: string) => `${(await import("./set-password-link.core")).SET_PASSWORD_BASE}/field/${jobId}`;

/** One text through the TEST sender (TEST job or TEST partner) or the one real sender. Never throws on send problems. */
async function deliver(p: { type: "install_tomorrow" | "owner_changed_visit"; key: string; job: JobRow; businessId: string; biz: BizRow | null; to: string | null; body: string; event?: { at: string; current: boolean }; label: string }): Promise<string> {
  const { isTestPartner } = await import("./test-send.core");
  const test = p.job.source === "qa_test" || isTestPartner(p.biz ?? {});
  try {
    if (test) {
      const { sendTestSms } = await import("./test-send.server");
      const r = await sendTestSms({ jobId: p.job.id, jobSource: p.job.source, partnerIsTest: isTestPartner(p.biz ?? {}), label: p.label, actorId: null }, p.to ?? "", p.body);
      return `installer sms (test) ${r.status}: ${r.detail}`;
    }
    const { sendRealSms } = await import("./sms.server");
    const r = await sendRealSms({ type: p.type, idempotencyKey: p.key, to: p.to, body: p.body, jobId: p.job.id, businessId: p.businessId, ...(p.event ? { event: p.event } : {}) });
    return `installer sms ${r.status}: ${r.detail}`;
  } catch (e) { return `installer sms not sent — ${(e as Error).message}`; }
}

/** Decision 337: the owner changed a booked visit on My job → tell the booked trade ONCE per change (the trigger event).
 *  Ready Check / install day → the active installer business (offer new times/days, job-page link); safety check → the
 *  electrician business that held the cancelled booking (read BEFORE it was released; no link, the job is no longer theirs).
 *  Recorded as `installer_text_prepared` before any send; TEST job / TEST partner → test-send; real → the one real sender. */
export async function textTradeOwnerChangedVisit(p: { jobId: string; kind: import("./installer-texts.core").OwnerChangedVisitKind; triggerEventId: string; changedAt: string; wasIso: string | null; electricianBusinessId?: string | null }): Promise<string> {
  const skipped = await inHouseDispatchSkip(p.jobId);
  if (skipped) return skipped;
  const { OWNER_CHANGED_VISIT_SMS_TYPE, ownerChangedVisitKey, ownerChangedVisitText } = await import("./installer-texts.core");
  let ctx: { job: JobRow; businessId: string; biz: BizRow | null } | null;
  if (p.kind === "assessment") {
    if (!p.electricianBusinessId) return "skipped";
    const [{ data: job }, { data: biz }] = await Promise.all([
      admin.from("jobs").select("id, job_number, source, channel, deleted_at, properties(address_line, suburb)").eq("id", p.jobId).maybeSingle(),
      admin.from("businesses").select("id, name, signer_mobile, phone, onboarding_notes").eq("id", p.electricianBusinessId).maybeSingle(),
    ]);
    ctx = job && !job.deleted_at ? { job: job as unknown as JobRow, businessId: p.electricianBusinessId, biz: (biz ?? null) as BizRow | null } : null;
  } else ctx = await jobAndInstaller(p.jobId);
  if (!ctx) return "skipped";
  const key = ownerChangedVisitKey(p.jobId, p.triggerEventId);
  if (await alreadyPrepared(p.jobId, key)) return "already handled";
  await logEvent(p.jobId, null, INSTALLER_TEXT_EVENT, `${p.kind === "assessment" ? "Electrician" : "Installer"} texted: the owner changed the booked ${p.kind === "assessment" ? "safety check" : p.kind === "ready_check" ? "Ready Check" : "install day"} (decision 337) — text prepared`, { text: OWNER_CHANGED_VISIT_SMS_TYPE, key, kind: p.kind, trigger_event_id: p.triggerEventId, was: p.wasIso, business_id: ctx.businessId }, { internal: true });
  const body = ownerChangedVisitText({ kind: p.kind, suburb: ctx.job.properties?.suburb ?? null, jobNumber: ctx.job.job_number, wasIso: p.wasIso, link: p.kind === "assessment" ? null : await jobLink(p.jobId) });
  return deliver({ type: OWNER_CHANGED_VISIT_SMS_TYPE, key, job: ctx.job, businessId: ctx.businessId, biz: ctx.biz, to: ctx.biz?.signer_mobile ?? ctx.biz?.phone ?? null, body, event: { at: p.changedAt, current: true }, label: `owner_changed_visit:${p.triggerEventId}` });
}

/** Part 7 Task 5: a hold is recorded ONCE per key + reason (internal, never claims the key — a later tick retries). */
async function holdInstallTomorrow(jobId: string, key: string, bookingId: string, reason: (typeof INSTALL_TOMORROW_HOLDS)[keyof typeof INSTALL_TOMORROW_HOLDS]): Promise<string> {
  const { data } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", INSTALL_TOMORROW_HELD_EVENT).contains("details", { key, reason }).limit(1).maybeSingle();
  if (!data) await logEvent(jobId, null, INSTALL_TOMORROW_HELD_EVENT, INSTALL_TOMORROW_HOLD_SUMMARY[reason], { key, booking_id: bookingId, reason }, { internal: true });
  return reason;
}

/** Decision #47 (Jo 2 Nov 2026): the install is tomorrow → ONE text to the picked Lead Installer's OWN mobile, linking
 *  straight to the safety plan (the Lead's own sign link, minted now) and the Mitti install form (the real A5 audit).
 *  No Lead picked / no mobile / no install form → held with a plain reason, nothing sent, never the business owner's
 *  number and never a guessed link. Other crew members get their own sign texts (#48); this text lists nobody else.
 *  Same key as before (`install-tomorrow:v1:…`), so a job already texted the old way is not texted again. */
export async function textInstallerInstallTomorrow(jobId: string, booking: { id: string; scheduled_start: string }, now = new Date()): Promise<string> {
  if (!installTomorrowDue(now, booking.scheduled_start)) return "not due";
  const ctx = await jobAndInstaller(jobId);
  if (!ctx) return "skipped";
  const key = installTomorrowKey(jobId, booking.id, booking.scheduled_start);
  if (await alreadyPrepared(jobId, key)) return "already handled";
  const { allocatedPersonFor } = await import("./visit-allocation.server");
  const { bookingFormAuditId } = await import("./daily-mitti-text.server");
  const [lead, auditId] = await Promise.all([allocatedPersonFor(jobId, "install"), bookingFormAuditId(jobId, "installation").catch(() => null)]);
  if (!lead) return holdInstallTomorrow(jobId, key, booking.id, INSTALL_TOMORROW_HOLDS.noLead);
  if (!lead.mobile?.trim()) return holdInstallTomorrow(jobId, key, booking.id, INSTALL_TOMORROW_HOLDS.noMobile);
  if (!auditId) return holdInstallTomorrow(jobId, key, booking.id, INSTALL_TOMORROW_HOLDS.noForm);
  const leadKey = `w:${lead.workerId}`;
  const { swmsSignLink } = await import("./swms-link.server");
  const { mittiFormUrl } = await import("./mitti-link.core");
  const safetyPlanLink = await swmsSignLink(jobId, leadKey, now.getTime());
  await logEvent(jobId, null, INSTALLER_TEXT_EVENT, `Lead Installer texted: install tomorrow, safety plan + Mitti form links (decision #47) — text prepared for ${lead.name}`, { text: "install_tomorrow", key, booking_id: booking.id, starts_at: booking.scheduled_start, recipient: leadKey, business_id: ctx.businessId }, { internal: true });
  const body = installTomorrowText({ startIso: booking.scheduled_start, address: installerTextAddress(ctx.job.properties?.address_line, ctx.job.properties?.suburb), jobNumber: ctx.job.job_number, safetyPlanLink, mittiLink: mittiFormUrl(auditId) });
  return deliver({ type: "install_tomorrow", key, job: ctx.job, businessId: ctx.businessId, biz: ctx.biz, to: lead.mobile, body, label: `install_tomorrow:${booking.id}` });
}

/** Decision 251: a business owner added a team member with a mobile → text that person their single-use /join link.
 *  Called once by `createWorkerInvite` right after the invite row exists. TEST businesses → test-send only; real ones →
 *  the ONE real sender behind `customer_comms_enabled` + the `team_member_invite` switch, idempotent per invite link +
 *  mobile. Never throws: the owner always keeps the link on screen to pass on (the existing fallback). Never stores the token. */
export async function textTeamMemberInvite(p: { inviteId: string; businessId: string; mobile: string | null; token: string; createdAt: string }): Promise<{ status: "sent" | "not_sent" | "no_mobile"; detail: string }> {
  const { toAuE164 } = await import("./sms.core");
  const to = toAuE164(p.mobile);
  if (!to) return { status: "no_mobile", detail: p.mobile?.trim() ? "Not an Australian mobile number" : "No mobile given" };
  try {
    const [{ data: biz }, { data: inv }] = await Promise.all([
      admin.from("businesses").select("id, name, trading_name, onboarding_notes").eq("id", p.businessId).maybeSingle(),
      admin.from("partner_worker_invites").select("id, business_id, expires_at, used_at, revoked_at").eq("id", p.inviteId).maybeSingle(),
    ]);
    if (!inv || inv.business_id !== p.businessId) return { status: "not_sent", detail: "Invite not found" };
    const { inviteState } = await import("./worker-invite.core");
    const current = inviteState(inv, Date.now()) === "active";
    const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
    const { teamMemberInviteKey, teamMemberInviteText, teamMemberJoinLink } = await import("./installer-texts.core");
    const body = teamMemberInviteText({ business: (biz as { trading_name?: string | null; name?: string | null } | null)?.trading_name || biz?.name || null, link: teamMemberJoinLink(SET_PASSWORD_BASE, p.token) });
    const { isTestPartner } = await import("./test-send.core");
    if (isTestPartner(biz ?? {})) {
      const { sendTestSms } = await import("./test-send.server");
      const r = await sendTestSms({ jobId: null, jobSource: null, partnerIsTest: true, label: `team_member_invite:${p.inviteId}`, actorId: null }, to, body);
      return { status: r.status === "sent" ? "sent" : "not_sent", detail: `test ${r.status}: ${r.detail}` };
    }
    const { sendRealSms } = await import("./sms.server");
    const r = await sendRealSms({ type: "team_member_invite", idempotencyKey: teamMemberInviteKey(p.inviteId, to), to, body, businessId: p.businessId, event: { at: p.createdAt, current } });
    return { status: r.status === "sent" || r.status === "already" ? "sent" : "not_sent", detail: r.detail };
  } catch (e) { return { status: "not_sent", detail: (e as Error).message }; }
}

/** 15-minute tick: tomorrow's installs (from the afternoon before) and the crew's safety plan sign links. */
export async function sweepInstallerTexts(now = new Date()): Promise<{ installTomorrow: number; swmsSignLinks: number }> {
  const out = { installTomorrow: 0, swmsSignLinks: 0 };
  // Each crew member's own safety plan sign link first (decision 377, #48). Since decision #47 (Part 7 Task 5) the
  // install-tomorrow text below goes to the Lead Installer only and lists nobody else by name.
  try { out.swmsSignLinks = await (await import("./swms-sign-text.server")).sweepSwmsSignLinks(now); } catch (e) { console.error("safety plan sign link sweep failed", (e as Error).message); }
  const { melbourneMidnight } = await import("./daily-brief.core");
  const { addYmd } = await import("./melbourne-time.core");
  const tomorrow = tomorrowMelbourneYmd(now);
  const { data: installs } = await admin.from("bookings").select("id, job_id, scheduled_start").eq("kind", "installation").eq("status", "confirmed")
    .gte("scheduled_start", new Date(melbourneMidnight(tomorrow)).toISOString()).lt("scheduled_start", new Date(melbourneMidnight(addYmd(tomorrow, 1))).toISOString());
  const handled = (r: string) => !["in_house", "in_house_read_failed", "not due", "skipped", "already handled", ...Object.values(INSTALL_TOMORROW_HOLDS)].includes(r);
  for (const b of installs ?? []) {
    try { if (handled(await textInstallerInstallTomorrow(b.job_id, b, now))) out.installTomorrow++; } catch (e) { console.error("install tomorrow text failed", b.job_id, (e as Error).message); }
  }
  return out;
}

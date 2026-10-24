// Three approved one-off installer texts (Jo, 24 Oct 2026; decisions 79, 82, 99; built per decision 193), same shape as
// decision 186 (`install-clearance.server.ts`): ONE `installer_text_prepared` workflow event per text + key is recorded
// BEFORE anything is sent; TEST jobs / TEST partners → test-send only; real partners → the ONE real SMS sender
// (`sendRealSms`: explicitly selected connection, no fallback, no retry; a held attempt never claims the key — 165).
// Live triggers: `ownerSuggestReadyCheckDays` (79), every our-lead Ready Check booking in ready-check-times.server (82);
// the install-tomorrow text (99) and the 24h catch-up for 79/82 run from the 15-minute allocation tick (`sweepInstallerTexts`).
// Rules and wording: installer-texts.core.ts. Nothing here changes a booking, a turn or a stage.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  INSTALLER_TEXT_EVENT, INSTALLER_TEXT_SWEEP_HOURS, bookedStillCurrent, daysSuggestedStillCurrent, installTomorrowDue, installTomorrowKey, installTomorrowText,
  installerTextAddress, readyCheckBookedInstallerKey, readyCheckBookedInstallerText, readyCheckDaysSuggestedKey, readyCheckDaysSuggestedText, tomorrowMelbourneYmd,
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
async function deliver(p: { type: "ready_check_days_suggested" | "ready_check_booked_installer" | "install_tomorrow"; key: string; job: JobRow; businessId: string; biz: BizRow | null; to: string | null; body: string; event?: { at: string; current: boolean }; label: string }): Promise<string> {
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

/** Decision 79: the owner suggested other Ready Check days → text the installer once per suggestion event. */
export async function textInstallerOwnerSuggestedDays(jobId: string, triggerEventId: string, suggestedAt: string): Promise<string> {
  const ctx = await jobAndInstaller(jobId);
  if (!ctx) return "skipped";
  if (ctx.job.channel !== "hivic_sourced") return "not an our-lead job";
  const key = readyCheckDaysSuggestedKey(jobId, triggerEventId);
  if (await alreadyPrepared(jobId, key)) return "already handled";
  const { readyCheckTurnFor } = await import("./ready-check-times.server");
  const turn = await readyCheckTurnFor(jobId);
  if (!daysSuggestedStillCurrent(turn)) return "no longer the installer's move";
  await logEvent(jobId, null, INSTALLER_TEXT_EVENT, "Installer texted: the owner suggested other Ready Check days (decision 79) — text prepared", { text: "ready_check_days_suggested", key, trigger_event_id: triggerEventId, suggested_at: suggestedAt, business_id: ctx.businessId }, { internal: true });
  const body = readyCheckDaysSuggestedText({ suburb: ctx.job.properties?.suburb ?? null, jobNumber: ctx.job.job_number, link: await jobLink(jobId) });
  return deliver({ type: "ready_check_days_suggested", key, job: ctx.job, businessId: ctx.businessId, biz: ctx.biz, to: ctx.biz?.signer_mobile ?? ctx.biz?.phone ?? null, body, event: { at: suggestedAt, current: true }, label: `ready_check_days_suggested:${triggerEventId}` });
}

/** Decision 82 (installer text A): an our-lead Ready Check is booked → text the installer once per booked start time. */
export async function textInstallerReadyCheckBooked(jobId: string, startIso: string, bookedAt = new Date().toISOString()): Promise<string> {
  const ctx = await jobAndInstaller(jobId);
  if (!ctx) return "skipped";
  if (ctx.job.channel !== "hivic_sourced") return "not an our-lead job";
  const key = readyCheckBookedInstallerKey(jobId, startIso);
  if (await alreadyPrepared(jobId, key)) return "already handled";
  const { data: booked } = await admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed").limit(1).maybeSingle();
  if (!bookedStillCurrent(booked?.scheduled_start ?? null, startIso)) return "that time is no longer the booked Ready Check";
  await logEvent(jobId, null, INSTALLER_TEXT_EVENT, "Installer texted: Ready Check booked, owner details on the job (decision 82) — text prepared", { text: "ready_check_booked_installer", key, starts_at: startIso, booked_at: bookedAt, business_id: ctx.businessId }, { internal: true });
  const body = readyCheckBookedInstallerText({ startIso, address: installerTextAddress(ctx.job.properties?.address_line, ctx.job.properties?.suburb), jobNumber: ctx.job.job_number, link: await jobLink(jobId) });
  return deliver({ type: "ready_check_booked_installer", key, job: ctx.job, businessId: ctx.businessId, biz: ctx.biz, to: ctx.biz?.signer_mobile ?? ctx.biz?.phone ?? null, body, event: { at: bookedAt, current: true }, label: `ready_check_booked_installer:${startIso}` });
}

/** Decision 99: the install is tomorrow → text the person going (decision 161: allocated installer, else the business owner), once per booking + date. */
export async function textInstallerInstallTomorrow(jobId: string, booking: { id: string; scheduled_start: string }, now = new Date()): Promise<string> {
  if (!installTomorrowDue(now, booking.scheduled_start)) return "not due";
  const ctx = await jobAndInstaller(jobId);
  if (!ctx) return "skipped";
  const key = installTomorrowKey(jobId, booking.id, booking.scheduled_start);
  if (await alreadyPrepared(jobId, key)) return "already handled";
  const { allocatedPersonFor } = await import("./visit-allocation.server");
  const { dailyTextRecipient } = await import("./visit-allocation.core");
  const recipient = dailyTextRecipient({ allocated: await allocatedPersonFor(jobId, "install"), owner: { name: ctx.biz?.name ?? "Trade", phone: ctx.biz?.signer_mobile ?? ctx.biz?.phone ?? null } });
  await logEvent(jobId, null, INSTALLER_TEXT_EVENT, `Installer texted: install tomorrow, job + forms link (decision 99) — text prepared for ${recipient.name}${recipient.note ? ` (${recipient.note})` : ""}`, { text: "install_tomorrow", key, booking_id: booking.id, starts_at: booking.scheduled_start, recipient: recipient.key, business_id: ctx.businessId }, { internal: true });
  const base = installTomorrowText({ startIso: booking.scheduled_start, address: installerTextAddress(ctx.job.properties?.address_line, ctx.job.properties?.suburb), jobNumber: ctx.job.job_number, link: await jobLink(jobId) });
  // Decision 266: while the safety plan is unsigned the text says so, with the same secure job-page link.
  const swms = await (await import("./swms.server")).swmsStatusFor(jobId).catch(() => null);
  const body = (await import("./sms.core")).withSafetyPlanLinks(base, !swms || !swms.complete ? [await jobLink(jobId)] : []);
  return deliver({ type: "install_tomorrow", key, job: ctx.job, businessId: ctx.businessId, biz: ctx.biz, to: recipient.phone, body, label: `install_tomorrow:${booking.id}` });
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

/** 15-minute tick: tomorrow's installs (from the afternoon before), plus a 24h catch-up for 79/82 triggers missed live. */
export async function sweepInstallerTexts(now = new Date()): Promise<{ installTomorrow: number; daysSuggested: number; booked: number }> {
  const out = { installTomorrow: 0, daysSuggested: 0, booked: 0 };
  const since = new Date(now.getTime() - INSTALLER_TEXT_SWEEP_HOURS * 3_600_000).toISOString();
  const { melbourneMidnight } = await import("./daily-brief.core");
  const { addYmd } = await import("./melbourne-time.core");
  const tomorrow = tomorrowMelbourneYmd(now);
  const [{ data: installs }, { data: suggested }, { data: rcBookings }] = await Promise.all([
    admin.from("bookings").select("id, job_id, scheduled_start").eq("kind", "installation").eq("status", "confirmed")
      .gte("scheduled_start", new Date(melbourneMidnight(tomorrow)).toISOString()).lt("scheduled_start", new Date(melbourneMidnight(addYmd(tomorrow, 1))).toISOString()),
    admin.from("workflow_events").select("id, job_id, created_at").eq("event_type", "ready_check_days_suggested").gte("created_at", since),
    admin.from("bookings").select("id, job_id, scheduled_start, created_at").eq("kind", "ready_check").eq("status", "confirmed").gte("created_at", since),
  ]);
  const handled = (r: string) => !["not due", "skipped", "already handled", "not an our-lead job", "no longer the installer's move", "that time is no longer the booked Ready Check"].includes(r);
  for (const b of installs ?? []) {
    try { if (handled(await textInstallerInstallTomorrow(b.job_id, b, now))) out.installTomorrow++; } catch (e) { console.error("install tomorrow text failed", b.job_id, (e as Error).message); }
  }
  for (const e of suggested ?? []) {
    if (!e.job_id) continue;
    try { if (handled(await textInstallerOwnerSuggestedDays(e.job_id, e.id, e.created_at))) out.daysSuggested++; } catch (err) { console.error("days suggested text failed", e.job_id, (err as Error).message); }
  }
  for (const b of rcBookings ?? []) {
    try { if (handled(await textInstallerReadyCheckBooked(b.job_id, b.scheduled_start, b.created_at ?? undefined))) out.booked++; } catch (e) { console.error("ready check booked installer text failed", b.job_id, (e as Error).message); }
  }
  return out;
}

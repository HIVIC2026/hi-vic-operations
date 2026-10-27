// Pure rules for the ONE real SMS sender (Jo, 7 Oct). No network, no database.
import { normaliseAuMobile } from "./test-send.core";
import { melbourneHour, smsQuietReason } from "./quote-hold.core";

/**
 * Every message type that may use the real sender. `wordingApproved=false` means it can never send yet.
 * `quietHours=true` means no text between 8pm and 7am Melbourne (Jo 22 Oct 2026); sign-in codes are exempt
 * so an owner can always get in to their job.
 */
export const SMS_MESSAGE_TYPES = {
  // Decision 388 (Jo 25 Oct 2026, "we are saving spots, not offering Ready Checks"): save_spot_reminder and spot_saved were
  // reworded spot-only and are HELD (wordingApproved=false) until Jo approves docs/decision-388-spot-only-wording.md.
  save_spot_reminder: { audience: "owner", label: "One-off Save My Spot reminder", wordingApproved: true /* spot-only wording approved by Jo 25 Oct 2026, decision 388 */, quietHours: true },
  // Decision 172 (Jo, 24 Oct 2026): one-off "3 questions" reminder text, sent once per pre-23-Oct enquiry from the office page.
  three_questions_reminder: { audience: "owner", label: "One-off 3 questions reminder", wordingApproved: true, quietHours: true },
  spot_saved: { audience: "owner", label: "Spot saved confirmation", wordingApproved: true /* spot-only wording approved by Jo 25 Oct 2026, decision 388 */, quietHours: true },
  owner_code: { audience: "owner", label: "Owner 6-digit sign-in / signing code", wordingApproved: true, quietHours: false },
  quote_ready: { audience: "owner", label: "Installation quote ready for the owner", wordingApproved: true /* decision 87 (Jo 24 Oct 2026), text B: ownerQuoteSms in owner-quote-email.core.ts */, quietHours: true },
  veec_sign_request: { audience: "owner", label: "Sign your rebate (VEEC assignment) form – install done (decision 120; wording approved 24 Oct, decision 166)", wordingApproved: true, quietHours: true },
  veec_sign_reminder: { audience: "owner", label: "Rebate form still needs your signature – days 1/3/7 (decision 120; wording approved 24 Oct, decision 168)", wordingApproved: true, quietHours: true },
  usual_electrician_missing: { audience: "partner", label: "Add usual electrician details", wordingApproved: true /* decision 83 (Jo 24 Oct 2026), kept by decision 113: usualElectricianReminderBody */, quietHours: true },
  ready_check_incomplete: { audience: "partner", label: "Ready Check form missing answers/photos", wordingApproved: true /* Jo 22 Oct 22:57 */, quietHours: true },
  job_offer: { audience: "partner", label: "New job offer to a trade", wordingApproved: true /* decision 76 wording; switched on by decision 154 (Jo 24 Oct) */, quietHours: true /* decision 361: after 8pm → texted at 7am by sweepJobOfferTexts */ },
  daily_mitti: { audience: "partner", label: "Daily Mitti links (6:30am)", wordingApproved: true, quietHours: false },
  daily_mitti_update: { audience: "partner", label: "Daily Mitti links update (job added/moved/cancelled)", wordingApproved: true, quietHours: false },
  // Decision 130: each installer person's secure link to the ESC privacy collection notice (+ 3/7-day reminders). Wording: decision 146; on since decision 154 (Jo 24 Oct).
  esc_notice_link: { audience: "partner", label: "ESC privacy collection notice link to an installer", wordingApproved: true, quietHours: true },
  // Decision 158: 20/10 days left in the 30-day install window, to the owner and the installer. Wording approved by Jo 24 Oct (decision 167; thirty-day-rule.core.ts).
  install_window_reminder: { audience: "owner", label: "30-day install window reminder (20/10 days left) to the owner", wordingApproved: true, quietHours: true },
  install_window_reminder_installer: { audience: "partner", label: "30-day install window reminder (20/10 days left) to the installer", wordingApproved: true, quietHours: true },
  deposit_release: { audience: "owner", label: "Install day released – deposit not received within 48h (decision 170, deposit-release-notice.core.ts)", wordingApproved: true, quietHours: true },
  install_no_access: { audience: "owner", label: "We couldn't get in today – install day no access (decision 215, install-no-access-notice.core.ts). approved by Jo 24 Oct 2026 (decision 217)", wordingApproved: true, quietHours: true },
  install_clearance: { audience: "partner", label: "Installer told the job is cleared for install – offer 3 install days (decision 186, install-clearance.core.ts)", wordingApproved: true, quietHours: true },
  // Decisions 79 / 82 / 99 (Jo 24 Oct 2026; built per decision 193): wording verbatim in installer-texts.core.ts.
  ready_check_days_suggested: { audience: "partner", label: "Owner suggested other Ready Check days – installer to pick one and set a time (decision 79)", wordingApproved: true, quietHours: true },
  ready_check_booked_installer: { audience: "partner", label: "Ready Check booked – owner details on the job (decision 82, installer text A)", wordingApproved: true, quietHours: true },
  install_tomorrow: { audience: "partner", label: "Install tomorrow – job + forms link, the afternoon before (decision 99)", wordingApproved: true, quietHours: true },
  // Decision 251: a business owner adds a team member → text that person their single-use /join login link. Wording
  // approved by Jo 24 Oct 2026 (decision 252, relayed by the coordinator): teamMemberInviteText in installer-texts.core.ts.
  team_member_invite: { audience: "partner", label: "Team member added – single-use login link to the new person (decision 251)", wordingApproved: true, quietHours: true },
  // Decision 288 (Jo 25 Oct 2026): an A1 Ready Check marked Complete with no price yet → the business owner gets ONE text
  // with the link to the "Your price" card (whoever did the Ready Check). Wording: bossPriceLinkText in boss-price-link.core.ts.
  boss_price_link: { audience: "partner", label: "Ready Check done – business owner's link to enter the price (decision 288)", wordingApproved: true, quietHours: true },
  // Decision 296 (Jo 25 Oct 2026): the owner confirms the PIESA on their secure link — request text after the electrician
  // completes, reminders days 1/3 (piesa-owner-confirm.core.ts). DRAFT wording: held until Jo approves it.
  piesa_owner_confirm: { audience: "owner", label: "Confirm your electrical safety check – request + days 1/3 (decision 296; approved decision 311)", wordingApproved: true, quietHours: true },
  // Decision 330 (Jo 25 Oct 2026, wording approved): the owner confirms the ELECTRICAL FIXES on their secure link — request
  // when the A4 fixes form is complete, reminders days 1/3 (piesa-fixes-confirm.core.ts).
  piesa_owner_fixes_confirm: { audience: "owner", label: "Confirm your electrical fixes – request + days 1/3 (decision 330)", wordingApproved: true, quietHours: true },
  // Decision 315 (Jo 25 Oct 2026, route approved): the A3 PIESA says electrical fixes are needed and no fixes times exist →
  // the assigned electrician gets ONE text with the link to pick 3–5 times on their job page. Wording: fixesTimesLinkText (fixes-times.core.ts).
  fixes_times_link: { audience: "partner", label: "Electrical fixes needed – electrician's link to pick 3 to 5 fixes times (decision 315)", wordingApproved: true, quietHours: true },
  // Decision 327 (Jo 25 Oct 2026, route approved): the A3 says the electrician must be on site at the start of the install
  // day → once the day is booked (and on every change) the assigned electrician is asked to confirm on their job page.
  // Wording: attendanceSmsText (install-attendance.core.ts).
  electrician_install_attendance: { audience: "partner", label: "Install day booked – electrician needed at the start: confirm on the job page / 24h reminder / booked on a day they can do (decision 327)", wordingApproved: true, quietHours: true },
  // Decision 327: the electrician can't make the booked install day → the installer is told once with the days the electrician
  // can do. Wording: installerCantAttendText (install-attendance.core.ts), given by Jo.
  electrician_cant_attend_installer: { audience: "partner", label: "Electrician can't make the install day – installer offers new days the electrician can do (decision 327)", wordingApproved: true, quietHours: true },
  // Decision 328 (Jo 25 Oct 2026, route approved): the A5 Install day form marked Complete → the lead installer gets the
  // result ("All filled in ✓ You can leave site." / "Not finished — …"), once per form revision. Same-day result: exempt
  // from the 8pm quiet hours, never before 7am. Wording: install-day-confirm.core.ts.
  install_day_form_result: { audience: "partner", label: "Install day form checked – all filled in / not finished, to the lead installer (decision 328)", wordingApproved: true, quietHours: false, notBefore7am: true },
  // Decision 328: 5pm on the install day, the A5 still not Complete → ONE reminder to the lead installer.
  install_day_form_reminder: { audience: "partner", label: "Install day form not complete at 5pm – reminder to the lead installer (decision 328)", wordingApproved: true, quietHours: true },
  // Decision 326 (25 Oct 2026): approved wordings that had no sender. Wording verbatim in approved-texts.core.ts; each text
  // records one `approved_text_prepared` event before sending (approved-texts.server.ts). Switches start off (fail closed).
  ready_check_times_owner: { audience: "owner", label: "Ready Check times are ready – owner picks one (decision 78)", wordingApproved: true, quietHours: true },
  ready_check_booked_owner: { audience: "owner", label: "Ready Check booked – owner (decision 82, text B)", wordingApproved: true, quietHours: true },
  visit_tomorrow_owner: { audience: "owner", label: "See you tomorrow – Ready Check / safety check / install, the afternoon before (decisions 82, 93, 99)", wordingApproved: true, quietHours: true },
  safety_check_booked_owner: { audience: "owner", label: "Electrical safety check booked – owner (decision 93, text A)", wordingApproved: true, quietHours: true },
  quote_reminder: { audience: "owner", label: "Quote reminder – 3 days after the quote and 2 days before the price expires (decisions 88/89)", wordingApproved: true, quietHours: true },
  install_moved: { audience: "owner", label: "Your install has moved – the agreed install day changed (decision 135)", wordingApproved: true, quietHours: true },
  piesa_offer: { audience: "partner", label: "New safety check (PIESA) job offer to an electrician (decision 93, text B)", wordingApproved: true, quietHours: true },
  // Decision 331 (Jo 25 Oct 2026, route approved): an approved trade the portal has just created a Mitti user for gets ONE
  // text to look for Mitti's email and download the app. Wording: MITTI_INVITE_MESSAGE (mitti-invite.core.ts).
  mitti_invite: { audience: "partner", label: "Invited to Mitti – check Mitti's email, set a password, get the app (decision 331)", wordingApproved: true, quietHours: true },
  // Decision 337 (Jo 25 Oct 2026, route approved): the owner changed a booked Ready Check / safety check / install day on
  // My job → the booked trade is told once (installer: offer new times/days; electrician: booking cancelled, don't go).
  // Wording: ownerChangedVisitText (installer-texts.core.ts). Real sends still need the per-type switch.
  owner_changed_visit: { audience: "partner", label: "Owner changed the booked visit on My job – trade told (decision 337)", wordingApproved: true, quietHours: true },
  // Decision 411 (Jo 27 Oct 2026, wording approved): install-day text to the lead + each crew member on their own mobile,
  // with their own safety documents link. Wording: installDayCrewText (worker-role.core.ts). Real sends need the per-type switch.
  install_day_crew: { audience: "partner", label: "Install day – lead and each crew member, 6:30am, safety docs link (decision 411)", wordingApproved: true, quietHours: true },
  // Decision 377 (Jo 25 Oct 2026): each crew member is texted their OWN safety plan (SWMS) sign link — once the install is
  // booked and the afternoon before while still unsigned. Wording: swmsSignLinkText (swms-sign-text.core.ts), DRAFT until Jo approves.
  swms_sign_link: { audience: "partner", label: "Safety plan – each crew member's own sign link, install booked + day before (decision 377; wording approved by Jo 25 Oct)", wordingApproved: true, quietHours: true },
  // Decision 376 (Jo 25 Oct 2026), wording approved by Jo in decision 384 (25 Oct 2026). Each records one workflow event
  // before any send; real sends still need customer_comms_enabled + the per-type switch in sms_message_switches.
  // The trade cancelled a booked visit → the owner (O74 text, visit-new-times.core visitNewTimesText).
  visit_new_times: { audience: "owner", label: "Trade cancelled the booked visit – choose new times / new times on the way (decisions 376/384)", wordingApproved: true, quietHours: true },
  // 24h after accepting a safety check job with no times offered → the electrician (E14 text, piesa-times-reminder.core).
  piesa_times_reminder: { audience: "partner", label: "Safety check job accepted 24h ago, no times offered – electrician reminder (decisions 376/384)", wordingApproved: true, quietHours: true },
  // Safety check booked → the job's installer, planning only (I71 text, installer-planning-notice.core).
  installer_planning_notice: { audience: "partner", label: "Safety check booked – installer told the date for planning only (decisions 376/384)", wordingApproved: true, quietHours: true },
  // Decision 389 (Jo 25 Oct 2026): Jo released the owner's saved spot → "It's your turn" to the OWNER (release + day-2
  // reminder; spot-release.core spotReleasedText). DRAFT until Jo sees the rendered picture (rendered O77 picture).
  spot_released: { audience: "owner", label: "It's your turn – confirm your free Ready Check, release + day-2 reminder (decision 389, approved)", wordingApproved: true, quietHours: true },
} as const;
export type SmsMessageType = keyof typeof SMS_MESSAGE_TYPES;

/** Decision 266: while an install's safety plan (SWMS) is unsigned, two EXISTING installer texts (install tomorrow, and the
 *  6:30am daily visits text on the install day) carry the secure job-page link to it. No new type, no new switch. */
export const safetyPlanLine = (links: readonly string[]) => `Sign the safety plan first: ${links.join(" ")}`;
export function withSafetyPlanLinks(body: string, links: readonly (string | null | undefined)[]): string {
  const real = [...new Set(links.filter((l): l is string => !!l && l.trim().length > 0))];
  return real.length ? `${body} ${safetyPlanLine(real)}` : body;
}
/** Decision 364: these texts go to ONE person per job (the allocated installer, else the business owner), so each unsigned
 *  person's OWN sign link is listed as "<name>: <link>" for them to pass on; each link signs only that person's line.
 *  Decision 377: a person whose own sign link was texted to their mobile is listed by name only (no link to pass on);
 *  anyone without a mobile (or whose text did not go) keeps the decision 364 "<name>: <link>". */
export const safetyPlanSignerLinks = (entries: readonly { name: string; link: string; ownLinkTexted?: boolean }[]) =>
  entries.map((e) => (e.ownLinkTexted ? `${e.name} (own link texted)` : `${e.name}: ${e.link}`));
/** The office one-off blasts: their explicit admin authorization stands in for the per-type switch (nothing else is bypassed). */
export const ONE_OFF_BLAST_TYPES: readonly SmsMessageType[] = ["save_spot_reminder", "three_questions_reminder"];

/**
 * Decision 165 (Jo, 24 Oct 2026): a text held by a switch, quiet hours or unapproved wording must not come out later as a
 * stale copy when the switch flips on. Every type declares how "still worth sending" is decided:
 *  - `event`: a one-off text about something that happened (code requested, offer made, quote released, spot saved…).
 *    The caller gives the triggering event's time (and whether it is still current); older than `maxAgeMinutes` → held.
 *  - `window`: a scheduled/recomputed text whose key already names its window (day, attempt, step, audit). Each run
 *    recomputes what is due, so nothing old can re-fire; it only has to not double-send inside its own window.
 */
export type SmsFreshness = { kind: "event"; maxAgeMinutes: number } | { kind: "window" };
export const SMS_FRESHNESS: Record<SmsMessageType, SmsFreshness> = {
  save_spot_reminder: { kind: "window" }, // own plan: activation timestamp + shared phone/job claims, recomputed per run
  spot_saved: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the owner saving their spot
  owner_code: { kind: "event", maxAgeMinutes: 10 }, // the code itself expires in 10 minutes
  three_questions_reminder: { kind: "window" }, // one-off office blast: each home once by key/claim, recomputed per run (decision 172)
  quote_ready: { kind: "event", maxAgeMinutes: 72 * 60 }, // event = quote released; also needs the quote still released
  veec_sign_request: { kind: "window" }, // step recorded once as a workflow event before any send (veec-reminders.server)
  veec_sign_reminder: { kind: "window" }, // days 1/3/7: the due step is recomputed each tick, each step recorded once
  usual_electrician_missing: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the Mitti audit that found it missing
  ready_check_incomplete: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the Mitti audit with the gap list
  job_offer: { kind: "event", maxAgeMinutes: 24 * 60 }, // offer open 24h; also needs the offer still pending
  daily_mitti: { kind: "window" }, // one per trade per Melbourne day, trade_text_log send_key claimed first
  daily_mitti_update: { kind: "window" }, // one per trade per day per change signature
  esc_notice_link: { kind: "window" }, // attempts 1/2/3 planned from the recorded send history; manual re-send has its own key
  install_window_reminder: { kind: "window" }, // 20/10-day steps recorded once as workflow events before any send (thirty-day-rule.server)
  install_window_reminder_installer: { kind: "window" }, // same steps, installer side
  deposit_release: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the 48h sweep releasing the booking (recorded once per booking before any send)
  install_no_access: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the installer's "couldn't get in" report on the install day (recorded once per booking before any send)
  install_clearance: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = electrical clearance becoming valid (recorded once per job + timing date before any send)
  ready_check_days_suggested: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the owner suggesting days; also needs it still to be the installer's move (installer-texts.server)
  ready_check_booked_installer: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the Ready Check booking; also needs that start time still booked
  install_tomorrow: { kind: "window" }, // key = booking + its Melbourne date; due only the afternoon before, recomputed each tick (installer-texts.core)
  team_member_invite: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the owner creating the invite; also needs the invite still unused and unrevoked
  boss_price_link: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the Ready Check marked Complete; also needs the price still not entered (boss-price-link.server)
  piesa_owner_confirm: { kind: "window" }, // request / day 1 / day 3: each step recorded once per PIESA record before any send (piesa-owner-confirm-send.server)
  piesa_owner_fixes_confirm: { kind: "window" }, // request / day 1 / day 3: each step recorded once per post_rectification record before any send (piesa-fixes-confirm-send.server)
  fixes_times_link: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the A3 PIESA completed in Mitti; also needs no fixes times given yet (fixes-times.server)
  electrician_install_attendance: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the request / reminder recorded for this install booking (install-attendance.server); re-offered by the tick only while unanswered
  electrician_cant_attend_installer: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the electrician's "Can't make it" (recorded once per released booking before any send)
  install_day_form_result: { kind: "window" }, // key = job + audit + revision; recorded once before any send, only on an install day (install-day-confirm.server)
  install_day_form_reminder: { kind: "window" }, // key = job + install day; due only from 5pm Melbourne that day, recorded once before any send
  ready_check_times_owner: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the installer offering times; also needs it still the owner's move (approved-texts.server)
  ready_check_booked_owner: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the Ready Check booking; also needs that start still booked
  visit_tomorrow_owner: { kind: "window" }, // key = booking + its Melbourne date; due only the afternoon before, recomputed each tick (approved-texts.core visitTomorrowDue)
  safety_check_booked_owner: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the safety check booking; also needs that start still booked
  quote_reminder: { kind: "window" }, // key = quote + step (day3/expiry); the due step is recomputed each tick (approved-texts.core quoteReminderDue)
  install_moved: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the new install booking after a changed day; also needs it still booked
  piesa_offer: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the PIESA offer; also needs the offer still pending
  mitti_invite: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the portal creating the Mitti user (recorded once per person before any send)
  owner_changed_visit: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the owner's change on My job (recorded once per change before any send; installer-texts.server)
  swms_sign_link: { kind: "window" }, // key = job + signer + install date + step (booked / day before); recomputed each tick, only while unsigned (swms-sign-text.core)
  visit_new_times: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the trade's cancel (visit_times_reopened); also needs the visit still not rebooked
  piesa_times_reminder: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the 24h coordination point; also needs still no times offered
  installer_planning_notice: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the safety check booking; also needs that start still booked
  spot_released: { kind: "window" }, // key = job + release number + slot (released / reminder / release_text); each slot recorded once before any send (spot-release.server)
};

export type SmsEventInput = {
  /** When the thing this text is about happened (ISO). Missing for an `event` type = held. */
  at: string | null | undefined;
  /** Caller's check that the thing is still current (offer pending, quote released, code unexpired). Default true. */
  current?: boolean;
};

/** Why a one-off text is too old (or no longer about anything current) to send now, or null. `window` types never go stale here. */
export function smsStaleReason(type: string, event: SmsEventInput | null | undefined, nowIso: string): string | null {
  const f = SMS_FRESHNESS[type as SmsMessageType];
  if (!f) return "Unknown message type";
  if (f.kind === "window") return null;
  if (!event || !event.at) return "No triggering event time given – a one-off text is never sent late";
  const at = Date.parse(event.at), now = Date.parse(nowIso);
  if (!Number.isFinite(at) || !Number.isFinite(now)) return "Triggering event time unreadable – not sent";
  if (event.current === false) return "What this text was about is no longer current – not sent";
  const ageMin = (now - at) / 60_000;
  if (ageMin > f.maxAgeMinutes) return `Too late to send – the trigger was ${Math.floor(ageMin / 60)}h ago (limit ${Math.round((f.maxAgeMinutes / 60) * 10) / 10}h)`;
  return null;
}

/** Outcome classes of one real-send attempt (decision 165). */
export type SmsOutcomeClass = "sent" | "failed" | "blocked";
export type RealSmsStatus = "sent" | "blocked" | "failed" | "sent_unknown" | "already";
export function smsOutcomeClass(status: RealSmsStatus | "queued" | "delivered" | "undelivered" | "sending"): SmsOutcomeClass {
  switch (status) {
    case "blocked": return "blocked";
    case "failed": case "undelivered": return "failed";
    default: return "sent"; // sent, sent_unknown (may have sent), queued, delivered, sending, already (handled before)
  }
}
/** Only an attempt that reached (or may have reached) the gateway owns its idempotency key. Policy holds never do. */
export const claimsIdempotencyKey = (c: SmsOutcomeClass) => c !== "blocked";

/** A held (blocked) attempt is recorded under a non-claiming key so the office can still see "held: reason". */
export const HELD_KEY_MARK = "#held:";
export const heldAttemptKey = (idempotencyKey: string, attemptId: string) => `${idempotencyKey}${HELD_KEY_MARK}${attemptId}`;
export const isHeldAttemptKey = (stored: string) => stored.includes(HELD_KEY_MARK);
/** The claiming key a stored row belongs to (held rows strip their attempt suffix). */
export const claimKeyOf = (stored: string) => { const i = stored.indexOf(HELD_KEY_MARK); return i < 0 ? stored : stored.slice(0, i); };

/** Australian mobiles only, as +614XXXXXXXX. */
export const toAuE164 = (raw: string | null | undefined) => normaliseAuMobile(raw);

export type SmsGateInput = {
  type: string;
  to: string | null | undefined;
  commsEnabled: boolean;
  typeSwitchOn: boolean;
  senderConfigured: boolean;
  optedOut: boolean;
  /** Owner: current contact consent. Partner: approved active partner. */
  consent: boolean;
  isTestRecord: boolean;
  /** Set only by the explicit office one-off blasts (Save My Spot reminder, 3 questions reminder); never enables other SMS types. */
  adminSpotReminderBlast?: boolean;
  /** Instant used for the quiet-hours rule; defaults to now. */
  nowIso?: string;
};

/** Decision 328: a same-day text exempt from the 8pm quiet hours still never goes before 7am Melbourne. */
export const SMS_BEFORE_7AM_REASON = "Not before 7am (Melbourne)";
export function smsBefore7amReason(nowIso: string): string | null {
  if (!Number.isFinite(Date.parse(nowIso))) return SMS_BEFORE_7AM_REASON; // an unreadable clock fails closed
  return melbourneHour(nowIso) < 7 ? SMS_BEFORE_7AM_REASON : null;
}

/** First reason a real text must NOT go, or null. Fails closed on anything unknown. */
export function smsBlocker(x: SmsGateInput): string | null {
  const t = SMS_MESSAGE_TYPES[x.type as SmsMessageType];
  if (!t) return "Unknown message type";
  if (x.isTestRecord) return "TEST record – use the test sender";
  if (!t.wordingApproved) return "Wording not approved yet";
  if (t.quietHours) { const q = smsQuietReason(x.nowIso ?? new Date().toISOString()); if (q) return q; }
  else if ("notBefore7am" in t && t.notBefore7am) { const q = smsBefore7amReason(x.nowIso ?? new Date().toISOString()); if (q) return q; }
  if (!x.commsEnabled) return "Customer communications are switched off";
  if (!x.typeSwitchOn && !(ONE_OFF_BLAST_TYPES.includes(x.type as SmsMessageType) && x.adminSpotReminderBlast === true)) return `"${t.label}" texts are switched off`;
  if (!x.senderConfigured) return "No Australian sending number set up";
  if (!toAuE164(x.to)) return "Not an Australian mobile number";
  if (x.optedOut) return "This number replied STOP";
  if (!x.consent) return t.audience === "owner" ? "No contact consent from the owner" : "Partner is not approved and active";
  return null;
}

/** Brand line at the start of every text the portal sends (Jo, 8 Oct). Visible brand only — never "HI VIC". */
export const SMS_BRAND_PREFIX = "Home Insulation Victoria: ";
export function brandSmsBody(body: string): string {
  return body.trimStart().startsWith(SMS_BRAND_PREFIX) ? body : SMS_BRAND_PREFIX + body.trimStart();
}

/** STOP / START keywords (Twilio standard set). */
const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "OPT-OUT", "REVOKE"]);
const START = new Set(["START", "UNSTOP", "YES", "OPTIN"]);
export function stopKeyword(body: string | null | undefined): "stop" | "start" | null {
  const w = String(body ?? "").trim().toUpperCase().replace(/[.!]+$/, "");
  return STOP.has(w) ? "stop" : START.has(w) ? "start" : null;
}

/** Twilio message status → our log status. */
export function mapTwilioStatus(s: string | null | undefined): "queued" | "sent" | "delivered" | "undelivered" | "failed" | null {
  switch (s) {
    case "accepted": case "queued": case "sending": case "scheduled": return "queued";
    case "sent": return "sent";
    case "delivered": return "delivered";
    case "undelivered": return "undelivered";
    case "failed": case "canceled": return "failed";
    default: return null;
  }
}

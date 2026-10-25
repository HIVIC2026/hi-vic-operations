// Pure rules for the ONE real SMS sender (Jo, 7 Oct). No network, no database.
import { normaliseAuMobile } from "./test-send.core";
import { smsQuietReason } from "./quote-hold.core";

/**
 * Every message type that may use the real sender. `wordingApproved=false` means it can never send yet.
 * `quietHours=true` means no text between 8pm and 7am Melbourne (Jo 22 Oct 2026); sign-in codes are exempt
 * so an owner can always get in to their job.
 */
export const SMS_MESSAGE_TYPES = {
  save_spot_reminder: { audience: "owner", label: "One-off Save My Spot reminder", wordingApproved: true, quietHours: true },
  // Decision 172 (Jo, 24 Oct 2026): one-off "3 questions" reminder text, sent once per pre-23-Oct enquiry from the office page.
  three_questions_reminder: { audience: "owner", label: "One-off 3 questions reminder", wordingApproved: true, quietHours: true },
  spot_saved: { audience: "owner", label: "Spot saved confirmation", wordingApproved: true, quietHours: true },
  owner_code: { audience: "owner", label: "Owner 6-digit sign-in / signing code", wordingApproved: true, quietHours: false },
  quote_ready: { audience: "owner", label: "Installation quote ready for the owner", wordingApproved: true /* decision 87 (Jo 24 Oct 2026), text B: ownerQuoteSms in owner-quote-email.core.ts */, quietHours: true },
  veec_sign_request: { audience: "owner", label: "Sign your rebate (VEEC assignment) form – install done (decision 120; wording approved 24 Oct, decision 166)", wordingApproved: true, quietHours: true },
  veec_sign_reminder: { audience: "owner", label: "Rebate form still needs your signature – days 1/3/7 (decision 120; wording approved 24 Oct, decision 168)", wordingApproved: true, quietHours: true },
  usual_electrician_missing: { audience: "partner", label: "Add usual electrician details", wordingApproved: true /* decision 83 (Jo 24 Oct 2026), kept by decision 113: usualElectricianReminderBody */, quietHours: true },
  ready_check_incomplete: { audience: "partner", label: "Ready Check form missing answers/photos", wordingApproved: true /* Jo 22 Oct 22:57 */, quietHours: true },
  job_offer: { audience: "partner", label: "New job offer to a trade", wordingApproved: true /* decision 76 wording; switched on by decision 154 (Jo 24 Oct) */, quietHours: false },
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
  // Decision 315 (Jo 25 Oct 2026, route approved): the A4 PIESA says electrical fixes are needed and no fixes times exist →
  // the assigned electrician gets ONE text with the link to pick 3–5 times on their job page. Wording: fixesTimesLinkText (fixes-times.core.ts).
  fixes_times_link: { audience: "partner", label: "Electrical fixes needed – electrician's link to pick 3 to 5 fixes times (decision 315)", wordingApproved: true, quietHours: true },
  // Decision 331 (Jo 25 Oct 2026, route approved): an approved trade the portal has just created a Mitti user for gets ONE
  // text to look for Mitti's email and download the app. Wording: MITTI_INVITE_MESSAGE (mitti-invite.core.ts).
  mitti_invite: { audience: "partner", label: "Invited to Mitti – check Mitti's email, set a password, get the app (decision 331)", wordingApproved: true, quietHours: true },
} as const;
export type SmsMessageType = keyof typeof SMS_MESSAGE_TYPES;

/** Decision 266: while an install's safety plan (SWMS) is unsigned, two EXISTING installer texts (install tomorrow, and the
 *  6:30am daily visits text on the install day) carry the secure job-page link to it. No new type, no new switch. */
export const safetyPlanLine = (links: readonly string[]) => `Sign the safety plan first: ${links.join(" ")}`;
export function withSafetyPlanLinks(body: string, links: readonly (string | null | undefined)[]): string {
  const real = [...new Set(links.filter((l): l is string => !!l && l.trim().length > 0))];
  return real.length ? `${body} ${safetyPlanLine(real)}` : body;
}
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
  fixes_times_link: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the A4 PIESA completed in Mitti; also needs no fixes times given yet (fixes-times.server)
  mitti_invite: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = the portal creating the Mitti user (recorded once per person before any send)
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

/** First reason a real text must NOT go, or null. Fails closed on anything unknown. */
export function smsBlocker(x: SmsGateInput): string | null {
  const t = SMS_MESSAGE_TYPES[x.type as SmsMessageType];
  if (!t) return "Unknown message type";
  if (x.isTestRecord) return "TEST record – use the test sender";
  if (!t.wordingApproved) return "Wording not approved yet";
  if (t.quietHours) { const q = smsQuietReason(x.nowIso ?? new Date().toISOString()); if (q) return q; }
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

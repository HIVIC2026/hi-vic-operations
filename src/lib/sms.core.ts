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
  spot_saved: { audience: "owner", label: "Spot saved confirmation", wordingApproved: true, quietHours: true },
  owner_code: { audience: "owner", label: "Owner 6-digit sign-in / signing code", wordingApproved: true, quietHours: false },
  ready_check_booking: { audience: "owner", label: "Ready Check booking confirmation", wordingApproved: false, quietHours: true },
  quote_ready: { audience: "owner", label: "Installation quote ready for the owner", wordingApproved: false, quietHours: true },
  veec_sign_request: { audience: "owner", label: "Sign your rebate (VEEC assignment) form – install done (decision 120; wording approved 24 Oct, decision 166)", wordingApproved: true, quietHours: true },
  veec_sign_reminder: { audience: "owner", label: "Rebate form still needs your signature – days 1/3/7 (decision 120; wording approved 24 Oct, decision 168)", wordingApproved: true, quietHours: true },
  usual_electrician_missing: { audience: "partner", label: "Add usual electrician details", wordingApproved: false, quietHours: true },
  ready_check_incomplete: { audience: "partner", label: "Ready Check form missing answers/photos", wordingApproved: true /* Jo 22 Oct 22:57 */, quietHours: true },
  job_offer: { audience: "partner", label: "New job offer to a trade", wordingApproved: true /* decision 76 wording; switched on by decision 154 (Jo 24 Oct) */, quietHours: false },
  daily_mitti: { audience: "partner", label: "Daily Mitti links (6:30am)", wordingApproved: true, quietHours: false },
  daily_mitti_update: { audience: "partner", label: "Daily Mitti links update (job added/moved/cancelled)", wordingApproved: true, quietHours: false },
  // Decision 130: each installer person's secure link to the ESC privacy collection notice (+ 3/7-day reminders). Wording: decision 146; on since decision 154 (Jo 24 Oct).
  esc_notice_link: { audience: "partner", label: "ESC privacy collection notice link to an installer", wordingApproved: true, quietHours: true },
  // Decision 158: 20/10 days left in the 30-day install window, to the owner and the installer. Wording approved by Jo 24 Oct (decision 167; thirty-day-rule.core.ts).
  install_window_reminder: { audience: "owner", label: "30-day install window reminder (20/10 days left) to the owner", wordingApproved: true, quietHours: true },
  install_window_reminder_installer: { audience: "partner", label: "30-day install window reminder (20/10 days left) to the installer", wordingApproved: true, quietHours: true },
} as const;
export type SmsMessageType = keyof typeof SMS_MESSAGE_TYPES;

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
  ready_check_booking: { kind: "event", maxAgeMinutes: 24 * 60 }, // event = booking confirmed (no live caller yet)
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
  /** Set only by the explicit admin blast; never enables other SMS types. */
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
  if (!x.typeSwitchOn && !(x.type === "save_spot_reminder" && x.adminSpotReminderBlast === true)) return `"${t.label}" texts are switched off`;
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

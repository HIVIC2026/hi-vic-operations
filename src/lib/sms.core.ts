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

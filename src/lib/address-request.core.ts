// Asking a homeowner for their full address when a website/email enquiry arrives with no street. Pure rules, no I/O.
import { parseStreet } from "./address-complete.core";

export const ADDRESS_REQUEST_SENT_EVENT = "address_request_sent";
export const ADDRESS_REQUEST_REMINDER_EVENT = "address_request_reminder_sent";
export const ADDRESS_REQUEST_ANSWERED_EVENT = "address_request_answered";
export const ADDRESS_REQUEST_REMINDER_HOURS = 24;
export const ADDRESS_REQUEST_BLOCK_REASON = "Waiting for the owner's full address";

export type AddressRequestFacts = {
  addressLine: string | null;
  source: string | null;
  channel: string | null;
  createdAt: string;
  goLiveAt: string | null; // null = feature off
  sentAt: string | null;
  reminderAt: string | null;
  answeredAt: string | null;
};

export function addressRequestOpen(f: AddressRequestFacts): boolean {
  if (f.goLiveAt === null) return false;
  if (f.source !== "base44" && f.source !== "email") return false;
  if (f.channel !== "hivic_sourced") return false;
  if (parseStreet(f.addressLine) !== null) return false;
  if (!(Date.parse(f.createdAt) >= Date.parse(f.goLiveAt))) return false;
  return f.answeredAt === null;
}

export function addressRequestStep(f: AddressRequestFacts, now: number): "send" | "remind" | "none" {
  if (!addressRequestOpen(f)) return "none";
  if (f.sentAt === null) return "send";
  if (f.reminderAt === null && now - Date.parse(f.sentAt) >= ADDRESS_REQUEST_REMINDER_HOURS * 3600_000) return "remind";
  return "none";
}

/** Email purposes and once-only keys (one request, one reminder per job). */
export const ADDRESS_REQUEST_PURPOSE = "address_request";
export const ADDRESS_REQUEST_REMINDER_PURPOSE = "address_request_reminder";
export const addressRequestKey = (jobId: string, reminder: boolean) => `${reminder ? "address-request-reminder" : "address-request"}:v1:${jobId}`;
/** The owner's secure page to pick their address (their estimate-link token). */
export const addressRequestPageUrl = (base: string, token: string) => `${base}/my-address/${token}`;

/** Owner text (sms types address_request / address_request_reminder). DRAFT: held until Jo approves the wording.
 *  Both start with the brand line, so the sender's brandSmsBody adds nothing (no doubled "Home Insulation Victoria"). */
export function addressRequestText(link: string, reminder = false): string {
  return reminder
    ? `Home Insulation Victoria: reminder — we need your full address to check your home. Pick it here: ${link}`
    : `Home Insulation Victoria: we need your full address to check your home. Pick it here: ${link}`;
}

/** SMS holds about THIS owner that a retry will never change: they count as the text having been attempted. */
export const OWNER_SPECIFIC_SMS_HOLDS: readonly string[] = ["This number replied STOP", "No contact consent from the owner", "Not an Australian mobile number"];

/** Did this step really reach the owner (or as far as it ever can)? Only then is the request event logged.
 *  Email: any reservation made (sent, uncertain, failed, already attempted). Text: sent / may have sent / refused at the
 *  gateway (key claimed, never resent) / already handled; held for quiet hours when the text will go at 7am (the caller
 *  says whether customer messages and this text's switch are on — the sender checks quiet hours before those); or held
 *  for a reason about this owner that a retry never changes. Global gates (comms off, wording not approved, text switch
 *  off) never count. */
export function addressRequestAttempted(email: string, sms: { status: string; detail: string }, quiet: { reason: string; textWillGoAt7am: boolean }): boolean {
  if (email === "sent" || email.startsWith("delivery uncertain") || email.startsWith("failed") || email.startsWith("already attempted")) return true;
  if (["sent", "sent_unknown", "failed", "already"].includes(sms.status)) return true;
  if (sms.status !== "blocked") return false;
  if (sms.detail === quiet.reason) return quiet.textWillGoAt7am;
  return OWNER_SPECIFIC_SMS_HOLDS.includes(sms.detail);
}

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

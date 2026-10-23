// Jo 23 Oct 2026: the approved "Spot saved" confirmation email + text really go to the owner.
// Pure decision — no database, no network. One email and one text per OWNER (keyed on the address/number),
// never per job, so an owner with several jobs or queued rows gets exactly one of each.
import { isTestRecipient } from "./emailsafety.core";
import { toAuE164 } from "./sms.core";

/** Switch keys inside workflow_settings.sms_message_switches. Only these two belong to this confirmation. */
export const SPOT_SAVED_SMS_SWITCH = "spot_saved";
export const SPOT_SAVED_EMAIL_SWITCH = "spot_saved_email";
export const SPOT_SAVED_EMAIL_PURPOSE = "spot_saved_confirmation";

export const spotSavedEmailKey = (email: string) => `spot_saved_confirmation:v1:${email.trim().toLowerCase()}`;
export const spotSavedSmsKey = (e164: string) => `spot-saved-confirmation:v1:${e164}`;

/** Jo's own inboxes are TEST recipients, never real owners. */
const JO_TEST_ADDRESSES = ["jolowexo@hotmail.com", "sweet_sunshine231@hotmail.com"];
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SpotSavedFacts = {
  source: string | null; stage: string | null; deletedAt: string | null; qaArchivedAt: string | null;
  spotSavedAt: string | null; campaignOptedOutAt: string | null; consent: boolean; commsEnabled: boolean;
  email: string | null; phone: string | null; emailOptedOut: boolean; emailSuppressed: boolean; smsStopped: boolean;
  emailSwitchOn: boolean; smsSwitchOn: boolean; hasLink: boolean;
};
export type ChannelPlan = { send: true; to: string; key: string } | { send: false; reason: string };

/** Job-level reasons that stop BOTH channels. */
export function spotSavedJobBlocker(f: SpotSavedFacts): string | null {
  if (f.source === "qa_test") return "TEST job";
  if (f.deletedAt) return "Job deleted";
  if (f.qaArchivedAt) return "Job archived";
  if (f.stage === "cancelled") return "Job cancelled";
  if (!f.spotSavedAt) return "Spot not saved";
  if (f.campaignOptedOutAt) return "Owner opted out";
  if (!f.consent) return "No contact consent";
  if (!f.commsEnabled) return "Customer communications are switched off";
  return null;
}

export function planSpotSaved(f: SpotSavedFacts): { email: ChannelPlan; sms: ChannelPlan } {
  const job = spotSavedJobBlocker(f);
  if (job) return { email: { send: false, reason: job }, sms: { send: false, reason: job } };
  const em = (f.email ?? "").trim().toLowerCase();
  const email: ChannelPlan = !f.emailSwitchOn ? { send: false, reason: "Spot saved emails are switched off" }
    : !em || !EMAIL_SHAPE.test(em) ? { send: false, reason: "No valid email" }
    : isTestRecipient(em) || JO_TEST_ADDRESSES.includes(em) ? { send: false, reason: "Test address" }
    : f.emailOptedOut ? { send: false, reason: "Unsubscribed from emails" }
    : f.emailSuppressed ? { send: false, reason: "Email bounced/complained or opted out" }
    : { send: true, to: em, key: spotSavedEmailKey(em) };
  const e164 = toAuE164(f.phone);
  const sms: ChannelPlan = !f.smsSwitchOn ? { send: false, reason: "Spot saved texts are switched off" }
    : !e164 ? { send: false, reason: "No valid mobile" }
    : !f.hasLink ? { send: false, reason: "No saved estimate link for the approved text" }
    : f.smsStopped ? { send: false, reason: "Replied STOP" }
    : { send: true, to: e164, key: spotSavedSmsKey(e164) };
  return { email, sms };
}

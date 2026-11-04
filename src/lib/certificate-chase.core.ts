// Part 3 Task 5 (Jo 3 Nov 2026, spec Part 3): chasing the upgrades day and the Certificate of Electrical Safety. Pure rules:
// which round is due (Victorian business days, `addMelbourneBusinessDays`), the held wording, the office flags for Needs me.
// Kept out of certificate-later.core on purpose: that file has no imports because the electrician's phone page bundles it.
//
// Upgrades day (the PIESA says upgrades are needed, not today, and no upgrades day is entered):
//   after 1 business day → text the electrician their link; after 2 business days → email the installer's office;
//   7 days or fewer left on the 30-day clock (30 days from the official PIESA date) → RED office flag.
//   Entering a day (or doing them on the day) stops all three.
// Certificate (Part C recorded, no certificate file): after 2 business days → text the electrician their link;
//   after 4 business days → office flag "Certificate not in — call {electrician} ({phone})". A file stops both.
import { addMelbourneBusinessDays, addYmd, endOfMelbourneYmd } from "./melbourne-time.core";
import { melbourneYmd } from "./piesa-windows.core";
import type { CertificateState } from "./certificate-later.core";

/** Round names (stored on the `certificate_chase_round` event; one per job, anchor and round). */
export const CHASE_ROUND = {
  upgradesText: "upgrades_day_text_1bd",
  upgradesEmail: "upgrades_day_email_2bd",
  upgradesRed: "upgrades_day_flag_7d",
  certificateText: "certificate_text_2bd",
  certificateFlag: "certificate_flag_4bd",
} as const;
export type ChaseRound = (typeof CHASE_ROUND)[keyof typeof CHASE_ROUND];
/** Logged once per job + anchor + round (stable id = the claim) when the round first falls due. Office history + Needs me. */
export const CERTIFICATE_CHASE_ROUND_EVENT = "certificate_chase_round";
/** Logged once per job + anchor + round when that round's text / email has finished (sent, or can't ever go). Until then the
 *  sweep tries the send again each tick (held wording, quiet hours, paused trades): the senders send once per key. */
export const CERTIFICATE_CHASE_SENT_EVENT = "certificate_chase_sent";
/** Fix 1 (review 4 Nov 2026): logged once per job + anchor + round + reason when a round's text / email can't go yet for a
 *  reason the sweep can see without per-job reads (wording held, no electrician, no installer, no installer email). While
 *  the same reason holds the sweep skips the send at no cost; when the facts change (Jo approves the wording, someone is
 *  assigned, an email is added) the send goes through the normal path. NOT a send claim: the sent event still is. */
export const CERTIFICATE_CHASE_WAITING_EVENT = "certificate_chase_waiting";
export type ChaseWaitingReason = "wording_not_approved" | "no_electrician" | "no_installer" | "no_email";
export const CHASE_WAITING_REASON_TEXT: Record<ChaseWaitingReason, string> = {
  wording_not_approved: "wording not approved",
  no_electrician: "no electrician on the job",
  no_installer: "no installer on the job",
  no_email: "no email address on file for the installer",
};
/** The SMS round keys passed to the link senders (the sms idempotency key is per electrician assignment + round). */
export const UPGRADES_DAY_TEXT_ROUND = "chase-1bd";
export const CERTIFICATE_TEXT_ROUND = "chase-2bd";

const DAY = 86_400_000;
const ok = (iso: string | null | undefined): iso is string => !!iso && Number.isFinite(Date.parse(iso));
/** Due once the Melbourne day `n` business days after the anchor is over (same rule as the Part 2 2-business-day deadline). */
const after = (anchor: string, n: number, now: Date) => now.getTime() > Date.parse(addMelbourneBusinessDays(anchor, n));

/** The last instant of the 30-day install window: the end of the Melbourne day 30 days after the official PIESA date. */
export function thirtyDayEnd(piesaAt: string): string | null {
  if (!ok(piesaAt)) return null;
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(piesaAt) ? piesaAt : melbourneYmd(new Date(piesaAt));
  return endOfMelbourneYmd(addYmd(ymd, 30));
}

export type UpgradesDayChase = "text_electrician" | "email_office" | "red_flag";
/** What is due now on a job whose upgrades day isn't entered. `upgradesNeededAt` = when the PIESA said upgrades are needed
 *  (the PIESA completion); `piesaAt` = the official PIESA date (the 30-day clock). Bad dates → nothing (fail closed). */
export function upgradesDayChaseAction(f: { upgradesNeededAt: string; dayEntered: boolean; piesaAt: string; now: Date; sent: { text1: boolean; email2: boolean; flag7: boolean } }): UpgradesDayChase[] {
  if (f.dayEntered) return [];
  const out: UpgradesDayChase[] = [];
  if (ok(f.upgradesNeededAt)) {
    if (!f.sent.text1 && after(f.upgradesNeededAt, 1, f.now)) out.push("text_electrician");
    if (!f.sent.email2 && after(f.upgradesNeededAt, 2, f.now)) out.push("email_office");
  }
  const end = thirtyDayEnd(f.piesaAt);
  if (!f.sent.flag7 && end && Date.parse(end) - f.now.getTime() <= 7 * DAY) out.push("red_flag");
  return out;
}

export type CertificateChase = "text_electrician" | "office_flag";
/** What is due now on a job with Part C recorded (`upgradesDoneAt`, a Melbourne date) and no certificate file. */
export function certificateChaseAction(f: { upgradesDoneAt: string; fileAt: string | null; now: Date; sent: { text2: boolean; flag4: boolean } }): CertificateChase[] {
  if (f.fileAt || !ok(f.upgradesDoneAt)) return [];
  const out: CertificateChase[] = [];
  if (!f.sent.text2 && after(f.upgradesDoneAt, 2, f.now)) out.push("text_electrician");
  if (!f.sent.flag4 && after(f.upgradesDoneAt, 4, f.now)) out.push("office_flag");
  return out;
}

// ---------- Held wording (Jo approves each one; docs/wording/2026-11-03-part3-messages.md) ----------
// Texts: the ONE gate is the SMS type's `wordingApproved` in sms.core (final fix wave item 2).
/** Upgrades-day reminder text (SMS type electrician_upgrades_day_link). HELD. */
export const upgradesDayLinkText = (i: { first: string | null; address: string; url: string }) =>
  `Hi ${i.first?.trim() || "there"}, the upgrades day for ${i.address} isn't booked yet. Add it here: ${i.url}`;
/** Certificate reminder text, 2 business days after the upgrades (SMS type electrician_certificate_chase). HELD. */
export const certificateChaseText = (i: { first: string | null; address: string; url: string }) =>
  `Hi ${i.first?.trim() || "there"}, we still need the Certificate of Electrical Safety for ${i.address}. Add it here: ${i.url}`;
/** Installer office email, 2 business days with no upgrades day. HELD. */
export const UPGRADES_DAY_OFFICE_EMAIL_APPROVED: boolean = false;
export function upgradesDayOfficeEmail(i: { address: string; electrician: string | null; jobUrl: string }): { subject: string; text: string } {
  const who = i.electrician?.trim() || "The electrician";
  return {
    subject: `Upgrades day not set — ${i.address}`,
    text: `${who} hasn't set the electrical upgrades day for ${i.address} yet. Can you give them a nudge?\nThe install can't go ahead until the upgrades are done. The job: ${i.jobUrl}`,
  };
}

// ---------- Office flags (Needs me) ----------
export const upgradesDayNotSetLine = (electrician: string | null, address: string) => `Upgrades day not set — ${electrician?.trim() || "the electrician"} on ${address}`;
export const UPGRADES_DAY_RED_LINE = "Upgrades day not set — 7 days left on the 30-day clock";
export const certificateNotInLine = (electrician: string | null, phone: string | null) =>
  `Certificate not in — call ${electrician?.trim() || "the electrician"}${phone?.trim() ? ` (${phone.trim()})` : ""}`;

export type ChaseFlags = {
  upgradesDayNotSet?: { at: string; electrician: string | null; address: string };
  upgradesDayRed?: { at: string };
  certificateNotIn?: { at: string; electrician: string | null; phone: string | null };
};
type ChaseEvent = { created_at: string; details: Record<string, unknown> | null };
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
/** The open office flags from the job's round events and its LIVE certificate facts: each clears by itself once the day is
 *  entered (or done on the day) / the certificate file is on the job. The certificate flag counts only for the current Part C
 *  date; the upgrades rows only for the current PIESA record (`upgradesAnchor`, its id — a reassessment clears the old rows;
 *  null = unknown, no rows). */
export function chaseOfficeFlags(events: readonly ChaseEvent[], f: { state: CertificateState; upgradesDaySet: boolean; upgradesToday: boolean; upgradesDoneAt: string | null; upgradesAnchor: string | null }): ChaseFlags {
  const out: ChaseFlags = {};
  const newest = (round: ChaseRound, pred: (d: Record<string, unknown>) => boolean = () => true) =>
    events.filter((e) => e.details?.["round"] === round && pred(e.details ?? {})).sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1) ?? null;
  if (f.state === "upgrades_pending" && !f.upgradesDaySet && !f.upgradesToday && f.upgradesAnchor) {
    const current = (d: Record<string, unknown>) => d["anchor"] === f.upgradesAnchor;
    const email = newest(CHASE_ROUND.upgradesEmail, current);
    if (email) out.upgradesDayNotSet = { at: email.created_at, electrician: str(email.details?.["electrician"]), address: str(email.details?.["address"]) ?? "this job" };
    const red = newest(CHASE_ROUND.upgradesRed, current);
    if (red) out.upgradesDayRed = { at: red.created_at };
  }
  if (f.state === "waiting_for_certificate" && f.upgradesDoneAt) {
    const flag = newest(CHASE_ROUND.certificateFlag, (d) => d["anchor"] === f.upgradesDoneAt);
    if (flag) out.certificateNotIn = { at: flag.created_at, electrician: str(flag.details?.["electrician"]), phone: str(flag.details?.["phone"]) };
  }
  return out;
}

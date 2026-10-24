// Jo 24 Oct 2026 (decision 111): once the PIESA is signed and the install day is booked, the signed copy goes to the
// owner and the installer automatically, so "Signed PIESA copy delivery" (readyToInstall) and PIISA Part 8(a) clear
// without an office step. Pure rules + wording only. Persistence and sending: piesa-delivery.server.ts.
// Wording is DRAFT until Jo approves it: PIESA_COPY_EMAIL_APPROVED stays false, real jobs only log "not sent".
import { escDueBy } from "./esc.core";
import { simpleEmail } from "./simple-email.core";

export const PIESA_COPY_EMAIL_APPROVED = false as boolean;
export const PIESA_COPY_EMAIL_VERSION = "piesa-copy-v1-draft";
export const PIESA_COPY_DELIVERED_EVENT = "piesa_copy_delivered";
export const PIESA_COPY_NOT_SENT_EVENT = "piesa_copy_email_not_sent";
/** How many install bookings one 15-minute tick looks at. */
export const PIESA_COPY_MAX_PER_TICK = 50;

export type PiesaCopyRecipient = "owner" | "installer";

export type PiesaDeliveryFacts = {
  /** Current signed PIESA copy (official_form_signed_copies.status = current). */
  signedCopyId: string | null;
  /** Current piesa_records row (what piesa_deliveries rows hang off). */
  piesaRecordId: string | null;
  /** Confirmed install booking start, or null. */
  installStart: string | null;
  /** Recipients who already have a recorded delivery for this PIESA. */
  delivered: Record<PiesaCopyRecipient, boolean>;
  email: Record<PiesaCopyRecipient, string | null>;
  closed: boolean;
};

export type PiesaDeliveryPlan = {
  /** Recipients to email now (deduped: already-recorded deliveries are never repeated). */
  send: PiesaCopyRecipient[];
  /** Recipients that cannot be emailed (no address on file); shown to the office. */
  noAddress: PiesaCopyRecipient[];
  /** Why nothing goes at all (null = at least one recipient can be worked). */
  hold: string | null;
  /** True when less than 24h remains before the install start (readyToInstall deadline). */
  late: boolean;
};

/** Should-send, 24h-before and dedupe rules in one place. */
export function piesaDeliveryPlan(f: PiesaDeliveryFacts, now = new Date()): PiesaDeliveryPlan {
  const none = (hold: string): PiesaDeliveryPlan => ({ send: [], noAddress: [], hold, late: false });
  if (f.closed) return none("job closed or archived");
  if (!f.signedCopyId) return none("no signed PIESA copy yet");
  if (!f.piesaRecordId) return none("no current PIESA record");
  if (!f.installStart) return none("install day not booked yet");
  const start = Date.parse(f.installStart);
  if (!Number.isFinite(start)) return none("install start unreadable");
  if (start <= now.getTime()) return none("install day has already started");
  const late = now.getTime() > Date.parse(escDueBy(f.installStart));
  const pending = (["owner", "installer"] as const).filter((r) => !f.delivered[r]);
  if (!pending.length) return { ...none("both copies already recorded"), late };
  const send = pending.filter((r) => !!f.email[r]?.trim());
  const noAddress = pending.filter((r) => !f.email[r]?.trim());
  return { send, noAddress, hold: send.length ? null : "no email address on file", late };
}

/** One idempotency key per recipient and signed copy: a re-signed PIESA is a new copy and goes again. */
export const piesaCopyKey = (signedCopyId: string, recipient: PiesaCopyRecipient) => `piesa-copy:v1:${signedCopyId}:${recipient}`;

const fmtDate = (ymd: string | null) => {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return null;
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00+10:00`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "long", year: "numeric" }) : null;
};

/** DRAFT wording (Jo to approve). No prices, no other party's contact details. */
export function renderPiesaCopyEmail(i: { recipient: PiesaCopyRecipient; firstName: string | null; address: string | null; jobNumber: string; signatureDate: string | null; installStart: string | null; link: string; test?: boolean }) {
  const where = i.address?.trim() || "the property";
  const signed = fmtDate(i.signatureDate);
  const install = i.installStart ? new Date(i.installStart).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long" }) : null;
  const subject = `Signed electrical safety check (PIESA) – ${i.jobNumber}`;
  const lines = i.recipient === "owner"
    ? [
      `Here is the signed copy of the pre-installation electrical safety assessment (PIESA) for ${where}${signed ? `, completed on ${signed}` : ""}. It is kept on your Home Insulation Victoria job file.`,
      install ? `Your insulation install is booked for ${install}. The installer has been sent the same copy and will confirm on the day that they have received it.` : "The installer has been sent the same copy.",
      "Please keep this email with your records.",
    ]
    : [
      `Here is the signed copy of the pre-installation electrical safety assessment (PIESA) for ${where} (${i.jobNumber})${signed ? `, completed on ${signed}` : ""}. The owner has been sent the same copy.`,
      install ? `The install is booked for ${install}. On the day, tick Part 8(a) of the installer safety assessment (PIISA): "I have received a completed copy of the pre-installation electrical safety assessment for the premises".` : "On install day, tick Part 8(a) of the installer safety assessment (PIISA) to confirm you received it.",
      "Please keep this email with your records.",
    ];
  const mail = simpleEmail(`Hi ${i.firstName?.trim() || "there"},`, lines, { label: i.recipient === "owner" ? "Open my job page" : "Open the job in the portal", url: i.link }, { testLabel: i.test === true });
  return { subject, html: mail.html, text: mail.text };
}

// Jo 24 Oct 2026 (decision 111): once the PIESA is signed and the install day is booked, the signed copy goes to the
// owner and the installer automatically, so "Signed PIESA copy delivery" (readyToInstall) and PIISA Part 8(a) clear
// without an office step. Pure rules + wording only. Persistence and sending: piesa-delivery.server.ts.
// Design approved (decision 131): docs/templates/approved/O28-piesa-copy.html — "your electrical safety check: all clear"
// (or "repairs completed"), result card (date, electrician, repairs, install day), PDF button, "don't let anyone into the
// ceiling before the install". Delivery stays behind PIESA_COPY_EMAIL_APPROVED until the sending switch is turned on.
import { escDueBy } from "./esc.core";
import * as K from "./email-kit.core";

export const PIESA_COPY_EMAIL_APPROVED = false as boolean;
export const PIESA_COPY_EMAIL_VERSION = "piesa-copy-v2-approved-design";
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

const fmtDate = (ymd: string | null, weekday = true) => {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return null;
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00+10:00`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", ...(weekday ? { weekday: "long" } : {}), day: "numeric", month: "long", year: "numeric" }) : null;
};
const fmtInstall = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const day = d.toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long" });
  const t = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", minute: "2-digit", hour12: true }).format(d).replace(/\s/g, "").replace(":00", "").toLowerCase();
  return `${day}, arriving ${t}`;
};

export type PiesaCopyEmailInput = {
  recipient: PiesaCopyRecipient; firstName: string | null; address: string | null; jobNumber: string; signatureDate: string | null; installStart: string | null; link: string; test?: boolean;
  /** Electrician business + licence/REC numbers, when known. */
  electrician?: { name: string | null; licence?: string | null; rec?: string | null } | null;
  /** Repairs: null/undefined = none recorded; a CES number means repairs were completed. */
  repairs?: { completed: boolean; cesNumber?: string | null } | null;
};

/** Decision 131 wording. No prices, no other party's contact details. */
export function renderPiesaCopyEmail(i: PiesaCopyEmailInput) {
  const where = i.address?.trim() || "the property";
  const signed = fmtDate(i.signatureDate);
  const install = fmtInstall(i.installStart);
  const repaired = i.repairs?.completed === true;
  const first = K.cleanName(i.firstName) ?? "there";
  const subject = `Signed electrical safety check (PIESA) – ${i.jobNumber}`;
  const owner = i.recipient === "owner";
  const headline = owner
    ? `${first}, your electrical safety check: ${repaired ? "repairs completed" : "all clear"}`
    : `${first}, the owner's electrical safety check for ${i.jobNumber}: ${repaired ? "repairs completed" : "all clear"}`;
  const intro = owner
    ? "Here's your copy of the completed pre-installation electrical safety assessment (the PIESA) for your home. The VEU program requires you to have it at least 24 hours before your install, so please keep this email."
    : `Here's the signed copy of the pre-installation electrical safety assessment (PIESA) for ${where} (${i.jobNumber}). The owner has been sent the same copy. On install day, tick Part 8(a) of the installer safety assessment (PIISA): "I have received a completed copy of the pre-installation electrical safety assessment for the premises".`;
  const el = i.electrician?.name?.trim() ? [i.electrician.name.trim(), i.electrician.licence ? `Lic. ${i.electrician.licence}` : null, i.electrician.rec ? `REC ${i.electrician.rec}` : null].filter(Boolean).join(" · ") : null;
  const rows: { k: string; v: string }[] = [
    ...(signed ? [{ k: "Checked on", v: signed }] : []),
    ...(el ? [{ k: "Electrician", v: el }] : []),
    { k: "Repairs needed", v: repaired ? `Completed${i.repairs?.cesNumber ? ` · CES ${i.repairs.cesNumber}` : ""}` : "None" },
    ...(install ? [{ k: owner ? "Your install" : "Install", v: install }] : []),
  ];
  const after = owner
    ? `Your installer has the same copy. One thing to know: <strong>please don't let anyone into the ceiling before the install</strong>. If anything changes up there, the check may need to be done again.`
    : `Please keep this email with your records. If anything changes in the ceiling before the install, the check may need to be done again.`;
  const body = [
    K.h1(headline, 8),
    K.p(intro),
    K.resultCard({ label: "Safety check result", headline: repaired ? "Safe to insulate (after repairs) ✓" : "Safe to insulate ✓", rows, kv: true }),
    K.button(i.link, "View your safety check (PDF)"),
    K.p(after, "16px 0 0", true),
    K.small(owner ? "Questions about the safety check? Just reply to this email." : "Questions? Just reply to this email."),
  ].join("\n");
  const html = K.emailShell({ body, previewText: intro.slice(0, 120), testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([
    headline, "", intro, "",
    "SAFETY CHECK RESULT", repaired ? "Safe to insulate (after repairs)" : "Safe to insulate", ...rows.map((r) => `${r.k}: ${r.v}`), "",
    `View your safety check (PDF): ${i.link}`, "", K.stripTags(after), "", owner ? "Questions about the safety check? Just reply to this email." : "Questions? Just reply to this email.",
  ], { testLabel: i.test === true });
  return { subject, html, text };
}

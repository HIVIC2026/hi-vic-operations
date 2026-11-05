// Jo 24 Oct 2026 (decision 111): once the PIESA is signed and the install day is booked, the signed copy goes to the
// owner and the installer automatically, so "Signed PIESA copy delivery" (readyToInstall) and PIISA Part 8(a) clear
// without an office step. Pure rules + wording only. Persistence and sending: piesa-delivery.server.ts.
// Design approved (decision 131); MJML refresh (Jo 27 Oct 2026): docs/templates/mjml/owner_O28.mjml + installer_piesa-copy.mjml — "your electrical safety check: all clear"
// (or "electrical upgrades completed"), result card (date, electrician, upgrades, install day), PDF button, "don't let anyone into the
// ceiling before the install". PIESA_COPY_EMAIL_APPROVED is on (decision 131); real delivery still needs customer_comms_enabled.
import { escDueBy } from "./esc.core";
import * as K from "./email-kit.core";
import { esc, mjEmail } from "./mail-mjml.core";
import { melbourneMidnight } from "./daily-brief.core";

/** Jo 24 Oct 2026, decision 131 (O28 PIESA copy): approved. Owner copy still behind customer_comms_enabled, installer copy through sendOfficeEmail. */
export const PIESA_COPY_EMAIL_APPROVED = true as boolean;
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
  /** Part 4 Task 2: false when the owner's PIESA arrives attached to the result email (piesa-result-route.core), so no standalone owner copy. Default true. */
  ownerStandalone?: boolean;
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
  const start = f.installStart ? Date.parse(f.installStart) : null;
  if (start !== null && !Number.isFinite(start)) return none("install start unreadable");
  if (start !== null && start <= now.getTime()) return none("install day has already started");
  const late = !!f.installStart && now.getTime() > Date.parse(escDueBy(f.installStart));
  const pending = (["owner", "installer"] as const).filter((r) => !f.delivered[r] && (r === 'owner' ? f.ownerStandalone !== false : !!f.installStart));
  if (!pending.length) return { ...none("both copies already recorded"), late };
  const send = pending.filter((r) => !!f.email[r]?.trim());
  const noAddress = pending.filter((r) => !f.email[r]?.trim());
  return { send, noAddress, hold: send.length ? null : "no email address on file", late };
}

/** One idempotency key per recipient and signed copy: a re-signed PIESA is a new copy and goes again. */
export const piesaCopyKey = (signedCopyId: string, recipient: PiesaCopyRecipient) => `piesa-copy:v1:${signedCopyId}:${recipient}`;

const fmtDate = (ymd: string | null, weekday = true) => {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return null;
  if (!Number.isFinite(Date.parse(ymd.slice(0, 10)))) return null;
  const d = new Date(melbourneMidnight(ymd.slice(0, 10)));
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
  recipient: PiesaCopyRecipient; firstName: string | null; address: string | null; jobNumber: string; signatureDate: string | null; installStart: string | null; link: string | null; test?: boolean;
  /** Electrician business + licence/REC numbers, when known. */
  electrician?: { name: string | null; licence?: string | null; rec?: string | null } | null;
  /** Electrical upgrades (code name kept): null/undefined = none recorded; a CES number means the upgrades were completed. */
  repairs?: { completed: boolean; cesNumber?: string | null } | null;
  /** J4 G3: the PIESA found electrical upgrades still to come (installer copy only — the owner's copy on that result is the
   *  upgrades-needed email, never this one). */
  upgradesNeeded?: boolean;
};

/** J4 G3 (trade-facing, behind UPGRADES_NEEDED_EMAIL_APPROVED): the installer copy's "upgrades still to come" lines —
 *  APPROVED by Jo 4 Nov 2026 14:18 (Round 5 B) as in code; the flag flips at go-live (Part 11). */
export const INSTALLER_UPGRADES_NEEDED = {
  result: "Electrical upgrades needed first",
  row: "Yes — see the attached safety check",
  next: "Next: the electrician books the upgrades with the owner. Once the certificate is in, call the owner and book the install.",
  preview: "Electrical upgrades needed first: the electrician books them with the owner. Tick Part 8(a) of your PIISA on install day.",
} as const;

/** Decision 131 wording. No prices, no other party's contact details. Pack 1 item 44 (Jo 4 Nov 2026, approved): after the
 *  electrical upgrades the OWNER variant is the "your electrical upgrades are done" redraft — never the word "repairs"
 *  anywhere an owner sees; the trade variant says "electrical upgrades" too. The all-clear owner variant is unchanged. */
export function renderPiesaCopyEmail(i: PiesaCopyEmailInput) {
  const where = i.address?.trim() || "the property";
  const signed = fmtDate(i.signatureDate);
  const install = fmtInstall(i.installStart);
  const repaired = i.repairs?.completed === true;
  const first = K.cleanName(i.firstName) ?? "there";
  const owner = i.recipient === "owner";
  // J4 G3: an owner never gets this copy on an upgrades-still-to-come result (their copy is the upgrades-needed email).
  const needed = !owner && i.upgradesNeeded === true && !repaired;
  const subject = owner && repaired ? "Your electrical upgrades are done — updated safety check attached" : `Signed electrical safety check (PIESA) – ${i.jobNumber}`;
  const outcome = repaired ? "electrical upgrades completed" : needed ? "electrical upgrades needed" : "all clear";
  const headline = owner
    ? repaired ? `${first}, your electrical upgrades are done` : `${first}, your electrical safety check: ${outcome}`
    : `Electrical safety check for ${i.jobNumber}: ${outcome}`;
  const greeting = owner ? null : `${first},`;
  const intro = owner
    ? repaired
      ? "Here's your updated copy of your electrical safety check (PIESA), now that the upgrades are complete. Please keep it: the VEU program says you must have it at least 24 hours before your install."
      : "Here's your copy of the completed Pre Insulation Electrical Safety Assessment (PIESA) for your home. The VEU program says you must have it at least 24 hours before your install, so please keep this email."
    : `Here's the signed copy of the pre-installation electrical safety assessment (PIESA) for ${where} (${i.jobNumber}). The owner has been sent the same copy.`;
  const part8 = `Tick Part 8(a) of the installer safety assessment (PIISA): "I have received a completed copy of the pre-installation electrical safety assessment for the premises".`;
  const result = needed ? INSTALLER_UPGRADES_NEEDED.result : repaired && !owner ? "Safe to insulate (after electrical upgrades)" : "Safe to insulate";
  const preview = owner
    ? repaired
      ? "Electrical upgrades done — safe to insulate. Please keep this copy – you need it at least 24 hours before your install."
      : "All clear, safe to insulate. Please keep this copy – you need it at least 24 hours before your install."
    : needed ? INSTALLER_UPGRADES_NEEDED.preview : `${repaired ? "Electrical upgrades completed" : "All clear"}: safe to insulate. Tick Part 8(a) of your PIISA on install day.`;
  const el = i.electrician?.name?.trim() ? [i.electrician.name.trim(), i.electrician.licence ? `Lic. ${i.electrician.licence}` : null, i.electrician.rec ? `REC ${i.electrician.rec}` : null].filter(Boolean).join(" · ") : null;
  const certificate = i.repairs?.cesNumber?.trim() || null;
  const rows: { k: string; v: string }[] = [
    ...(signed ? [{ k: "Checked on", v: signed }] : []),
    ...(el ? [{ k: "Electrician", v: el }] : []),
    owner && repaired
      ? { k: "Electrical upgrades", v: `Completed${certificate ? ` · certificate ${certificate}` : ""}` }
      : { k: "Electrical upgrades needed", v: repaired ? `Completed${certificate ? ` · CES ${certificate}` : ""}` : needed ? INSTALLER_UPGRADES_NEEDED.row : "None" },
    ...(install ? [{ k: owner ? "Your install" : "Install", v: install }] : []),
  ];
  const after = owner
    ? `Your installer has the same copy. One thing to know: <strong>please don't let anyone into the ceiling before the install.</strong> If anything changes up there, the check may need to be done again.`
    : `Please keep this email with your records. If anything changes in the ceiling before the install, the check may need to be done again.`;
  // #41 (Jo 2 Nov 2026): the installer office is told what happens next. J4 G3: stage-aware — nothing once the install is
  // already booked; the upgrades-still-to-come line while the electrician has the upgrades to do.
  const next = owner || i.installStart ? null : needed ? INSTALLER_UPGRADES_NEEDED.next : "Next: call the owner and book the install in the portal. They pay their 50% deposit to lock it in.";
  const questions = owner ? "Questions about the safety check? Just reply to this email." : "Questions? Just reply to this email.";
  // Link check (Jo 27 Oct 2026): the signed PIESA travels as the attached PDF; the button opens My job / the job page.
  const attached = "Your signed safety check is attached to this email (PDF).";
  const label = owner ? "Confirm my safety check" : "Open the job";
  const button = (pad: string) => (i.link ? `<mj-button href="${esc(i.link)}"${pad}>${label}</mj-button>` : "");
  const body = owner
    ? [
      `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
      `<mj-section><mj-column mj-class="panel-mint"><mj-text mj-class="eyebrow" padding="18px 18px 4px">Safety check result</mj-text><mj-text font-family="Outfit, Figtree, -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif" font-size="24px" line-height="30px" font-weight="800" color="#057D40" padding="0 18px 10px">${esc(result)} &#10003;</mj-text><mj-table padding="0 18px 8px" font-size="14px" line-height="20px">${rows.map((r) => `<tr><td width="38%" valign="top" style="border-top:1px solid #CDEBD9;padding:10px 10px 10px 0;color:#5A6785;">${esc(r.k)}</td><td valign="top" style="border-top:1px solid #CDEBD9;padding:10px 0;"><strong>${esc(r.v)}</strong></td></tr>`).join("")}</mj-table></mj-column></mj-section>`,
      `<mj-section><mj-column><mj-text padding="14px 12px 14px"><strong>${esc(attached)}</strong></mj-text>${button(' padding="0 12px 18px"')}<mj-text>${after}</mj-text><mj-text mj-class="small" padding="0 12px 0">${esc(questions)}</mj-text></mj-column></mj-section>`,
    ].join("")
    : [
      `<mj-section><mj-column><mj-text mj-class="hi">${esc(greeting)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(headline)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
      needed
        ? `<mj-section><mj-column mj-class="panel-amber"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Safety check result</mj-text><mj-text align="center" font-family="Outfit, Figtree, -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif" font-size="30px" line-height="36px" font-weight="800" color="#8A5A00" padding="0 12px 18px">${esc(result)}</mj-text></mj-column></mj-section>`
        : `<mj-section><mj-column mj-class="panel-mint"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Safety check result</mj-text><mj-text mj-class="big-green" padding="0 12px 18px" font-size="30px" line-height="36px">${esc(result)} &#10003;</mj-text></mj-column></mj-section>`,
      `<mj-section><mj-column mj-class="panel-card"><mj-table padding="8px 18px 8px">${rows.map((r, n) => { const bt = n === 0 ? "" : "border-top:1px solid #E4E9F5;"; return `<tr><td valign="top" style="padding:10px 12px 10px 0;white-space:nowrap;${bt}" class="muted">${esc(r.k)}</td><td align="right" valign="top" style="padding:10px 0;${bt}font-weight:700;">${esc(r.v)}</td></tr>`; }).join("")}</mj-table></mj-column></mj-section>`,
      `<mj-section><mj-column mj-class="panel"><mj-text mj-class="h2" padding="18px 18px 6px">On install day</mj-text><mj-text padding="0 18px 18px">${esc(part8)}</mj-text></mj-column></mj-section>`,
      ...(next ? [`<mj-section><mj-column><mj-text padding="14px 12px 0"><strong>${esc(next)}</strong></mj-text></mj-column></mj-section>`] : []),
      `<mj-section><mj-column><mj-text padding="14px 12px 14px"><strong>${esc(attached)}</strong></mj-text>${button("")}<mj-text mj-class="small">${after}</mj-text><mj-text mj-class="small" padding="0 12px 0">${esc(questions)}</mj-text></mj-column></mj-section>`,
    ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([
    ...(greeting ? [greeting] : []), headline, "", intro, "",
    "SAFETY CHECK RESULT", result, ...rows.map((r) => `${r.k}: ${r.v}`), "",
    ...(owner ? [] : ["ON INSTALL DAY", part8, "", ...(next ? [next, ""] : [])]),
    attached, ...(i.link ? [`${label}: ${i.link}`] : []), "", K.stripTags(after), "", questions,
  ], { testLabel: i.test === true });
  return { subject, html, text };
}

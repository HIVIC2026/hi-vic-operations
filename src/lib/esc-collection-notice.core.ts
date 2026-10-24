// ESC "VEU Scheme Participant Privacy Collection Notice" (version 1.0, 1 October 2026) and the rules for recording that
// each installer PERSON read and acknowledged it. PURE: no I/O.
//
// Rule (ESC, 1 Oct 2026; Jo decisions 119, 121, 122, 130): before the AP registers an installer as a scheme participant in
// the VEU Registry, the AP must give that installer the commission's collection notice and tell them their details may be
// disclosed to the commission and shared with the Energy Efficiency Council. The AP later declares this on the VEEC
// assignment form for every installer listed, so the portal keeps a per-person record (6-year retention).
//
// Decision 130 (Jo, 24 Oct 2026):
//  1. every installer person (each worker, not only the business signer) gets their own secure link by text + email
//     (no login; `/notice/$token`, SHA-256 of the token stored), showing the notice verbatim with ONE tick + typed name;
//     recorded with time / IP / user agent / notice sha; a copy is emailed (guarded senders behind unapproved flags).
//  2. reminders at 3 and 7 days while not acknowledged (`noticeSendPlan`), same flags.
//  3. ENFORCED: a person who has not acknowledged cannot be listed as lead or crew on any installation
//     (`workerOfferBlocker` in worker-compliance.core.ts, PIISA crew in piisa-a3.core.ts, pre-start lead check in
//     prestart.core.ts). The business owner cannot tick for others; the business page is the overview.
//
// Records are append-only and read through `collectionNoticeStatus`:
//  - onboarding: the applicant's OWN row (`is_self`) carries `esc_notice_ack` inside the (immutable once signed) application
//    data, stamped server-side by `stampOnboardingNoticeAcks`;
//  - afterwards: `admin_config_events` rows of type `COLLECTION_NOTICE_EVENT` with `details.business_id` + `details.worker_email`
//    (same business-scoped pattern as the usual-electrician nomination), written from the person's secure link or their
//    own My business sign-in.
//
// VEEC assignment build (src/lib/assignment.*): load statuses with `businessNoticeStatuses(businessId)` from
// esc-collection-notice.server.ts (or call `collectionNoticeStatus(workers, acks)` directly) and apply
// `collectionNoticeBlockers(statuses, installerEmails)` as the AP prerequisite "each installer given the ESC collection
// notice": only an "acknowledged" record satisfies it. Nothing here blocks partner activation.
import { sha256Hex } from "./sha256.core";
import type { PartnerBlock } from "./partner-email.core";

export const COLLECTION_NOTICE_TITLE = "VEU Scheme Participant Privacy Collection Notice";
export const COLLECTION_NOTICE_VERSION = "1.0";
export const COLLECTION_NOTICE_DATE = "2026-10-01";
export const COLLECTION_NOTICE_VERSION_LINE = "Version 1.0 – 1 October 2026";
/** Official file Jo supplied (decision 122) and its SHA-256; the text below is that document, paragraph by paragraph. */
export const COLLECTION_NOTICE_SOURCE_FILE = "docs/official-forms/ESC-VEU-Scheme-Participant-Privacy-Collection-Notice-v1.0-20261001.docx";
export const COLLECTION_NOTICE_SOURCE_SHA256 = "7ee9d3d8317fd073ac39ee4a5d441ce061c008ab509f0afe04adc641e90a8988";

export type NoticeParagraph = { kind: "heading" | "version" | "p" | "li" | "li2"; text: string };
/** The notice VERBATIM (trailing spaces of the Word paragraphs trimmed; nothing reworded). `li2` = nested bullet. */
export const COLLECTION_NOTICE_PARAGRAPHS: readonly NoticeParagraph[] = [
  { kind: "heading", text: COLLECTION_NOTICE_TITLE },
  { kind: "version", text: COLLECTION_NOTICE_VERSION_LINE },
  { kind: "p", text: "The Essential Services Commission (commission) collects personal information about scheme participants (installers). We usually collect this information from the accredited person for whom you undertake activities, including through the VEEC assignment form. The information may include your name, date of birth, company, contact details, licence and certification details and evidence of training. We collect this information to:" },
  { kind: "li", text: "assess whether scheme participants and accredited persons have undertaken prescribed activities in accordance with Victorian Energy Upgrades (VEU) program requirements, including applicable training and competency requirements for scheme participants" },
  { kind: "li", text: "assess whether Victorian Energy Efficiency Certificates (VEECs) created for prescribed activities are eligible for registration" },
  { kind: "li", text: "perform our functions under the Victorian Energy Efficiency Target Act 2007 (VEET Act) and the Essential Services Commission Act 2001 including accreditations, compliance monitoring, enforcement, and reporting." },
  { kind: "p", text: "The commission may use and disclose a scheme participant’s personal information:" },
  { kind: "li", text: "with the Energy Efficiency Council and other certification or training bodies to verify your certification and training" },
  { kind: "li", text: "for the purpose of performing the commission’s functions or exercising powers under the VEET Act" },
  { kind: "li", text: "with other persons or organisations for the purpose of those persons or organisations performing their functions and powers, including:" },
  { kind: "li2", text: "government departments, including the Department of Energy, Environment and Climate Action;" },
  { kind: "li2", text: "Energy Safe Victoria, WorkSafe Victoria and other State, Territory or Commonwealth regulators" },
  { kind: "li2", text: "persons administering other energy efficiency schemes;" },
  { kind: "li2", text: "State, Territory or Commonwealth police." },
  { kind: "p", text: "The commission handles personal information in accordance with the Privacy and Data Protection Act 2014 and our privacy and confidential information policy." },
  { kind: "p", text: "If you do not provide this information, you may not be able to undertake prescribed activities, or parts of activities, for an accredited person and VEECs for the prescribed activity may not be eligible for registration." },
  { kind: "p", text: "If you have any questions about how your personal information will be handled or would like to access or correct your personal information, you can contact the commission on (03) 9032 1300 or privacy@esc.vic.gov.au." },
];
/** Plain text of the notice, one paragraph per line, exactly what is hashed and emailed. */
export const COLLECTION_NOTICE_TEXT = COLLECTION_NOTICE_PARAGRAPHS.map((p) => p.text).join("\n");
export const COLLECTION_NOTICE_SHA256 = sha256Hex(COLLECTION_NOTICE_TEXT);

/** The ONE tick, exact wording (decision 130). */
export const COLLECTION_NOTICE_ACK_TEXT = "I have read the Essential Services Commission's VEU Scheme Participant Privacy Collection Notice and understand my details may be disclosed to the commission and shared with the Energy Efficiency Council.";
/** Plain message shown wherever an unacknowledged person is refused as lead or crew. */
export const COLLECTION_NOTICE_BLOCK_MESSAGE = "ESC privacy collection notice not acknowledged — this person can't be listed as lead or crew until they open their link and acknowledge it.";

export const COLLECTION_NOTICE_EVENT = "esc_collection_notice_acknowledged";
export const COLLECTION_NOTICE_LINK_EVENT = "esc_collection_notice_link_issued";
export const COLLECTION_NOTICE_SEND_EVENT = "esc_collection_notice_link_sent";
/** Real (non-TEST) link texts/emails and the emailed copy stay off until Jo approves the wording. TEST partners use the test senders. */
export const COLLECTION_NOTICE_SEND_APPROVED = false;
export const COLLECTION_NOTICE_EMAIL_APPROVED = false;
export const COLLECTION_NOTICE_LINK_DAYS = 30;
/** Reminder schedule (decision 130): first send, then 3 and 7 days after the first send while not acknowledged. */
export const COLLECTION_NOTICE_REMINDER_DAYS = [3, 7] as const;
export const COLLECTION_NOTICE_SMS_TYPE = "esc_notice_link";

export type NoticeAckKind = "acknowledged";
export type NoticeAck = {
  worker_email: string; kind: NoticeAckKind; at: string; by_name: string;
  notice_version: string; notice_sha256: string; source: "onboarding" | "my_business" | "secure_link" | string;
};
export type NoticeWorker = { id?: string | null; email: string | null | undefined; full_legal_name: string; trade_role: string; removed_at?: string | null };
export type NoticeState = "missing" | "acknowledged";
export type NoticeStatus = {
  workerId: string | null; email: string; name: string; state: NoticeState;
  at: string | null; byName: string | null; source: string | null;
  /** True when a record exists only for an earlier notice version/text, which does not count. */
  superseded: boolean;
};

export const noticeEmailKey = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();
const isCurrent = (a: NoticeAck) => a.notice_sha256 === COLLECTION_NOTICE_SHA256;

/** Per installer person (every worker who installs, not just the business signer): the latest current acknowledgement, or missing. */
export function collectionNoticeStatus(workers: readonly NoticeWorker[], acks: readonly NoticeAck[]): NoticeStatus[] {
  return workers.filter((w) => w.trade_role === "installer" && !w.removed_at).map((w) => {
    const email = noticeEmailKey(w.email);
    const mine = email ? acks.filter((a) => noticeEmailKey(a.worker_email) === email) : [];
    const best = mine.filter(isCurrent).reduce<NoticeAck | null>((b, a) => (!b || a.at > b.at ? a : b), null);
    return { workerId: w.id ?? null, email, name: w.full_legal_name, state: best ? "acknowledged" : "missing", at: best?.at ?? null, byName: best?.by_name ?? null, source: best?.source ?? null, superseded: !best && mine.length > 0 };
  });
}

/** Map worker id -> acknowledged?, for the offer/crew paths (workers without an id are skipped). */
export function noticeAckByWorkerId(statuses: readonly NoticeStatus[]): Map<string, boolean> {
  return new Map(statuses.filter((s) => s.workerId).map((s) => [s.workerId!, s.state === "acknowledged"]));
}

/** Office flags (inform; approval and activation are never blocked by these). */
export function collectionNoticeFlags(statuses: readonly NoticeStatus[]): string[] {
  const missing = statuses.filter((s) => s.state === "missing");
  return missing.length ? [`ESC notice not acknowledged: ${missing.map((s) => s.name).join(", ")}${missing.some((s) => s.superseded) ? " (older notice version only)" : ""}.`] : [];
}

/** Short per-worker label for office and My business lists. */
export function collectionNoticeLabel(s: Pick<NoticeStatus, "state" | "at">): string {
  const when = s.at ? ` ${new Date(s.at).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne" })}` : "";
  return s.state === "acknowledged" ? `ESC notice acknowledged${when}` : "ESC notice not acknowledged";
}

/**
 * VEEC assignment AP prerequisite (decision 119) and crew rule (decision 130): every installer listed must have
 * acknowledged the current notice. Pass the emails of the installers listed; one with no status row also blocks. Empty = ready.
 */
export function collectionNoticeBlockers(statuses: readonly NoticeStatus[], installerEmails: readonly string[]): string[] {
  const by = new Map(statuses.map((s) => [s.email, s]));
  return installerEmails.map(noticeEmailKey).filter(Boolean).flatMap((e) => {
    const s = by.get(e);
    if (!s) return [`ESC collection notice record missing for ${e}.`];
    return s.state === "missing" ? [`ESC collection notice not acknowledged by ${s.name}.`] : [];
  });
}

// ---- Onboarding draft (the applicant's own row only; stamped server-side) ----
export type OnboardingNoticeAck = { at: string; by_name: string; kind: NoticeAckKind; notice_version: string; notice_sha256: string };
type DraftInstaller = { email?: string; full_legal_name?: string; is_self?: boolean; esc_notice_ticked?: boolean; esc_notice_ack?: OnboardingNoticeAck | null };

/**
 * The browser only sends the tick; the server stamps the record, and only for the applicant's OWN row (`is_self`): the owner
 * cannot acknowledge for anyone else (decision 130) — other installers get their own secure link after approval. A tick kept
 * from the previous save keeps its original stamp (matched by email); an untick removes the draft record (drafts are not
 * yet history); stamps sent by the browser are ignored.
 */
export function stampOnboardingNoticeAcks<T extends DraftInstaller>(prev: readonly T[] | undefined, next: readonly T[] | undefined, now = new Date()): T[] {
  const prevBy = new Map((prev ?? []).filter((x) => x.esc_notice_ack).map((x) => [noticeEmailKey(x.email), x.esc_notice_ack!]));
  return (next ?? []).map((x) => {
    const { esc_notice_ack: _browser, ...rest } = x;
    if (x.esc_notice_ticked !== true || !x.is_self) return rest as T;
    const kept = prevBy.get(noticeEmailKey(x.email));
    const ack: OnboardingNoticeAck = kept && kept.notice_sha256 === COLLECTION_NOTICE_SHA256
      ? kept
      : { at: now.toISOString(), by_name: (x.full_legal_name ?? "").trim(), kind: "acknowledged", notice_version: COLLECTION_NOTICE_VERSION, notice_sha256: COLLECTION_NOTICE_SHA256 };
    return { ...rest, esc_notice_ack: ack } as T;
  });
}

/** Records carried by a (signed) application's installers, in the shape `collectionNoticeStatus` reads. */
export function acksFromApplicationData(data: unknown): NoticeAck[] {
  const list = ((data as { installers?: DraftInstaller[] } | null)?.installers ?? []);
  return list.flatMap((x) => {
    const a = x.esc_notice_ack;
    if (!a || !a.at || !a.notice_sha256) return [];
    return [{ worker_email: noticeEmailKey(x.email), kind: "acknowledged", at: a.at, by_name: a.by_name ?? "", notice_version: a.notice_version ?? "", notice_sha256: a.notice_sha256, source: "onboarding" }];
  });
}

/** One `admin_config_events` row (append-only) for an approved business's worker acknowledging for themself. */
export function noticeEventDetails(p: { businessId: string; workerId: string | null; workerEmail: string; byName: string; source: "my_business" | "secure_link"; ip?: string | null; userAgent?: string | null; linkId?: string | null; now?: Date }) {
  const at = (p.now ?? new Date()).toISOString();
  return {
    summary: `${p.byName || p.workerEmail} acknowledged the ESC collection notice v${COLLECTION_NOTICE_VERSION} (${p.source === "secure_link" ? "secure link" : "My business"})`,
    details: { business_id: p.businessId, worker_id: p.workerId, worker_email: noticeEmailKey(p.workerEmail), by_name: p.byName, kind: "acknowledged" as const, at, notice_version: COLLECTION_NOTICE_VERSION, notice_sha256: COLLECTION_NOTICE_SHA256, source: p.source, ip: p.ip ?? null, user_agent: p.userAgent ?? null, link_id: p.linkId ?? null },
  };
}
export function ackFromEventDetails(details: unknown): NoticeAck | null {
  const d = (details ?? {}) as Record<string, unknown>;
  const email = noticeEmailKey(typeof d["worker_email"] === "string" ? d["worker_email"] : null);
  const at = typeof d["at"] === "string" ? d["at"] : null;
  if (!email || !at) return null;
  return { worker_email: email, kind: "acknowledged", at, by_name: typeof d["by_name"] === "string" ? d["by_name"] : "", notice_version: String(d["notice_version"] ?? ""), notice_sha256: String(d["notice_sha256"] ?? ""), source: String(d["source"] ?? "my_business") };
}

// ---- Secure links (no login) ----
export type NoticeLink = { id: string; business_id: string; worker_id: string; worker_email: string; token_hash: string; expires_at: string; created_at: string };
export function noticeLinkDetails(p: { businessId: string; workerId: string; workerEmail: string; tokenHash: string; now?: Date }) {
  const now = p.now ?? new Date();
  return { business_id: p.businessId, worker_id: p.workerId, worker_email: noticeEmailKey(p.workerEmail), token_hash: p.tokenHash, expires_at: new Date(now.getTime() + COLLECTION_NOTICE_LINK_DAYS * 86_400_000).toISOString(), issued_at: now.toISOString() };
}
export function noticeLinkState(l: { expires_at: string }, acknowledged: boolean, now = new Date()): "open" | "acknowledged" | "expired" {
  if (acknowledged) return "acknowledged";
  return Date.parse(l.expires_at) <= now.getTime() ? "expired" : "open";
}
export const noticeLinkUrl = (base: string, token: string) => `${base}/notice/${token}`;

/** Secure-link submission rules: the one tick and a typed name matching the listed person (loosely: same first and last word). */
export function noticeAckSubmissionErrors(i: { ticked: boolean; typedName: string; listedName: string }): string[] {
  const e: string[] = [];
  if (i.ticked !== true) e.push("Tick the box to confirm you have read the notice.");
  const typed = i.typedName.trim().replace(/\s+/g, " ");
  if (typed.length < 2) e.push("Type your full name.");
  else {
    const n = (s: string) => s.toLowerCase().split(" ").filter(Boolean);
    const a = n(typed), b = n(i.listedName);
    if (b.length && (a[0] !== b[0] || a[a.length - 1] !== b[b.length - 1])) e.push(`Type your name as it is listed: ${i.listedName}.`);
  }
  return e;
}

/** Text and email wording for the link (unapproved: real sends are blocked by the senders' own flags). */
export const noticeLinkSmsBody = (firstName: string | null, url: string) =>
  `${firstName ? `Hi ${firstName}, ` : ""}before we can register you as a VEU installer, please read the Essential Services Commission's privacy collection notice and acknowledge it here: ${url}. Reply STOP to opt out.`;
export function noticeLinkEmail(i: { firstName: string | null; businessName: string; url: string; reminder: boolean }): { subject: string; heading: string; blocks: PartnerBlock[] } {
  return {
    subject: i.reminder ? "Reminder: please acknowledge the ESC privacy collection notice" : "Please read and acknowledge the ESC privacy collection notice",
    heading: "ESC privacy collection notice",
    blocks: [
      { kind: "p", text: `Hi ${i.firstName?.trim() || "there"},` },
      { kind: "p", text: `${i.reminder ? "A quick reminder: " : ""}Home Insulation Victoria must give every installer the Essential Services Commission's ${COLLECTION_NOTICE_TITLE} before registering them as a VEU scheme participant. Your details may be disclosed to the commission and shared with the Energy Efficiency Council.` },
      { kind: "p", text: `Please open your personal link, read the notice and tick that you've read it. It takes a minute and no sign-in is needed. You can't be listed on an installation for ${i.businessName} until it's done.` },
      { kind: "button", label: "Read and acknowledge the notice", url: i.url },
      { kind: "p", text: "Just reply to this email if you have any questions." },
    ],
  };
}

/**
 * What to send now for one unacknowledged person, from their send history (attempt numbers already recorded, and when the
 * first was). Attempt 1 straight away; 2 and 3 at 3 and 7 days after the first. Nothing after three. Null = nothing now.
 */
export function noticeSendPlan(history: readonly { attempt: number; at: string }[], now = new Date()): { attempt: 1 | 2 | 3; reminder: boolean } | null {
  if (!history.length) return { attempt: 1, reminder: false };
  const first = history.reduce((m, h) => (h.at < m ? h.at : m), history[0]!.at);
  const done = new Set(history.map((h) => h.attempt));
  const days = (now.getTime() - Date.parse(first)) / 86_400_000;
  if (!done.has(2) && days >= COLLECTION_NOTICE_REMINDER_DAYS[0]) return { attempt: 2, reminder: true };
  if (done.has(2) && !done.has(3) && days >= COLLECTION_NOTICE_REMINDER_DAYS[1]) return { attempt: 3, reminder: true };
  return null;
}

/** Emailed copy of the notice on acknowledgement (sent only when `COLLECTION_NOTICE_EMAIL_APPROVED`, or to TEST partners via the test sender). */
export function collectionNoticeEmail(i: { firstName: string | null; acknowledgedAt: string }): { subject: string; heading: string; blocks: PartnerBlock[] } {
  const when = new Date(i.acknowledgedAt).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", dateStyle: "long", timeStyle: "short" });
  const blocks: PartnerBlock[] = [
    { kind: "p", text: `Hi ${i.firstName?.trim() || "there"},` },
    { kind: "p", text: `Here is your copy of the Essential Services Commission's ${COLLECTION_NOTICE_TITLE} (${COLLECTION_NOTICE_VERSION_LINE}), which you acknowledged on ${when}. Your details may be disclosed to the commission and shared with the Energy Efficiency Council.` },
    ...COLLECTION_NOTICE_PARAGRAPHS.filter((p) => p.kind !== "heading").map<PartnerBlock>((p) => (p.kind === "li" || p.kind === "li2" ? { kind: "list", items: [p.text] } : { kind: "p", text: p.text })),
    { kind: "p", text: "Just reply to this email if you have any questions." },
  ];
  return { subject: `Your copy of the ESC ${COLLECTION_NOTICE_TITLE}`, heading: COLLECTION_NOTICE_TITLE, blocks };
}

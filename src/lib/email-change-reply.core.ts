// Decision 337 (Jo, 25 Oct 2026): a MATCHED owner emails asking to change a visit day/time or to cancel → instead of
// the decision-245 Apply/Ignore row, they get ONE automatic reply (sent, not drafted) with their own secure My job link
// opening on the screen where that visit can be changed; the existing owner flows then tell the installer/electrician.
// Cancels the owner cannot do themselves (My job's `ownerCanCancel` says no) keep ONE office row and the reply says
// "or reply to this email and we'll sort it out with you". Pure rules + wording only: nothing is read, sent or written here.
// Wording (approved route, Jo 25 Oct 2026): subject "Re: {their subject}"; body "Hi {first name}, no problem. You can
// change your {visit} here and {who} will be told straight away: {link}. If you'd rather cancel, you can do that on the
// same page{cancel_note}. — Home Insulation Victoria". Design (MJML refresh, Jo 26 Oct 2026): the same words in short
// sentences with a "Change my {visit}" button and the full link under it (docs/templates/mjml/owner_change-reply.mjml).
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";
import { newSenderFirstName, newSenderReplySubject } from "./new-sender-reply.core";
import type { OwnerScreen } from "./owner-myjob.core";

/** Decision 337 wording is approved (route given by Jo). Real delivery still needs customer_comms_enabled + consent. */
export const EMAIL_CHANGE_REPLY_APPROVED = true as boolean;
/** ONE per job + email message, written before the send (the claim). */
export const EMAIL_CHANGE_REPLIED_EVENT = "email_change_replied";
/** Written when the claimed reply could not go (held / failed): the office row is then raised as before. */
export const EMAIL_CHANGE_REPLY_HELD_EVENT = "email_change_reply_held";
export const EMAIL_CHANGE_REPLY_PURPOSE = "email_change_reply";
export const EMAIL_CHANGE_REPLY_TEMPLATE = "D337";

export type ChangeVisit = "ready_check" | "piesa" | "install";

export const CHANGE_VISIT: Record<ChangeVisit, { visit: string; who: string; screen: OwnerScreen }> = {
  ready_check: { visit: "Ready Check visit", who: "your installer", screen: "home" },
  piesa: { visit: "electrical safety check", who: "your electrician", screen: "book" },
  install: { visit: "install day", who: "your installer", screen: "book" },
};

/** Stages where each visit is the one being arranged. Rectification (fixes) visits stay with the office (reopenPlan). */
export const READY_CHECK_CHANGE_STAGES: ReadonlySet<string> = new Set(["ready_check_awaiting_acceptance", "ready_check_ready_to_schedule", "ready_check_scheduled"]);
export const PIESA_CHANGE_STAGES: ReadonlySet<string> = new Set(["measured_quote_accepted", "piesa_and_install_window_pending", "piesa_scheduled"]);
export const INSTALL_CHANGE_STAGES: ReadonlySet<string> = new Set(["piesa_complete", "installation_scheduling", "installation_booked"]);

/** Whether My job can actually change each visit right now (read by the server from the owner screens' own state). */
export type VisitAvailability = { readyCheck: boolean; piesa: boolean; install: boolean };

/** The visit an owner's "change the day / cancel" email is about, from the job stage — only when My job can change it. */
export function visitForStage(stage: string | null | undefined, avail: VisitAvailability): ChangeVisit | null {
  const s = stage ?? "";
  if (READY_CHECK_CHANGE_STAGES.has(s)) return avail.readyCheck ? "ready_check" : null;
  if (PIESA_CHANGE_STAGES.has(s)) return avail.piesa ? "piesa" : null;
  if (INSTALL_CHANGE_STAGES.has(s)) return avail.install ? "install" : null;
  return null;
}

/** The visit group a stage belongs to (to know which owner state to read), before availability is known. */
export function visitGroupForStage(stage: string | null | undefined): ChangeVisit | null {
  return visitForStage(stage, { readyCheck: true, piesa: true, install: true });
}

/** The owner's own secure My job link, opening on the screen for that visit ("home" = no screen param). */
export function changeVisitLink(myJobLink: string, visit: ChangeVisit): string {
  const base = myJobLink.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const screen = CHANGE_VISIT[visit].screen;
  return screen === "home" ? base : `${base}?screen=${screen}`;
}

export const CANCEL_NOTE_REPLY = ", or reply to this email and we'll sort it out with you";
/** {cancel_note}: empty when the owner can cancel on My job themselves (ownerCanCancel), else the reply-to-us note. */
export function cancelNote(ownerCanSelfCancel: boolean): string {
  return ownerCanSelfCancel ? "" : CANCEL_NOTE_REPLY;
}

/** Idempotency: one reply per job + email message, ever. */
export function changeReplyKey(jobId: string, messageId: string): string {
  return `email-change-reply:v1:${jobId}:${messageId}`;
}

export type ChangeReplyFacts = { firstName: string | null; visit: ChangeVisit; link: string; cancelNote: string };

export function changeReplySubject(theirSubject: string | null | undefined): string {
  return newSenderReplySubject(theirSubject);
}

/** First name: the owner's name on file, else the From display name; never an address or a company word. */
export function changeReplyFirstName(ownerFullName: string | null | undefined, fromName: string | null | undefined): string | null {
  return newSenderFirstName(ownerFullName) ?? newSenderFirstName(fromName);
}

const SIGN_OFF = "— Home Insulation Victoria";

/** The approved route's words in the design's short sentences (docs/templates/mjml/owner_change-reply.mjml). The
 *  {cancel_note} ", or reply to this email…" becomes its own sentence: "Or reply to this email…". */
export function changeReplyParagraphs(f: ChangeReplyFacts) {
  const v = CHANGE_VISIT[f.visit];
  const or = /^,\s*or\s+(.*)$/i.exec(f.cancelNote);
  return {
    greeting: `Hi ${f.firstName ?? "there"},`,
    headline: "No problem",
    change: `You can change your ${v.visit} on your job page. ${v.who.charAt(0).toUpperCase()}${v.who.slice(1)} will be told straight away.`,
    button: `Change my ${v.visit}`,
    cancel: or ? `If you'd rather cancel, you can do that on the same page. Or ${or[1]}.` : `If you'd rather cancel, you can do that on the same page${f.cancelNote}.`,
    signOff: SIGN_OFF,
  };
}

/** The approved words as the plain-text body (same order as the email). */
export function changeReplyText(f: ChangeReplyFacts): string {
  const p = changeReplyParagraphs(f);
  return [p.greeting, "", p.headline, "", p.change, `${p.button}: ${f.link}`, "", p.cancel, "", p.signOff].join("\n");
}

export function renderChangeReplyEmail(i: ChangeReplyFacts & { theirSubject: string | null; unsubscribe?: string | null; test?: boolean }) {
  const p = changeReplyParagraphs(i);
  const v = CHANGE_VISIT[i.visit];
  const preview = `You can change your ${v.visit} on your job page, and ${v.who} is told straight away.`;
  const subject = changeReplySubject(i.theirSubject);
  const body = `<mj-section><mj-column><mj-text mj-class="hi">${esc(p.greeting)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(p.headline)}</mj-text><mj-text>${esc(p.change)}</mj-text><mj-button href="${esc(i.link)}">${esc(p.button)}</mj-button><mj-text mj-class="small" padding="0 12px 14px">Or open this link: <a href="${esc(i.link)}" style="color:#3C51C4;font-weight:700;word-break:break-all;">${esc(i.link)}</a></mj-text><mj-text>${esc(p.cancel)}</mj-text><mj-text padding="0 12px 0">${esc(p.signOff)}</mj-text></mj-column></mj-section>`;
  return {
    subject,
    html: mjEmail({ subject, preview, body, unsubscribe: i.unsubscribe ?? null, testLabel: i.test === true }),
    text: K.plainText([changeReplyText(i)], { testLabel: i.test === true, unsubscribe: i.unsubscribe ?? null }),
  };
}

export type ChangeReplyInput = {
  intent: string;
  jobIds: string[];
  /** The sender's address is the job owner's email on file (a matched owner, not a partner or someone else). */
  senderIsOwner: boolean;
  fromPartner: boolean;
  testJob: boolean;
  stage: string | null;
  avail: VisitAvailability;
  ownerCanSelfCancel: boolean;
  hasLink: boolean;
  /** An earlier `email_change_replied` claim for this job + message: sent = it went, held = it didn't. */
  prior: "none" | "sent" | "held";
};

export type ChangeReplyPlan =
  | { kind: "reply"; visit: ChangeVisit; cancelNote: string; keepOfficeRow: boolean }
  | { kind: "already"; keepOfficeRow: boolean }
  | { kind: "office"; reason: string };

/** Decide whether an owner's change/cancel email gets the automatic reply. Anything uncertain = the office row as before. */
export function planChangeReply(i: ChangeReplyInput): ChangeReplyPlan {
  if (i.intent !== "reschedule" && i.intent !== "cancel") return { kind: "office", reason: "not a date/time change or cancel" };
  if (i.jobIds.length !== 1) return { kind: "office", reason: "the email matches more than one job" };
  if (i.fromPartner || !i.senderIsOwner) return { kind: "office", reason: "the sender is not the owner on file" };
  const keepOfficeRow = i.intent === "cancel" && !i.ownerCanSelfCancel;
  if (i.prior === "sent") return { kind: "already", keepOfficeRow };
  if (i.prior === "held") return { kind: "office", reason: "the automatic reply was held earlier" };
  const visit = visitForStage(i.stage, i.avail);
  if (!visit) return { kind: "office", reason: "no visit the owner can change on My job at this stage" };
  if (!i.hasLink) return { kind: "office", reason: "no working secure My job link" };
  return { kind: "reply", visit, cancelNote: cancelNote(i.ownerCanSelfCancel), keepOfficeRow };
}

export type ChangeReplyMode = { mode: "test_send" } | { mode: "live" } | { mode: "held"; reason: string };

/** TEST jobs → test-send only; real owners → only with the approved flag and customer_comms_enabled. */
export function changeReplyMode(i: { testJob: boolean; approved: boolean; commsEnabled: boolean | null }): ChangeReplyMode {
  if (i.testJob) return { mode: "test_send" };
  if (!i.approved) return { mode: "held", reason: "the automatic reply is not switched on" };
  if (i.commsEnabled !== true) return { mode: "held", reason: "customer comms are switched off" };
  return { mode: "live" };
}

/** Re-exported: the copier's rule lives with the decision-245 classifier (harness-loadable). */
export { officeRowNeeded } from "./email-intent.core";

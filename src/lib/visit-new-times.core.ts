// Decision 376 (Jo 25 Oct 2026, DRAFT — awaiting approval): when the TRADE cancels a booked Ready Check, safety check or
// install day (visit-events.server `tradeCancelVisit` → `reopen`, which records `visit_times_reopened`), the owner is told
// ONCE — email O74 + text — with their own secure My job link on the right screen. Two variants, read from what My job
// actually lets the owner do after the cancel: "choose new times" (the owner's picker is open) or "you don't need to do
// anything — new times are on the way" (the trade offers the new times, decisions 53/333 and install days).
// Owner reschedules / no-shows are NOT told here (they made the change, or the existing one-free-rebook rules apply), and
// an electrical fixes visit goes to the office (reopenPlan). Replaces the F13 record-only point; nothing goes to a real
// owner until Jo approves (VISIT_NEW_TIMES_APPROVED + the `visit_new_times` SMS type). PURE: wording, keys, links.
import * as K from "./email-kit.core";
import { changeVisitLink, type ChangeVisit } from "./email-change-reply.core";
import { melbourneClock, melbourneDayDate } from "./installer-texts.core";
import type { VisitKind } from "./visit-events.core";

/** DRAFT (decision 376): false until Jo approves O74 and the text. Real delivery also needs customer_comms_enabled + consent. */
export const VISIT_NEW_TIMES_APPROVED = false as boolean;
export const VISIT_NEW_TIMES_TEMPLATE_CODE = "O74";
export const VISIT_NEW_TIMES_SMS_TYPE = "visit_new_times" as const;
export const VISIT_NEW_TIMES_PURPOSE = "visit_new_times";
/** Recorded ONCE per cancelled booking BEFORE anything is sent (details: { booking_id, kind, owner_picks }). */
export const VISIT_NEW_TIMES_EVENT = "visit_new_times_notice";

/** Visits this notice covers (rectification is arranged by the office after a cancel). */
export type NewTimesVisit = Exclude<VisitKind, "rectification">;
export const isNewTimesVisit = (k: VisitKind): k is NewTimesVisit => k !== "rectification";

const VISIT: Record<NewTimesVisit, { name: string; who: string; change: ChangeVisit; offers: string }> = {
  ready_check: { name: "Ready Check visit", who: "your installer", change: "ready_check", offers: "Your installer will offer you new times" },
  assessment: { name: "electrical safety check", who: "the electrician", change: "piesa", offers: "An electrician will offer you new times" },
  installation: { name: "install day", who: "your installer", change: "install", offers: "Your installer will offer you new install days" },
};

/** One email + one text per cancelled booking, ever. */
export function visitNewTimesKeys(jobId: string, bookingId: string) {
  const base = `visit-new-times:v1:${jobId}:${bookingId}`;
  return { email: `${base}:email`, sms: `${base}:sms` };
}

/** The owner's My job link on the screen for this visit (Ready Check → home; safety check / install → ?screen=book). */
export function visitNewTimesLink(myJobLink: string, kind: NewTimesVisit): string {
  return changeVisitLink(myJobLink, VISIT[kind].change);
}

export type VisitNewTimesFacts = {
  kind: NewTimesVisit;
  /** The cancelled booking's start (ISO). */
  wasIso: string;
  /** True when My job lets the owner pick new times right now; false when the trade offers them. */
  ownerPicks: boolean;
  link: string;
};

/** O74 text (the sender adds "Home Insulation Victoria: "). */
export function visitNewTimesText(f: VisitNewTimesFacts): string {
  const v = VISIT[f.kind];
  const lead = `Sorry, ${v.who} can't make your ${v.name} on ${melbourneDayDate(f.wasIso)} any more.`;
  return f.ownerPicks
    ? `${lead} Please choose new times here: ${f.link} Reply STOP to opt out.`
    : `${lead} You don't need to do anything – we'll send you new times soon. Your job: ${f.link} Reply STOP to opt out.`;
}

export type VisitNewTimesEmailInput = VisitNewTimesFacts & { firstName: string | null; unsubscribeUrl: string | null; test?: boolean };

/** O74 wording: an apology, the old date struck through, one clear next step. */
export function visitNewTimesCopy(f: Pick<VisitNewTimesFacts, "kind" | "wasIso" | "ownerPicks">) {
  const v = VISIT[f.kind];
  const day = melbourneDayDate(f.wasIso), time = melbourneClock(f.wasIso);
  const subject = f.ownerPicks ? `Your ${v.name} needs a new time` : `Your ${v.name} is moving`;
  const lead = `Sorry — ${v.who} can't make your ${v.name} on ${day} any more.`;
  const next = f.ownerPicks
    ? "Please choose some new times on your job page. It only takes a minute."
    : `You don't need to do anything. ${v.offers} soon and we'll send you a link to choose one.`;
  const button = f.ownerPicks ? "Choose new times" : "See my job";
  return { subject, headline: subject, lead, was: `${day}, ${time}`, next, button };
}

export function renderVisitNewTimesEmail(i: VisitNewTimesEmailInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const c = visitNewTimesCopy(i);
  const hi = `Hi ${first},`;
  const card = K.mistBox("No longer going ahead", `<div style="font-size:16px;color:${K.KIT.SUB};text-decoration:line-through;">${K.esc(c.was)}</div>`, { marginTop: 4 });
  const body = [K.h1(c.headline, 8), K.p(hi, "0 0 8px"), K.p(c.lead), card, K.p(c.next, "16px 0 0"), K.button(i.link, c.button), K.small("Questions? Just reply to this email.")].join("\n");
  const html = K.emailShell({ body, previewText: c.lead, testLabel: i.test === true, unsubscribe: i.unsubscribeUrl });
  const text = K.plainText([c.headline, "", hi, "", c.lead, `No longer going ahead: ${c.was}`, "", c.next, "", `${c.button}: ${i.link}`, "", "Questions? Just reply to this email."], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject: c.subject, html, text };
}

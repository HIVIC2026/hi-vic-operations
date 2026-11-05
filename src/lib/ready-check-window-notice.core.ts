// G8 (4), 4 Nov 2026 — LOOKS WRONG (1): on an A2 run the installer picks the run day, the portal proposes a 1-hour Ready
// Check window and the OWNER must confirm it on their link (?screen=book). The old owner window text (`run_time`) was
// retired on 2 Nov 2026 (SoT: owners are told the installer will call), so nothing told the owner about the window. This
// is the DRAFT message that invites them — one text + one email, behind OWNER_WINDOW_CONFIRM_APPROVED (false until Jo
// approves the picture). PURE: wording and keys only; the sender is installer-run.server (textSlot / emailSlot).
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";

/** DRAFT: real owners get nothing until Jo approves; TEST jobs → test-send. */
export const OWNER_WINDOW_CONFIRM_APPROVED = false as boolean;
export const READY_CHECK_WINDOW_SMS_TYPE = "ready_check_window" as const;
export const READY_CHECK_WINDOW_EMAIL_PURPOSE = "ready_check_window";
export const readyCheckWindowEmailKey = (runId: string, jobId: string, seq: number) => `ready-check-window-email:v1:${runId}:${jobId}:${seq}`;

const first = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "there";

export type WindowNoticeFacts = { name: string | null | undefined; day: string; time: string; installer: string; link: string; team: boolean };

/** DRAFT text (Jo's 30 Oct 2026 run_time words, re-listed because that type was retired): "…is Tuesday 27 October between
 *  9:00 and 10:00am with Rapid Insulation. Tap to confirm or pick another time: {link}". A team-entered exact time offers
 *  no other times. */
export const readyCheckWindowText = (f: WindowNoticeFacts) =>
  `Home Insulation Victoria: Hi ${first(f.name)}, your free Ready Check is ${f.day} ${f.time} with ${f.installer}. ${f.team ? "Tap to confirm" : "Tap to confirm or pick another time"}: ${f.link}`;

/** DRAFT email, suite look (Jo 5 Nov 2026): greeting line, big heading "Your free Ready Check: {day}", the window, who is
 *  coming, one Confirm button, then a "What to expect" card (the approved Ready Check sentence from the will-call email). */
export const READY_CHECK_WINDOW_EXPECT_TITLE = "What to expect";
export const READY_CHECK_WINDOW_EXPECT_LINE = "At the Ready Check they'll measure up and confirm your quote. It's free, with no obligation.";
export function readyCheckWindowEmail(f: WindowNoticeFacts, opts: { test?: boolean } = {}): { subject: string; html: string; text: string } {
  const hi = `Hi ${K.cleanName(f.name) || "there"},`;
  const subject = `Your free Ready Check: ${f.day}`;
  const line1 = `${f.installer} can do your free Ready Check ${f.day} ${f.time}.`;
  const line2 = f.team ? "Tap Confirm if that works. If it doesn't, tap Can't make it and we'll find another time." : "Tap Confirm if that works, or pick another time on the same day.";
  const button = "Confirm my Ready Check";
  const body = [
    `<mj-section><mj-column><mj-text mj-class="hi">${K.esc(hi)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${K.esc(subject)}</mj-text><mj-text>${K.esc(line1)}</mj-text><mj-text>${K.esc(line2)}</mj-text><mj-button href="${K.esc(f.link)}">${K.esc(button)}</mj-button></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 6px">${K.esc(READY_CHECK_WINDOW_EXPECT_TITLE)}</mj-text><mj-text padding="0 18px 16px">${K.esc(READY_CHECK_WINDOW_EXPECT_LINE)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview: line1, body, unsubscribe: null, testLabel: opts.test === true });
  const text = K.plainText([hi, "", subject, "", line1, line2, "", `${button}: ${f.link}`, "", READY_CHECK_WINDOW_EXPECT_TITLE.toUpperCase(), READY_CHECK_WINDOW_EXPECT_LINE], { testLabel: opts.test === true });
  return { subject, html, text };
}

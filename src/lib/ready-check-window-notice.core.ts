// G8 (4), 4 Nov 2026 — LOOKS WRONG (1): on an A2 run the installer picks the run day, the portal proposes a 1-hour Ready
// Check window and the OWNER must confirm it on their link (?screen=book). The old owner window text (`run_time`) was
// retired on 2 Nov 2026 (SoT: owners are told the installer will call), so nothing told the owner about the window. This
// is the DRAFT message that invites them — one text + one email, behind OWNER_WINDOW_CONFIRM_APPROVED (false until Jo
// approves the picture). PURE: wording and keys only; the sender is installer-run.server (textSlot / emailSlot).
import * as K from "./email-kit.core";
import { genericMail } from "./mail-mjml.core";

/** RETIRED (Jo 5 Nov 2026: "WE DON'T HAVE THE INSTALLER'S TIMES") — the portal never tells an owner a Ready Check time; the
 *  installer calls to book (2 Nov 2026 rule). Stays false for good: real owners never get these (TEST jobs still test-send). */
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
  `Hi ${first(f.name)}, your free Ready Check is ${f.day} ${f.time} with ${f.installer}. ${f.team ? "Tap to confirm" : "Tap to confirm or pick another time"}: ${f.link} - Home Insulation Victoria`;

/** DRAFT email: subject "Your free Ready Check: {day}", the window, who is coming, one Confirm button to ?screen=book. */
export function readyCheckWindowEmail(f: WindowNoticeFacts, opts: { test?: boolean } = {}): { subject: string; html: string; text: string } {
  const hi = K.cleanName(f.name) || "there";
  const subject = `Your free Ready Check: ${f.day}`;
  const line1 = `${f.installer} can do your free Ready Check ${f.day} ${f.time}.`;
  const line2 = f.team ? "Tap Confirm if that works. If it doesn't, tap Can't make it and we'll find another time." : "Tap Confirm if that works, or pick another time on the same day.";
  const html = genericMail({ subject, heading: subject, lines: [`Hi ${hi},`, line1, line2], button: { label: "Confirm my Ready Check", url: f.link }, preview: line1, unsubscribe: null, testLabel: opts.test === true });
  const text = K.plainText([subject, "", `Hi ${hi},`, line1, line2, "", `Confirm: ${f.link}`], { testLabel: opts.test === true });
  return { subject, html, text };
}

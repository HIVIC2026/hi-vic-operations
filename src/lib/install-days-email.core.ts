// Install day owner emails (Jo 24 Oct 2026, decisions 97 and 135).
// Retired 2 Nov 2026 (Part 4 Task 14): O33 "Pick your install day" (decision 96) — the installer calls the owner to book,
// the deposit is paid on the confirm-and-pay page before booking (answer 21), and "You're booked" confirms the day.
// "Install day changed" design approved: docs/templates/mjml/owner_O42.mjml — new day card with the old day crossed out,
// deposit still holds, Change day, See my job. Neither has a live sender yet (the consent + Stripe deposit steps are
// being built): it goes through approved-owner-emails.server.ts; INSTALL_DAYS_EMAIL_APPROVED is on (decision 135) and
// real delivery still needs customer_comms_enabled. Pure.
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";
import { splitDayTime } from "./ready-check-times-email.core";

/** Jo 24 Oct 2026, decision 135 (O42 install day changed): approved. Delivery still behind customer_comms_enabled. */
export const INSTALL_DAYS_EMAIL_APPROVED = true as boolean;

export type InstallDayChangedInput = {
  firstName: string | null; installerName: string | null; installerPhone?: string | null; address?: string | null;
  /** New "Thursday 13 November at 7:30am" and previous day/time. */
  when: string; was: string; myJobUrl: string; test?: boolean;
};

export function renderInstallDayChangedEmail(i: InstallDayChangedInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const installer = i.installerName?.trim() || "Your installer";
  const phone = i.installerPhone?.trim() || null;
  const subject = `Your install has moved to ${i.when}`;
  const headline = `${first}, your install day has changed`;
  const intro = `${installer} needed to move your install. Here's the new day and time. Everything else stays the same, and your deposit still holds your booking.`;
  const preview = `${installer} needed to move it. Everything else stays the same.`;
  const { day, time } = splitDayTime(i.when);
  const was = splitDayTime(i.was);
  const wasText = `${was.day}${was.time ? `, ${was.time}` : ""}`;
  const lines = [i.address?.trim() || null, i.installerName?.trim() ? `Installer: ${i.installerName.trim()}${phone ? ` · ${phone}` : ""}` : null].filter((l): l is string => !!l);
  const suit = `Doesn't suit? Tap Change day on your job page and ${installer} will offer other days.`;
  const power = `Remember, the power will be off while they work. The "On the day" checklist from your booking email still applies.`;
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">New install day</mj-text><mj-text mj-class="center" font-family="Outfit, Figtree, -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif" font-size="24px" line-height="30px" font-weight="800" padding="0 12px 2px">${esc(day)}</mj-text>${time ? `<mj-text mj-class="center" font-weight="700" padding="0 12px 6px">Arriving ${esc(time)}</mj-text>` : ""}<mj-text mj-class="small center" padding="0 16px ${lines.length ? 8 : 18}px">Was <span class="strike">${esc(wasText)}</span></mj-text>${lines.length ? `<mj-text mj-class="small center" padding="0 16px 18px">${lines.map(esc).join("<br />")}</mj-text>` : ""}</mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text padding="16px 12px 14px">${esc(suit)}</mj-text><mj-text>${esc(power)}</mj-text><mj-text mj-class="small" padding="0 12px">Questions? Just reply to this email.</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([headline, "", intro, "", `New install day: ${i.when}`, `Was: ${i.was}`, ...lines, "", suit, power,  "", "Questions? Just reply to this email."], { testLabel: i.test === true });
  return { subject, html, text };
}

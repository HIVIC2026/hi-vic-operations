// Install day owner emails (Jo 24 Oct 2026, decisions 96, 97 and 135).
// "Pick your install day" design approved: docs/templates/mjml/owner_O33.mjml — safety check clear,
// {Installer} offered these days; day rows with a Pick link; Suggest other days; "Lock in your day": sign the install
// consent, 10% deposit (held 48 hours), rest on install day or pay in full now; install-by date in its own box.
// "Install day changed" design approved: docs/templates/mjml/owner_O42.mjml — new day card with the old day crossed out,
// deposit still holds, Change day, See my job. Neither has a live sender yet (the consent + Stripe deposit steps are
// being built): both go through approved-owner-emails.server.ts; INSTALL_DAYS_EMAIL_APPROVED is on (decisions 96/135) and
// real delivery still needs customer_comms_enabled. Pure.
import { myJobScreen } from "./mail-mjml.core";
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";
import { splitDayTime, type ReadyCheckTimeSlot } from "./ready-check-times-email.core";

/** Jo 24 Oct 2026, decisions 96 (O33 pick your install day) and 135 (O42 install day changed): approved. Delivery still behind customer_comms_enabled. */
export const INSTALL_DAYS_EMAIL_APPROVED = true as boolean;

export type InstallDaysEmailInput = {
  firstName: string | null; installerName: string | null; days: Array<string | ReadyCheckTimeSlot>; myJobUrl: string;
  /** Owner's remaining balance after the safety check payment (deposit = 10%). */
  balanceIncGst: number | null;
  /** "4 December" — 30 days after the safety check. */
  installBy: string | null; test?: boolean;
};

const dayRow = (s: { day: string; time: string; href: string }, first: boolean) => {
  const border = first ? "" : "border-top:1px solid #E4E9F5;";
  return `<tr><td style="padding:12px 0;${border}"><a href="${esc(s.href)}" style="color:#22376B;text-decoration:none;"><strong>${esc(s.day)}</strong>${s.time ? `<br /><span class="muted">${esc(s.time)}</span>` : ""}</a></td><td align="right" style="padding:12px 0;${border}"><a href="${esc(s.href)}" style="color:#3C51C4;font-weight:700;text-decoration:none;white-space:nowrap;">Pick &#8250;</a></td></tr>`;
};

export function renderInstallDaysEmail(i: InstallDaysEmailInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const installer = i.installerName?.trim() || "Your installer";
  const subject = `${first}, pick your install day`;
  const headline = subject;
  const intro = `Your safety check is all clear. ${installer} has offered these days for your insulation install. Tap the one that suits you.`;
  const pick = myJobScreen(i.myJobUrl, "book");
  const slots = i.days.map((t) => (typeof t === "string" ? splitDayTime(t) : t)).map((t) => ({ day: t.day, time: t.time, href: t.href || pick }));
  const deposit = i.balanceIncGst != null && i.balanceIncGst > 0 ? Math.round(i.balanceIncGst * 10) / 100 : null;
  const rest = deposit != null ? i.balanceIncGst! - deposit : null;
  const lock1 = `When you tap a day, you'll sign your install consent (the VEU program needs it)${deposit != null ? ` and pay a 10% deposit of ${K.cents(deposit)}` : " and pay a 10% deposit"}. That locks in your day. We hold it for 48 hours while you do this.`;
  const lock2 = `The rest${rest != null ? `, ${K.cents(rest)},` : ""} is due on install day. Or you can pay in full now.`;
  const byHtml = i.installBy ? `<strong>Your install must happen by ${esc(i.installBy)}</strong>, 30 days after your safety check.` : `<strong>Your install must happen within 30 days of your safety check.</strong>`;
  const preview = `Your safety check is all clear. ${installer} has offered ${slots.length === 3 ? "three days" : "these days"} – tap the one that suits you.`;
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="eyebrow" padding="18px 18px 4px">Days on offer</mj-text>${slots.length ? `<mj-table padding="0 18px 8px" font-size="16px">${slots.map((s, n) => dayRow(s, n === 0)).join("")}</mj-table>` : ""}<mj-text mj-class="small" padding="0 18px 16px">None suit? <a href="${esc(pick)}" style="color:#3C51C4;font-weight:700;">Suggest other days</a></mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text mj-class="h2" css-class="email-sub" padding="18px 12px 6px">Lock in your day</mj-text><mj-text>${esc(lock1)}</mj-text><mj-text>${esc(lock2)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-amber"><mj-text padding="18px 18px 16px">${byHtml}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([headline, "", intro, "", ...slots.map((s) => `• ${s.day}${s.time ? ` ${s.time}` : ""}`), `Pick a day: ${pick}`, `None suit? Suggest other days: ${pick}`, "", "LOCK IN YOUR DAY", lock1, lock2, "", K.stripTags(byHtml)], { testLabel: i.test === true });
  return { subject, html, text };
}

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
    `<mj-section><mj-column><mj-text padding="16px 12px 14px">${esc(suit)}</mj-text><mj-text>${esc(power)}</mj-text><mj-button href="${esc(i.myJobUrl)}">See my job</mj-button><mj-text mj-class="small" padding="0 12px">Questions? Just reply to this email.</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([headline, "", intro, "", `New install day: ${i.when}`, `Was: ${i.was}`, ...lines, "", suit, power, `See my job: ${i.myJobUrl}`, "", "Questions? Just reply to this email."], { testLabel: i.test === true });
  return { subject, html, text };
}

// Install day owner emails (Jo 24 Oct 2026, decisions 96, 97 and 135).
// "Pick your install day" design approved: docs/templates/owner/O33-install-days.html — safety check clear,
// {Installer} offered these days; 3 day+time buttons; Suggest other days; "Lock in your day": sign the install consent,
// 10% deposit (held 48 hours), rest on install day or pay in full now, install-by date.
// "Install day changed" design approved: O42-install-day-changed.html — new day card with the old day crossed out,
// deposit still holds, Change day, See my job. Neither has a live sender yet (the consent + Stripe deposit steps are
// being built): both go through approved-owner-emails.server.ts; INSTALL_DAYS_EMAIL_APPROVED is on (decisions 96/135) and
// real delivery still needs customer_comms_enabled. Pure.
import * as K from "./email-kit.core";
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

export function renderInstallDaysEmail(i: InstallDaysEmailInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const installer = i.installerName?.trim() || "Your installer";
  const subject = `${first}, pick your install day`;
  const headline = subject;
  const intro = `Your safety check is all clear. ${installer} has offered these days for your insulation install. Tap the one that suits you.`;
  const slots = i.days.map((t) => (typeof t === "string" ? splitDayTime(t) : t)).map((t) => ({ day: t.day, time: t.time, href: t.href || i.myJobUrl }));
  const deposit = i.balanceIncGst != null && i.balanceIncGst > 0 ? Math.round(i.balanceIncGst * 10) / 100 : null;
  const rest = deposit != null ? i.balanceIncGst! - deposit : null;
  const lockHtml = `When you tap a day, you'll sign your install consent (the VEU program needs it)${deposit != null ? ` and pay a 10% deposit of <strong>${K.esc(K.cents(deposit))}</strong>` : " and pay a 10% deposit"}. That locks in your day (we hold it for 48 hours while you do this). The rest${rest != null ? `, <strong>${K.esc(K.cents(rest))}</strong>,` : ""} is due on install day, or you can pay in full now.${i.installBy ? ` Your install must happen by <strong>${K.esc(i.installBy)}</strong>, 30 days after your safety check.` : " Your install must happen within 30 days of your safety check."}`;
  const body = [K.h1(headline), K.p(intro), K.tapTimeButtons(slots, { href: i.myJobUrl }), K.sectionTitle("Lock in your day"), K.p(lockHtml, "0 0 16px", true)].join("\n");
  const html = K.emailShell({ body, previewText: intro, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([headline, "", intro, "", ...slots.map((s) => `• ${s.day}${s.time ? ` ${s.time}` : ""}`), `Pick a day: ${i.myJobUrl}`, `None suit? Suggest other days: ${i.myJobUrl}`, "", "LOCK IN YOUR DAY", K.stripTags(lockHtml)], { testLabel: i.test === true });
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
  const { day, time } = splitDayTime(i.when);
  const was = splitDayTime(i.was);
  const lines = [i.address?.trim() || null, i.installerName?.trim() ? `Installer: ${i.installerName.trim()}${phone ? ` · ${phone}` : ""}` : null].filter((l): l is string => !!l);
  const suit = `Doesn't suit? Tap <strong>Change day</strong> on your job page and ${K.esc(installer)} will offer other days. Remember the power will be off while they work, and the "On the day" checklist from your booking email still applies.`;
  const body = [K.h1(headline, 8), K.p(intro), K.dateCard({ label: "New install day", day, time: time ? `Arriving ${time}` : "", was: `Was ${was.day}${was.time ? `, ${was.time}` : ""}`, lines }), K.p(suit, "16px 0 0", true), K.button(i.myJobUrl, "See my job"), K.small("Questions? Just reply to this email.")].join("\n");
  const html = K.emailShell({ body, previewText: intro, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([headline, "", intro, "", `New install day: ${i.when}`, `Was: ${i.was}`, ...lines, "", K.stripTags(suit), `See my job: ${i.myJobUrl}`, "", "Questions? Just reply to this email."], { testLabel: i.test === true });
  return { subject, html, text };
}

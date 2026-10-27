// Decision 376 (Jo 25 Oct 2026; wording APPROVED by Jo in decision 384): when the safety check (PIESA) is booked, the job's installer is
// told the date so they can plan install days — ONE email I71 + text per installer assignment and PIESA time (a moved
// safety check is a new notice). Planning only: it never books, offers or holds an install day, and it says plainly not to
// book yet — the approved I65 email + `install_clearance` text (decision 186) remain the "go: offer 3 install days" message
// once the job is cleared. Replaces the F13 record-only `installer_planning_notice` point (the dead outbox row). Approved
// (decision 384): real installers go through the guarded partner senders behind customer_comms_enabled + the text switch.
// Design (MJML refresh, Jo 26 Oct 2026): docs/templates/mjml/installer_I71.mjml. PURE: wording and keys.
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";
import { melbourneClock, melbourneDayDate } from "./installer-texts.core";

/** Jo 25 Oct 2026 (decision 384): I71 and the text approved as drafted in decision 376. Real delivery also needs customer_comms_enabled (+ the text switch). */
export const INSTALLER_PLANNING_NOTICE_APPROVED = true as boolean;
export const INSTALLER_PLANNING_NOTICE_TEMPLATE_CODE = "I71";
export const INSTALLER_PLANNING_NOTICE_SMS_TYPE = "installer_planning_notice" as const;
/** Recorded ONCE per installer assignment + PIESA start BEFORE anything is sent (details: { assignment_id, piesa_start, key }). */
export const INSTALLER_PLANNING_NOTIFIED_EVENT = "installer_planning_notified";

/** One email + one text per installer assignment + PIESA start (ms, so the same instant in any ISO spelling is one key). */
export function installerPlanningKeys(assignmentId: string, piesaStartIso: string) {
  const base = `installer-planning:v1:${assignmentId}:${Date.parse(piesaStartIso)}`;
  return { base, email: `${base}:email`, sms: `${base}:sms` };
}

export type InstallerPlanningFacts = { jobNumber: string; address: string | null; piesaStartIso: string; link: string };

/** Text (the sender adds "Home Insulation Victoria: "). One-off partner job text: no STOP line, same as `install_clearance`. */
export function installerPlanningText(f: InstallerPlanningFacts): string {
  return `${f.jobNumber}${f.address ? ` (${f.address})` : ""}: the safety check is booked for ${melbourneDayDate(f.piesaStartIso)}. For planning only – please don't book the install yet. We'll text you when it's cleared: ${f.link}`;
}

export function renderInstallerPlanningEmail(i: InstallerPlanningFacts & { ownerFirstName: string | null; test?: boolean }) {
  const owner = K.cleanName(i.ownerFirstName) ?? "the owner";
  const day = melbourneDayDate(i.piesaStartIso), time = melbourneClock(i.piesaStartIso);
  const subject = `${i.jobNumber}: safety check booked for ${day}`;
  const headline = `${i.jobNumber}: safety check booked`;
  const lead = `The electrical safety check for ${owner}${i.address ? ` at ${i.address}` : ""} is booked. This is a heads-up so you can plan your install days.`;
  const waitHead = "Please don't book the install yet.";
  const waitRest = "Once the safety check is passed (and any electrical fixes are done) we'll email and text you to offer the owner 3 install days.";
  const clock = "The install has to start within 30 days of the safety check, so it helps to pencil in a few days now.";
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${esc(lead)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Safety check</mj-text><mj-text mj-class="center" font-family="Outfit, Figtree, -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif" font-size="26px" line-height="32px" font-weight="800" color="#3C51C4" padding="0 12px 4px">${esc(day)}</mj-text><mj-text mj-class="center" font-weight="700" padding="0 12px 18px">Arriving ${esc(time)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-amber"><mj-text padding="18px 18px 10px"><strong>${esc(waitHead)}</strong> ${esc(waitRest)}</mj-text><mj-text padding="0 18px 18px">${esc(clock)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text padding="8px 0 0"></mj-text><mj-button href="${esc(i.link)}">See the job</mj-button></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview: "A heads-up so you can plan your install days. Please don't book the install yet.", body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([headline, "", lead, "", `Safety check: ${day}, arriving ${time}`, "", `${waitHead} ${waitRest}`, "", clock, "", `See the job: ${i.link}`], { testLabel: i.test === true });
  return { subject, html, text };
}

// Decision 376 (Jo 25 Oct 2026, DRAFT — awaiting approval): when the safety check (PIESA) is booked, the job's installer is
// told the date so they can plan install days — ONE email I71 + text per installer assignment and PIESA time (a moved
// safety check is a new notice). Planning only: it never books, offers or holds an install day, and it says plainly not to
// book yet — the approved I65 email + `install_clearance` text (decision 186) remain the "go: offer 3 install days" message
// once the job is cleared. Replaces the F13 record-only `installer_planning_notice` point (the dead outbox row); nothing
// goes to a real installer until Jo approves (INSTALLER_PLANNING_NOTICE_APPROVED + the SMS type). PURE: wording and keys.
import * as K from "./email-kit.core";
import { melbourneClock, melbourneDayDate } from "./installer-texts.core";

/** DRAFT (decision 376): false until Jo approves I71 and the text. Real delivery also needs customer_comms_enabled. */
export const INSTALLER_PLANNING_NOTICE_APPROVED = false as boolean;
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
  const wait = "Please don't book the install yet. Once the safety check is passed (and any electrical fixes are done) we'll email and text you to offer the owner 3 install days.";
  const clock = "The install has to start within 30 days of the safety check, so it helps to pencil in a few days now.";
  const body = [
    K.h1(headline, 8),
    K.p(lead),
    K.dateCard({ label: "Safety check", day, time: `Arriving ${time}`, lines: [] }),
    K.p(wait, "16px 0 0"),
    K.p(clock),
    K.button(i.link, "See the job"),
  ].join("\n");
  const html = K.emailShell({ body, previewText: lead, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([headline, "", lead, "", `Safety check: ${day}, arriving ${time}`, "", wait, "", clock, "", `See the job: ${i.link}`], { testLabel: i.test === true });
  return { subject, html, text };
}

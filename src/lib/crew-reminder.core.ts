// Jo 28 Oct 2026: crew reminder. At 2pm Melbourne time the day before a booked install, if no crew has been picked
// (no `piisa_crew_selected` event), ONE email goes to the installing business's own email. Once per job + install date.
// Draft wording: real sends stay off until Jo approves the rendered email.

export const CREW_REMINDER_EMAIL_APPROVED = false as boolean;
export const CREW_REMINDER_EVENT = "crew_reminder_email";
export const CREW_REMINDER_HOUR = 14;
const TZ = "Australia/Melbourne";

function melbourneParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p["year"]}-${p["month"]}-${p["day"]}`, hour: Number(p["hour"]) };
}

/** Install date (Melbourne) of a booking start. */
export const installDateOf = (startIso: string) => melbourneParts(new Date(startIso)).date;

function dayBefore(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Due from 2pm Melbourne on the day before the install, until the install starts. */
export function crewReminderDue(installStartIso: string, now: Date): boolean {
  const start = new Date(installStartIso);
  if (!(start.getTime() > now.getTime())) return false;
  const n = melbourneParts(now);
  return n.date === dayBefore(installDateOf(installStartIso)) && n.hour >= CREW_REMINDER_HOUR;
}

export const crewReminderKey = (jobId: string, installDate: string) => `crew-reminder:${jobId}:${installDate}`;

export function crewReminderEmail(i: { shortAddress: string; address: string; jobLink: string }) {
  return {
    subject: `Pick the crew for tomorrow's install – ${i.shortAddress}`,
    body: `Tomorrow's install at ${i.address} has no Lead installer or crew picked yet. Please pick them on the job page so everyone gets their safety plan and the Mitti form is ready: ${i.jobLink}`,
  };
}

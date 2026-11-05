// New job flow, Part 6, Task 4: the electrician's "PIESA booked" email (decision #39, Jo 2 Nov 2026, elec-both2.png).
// Wording is verbatim from docs/hiv-touchpoint-decisions-2026-11-02.md (the last line follows the plan: "…then update it on the job.").
// It replaces the earlier plain-sentence email only when PIESA_BOOKED_EMAIL_APPROVED is true; same purpose, same once-only key,
// so one booking is only ever one version. The "update it on the job" words link to the electrician's /e/ job link when there is one.
import { genericMail, esc } from "./mail-mjml.core";
import * as K from "./email-kit.core";

/** Stays false until Jo OKs the picture. While false the earlier email (to the worker) keeps going. */
export const PIESA_BOOKED_EMAIL_APPROVED = true as boolean; // ON 5 Nov 2026 10:52
/** Task 9 (Jo 2 Nov 2026, answer 7): the "Lets you in" row and the change line naming that person. DRAFT: while false the
 *  email is exactly Task 4's, whatever the caller passes; the job link shows the person regardless. */
export const ELECTRICIAN_ACCESS_ROWS_APPROVED = false as boolean;

export type ElectricianPiesaBookedInput = {
  jobNumber: string; firstName: string | null; startIso: string; address: string;
  owner: { name: string; phone: string | null };
  mittiUrl: string | null;
  /** The electrician's no-login job link (`/e/{token}`), when one could be made. */
  jobUrl?: string | null;
  /** Task 9: who lets the trades in when it isn't the owner (a tenant or the property manager). Shown only with ELECTRICIAN_ACCESS_ROWS_APPROVED. */
  access?: { name: string; role: string; phone: string } | null;
  test?: boolean;
};

/** "Fri 6 Nov" and "10:00am" in Melbourne time. */
export function melbourneDayAndTime(iso: string): { day: string; time: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { day: `${p["weekday"]} ${p["day"]} ${p["month"]}`, time: `${p["hour"]}:${p["minute"]}${String(p["dayPeriod"]).toLowerCase().replace(/\./g, "")}` };
}

/** The copy we keep on the job: the link token is the only credential, so the path is masked ("…/e/••••"). */
export const maskPiesaBookedLink = (s: string) => s.replace(/(\/e\/)[^\s"'<>]+/g, "$1••••");

export function renderElectricianPiesaBooked(i: ElectricianPiesaBookedInput, opts: { accessRowsApproved?: boolean } = {}): { subject: string; html: string; text: string } {
  const { day, time } = melbourneDayAndTime(i.startIso);
  const subject = `${i.jobNumber}: PIESA booked, ${day} ${time}`;
  const greeting = i.firstName?.trim() ? `Hi ${i.firstName.trim()},` : "Hi,";
  const heading = `PIESA booked: ${i.jobNumber}`;
  const ownerLine = [i.owner.name, i.owner.phone?.trim()].filter(Boolean).join(", ");
  // Task 9 (DRAFT, flag off = Task 4's email exactly): the person who lets the electrician in, and the change line names them.
  const access = (opts.accessRowsApproved ?? ELECTRICIAN_ACCESS_ROWS_APPROVED) && i.access?.name?.trim() ? i.access : null;
  const rows: [string, string][] = [["Day", day], ["Arriving", time], ["Address", i.address], ["Owner", ownerLine], ...(access ? [["Lets you in", `${access.name.trim()} (${access.role}), ${access.phone.trim()}`] as [string, string]] : [])];
  const label = "Open the Mitti form";
  const change = `Need to change the time? Call ${access ? access.name.trim() : i.owner.name}, then update it on the job.`;
  const table = `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#667;">${esc(k)}</td><td style="padding:2px 0;"><strong>${esc(v)}</strong></td></tr>`).join("")}</table>`;
  const jobUrl = i.jobUrl?.trim() || null;
  const changeHtml = jobUrl ? `${esc(change.replace(/update it on the job\.$/, ""))}<a href="${esc(jobUrl)}">update it on the job</a>.` : esc(change);
  const html = genericMail({ subject, heading, bodyHtml: `${esc(greeting)}<br /><br />${table}`, ...(i.mittiUrl ? { button: { url: i.mittiUrl, label } } : {}), afterButtonHtml: changeHtml, testLabel: i.test === true });
  const text = K.plainText([greeting, "", heading, "", ...rows.map(([k, v]) => `${k}: ${v}`), ...(i.mittiUrl ? ["", `${label}: ${i.mittiUrl}`] : []), "", change, ...(jobUrl ? [jobUrl] : [])], { testLabel: i.test === true });
  return { subject, html, text };
}

// Plan 2026-11-02 (Jo): when Jo taps "Give {n} jobs to {Installer}", the installer's office gets ONE email for that tap
// listing every job given. Pure: wording, lines, key and the notice words. The sender is in-house-give-email.server.ts.
// Real installers get nothing until Jo approves the wording in Templates (IN_HOUSE_GIVE_EMAIL_APPROVED); TEST partners
// always go through test-send.
import { displayName } from "./display-name.core";
import { jobDetails, partnerEmailLayout, partnerHi, type PartnerBlock } from "./partner-email.core";
import { PHOTO_QUOTE_WORDS, type QuoteMethod } from "./photo-quote.core";
import { SET_PASSWORD_BASE } from "./set-password-link.core";

/** Off until Jo approves the rendered email in Templates (Waiting for Jo's approval). */
export const IN_HOUSE_GIVE_EMAIL_APPROVED: boolean = true; // Jo 6 Nov 2026: on

export const IN_HOUSE_GIVE_EMAIL_SUBJECT = "New free Ready Check jobs from Home Insulation Victoria";
export const IN_HOUSE_GIVE_CALL_LINE = "Call each owner to book their free Ready Check.";

export type GiveEmailJob = { jobId: string; jobNumber: string; ownerName: string | null; ownerMobile: string | null; address: string | null; /** Jo 5 Nov 2026: what the owner told us (website + quick taps) — insulation as they described it, the size they gave. Rows with no answer are left out. */ ownerSaid?: [label: string, value: string | null][] | null };

/** "HV-2730 · Wayne Wilson · 0412 000 000 · 1 Example St, Clayton 3168"; gaps say so in words, never null/undefined. */
export function giveEmailLine(j: GiveEmailJob): string {
  const number = (j.jobNumber ?? "").trim() || "Job";
  const owner = displayName(j.ownerName) || "Owner";
  const mobile = (j.ownerMobile ?? "").trim() || "no mobile on file";
  const address = (j.address ?? "").replace(/\s+/g, " ").trim() || "address not recorded";
  return `${number} · ${owner} · ${mobile} · ${address}`;
}

export const IN_HOUSE_GIVE_EMAIL_HEADING = "New free Ready Check jobs";
/** Photo-quote installers (Jo 5 Nov 2026, spec PR #126 row): the From photos version. DRAFT, off until Jo approves it. */
export const IN_HOUSE_PHOTO_GIVE_EMAIL_APPROVED: boolean = false;
export const IN_HOUSE_PHOTO_GIVE_EMAIL_SUBJECT = "New photo quote jobs from Home Insulation Victoria";
export const IN_HOUSE_PHOTO_GIVE_EMAIL_HEADING = "New photo quote jobs";
export const IN_HOUSE_PHOTO_GIVE_BUTTON = "Open the job";
/** One email for one Give — suite look (Jo 5 Nov 2026): greeting, heading, one job card per job (job, owner, mobile, address),
 *  then the approved call line in a box. No other words. `test` adds the TEST label (test-send only). */
export function renderInHouseGiveEmail(i: { jobs: GiveEmailJob[]; contactName?: string | null; test?: boolean; method?: QuoteMethod | undefined; appBase?: string | undefined }): { subject: string; html: string; text: string } {
  if (i.method === "photos") return renderPhotoGiveEmail(i);
  const card = (j: GiveEmailJob): PartnerBlock =>
    jobDetails({ jobNumber: (j.jobNumber ?? "").trim() || "Job", owner: displayName(j.ownerName) || "Owner", mobile: (j.ownerMobile ?? "").trim() || "no mobile on file", address: (j.address ?? "").replace(/\s+/g, " ").trim() || "address not recorded" }, j.ownerSaid ?? []);
  const blocks: PartnerBlock[] = [partnerHi(i.contactName), ...i.jobs.map(card), { kind: "box", text: IN_HOUSE_GIVE_CALL_LINE }];
  const { html, text } = partnerEmailLayout({ subject: IN_HOUSE_GIVE_EMAIL_SUBJECT, heading: IN_HOUSE_GIVE_EMAIL_HEADING, preview: IN_HOUSE_GIVE_CALL_LINE, blocks, test: i.test === true });
  return { subject: IN_HOUSE_GIVE_EMAIL_SUBJECT, html, text };
}

/** From photos: one card per job with a button to the installer's job page, then the 2-business-day due line. */
function renderPhotoGiveEmail(i: { jobs: GiveEmailJob[]; contactName?: string | null; test?: boolean; appBase?: string | undefined }): { subject: string; html: string; text: string } {
  const base = (i.appBase ?? SET_PASSWORD_BASE).replace(/\/+$/, "");
  const blocks: PartnerBlock[] = [partnerHi(i.contactName)];
  for (const j of i.jobs) {
    blocks.push(jobDetails({ jobNumber: (j.jobNumber ?? "").trim() || "Job", owner: displayName(j.ownerName) || "Owner", mobile: (j.ownerMobile ?? "").trim() || "no mobile on file", address: (j.address ?? "").replace(/\s+/g, " ").trim() || "address not recorded" }, j.ownerSaid ?? []));
    blocks.push({ kind: "button", label: IN_HOUSE_PHOTO_GIVE_BUTTON, url: `${base}/field/${encodeURIComponent(j.jobId)}` });
  }
  blocks.push({ kind: "box", text: PHOTO_QUOTE_WORDS.giveEmailDue });
  const { html, text } = partnerEmailLayout({ subject: IN_HOUSE_PHOTO_GIVE_EMAIL_SUBJECT, heading: IN_HOUSE_PHOTO_GIVE_EMAIL_HEADING, preview: PHOTO_QUOTE_WORDS.giveEmailDue, blocks, test: i.test === true });
  return { subject: IN_HOUSE_PHOTO_GIVE_EMAIL_SUBJECT, html, text };
}

/** Once-only key: a repeated Give (same batch) sends once. */
export const inHouseGiveEmailKey = (batchId: string) => `in-house-give:v1:${batchId}`;

export type GiveEmailOutcome = { status: "sent" | "test_sent" | "not_approved" | "no_email" | "held" | "not_sent"; detail?: string };

/** The sentence added to Jo's Give notice. */
export function installerEmailWords(o: GiveEmailOutcome, partner: string | null | undefined): string {
  const name = displayName(partner) || "the installer";
  switch (o.status) {
    case "sent": return `Emailed ${name} the job list.`;
    case "test_sent": return `TEST email sent for ${name}.`;
    case "not_approved": return `No email sent to ${name} — the email isn't approved yet. Call ${name} with the job list.`;
    case "no_email": return `No email to ${name} — no office email on file.`;
    case "held": return `No email sent to ${name} — trade messages are paused. Call ${name} with the job list.`;
    case "not_sent": return `Email to ${name} didn't send — call them with the job list.`;
  }
}

// Jo 24 Oct 2026 (decisions 4, 91, 92, 136): installer emails when the owner accepts or declines the quote.
// Designs approved: docs/templates/approved/I23-owner-accepted.html ("Good news, {InstallerFirst}. {OwnerFirst}
// accepted!") and I24-owner-declined.html ("{InstallerFirst}, {OwnerFirst} has declined the quote"). Pure. No prices:
// trades never see the owner's price. Both flags are on (decisions 91/136); real partners get them through sendOfficeEmail.
import * as K from "./email-kit.core";

export const INSTALLER_ACCEPTED_EMAIL_APPROVED = true as boolean;
/** Jo 24 Oct 2026, decision 136 (I24 "Owner declined"): approved. Real partners still go through sendOfficeEmail. */
export const INSTALLER_DECLINED_EMAIL_APPROVED = true as boolean;

export type InstallerAcceptedInput = { installerFirstName: string | null; ownerName: string | null; address: string | null; jobNumber: string; jobUrl: string; test?: boolean };

export function renderInstallerAcceptedEmail(i: InstallerAcceptedInput) {
  const owner = i.ownerName?.trim() || "The owner";
  const first = owner.split(/\s+/)[0] ?? owner;
  const where = i.address?.trim() || "the property";
  const you = K.cleanName(i.installerFirstName);
  const subject = `Owner accepted – ${i.jobNumber}${i.address?.trim() ? `, ${i.address.trim()}` : ""}`;
  const headline = `Good news${you ? `, ${you}` : ""}. ${first} accepted!`;
  const intro = `${owner} has accepted the quote for ${where} (${i.jobNumber}) and has paid for the electrical safety check.`;
  const steps: K.Step[] = [
    { title: "Electrical safety check", detail: `The licensed electrician offers ${first} times. Nothing for you to do.` },
    { title: `Offer ${first} 3 install days`, detail: `Once the safety check clears, your portal asks you to offer ${first} 3 install days. ${first} picks one and it's booked, or suggests other days, until you agree.` },
    { title: "Install within 30 days", detail: "Of the safety check. Your portal shows how many days are left." },
  ];
  const body = [
    K.h1(headline, 8),
    K.p(`${K.esc(owner)} has accepted the quote for <strong>${K.esc(where)}</strong> (${K.esc(i.jobNumber)}) and has paid for the electrical safety check.`, "0 0 16px", true),
    K.sectionTitle("What happens next", "20px 0 12px"),
    K.numberedSteps(steps),
    K.button(i.jobUrl, "Open the job", "6px 0 4px"),
  ].join("\n");
  const html = K.emailShell({ body, previewText: intro, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([
    `Hi ${you ?? "there"},`, "", headline, intro, "",
    "WHAT HAPPENS NEXT", ...steps.map((s, n) => `${n + 1}. ${s.title}: ${s.detail}`), "",
    `Open the job: ${i.jobUrl}`,
  ], { testLabel: i.test === true });
  return { subject, html, text };
}

export type InstallerDeclinedInput = InstallerAcceptedInput & { reasonLabel?: string | null; reasonNote?: string | null };

/** Decision 92/136: "{OwnerFirst} declined the quote for {address} ({HV}). Reason: … Nothing more to do; the job is closed." */
export function renderInstallerDeclinedEmail(i: InstallerDeclinedInput) {
  const owner = i.ownerName?.trim() || "The owner";
  const first = owner.split(/\s+/)[0] ?? owner;
  const where = i.address?.trim() || "the property";
  const you = K.cleanName(i.installerFirstName);
  const subject = `Owner declined – ${i.jobNumber}${i.address?.trim() ? `, ${i.address.trim()}` : ""}`;
  const headline = `${you ? `${you}, ` : ""}${first} has declined the quote`;
  const intro = `${owner} declined the quote for ${where} (${i.jobNumber}).`;
  const label = i.reasonLabel?.trim() || "No reason given";
  const note = i.reasonNote?.trim() || null;
  const closing = `Nothing more to do; the job is closed. If ${first} changes their mind, we can reopen it from our side, just let us know.`;
  const body = [
    K.h1(headline, 8),
    K.p(`${K.esc(owner)} declined the quote for <strong>${K.esc(where)}</strong> (${K.esc(i.jobNumber)}).`, "0 0 16px", true),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${K.KIT.MIST};border-radius:14px;"><tr><td style="padding:14px 16px;">
<div style="font-size:12px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:${K.KIT.SUB};">Reason given</div>
<div style="font-size:15px;font-weight:bold;color:${K.KIT.NAVY};margin-top:4px;">${K.esc(label)}</div>
${note ? `<div style="font-size:14px;color:${K.KIT.NAVY};line-height:1.5;margin-top:4px;">"${K.esc(note)}"</div>\n` : ""}</td></tr></table>`,
    K.p(closing, "16px 0 0"),
    K.button(i.jobUrl, "See the job", "6px 0 4px"),
  ].join("\n");
  const html = K.emailShell({ body, previewText: intro, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([`Hi ${you ?? "there"},`, "", intro, `Reason given: ${label}${note ? ` — "${note}"` : ""}`, "", closing, "", `See the job: ${i.jobUrl}`], { testLabel: i.test === true });
  return { subject, html, text };
}

// Jo 24 Oct 2026 (decisions 43–46): once the install day and time are agreed, the owner gets "Your install is booked"
// — when, who (with the installer's phone), what to do before and on the day. Wording is a DRAFT until Jo approves it
// in the template review; until then only TEST jobs receive it. Pure.
import { simpleEmail } from "./simple-email.core";

export const INSTALL_BOOKED_EMAIL_APPROVED = false as boolean;

export type InstallBookedInput = {
  firstName: string | null; when: string; address: string | null;
  installerName: string | null; installerPhone: string | null; removal: boolean; myJobUrl: string; test?: boolean;
};

export function renderInstallBookedEmail(i: InstallBookedInput) {
  const subject = `Your insulation install is booked – ${i.when}`;
  const lines = [
    "Your ceiling insulation install is booked.",
    `When: ${i.when}`,
    ...(i.installerName ? [`Installer: ${i.installerName}${i.installerPhone ? `, ${i.installerPhone}` : ""}`] : []),
    ...(i.address ? [`Address: ${i.address}`] : []),
    "Before the day: sign your install consent at least 24 hours before. It takes a minute, from the button below.",
    "On the day, please have an adult (18+) home to let the installer in and sign off at the end, clear the area under the ceiling hatch and a path to it, move cars if you can so the van can park close, and keep pets away from the work area.",
    ...(i.removal ? ["Your job includes removing the old insulation, so expect some extra dust and a longer day. Close internal doors and cover anything near the hatch."] : []),
    "What happens: the installer takes photos before and after (the VEU rebate requires them), lays the insulation and tidies up. Most homes take a few hours. Your remaining balance is due on the day.",
    "Need to change the day? Use Change day on your job page.",
    "Questions? Just reply to this email.",
  ];
  const mail = simpleEmail(`Hi ${i.firstName?.trim() || "there"},`, lines, { label: "Open my job", url: i.myJobUrl }, { testLabel: i.test === true });
  return { subject, html: mail.html, text: mail.text };
}

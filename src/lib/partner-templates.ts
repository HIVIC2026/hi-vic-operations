// Canonical reusable partner invitation templates for the office.
// Presentation only: preview / copy subject / download. Nothing here sends email,
// configures Resend, or triggers any automation. HTML is stored verbatim (canonical),
// with the logo embedded as a data-URI PNG so the file is fully standalone.

import { REC_INVITATION_HTML } from "./rec-invitation.html";
import { INSTALLER_INVITATION_HTML } from "./installer-invitation.html";

export type PartnerTemplate = {
  key: string;
  label: string;
  subject: string;
  registrationUrl: string;
  fileName: string;
  html: string;
};

export const INSTALLER_TEMPLATE: PartnerTemplate = {
  key: "installer_invitation",
  label: "Installer partnership invitation",
  subject: "Hundreds of owner leads — let’s work together",
  registrationUrl: "https://estimate.homeinsulationvictoria.com.au/installer-onboarding",
  fileName: "installer-partnership-invitation.html",
  html: INSTALLER_INVITATION_HTML,
};

export const REC_TEMPLATE: PartnerTemplate = {
  key: "rec_invitation",
  label: "REC partnership invitation",
  subject: "Hundreds of owner enquiries—and we’re looking for great electricians",
  registrationUrl: "https://estimate.homeinsulationvictoria.com.au/electrician-onboarding",
  fileName: "rec-partnership-invitation.html",
  html: REC_INVITATION_HTML,
};

export const PARTNER_TEMPLATES: PartnerTemplate[] = [REC_TEMPLATE, INSTALLER_TEMPLATE];

/** Canonical HTML, served verbatim for both preview and download. */
export function renderPartnerTemplate(t: PartnerTemplate): string {
  return t.html;
}

/** Preview-only copy: links open in a new tab. Never used for download. */
export function previewPartnerTemplate(t: PartnerTemplate): string {
  return t.html.replace("<head>", '<head><base target="_blank">');
}

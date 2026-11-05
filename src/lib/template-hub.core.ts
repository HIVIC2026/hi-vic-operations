// Pure: the office Templates page register (decision 379, Jo 25 Oct 2026: "ONLY the current templates, Mitti forms and
// compliance documents, all EXACTLY as people see them, in exactly the right place"). Presentation only.
//
// Every entry renders through the SAME pure builder the live sender calls (render functions below), with fixed TEST
// sample data, so the page can never drift from the code. Nothing here holds wording, decides approval, sends, saves
// or changes workflow. Entries are grouped by WHO gets them and ordered by job step. Wording waiting for Jo's approval
// sits in its own section. Retired templates are simply not listed (their files stay in git).
// tests/templates-hub.test.ts proves every entry comes from a live code path and every live builder / text type is here.
import { electricianLinkText } from "./electrician-link.core";
import { readyCheckWindowEmail, readyCheckWindowText } from "./ready-check-window-notice.core";
import { electricianLinkText as ownJobElectricianLinkText } from "./own-job-electrician-link.core";
import { rejectionEmail, welcomeSmsText } from "./my-electricians.core";
import { officeCantDoEmail, officeEmailBlocks, officeNotBookedEmail, officeToBookEmail, type OfficeEmail } from "./own-job-office-emails.core";
import { oldElectricianEmail, ownerSwapCancelledEmail } from "./electrician-swap.core";
import { alertEmail } from "./mitti-retry.core";
import { renderQuickTapsDeclineEmail } from "./quick-taps-email.core";
import { renderQuoteExpiredEmail } from "./quote-expired-email.core";
import { renderInHouseGiveEmail } from "./in-house-give-email.core";
import { bookingNotice, ownerBookedMessage } from './in-house-booking.core';
import { renderJoOutcomeEmail } from "./jo-outcome-email.core";
import { withUnsubscribe } from "./emailsafety.core";
import { renderCoverageUnavailableEmail } from "./coverage-email";
import { renderEstimateFollowupEmail } from "./estimate-followup.core";
import { renderSpotSavedEmail, renderSpotSavedSms } from "./spot-saved-messages.core";
import { renderNewSenderReplyEmail } from "./new-sender-reply-email.core";
import { renderChangeReplyEmail } from "./email-change-reply.core";
import { ownerCodeEmail, ownerCodeSmsBody } from "./owner-code-delivery.core";
import { renderOwnerQuoteEmail, renderQuoteReminderEmail, ownerQuoteSms } from "./owner-quote-email.core";
import { quoteChangeRows } from "./quote-changes.core";
import { renderYoureInEmail } from "./acceptance-email.core";
import { renderPiesaCopyEmail } from "./piesa-delivery.core";
import { ownerInstallWindowEmail, installerInstallWindowEmail, ownerInstallWindowText, installerInstallWindowText } from "./thirty-day-rule.core";
import { renderInstallDayChangedEmail } from "./install-days-email.core";
import { renderInstallBookedEmail } from "./install-booked-email.core";
import { renderConsentCopyEmail } from "./consent-copy-email.core";
import { renderDepositReleasedEmail, depositReleaseText } from "./deposit-release-notice.core";
import { renderInstallNoAccessEmail, installNoAccessText } from "./install-no-access-notice.core";
import { renderOwnerCancelledEmail, renderInstallerCancelledEmail } from "./cancel-notice.core";
import { HIV_AP_CONTACT, renderInstallCompleteEmail, renderFinalInvoiceEmail, renderCompletionPackEmail, renderReviewRequestEmail } from "./completion-emails.core";
import { renderVeecCopyEmail } from "./veec-emails.core";
import { afterInstallReminder } from "./after-install-reminders.core";
import { veecSignRequestText, VEEC_FORM_BODY, VEEC_FORM_TITLE, VEEC_FORM_EDITION, VEEC_FORM_ORIGINAL_FILE } from "./veec-assignment-form.core";
import { renderWarrantyFollowupEmail } from "./warranty-followup.core";
import { bankDetailLines, HIV_BANK_DETAILS } from "./payments.core";
import { renderInstallerAcceptedEmail, renderInstallerDeclinedEmail } from "./installer-accepted-email.core";
import { renderApplicationReceivedEmail, changesEmail, declineEmail } from "./application-review.core";
import { partnerWelcomeEmail, partnerEmailLayout } from "./partner-email.core";
import { collectionNoticeEmail, noticeLinkEmail, noticeLinkSmsBody, COLLECTION_NOTICE_PARAGRAPHS } from "./esc-collection-notice.core";
import { renderElectricianPiesaEmail } from "./electrician-piesa-copy.core";
import { renderElectricianPiesaBooked } from "./electrician-piesa-booked-email.core";
import { electricianCantDoEmail } from "./electrician-cant-do-email.core";
import { upgradesNudgeText, upgradesOfficeEmail, upgradesRedFlagEmail } from "./upgrades-watch.core";
import { certificateChaseText, upgradesDayLinkText, upgradesDayOfficeEmail } from "./certificate-chase.core";
import { certificateAddLinkText } from "./certificate-later.core";
import { MITTI_INVITE_MESSAGE, renderMittiInviteEmail } from "./mitti-invite.core";
import { officeEmailLayout, electricianInviteLayout } from "./office-email.core";
import { composeReply } from "./email-reply.core";
import { brandSmsBody } from "./sms.core";
import { ownerWillCallEmail, ownerWillCallText } from "./owner-will-call.core";
import { quickTapsLink, quickTapsReminderText } from "./area-batch.core";
import { ownCustomerRentalTapsText, rentalOnlyLink } from "./rental-answers.core";
import { blastMessage } from "./save-spot-reminder-blast.core";
import { threeQuestionsSms } from "./three-questions-reminder.core";
import {
  visitTomorrowText,
  quoteReminderDay3Text, quoteReminderExpiryText, installMovedText,
} from "./approved-texts.core";
import { melbourneClock, installTomorrowText, teamMemberInviteText, ownerChangedVisitText } from "./installer-texts.core";
import { readyCheckIncompleteText, readyCheckNearlyThereEmail } from "./ready-check-chase.core";
import { dailyText, updateText, diffDay } from "./daily-mitti-text.core";
import { bossPriceLinkText } from "./boss-price-link.core";
import { renderEnterPriceEmail } from "./enter-price-email.core";
import { renderInstallerQuoteSentEmail } from "./installer-quote-sent-email.core";
import { fixesTimesLinkText } from "./fixes-times.core";
import { piesaRulesMessage, renderPiesaRulesEmail } from "./piesa-rules-notice.core";
import { attendanceSmsText, attendanceReminderText, attendanceBookedText, installerCantAttendText } from "./install-attendance.core";
import { installDayResultText, installDayReminderText } from "./install-day-confirm.core";
import { FORMS, type FormField } from "./mitti-forms.core";
import { INSTALL_DAY_QUESTIONS, INSTALL_DAY_TEMPLATE_NAME } from "./install-day.core";
import { FIXES_DAY_QUESTIONS, FIXES_DAY_TEMPLATE_NAME } from "./fixes-day.core";
import { GATE_DOCS, RETIRED_DOC_KEYS, fillTemplate, ownerVersionLabel, paymentTermsText, paymentTermsMoney, type GateDocKey } from "./owner-gates.core";
import { renderConsentBody, ESC_CONSENT_TEMPLATE_VERSION, OWNER_DECLARATIONS } from "./consent.core";
import { SWMS_HAZARDS, SWMS_NOV2_WORDING_ON, SWMS_PREPARED_FOR, SWMS_RULE, SWMS_SIGN_STATEMENT } from "./swms.core";
import { PRODUCT_WARRANTIES, warrantyTermText } from "./product-warranty.core";
import { VEU_FACTSHEET_PATH, VEU_FACTSHEET_TITLE } from "./veu-factsheet.core";
import { buildInvoicePayload } from "./xero.core";
import { TRADE_INVITE_DRAFT, renderTradeInviteEmail } from "./trade-access.core";
import { swmsSignLinkText } from "./swms-sign-text.core";
import { mittiFormUrl } from "./mitti-link.core";
import { renderLeadInstallerConfirm } from "./lead-installer-confirm.core";
import { renderReadyCheckPersonEmail } from "./ready-check-person.core";
import { goEmail } from "./go-email.core";
import { leadInstallerLock } from "./prestart.core";
import { renderVisitNewTimesEmail, visitNewTimesText } from "./visit-new-times.core";
import { ANSWER_CODES, ANSWER_SAMPLES, ANSWER_TYPES, renderOwnerAutoReplyEmail } from "./owner-email-auto-reply.core";
import { renderLegacySpotReleasedEmail, renderSpotReleasedEmail } from "./spot-release-email.core";
import { legacySpotReleasedText, spotReleasedText } from "./spot-release.core";
import { renderAddressRequestEmail } from "./address-request-email.core";
import { addressRequestText } from "./address-request.core";
import { upgradesNeededEmail, upgradesNeededText } from './upgrades-needed.core';
import { visitCancelledOwnerEmail } from "./visit-cancelled-owner.core";
import { nonComplianceNotice } from "./non-compliance-notice.core";
import { renderInstallDepositOwnerEmail, renderInstallerDepositPaidEmail, depositOwnerText, type DepositMessageFacts } from './deposit-request-email.core';
import { accessPersonBookedText, accessPersonTomorrowText } from "./access-person-texts.core";
import { tenantNotice } from "./tenant-notice.core";
import { ownMessageSwitch, type OwnCustomerMessageKey } from './own-customer-message-approval.core';
import { renderOwnCustomerQuoteEmail, renderOwnCustomerUpdatedQuoteEmail, renderOwnInstallerAcceptedEmail } from './own-customer-quote-messages.core';

/* ---------------------------------------------------------------- types */

// Section list and search parser live in template-sections.core so the route can read the address without loading every template.
import type { TemplateSection } from "./template-sections.core";
export { TEMPLATE_SECTIONS, parseTemplateSearch, type TemplateSection } from "./template-sections.core";

export type TemplateStep = "enquiry" | "ready_check" | "quote" | "safety_check" | "fixes" | "install" | "rebate" | "paid" | "any";
export const STEP_ORDER: TemplateStep[] = ["enquiry", "ready_check", "quote", "safety_check", "fixes", "install", "rebate", "paid", "any"];
export const STEP_LABEL: Record<TemplateStep, string> = {
  enquiry: "Enquiry", ready_check: "Ready Check", quote: "Quote", safety_check: "Safety check", fixes: "Electrical fixes",
  install: "Install", rebate: "Rebate", paid: "Paid", any: "Any time",
};

export type TemplateKind = "email" | "text" | "page" | "paperwork" | "form" | "document" | "invoice";
export const KIND_LABEL: Record<TemplateKind, string> = { email: "Email", text: "Text", page: "My job page", paperwork: "Paperwork", form: "Mitti form", document: "Document", invoice: "Invoice" };

/** What must be on for a real send. Pages, forms and documents are always shown ("always"). */
export type TemplateGate =
  | { kind: "always" }
  | { kind: "email"; switchKey?: string } // customer_comms_enabled (owner emails AND partner emails pause with it) + an optional own switch
  | { kind: "text"; smsType: string } // customer_comms_enabled + the per-type text switch (daily texts also need daily_mitti_text_enabled)
  | { kind: "code_off"; flag: string }; // a code constant keeps it off

export type QuestionGroup = { heading: string; items: { label: string; type: string; note?: string }[] };
export type TemplatePreview =
  | { kind: "email"; subject: string; html: string }
  | { kind: "text"; body: string }
  | { kind: "texts"; variants: { label: string; body: string }[] }
  | { kind: "questions"; title: string; record: string; groups: QuestionGroup[] }
  | { kind: "doc"; title: string; body: string; note?: string }
  | { kind: "file"; path: string; as: "html" | "pdf" | "download"; note: string }
  | { kind: "files"; items: { label: string; path: string | null; note: string }[] }
  | { kind: "table"; title: string; columns: string[]; rows: string[][]; note?: string };

export type TemplateEntry = {
  id: string; section: TemplateSection; step: TemplateStep; kind: TemplateKind;
  /** Jo's design code (O18, I65 …) or "" when none was given. */
  code: string; name: string;
  /** When it is sent / shown. */
  when: string; who: string;
  approval: "approved" | "waiting";
  /** Where the approval is recorded (decision number or code flag). */
  approvalNote: string;
  gate: TemplateGate;
  /** The live code: the pure builder and the sender that calls it. */
  source: { builder: string; fn: string; sender: string };
  /** Approved design/sample file in docs/templates (relative to the repo), when one exists. */
  design?: string;
  /** Owner paperwork key whose stored approval the page shows live. */
  paperworkKey?: GateDocKey;
  ownMessageKey?: OwnCustomerMessageKey;
  render: () => TemplatePreview;
};

/* ---------------------------------------------------------------- TEST sample data */

const BASE = "https://estimate.homeinsulationvictoria.com.au";
const JOB = `${BASE}/my-job/TEST`;
const EST = `${BASE}/estimate/TEST`;
const FIELD = `${BASE}/field/TEST-JOB`;
const UNSUB = `${BASE}/api/public/unsubscribe?t=${"T".repeat(43)}`;
const LINKS = { saveMySpotUrl: `${EST}/campaign`, uploadMediaUrl: `${EST}/video`, reviewResultUrl: EST, calculatorUrl: `${EST}/calculator` };
const HELEN = { firstName: "Helen", propertyAddress: "824 High Street Road, Glen Waverley VIC 3150", enquiryReference: "HV-TEST" };
const FIG = { veuRebate: 1610, customerTotal: 2188, totalBeforeRebate: 3798, installation: 3100, piesaFee: 349, apFee: 349, ceilingAreaM2: 137, areaEstimated: false };
const REINSULATE = { name: "Sample Insulation Co", phone: "0400 000 000" };
const ADDRESS = "824 High Street Road, Glen Waverley VIC 3150";
const SHORT_ADDRESS = "824 High Street Road, Glen Waverley";
const INSTALL_ISO = "2026-11-10T20:30:00Z"; // Wednesday 11 November, 7:30am Melbourne
const RC_ISO = "2026-10-27T21:00:00Z"; // Wednesday 28 October, 8:00am
const PIESA_ISO = "2026-11-04T21:00:00Z"; // Thursday 5 November, 8:00am
const QUOTE = {
  firstName: "Helen", address: ADDRESS, totalIncGst: 2200, rebateIncGst: 1850, subtotalIncGst: 4050, areaM2: 137.6, removalM2: 40, product: "Bradford Gold R5.0",
  installerName: "Sample Insulation Co", installerCertified: true, safetyCheckPrice: 349,
  lines: [{ description: "Bradford Gold R5.0 ceiling batts, supplied and installed", lineTotalIncGst: 2752 }, { description: "Old insulation removed and taken away", lineTotalIncGst: 600 }, { description: "Electrical safety check (PIESA)", lineTotalIncGst: 349 }, { description: "Accredited Person fee", lineTotalIncGst: 349 }],
  quoteUrl: `${JOB}?screen=quote`, validUntil: new Date("2026-11-07T12:59:59.999Z"), officePhone: null, unsubscribeUrl: UNSUB,
};
const WILL_CALL_SAMPLE = { name: "Sample Insulation Co", tradingName: null, officePhone: "03 9000 0000", email: "office@sample-insulation.example" };
// The sample renders the new wording (as it will read once OWNER_BOOKED_READY_CHECK_APPROVED is on).
const BOOKED_ON = { ready_check: true, piesa: true, install: true };
const BOOKED_SAMPLE = { kind: "ready_check" as const, start: "2026-11-03T22:00:00Z", who: { name: "Sample Installer", phone: null }, installer: "Sample Insulation Co", phone: "03 9000 0000", ownerName: "Helen", business: WILL_CALL_SAMPLE, changed: false };
const BOOKED_PIESA_SAMPLE = { ...BOOKED_SAMPLE, kind: "piesa" as const, start: "2026-11-06T23:00:00Z", who: { name: "Sample Electrician", phone: null }, business: { name: "Sample Electrical Co", tradingName: null, officePhone: "03 9111 1111", email: "office@sample-electrical.example" }, installerName: "Sample Insulation Co", installDeadline: "2026-12-06" };
const BOOKED_INSTALL_SAMPLE = { ...BOOKED_SAMPLE, kind: "install" as const, start: "2026-11-12T21:00:00Z", who: { name: "Sample Lead Installer", phone: null }, balanceCents: 141200 };
const ACCESS_TENANT = { who: "tenant" as const, name: "Tina Lee", mobile: "+61400111222" };
const ACCESS_PM = { who: "property_manager" as const, name: "Paul Manager", mobile: "+61400333444" };
const PARTNER_JOB = { installerFirstName: "Sam", ownerName: "Helen Yang", address: SHORT_ADDRESS, jobNumber: "HV-TEST", jobUrl: FIELD };
const BANK = { accountName: "Home Insulation Victoria", bsb: "082902", accountNumber: "777966349", payId: null, configured: true };

/* ---------------------------------------------------------------- helpers */

const email = (m: { subject: string; html: string }): TemplatePreview => ({ kind: "email", subject: m.subject, html: m.html });
const SAMPLE_BIZ = { name: "Sample Insulation Co", tradingName: null, officePhone: "03 9000 0000", email: "office@sample.test" };
const S = (r: string | { held: string }) => (typeof r === "string" ? r : null);
const text = (body: string | null): TemplatePreview => ({ kind: "text", body: brandSmsBody(body ?? "") });
const texts = (variants: { label: string; body: string | null }[]): TemplatePreview => ({ kind: "texts", variants: variants.map((v) => ({ label: v.label, body: brandSmsBody(v.body ?? "") })) });
/** Installer-office emails sent through emailInstallerOffice (own-job-piesa-notices.server): its exact partnerEmailLayout blocks. */
const installerOfficeEmail = (m: OfficeEmail | { subject: string; text: string }, jobUrl: string | null) =>
  "heading" in m
    ? email({ subject: m.subject, ...partnerEmailLayout({ subject: m.subject, heading: m.heading, preview: m.lines[0], test: false, blocks: officeEmailBlocks(m, "Sample Insulation", { jobNumber: "HV-TEST", address: SHORT_ADDRESS, owner: "Helen Yang", mobile: "0400 000 000" }, jobUrl) }) })
    : email({ subject: m.subject, ...partnerEmailLayout({ subject: m.subject, test: false, blocks: [...m.text.split("\n").filter(Boolean).map((t) => ({ kind: "p" as const, text: t })), ...(jobUrl ? [{ kind: "button" as const, label: "Open the job", url: jobUrl }] : [])] }) });
/** Partner/applicant emails that the office sender lays out itself (no html passed): exactly what sendOfficeEmail builds. */
const officeLaidOut = (contactName: string | null, subject: string, message: string) => officeEmailLayout({ contactName, subject, message });
const jo = (input: Parameters<typeof renderJoOutcomeEmail>[0]) => {
  const m = renderJoOutcomeEmail(input);
  if (!m) throw new Error("No Jo template for this sample");
  const w = withUnsubscribe(m, UNSUB);
  return email({ subject: w.subject, html: w.html });
};
const fieldsGroups = (fields: readonly FormField[]): QuestionGroup[] => [{
  heading: "Questions (in form order)",
  items: fields.filter((f) => !f.portalOnly).map((f) => ({ label: f.label, type: f.type, note: [f.required ? "required" : "optional", f.when ? `when ${f.when}` : null, f.perArea ? "per ceiling area" : null, f.choices?.length ? f.choices.join(" / ") : null].filter(Boolean).join(" · ") })),
}];
const numbered = <Q extends { n: number; label: string; type: string; required: boolean; group: number; options?: readonly string[]; showWhen?: { n: number; is: readonly string[] } }>(qs: readonly Q[]): QuestionGroup[] => {
  const groups = new Map<number, QuestionGroup>();
  for (const q of qs) {
    const g = groups.get(q.group) ?? { heading: `Page ${q.group}`, items: [] };
    g.items.push({ label: `${q.n}. ${q.label.split("\n")[0]}`, type: q.type, note: [q.required ? "required" : "optional", q.showWhen ? `when Q${q.showWhen.n} = ${q.showWhen.is.join(" / ")}` : null, q.options?.length ? q.options.join(" / ") : null].filter(Boolean).join(" · ") });
    groups.set(q.group, g);
  }
  return [...groups.values()];
};
const gateDoc = (key: GateDocKey) => GATE_DOCS.find((d) => d.key === key)!;
const SAMPLE_VARS: Record<string, string> = {
  address: ADDRESS, owner_name: "Helen Yang", role: "I own it", landlord_name: "Sample Property Management", landlord_email: "agent@example.com", landlord_phone: "03 9000 0000",
  quote_version: "1", total: "$2,200.00", date: "Wednesday 11 November 2026", visit_date: "Wednesday 28 October 2026",
};

const ENTRY = (e: Omit<TemplateEntry, "approval" | "approvalNote"> & { approval?: TemplateEntry["approval"]; approvalNote: string }): TemplateEntry => ({ approval: "approved", ...e });
const DEPOSIT_SAMPLE:DepositMessageFacts={name:'Helen',installer:'Sample Insulation Co',jobNumber:'HV-TEST',address:SHORT_ADDRESS,ownerPhone:'0400 000 000',deadline:'2026-12-04',amountCents:18510,link:`${JOB}?screen=pay`,bank:{...HIV_BANK_DETAILS,configured:true},reference:'INV-TEST',card:true};

/* ---------------------------------------------------------------- OWNER */

const OWNER: TemplateEntry[] = [
  // Enquiry
  ENTRY({ id: "owner:O1", section: "owner", step: "enquiry", kind: "email", code: "O1", name: "Save my spot (no existing insulation)", when: "Estimate sent: eligible, no existing insulation (Jo T1/T2)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decisions 66–69; HELD by decision 388 (spot-only rewording awaiting Jo)", gate: { kind: "email" },
    source: { builder: "src/lib/jo-outcome-email.core.ts", fn: "renderJoOutcomeEmail", sender: "src/lib/followups.server.ts" }, design: "docs/templates/mjml/owner_O1.mjml",
    render: () => jo({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, recipient: HELEN, figures: FIG, links: LINKS }) }),
  ENTRY({ id: "owner:O2-some", section: "owner", step: "enquiry", kind: "email", code: "O2", name: "Save my spot (some insulation)", when: "Estimate sent: existing insulation below R2 reviewed, or declared thin/patchy (T3/T4)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decisions 66–69; HELD by decision 388 (spot-only rewording awaiting Jo)", gate: { kind: "email" },
    source: { builder: "src/lib/jo-outcome-email.core.ts", fn: "renderJoOutcomeEmail", sender: "src/lib/hot-leads-send.server.ts" }, design: "docs/templates/mjml/owner_O2-some.mjml",
    render: () => jo({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, declaredThinPatchy: true, recipient: HELEN, figures: { ...FIG, removalUpTo: 2055 }, links: LINKS }) }),
  ENTRY({ id: "owner:O2-dont-know", section: "owner", step: "enquiry", kind: "email", code: "O2", name: "Save my spot (don't know if insulation)", when: "Estimate sent: a new website enquirer ticked \"don't know\" whether there's insulation (decision 392; same email as some insulation, don't-know intro)", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 392 (Save my spot email chosen); spot-only wording per decision 388", gate: { kind: "email" },
    source: { builder: "src/lib/jo-outcome-email.core.ts", fn: "renderJoOutcomeEmail", sender: "src/lib/hot-leads-send.server.ts" }, design: "docs/templates/mjml/owner_O2-dont-know.mjml",
    render: () => jo({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true, declaredExisting: true, declaredUnknown: true, recipient: HELEN, figures: { ...FIG, removalUpTo: 2055 }, links: LINKS }) }),
  ENTRY({ id: "owner:O2-questions", section: "owner", step: "enquiry", kind: "email", code: "O2", name: "Save my spot: answer 3 questions", when: "Estimate sent: existing insulation not confirmed yet (T5/T6); also the one-off 3 questions reminder", who: "Owner", approvalNote: "Jo 24 Oct 2026, decisions 66–69, 172; HELD by decision 388 (spot-only rewording awaiting Jo)", gate: { kind: "email" },
    source: { builder: "src/lib/jo-outcome-email.core.ts", fn: "renderJoOutcomeEmail", sender: "src/lib/three-questions-reminder.server.ts" }, design: "docs/templates/mjml/owner_O2-questions.mjml",
    render: () => jo({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true, insulationQuestions: true, recipient: HELEN, figures: { ...FIG, removalUpTo: 2055 }, links: LINKS }) }),
  ENTRY({ id: "owner:O6", section: "owner", step: "enquiry", kind: "email", code: "O6", name: "Not eligible", when: "Eligibility result: does not appear eligible (T7)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 73", gate: { kind: "email" },
    source: { builder: "src/lib/jo-outcome-email.core.ts", fn: "renderJoOutcomeEmail", sender: "src/lib/enquiry-groups.server.ts" }, design: "docs/templates/mjml/owner_O6.mjml",
    render: () => jo({ outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false, recipient: HELEN, reason: "From the photos and details you sent us, the insulation already in your ceiling appears to be R2.0 or above.", links: LINKS }) }),
  ENTRY({ id: "owner:O7", section: "owner", step: "enquiry", kind: "email", code: "O7", name: "Not in your area yet", when: "Office presses Send on a job with no installer or electrician covering the postcode", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 74", gate: { kind: "email" },
    source: { builder: "src/lib/coverage-email.ts", fn: "renderCoverageUnavailableEmail", sender: "src/lib/coverage.functions.ts" }, design: "docs/templates/mjml/owner_O7.mjml",
    render: () => email(renderCoverageUnavailableEmail({ firstName: "Helen", suburb: "Mildura", postcode: "3500", missing: ["REC / electrician", "installer"], reference: "HV-TEST" })) }),
  ...([["day_2", "O66", "Estimate reminder (day 2)", "owner_O66.mjml"], ["day_7", "O67", "Estimate reminder (day 7)", "owner_O67.mjml"], ["day_21", "O68", "Estimate closing (day 21)", "owner_O68.mjml"]] as const).map(([step, code, name, file]) =>
    ENTRY({ id: `owner:${code}`, section: "owner", step: "enquiry", kind: "email", code, name, when: `${step.replace("day_", "Day ")} after the estimate email, until the spot is saved, they reply or opt out (closes a week after day 21)`, who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 242 (reconfirmed 357); HELD by decision 388 (spot-only rewording awaiting Jo)", gate: { kind: "email" },
      source: { builder: "src/lib/estimate-followup.core.ts", fn: "renderEstimateFollowupEmail", sender: "src/lib/estimate-followup.server.ts" }, design: `docs/templates/mjml/${file}`,
      render: () => email(renderEstimateFollowupEmail({ step, firstName: "Helen", rebate: 1610, price: 2188, fullPrice: 3798, basis: "Based on what you told us: 137 m² ceiling, no existing insulation.", saveUrl: `${EST}/campaign`, calculatorUrl: `${EST}/calculator`, unsubscribeUrl: UNSUB })) })),
  ENTRY({ id: "owner:sms-save_spot_reminder", section: "owner", step: "enquiry", kind: "text", code: "", name: "Save my spot reminder (one-off)", when: "Office one-off reminder to owners who have an estimate but no saved spot", who: "Owner", approvalNote: "Jo (one-off blast wording); HELD by decision 388 (spot-only rewording awaiting Jo)", gate: { kind: "text", smsType: "save_spot_reminder" },
    source: { builder: "src/lib/save-spot-reminder-blast.core.ts", fn: "blastMessage", sender: "src/lib/save-spot-reminder-blast.server.ts" },
    render: () => text(blastMessage("Helen", 2188, 1610, `${EST}/campaign`)) }),
  ENTRY({ id: "owner:sms-three_questions_reminder", section: "owner", step: "enquiry", kind: "text", code: "", name: "3 questions reminder (one-off)", when: "Office one-off reminder (pre-23-Oct enquiries); the email is O2 questions", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 172", gate: { kind: "text", smsType: "three_questions_reminder" },
    source: { builder: "src/lib/three-questions-reminder.core.ts", fn: "threeQuestionsSms", sender: "src/lib/three-questions-reminder.server.ts" },
    render: () => text(threeQuestionsSms("Helen", 1610, `${EST}/video`)) }),
  ENTRY({ id: "owner:O70", section: "owner", step: "enquiry", kind: "email", code: "O70", name: "New sender → homeowner page reply", when: "Someone with no job emails an enquiry or price question: ONE reply pointing to the homeowner page on our website", who: "New email sender", approvalNote: "Jo 25 Oct 2026, decisions 292, 356; wording Jo 27 Oct 2026, decision 413", gate: { kind: "email" },
    source: { builder: "src/lib/new-sender-reply-email.core.ts", fn: "renderNewSenderReplyEmail", sender: "src/lib/new-sender-reply.server.ts" }, design: "docs/templates/mjml/owner_O70.mjml",
    render: () => email(renderNewSenderReplyEmail({ theirSubject: "Ceiling insulation quote", firstName: "Sam" })) }),
  ENTRY({ id: "owner:O10", section: "owner", step: "enquiry", kind: "email", code: "O10", name: "Spot saved", when: "The owner saves their spot", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 70; reworded spot-only by decision 388; step 2 + PIESA/upgrades wording by decisions 12/19 (Jo 2 Nov 2026, approved wording: no flag)", gate: { kind: "email", switchKey: "spot_saved_email" },
    source: { builder: "src/lib/spot-saved-messages.core.ts", fn: "renderSpotSavedEmail", sender: "src/lib/spot-saved-send.server.ts" }, design: "docs/templates/mjml/owner_O10.mjml",
    render: () => email(renderSpotSavedEmail({ firstName: "Helen", rebate: 1610, suburb: "Glen Waverley", shortAddress: SHORT_ADDRESS, myJobUrl: JOB, optOutUrl: UNSUB, referralUrl: "https://homeinsulationvictoria.com.au/homeowner?ref=TEST", estimate: { gross: 3798, customer: 2188, areaM2: 137, address: ADDRESS, calculatorUrl: `${EST}/calculator` } })) }),
  ENTRY({ id: "owner:sms-spot_saved", section: "owner", step: "enquiry", kind: "text", code: "", name: "Spot saved (text)", when: "The owner saves their spot", who: "Owner", approvalNote: "Jo, decision 159; wording from Jo 2 Nov 2026 (decision 20, approved: no link)", gate: { kind: "text", smsType: "spot_saved" },
    source: { builder: "src/lib/spot-saved-messages.core.ts", fn: "renderSpotSavedSms", sender: "src/lib/spot-saved-send.server.ts" },
    render: () => text(renderSpotSavedSms({ firstName: "Helen", rebate: 1610, suburb: "Glen Waverley", shortAddress: SHORT_ADDRESS, myJobUrl: JOB, optOutUrl: UNSUB, estimate: { gross: 3798, customer: 2188, areaM2: 137, address: SHORT_ADDRESS, calculatorUrl: JOB } })) }),
  // Ready Check
  ENTRY({ id: "owner:sms-visit_tomorrow_owner", section: "owner", step: "ready_check", kind: "text", code: "", name: "See you tomorrow (text)", when: "From 4pm the afternoon before a Ready Check, safety check or install", who: "Owner", approvalNote: "Jo 24 Oct 2026, decisions 82, 93, 99; business office phone + \"electrical safety check (PIESA)\" per decision #25, Jo 2 Nov 2026", gate: { kind: "text", smsType: "visit_tomorrow_owner" },
    source: { builder: "src/lib/approved-texts.core.ts", fn: "visitTomorrowText", sender: "src/lib/approved-texts.server.ts" },
    render: () => texts([
      { label: "Ready Check", body: S(visitTomorrowText({ kind: "ready_check", time: melbourneClock(RC_ISO), business: SAMPLE_BIZ })) },
      { label: "Safety check", body: S(visitTomorrowText({ kind: "piesa", time: melbourneClock(RC_ISO), business: { ...SAMPLE_BIZ, tradingName: "Spark Electrical", officePhone: "03 9000 0001" } })) },
      { label: "Install day", body: S(visitTomorrowText({ kind: "install", time: melbourneClock(RC_ISO), business: SAMPLE_BIZ })) },
    ]) }),
  // Quote
  ENTRY({ id: "owner:O18", section: "owner", step: "quote", kind: "email", code: "O18", name: "Your quote is ready", when: "Quote released to the owner (office Send, or automatically when the Ready Check is complete)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 86", gate: { kind: "email" },
    source: { builder: "src/lib/owner-quote-email.core.ts", fn: "renderOwnerQuoteEmail", sender: "src/lib/quote-ready-notify.server.ts" }, design: "docs/templates/mjml/owner_O18.mjml",
    render: () => email(renderOwnerQuoteEmail(QUOTE)) }),
  // Decision #29 (Jo 2 Nov 2026): O18 v4 — "Your rebate"/"Rebate", Next names the electrical safety check (PIESA), the
  // "What's changed from your estimate" box, the 30-day line, and the quote documents attached (#33). Same purpose/key as
  // O18; v3 above keeps going out until OWNER_QUOTE_EMAIL_V4_APPROVED is on. Held if any document isn't ready.
  ENTRY({ id: "owner:O18-v4", section: "owner", step: "quote", kind: "email", code: "O18", name: "Your quote is ready (new: What's changed + documents)", when: "Quote released to the owner (30-day quotes); attaches the Customer Agreement + payment terms PDF and the Statement of rights; held with an office note (\"Quote documents not ready\") if any document can't be made", who: "Owner", approvalNote: "Wording: Jo 2 Nov 2026, decisions #29/#33 (OWNER_QUOTE_EMAIL_V4_APPROVED stays false until Jo OKs the pictures)", gate: { kind: "email" },
    source: { builder: "src/lib/owner-quote-email.core.ts", fn: "renderOwnerQuoteEmail", sender: "src/lib/quote-ready-notify.server.ts" },
    render: () => email(renderOwnerQuoteEmail({ ...QUOTE, totalIncGst: 2200, validUntil: new Date("2026-12-10T12:59:59.999Z"), validDays: 30, v4: true, changes: quoteChangeRows({ estimate: { areaM2: 120, removal: null, price: 1890 }, quote: { areaM2: 137.6, removal: true, price: 2200 } }) })) }),
  // Jo 4 Nov 2026 16:10 (ESC letter on Activity 48 R-value): when the Ready Check says the OLD INSULATION STAYS (not removed,
  // good enough to lay over), the quote email carries the approved "Your old insulation stays." paragraph under the quote
  // lines (and the agreement's section 1, the quote page and My job say the same). No removal line, no removal row.
  ENTRY({ id: "owner:O18-v4-kept-insulation", section: "owner", step: "quote", kind: "email", code: "O18", name: "Your quote is ready (old insulation stays)", when: "As O18 v4, when the Ready Check recorded the old insulation is kept (removal = no, good enough condition to lay new batts on top = yes); Home Insulation Victoria leads and installers' own customers", who: "Owner", approvalNote: "The \"Your old insulation stays.\" paragraph: APPROVED by Jo 4 Nov 2026 16:10; the rest as O18 v4 (OWNER_QUOTE_EMAIL_V4_APPROVED)", gate: { kind: "email" },
    source: { builder: "src/lib/owner-quote-email.core.ts", fn: "renderOwnerQuoteEmail", sender: "src/lib/quote-ready-notify.server.ts" },
    render: () => email(renderOwnerQuoteEmail({ ...QUOTE, totalIncGst: 1600, subtotalIncGst: 3450, removalM2: null, lines: QUOTE.lines.filter((l) => !/removed/i.test(l.description)), validUntil: new Date("2026-12-10T12:59:59.999Z"), validDays: 30, v4: true, changes: [], keptInsulation: true })) }),
  // Part 10 Task 5 (Jo 2–3 Nov 2026): an installer's OWN customer gets the v4 email with the approved lines (by quote_items.code),
  // the installer's logo beside ours (OWN_CUSTOMER_COBRAND_APPROVED) and the VEU program box. Off until Jo OKs the picture.
  ENTRY({ id: "owner:O18-own-customer", section: "owner", step: "quote", kind: "email", code: "O18", name: "Your quote is ready (installer's own customer: approved lines, both logos, VEU box)", when: "Quote released to an installer's own customer (channel installer_sourced), with the v4 email's documents; the installer's logo shows only when the business has uploaded one", who: "Owner (installer's own customer)", approvalNote: "Lines/labels: Jo 2 Nov 2026 (Part 10 Task 1); VEU box: Fix 1 verbatim; VEU voluntary/complaints line under it APPROVED by Jo 4 Nov 2026 14:18 (Round 5 A); ONE switch OWN_CUSTOMER_COBRAND_APPROVED (email, My job page, tax invoice) stays false until Jo OKs the pictures", gate: { kind: "email" },
    source: { builder: "src/lib/owner-quote-email.core.ts", fn: "renderOwnerQuoteEmail", sender: "src/lib/quote-ready-notify.server.ts" },
    render: () => email(renderOwnerQuoteEmail({ ...QUOTE, totalIncGst: 2098, rebateIncGst: 600, subtotalIncGst: 2698, validUntil: new Date("2026-12-10T12:59:59.999Z"), validDays: 30, v4: true, changes: [],
      lines: [{ code: "INSTALLER_PRICE", description: "Insulation works by your installer — includes: Ceiling insulation - supply & install", lineTotalIncGst: 2000 }, { code: "AP_FEE", description: "Home Insulation Victoria fee", lineTotalIncGst: 349 }, { code: "PIESA", description: "Electrical safety check (PIESA)", lineTotalIncGst: 349 }],
      ownCustomer: { installerName: "Sample Insulation Co", installerLogoUrl: `${BASE}/api/public/partner-logo/TEST` } }, { cobrandApproved: true })) }),
  ENTRY({ id: "owner:sms-quote_ready", section: "owner", step: "quote", kind: "text", code: "", name: "Your quote is ready (text)", when: "Quote released to the owner", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 87 (text B)", gate: { kind: "text", smsType: "quote_ready" },
    source: { builder: "src/lib/owner-quote-email.core.ts", fn: "ownerQuoteSms", sender: "src/lib/quote-ready-notify.server.ts" },
    render: () => text(ownerQuoteSms("Helen", `${JOB}?screen=quote`)) }),
  ENTRY({ id: "owner:O19", section: "owner", step: "quote", kind: "email", code: "O19", name: "Quote reminder", when: "3 days after the quote, and 2 days before the quote expires (quotes valid 30 days; 14 if sent before the 30-day change)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decisions 88/89; Jo 2 Nov 2026 (#30): \"Your rebate\", 30-day quotes say \"Your quote is valid for 30 days, until {date}\"", gate: { kind: "email" },
    source: { builder: "src/lib/owner-quote-email.core.ts", fn: "renderQuoteReminderEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/mjml/owner_O19.mjml",
    render: () => email(renderQuoteReminderEmail({ ...QUOTE, validUntil: new Date("2026-12-10T12:59:59.999Z"), validDays: 30, kind: "day3" })) }),
  ENTRY({ id: "owner:sms-quote_reminder", section: "owner", step: "quote", kind: "text", code: "", name: "Quote reminder (text)", when: "3 days after the quote, and 2 days before the quote expires", who: "Owner", approvalNote: "Jo 24 Oct 2026, decisions 88/89; approved as is (#32, Jo 2 Nov 2026)", gate: { kind: "text", smsType: "quote_reminder" },
    source: { builder: "src/lib/approved-texts.core.ts", fn: "quoteReminderDay3Text", sender: "src/lib/approved-texts.server.ts" },
    render: () => texts([
      { label: "Day 3", body: quoteReminderDay3Text({ firstName: "Helen", rebate: 1850, link: `${JOB}?screen=quote` }) },
      { label: "2 days before expiry", body: quoteReminderExpiryText({ firstName: "Helen", rebate: 1850, heldUntilIso: "2026-11-07T12:59:59.999Z", link: `${JOB}?screen=quote` }) },
    ]) }),
  ENTRY({ id: "owner:O22", section: "owner", step: "quote", kind: "email", code: "O22", name: "You're in! (quote accepted)", when: "The owner accepts and pays the safety check; signed acceptance, receipt and the VEU factsheet (when on file) attached", who: "Owner", approvalNote: "Jo 24 Oct 2026", gate: { kind: "email" },
    source: { builder: "src/lib/acceptance-email.core.ts", fn: "renderYoureInEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/mjml/owner_O22.mjml",
    render: () => email(renderYoureInEmail({ firstName: "Helen", rebate: 1850, totalIncGst: 2200, payment: { amount: 349, paidOn: "24 Oct 2026", cardLast4: "4242" }, installerName: "Sample Insulation Co", myJobUrl: JOB })) }),
  // Safety check
  ENTRY({ id: "owner:O28", section: "owner", step: "safety_check", kind: "email", code: "O28", name: "Your safety check copy and declaration", when: "The signed PIESA is filed — only for old-flow jobs and owners on Do not contact; a new-flow owner gets the PIESA attached to \"You're clear to install\" or the electrical upgrades email instead (piesa-result-route.core)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 131", gate: { kind: "email" },
    source: { builder: "src/lib/piesa-delivery.core.ts", fn: "renderPiesaCopyEmail", sender: "src/lib/piesa-delivery.server.ts" }, design: "docs/templates/mjml/owner_O28.mjml",
    render: () => email(renderPiesaCopyEmail({ recipient: "owner", firstName: "Helen", address: SHORT_ADDRESS, jobNumber: "HV-TEST", signatureDate: "2026-11-05", installStart: INSTALL_ISO, link: `${JOB}?screen=piesa`, electrician: { name: "Spark Electrical", licence: "12345", rec: "67890" } })) }),
  ENTRY({ id: "owner:install-window", section: "owner", step: "safety_check", kind: "email", code: "", name: "Days left to book your install (30-day window)", when: "20 and 10 days left in the 30 days after the safety check, while no install day is booked", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 167", gate: { kind: "email" },
    source: { builder: "src/lib/thirty-day-rule.core.ts", fn: "ownerInstallWindowEmail", sender: "src/lib/thirty-day-rule.server.ts" },
    render: () => email(ownerInstallWindowEmail({ step: "reminder_10", deadline: "2026-12-04", daysLeft: 10, link: JOB, firstName: "Helen", installerName: "Sample Insulation Co" })) }),
  ENTRY({ id: "owner:sms-install_window_reminder", section: "owner", step: "safety_check", kind: "text", code: "", name: "Days left to book your install (text)", when: "20 and 10 days left in the 30-day window", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 167", gate: { kind: "text", smsType: "install_window_reminder" },
    source: { builder: "src/lib/thirty-day-rule.core.ts", fn: "ownerInstallWindowText", sender: "src/lib/thirty-day-rule.server.ts" },
    render: () => texts([
      { label: "20 days left", body: ownerInstallWindowText({ step: "reminder_20", deadline: "2026-12-04", daysLeft: 20, link: JOB, firstName: "Helen", installerName: "Sample Insulation Co" }) },
      { label: "10 days left", body: ownerInstallWindowText({ step: "reminder_10", deadline: "2026-12-04", daysLeft: 10, link: JOB, firstName: "Helen", installerName: "Sample Insulation Co" }) },
    ]) }),
  // Fixes
  // Install
  ENTRY({id:'owner:sms-in-house-booked',section:'owner',step:'install',kind:'text',code:'',name:"You're booked (in-house)",when:'A current in-house visit is booked',who:'Owner',approvalNote:'Jo 1 Nov Task 7',gate:{kind:'text',smsType:'in_house_booked_owner'},source:{builder:'src/lib/in-house-booking.core.ts',fn:'bookingNotice',sender:'src/lib/in-house-booking.server.ts'},render:()=>text(bookingNotice({kind:'install',start:'2026-11-05T21:00:00Z',who:{name:'Sample Lead Installer',phone:'0399999999'},installer:'Sample Insulation Co',phone:'0399999999'}).sms)}),
  ...(['request','day3','day7','paid'] as const).flatMap(step=>[
    ENTRY({id:`owner:install-deposit-${step}`,section:'owner',step:'install',kind:'email',code:'',name:step==='paid'?'Install deposit received':'10% install deposit'+(step==='request'?' request':` reminder (${step})`),when:step==='paid'?'Deposit confirmed on the installation invoice':step==='request'?'In-house PIESA passed or rectification completed':`${step} after the recorded deposit request, if unpaid`,who:'Owner',approvalNote:'Jo 1 Nov Task 6',gate:{kind:'email'},source:{builder:'src/lib/deposit-request-email.core.ts',fn:'renderInstallDepositOwnerEmail',sender:'src/lib/deposit-request.server.ts'},render:()=>email(renderInstallDepositOwnerEmail(DEPOSIT_SAMPLE,step))}),
    ENTRY({id:`owner:sms-install-deposit-${step}`,section:'owner',step:'install',kind:'text',code:'',name:'Install deposit '+step+' (text)',when:'With the matching deposit email, during daytime',who:'Owner',approvalNote:'Jo 1 Nov Task 6',gate:{kind:'text',smsType:step==='paid'?'install_deposit_paid':step==='request'?'install_deposit_request':'install_deposit_reminder'},source:{builder:'src/lib/deposit-request-email.core.ts',fn:'depositOwnerText',sender:'src/lib/deposit-request.server.ts'},render:()=>text(depositOwnerText(DEPOSIT_SAMPLE,step))}),
  ]),
  ENTRY({id:'owner:install-deposit-reminder-v2',section:'owner',step:'install',kind:'email',code:'',name:'One last step to book your install (reminder, days 3 and 7)',when:'3 and 7 days after the deposit request, if unpaid. Replaces the wording of the two reminders above once Jo flips DEPOSIT_MESSAGES_V2_APPROVED (same purpose and key). Jobs with electrical upgrades still to come leave out the opening "You\'re clear to install." sentence',who:'Owner',approvalNote:'Jo 2 Nov 2026, touchpoint 43 (dep-rem-p.png); the amount line is "{amount} inc GST" (draft for Jo)',gate:{kind:'email'},source:{builder:'src/lib/deposit-request-email.core.ts',fn:'renderInstallDepositOwnerEmail',sender:'src/lib/deposit-request.server.ts'},render:()=>email(renderInstallDepositOwnerEmail({...DEPOSIT_SAMPLE,link:`${JOB}?screen=clear`},'day3',false,true))}),
  ENTRY({id:'owner:install-deposit-received-v2',section:'owner',step:'install',kind:'email',code:'',name:'Deposit received, thanks!',when:'Deposit confirmed on the installation invoice. Replaces the Install deposit received wording once Jo flips DEPOSIT_MESSAGES_V2_APPROVED. Attaches the receipt (only with PDF_LOOK_APPROVED.receipts) and the owner-confirmed PIESA; never the ESC consent (that goes on its own at signing). Held when the installer office phone is missing. Email only',who:'Owner',approvalNote:'Jo 2 Nov 2026, touchpoint 44 (dep-paid-p.png); line order is a draft for Jo (picture not in the repo)',gate:{kind:'email'},source:{builder:'src/lib/deposit-request-email.core.ts',fn:'renderInstallDepositOwnerEmail',sender:'src/lib/deposit-request.server.ts'},render:()=>email(renderInstallDepositOwnerEmail({...DEPOSIT_SAMPLE,officePhone:'03 9000 0000',balanceCents:141200,depositCents:15700},'paid',false,true,{receiptAttached:true}))}),
  ENTRY({id:'owner:after-install-reminder',section:'owner',step:'rebate',kind:'email',code:'',name:'Just 2 things left (after-install reminder, days 1, 3 and 7)',when:'Days 1, 3 and 7 after install day, for whatever is still undone (rebate form, balance, or both), until both are done. The balance day-5 / due emails and the separate rebate-form reminders (O61) were removed 2 Nov 2026; nothing reminds the owner until Jo flips AFTER_INSTALL_REMINDERS_APPROVED. After day 7 the owner hears nothing more; the office sees "Balance overdue". Shown here: both undone, day 1; the day 3 and day 7 versions and the one-thing-left versions are listed in after-install-reminders.core.ts',who:'Owner',approvalNote:'Jo 2 Nov 2026, touchpoint 53 (bal.png): the key phrases are verbatim; the full emails, one-thing-left versions, subjects, greeting and button labels are drafts for Jo',gate:{kind:'email'},source:{builder:'src/lib/after-install-reminders.core.ts',fn:'afterInstallReminder',sender:'src/lib/after-install-reminders.server.ts'},render:()=>email(afterInstallReminder({day:1,firstName:'Sarah',balance:'$1,412.00',veecSigned:false,balancePaid:false,link:`${JOB}?screen=finish`}))}),
  ENTRY({id:'owner:sms-after_install_reminder',section:'owner',step:'rebate',kind:'text',code:'',name:'Just 2 things left (after-install reminder, text)',when:'With each after-install reminder email, during daytime. Needs its own text switch (After-install reminders · text)',who:'Owner',approvalNote:'Jo 2 Nov 2026, touchpoint 53 (bal.png): key phrases verbatim, rest a draft for Jo',gate:{kind:'text',smsType:'after_install_reminder'},source:{builder:'src/lib/after-install-reminders.core.ts',fn:'afterInstallReminder',sender:'src/lib/after-install-reminders.server.ts'},render:()=>text(afterInstallReminder({day:3,firstName:'Sarah',balance:'$1,412.00',veecSigned:false,balancePaid:false,link:`${JOB}?screen=finish`}).sms)}),
  ENTRY({id:'owner:upgrades-needed',section:'owner',step:'safety_check',kind:'email',code:'',name:'Your safety check found electrical upgrades needed',when:'New-flow PIESA found electrical upgrades still to come: the one email with the signed PIESA attached and the confirm-and-pay button. Sent instead of the standalone PIESA copy once Jo flips UPGRADES_NEEDED_EMAIL_APPROVED',who:'Owner',approvalNote:'Jo 2 Nov 2026, touchpoint 42 (upg-both.png); step 2 and the button are drafts for Jo (answer 21), as are the subject, intro line and 30-day sentence',gate:{kind:'email'},source:{builder:'src/lib/upgrades-needed.core.ts',fn:'upgradesNeededEmail',sender:'src/lib/upgrades-needed.server.ts'},render:()=>email(upgradesNeededEmail({firstName:'Helen',found:['Old wiring near the manhole','Missing safety switch'],electrician:{name:'Spark Electrical',tradingName:null,officePhone:'03 9000 0000',email:'office@spark.example'},installer:'Sample Insulation Co',installBy:'2026-12-04',depositCents:15700,confirmUrl:`${JOB}?screen=clear`}))}),
  ENTRY({id:'owner:sms-upgrades-needed',section:'owner',step:'safety_check',kind:'text',code:'',name:'Electrical upgrades needed (text)',when:'With the upgrades-needed email, during daytime',who:'Owner',approvalNote:'Jo 2 Nov 2026, touchpoint 42 (verbatim)',gate:{kind:'text',smsType:'upgrades_needed'},source:{builder:'src/lib/upgrades-needed.core.ts',fn:'upgradesNeededText',sender:'src/lib/upgrades-needed.server.ts'},render:()=>text(upgradesNeededText('Helen','Spark Electrical'))}),
  ENTRY({id:'owner:clear-to-install',section:'owner',step:'install',kind:'email',code:'',name:"You're clear to install",when:'New-flow PIESA all clear (or upgrades done on the day): the one email with the signed PIESA and ESC consent form attached and the confirm-and-pay button. Sent instead of the deposit request once Jo flips CLEAR_TO_INSTALL_EMAIL_APPROVED',who:'Owner',approvalNote:'Jo 2 Nov 2026, touchpoint 40 (clear.png); greeting, Checked on and Electrician rows are drafts for Jo',gate:{kind:'email'},source:{builder:'src/lib/deposit-request-email.core.ts',fn:'renderInstallDepositOwnerEmail',sender:'src/lib/deposit-request.server.ts'},render:()=>email(renderInstallDepositOwnerEmail({...DEPOSIT_SAMPLE,firstName:'Helen',checkedOn:'2026-11-05',electrician:'Spark Electrical',upgrades:'None',link:`${JOB}?screen=clear`,amountCents:15700},'request',true))}),
  ENTRY({ id: "owner:O35", section: "owner", step: "install", kind: "email", code: "O35", name: "Your install is booked", when: "Consent signed and the install deposit received", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 98", gate: { kind: "email" },
    source: { builder: "src/lib/install-booked-email.core.ts", fn: "renderInstallBookedEmail", sender: "src/lib/install-booked-email.server.ts" }, design: "docs/templates/mjml/owner_O35.mjml",
    render: () => email(renderInstallBookedEmail({ firstName: "Helen", when: "Wednesday 11 November at 7:30am", address: SHORT_ADDRESS, installerName: "Sample Insulation Co", installerPhone: "0400 000 000", removal: true, myJobUrl: JOB, consentSigned: true, payment: { depositPaid: 185.1, cardLast4: null, balanceDue: 1665.9 } })) }),
  ENTRY({ id: "owner:O63", section: "owner", step: "install", kind: "email", code: "O63", name: "Your signed consent form", when: "The AP signs the ESC owner's consent (executed PDF attached)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 170", gate: { kind: "email" },
    source: { builder: "src/lib/consent-copy-email.core.ts", fn: "renderConsentCopyEmail", sender: "src/lib/consent-copy-email.server.ts" }, design: "docs/templates/mjml/owner_O63.mjml",
    render: () => email(renderConsentCopyEmail({ firstName: "Helen", installationDays: ["2026-11-11"], address: ADDRESS, templateVersion: ESC_CONSENT_TEMPLATE_VERSION, formText: consentSample(), sha256: "0".repeat(64), myJobUrl: JOB, attached: true })) }),
  ENTRY({ id: "owner:O42", section: "owner", step: "install", kind: "email", code: "O42", name: "Your install day has changed", when: "The agreed install day moves", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 135", gate: { kind: "email" },
    source: { builder: "src/lib/install-days-email.core.ts", fn: "renderInstallDayChangedEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/mjml/owner_O42.mjml",
    render: () => email(renderInstallDayChangedEmail({ firstName: "Helen", installerName: "Sample Insulation Co", installerPhone: "0400 000 000", address: SHORT_ADDRESS, when: "Thursday 12 November at 7:30am", was: "Wednesday 11 November at 7:30am", myJobUrl: JOB })) }),
  ENTRY({ id: "owner:sms-install_moved", section: "owner", step: "install", kind: "text", code: "", name: "Your install has moved (text)", when: "The agreed install day moves", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 135", gate: { kind: "text", smsType: "install_moved" },
    source: { builder: "src/lib/approved-texts.core.ts", fn: "installMovedText", sender: "src/lib/approved-texts.server.ts" },
    render: () => text(installMovedText({ startIso: "2026-11-11T20:30:00Z", link: JOB })) }),
  ENTRY({ id: "owner:O64", section: "owner", step: "install", kind: "email", code: "O64", name: "Your install day was released", when: "The install deposit didn't arrive in time (48h or noon the day before)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 170", gate: { kind: "email" },
    source: { builder: "src/lib/deposit-release-notice.core.ts", fn: "renderDepositReleasedEmail", sender: "src/lib/deposit-release-notice.server.ts" }, design: "docs/templates/mjml/owner_O64.mjml",
    render: () => email(renderDepositReleasedEmail({ firstName: "Helen", day: "Wednesday 11 November", link: JOB, depositAmount: "$185.10", bankLines: bankDetailLines(HIV_BANK_DETAILS, "Home Insulation Victoria HV-TEST") })) }),
  ENTRY({ id: "owner:sms-deposit_release", section: "owner", step: "install", kind: "text", code: "", name: "Install day released (text)", when: "With O64", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 170", gate: { kind: "text", smsType: "deposit_release" },
    source: { builder: "src/lib/deposit-release-notice.core.ts", fn: "depositReleaseText", sender: "src/lib/deposit-release-notice.server.ts" },
    render: () => text(depositReleaseText({ firstName: "Helen", day: "Wednesday 11 November", link: JOB })) }),
  ENTRY({ id: "owner:O65", section: "owner", step: "install", kind: "email", code: "O65", name: "We couldn't get in today (earlier wording)", when: "Replaced 6 Nov 2026 by the (installer will call) version below (INSTALL_NO_ACCESS_V2_APPROVED on); kept for the record", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 217", gate: { kind: "email" },
    source: { builder: "src/lib/install-no-access-notice.core.ts", fn: "renderInstallNoAccessEmail", sender: "src/lib/install-no-access-notice.server.ts" }, design: "docs/templates/mjml/owner_O65.mjml",
    render: () => email(renderInstallNoAccessEmail({ firstName: "Helen", installerName: "Sample Insulation Co", day: "Wednesday 11 November", newDays: [], installBy: "4 December", link: JOB })) }),
  ENTRY({ id: "owner:sms-install_no_access", section: "owner", step: "install", kind: "text", code: "", name: "We couldn't get in today (text, earlier wording)", when: "Replaced 6 Nov 2026 by the (installer will call) text below; kept for the record", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 217", gate: { kind: "text", smsType: "install_no_access" },
    source: { builder: "src/lib/install-no-access-notice.core.ts", fn: "installNoAccessText", sender: "src/lib/install-no-access-notice.server.ts" },
    render: () => text(installNoAccessText({ firstName: "Helen", installerName: "Sample Insulation Co", newDays: [], installBy: "4 December", officePhone: "03 9000 0000", link: JOB })) }),
  ENTRY({ id: "owner:O65-v2", section: "owner", step: "install", kind: "email", code: "O65", name: "We couldn't get in today (installer will call)", when: "The installer reports no access on the install day. Replaces the O65 wording above once Jo flips INSTALL_NO_ACCESS_V2_APPROVED (same purpose and keys). Held when the installer office phone or the install-by date is missing", who: "Owner", approvalNote: "Jo 2 Nov 2026, touchpoint 51 (noacc-both.png); the call line is hers verbatim, the rest reuses the O65 wording; Jo 6 Nov 2026: on (INSTALL_NO_ACCESS_V2_APPROVED)", gate: { kind: "email" },
    source: { builder: "src/lib/install-no-access-notice.core.ts", fn: "renderInstallNoAccessEmail", sender: "src/lib/install-no-access-notice.server.ts" },
    render: () => email(renderInstallNoAccessEmail({ firstName: "Helen", installerName: "Sample Insulation Co", day: "Wednesday 11 November", officePhone: "03 9000 0000", installBy: "4 December" }, true)) }),
  ENTRY({ id: "owner:sms-install_no_access-v2", section: "owner", step: "install", kind: "text", code: "", name: "We couldn't get in today (installer will call) (text)", when: "With the O65 email above, once Jo flips INSTALL_NO_ACCESS_V2_APPROVED. No link", who: "Owner", approvalNote: "Jo 2 Nov 2026, touchpoint 51; \"Install by {date} (30-day rule).\" is a draft for Jo", gate: { kind: "text", smsType: "install_no_access" },
    source: { builder: "src/lib/install-no-access-notice.core.ts", fn: "installNoAccessText", sender: "src/lib/install-no-access-notice.server.ts" },
    render: () => text(installNoAccessText({ firstName: "Helen", installerName: "Sample Insulation Co", officePhone: "03 9000 0000", installBy: "4 December" }, true)) }),
  ENTRY({ id: "owner:visit-cancelled", section: "owner", step: "any", kind: "email", code: "", name: "Your visit can't go ahead", when: "A trade drops a booked visit (\"Can't do this one\" after a booking), straight away, before the office decides who takes it. Email only. Held until Jo flips VISIT_CANCELLED_OWNER_APPROVED; Do not contact stops it", who: "Owner", approvalNote: "Jo 2 Nov 2026, answer 4: the line is hers verbatim; the subject and \"Hi {first},\" are drafts for Jo (VISIT_CANCELLED_OWNER_APPROVED, off)", gate: { kind: "email" },
    source: { builder: "src/lib/visit-cancelled-owner.core.ts", fn: "visitCancelledOwnerEmail", sender: "src/lib/visit-cancelled-owner.server.ts" },
    render: () => email(visitCancelledOwnerEmail({ firstName: "Helen", startIso: "2026-11-12T21:00:00Z" })) }),
  ENTRY({ id: "owner:non-compliance", section: "owner", step: "any", kind: "email", code: "", name: "Something on your job didn't meet the rules", when: "Only when the office presses \"Tell the owner: something didn't comply\" on the job page (same day, no automatic trigger, no installer button). One email per note. A compliance send: still goes with Do not contact on and to an unsubscribed owner. Held until Jo flips NON_COMPLIANCE_NOTICE_APPROVED; held with an office note if the installer has no office phone or business email", who: "Owner", approvalNote: "Jo 2 Nov 2026, answer 9 (cl 27); the whole wording is a draft for Jo (NON_COMPLIANCE_NOTICE_APPROVED; Jo 6 Nov 2026: on)", gate: { kind: "email" },
    source: { builder: "src/lib/non-compliance-notice.core.ts", fn: "nonComplianceNotice", sender: "src/lib/non-compliance-notice.server.ts" },
    render: () => email(nonComplianceNotice({ firstName: "Helen", what: "the insulation near a downlight was installed too close", fix: "we will move it back to the right distance", contact: { name: "Sample Insulation Co", tradingName: null, officePhone: "03 9000 0000", email: "office@sample.example" } }) as { subject: string; html: string }) }),
  // Rebate
  ENTRY({ id: "owner:O44", section: "owner", step: "rebate", kind: "email", code: "O44", name: "All done! Sign your rebate form", when: "Install complete (day 0 of the rebate form asks). Replaced by the one All done email below once Jo flips ALL_DONE_V2_APPROVED", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 169", gate: { kind: "email" },
    source: { builder: "src/lib/completion-emails.core.ts", fn: "renderInstallCompleteEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/mjml/owner_O44.mjml",
    render: () => email(renderInstallCompleteEmail({ firstName: "Helen", installer: REINSULATE, product: "Bradford Gold R5.0", areaM2: 137.6, rebate: 1850, balancePaid: true, signRebateFormUrl: `${JOB}?screen=done` }, false)) }),
  ENTRY({ id: "owner:all-done-v2", section: "owner", step: "rebate", kind: "email", code: "", name: "All done. Enjoy a warmer home! (one email, paid or not)", when: "Install complete. Replaces O44 above AND the O45 final invoice once Jo flips ALL_DONE_V2_APPROVED (same purpose and key). Carries the tax invoice, the rebate form to read, the product warranty and the manufacturer's instructions (only the PDFs that exist), whether or not the balance is paid. Held when the installer's or electrician's office phone/email is missing", who: "Owner", approvalNote: "Jo 2 Nov 2026, touchpoint 52 (done2.png); the \"Attached:\" line, the \"Your contacts\" box, \"One last thing\" when nothing is owed and \"Takes about a minute.\" are drafts for Jo (ALL_DONE_V2_APPROVED, off)", gate: { kind: "email" },
    source: { builder: "src/lib/completion-emails.core.ts", fn: "renderInstallCompleteEmail", sender: "src/lib/approved-owner-emails.server.ts" },
    render: () => email(renderInstallCompleteEmail({ firstName: "Sarah", installer: REINSULATE, product: "Bradford Gold R5.0", areaM2: 120, rebate: 2380, balancePaid: false, balanceCents: 141200, signRebateFormUrl: `${JOB}?screen=finish`, signAndPayUrl: `${JOB}?screen=finish`,
      contacts: { ap: HIV_AP_CONTACT, installer: { name: "Sample Insulation Co", tradingName: null, officePhone: "03 9000 0001", email: "office@sample.example" }, electrician: { name: "Sample Electrical", tradingName: null, officePhone: "03 9000 0002", email: "office@sparks.example" } },
      attached: { taxInvoice: true, rebateForm: true, warranty: true, instructions: true } }, true)) }),
  ENTRY({ id: "owner:sms-veec_sign_request", section: "owner", step: "rebate", kind: "text", code: "", name: "Sign your rebate form (text)", when: "Install complete", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 166", gate: { kind: "text", smsType: "veec_sign_request" },
    source: { builder: "src/lib/veec-assignment-form.core.ts", fn: "veecSignRequestText", sender: "src/lib/veec-reminders.server.ts" },
    render: () => text(veecSignRequestText(1850, `${JOB}?screen=done`)) }),
  ENTRY({ id: "owner:O62", section: "owner", step: "rebate", kind: "email", code: "O62", name: "Here's your signed rebate form", when: "Within 10 business days of the owner signing (executed PDF attached)", who: "Owner", approvalNote: "Jo 24 Oct 2026", gate: { kind: "email" },
    source: { builder: "src/lib/veec-emails.core.ts", fn: "renderVeecCopyEmail", sender: "src/lib/veec-copy-email.server.ts" }, design: "docs/templates/mjml/owner_O62.mjml",
    render: () => email(renderVeecCopyEmail({ firstName: "Helen", jobNumber: "HV-TEST", signedAt: "2026-11-21T03:00:00.000Z", myJobUrl: `${JOB}?screen=done`, unsubscribeUrl: UNSUB })) }),
  // Paid
  ENTRY({ id: "owner:O47", section: "owner", step: "paid", kind: "email", code: "O47", name: "Your completion pack", when: "Install complete and the invoice paid (product warranty PDF attached)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 276", gate: { kind: "email" },
    source: { builder: "src/lib/completion-emails.core.ts", fn: "renderCompletionPackEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/mjml/owner_O47.mjml",
    render: () => email(renderCompletionPackEmail({ firstName: "Helen", installer: REINSULATE, downloads: { certificateUrl: null, invoiceUrl: null, warrantiesUrl: null, signedFormsUrl: null }, installed: { description: "Ceiling insulation — Bradford Gold Ceiling Batt R5.0 — 137.6 m²", escModelCodes: ["467911"] } })) }),
  ENTRY({ id: "owner:O73", section: "owner", step: "paid", kind: "email", code: "O73", name: "Your insulation warranty", when: "A product warranty PDF that was missing from the completion pack is added later", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 375", gate: { kind: "email" },
    source: { builder: "src/lib/warranty-followup.core.ts", fn: "renderWarrantyFollowupEmail", sender: "src/lib/warranty-followup.server.ts" }, design: "docs/templates/mjml/owner_O73.mjml",
    render: () => email(renderWarrantyFollowupEmail({ firstName: "Helen", products: ["Bradford Gold"], unsubscribeUrl: null })) }),
  ENTRY({ id: "owner:O51", section: "owner", step: "paid", kind: "email", code: "O51", name: "How's your home feeling? (review)", when: "A week after the install", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 335", gate: { kind: "email" },
    source: { builder: "src/lib/completion-emails.core.ts", fn: "renderReviewRequestEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/mjml/owner_O51.mjml",
    render: () => email(renderReviewRequestEmail({ firstName: "Helen", installer: REINSULATE, starUrl: (n) => `${JOB}?screen=review&stars=${n}`, googleReviewUrl: "https://g.page/r/TEST/review", referralUrl: "https://homeinsulationvictoria.com.au/homeowner?ref=TEST" })) }),
  // Any time
  ENTRY({ id: "owner:change-reply", section: "owner", step: "any", kind: "email", code: "", name: "Change or cancel reply", when: "A matched owner emails to change a visit day/time or cancel: ONE reply with the installer's or electrician's office phone", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 337; wording Jo 2 Nov 2026, decisions 54–58", gate: { kind: "email" },
    source: { builder: "src/lib/email-change-reply.core.ts", fn: "renderChangeReplyEmail", sender: "src/lib/email-change-reply.server.ts" },
    render: () => email(renderChangeReplyEmail({ firstName: "Helen", visit: "install", business: "Rapid Insulation", officePhone: "03 9000 0000", theirSubject: "Change of install day", unsubscribe: null })) }),
  ENTRY({ id: "owner:O69", section: "owner", step: "any", kind: "email", code: "O69", name: "Job cancelled", when: "The office cancels the job with the owner tick on", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 291", gate: { kind: "email" },
    source: { builder: "src/lib/cancel-notice.core.ts", fn: "renderOwnerCancelledEmail", sender: "src/lib/cancel-notice.server.ts" }, design: "docs/templates/mjml/owner_O69.mjml",
    render: () => email(renderOwnerCancelledEmail({ firstName: "Helen", jobNumber: "HV-TEST", address: ADDRESS, officePhone: "03 9000 0000" })) }),
  // Decision 384 (Jo 25 Oct 2026): approved as drafted in decision 376.
  ENTRY({ id: "owner:O74", section: "owner", step: "any", kind: "email", code: "O74", name: "Your visit needs a new time", when: "The trade cancels a booked Ready Check, safety check or install day: owner chooses new times on My job", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 384 (drafted in decision 376)", gate: { kind: "email" },
    source: { builder: "src/lib/visit-new-times.core.ts", fn: "renderVisitNewTimesEmail", sender: "src/lib/visit-new-times.server.ts" }, design: "docs/templates/mjml/owner_O74.mjml",
    render: () => email(renderVisitNewTimesEmail({ kind: "assessment", wasIso: PIESA_ISO, ownerPicks: true, link: `${JOB}?screen=book`, firstName: "Helen", unsubscribeUrl: null })) }),
  ENTRY({ id: "owner:O74b", section: "owner", step: "any", kind: "email", code: "O74b", name: "Your visit is moving (new times on the way)", when: "The trade cancels a booked visit and will offer the new times", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 384 (drafted in decision 376)", gate: { kind: "email" },
    source: { builder: "src/lib/visit-new-times.core.ts", fn: "renderVisitNewTimesEmail", sender: "src/lib/visit-new-times.server.ts" }, design: "docs/templates/mjml/owner_O74b.mjml",
    render: () => email(renderVisitNewTimesEmail({ kind: "installation", wasIso: INSTALL_ISO, ownerPicks: false, link: `${JOB}?screen=book`, firstName: "Helen", unsubscribeUrl: null })) }),
  ENTRY({ id: "owner:sms-visit_new_times", section: "owner", step: "any", kind: "text", code: "", name: "Your visit needs a new time (text)", when: "With O74 / O74b", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 384 (drafted in decision 376)", gate: { kind: "text", smsType: "visit_new_times" },
    source: { builder: "src/lib/visit-new-times.core.ts", fn: "visitNewTimesText", sender: "src/lib/visit-new-times.server.ts" },
    render: () => texts([
      { label: "Owner picks new times", body: visitNewTimesText({ kind: "assessment", wasIso: PIESA_ISO, ownerPicks: true, link: `${JOB}?screen=book` }) },
      { label: "New times on the way", body: visitNewTimesText({ kind: "installation", wasIso: INSTALL_ISO, ownerPicks: false, link: `${JOB}?screen=book` }) },
    ]) }),
  ENTRY({ id: "owner:signing-code", section: "owner", step: "any", kind: "email", code: "", name: "Your signing code (email)", when: "The owner asks for a 6-digit code to sign on My job", who: "Owner", approvalNote: "Jo (sign-in code wording)", gate: { kind: "always" },
    source: { builder: "src/lib/owner-code-delivery.core.ts", fn: "ownerCodeEmail", sender: "src/lib/owner-code-delivery.server.ts" },
    render: () => email({ subject: "Your signing code", html: ownerCodeEmail("123456").html }) }),
  ENTRY({ id: "owner:sms-owner_code", section: "owner", step: "any", kind: "text", code: "", name: "Your signing code (text)", when: "The owner asks for a 6-digit code to sign on My job", who: "Owner", approvalNote: "Jo (sign-in code wording)", gate: { kind: "text", smsType: "owner_code" },
    source: { builder: "src/lib/owner-code-delivery.core.ts", fn: "ownerCodeSmsBody", sender: "src/lib/owner-code-delivery.server.ts" },
    render: () => text(ownerCodeSmsBody("123456")) }),
  // My job pages (approved mock-ups the live page copies byte-for-byte; owner-pages.core.test proves the wording)
  ...([["P1", "enquiry", "Tell us about your insulation (questions page)", "The O2 questions link", "P1-questions-page.html"],
    ["P2", "quote", "View and accept your quote", "The O18 quote link (?screen=quote)", "P2-quote-accept-page.html"],
    ["P6", "safety_check", "Confirm your safety check", "Old ?screen=piesa links; the confirm-and-pay page (?screen=clear) covers it for new jobs", "P6-piesa-confirm-page.html"],
    ["P4", "rebate", "Sign your rebate form (VEEC assignment)", "The O44 link after the install (old ?screen=done links; the All done sign-and-pay page covers it for new jobs)", "P4-veec-sign-page.html"]] as const).map(([code, step, name, when, file]) =>
    ENTRY({ id: `owner:${code}`, section: "owner", step, kind: "page", code, name, when, who: "Owner (My job link)", approvalNote: code === "P2" ? "Jo 2 Nov 2026, decisions #29/#33 (two ticks, typed name, 30-day line; design mock-up updated to match)" : "Jo 24 Oct 2026, decisions 125–130", gate: { kind: "always" },
      source: { builder: "src/lib/owner-pages.core.ts", fn: code, sender: "src/routes/my-job.$token.tsx" }, design: `docs/templates/owner/${file}`,
      render: () => ({ kind: "file", path: `docs/templates/owner/${file}`, as: "html", note: "Jo's approved page design. The live My job page uses this wording byte-for-byte (owner-pages.core.ts, tested by tests/owner-pages.core.test.ts)." }) })),
  // Owner paperwork (Gate B, current versions)
  ...GATE_DOCS.filter((d) => d.gate === "B" && !RETIRED_DOC_KEYS.has(d.key)).map((d) =>
    ENTRY({ id: `owner:paperwork:${d.key}`, section: "owner", step: "quote", kind: "paperwork", code: "", name: `Paperwork: ${d.title}`, when: d.signer === "office" ? "Gate B (before the install is booked) — the office records it" : "Gate B: signed or ticked by the owner on My job before the install is booked", who: d.signer === "office" ? "Office records (owner's landlord)" : "Owner", approvalNote: d.approvalNote ?? `Version ${d.version}: approval stored in Settings › Owner paperwork`, gate: { kind: "always" },
      source: { builder: "src/lib/owner-gates.core.ts", fn: "GATE_DOCS", sender: "src/lib/owner-gates.server.ts" }, paperworkKey: d.key,
      render: () => ({ kind: "doc", title: `${d.title} — ${ownerVersionLabel(d.version)}`, body: `${d.key === "payment_terms" ? paymentTermsText(paymentTermsMoney({ quoteTotalCents: 220000, safetyCheckCents: 34900, installDepositCents: 18510, balanceCents: 166590 })) : fillTemplate(d.body, SAMPLE_VARS)}\n\n[ ] ${d.tick}`, note: "Sample values filled in. The tick label is what the owner presses." }) })),
  // Main #125 (Jo 30 Oct / 2 Nov 2026): the owner's email after a quick-taps decline — one entry per outcome (same builder). Listed at the 4 Nov join.
  ...([["decline_access", "no roof access"], ["decline_5yr", "built or ceiling replaced in the last 5 years"], ["no_thanks", "no thanks"]] as const).map(([outcome, label]) => ENTRY({
    id: `owner:quick-taps-decline-${outcome}`, section: "owner", step: "ready_check", kind: "email", code: "", name: `Your free Ready Check — after a quick-taps decline (${label})`, when: `The owner's quick taps end with "${label}"; once per job and batch`, who: "Owner", approvalNote: "Body line Jo's verbatim (spec part 1); subject and greeting approved by Jo 30 Oct 2026", gate: { kind: "email" },
    source: { builder: "src/lib/quick-taps-email.core.ts", fn: "renderQuickTapsDeclineEmail", sender: "src/lib/quick-taps.server.ts" },
    render: () => email(renderQuickTapsDeclineEmail({ outcome, firstName: "Helen", unsubscribeUrl: UNSUB })) })),
  // Decision 389: Jo releases a saved spot → "It's your turn" to the owner (email + text, day-2 reminder). Approved by Jo 25 Oct 2026.
  ENTRY({ id: "owner:O77", section: "owner", step: "ready_check", kind: "email", code: "O77", name: "It's your turn — confirm your free Ready Check", when: "Jo taps Send on a suggested batch (Jobs › Choose installer) and the day-2 reminder; the button opens the quick taps; the installer is offered the job only after the owner answers", who: "Owner", approvalNote: "Wording: Jo 2 Nov 2026, decisions #21/#22 (IT_IS_YOUR_TURN_V2_APPROVED stays false until Jo OKs the pictures)", gate: { kind: "email" },
    source: { builder: "src/lib/spot-release-email.core.ts", fn: "renderSpotReleasedEmail", sender: "src/lib/area-batch.server.ts" }, design: "docs/templates/mjml/owner_O77.mjml",
    render: () => email(renderSpotReleasedEmail({ firstName: "Helen", confirmUrl: quickTapsLink(JOB), unsubscribeUrl: UNSUB, reminder: false })) }),
  // Batch 3a: an expired installation quote closes the job; the owner gets one email with "Send me a new quote". Approved by Jo 29 Oct 2026.
  ENTRY({ id: "owner:O78", section: "owner", step: "quote", kind: "email", code: "O78", name: "Your quote has expired", when: "The quote timer expires an installation quote at the end of day 30 (day 14 if sent before the 30-day change) and the job has no other live quote (the job closes; sent once)", who: "Owner", approvalNote: "Jo 29 Oct 2026", gate: { kind: "email" },
    source: { builder: "src/lib/quote-expired-email.core.ts", fn: "renderQuoteExpiredEmail", sender: "src/lib/quote-expired-email.server.ts" }, design: "docs/templates/mjml/owner_O78.mjml",
    render: () => email(renderQuoteExpiredEmail({ firstName: "Helen", address: "12 Example St, Sampletown", link: `${JOB}?screen=newquote`, unsubscribeUrl: UNSUB })) }),
  ENTRY({ id: "owner:sms-spot_released", section: "owner", step: "ready_check", kind: "text", code: "", name: "It's your turn (text)", when: "With O77 and its day-2 reminder (opens the quick taps)", who: "Owner", approvalNote: "Wording: Jo 2 Nov 2026, decision #22 (IT_IS_YOUR_TURN_V2_APPROVED stays false until Jo OKs the pictures)", gate: { kind: "text", smsType: "spot_released" },
    source: { builder: "src/lib/spot-release.core.ts", fn: "spotReleasedText", sender: "src/lib/area-batch.server.ts" },
    render: () => texts([{ label: "Released", body: spotReleasedText("Helen", quickTapsLink(JOB)) }, { label: "Day-2 reminder", body: spotReleasedText("Helen", quickTapsLink(JOB), true) }]) }),
  // Decision #23 (Jo 2 Nov 2026): Jo gives the job to an in-house installer → "{Installer} will call you" (email + text) with
  // the installer's OFFICE phone; replaces the draft DB template in_house_partner_will_call. Off until Jo OKs the pictures.
  ENTRY({ id: "owner:will-call", section: "owner", step: "ready_check", kind: "email", code: "", name: "{Installer} will call you", when: "Jo gives the job to an in-house installer (batch Send to installer); held with an office note if the installer has no office phone or business email", who: "Owner", approvalNote: "Wording: Jo 2 Nov 2026, decision #23 + Fix 5 (OWNER_WILL_CALL_APPROVED stays false until Jo OKs the pictures)", gate: { kind: "email" },
    source: { builder: "src/lib/owner-will-call.core.ts", fn: "ownerWillCallEmail", sender: "src/lib/in-house-batch-email.server.ts" },
    render: () => email(ownerWillCallEmail({ firstName: "Helen", installer: WILL_CALL_SAMPLE, unsubscribeUrl: UNSUB }) as { subject: string; html: string }) }),
  ENTRY({ id: "owner:sms-owner_will_call", section: "owner", step: "ready_check", kind: "text", code: "", name: "{Installer} will call you (text)", when: "With the \"will call you\" email", who: "Owner", approvalNote: "Wording: Jo 2 Nov 2026, decision #23 (OWNER_WILL_CALL_APPROVED stays false until Jo OKs the pictures)", gate: { kind: "text", smsType: "owner_will_call" },
    source: { builder: "src/lib/owner-will-call.core.ts", fn: "ownerWillCallText", sender: "src/lib/in-house-batch-email.server.ts" },
    render: () => text(ownerWillCallText("Helen", WILL_CALL_SAMPLE) as string) }),
  // Task 19 (Jo 2 Nov 2026, answer 24): an installer's OWN customer is texted the rental quick taps right after Add a job.
  // DRAFT wording: OWN_CUSTOMER_RENTAL_TAPS_APPROVED stays false and the SMS type is wordingApproved:false (new switch off).
  ENTRY({ id: "owner:sms-own_customer_rental_taps", section: "owner", step: "ready_check", kind: "text", code: "", name: "A few quick questions about your home (text, installer's own customer)", when: "Right after the installer adds the job (Add a job); opens only the rental screens: \"Who should we arrange access with?\" and their details", who: "Owner", approvalNote: "DRAFT wording for Jo to approve (answer 24, 2 Nov 2026); OWN_CUSTOMER_RENTAL_TAPS_APPROVED stays false", gate: { kind: "text", smsType: "own_customer_rental_taps" },
    source: { builder: "src/lib/rental-answers.core.ts", fn: "ownCustomerRentalTapsText", sender: "src/lib/own-customer-rental-taps.server.ts" },
    render: () => text(ownCustomerRentalTapsText({ firstName: "Helen", installer: "Sample Insulation", link: rentalOnlyLink(quickTapsLink(`${EST}/my-job/TOKEN`)) })) }),
  // G8 (4) owner Ready Check window text + email: RETIRED 5 Nov 2026 (Jo: "we don't have the installer's times"; the installer
  // calls to book). OWNER_WINDOW_CONFIRM_APPROVED stays false for good — real owners never get these; listed so the page says so.
  ENTRY({ id: "owner:sms-ready_check_window", section: "owner", step: "ready_check", kind: "text", code: "", name: "RETIRED — owner Ready Check window (text)", when: "Never. Retired 5 Nov 2026: the portal doesn't know the installer's times, so no owner is told a window — the installer calls to book", who: "Owner", approvalNote: "RETIRED (Jo 5 Nov 2026). OWNER_WINDOW_CONFIRM_APPROVED stays false for good", gate: { kind: "code_off", flag: "OWNER_WINDOW_CONFIRM_APPROVED" },
    source: { builder: "src/lib/ready-check-window-notice.core.ts", fn: "readyCheckWindowText", sender: "src/lib/installer-run.server.ts" },
    render: () => text(readyCheckWindowText({ name: "Helen", day: "Tuesday 10 November", time: "between 9:00 and 10:00am", installer: "Sample Insulation", link: `${EST}/my-job/TOKEN?screen=book`, team: false })) }),
  ENTRY({ id: "owner:ready-check-window", section: "owner", step: "ready_check", kind: "email", code: "", name: "RETIRED — owner Ready Check window (email)", when: "Never (see the text above)", who: "Owner", approvalNote: "RETIRED (Jo 5 Nov 2026). OWNER_WINDOW_CONFIRM_APPROVED stays false for good", gate: { kind: "code_off", flag: "OWNER_WINDOW_CONFIRM_APPROVED" },
    source: { builder: "src/lib/ready-check-window-notice.core.ts", fn: "readyCheckWindowEmail", sender: "src/lib/installer-run.server.ts" },
    render: () => email(readyCheckWindowEmail({ name: "Helen", day: "Tuesday 10 November", time: "between 9:00 and 10:00am", installer: "Sample Insulation", link: `${EST}/my-job/TOKEN?screen=book`, team: false })) }),
  // Decision #24 + Fix 5 (Jo 2 Nov 2026): in-house Ready Check booked → "You're booked" (email + text) with the installer's
  // OFFICE phone, contact block and AP line; same purpose/key as the current in-house wording, which keeps going out
  // until OWNER_BOOKED_READY_CHECK_APPROVED is on. Held with an office note if the office phone or business email is missing.
  ENTRY({ id: "owner:booked-ready-check", section: "owner", step: "ready_check", kind: "email", code: "", name: "You're booked for your free Ready Check", when: "The installer books the Ready Check (or changes its time — \"Your time has changed\"); held with an office note if the installer has no office phone or business email", who: "Owner", approvalNote: "Wording: Jo 2 Nov 2026, decision #24 + Fix 5 (OWNER_BOOKED_READY_CHECK_APPROVED stays false until Jo OKs the pictures)", gate: { kind: "email" },
    source: { builder: "src/lib/in-house-booking.core.ts", fn: "ownerBookedMessage", sender: "src/lib/in-house-booking.server.ts" },
    render: () => email(ownerBookedMessage(BOOKED_SAMPLE, BOOKED_ON) as { subject: string; html: string }) }),
  ENTRY({ id: "owner:sms-booked-ready-check", section: "owner", step: "ready_check", kind: "text", code: "", name: "You're booked for your free Ready Check (text)", when: "With the Ready Check \"You're booked\" email", who: "Owner", approvalNote: "Wording: Jo 2 Nov 2026, decision #24 (OWNER_BOOKED_READY_CHECK_APPROVED stays false until Jo OKs the pictures)", gate: { kind: "text", smsType: "in_house_booked_owner" },
    source: { builder: "src/lib/in-house-booking.core.ts", fn: "ownerBookedMessage", sender: "src/lib/in-house-booking.server.ts" },
    render: () => text((ownerBookedMessage(BOOKED_SAMPLE, BOOKED_ON) as { sms: string }).sms) }),
  // Part 4 Task 1 — #38 PIESA and #46 install: the same layout, same purpose and key; the current in-house wording keeps going
  // out until the flag is on. PIESA: the ELECTRICIAN's office phone on the change line; the 30-day rule names the installer.
  ENTRY({ id: "owner:booked-piesa", section: "owner", step: "safety_check", kind: "email", code: "", name: "You're booked for your electrical safety check (PIESA)", when: "The electrician is booked for the PIESA (or the time changes — \"Your time has changed\"); held with an office note if the electrician has no office phone or business email", who: "Owner", approvalNote: "Wording: Jo 2 Nov 2026, decision #38 (OWNER_BOOKED_PIESA_APPROVED stays false until Jo OKs the pictures)", gate: { kind: "email" },
    source: { builder: "src/lib/in-house-booking.core.ts", fn: "ownerBookedMessage", sender: "src/lib/in-house-booking.server.ts" },
    render: () => email(ownerBookedMessage(BOOKED_PIESA_SAMPLE, BOOKED_ON) as { subject: string; html: string }) }),
  ENTRY({ id: "owner:sms-booked-piesa", section: "owner", step: "safety_check", kind: "text", code: "", name: "You're booked for your electrical safety check (PIESA) (text)", when: "With the PIESA \"You're booked\" email", who: "Owner", approvalNote: "Wording: Jo 2 Nov 2026, decision #38 (OWNER_BOOKED_PIESA_APPROVED stays false until Jo OKs the pictures)", gate: { kind: "text", smsType: "in_house_booked_owner" },
    source: { builder: "src/lib/in-house-booking.core.ts", fn: "ownerBookedMessage", sender: "src/lib/in-house-booking.server.ts" },
    render: () => text((ownerBookedMessage(BOOKED_PIESA_SAMPLE, BOOKED_ON) as { sms: string }).sms) }),
  ENTRY({ id: "owner:booked-install", section: "owner", step: "install", kind: "email", code: "", name: "You're booked for your insulation install", when: "The installer books the install day (or the time changes — \"Your time has changed\"); held with an office note if the installer has no office phone or business email, or the balance is not on file", who: "Owner", approvalNote: "Wording: Jo 2 Nov 2026, decision #46, no install duration (OWNER_BOOKED_INSTALL_APPROVED stays false until Jo OKs the pictures)", gate: { kind: "email" },
    source: { builder: "src/lib/in-house-booking.core.ts", fn: "ownerBookedMessage", sender: "src/lib/in-house-booking.server.ts" },
    render: () => email(ownerBookedMessage(BOOKED_INSTALL_SAMPLE, BOOKED_ON) as { subject: string; html: string }) }),
  ENTRY({ id: "owner:sms-booked-install", section: "owner", step: "install", kind: "text", code: "", name: "You're booked for your insulation install (text)", when: "With the install \"You're booked\" email", who: "Owner", approvalNote: "Wording: Jo 2 Nov 2026, decision #46 (OWNER_BOOKED_INSTALL_APPROVED stays false until Jo OKs the pictures)", gate: { kind: "text", smsType: "in_house_booked_owner" },
    source: { builder: "src/lib/in-house-booking.core.ts", fn: "ownerBookedMessage", sender: "src/lib/in-house-booking.server.ts" },
    render: () => text((ownerBookedMessage(BOOKED_INSTALL_SAMPLE, BOOKED_ON) as { sms: string }).sms) }),
  // Part 4 Task 15 (Jo 2 Nov 2026, answer 7): when the home is rented and the TENANT or PROPERTY MANAGER lets the trades in,
  // they get the PIESA / install "You're booked" text and the day-before text (visit-time texts only; the owner still gets
  // everything). DRAFT: the owner's approved texts with their first name — ACCESS_PERSON_TEXTS_APPROVED stays false.
  ENTRY({ id: "owner:sms-access_person_booked", section: "waiting", approval: "waiting", step: "safety_check", kind: "text", code: "", name: "You're booked (text to the person who lets the trades in)", when: "With the owner's PIESA / install \"You're booked\" text, when the owner said a tenant or property manager lets us in (rental quick taps)", who: "Tenant or property manager", approvalNote: "DRAFT: Jo's 3 Nov 23:18 reword (\"the … at {street} is booked for …\", never \"your\"); ACCESS_PERSON_TEXTS_APPROVED stays false", gate: { kind: "text", smsType: "access_person_booked" },
    source: { builder: "src/lib/access-person-texts.core.ts", fn: "accessPersonBookedText", sender: "src/lib/access-person-texts.server.ts" },
    render: () => texts([
      { label: "Safety check (tenant)", body: S(accessPersonBookedText({ kind: "piesa", firstName: null, startIso: BOOKED_PIESA_SAMPLE.start, whoName: "Sample Electrician", business: BOOKED_PIESA_SAMPLE.business, changed: false, street: "824 High Street Road" }, ACCESS_TENANT)) },
      { label: "Install day (property manager)", body: S(accessPersonBookedText({ kind: "install", firstName: null, startIso: BOOKED_INSTALL_SAMPLE.start, whoName: "Sample Lead Installer", business: WILL_CALL_SAMPLE, changed: false, street: "824 High Street Road" }, ACCESS_PM)) },
    ]) }),
  ENTRY({ id: "owner:sms-access_person_tomorrow", section: "waiting", approval: "waiting", step: "safety_check", kind: "text", code: "", name: "See you tomorrow (text to the person who lets the trades in)", when: "From 4pm the afternoon before the safety check or the install, when a tenant or property manager lets us in", who: "Tenant or property manager", approvalNote: "DRAFT: Jo's 3 Nov 23:18 reword (\"{Business} is coming tomorrow at … for the … at {street}\"); ACCESS_PERSON_TEXTS_APPROVED stays false", gate: { kind: "text", smsType: "access_person_tomorrow" },
    source: { builder: "src/lib/access-person-texts.core.ts", fn: "accessPersonTomorrowText", sender: "src/lib/access-person-texts.server.ts" },
    render: () => texts([
      { label: "Safety check (tenant)", body: S(accessPersonTomorrowText({ kind: "piesa", time: melbourneClock(BOOKED_PIESA_SAMPLE.start), business: BOOKED_PIESA_SAMPLE.business, street: "824 High Street Road" }, ACCESS_TENANT)) },
      { label: "Install day (property manager)", body: S(accessPersonTomorrowText({ kind: "install", time: melbourneClock(BOOKED_INSTALL_SAMPLE.start), business: WILL_CALL_SAMPLE, street: "824 High Street Road" }, ACCESS_PM)) },
    ]) }),
  // Part 4 Task 16 (cl 23; Jo 2 Nov 2026, answers 7 and 22): the TENANT is told the install day, time and power-off by text AND
  // email once the install is booked and whenever its time changes. Compliance send. Jo 6 Nov 2026: on (TENANT_NOTICE_APPROVED).
  ENTRY({ id: "owner:tenant-notice", section: "owner", step: "install", kind: "email", code: "", name: "Your install day is booked (email to the tenant, cl 23)", when: "The install day is booked, and again when its time changes; the home is rented (owner's quick taps). Held with one Needs me row when the tenant's details are missing", who: "Tenant", approvalNote: "Jo 6 Nov 2026: on (cl 23, answers 7/22, Jo 2 Nov 2026; TENANT_NOTICE_APPROVED)", gate: { kind: "email" },
    source: { builder: "src/lib/tenant-notice.core.ts", fn: "tenantNotice", sender: "src/lib/tenant-notice.server.ts" },
    render: () => email((tenantNotice({ firstName: "Tina", address: ADDRESS, startIso: BOOKED_INSTALL_SAMPLE.start, business: WILL_CALL_SAMPLE }) as { email: { subject: string; html: string } }).email) }),
  ENTRY({ id: "owner:sms-tenant_notice", section: "owner", step: "install", kind: "text", code: "", name: "Your install day is booked (text to the tenant, cl 23)", when: "With the tenant's email, always both", who: "Tenant", approvalNote: "Jo 6 Nov 2026: on (cl 23, answers 7/22, Jo 2 Nov 2026; TENANT_NOTICE_APPROVED)", gate: { kind: "text", smsType: "tenant_notice" },
    source: { builder: "src/lib/tenant-notice.core.ts", fn: "tenantNotice", sender: "src/lib/tenant-notice.server.ts" },
    render: () => text((tenantNotice({ firstName: "Tina", address: ADDRESS, startIso: BOOKED_INSTALL_SAMPLE.start, business: WILL_CALL_SAMPLE }) as { sms: string }).sms) }),
  // Fix round 1 (controller ruling 2 Nov 2026): releases made with the old Release step keep the wording Jo approved for
  // them (decision 389, 25 Oct 2026) for their day-2 reminder / 7am text — unchanged, not behind IT_IS_YOUR_TURN_V2_APPROVED.
  ENTRY({ id: "owner:O77-legacy", section: "owner", step: "ready_check", kind: "email", code: "O77", name: "It's your turn — confirm your free Ready Check (old Release step)", when: "Releases Jo made with the old Release step before 2 Nov 2026: their day-2 reminder (the page opens ?screen=turn)", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 389", gate: { kind: "email" },
    source: { builder: "src/lib/spot-release-email.core.ts", fn: "renderLegacySpotReleasedEmail", sender: "src/lib/spot-release.server.ts" },
    render: () => email(renderLegacySpotReleasedEmail({ firstName: "Helen", confirmUrl: `${JOB}?screen=turn`, unsubscribeUrl: UNSUB, reminder: false })) }),
  ENTRY({ id: "owner:sms-spot_released-legacy", section: "owner", step: "ready_check", kind: "text", code: "", name: "It's your turn (text, old Release step)", when: "With the old-Release O77 and its day-2 reminder", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 389", gate: { kind: "text", smsType: "spot_released" },
    source: { builder: "src/lib/spot-release.core.ts", fn: "legacySpotReleasedText", sender: "src/lib/spot-release.server.ts" },
    render: () => texts([{ label: "Released", body: legacySpotReleasedText(`${JOB}?screen=turn`) }, { label: "Day-2 reminder", body: legacySpotReleasedText(`${JOB}?screen=turn`, true) }]) }),
  // Plan 2026-10-28 (full address required): a website/email enquiry with no street → the owner is asked to pick their
  // full address on their secure page, then ONE reminder 24h later. Wording approved by Jo 28 Oct 2026.
  ENTRY({ id: "owner:address-request", section: "owner", step: "enquiry", kind: "email", code: "", name: "We need your full address (+ 24h reminder)", when: "A website/email enquiry arrives with no street (after go-live); ONE reminder 24h later if still not answered", who: "Owner", approvalNote: "Jo 28 Oct 2026 (full address required)", gate: { kind: "email" },
    source: { builder: "src/lib/address-request-email.core.ts", fn: "renderAddressRequestEmail", sender: "src/lib/address-request.server.ts" },
    render: () => email(renderAddressRequestEmail({ pickUrl: `${BASE}/my-address/TEST`, unsubscribeUrl: UNSUB, reminder: false })) }),
  ENTRY({ id: "owner:address-request-reminder", section: "owner", step: "enquiry", kind: "email", code: "", name: "We need your full address — reminder", when: "24h after the request, if the owner still hasn't picked their address", who: "Owner", approvalNote: "Jo 28 Oct 2026 (full address required)", gate: { kind: "email" },
    source: { builder: "src/lib/address-request-email.core.ts", fn: "renderAddressRequestEmail", sender: "src/lib/address-request.server.ts" },
    render: () => email(renderAddressRequestEmail({ pickUrl: `${BASE}/my-address/TEST`, unsubscribeUrl: UNSUB, reminder: true })) }),
  ENTRY({ id: "owner:sms-address_request", section: "owner", step: "enquiry", kind: "text", code: "", name: "We need your full address (text)", when: "With the full-address email", who: "Owner", approvalNote: "Jo 28 Oct 2026 (full address required)", gate: { kind: "text", smsType: "address_request" },
    source: { builder: "src/lib/address-request.core.ts", fn: "addressRequestText", sender: "src/lib/address-request.server.ts" },
    render: () => text(addressRequestText(`${BASE}/my-address/TEST`, false)) }),
  ENTRY({ id: "owner:sms-address_request_reminder", section: "owner", step: "enquiry", kind: "text", code: "", name: "We need your full address — reminder (text)", when: "With the 24h reminder email", who: "Owner", approvalNote: "Jo 28 Oct 2026 (full address required)", gate: { kind: "text", smsType: "address_request_reminder" },
    source: { builder: "src/lib/address-request.core.ts", fn: "addressRequestText", sender: "src/lib/address-request.server.ts" },
    render: () => text(addressRequestText(`${BASE}/my-address/TEST`, true)) }),
  // A48 batch 2 (Jo 29–30 Oct 2026): Jo taps Send on an area batch. The owner's message is now O77 + the "It's your turn"
  // text above (decisions #21/#22); the quick_taps text is retired (see NOT_LISTED_BUILDERS). Batches first sent with it
  // (before 2 Nov 2026) still get its day-2 reminder (fix round 1, controller ruling 2 Nov 2026).
  ENTRY({ id: "owner:sms-quick_taps_reminder", section: "owner", step: "ready_check", kind: "text", code: "", name: "Confirm a few quick details — day-2 reminder (text, batches sent before 2 Nov)", when: "Day 2 of a batch first sent with the old quick taps text, if the owner hasn't answered", who: "Owner", approvalNote: "Jo 30 Oct 2026 (A48 batch 2)", gate: { kind: "text", smsType: "quick_taps_reminder" },
    source: { builder: "src/lib/area-batch.core.ts", fn: "quickTapsReminderText", sender: "src/lib/area-batch.server.ts" },
    render: () => text(quickTapsReminderText("Helen Sample", `${JOB}?screen=taps`)) }),
];

/* ---------------------------------------------------------------- INSTALLER */

const INSTALLER: TemplateEntry[] = [
  ENTRY({ id: "installer:I53", section: "installer", step: "enquiry", kind: "email", code: "I53", name: "Application received", when: "An installer business submits its application", who: "Installer applicant", approvalNote: "Jo 24 Oct 2026, decision 136", gate: { kind: "email" },
    source: { builder: "src/lib/application-review.core.ts", fn: "renderApplicationReceivedEmail", sender: "src/lib/trade-messages.server.ts" }, design: "docs/templates/mjml/installer_I53.mjml",
    render: () => email(renderApplicationReceivedEmail({ contactName: "Sam", businessName: "Sample Insulation Co" })) }),
  ENTRY({ id: "installer:changes", section: "installer", step: "enquiry", kind: "email", code: "", name: "Application — send back for changes", when: "Office presses Send back (with a typed message)", who: "Installer or electrician applicant", approvalNote: "Jo 8 Oct 2026", gate: { kind: "email" },
    source: { builder: "src/lib/application-review.core.ts", fn: "changesEmail", sender: "src/lib/application-review.server.ts" },
    render: () => email(changesEmail({ contactName: "Sam Sample", message: "[The office's typed message appears here]", link: `${BASE}/installer-onboarding?resume=TEST`, test: false })) }),
  ENTRY({ id: "installer:decline", section: "installer", step: "enquiry", kind: "email", code: "", name: "Application — declined", when: "Office presses Decline", who: "Installer or electrician applicant", approvalNote: "Jo 8 Oct 2026", gate: { kind: "email" },
    source: { builder: "src/lib/application-review.core.ts", fn: "declineEmail", sender: "src/lib/application-review.server.ts" },
    render: () => email(declineEmail({ contactName: "Sam Sample", reason: null, test: false })) }),
  ENTRY({ id: "installer:I54", section: "installer", step: "enquiry", kind: "email", code: "I54", name: "Welcome aboard — set your password", when: "Office approves the application and sends the login link", who: "Installer (business owner)", approvalNote: "Jo 24 Oct 2026, decision 107; Jo 4 Nov 2026 13:50: the 2-minute guide box removed (approved); the pay-rule box says the NO_FORM_NO_PAY_V2 words ('When you get paid'; ON since Jo 4 Nov 2026 16:44 — the old decision-318 threat words are deleted)", gate: { kind: "email" },
    source: { builder: "src/lib/partner-email.core.ts", fn: "partnerWelcomeEmail", sender: "src/lib/partner-activation.functions.ts" }, design: "docs/templates/mjml/installer_I54.mjml",
    render: () => email(partnerWelcomeEmail({ firstName: "Sam", businessName: "Sample Insulation Co", trade: "installer", email: "sam@example.com", link: `${BASE}/reset-password?token_hash=TEST&type=recovery&next=%2Ffield%2Fwelcome`, test: false })) }),
  ENTRY({ id: "installer:I60", section: "installer", step: "enquiry", kind: "email", code: "I60", name: "One quick step: the ESC privacy notice", when: "Each installer person, with reminders on days 3 and 7 until acknowledged", who: "Installer crew member", approvalNote: "Jo 24 Oct 2026, decision 147", gate: { kind: "email" },
    source: { builder: "src/lib/esc-collection-notice.core.ts", fn: "noticeLinkEmail", sender: "src/lib/esc-collection-notice-send.server.ts" }, design: "docs/templates/mjml/installer_I60.mjml",
    render: () => { const n = noticeLinkEmail({ firstName: "Sam", businessName: "Sample Insulation Co", url: `${BASE}/notice/TEST`, reminder: false }); return email({ subject: n.subject, html: partnerEmailLayout({ subject: n.subject, heading: n.heading, blocks: n.blocks, test: false }).html }); } }),
  ENTRY({ id: "installer:sms-esc_notice_link", section: "installer", step: "enquiry", kind: "text", code: "", name: "ESC privacy notice link (text)", when: "With I60 and its reminders", who: "Installer crew member", approvalNote: "Jo 24 Oct 2026, decision 146", gate: { kind: "text", smsType: "esc_notice_link" },
    source: { builder: "src/lib/esc-collection-notice.core.ts", fn: "noticeLinkSmsBody", sender: "src/lib/esc-collection-notice-send.server.ts" },
    render: () => text(noticeLinkSmsBody("Sam", `${BASE}/notice/TEST`)) }),
  ENTRY({ id: "installer:I62", section: "installer", step: "enquiry", kind: "email", code: "I62", name: "Your copy of the ESC privacy notice", when: "The person ticks the notice", who: "Installer crew member", approvalNote: "Jo 24 Oct 2026, decision 170", gate: { kind: "email" },
    source: { builder: "src/lib/esc-collection-notice.core.ts", fn: "collectionNoticeEmail", sender: "src/lib/esc-collection-notice-send.server.ts" }, design: "docs/templates/mjml/installer_I62.mjml",
    render: () => { const n = collectionNoticeEmail({ firstName: "Sam", acknowledgedAt: "2026-10-24T01:00:00.000Z" }); return email({ subject: n.subject, html: partnerEmailLayout({ subject: n.subject, heading: n.heading, blocks: n.blocks, test: false }).html }); } }),
  ENTRY({ id: "installer:P5", section: "installer", step: "enquiry", kind: "page", code: "P5", name: "ESC privacy notice page", when: "The I60 link", who: "Installer crew member", approvalNote: "Jo 24 Oct 2026, decision 130", gate: { kind: "always" },
    source: { builder: "src/lib/owner-pages.core.ts", fn: "P5", sender: "src/routes/notice.$token.tsx" }, design: "docs/templates/installer/P5-installer-privacy-notice.html",
    render: () => ({ kind: "file", path: "docs/templates/installer/P5-installer-privacy-notice.html", as: "html", note: "Jo's approved page design; the live notice page uses this wording (owner-pages.core.ts P5)." }) }),
  ENTRY({ id: "installer:sms-team_member_invite", section: "installer", step: "enquiry", kind: "text", code: "", name: "Team member login link (text)", when: "A business owner adds a team member", who: "New crew member", approvalNote: "Jo 24 Oct 2026, decision 252", gate: { kind: "text", smsType: "team_member_invite" },
    source: { builder: "src/lib/installer-texts.core.ts", fn: "teamMemberInviteText", sender: "src/lib/installer-texts.server.ts" },
    render: () => text(teamMemberInviteText({ business: "Sample Insulation Co", link: `${BASE}/join/TEST` })) }),
  ENTRY({ id: "installer:mitti-invite", section: "installer", step: "enquiry", kind: "email", code: "", name: "You've been invited to Mitti", when: "The portal creates the trade's Mitti user", who: "Installer or electrician", approvalNote: "Jo 25 Oct 2026, decision 331", gate: { kind: "email" },
    source: { builder: "src/lib/mitti-invite.core.ts", fn: "renderMittiInviteEmail", sender: "src/lib/mitti-invite.server.ts" },
    render: () => email(renderMittiInviteEmail({ name: "Sam Sample" })) }),
  ENTRY({ id: "installer:sms-mitti_invite", section: "installer", step: "enquiry", kind: "text", code: "", name: "You've been invited to Mitti (text)", when: "With the Mitti invite email", who: "Installer or electrician", approvalNote: "Jo 25 Oct 2026, decision 331", gate: { kind: "text", smsType: "mitti_invite" },
    source: { builder: "src/lib/mitti-invite.core.ts", fn: "MITTI_INVITE_MESSAGE", sender: "src/lib/mitti-invite.server.ts" },
    render: () => text(MITTI_INVITE_MESSAGE) }),
  // Part 7 Task 8 (Jo 2 Nov 2026): the "Add your usual electrician" text is retired (decisions 374/303 choose the electrician).
  // Part 7 Task 9 (Jo 2 Nov 2026): the job offer email + text, "Owner suggested other days", "Ready Check booked" (installer),
  // "You've got a run" and "An owner cancelled — fill the time" are retired: installers call the owner and book.
  // Ready Check
  ENTRY({ id: "installer:sms-ready_check_incomplete", section: "installer", step: "ready_check", kind: "text", code: "", name: "Ready Check form missing answers (text)", when: "The Mitti Ready Check is missing answers or photos", who: "Installer", approvalNote: "Jo 22 Oct 2026", gate: { kind: "text", smsType: "ready_check_incomplete" },
    source: { builder: "src/lib/ready-check-chase.core.ts", fn: "readyCheckIncompleteText", sender: "src/lib/ready-check-chase.server.ts" },
    render: () => text(readyCheckIncompleteText("HV-TEST", SHORT_ADDRESS, ["finish and submit the form", "who is doing the electrical safety check"])) }),
  ENTRY({ id: "installer:ready-check-nearly-there", section: "installer", step: "ready_check", kind: "email", code: "", name: "Ready Check: nearly there (office email)", when: "The Mitti Ready Check is missing answers; goes to the installer's business office email, never a worker (held with an office note if none on file)", who: "Installer business office", approvalNote: "Wording: Jo 2 Nov 2026, decision #27 (READY_CHECK_CHASE_EMAIL_APPROVED; Jo 6 Nov 2026: on)", gate: { kind: "email" },
    source: { builder: "src/lib/ready-check-chase.core.ts", fn: "readyCheckNearlyThereEmail", sender: "src/lib/ready-check-chase.server.ts" },
    render: () => email(readyCheckNearlyThereEmail({ jobNumber: "HV-TEST", address: SHORT_ADDRESS, missing: ["finish and submit the form", "whether the homeowner agrees to be contacted"], mittiFormUrl: "https://app.mitti.example/inspection/TEST", contactName: "Sample Insulation", owner: "Helen Yang", mobile: "0400 000 000" })) }),
  ENTRY({ id: "installer:sms-boss_price_link", section: "installer", step: "quote", kind: "text", code: "", name: "Enter your price (text)", when: "A1 Ready Check marked Complete with no price yet (the business owner also gets the \"Enter your price\" email below — Jo 3 Nov 2026)", who: "Installer (business owner)", approvalNote: "Jo 25 Oct 2026, decision 288", gate: { kind: "text", smsType: "boss_price_link" },
    source: { builder: "src/lib/boss-price-link.core.ts", fn: "bossPriceLinkText", sender: "src/lib/boss-price-link.server.ts" },
    render: () => text(bossPriceLinkText({ jobNumber: "HV-TEST", street: "824 High Street Road", link: `${FIELD}#price` })) }),
  // Part 10 Task 3 (Jo 3 Nov 2026 22:58): BOTH the text above AND this email go to the business owner, under one claim per job.
  ENTRY({ id: "installer:enter-price", section: "installer", step: "quote", kind: "email", code: "", name: "Enter your price (email)", when: "With the text: A1 Ready Check marked Complete with no price yet — what the Ready Check found, the Enter your price button and the saved Ready Check report; to the installer's business office email (held with an office note if none on file; retried on the next sync, the text is never resent)", who: "Installer (business owner)", approvalNote: "Body wording: Jo (price-email.png, verbatim); subject + the pronoun \"them\" APPROVED by Jo 4 Nov 2026 14:05 as shown; ENTER_PRICE_EMAIL_APPROVED stays false until go-live flips it — TEST jobs still see it", gate: { kind: "email" },
    source: { builder: "src/lib/enter-price-email.core.ts", fn: "renderEnterPriceEmail", sender: "src/lib/boss-price-link.server.ts" }, design: "docs/templates/mjml/installer_enter-price.mjml",
    render: () => email(renderEnterPriceEmail({ recipientFirst: "James", checkerFirst: "John", ownerFirst: "Helen", ownerFull: "Helen Sample", jobNumber: "HV-TEST", address: ADDRESS, readyCheckOn: "Tue 4 Nov", measured: "137 m² (2 areas)", existing: "Thin batts, R1.0", removal: "None", roof: "Sloped, tiles", access: "Standard", product: "Bradford Gold R5.0", downlights: "4", builtLast5Years: "No", lifeSupport: "No", priceUrl: `${FIELD}#price`, readyCheckPdfUrl: `${BASE}/api/files/TEST/Ready-Check.pdf` })) }),
  // Jo 5 Nov 2026 22:45: the installer's office hears when an own-customer quote goes to the owner.
  ENTRY({ id: "installer:quote-sent", section: "installer", step: "quote", kind: "email", code: "", name: "Quote sent (office email)", when: "An installer's own-customer installation quote is sent to the owner (office Send or the automatic send) — the price, how long it is valid and when Home Insulation Victoria follows the owner up; to the installer's business office email (held with an office note if none on file; one per quote). HIV leads: nothing", who: "Installer business office", approvalNote: "APPROVED by Jo 5 Nov 2026 22:45 (branded design); INSTALLER_QUOTE_SENT_EMAIL_APPROVED on", gate: { kind: "email" },
    source: { builder: "src/lib/installer-quote-sent-email.core.ts", fn: "renderInstallerQuoteSentEmail", sender: "src/lib/installer-quote-sent-email.server.ts" }, design: "docs/templates/mjml/installer_quote-sent.mjml",
    render: () => email(renderInstallerQuoteSentEmail({ recipientFirst: "Deep", ownerFirst: "Helen", ownerFull: "Helen Sample", jobNumber: "HV-TEST", address: ADDRESS, totalIncGst: 4850, validUntil: new Date("2026-12-04T12:59:59.999Z"), quoteUrl: FIELD })) }),
  ENTRY({ id: "installer:updated-quote-sent", section: "installer", step: "quote", kind: "email", code: "", name: "Updated quote sent (office email)", when: "The office sends a replacement installer price for an own-customer job (the earlier quote is withdrawn) — same email as Quote sent with the updated wording; one per quote. HIV leads: nothing", who: "Installer business office", approvalNote: "Jo 6 Nov 2026 — updated-quote wording of the approved Quote sent email; INSTALLER_QUOTE_SENT_EMAIL_APPROVED on", gate: { kind: "email" },
    source: { builder: "src/lib/installer-quote-sent-email.core.ts", fn: "renderInstallerQuoteSentEmail", sender: "src/lib/installer-quote-sent-email.server.ts" }, design: "docs/templates/mjml/installer_quote-sent.mjml",
    render: () => email(renderInstallerQuoteSentEmail({ recipientFirst: "Deep", ownerFirst: "Helen", ownerFull: "Helen Sample", jobNumber: "HV-TEST", address: ADDRESS, totalIncGst: 5100, validUntil: new Date("2026-12-04T12:59:59.999Z"), quoteUrl: FIELD, updated: true })) }),
  // Quote
  ENTRY({ id: "installer:I23", section: "installer", step: "quote", kind: "email", code: "I23", name: "Good news — the owner accepted", when: "The owner pays the safety check", who: "Installer", approvalNote: "Wording: Jo 2 Nov 2026, decision #36 (INSTALLER_ACCEPTED_V2_APPROVED stays false until Jo OKs the pictures; the earlier wording goes out until then)", gate: { kind: "email" },
    source: { builder: "src/lib/installer-accepted-email.core.ts", fn: "renderInstallerAcceptedEmail", sender: "src/lib/installer-accepted-email.server.ts" }, design: "docs/templates/mjml/installer_I23.mjml",
    render: () => email(renderInstallerAcceptedEmail({ ...PARTNER_JOB, useV2: true, whoBooks: "office" })) }),
  ENTRY({ id: "installer:I24", section: "installer", step: "quote", kind: "email", code: "I24", name: "The owner declined the quote", when: "The owner declines the quote", who: "Installer", approvalNote: "Jo 24 Oct 2026", gate: { kind: "email" },
    source: { builder: "src/lib/installer-accepted-email.core.ts", fn: "renderInstallerDeclinedEmail", sender: "src/lib/installer-declined-email.server.ts" }, design: "docs/templates/mjml/installer_I24.mjml",
    render: () => email(renderInstallerDeclinedEmail({ ...PARTNER_JOB, reasonLabel: "Price too high", reasonNote: "We've decided to wait until next year." })) }),
  // Safety check
  // Decision 384 (Jo 25 Oct 2026): approved as drafted in decision 376.
  ENTRY({ id: "installer:piesa-copy", section: "installer", step: "safety_check", kind: "email", code: "O28", name: "Safety check copy (installer)", when: "The signed PIESA is filed (at least 24 hours before the install)", who: "Installer", approvalNote: "Jo 24 Oct 2026, decision 131", gate: { kind: "email" },
    source: { builder: "src/lib/piesa-delivery.core.ts", fn: "renderPiesaCopyEmail", sender: "src/lib/piesa-delivery.server.ts" },
    render: () => email(renderPiesaCopyEmail({ recipient: "installer", firstName: "Sam", address: SHORT_ADDRESS, jobNumber: "HV-TEST", signatureDate: "2026-11-05", installStart: INSTALL_ISO, link: FIELD, electrician: { name: "Spark Electrical", licence: "12345", rec: "67890" } })) }),
  ENTRY({ id: "installer:install-window", section: "installer", step: "safety_check", kind: "email", code: "", name: "Days left in the 30-day install window", when: "20 and 10 days left while no install day is booked", who: "Installer", approvalNote: "Jo 24 Oct 2026, decision 167", gate: { kind: "email" },
    source: { builder: "src/lib/thirty-day-rule.core.ts", fn: "installerInstallWindowEmail", sender: "src/lib/thirty-day-rule.server.ts" },
    render: () => email(installerInstallWindowEmail({ step: "reminder_10", deadline: "2026-12-04", daysLeft: 10, link: FIELD, jobNumber: "HV-TEST", firstName: "Sam", ownerSuburb: "Glen Waverley" })) }),
  ENTRY({ id: "installer:sms-install_window_reminder_installer", section: "installer", step: "safety_check", kind: "text", code: "", name: "Days left in the 30-day window (text)", when: "20 and 10 days left", who: "Installer", approvalNote: "Jo 24 Oct 2026, decision 167", gate: { kind: "text", smsType: "install_window_reminder_installer" },
    source: { builder: "src/lib/thirty-day-rule.core.ts", fn: "installerInstallWindowText", sender: "src/lib/thirty-day-rule.server.ts" },
    render: () => text(installerInstallWindowText({ step: "reminder_10", deadline: "2026-12-04", daysLeft: 10, link: FIELD, jobNumber: "HV-TEST", firstName: "Sam", ownerSuburb: "Glen Waverley" })) }),
  // Install
  ENTRY({id:'installer:install-deposit-in-v2',section:'installer',step:'install',kind:'email',code:'',name:'Deposit in, ready to book',when:'In-house installation deposit confirmed, once per invoice. Replaces the Deposit paid wording once Jo flips DEPOSIT_MESSAGES_V2_APPROVED (same purpose and key)',who:'Installer office (email only)',approvalNote:'Jo 2 Nov 2026, touchpoint 45 (dep-inst-p.png)',gate:{kind:'email'},source:{builder:'src/lib/deposit-request-email.core.ts',fn:'renderInstallerDepositPaidEmail',sender:'src/lib/deposit-request.server.ts'},render:()=>email(renderInstallerDepositPaidEmail({...DEPOSIT_SAMPLE,name:'Helen',ownerFullName:'Helen Yang',bookUrl:`${JOB}`},true))}),
  ENTRY({id:'installer:install-deposit-paid',section:'installer',step:'install',kind:'email',code:'',name:'Deposit paid — book the install day',when:'In-house installation deposit confirmed, once per invoice',who:'Installer office (email only)',approvalNote:'Jo 1 Nov Task 6',gate:{kind:'email'},source:{builder:'src/lib/deposit-request-email.core.ts',fn:'renderInstallerDepositPaidEmail',sender:'src/lib/deposit-request.server.ts'},render:()=>email(renderInstallerDepositPaidEmail(DEPOSIT_SAMPLE))}),
  // G7 (Jo 4 Nov 2026, pack 2 batch 4): a Ready Check booked with "Not sure yet" and nobody picked by 5pm the day before.
  ENTRY({ id: "installer:ready-check-person", section: "installer", step: "ready_check", kind: "email", code: "", name: "Who's doing the Ready Check tomorrow? (email)", when: "5pm Melbourne the day before a Ready Check booked with \"Not sure yet\" for who's going, while nobody has been picked (once per booking, 15-minute tick); Home Insulation Victoria's Needs me gets a row at the same time", who: "Installer office", approvalNote: "Subject is Jo's (4 Nov 2026 19:58); the three body lines are DRAFT — READY_CHECK_PERSON_EMAIL_APPROVED stays false; real offices held, TEST → test-send", gate: { kind: "email" },
    source: { builder: "src/lib/ready-check-person.core.ts", fn: "renderReadyCheckPersonEmail", sender: "src/lib/ready-check-person.server.ts" },
    render: () => email(renderReadyCheckPersonEmail({ jobNumber: "HV-TEST", address: SHORT_ADDRESS, startIso: RC_ISO, jobUrl: `${FIELD}` })) }),
  ENTRY({ id: "installer:lead-installer-confirm", section: "installer", step: "install", kind: "email", code: "", name: "Confirm or change your Lead Installer by 5pm today (email)", when: "9am Melbourne two days before each install (or at once when booked after 9am that day, until the 5pm lock), one per job + install date, to the installer business's office email; from 5pm the Lead Installer and the install day are locked (the ESC is told)", who: "Installer office", approvalNote: "DRAFT body (no approved wording yet; the heading and 5pm rule are Jo's 2 Nov 2026 \"Lead Installer / ESC 24h rule\") — LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED, Jo 6 Nov 2026: on; TEST → test-send", gate: { kind: "email" },
    source: { builder: "src/lib/lead-installer-confirm.core.ts", fn: "renderLeadInstallerConfirm", sender: "src/lib/lead-installer-confirm.server.ts" },
    render: () => email(renderLeadInstallerConfirm({ jobNumber: "HV-TEST", owner: "Sample Owner", startIso: INSTALL_ISO, address: SHORT_ADDRESS, lead: "Sample Lead Installer", crew: ["Sample Crew One", "Sample Crew Two"], jobUrl: `${FIELD}`, lockLabel: leadInstallerLock(INSTALL_ISO).lockLabel , contactName: "Sample Insulation", ownerMobile: "0400 000 000"})) }),
  // Part 9 Task 7: GO / DON'T START after each GO slot run (2pm the day before, 6:30am on the day) — installer office by email only; info@ copies every DON'T START, never a GO.
  ENTRY({ id: "installer:go-email", section: "installer", step: "install", kind: "email", code: "", name: "GO for tomorrow (email)", when: "After the 2pm day-before and 6:30am GO checks pass, one per job + install start + slot, to the installer business's office email", who: "Installer office", approvalNote: "Wording approved by Jo 4 Nov 2026 14:40; GO_EMAIL_APPROVED stays false until the coordinator flips it (real offices get nothing, nothing recorded), TEST → test-send", gate: { kind: "email" },
    source: { builder: "src/lib/go-email.core.ts", fn: "goEmail", sender: "src/lib/go-email.server.ts" },
    render: () => email(goEmail({ jobNumber: "HV-TEST", address: SHORT_ADDRESS, startIso: INSTALL_ISO, lead: "Sample Lead Installer", failures: [], slot: "day_before_2pm", link: `${FIELD}` })) }),
  ENTRY({ id: "installer:dont-start-email", section: "installer", step: "install", kind: "email", code: "", name: "DON'T START — things missing (email)", when: "After a 2pm day-before or 6:30am GO check fails, one per job + install start + slot, to the installer business's office email, with a copy to info@homeinsulationvictoria.com.au", who: "Installer office + Home Insulation Victoria office", approvalNote: "Wording approved by Jo 4 Nov 2026 14:40; GO_EMAIL_APPROVED stays false until the coordinator flips it (real offices get nothing, nothing recorded), TEST → test-send", gate: { kind: "email" },
    source: { builder: "src/lib/go-email.core.ts", fn: "goEmail", sender: "src/lib/go-email.server.ts" },
    render: () => email(goEmail({ jobNumber: "HV-TEST", address: SHORT_ADDRESS, startIso: INSTALL_ISO, lead: "Sample Lead Installer", failures: [{ line: "Safety plan not signed: Sample Lead Installer", cls: "fixable" }, { line: "Install deposit not paid", cls: "fixable" }], slot: "day_before_2pm", link: `${FIELD}` })) }),
  ENTRY({ id: "installer:dont-start-must-move-email", section: "installer", step: "install", kind: "email", code: "", name: "DON'T START — the install must move (email)", when: "After a 2pm day-before or 6:30am GO check fails on a timing rule that can't be met before the booked start (PIESA copies / consent / ESC notice under 24h, PIISA or ESC timing, the 30-day window — unknown lines count as this, fail closed); same recipients as the other DON'T START", who: "Installer office + Home Insulation Victoria office", approvalNote: "Wording approved by Jo 4 Nov 2026 14:40 (must-move / fix-before-6:30am split); GO_EMAIL_APPROVED stays false until the coordinator flips it; TEST → test-send", gate: { kind: "email" },
    source: { builder: "src/lib/go-email.core.ts", fn: "goEmail", sender: "src/lib/go-email.server.ts" },
    render: () => email(goEmail({ jobNumber: "HV-TEST", address: SHORT_ADDRESS, startIso: INSTALL_ISO, lead: "Sample Lead Installer", failures: [{ line: "Owner consent: Owner ESC consent was completed less than 24h before start – reschedule", cls: "must_move" }, { line: "Safety plan not signed: Sample Lead Installer", cls: "fixable" }], slot: "day_before_2pm", link: `${FIELD}` })) }),
  ENTRY({ id: "installer:sms-install_tomorrow", section: "installer", step: "install", kind: "text", code: "", name: "Install tomorrow (text)", when: "The afternoon before the install, to the Lead Installer's own mobile: their safety plan sign link + the Mitti install form (held with a reason when there is no Lead, no mobile or no install form yet)", who: "Lead Installer", approvalNote: "Jo 2 Nov 2026, decision #47 (replaces decision 99)", gate: { kind: "text", smsType: "install_tomorrow" },
    source: { builder: "src/lib/installer-texts.core.ts", fn: "installTomorrowText", sender: "src/lib/installer-texts.server.ts" },
    render: () => text(installTomorrowText({ startIso: INSTALL_ISO, address: SHORT_ADDRESS, jobNumber: "HV-TEST", safetyPlanLink: `${FIELD}/safety-plan`, mittiLink: mittiFormUrl("sample-a5-audit") })) }),
  ENTRY({ id: "installer:sms-swms_sign_link", section: "installer", step: "install", kind: "text", code: "", name: "Sign the safety plan (text)", when: "Install booked, and the day before, to each crew member who hasn't signed the SWMS", who: "Each installer crew member", approvalNote: "Jo 25 Oct 2026, decisions 377/380", gate: { kind: "text", smsType: "swms_sign_link" },
    source: { builder: "src/lib/swms-sign-text.core.ts", fn: "swmsSignLinkText", sender: "src/lib/swms-sign-text.server.ts" },
    render: () => text(swmsSignLinkText({ address: SHORT_ADDRESS, startIso: INSTALL_ISO, link: `${FIELD}/safety-plan` })) }),
  ENTRY({ id: "installer:sms-daily_mitti", section: "installer", step: "install", kind: "text", code: "", name: "Good morning — today's Mitti links (6:30am)", when: "6:30am on an install day, to the worker allocated to it who has NOT yet signed its safety plan — their install line(s), Mitti link and their own sign link (signed = no text; Ready Check only = no text; never the business owner's mobile)", who: "Allocated worker who hasn't signed the SWMS", approvalNote: "Jo, decision 154; workers only since decision #26, unsigned workers only since Jo 2 Nov 2026 23:08", gate: { kind: "text", smsType: "daily_mitti" },
    source: { builder: "src/lib/daily-mitti-text.core.ts", fn: "dailyText", sender: "src/lib/daily-mitti-text.server.ts" },
    render: () => text(dailyText(DAY_JOBS, `${BASE}/field`)) }),
  ENTRY({ id: "installer:sms-daily_mitti_update", section: "installer", step: "install", kind: "text", code: "", name: "Today's jobs changed (text)", when: "A job is added, moved or cancelled after the 6:30am text (same recipients: allocated workers who haven't signed that install's safety plan)", who: "Allocated worker who hasn't signed the SWMS", approvalNote: "Jo, decision 154; workers only since decision #26 (Jo 2 Nov 2026)", gate: { kind: "text", smsType: "daily_mitti_update" },
    source: { builder: "src/lib/daily-mitti-text.core.ts", fn: "updateText", sender: "src/lib/daily-mitti-text.server.ts" },
    render: () => text(updateText(diffDay([], DAY_JOBS), `${BASE}/field`)) }),
  ENTRY({ id: "installer:sms-electrician_cant_attend_installer", section: "installer", step: "install", kind: "text", code: "", name: "Electrician can't make the install day (text)", when: "The electrician who must be there at the start says they can't make it", who: "Installer", approvalNote: "Jo 25 Oct 2026, decision 327", gate: { kind: "text", smsType: "electrician_cant_attend_installer" },
    source: { builder: "src/lib/install-attendance.core.ts", fn: "installerCantAttendText", sender: "src/lib/install-attendance.server.ts" },
    render: () => text(installerCantAttendText({ wasStartIso: INSTALL_ISO, reason: "Another job that day", days: ["2026-11-12", "2026-11-16"] })) }),
  ENTRY({ id: "installer:sms-install_day_form_result", section: "installer", step: "install", kind: "text", code: "", name: "Install day form checked (text)", when: "The A5 Install day form is marked Complete", who: "Lead installer", approvalNote: "Jo 25 Oct 2026, decision 328", gate: { kind: "text", smsType: "install_day_form_result" },
    source: { builder: "src/lib/install-day-confirm.core.ts", fn: "installDayResultText", sender: "src/lib/install-day-confirm.server.ts" },
    render: () => texts([
      { label: "All filled in", body: installDayResultText({ state: "all_filled_in", missing: [] }, { jobNumber: "HV-TEST", address: SHORT_ADDRESS }) },
      { label: "Not finished", body: installDayResultText({ state: "not_finished", missing: ["After video of ceiling area 2", "Depth photo of ceiling area 2"] }, { jobNumber: "HV-TEST", address: SHORT_ADDRESS }) },
    ]) }),
  ENTRY({ id: "installer:sms-install_day_form_reminder", section: "installer", step: "install", kind: "text", code: "", name: "Install day form not complete at 5pm (text)", when: "5pm on the install day with the A5 still not Complete", who: "Lead installer", approvalNote: "Jo 25 Oct 2026, decision 328", gate: { kind: "text", smsType: "install_day_form_reminder" },
    source: { builder: "src/lib/install-day-confirm.core.ts", fn: "installDayReminderText", sender: "src/lib/install-day-confirm.server.ts" },
    render: () => text(installDayReminderText({ jobNumber: "HV-TEST" })) }),
  ENTRY({ id: "installer:sms-owner_changed_visit", section: "installer", step: "any", kind: "text", code: "", name: "Owner changed the booked visit (text)", when: "The owner changes a booked Ready Check or install day on My job", who: "Installer", approvalNote: "Jo 25 Oct 2026, decision 337", gate: { kind: "text", smsType: "owner_changed_visit" },
    source: { builder: "src/lib/installer-texts.core.ts", fn: "ownerChangedVisitText", sender: "src/lib/installer-texts.server.ts" },
    render: () => texts([
      { label: "Ready Check", body: ownerChangedVisitText({ kind: "ready_check", suburb: "Glen Waverley", jobNumber: "HV-TEST", wasIso: RC_ISO, link: FIELD }) },
      { label: "Install day", body: ownerChangedVisitText({ kind: "installation", suburb: "Glen Waverley", jobNumber: "HV-TEST", wasIso: INSTALL_ISO, link: FIELD }) },
    ]) }),
  ENTRY({ id: "installer:I70", section: "installer", step: "any", kind: "email", code: "I70", name: "Job cancelled", when: "The office cancels the job with the installer tick on", who: "Installer", approvalNote: "Jo 25 Oct 2026, decision 291", gate: { kind: "email" },
    source: { builder: "src/lib/cancel-notice.core.ts", fn: "renderInstallerCancelledEmail", sender: "src/lib/cancel-notice.server.ts" }, design: "docs/templates/mjml/installer_I70.mjml",
    render: () => email(renderInstallerCancelledEmail({ jobNumber: "HV-TEST", place: SHORT_ADDRESS, officePhone: "03 9000 0000" })) }),
];

/* ---------------------------------------------------------------- ELECTRICIAN */

const ELECTRICIAN: TemplateEntry[] = [
  ENTRY({ id: "electrician:invite", section: "electrician", step: "enquiry", kind: "email", code: "", name: "An installer invited you", when: "An installer names a new electrician who isn't on the portal yet", who: "Electrician", approvalNote: "Electrician invite wording (job-electrician.core)", gate: { kind: "email" },
    source: { builder: "src/lib/job-electrician.core.ts", fn: "electricianInviteEmail", sender: "src/lib/job-electrician-invite.server.ts" },
    render: () => email(electricianInviteLayout({ electricianName: "Sam Spark", installerName: "Sample Insulation Co", link: `${BASE}/electrician-onboarding?invite=TEST` })) }),
  ENTRY({ id: "electrician:E13", section: "electrician", step: "enquiry", kind: "email", code: "E13", name: "Welcome aboard — set your password", when: "Office approves the electrician's application", who: "Electrician", approvalNote: "Jo 24 Oct 2026, decision 107; pay-rule box = NO_FORM_NO_PAY_V2 words (approved 4 Nov 2026 14:12, ON since 16:44)", gate: { kind: "email" },
    source: { builder: "src/lib/partner-email.core.ts", fn: "partnerWelcomeEmail", sender: "src/lib/partner-activation.functions.ts" }, design: "docs/templates/mjml/electrician_E13.mjml",
    render: () => email(partnerWelcomeEmail({ firstName: "Sam", businessName: "Spark Electrical", trade: "electrician", email: "sam@example.com", link: `${BASE}/reset-password?token_hash=TEST&type=recovery&next=%2Ffield%2Fwelcome`, test: false })) }),
  // Decision 384 (Jo 25 Oct 2026): approved as drafted in decision 376.
  ENTRY({ id: "electrician:piesa-booked", section: "electrician", step: "safety_check", kind: "email", code: "", name: "PIESA booked (office email)", when: "A safety check is booked for the electrician; goes to the electrician business's office email (held with nothing sent if none on file) and links the electrician's job page", who: "Electrician business office", approvalNote: "Wording: Jo 2 Nov 2026, decision #39 (PIESA_BOOKED_EMAIL_APPROVED stays false until Jo OKs the picture; until then the earlier plain email goes out, so one booking is one version)", gate: { kind: "email" },
    source: { builder: "src/lib/electrician-piesa-booked-email.core.ts", fn: "renderElectricianPiesaBooked", sender: "src/lib/in-house-electrician-booked.server.ts" },
    // Task 9: the "Lets you in" row (a tenant or property manager) appears only once ELECTRICIAN_ACCESS_ROWS_APPROVED is on.
    render: () => email(renderElectricianPiesaBooked({ jobNumber: "HV-TEST", firstName: "Sam", startIso: PIESA_ISO, address: SHORT_ADDRESS, owner: { name: "Helen Example", phone: "0400 000 000" }, mittiUrl: FIELD, jobUrl: FIELD, access: { name: "Tina Example", role: "tenant", phone: "0400 111 222" } })) }),
  ENTRY({ id: "electrician:piesa-copy", section: "electrician", step: "safety_check", kind: "email", code: "", name: "Your safety check for the property (PIESA copy)", when: "The official PIESA is filed (again after fixes)", who: "Electrician", approvalNote: "Jo 25 Oct 2026, decision 317", gate: { kind: "email" },
    source: { builder: "src/lib/electrician-piesa-copy.core.ts", fn: "renderElectricianPiesaEmail", sender: "src/lib/electrician-piesa-copy.server.ts" },
    render: () => email(renderElectricianPiesaEmail({ address: SHORT_ADDRESS, jobNumber: "HV-TEST", version: "initial" })) }),
  // A48 batch 1 (Jo 29 Oct 2026, wording approved): the A3 safety check breaks the official PIESA rules.
  ENTRY({ id: "electrician:piesa-rules", section: "electrician", step: "safety_check", kind: "email", code: "", name: "Safety check can't go ahead yet (official rules)", when: "The A3 safety check breaks the official PIESA rules — once per form version", who: "Electrician", approvalNote: "Jo 29 Oct 2026, A48 batch 1", gate: { kind: "email" },
    source: { builder: "src/lib/piesa-rules-notice.core.ts", fn: "renderPiesaRulesEmail", sender: "src/lib/piesa-rules-notice.server.ts" },
    render: () => email(renderPiesaRulesEmail({ name: "Sam", job: "HV-TEST", address: SHORT_ADDRESS, reasons: ["a switchboard or solar answer is No, so repairs are needed (or you must be on site at the start)"] })) }),
  ENTRY({ id: "electrician:sms-piesa_rules_failed", section: "electrician", step: "safety_check", kind: "text", code: "", name: "Safety check can't go ahead yet (text)", when: "With the safety check rules email", who: "Electrician", approvalNote: "Jo 29 Oct 2026, A48 batch 1", gate: { kind: "text", smsType: "piesa_rules_failed" },
    source: { builder: "src/lib/piesa-rules-notice.core.ts", fn: "piesaRulesMessage", sender: "src/lib/piesa-rules-notice.server.ts" },
    render: () => text(piesaRulesMessage({ name: "Sam", job: "HV-TEST", address: SHORT_ADDRESS, reasons: ["a switchboard or solar answer is No, so repairs are needed (or you must be on site at the start)"] })) }),
  ENTRY({ id: "electrician:sms-electrician_install_attendance", section: "electrician", step: "install", kind: "text", code: "", name: "Be there at the start of the install (text)", when: "Install day booked when the A3 says the electrician must be on site at the start; 24h reminder", who: "Electrician", approvalNote: "Jo 25 Oct 2026, decision 327", gate: { kind: "text", smsType: "electrician_install_attendance" },
    source: { builder: "src/lib/install-attendance.core.ts", fn: "attendanceSmsText", sender: "src/lib/install-attendance.server.ts" },
    render: () => texts([
      { label: "Request", body: attendanceSmsText({ address: SHORT_ADDRESS, startIso: INSTALL_ISO, link: FIELD }) },
      { label: "Reminder", body: attendanceReminderText({ address: SHORT_ADDRESS, startIso: INSTALL_ISO, link: FIELD }) },
      { label: "Booked on a day you said you can do", body: attendanceBookedText({ address: SHORT_ADDRESS, startIso: INSTALL_ISO, link: FIELD }) },
    ]) }),
  ENTRY({ id: "electrician:sms-owner_changed_visit", section: "electrician", step: "safety_check", kind: "text", code: "", name: "Owner changed the booked safety check (text)", when: "The owner changes a booked safety check on My job", who: "Electrician", approvalNote: "Jo 25 Oct 2026, decision 337", gate: { kind: "text", smsType: "owner_changed_visit" },
    source: { builder: "src/lib/installer-texts.core.ts", fn: "ownerChangedVisitText", sender: "src/lib/installer-texts.server.ts" },
    render: () => text(ownerChangedVisitText({ kind: "assessment", suburb: "Glen Waverley", jobNumber: "HV-TEST", wasIso: PIESA_ISO, link: FIELD })) }),
  // Main #130/131 (Part 2, Jo 3 Nov 2026) + #134 (Part 2b): the installer office emails around an own job's safety check
  // and the Team page (the My electricians page was retired 4 Nov 2026) — laid out by emailInstallerOffice / sendOfficeEmail (partnerEmailLayout). Listed at the 4 Nov join.
  ENTRY({ id: "installer:own-job-piesa-to-book", section: "installer", step: "safety_check", kind: "email", code: "", name: "Safety check to book (own job, installer office)", when: "An installer's own job: the owner has paid; who books depends on My business (office / electrician / either)", who: "Installer office", approvalNote: "Jo 3 Nov 2026 (OWN_JOB_PIESA_TO_BOOK_EMAIL_APPROVED)", gate: { kind: "email" },
    source: { builder: "src/lib/own-job-office-emails.core.ts", fn: "officeToBookEmail", sender: "src/lib/own-job-piesa-notices.server.ts" },
    render: () => installerOfficeEmail(officeToBookEmail({ address: SHORT_ADDRESS, electrician: "Spark Electrical", booker: "electrician", jobUrl: FIELD }), FIELD) }),
  ENTRY({ id: "installer:own-job-piesa-cant-do", section: "installer", step: "safety_check", kind: "email", code: "", name: "Electrician can't do the safety check (own job, installer office)", when: "The electrician presses \"Can't do this one\" on their link", who: "Installer office", approvalNote: "Jo 3 Nov 2026 (OWN_JOB_PIESA_CANT_DO_EMAIL_APPROVED)", gate: { kind: "email" },
    source: { builder: "src/lib/own-job-office-emails.core.ts", fn: "officeCantDoEmail", sender: "src/lib/own-job-electrician-link.server.ts" },
    render: () => installerOfficeEmail(officeCantDoEmail({ address: SHORT_ADDRESS, electrician: "Spark Electrical", reason: "Too busy this week", jobUrl: FIELD }), FIELD) }),
  ENTRY({ id: "installer:own-job-piesa-not-booked", section: "installer", step: "safety_check", kind: "email", code: "", name: "Safety check not booked yet (own job, installer office)", when: "2 business days after the hand-over with the safety check still unbooked", who: "Installer office", approvalNote: "Jo 3 Nov 2026 (OWN_JOB_PIESA_NOT_BOOKED_EMAIL_APPROVED)", gate: { kind: "email" },
    source: { builder: "src/lib/own-job-office-emails.core.ts", fn: "officeNotBookedEmail", sender: "src/lib/own-job-piesa.server.ts" },
    render: () => installerOfficeEmail(officeNotBookedEmail({ address: SHORT_ADDRESS, jobUrl: FIELD }), FIELD) }),
  ENTRY({ id: "electrician:own-job-swap-old-electrician", section: "electrician", step: "safety_check", kind: "email", code: "", name: "You're no longer on this job (electrician swapped)", when: "The installer picks another electrician for an own job's safety check", who: "Electrician (the old one)", approvalNote: "Jo 3 Nov 2026 (OWN_JOB_SWAP_OLD_ELECTRICIAN_EMAIL_APPROVED)", gate: { kind: "email" },
    source: { builder: "src/lib/electrician-swap.core.ts", fn: "oldElectricianEmail", sender: "src/lib/electrician-swap.server.ts" },
    render: () => installerOfficeEmail(oldElectricianEmail({ address: SHORT_ADDRESS }), null) }),
  ENTRY({ id: "owner:own-job-swap-booking-cancelled", section: "owner", step: "safety_check", kind: "email", code: "", name: "Your safety check needs a new time (electrician swapped)", when: "A swap cancels a booked safety check on an installer's own job; once per cancelled booking", who: "Owner", approvalNote: "Jo 3 Nov 2026, message 7 (OWN_JOB_SWAP_OWNER_EMAIL_APPROVED; docs/wording/2026-11-03-part2-messages.md)", gate: { kind: "email" },
    source: { builder: "src/lib/electrician-swap.core.ts", fn: "ownerSwapCancelledEmail", sender: "src/lib/electrician-swap.server.ts" },
    render: () => email(ownerSwapCancelledEmail({ firstName: "Helen", address: SHORT_ADDRESS, unsubscribeUrl: UNSUB })) }),
  ENTRY({ id: "installer:electrician-not-approved", section: "installer", step: "enquiry", kind: "email", code: "", name: "Your electrician wasn't approved (installer office)", when: "The office rejects an electrician the installer added on the Team page", who: "Installer office", approvalNote: "Jo 3 Nov 2026 (REJECTION_EMAIL_APPROVED; docs/wording/2026-11-03-part2b-messages.md)", gate: { kind: "email" },
    source: { builder: "src/lib/my-electricians.core.ts", fn: "rejectionEmail", sender: "src/lib/my-electricians.server.ts" },
    render: () => { const m = rejectionEmail({ electricianName: "Will Casdorff", reason: "Licence has expired" }); return email(officeLaidOut("Sample Insulation Co", m.subject, m.message)); } }),
  ENTRY({ id: "office:mitti-form-not-made", section: "office", step: "any", kind: "email", code: "", name: "Mitti form not made (office alert)", when: "The Mitti form creation retries ran out — the office makes the form by hand", who: "Office (info@)", approvalNote: "Internal office alert, not customer wording", gate: { kind: "email" },
    source: { builder: "src/lib/mitti-retry.core.ts", fn: "alertEmail", sender: "src/lib/mitti-retry.server.ts" },
    render: () => email(alertEmail({ kind: "ready_check", jobNumber: "HV-TEST", address: SHORT_ADDRESS, tradeName: "Sample Insulation Co", tradeEmail: "office@sample.test", bookingAt: "2026-11-05T22:00:00Z", error: "Mitti returned 500", jobUrl: `${BASE}/admin/jobs/TEST` })) }),
  // Part 2b Task 4 (Jo 3 Nov 2026, #134, main): the office approves an electrician an installer added → ONE welcome text.
  ENTRY({ id: "electrician:sms-installer_added_electrician_welcome", section: "electrician", step: "enquiry", kind: "text", code: "", name: "Welcome — your installer added you (text)", when: "The office approves an electrician an installer added on the Team page", who: "Electrician", approvalNote: "Jo 3 Nov 2026 (Part 2b, docs/wording/2026-11-03-part2b-messages.md)", gate: { kind: "text", smsType: "installer_added_electrician_welcome" },
    source: { builder: "src/lib/my-electricians.core.ts", fn: "welcomeSmsText", sender: "src/lib/my-electricians.server.ts" },
    render: () => text(welcomeSmsText({ electricianName: "Will Casdorff", installerName: "Example Insulation" })) }),
  // Part 2 (Jo #130/131, main): an installer's OWN job — the electrician's no-login link to call the owner and book the safety
  // check. Listed at the 4 Nov 2026 join (templates-hub pin); it keeps working beside Part 6's link until Part 2 minting is retired at go-live.
  ENTRY({ id: "electrician:sms-own_job_piesa_link", section: "electrician", step: "safety_check", kind: "text", code: "", name: "Own job: your link to book the safety check (text)", when: "An installer's own job: the owner has paid and the electrician books the safety check", who: "Electrician", approvalNote: "Jo 3 Nov 2026 (Part 2, #130/131)", gate: { kind: "text", smsType: "own_job_piesa_link" },
    source: { builder: "src/lib/own-job-electrician-link.core.ts", fn: "electricianLinkText", sender: "src/lib/own-job-piesa-notices.server.ts" },
    render: () => text(ownJobElectricianLinkText({ installer: "Example Insulation", address: SHORT_ADDRESS, url: "https://estimate.homeinsulationvictoria.com.au/e/EXAMPLE", firstName: "Sam" })) }),
  // Jo 6 Nov 2026: on — ELECTRICIAN_LINK_TEXT_APPROVED true and the SMS type is wordingApproved:true.
  ENTRY({ id: "electrician:sms-electrician_job_link", section: "electrician", step: "safety_check", kind: "text", code: "", name: "Your job link (text)", when: "Right after the installer picks the electrician for a new safety check job", who: "Electrician", approvalNote: "DRAFT wording for Jo to approve (new job flow Part 6); Jo 6 Nov 2026: on (ELECTRICIAN_LINK_TEXT_APPROVED)", gate: { kind: "text", smsType: "electrician_job_link" },
    source: { builder: "src/lib/electrician-link.core.ts", fn: "electricianLinkText", sender: "src/lib/electrician-link.server.ts" },
    render: () => text(electricianLinkText({ jobNumber: "HV-TEST", suburb: "Glen Waverley", installer: "Example Insulation", url: "https://estimate.homeinsulationvictoria.com.au/e/EXAMPLE", firstName: "Sam" })) }),
  // Jo 6 Nov 2026: on — ELECTRICIAN_CANT_DO_EMAIL_APPROVED true (TEST jobs go to test-send).
  ENTRY({ id: "installer:electrician-cant-do", section: "installer", step: "safety_check", kind: "email", code: "", name: "The electrician can't do this one", when: "The electrician taps \"Can't do this one\" on their job link; goes to the installer business's office email (held if none on file). Their booked safety check / upgrades day is cancelled and the owner gets \"Your visit can't go ahead\"", who: "Installer business office", approvalNote: "DRAFT wording for Jo to approve (new job flow Part 6, Task 6); Jo 6 Nov 2026: on (ELECTRICIAN_CANT_DO_EMAIL_APPROVED)", gate: { kind: "email" },
    source: { builder: "src/lib/electrician-cant-do-email.core.ts", fn: "electricianCantDoEmail", sender: "src/lib/electrician-link.server.ts" },
    render: () => email(electricianCantDoEmail({ jobNumber: "HV-TEST", electrician: "Example Electrical", reason: "Double booked that week", contactName: "Sample Insulation", address: SHORT_ADDRESS, owner: "Helen Yang", mobile: "0400 000 000", jobUrl: "https://portal.homeinsulationvictoria.com.au/field/EXAMPLE?go=electrician", test: false })) }),
  // Part 6 Task 7 — DRAFT wording: UPGRADES_NUDGE_TEXT_APPROVED stays false and the SMS type is wordingApproved:false (switch off).
  ENTRY({ id: "electrician:sms-upgrades_nudge", section: "electrician", step: "fixes", kind: "text", code: "", name: "Upgrades form not in (text)", when: "9am the day after the booked upgrades day when the upgrades form isn't in; carries a fresh job link", who: "Electrician", approvalNote: "Approved by Jo 4 Nov 2026 13:55 (Part 6 Task 7); UPGRADES_NUDGE_TEXT_APPROVED flips at go-live", gate: { kind: "text", smsType: "upgrades_nudge" },
    source: { builder: "src/lib/upgrades-watch.core.ts", fn: "upgradesNudgeText", sender: "src/lib/upgrades-watch.server.ts" },
    render: () => text(upgradesNudgeText({ jobNumber: "HV-TEST", url: "https://estimate.homeinsulationvictoria.com.au/e/EXAMPLE" })) }),
  ENTRY({ id: "installer:upgrades-form-not-in", section: "installer", step: "fixes", kind: "email", code: "", name: "Upgrades form not in", when: "9am two days after the booked upgrades day, once the electrician was nudged and the form still isn't in; to the installer business's office email", who: "Installer business office", approvalNote: "Approved by Jo 4 Nov 2026 13:55 (Part 6 Task 7); UPGRADES_OFFICE_EMAIL_APPROVED flips at go-live", gate: { kind: "email" },
    source: { builder: "src/lib/upgrades-watch.core.ts", fn: "upgradesOfficeEmail", sender: "src/lib/upgrades-watch.server.ts" },
    render: () => email(upgradesOfficeEmail({ jobNumber: "HV-TEST", electrician: "Example Electrical", upgradesStart: PIESA_ISO, test: false })) }),
  ENTRY({ id: "installer:upgrades-past-30-days", section: "installer", step: "fixes", kind: "email", code: "", name: "Upgrades day is past the 30-day rule", when: "The booked upgrades day is after the 30-day install deadline; to the installer business's office email with a copy to info@ (the office Needs me row is always on)", who: "Installer business office", approvalNote: "Approved by Jo 4 Nov 2026 13:55 (Part 6 Task 7); UPGRADES_RED_FLAG_EMAIL_APPROVED flips at go-live", gate: { kind: "email" },
    source: { builder: "src/lib/upgrades-watch.core.ts", fn: "upgradesRedFlagEmail", sender: "src/lib/upgrades-watch.server.ts" },
    render: () => email(upgradesRedFlagEmail({ jobNumber: "HV-TEST", electrician: "Example Electrical", upgradesStart: PIESA_ISO, installDeadlineYmd: "2026-11-06", test: false })) }),
  // Main Part 3 (#137/#138, Jo approved 4 Nov 2026; docs/wording/2026-11-03-part3-messages.md): the upgrades-day / certificate
  // chases on the 30-day clock. A different trigger from Part 6 Task 7 above (no day entered / no certificate file, vs the
  // booked day passed with no form) — never both for one condition. Listed at the 4 Nov join (step 5).
  ENTRY({ id: "electrician:sms-electrician_upgrades_day_link", section: "electrician", step: "fixes", kind: "text", code: "", name: "Upgrades day not booked (text)", when: "1 business day after the safety check said upgrades are needed (not today) with no upgrades day entered; carries their job link", who: "Electrician", approvalNote: "Jo 4 Nov 2026 (Part 3, #138)", gate: { kind: "text", smsType: "electrician_upgrades_day_link" },
    source: { builder: "src/lib/certificate-chase.core.ts", fn: "upgradesDayLinkText", sender: "src/lib/own-job-piesa-notices.server.ts" },
    render: () => text(upgradesDayLinkText({ first: "Sam", address: SHORT_ADDRESS, url: "https://estimate.homeinsulationvictoria.com.au/e/EXAMPLE" })) }),
  ENTRY({ id: "installer:upgrades-day-not-set", section: "installer", step: "fixes", kind: "email", code: "", name: "Upgrades day not set (installer office)", when: "2 business days after the safety check said upgrades are needed with no upgrades day entered; to the installer business's office email", who: "Installer business office", approvalNote: "Jo 4 Nov 2026 (Part 3, #138); UPGRADES_DAY_OFFICE_EMAIL_APPROVED", gate: { kind: "email" },
    source: { builder: "src/lib/certificate-chase.core.ts", fn: "upgradesDayOfficeEmail", sender: "src/lib/certificate-later.server.ts" },
    render: () => installerOfficeEmail(upgradesDayOfficeEmail({ address: SHORT_ADDRESS, electrician: "Sam Sparks", jobUrl: FIELD }), FIELD) }),
  ENTRY({ id: "electrician:sms-electrician_certificate_link", section: "electrician", step: "fixes", kind: "text", code: "", name: "Add your certificate (text)", when: "Straight after the upgrades are recorded (Part C) on the safety check or upgrades form without a Certificate of Electrical Safety; carries their job link", who: "Electrician", approvalNote: "Jo 4 Nov 2026 (Part 3, #138)", gate: { kind: "text", smsType: "electrician_certificate_link" },
    source: { builder: "src/lib/certificate-later.core.ts", fn: "certificateAddLinkText", sender: "src/lib/own-job-piesa-notices.server.ts" },
    render: () => text(certificateAddLinkText({ first: "Sam", address: SHORT_ADDRESS, url: "https://estimate.homeinsulationvictoria.com.au/e/EXAMPLE" })) }),
  ENTRY({ id: "electrician:sms-electrician_certificate_chase", section: "electrician", step: "fixes", kind: "text", code: "", name: "Certificate still needed (text)", when: "2 business days after the upgrades were recorded with no certificate file on the job; carries their job link", who: "Electrician", approvalNote: "Jo 4 Nov 2026 (Part 3, #138)", gate: { kind: "text", smsType: "electrician_certificate_chase" },
    source: { builder: "src/lib/certificate-chase.core.ts", fn: "certificateChaseText", sender: "src/lib/own-job-piesa-notices.server.ts" },
    render: () => text(certificateChaseText({ first: "Sam", address: SHORT_ADDRESS, url: "https://estimate.homeinsulationvictoria.com.au/e/EXAMPLE" })) }),
];

/* ---------------------------------------------------------------- OFFICE */

const OFFICE: TemplateEntry[] = [
  ENTRY({ id: "office:typed-message", section: "office", step: "any", kind: "email", code: "", name: "Office message to a partner or applicant", when: "Office types a message and presses Send (partner, applicant or electrician)", who: "Partner / applicant", approvalNote: "Office-typed wording in the shared layout", gate: { kind: "email" },
    source: { builder: "src/lib/office-email.core.ts", fn: "officeEmailCopy", sender: "src/lib/partner-activation.functions.ts" },
    render: () => email(officeLaidOut("Sam Sample", "About your application", "[The office's typed message appears here]")) }),
  ENTRY({ id: "office:reply-drafts", section: "office", step: "any", kind: "email", code: "", name: "Outlook reply drafts", when: "Matched inbound email → a DRAFT reply in Outlook for Jo or Chris to check and send (never sent by the portal)", who: "Office (draft for owner or partner)", approvalNote: "Decision 244 (samples: docs/templates/office/email-reply-samples.md)", gate: { kind: "code_off", flag: "EMAIL_REPLY_DRAFTS_ENABLED" },
    source: { builder: "src/lib/email-reply.core.ts", fn: "composeReply", sender: "src/lib/email-reply.server.ts" },
    render: () => {
      const d = composeReply({ subject: "Re: Your spot is saved HV-TEST", body: "Hi there,\n\nJust wondering when is my free Ready Check?\n\nThanks,\nHelen", from: "helen@example.com", fromName: "Helen Sample", fromPartner: false, now: new Date("2026-10-23T23:00:00Z"),
        owner: { jobNumber: "HV-TEST", jobSource: "website", stage: "ready_check_scheduled", spotSaved: true, ownerFullName: "Helen Sample", suburb: "Glen Waverley", readyCheck: { start: "2026-10-27T22:00:00Z", end: "2026-10-28T00:00:00Z" }, piesa: null, install: null, quote: null, fixesQuoteSent: false, estimate: { fullPrice: 3798, rebate: 1610, youPay: 2188, areaM2: 137 }, insulationDeclared: "none", paymentDue: null, installHeldUntil: null, ownerLink: JOB, matchedJobs: 1 } });
      return { kind: "doc", title: "Draft reply (sample: owner asks when their Ready Check is)", body: d?.text ?? "No draft for this sample", note: "Drafts are written into Outlook only; the office checks and presses Send." };
    } }),
];

/* ---------------------------------------------------------------- MITTI */

const MITTI: TemplateEntry[] = [
  ENTRY({ id: "mitti:A1", section: "mitti", step: "ready_check", kind: "form", code: "A1", name: "Ready Check — installer's own customer", when: "Free Ready Check on a customer the installer brought (no price: the business owner prices in the portal)", who: "Installer", approvalNote: "Jo 23–25 Oct 2026, decisions 278/288/359", gate: { kind: "always" },
    source: { builder: "src/lib/mitti-forms.core.ts", fn: "FORMS", sender: "src/lib/mitti.server.ts" },
    render: () => ({ kind: "questions", title: FORMS.ready_check_priced.title, record: "docs/MITTI_READY_CHECK_PRICE_PROMPT.md · published copy tests/fixtures/mitti-ready-check/a1-published-r35.json", groups: fieldsGroups(FORMS.ready_check_priced.fields) }) }),
  ENTRY({ id: "mitti:A2", section: "mitti", step: "ready_check", kind: "form", code: "A2", name: "Ready Check — our lead", when: "Free Ready Check on a Home Insulation Victoria lead (evidence only, no pricing)", who: "Installer", approvalNote: "Jo 23–25 Oct 2026, decisions 359/374", gate: { kind: "always" },
    source: { builder: "src/lib/mitti-forms.core.ts", fn: "FORMS", sender: "src/lib/mitti.server.ts" },
    render: () => ({ kind: "questions", title: FORMS.ready_check.title, record: "docs/MITTI_READY_CHECK_ONE_PROMPT.md · published copy tests/fixtures/mitti-ready-check/a2-published-r13.json", groups: fieldsGroups(FORMS.ready_check.fields) }) }),
  ENTRY({ id: "mitti:A3", section: "mitti", step: "safety_check", kind: "form", code: "A3", name: "Electrical safety check (PIESA)", when: "The licensed electrician's visit; the portal fills the official DEECA PIESA from it", who: "Electrician", approvalNote: "Decision 350 (mapping approved)", gate: { kind: "always" },
    source: { builder: "src/lib/mitti-forms.core.ts", fn: "FORMS", sender: "src/lib/mitti.server.ts" },
    render: () => ({ kind: "questions", title: FORMS.piesa.title, record: "docs/MITTI_PIESA_BUILD_PROMPT.md", groups: fieldsGroups(FORMS.piesa.fields) }) }),
  ENTRY({ id: "mitti:A4", section: "mitti", step: "fixes", kind: "form", code: "A4", name: FIXES_DAY_TEMPLATE_NAME, when: "Booking a later fixes visit creates it for the electrician", who: "Electrician", approvalNote: "Jo 25 Oct 2026, decision 293", gate: { kind: "always" },
    source: { builder: "src/lib/fixes-day.core.ts", fn: "FIXES_DAY_QUESTIONS", sender: "src/lib/fixes-day.server.ts" },
    render: () => ({ kind: "questions", title: FIXES_DAY_TEMPLATE_NAME, record: "docs/MITTI_FIXES_FORM_PROMPT.md (drift test tests/fixes-day.test.ts)", groups: numbered(FIXES_DAY_QUESTIONS) }) }),
  ENTRY({ id: "mitti:A5", section: "mitti", step: "install", kind: "form", code: "A5", name: INSTALL_DAY_TEMPLATE_NAME, when: "Install day; the portal fills the official DEECA PIISA from it", who: "Lead installer", approvalNote: "Jo 24 Oct 2026, decisions 260–266", gate: { kind: "always" },
    source: { builder: "src/lib/install-day.core.ts", fn: "INSTALL_DAY_QUESTIONS", sender: "src/lib/mitti.server.ts" },
    render: () => ({ kind: "questions", title: INSTALL_DAY_TEMPLATE_NAME, record: "docs/MITTI_INSTALL_FORM_FIX_PROMPT.md (drift test tests/install-day.test.ts) · published copy tests/fixtures/a3-published-2026-10-25-read-first.json", groups: numbered(INSTALL_DAY_QUESTIONS) }) }),
];

/* ---------------------------------------------------------------- COMPLIANCE */

function consentSample(): string {
  return renderConsentBody({
    version: ESC_CONSENT_TEMPLATE_VERSION, body: "",
    facts: { owner: { name: "Helen Yang", email: "helen@example.com", phone: "0400 000 000" }, premises_address: ADDRESS, installation_days: ["Wednesday 11 November 2026"] },
    owner: { signatureName: "Helen Yang", signedAt: "2026-10-24T01:00:00Z", declarations: Object.fromEntries(OWNER_DECLARATIONS.map((d) => [d.key, true])) },
    ap: { rep: { first_name: "Sample", last_name: "Representative", role: "Director", phone: "0400 222 333", email: "ap@example.com" }, signedAt: "2026-10-24T02:00:00Z" },
  });
}

const COMPLIANCE: TemplateEntry[] = [
  ENTRY({ id: "compliance:piesa", section: "compliance", step: "safety_check", kind: "document", code: "", name: "Official PIESA (DEECA, March 2026)", when: "Filled from the A3 by the portal; copies to owner (O28), installer and electrician", who: "Owner, installer, electrician", approvalNote: "Decision 350 (piesa-map-2.0.0 approved)", gate: { kind: "always" },
    source: { builder: "src/lib/electrician-piesa-copy.core.ts", fn: "officialPiesaPdfText", sender: "src/lib/official-piesa-pdf.server.ts" },
    render: () => ({ kind: "files", items: [
      { label: "Filled sample (Word form printed)", path: "docs/templates/compliance/piesa-mapping/case-1-all-clear-word.pdf", note: "Made by scripts/render-piesa-mapping-samples.ts with the live filler" },
      { label: "Filled sample with fixes (Word form printed)", path: "docs/templates/compliance/piesa-mapping/case-2-life-support-fixes-word.pdf", note: "Same filler, repair + Section C" },
      { label: "PDF attached to the electrician's email", path: "docs/templates/compliance/piesa-mapping/case-1-all-clear.pdf", note: "officialPiesaPdfText" },
      { label: "Blank official form", path: "docs/official-forms/VEU-pre-installation-electrical-safety-assessment-form_1.docx", note: "Original DEECA Word file" },
    ] }) }),
  ENTRY({ id: "compliance:piisa", section: "compliance", step: "install", kind: "document", code: "", name: "Official PIISA (DEECA, March 2026)", when: "Filled from the A5 Install day form by the portal", who: "Lead installer (filed on the job)", approvalNote: "piisa-map-2.0.0 approved", gate: { kind: "always" },
    source: { builder: "src/lib/official-docx.server.ts", fn: "renderOfficialDocx", sender: "src/lib/piisa-declaration.server.ts" },
    render: () => ({ kind: "files", items: [
      { label: "Filled sample (Word form printed)", path: "docs/templates/compliance/piisa-filler/piisa-sample-word.pdf", note: "Made by scripts/render-piisa-filler-sample.ts with the live filler" },
      { label: "Blank official form", path: "docs/official-forms/VEU-pre-installation-installer-safety-assessment-form-_3.docx", note: "Original DEECA Word file" },
    ] }) }),
  ENTRY({ id: "compliance:swms", section: "compliance", step: "install", kind: "document", code: "", name: "Safety plan (SWMS)", when: "Built from job facts; the Lead Installer and each crew member sign before the install", who: "Lead Installer and crew (filed on the job)", approvalNote: `Jo 24–25 Oct 2026, decisions 262, 358, 364; Jo 2 Nov 2026 wording (Lead Installer, hazard 9, downlight step) ${SWMS_NOV2_WORDING_ON ? "in force" : "waits behind SWMS_NOV2_WORDING_ON until Part 11 switches it on"}; supervision paragraph + "No Lead Installer is chosen for this install" APPROVED by Jo 4 Nov 2026 14:18 (Round 5 C)`, gate: { kind: "always" },
    source: { builder: "src/lib/swms.core.ts", fn: "buildSwms", sender: "src/lib/swms-pdf.server.ts" },
    render: () => ({ kind: "files", items: [
      { label: "Signed SWMS sample (PDF)", path: "docs/templates/compliance/swms/swms-sample.pdf", note: `Made by scripts/render-swms-sample.ts. Prepared for ${SWMS_PREPARED_FOR}; ${SWMS_HAZARDS.length} standard hazards (rule ${SWMS_RULE}); signers tick "${SWMS_SIGN_STATEMENT}".` },
      { label: "Approved look (2 Nov 2026)", path: "docs/approved-samples/2026-11-02/swms-sample.pdf", note: "Jo's approved sample: the wording and layout the SWMS moves to (Part 7 Tasks 1–2)" },
    ] }) }),
  ENTRY({ id: "compliance:esc-consent", section: "compliance", step: "install", kind: "document", code: "", name: "ESC Owner's Consent Form (Template v1)", when: "Signed by the owner on the confirm-and-pay page (?screen=clear), then the AP; copy emailed (O63)", who: "Owner, AP", approvalNote: "Decision 123 (0226)", gate: { kind: "always" },
    source: { builder: "src/lib/consent.core.ts", fn: "renderConsentBody", sender: "src/lib/consent.server.ts" },
    render: () => ({ kind: "doc", title: `ESC Owner's Consent Form — ${ESC_CONSENT_TEMPLATE_VERSION}`, body: consentSample(), note: "Signed sample; the official file is docs/official-forms/ESC-Owners-Consent-Form-Template-v1-20260414.docx" }) }),
  ENTRY({ id: "compliance:veec", section: "compliance", step: "rebate", kind: "document", code: "", name: "VEEC assignment form (ESC v1.1)", when: "After the install: lead installer → AP (automatic) → owner (P4)", who: "Installer, AP, owner", approvalNote: "Decisions 119/120 (ESC form verbatim)", gate: { kind: "always" },
    source: { builder: "src/lib/veec-assignment-form.core.ts", fn: "VEEC_FORM_VERSION", sender: "src/lib/assignment.server.ts" },
    render: () => ({ kind: "doc", title: `${VEEC_FORM_TITLE} — ${VEEC_FORM_EDITION}`, body: VEEC_FORM_BODY, note: `Section 2 is prefilled from the job. Original: ${VEEC_FORM_ORIGINAL_FILE}` }) }),
  ENTRY({ id: "compliance:privacy-notice", section: "compliance", step: "enquiry", kind: "document", code: "", name: "ESC privacy collection notice (v1.0)", when: "Every installer person ticks it before working on a job (P5, I60/I62)", who: "Installer crew", approvalNote: "Decisions 130/147", gate: { kind: "always" },
    source: { builder: "src/lib/esc-collection-notice.core.ts", fn: "COLLECTION_NOTICE_PARAGRAPHS", sender: "src/routes/notice.$token.tsx" },
    render: () => ({ kind: "doc", title: "VEU Scheme Participant Privacy Collection Notice", body: COLLECTION_NOTICE_PARAGRAPHS.map((p) => ("text" in p ? p.text : "")).filter(Boolean).join("\n\n") }) }),
  ENTRY({ id: "compliance:factsheet", section: "compliance", step: "quote", kind: "document", code: "", name: VEU_FACTSHEET_TITLE, when: "Attached to O22 (You're in) when the file is on file", who: "Owner", approvalNote: "Decision 320", gate: { kind: "always" },
    source: { builder: "src/lib/veu-factsheet.core.ts", fn: "factsheetDecision", sender: "src/lib/veu-factsheet.server.ts" },
    render: () => ({ kind: "files", items: [{ label: VEU_FACTSHEET_TITLE, path: null, note: `Not on file yet: put the current ESC factsheet at ${VEU_FACTSHEET_PATH} and run bun scripts/embed-veu-factsheet.ts. Until then O22 sends without it and nothing is recorded.` }] }) }),
  ENTRY({ id: "compliance:warranties", section: "compliance", step: "paid", kind: "document", code: "", name: "Product warranties", when: "The installed product's warranty is attached to O47 (or O73 when added later)", who: "Owner", approvalNote: "Decision 276", gate: { kind: "always" },
    source: { builder: "src/lib/product-warranty.core.ts", fn: "PRODUCT_WARRANTIES", sender: "src/lib/completion-pack.server.ts" },
    render: () => ({ kind: "files", items: PRODUCT_WARRANTIES.map((w) => ({ label: `${w.productName} — ${warrantyTermText(w)}`, path: w.pdfPath, note: `${w.documentTitle} (${w.manufacturer}). When the PDF is not on file the pack sends without it and the AP auto-signature holds.` })) }) }),
];

/* ---------------------------------------------------------------- INVOICES */

const INVOICES: TemplateEntry[] = [
  ENTRY({ id: "invoices:O45", section: "invoices", step: "paid", kind: "invoice", code: "O45", name: "Final invoice (balance due on install day)", when: "Install day: the tax invoice with the balance due on install day, paid by card on My job or by bank transfer (Q21, Jo 2 Nov 2026). Retires when ALL_DONE_V2 is approved (the All done email then carries the invoice); stops being sent once Jo flips ALL_DONE_V2_APPROVED (the balance is in the All done email)", who: "Owner", approvalNote: "Jo 24–25 Oct 2026, decisions 209, 334; Q21 (Jo 2 Nov 2026) for when and how the balance is paid", gate: { kind: "email" },
    source: { builder: "src/lib/completion-emails.core.ts", fn: "renderFinalInvoiceEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/mjml/invoices_O45.mjml",
    render: () => email(renderFinalInvoiceEmail({ firstName: "Helen", ownerName: "Helen Yang", address: ADDRESS, installer: REINSULATE, invoiceNumber: "HIV-TEST", invoiceDate: "11 November 2026", lines: [{ description: "Bradford Gold R5.0 ceiling batts, 137.6 m² supplied and installed", amount: 2752 }, { description: "Old insulation removed and taken away, 40 m²", amount: 600 }, { description: "Electrical safety check (PIESA)", amount: 349 }, { description: "Accredited Person fee", amount: 349 }], totalIncGst: 4050, gst: 368.18, rebate: 1850, payments: [{ label: "safety check (24 Oct)", amount: 349 }, { label: "deposit (4 Nov)", amount: 185.1 }], balanceDue: 1665.9, bank: BANK, installed: { description: "Ceiling insulation — Bradford Gold Ceiling Batt R5.0 — 137.6 m²", escModelCodes: ["467911"] } })) }),
  ENTRY({ id: "invoices:xero", section: "invoices", step: "quote", kind: "invoice", code: "", name: "Xero invoice (one per job)", when: "Created at quote acceptance: every accepted quote line once, plus the VEEC incentive as a negative line", who: "Owner (via Xero)", approvalNote: "Decision 209 (Activity Guide v1.2 Table 4)", gate: { kind: "always" },
    source: { builder: "src/lib/xero.core.ts", fn: "buildInvoicePayload", sender: "src/lib/xero.server.ts" },
    render: () => {
      const p = buildInvoicePayload({ contactId: "TEST", jobNumber: "HV-TEST", dueDate: "2026-11-11", total: 2200, veecIncentive: 1850, tracking: { categoryName: "Business Unit", optionName: "Home Insulation Victoria" }, installationAddress: ADDRESS,
        items: [{ description: "Ceiling insulation — Bradford Gold Ceiling Batt R5.0 — 137.6 m² supplied and installed", quantity: 137.6, unit_price_inc_gst: 20, line_total_inc_gst: 2752 }, { description: "Old insulation removed and taken away", quantity: 40, unit_price_inc_gst: 15, line_total_inc_gst: 600 }, { description: "Electrical safety check (PIESA)", quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349 }, { description: "Accredited Person fee", quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349 }] });
      const inv = p.Invoices[0]!;
      const aud = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return { kind: "table", title: `Reference ${inv.Reference} · amounts include GST · due ${inv.DueDate}`, columns: ["Description", "Qty", "Unit (inc GST)", "Amount"], rows: inv.LineItems.map((l) => [l.Description, String(l.Quantity), aud(l.UnitAmount), aud(l.Quantity * l.UnitAmount)]), note: "Business name, address and ABN come from the Xero invoice template. The owner's online invoice link is office-only." };
    } }),
];

/* ---------------------------------------------------------------- WAITING FOR JO */

const WAITING: TemplateEntry[] = [
  // Plan 2026-11-02: ONE email to the installer's office per Give tap; off for real installers until Jo approves (TEST partners use test-send).
  ENTRY({ id: "waiting:in-house-give", section: "installer", step: "ready_check", kind: "email", code: "", name: "New free Ready Check jobs (one email per Give)", when: "Jo taps Give on ticked jobs — one email per tap", who: "Installer office", approvalNote: "Plan 2026-11-02 (obvious yes, tick to send); Jo 6 Nov 2026: on (IN_HOUSE_GIVE_EMAIL_APPROVED)", gate: { kind: "email" },
    source: { builder: "src/lib/in-house-give-email.core.ts", fn: "renderInHouseGiveEmail", sender: "src/lib/in-house-give-email.server.ts" },
    render: () => email(renderInHouseGiveEmail({ jobs: [
      { jobId: "TEST-1", jobNumber: "HV-TEST", ownerName: "Helen Yang", ownerMobile: "0400 000 000", address: ADDRESS, ownerSaid: [["Insulation (owner said)", "Some — batts, about a hand thick, patchy"], ["Ceiling size (owner said)", "About 120 m²"]] },
      { jobId: "TEST-2", jobNumber: "HV-TEST2", ownerName: null, ownerMobile: null, address: null, ownerSaid: [["Insulation (owner said)", "None"], ["Ceiling size (owner said)", null]] },
    ], contactName: "Sample Insulation" })) }),
  ENTRY({ id: "installer:trade-invite", section: "installer", step: "enquiry", kind: "email", code: "", name: "Trade sign-in invite", when: "Goes when the office gives an approved trade worker their own sign-in", who: "Installer / electrician worker", approvalNote: "Jo 27 Oct 2026, decision 406 (the whole email refresh suite)", gate: { kind: "email" },
    source: { builder: "src/lib/trade-access.core.ts", fn: "renderTradeInviteEmail", sender: "src/lib/trade-access.functions.ts" },
    render: () => email(renderTradeInviteEmail({ firstName: "Sam", business: "Sample Insulation Co", setPasswordUrl: `${BASE}/reset-password?token_hash=TEST&type=invite`, signInUrl: `${BASE}/auth` })) }),
  // Decision 386: one automatic reply per standard owner question (wording approved by Jo 27 Oct 2026, decision 406).
  ...ANSWER_TYPES.map((answer) => ENTRY({ id: `owner:${ANSWER_CODES[answer].code}`, section: "owner", step: "any", kind: "email", code: ANSWER_CODES[answer].code, name: `Automatic reply: ${ANSWER_CODES[answer].name}`,
    when: "A matched owner emails info@ with this standard question: ONE reply sent automatically (anything unusual stays a draft + Needs me row)", who: "Owner", approvalNote: "Jo 27 Oct 2026, decision 406 (the whole email refresh suite); decision 386", gate: { kind: "email" },
    source: { builder: "src/lib/owner-email-auto-reply.core.ts", fn: "renderOwnerAutoReplyEmail", sender: "src/lib/owner-email-auto-reply.server.ts" }, design: `docs/templates/drafts/${ANSWER_CODES[answer].file}`,
    render: () => email(renderOwnerAutoReplyEmail({ answer, facts: ANSWER_SAMPLES[answer].facts, theirSubject: ANSWER_SAMPLES[answer].theirSubject })) })),
];

/* ---------------------------------------------------------------- daily text sample */

const DAY_JOBS = [
  { jobId: "TEST-1", bookingId: "B1", start: "2026-11-10T21:00:00Z", end: null, street: "824 High Street Road", suburb: "Glen Waverley", link: `${BASE}/field/TEST-1`, status: "confirmed", kind: "installation" },
  { jobId: "TEST-2", bookingId: "B2", start: "2026-11-11T03:00:00Z", end: null, street: "12 Sample Street", suburb: "Mount Waverley", link: `${BASE}/field/TEST-2`, status: "confirmed", kind: "ready_check" },
];

/* ---------------------------------------------------------------- register */

const ownMessages: TemplateEntry[] = ([
  ['own_owner_quote', 'Owner quote — installer’s own customer', 'Owner', 'Office presses Send on the first quote', 'renderOwnCustomerQuoteEmail', () => renderOwnCustomerQuoteEmail({ ...QUOTE, v4: true, validDays: 30, ownCustomer: { installerName: 'Sample Insulation Co', installerLogoUrl: null }, readyCheckVisit: false })],
  ['own_owner_updated_quote', 'Owner updated quote — installer’s own customer', 'Owner', 'Office checks the new price and presses Send', 'renderOwnCustomerUpdatedQuoteEmail', () => renderOwnCustomerUpdatedQuoteEmail({ firstName: 'Helen', installer: 'Sample Insulation Co', address: ADDRESS, link: JOB + '?screen=quote', previousSentDate: '6 Nov', validUntil: '6 Dec', officeNumber: '{office number}', unsubscribeUrl: UNSUB })],
  ['own_installer_owner_accepted', 'Owner accepted — installer office', 'Installer business office', 'Owner accepts and the safety-check payment is confirmed', 'renderOwnInstallerAcceptedEmail', () => renderOwnInstallerAcceptedEmail({ name: 'Deep', jobNumber: 'HV-TEST', address: ADDRESS })],
] as const).map(([key, name, who, when, fn, render]) => ENTRY({ id: `waiting:${key}`, section: 'waiting', step: 'quote', kind: 'email', code: '', name, who, when, approval: 'waiting', approvalNote: 'Jo 5 Nov 8:17pm — approve each email here; no sending from this page', ownMessageKey: key, gate: { kind: 'email', switchKey: ownMessageSwitch(key) }, source: { builder: 'src/lib/own-customer-quote-messages.core.ts', fn, sender: key.startsWith('own_owner') ? 'src/lib/quote-ready-notify.server.ts' : 'src/lib/installer-accepted-email.server.ts' }, render: () => email(render()) }));
export const TEMPLATE_ENTRIES: TemplateEntry[] = [...OWNER, ...INSTALLER, ...ELECTRICIAN, ...OFFICE, ...MITTI, ...COMPLIANCE, ...INVOICES, ...WAITING, ...ownMessages];

/** Entries of one section, in job order (stable within a step). */
export function entriesFor(section: TemplateSection): TemplateEntry[] {
  return TEMPLATE_ENTRIES.map((e, i) => ({ e, i })).filter(({ e }) => e.section === section)
    .sort((a, b) => STEP_ORDER.indexOf(a.e.step) - STEP_ORDER.indexOf(b.e.step) || a.i - b.i).map(({ e }) => e);
}

/** Selected entry for a section; an unknown or other-section id falls back to the section's first entry. */
export function selectTemplate(section: TemplateSection, id: string | undefined): TemplateEntry {
  const list = entriesFor(section);
  return list.find((e) => e.id === id) ?? list[0]!;
}


/** Text types with a named Settings switch (office-settings.core SWITCHES); every other type is `sms:<type>`. */
const NAMED_SMS_SWITCHES = new Set(["spot_saved", "install_no_access"]);
/** Live switch states from Settings (getOfficeSwitches): key → on. */
export type SwitchStates = Record<string, boolean | null>;
export type StatusTone = "green" | "amber" | "rose" | "neutral";
/** Plain status for the page: live / waits for the customer messages switch / waits for its text switch / off. */
export function templateStatus(e: TemplateEntry, sw: SwitchStates | null): { label: string; tone: StatusTone } {
  if (e.approval === "waiting" && (!e.ownMessageKey || sw?.[ownMessageSwitch(e.ownMessageKey)] !== true)) return { label: "Off — waiting for Jo's approval", tone: "rose" };
  const g = e.gate;
  if (g.kind === "always") return { label: "Live", tone: "green" };
  if (g.kind === "code_off") return { label: `Off (${g.flag})`, tone: "rose" };
  if (!sw) return { label: g.kind === "text" ? "Needs the customer messages switch + its text switch" : "Needs the customer messages switch", tone: "neutral" };
  if (sw["customer_comms"] !== true) return { label: "Waits for customer messages switch", tone: "amber" };
  if (g.kind === "email" && g.switchKey && sw[g.switchKey] !== true) return { label: "Waits for its own switch", tone: "amber" };
  if (g.kind === "text") {
    const key = NAMED_SMS_SWITCHES.has(g.smsType) ? g.smsType : `sms:${g.smsType}`;
    if (sw[key] !== true) return { label: "Waits for its text switch", tone: "amber" };
    if ((g.smsType === "daily_mitti" || g.smsType === "daily_mitti_update") && sw["daily_mitti"] !== true) return { label: "Waits for the installer good-morning switch", tone: "amber" };
  }
  return { label: "Live", tone: "green" };
}

/**
 * Builders a live sender calls that are deliberately NOT their own entry (with the reason). Everything else that looks
 * like a message builder must be listed above — tests/templates-hub.test.ts fails otherwise.
 */
export const NOT_LISTED_BUILDERS: Record<string, string> = {
  isTestMittiEmail: "Not a template: the TEST Mitti identity check (mitti-test-route.core) — its name only ends in Email",
  unansweredOwnerEmail: "Not a template: the 'owner wrote and nobody replied' predicate behind the Enquiries piles (enquiry-categories.core)",
  qaOfficeReservedEmail: "Not a template: the reserved TEST office address check (qa-office.core)",
  sameWorkerEmail: "Not a template: compares two worker emails (worker-role.core)",
  markTestEmail: "Not a template: stamps a TEST label/route onto any email bound for the QA inbox (qa-inbox.core) — its name only ends in Email",
  stripQuotedEmail: "Not a template: strips quoted history from an inbound owner email (emails-tab.core) — its name only ends in Email",
  isQaTestEmail: "Not a template: the TEST-address check (qa-email.core) behind the TEST guards — its name only ends in Email",
  quickTapsText: "Retired 2 Nov 2026 (decision #22): the batch send now opens the quick taps with the O77 email + the \"It's your turn\" text",
  renderQuickTapsEmail: "Retired at the 4 Nov 2026 join (decision #22): the O77 \"It's your turn\" email opens the quick taps; nothing sends this one",
  reaskText: "One-off quick taps re-ask script (Jo 3 Nov 2026, HV-1405), not a flow message",
  renderConsentBody: "Shown inside the ESC Owner's Consent document entry",
  renderJoEstimateEmail: "Internal step of renderJoOutcomeEmail",
  renderJoIneligibleEmail: "Internal step of renderJoOutcomeEmail",
  renderJobEmailPreview: "Office job-page preview of renderJoOutcomeEmail (same output)",
  renderOfficialDocx: "Server-side Word filler behind the official PIESA/PIISA entries",
  renderOfficialDocument: "Behind the official PIESA/PIISA entries",
  renderHeaderArt: "Image art for email headers, not a template",
  renderHeadingArt: "Image art for email headers, not a template",
  renderAmountArt: "Image art for email headers, not a template",
  renderErrorPage: "Browser error page, not a template",
  renderReloadPage: "Browser error page, not a template",
  testLoginEmail: "TEST partner login address helper",
  automaticLeadEmail: "Routing rule (which Jo template), not wording",
};

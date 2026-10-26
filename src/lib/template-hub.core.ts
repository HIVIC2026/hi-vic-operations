// Pure: the office Templates page register (decision 379, Jo 25 Oct 2026: "ONLY the current templates, Mitti forms and
// compliance documents, all EXACTLY as people see them, in exactly the right place"). Presentation only.
//
// Every entry renders through the SAME pure builder the live sender calls (render functions below), with fixed TEST
// sample data, so the page can never drift from the code. Nothing here holds wording, decides approval, sends, saves
// or changes workflow. Entries are grouped by WHO gets them and ordered by job step. Wording waiting for Jo's approval
// sits in its own section. Retired templates are simply not listed (their files stay in git).
// tests/templates-hub.test.ts proves every entry comes from a live code path and every live builder / text type is here.
import { renderJoOutcomeEmail } from "./jo-outcome-email.core";
import { withUnsubscribe } from "./emailsafety.core";
import { renderCoverageUnavailableEmail } from "./coverage-email";
import { renderFollowupEmail } from "./followup-email";
import { renderEstimateFollowupEmail } from "./estimate-followup.core";
import { renderSpotSavedEmail, renderSpotSavedSms } from "./spot-saved-messages.core";
import { renderNewSenderReplyEmail } from "./new-sender-reply-email.core";
import { renderChangeReplyEmail, cancelNote } from "./email-change-reply.core";
import { ownerCodeEmail, ownerCodeSmsBody } from "./owner-code-delivery.core";
import { renderReadyCheckTimesEmail } from "./ready-check-times-email.core";
import { renderReadyCheckBookedEmail } from "./ready-check-booked-email.core";
import { renderOwnerQuoteEmail, renderQuoteReminderEmail, ownerQuoteSms } from "./owner-quote-email.core";
import { renderYoureInEmail } from "./acceptance-email.core";
import { renderSafetyCheckTimesEmail, renderSafetyCheckBookedEmail } from "./safety-check-emails.core";
import { renderPiesaCopyEmail } from "./piesa-delivery.core";
import { renderPiesaOwnerConfirmEmail } from "./piesa-owner-confirm-email.core";
import { piesaOwnerConfirmReminderText, piesaOwnerConfirmRequestText } from "./piesa-owner-confirm.core";
import { renderPiesaFixesConfirmEmail } from "./piesa-fixes-confirm-email.core";
import { piesaFixesConfirmText } from "./piesa-fixes-confirm.core";
import { ownerInstallWindowEmail, installerInstallWindowEmail, ownerInstallWindowText, installerInstallWindowText } from "./thirty-day-rule.core";
import { renderFixesQuoteEmail } from "./rectification-quote-email.core";
import { renderInstallDaysEmail, renderInstallDayChangedEmail } from "./install-days-email.core";
import { renderInstallBookedEmail } from "./install-booked-email.core";
import { renderConsentCopyEmail } from "./consent-copy-email.core";
import { renderDepositReleasedEmail, depositReleaseText } from "./deposit-release-notice.core";
import { renderInstallNoAccessEmail, installNoAccessText } from "./install-no-access-notice.core";
import { renderOwnerCancelledEmail, renderInstallerCancelledEmail } from "./cancel-notice.core";
import { renderInstallCompleteEmail, renderFinalInvoiceEmail, renderCompletionPackEmail, renderReviewRequestEmail } from "./completion-emails.core";
import { renderVeecReminderEmail, renderVeecCopyEmail } from "./veec-emails.core";
import { veecSignRequestText, veecSignReminderText, VEEC_FORM_BODY, VEEC_FORM_TITLE, VEEC_FORM_EDITION, VEEC_FORM_ORIGINAL_FILE } from "./veec-assignment-form.core";
import { renderWarrantyFollowupEmail } from "./warranty-followup.core";
import { bankDetailLines, HIV_BANK_DETAILS } from "./payments.core";
import { renderInstallerAcceptedEmail, renderInstallerDeclinedEmail } from "./installer-accepted-email.core";
import { renderApplicationReceivedEmail, changesEmail, declineEmail } from "./application-review.core";
import { partnerWelcomeEmail, partnerEmailLayout } from "./partner-email.core";
import { collectionNoticeEmail, noticeLinkEmail, noticeLinkSmsBody, COLLECTION_NOTICE_PARAGRAPHS } from "./esc-collection-notice.core";
import { renderInstallClearanceEmail, installClearanceText } from "./install-clearance.core";
import { renderReadyCheckOfferEmail } from "./ready-check-offer-email.core";
import { readyCheckOfferText } from "./ready-check-times.core";
import { renderElectricianOfferEmail } from "./electrician-offer-email.core";
import { renderElectricianPiesaEmail } from "./electrician-piesa-copy.core";
import { MITTI_INVITE_MESSAGE, renderMittiInviteEmail } from "./mitti-invite.core";
import { officeEmailLayout, electricianInviteLayout } from "./office-email.core";
import { composeReply } from "./email-reply.core";
import { brandSmsBody } from "./sms.core";
import { blastMessage } from "./save-spot-reminder-blast.core";
import { threeQuestionsSms } from "./three-questions-reminder.core";
import {
  readyCheckTimesOwnerText, readyCheckBookedOwnerText, readyCheckTomorrowOwnerText, piesaBookedOwnerText, piesaTomorrowOwnerText,
  installTomorrowOwnerText, quoteReminderDay3Text, quoteReminderExpiryText, installMovedText, piesaOfferText,
} from "./approved-texts.core";
import { readyCheckDaysSuggestedText, readyCheckBookedInstallerText, installTomorrowText, teamMemberInviteText, ownerChangedVisitText } from "./installer-texts.core";
import { usualElectricianReminderBody } from "./usual-electrician.core";
import { readyCheckIncompleteText } from "./ready-check-chase.core";
import { dailyText, updateText, diffDay } from "./daily-mitti-text.core";
import { bossPriceLinkText } from "./boss-price-link.core";
import { fixesTimesLinkText } from "./fixes-times.core";
import { attendanceSmsText, attendanceReminderText, attendanceBookedText, installerCantAttendText } from "./install-attendance.core";
import { installDayResultText, installDayReminderText } from "./install-day-confirm.core";
import { FORMS, type FormField } from "./mitti-forms.core";
import { INSTALL_DAY_QUESTIONS, INSTALL_DAY_TEMPLATE_NAME } from "./install-day.core";
import { FIXES_DAY_QUESTIONS, FIXES_DAY_TEMPLATE_NAME } from "./fixes-day.core";
import { GATE_DOCS, RETIRED_DOC_KEYS, fillTemplate, paymentTermsText, paymentTermsMoney, type GateDocKey } from "./owner-gates.core";
import { renderConsentBody, ESC_CONSENT_TEMPLATE_VERSION, OWNER_DECLARATIONS } from "./consent.core";
import { SWMS_HAZARDS, SWMS_PREPARED_FOR, SWMS_SIGN_STATEMENT } from "./swms.core";
import { PRODUCT_WARRANTIES, warrantyTermText } from "./product-warranty.core";
import { VEU_FACTSHEET_PATH, VEU_FACTSHEET_TITLE } from "./veu-factsheet.core";
import { buildInvoicePayload } from "./xero.core";
import { TRADE_INVITE_DRAFT, renderTradeInviteEmail } from "./trade-access.core";
import { swmsSignLinkText } from "./swms-sign-text.core";
import { renderVisitNewTimesEmail, visitNewTimesText } from "./visit-new-times.core";
import { renderPaperworkCopyEmail } from "./paperwork-copy-email.core";
import { piesaTimesReminderText, renderPiesaTimesReminderEmail } from "./piesa-times-reminder.core";
import { installerPlanningText, renderInstallerPlanningEmail } from "./installer-planning-notice.core";
import { ANSWER_CODES, ANSWER_SAMPLES, ANSWER_TYPES, renderOwnerAutoReplyEmail } from "./owner-email-auto-reply.core";
import { renderSpotReleasedEmail } from "./spot-release-email.core";
import { spotReleasedText } from "./spot-release.core";

/* ---------------------------------------------------------------- types */

export type TemplateSection = "owner" | "installer" | "electrician" | "office" | "mitti" | "compliance" | "invoices" | "waiting";
export const TEMPLATE_SECTIONS: { key: TemplateSection; label: string; hint: string }[] = [
  { key: "owner", label: "Owner", hint: "Emails, texts, My job pages and paperwork the homeowner gets" },
  { key: "installer", label: "Installer", hint: "Emails and texts to installer businesses and their crews" },
  { key: "electrician", label: "Electrician", hint: "Emails and texts to electricians" },
  { key: "office", label: "Office", hint: "What the office itself sends or reviews" },
  { key: "mitti", label: "Mitti forms", hint: "The five Mitti forms A1–A5, questions as the portal reads them" },
  { key: "compliance", label: "VEU / compliance", hint: "Official forms and documents the owner, installer or ESC receives" },
  { key: "invoices", label: "Invoices", hint: "The final invoice email and the Xero invoice layout" },
  { key: "waiting", label: "Waiting for Jo's approval", hint: "Drafts that send nothing until Jo approves the wording" },
];

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
  lines: [{ description: "Bradford Gold R5.0 ceiling batts, supplied and installed", lineTotalIncGst: 2752 }, { description: "Old insulation removed and taken away", lineTotalIncGst: 600 }, { description: "Electrical safety check (PIESA)", lineTotalIncGst: 349 }, { description: "Accredited Provider fee", lineTotalIncGst: 349 }],
  quoteUrl: `${JOB}?screen=quote`, validUntil: new Date("2026-11-07T12:59:59.999Z"), officePhone: null, unsubscribeUrl: UNSUB,
};
const PARTNER_JOB = { installerFirstName: "Sam", ownerName: "Helen Yang", address: SHORT_ADDRESS, jobNumber: "HV-TEST", jobUrl: FIELD };
const BANK = { accountName: "Home Insulation Victoria", bsb: "082902", accountNumber: "777966349", payId: null, configured: true };

/* ---------------------------------------------------------------- helpers */

const email = (m: { subject: string; html: string }): TemplatePreview => ({ kind: "email", subject: m.subject, html: m.html });
const text = (body: string | null): TemplatePreview => ({ kind: "text", body: brandSmsBody(body ?? "") });
const texts = (variants: { label: string; body: string | null }[]): TemplatePreview => ({ kind: "texts", variants: variants.map((v) => ({ label: v.label, body: brandSmsBody(v.body ?? "") })) });
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

/* ---------------------------------------------------------------- OWNER */

const OWNER: TemplateEntry[] = [
  // Enquiry
  ENTRY({ id: "owner:O1", section: "owner", step: "enquiry", kind: "email", code: "O1", name: "Save my spot (no existing insulation)", when: "Estimate sent: eligible, no existing insulation (Jo T1/T2)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decisions 66–69; HELD by decision 388 (spot-only rewording awaiting Jo)", gate: { kind: "email" },
    source: { builder: "src/lib/jo-outcome-email.core.ts", fn: "renderJoOutcomeEmail", sender: "src/lib/followups.server.ts" }, design: "docs/templates/owner/O1-save-my-spot.html",
    render: () => jo({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, recipient: HELEN, figures: FIG, links: LINKS }) }),
  ENTRY({ id: "owner:O2-some", section: "owner", step: "enquiry", kind: "email", code: "O2", name: "Save my spot (some insulation)", when: "Estimate sent: existing insulation below R2 reviewed, or declared thin/patchy (T3/T4)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decisions 66–69; HELD by decision 388 (spot-only rewording awaiting Jo)", gate: { kind: "email" },
    source: { builder: "src/lib/jo-outcome-email.core.ts", fn: "renderJoOutcomeEmail", sender: "src/lib/hot-leads-send.server.ts" }, design: "docs/templates/owner/O2-save-my-spot-some-insulation.html",
    render: () => jo({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, declaredThinPatchy: true, recipient: HELEN, figures: { ...FIG, removalUpTo: 2055 }, links: LINKS }) }),
  ENTRY({ id: "owner:O2-dont-know", section: "owner", step: "enquiry", kind: "email", code: "O2", name: "Save my spot (don't know if insulation)", when: "Estimate sent: a new website enquirer ticked \"don't know\" whether there's insulation (decision 392; same email as some insulation, don't-know intro)", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 392 (Save my spot email chosen); spot-only wording per decision 388", gate: { kind: "email" },
    source: { builder: "src/lib/jo-outcome-email.core.ts", fn: "renderJoOutcomeEmail", sender: "src/lib/hot-leads-send.server.ts" }, design: "docs/templates/owner/O2-save-my-spot-dont-know.html",
    render: () => jo({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true, declaredExisting: true, declaredUnknown: true, recipient: HELEN, figures: { ...FIG, removalUpTo: 2055 }, links: LINKS }) }),
  ENTRY({ id: "owner:O2-questions", section: "owner", step: "enquiry", kind: "email", code: "O2", name: "Save my spot: answer 3 questions", when: "Estimate sent: existing insulation not confirmed yet (T5/T6); also the one-off 3 questions reminder", who: "Owner", approvalNote: "Jo 24 Oct 2026, decisions 66–69, 172; HELD by decision 388 (spot-only rewording awaiting Jo)", gate: { kind: "email" },
    source: { builder: "src/lib/jo-outcome-email.core.ts", fn: "renderJoOutcomeEmail", sender: "src/lib/three-questions-reminder.server.ts" }, design: "docs/templates/owner/O2-save-my-spot-questions.html",
    render: () => jo({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true, insulationQuestions: true, recipient: HELEN, figures: { ...FIG, removalUpTo: 2055 }, links: LINKS }) }),
  ENTRY({ id: "owner:O6", section: "owner", step: "enquiry", kind: "email", code: "O6", name: "Not eligible", when: "Eligibility result: does not appear eligible (T7)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 73", gate: { kind: "email" },
    source: { builder: "src/lib/jo-outcome-email.core.ts", fn: "renderJoOutcomeEmail", sender: "src/lib/enquiry-groups.server.ts" }, design: "docs/templates/owner/O6-not-eligible.html",
    render: () => jo({ outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false, recipient: HELEN, reason: "From the photos and details you sent us, the insulation already in your ceiling appears to be R2.0 or above.", links: LINKS }) }),
  ENTRY({ id: "owner:O7", section: "owner", step: "enquiry", kind: "email", code: "O7", name: "Not in your area yet", when: "Office presses Send on a job with no installer or electrician covering the postcode", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 74", gate: { kind: "email" },
    source: { builder: "src/lib/coverage-email.ts", fn: "renderCoverageUnavailableEmail", sender: "src/lib/coverage.functions.ts" }, design: "docs/templates/owner/O7-not-in-area.html",
    render: () => email(renderCoverageUnavailableEmail({ firstName: "Helen", suburb: "Mildura", postcode: "3500", missing: ["REC / electrician", "installer"], reference: "HV-TEST" })) }),
  ENTRY({ id: "owner:estimate-unopened", section: "owner", step: "enquiry", kind: "email", code: "", name: "Estimate not opened (3 days)", when: "Three days after the estimate email when the estimate link was never opened", who: "Owner", approvalNote: "The one active estimate follow-up kind (customer-followups hook)", gate: { kind: "email" },
    source: { builder: "src/lib/followup-email.ts", fn: "renderFollowupEmail", sender: "src/lib/followups.server.ts" },
    render: () => email(renderFollowupEmail({ kind: "estimate_unopened_3d", estimateUrl: EST })) }),
  ...([["day_2", "O66", "Estimate reminder (day 2)", "O66-estimate-reminder-day-2.html"], ["day_7", "O67", "Estimate reminder (day 7)", "O67-estimate-reminder-day-7.html"], ["day_21", "O68", "Estimate closing (day 21)", "O68-estimate-closing-day-21.html"]] as const).map(([step, code, name, file]) =>
    ENTRY({ id: `owner:${code}`, section: "owner", step: "enquiry", kind: "email", code, name, when: `${step.replace("day_", "Day ")} after the estimate email, until the spot is saved, they reply or opt out (closes a week after day 21)`, who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 242 (reconfirmed 357); HELD by decision 388 (spot-only rewording awaiting Jo)", gate: { kind: "email" },
      source: { builder: "src/lib/estimate-followup.core.ts", fn: "renderEstimateFollowupEmail", sender: "src/lib/estimate-followup.server.ts" }, design: `docs/templates/owner/${file}`,
      render: () => email(renderEstimateFollowupEmail({ step, firstName: "Helen", rebate: 1610, price: 2188, fullPrice: 3798, basis: "Based on what you told us: 137 m² ceiling, no existing insulation.", saveUrl: `${EST}/campaign`, calculatorUrl: `${EST}/calculator`, unsubscribeUrl: UNSUB })) })),
  ENTRY({ id: "owner:sms-save_spot_reminder", section: "owner", step: "enquiry", kind: "text", code: "", name: "Save my spot reminder (one-off)", when: "Office one-off reminder to owners who have an estimate but no saved spot", who: "Owner", approvalNote: "Jo (one-off blast wording); HELD by decision 388 (spot-only rewording awaiting Jo)", gate: { kind: "text", smsType: "save_spot_reminder" },
    source: { builder: "src/lib/save-spot-reminder-blast.core.ts", fn: "blastMessage", sender: "src/lib/save-spot-reminder-blast.server.ts" },
    render: () => text(blastMessage("Helen", 2188, 1610, `${EST}/campaign`)) }),
  ENTRY({ id: "owner:sms-three_questions_reminder", section: "owner", step: "enquiry", kind: "text", code: "", name: "3 questions reminder (one-off)", when: "Office one-off reminder (pre-23-Oct enquiries); the email is O2 questions", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 172", gate: { kind: "text", smsType: "three_questions_reminder" },
    source: { builder: "src/lib/three-questions-reminder.core.ts", fn: "threeQuestionsSms", sender: "src/lib/three-questions-reminder.server.ts" },
    render: () => text(threeQuestionsSms("Helen", 1610, `${EST}/video`)) }),
  ENTRY({ id: "owner:O70", section: "owner", step: "enquiry", kind: "email", code: "O70", name: "New sender → calculator reply", when: "Someone with no job emails an enquiry or price question: ONE reply pointing to the calculator", who: "New email sender", approvalNote: "Jo 25 Oct 2026, decisions 292, 356", gate: { kind: "email" },
    source: { builder: "src/lib/new-sender-reply-email.core.ts", fn: "renderNewSenderReplyEmail", sender: "src/lib/new-sender-reply.server.ts" }, design: "docs/templates/owner/O70-new-sender-calculator.html",
    render: () => email(renderNewSenderReplyEmail({ theirSubject: "Ceiling insulation quote", firstName: "Sam" })) }),
  ENTRY({ id: "owner:O10", section: "owner", step: "enquiry", kind: "email", code: "O10", name: "Spot saved", when: "The owner saves their spot", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 70; reworded spot-only by decision 388 (no flag: changed directly)", gate: { kind: "email", switchKey: "spot_saved_email" },
    source: { builder: "src/lib/spot-saved-messages.core.ts", fn: "renderSpotSavedEmail", sender: "src/lib/spot-saved-send.server.ts" }, design: "docs/templates/owner/O10-spot-saved.html",
    render: () => email(renderSpotSavedEmail({ firstName: "Helen", rebate: 1610, suburb: "Glen Waverley", shortAddress: SHORT_ADDRESS, myJobUrl: JOB, optOutUrl: UNSUB, referralUrl: "https://homeinsulationvictoria.com.au/homeowner?ref=TEST", estimate: { gross: 3798, customer: 2188, areaM2: 137, address: ADDRESS, calculatorUrl: `${EST}/calculator` } })) }),
  ENTRY({ id: "owner:sms-spot_saved", section: "owner", step: "enquiry", kind: "text", code: "", name: "Spot saved (text)", when: "The owner saves their spot", who: "Owner", approvalNote: "Jo, decision 159; HELD by decision 388 (spot-only rewording awaiting Jo)", gate: { kind: "text", smsType: "spot_saved" },
    source: { builder: "src/lib/spot-saved-messages.core.ts", fn: "renderSpotSavedSms", sender: "src/lib/spot-saved-send.server.ts" },
    render: () => text(renderSpotSavedSms({ firstName: "Helen", rebate: 1610, suburb: "Glen Waverley", shortAddress: SHORT_ADDRESS, myJobUrl: JOB, optOutUrl: UNSUB })) }),
  // Ready Check
  ENTRY({ id: "owner:O11", section: "owner", step: "ready_check", kind: "email", code: "O11", name: "Pick a time for your Ready Check", when: "The installer offers 3 Ready Check times", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 77", gate: { kind: "email" },
    source: { builder: "src/lib/ready-check-times-email.core.ts", fn: "renderReadyCheckTimesEmail", sender: "src/lib/ready-check-times-email.server.ts" }, design: "docs/templates/owner/O11-ready-check-times.html",
    render: () => email(renderReadyCheckTimesEmail({ firstName: "Helen", suburb: "Glen Waverley", installerName: "Sample Insulation Co", times: ["Tuesday 28 October at 8:00am", "Wednesday 29 October at 12:30pm", "Friday 31 October at 7:30am"], myJobUrl: JOB, estimate: { rebate: 1610, price: 2188, areaM2: 137 } })) }),
  ENTRY({ id: "owner:sms-ready_check_times_owner", section: "owner", step: "ready_check", kind: "text", code: "", name: "Ready Check times are ready (text)", when: "The installer offers 3 Ready Check times", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 78", gate: { kind: "text", smsType: "ready_check_times_owner" },
    source: { builder: "src/lib/approved-texts.core.ts", fn: "readyCheckTimesOwnerText", sender: "src/lib/approved-texts.server.ts" },
    render: () => text(readyCheckTimesOwnerText({ firstName: "Helen", suburb: "Glen Waverley", link: JOB })) }),
  ENTRY({ id: "owner:O12", section: "owner", step: "ready_check", kind: "email", code: "O12", name: "Ready Check booked", when: "The owner picks a Ready Check time (or it changes)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 81", gate: { kind: "email" },
    source: { builder: "src/lib/ready-check-booked-email.core.ts", fn: "renderReadyCheckBookedEmail", sender: "src/lib/ready-check-booked-email.server.ts" }, design: "docs/templates/owner/O12-ready-check-booked.html",
    render: () => email(renderReadyCheckBookedEmail({ firstName: "Helen", when: "Wednesday 28 October at 8:00am", installerName: "Sample Insulation Co", installerPhone: "0400 000 000", address: SHORT_ADDRESS, changed: false, myJobUrl: JOB, estimate: { rebate: 1610, price: 2188, areaM2: 137 } })) }),
  ENTRY({ id: "owner:sms-ready_check_booked_owner", section: "owner", step: "ready_check", kind: "text", code: "", name: "Ready Check booked (text)", when: "The owner picks a Ready Check time", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 82 (text B)", gate: { kind: "text", smsType: "ready_check_booked_owner" },
    source: { builder: "src/lib/approved-texts.core.ts", fn: "readyCheckBookedOwnerText", sender: "src/lib/approved-texts.server.ts" },
    render: () => text(readyCheckBookedOwnerText({ startIso: RC_ISO, installer: "Sample Insulation Co", phone: "0400 000 000", link: JOB })) }),
  ENTRY({ id: "owner:sms-visit_tomorrow_owner", section: "owner", step: "ready_check", kind: "text", code: "", name: "See you tomorrow (text)", when: "From 4pm the afternoon before a Ready Check, safety check or install", who: "Owner", approvalNote: "Jo 24 Oct 2026, decisions 82, 93, 99", gate: { kind: "text", smsType: "visit_tomorrow_owner" },
    source: { builder: "src/lib/approved-texts.core.ts", fn: "readyCheckTomorrowOwnerText", sender: "src/lib/approved-texts.server.ts" },
    render: () => texts([
      { label: "Ready Check", body: readyCheckTomorrowOwnerText({ startIso: RC_ISO, installer: "Sample Insulation Co", phone: "0400 000 000" }) },
      { label: "Safety check", body: piesaTomorrowOwnerText({ startIso: PIESA_ISO, electrician: "Spark Electrical", phone: "0400 111 222" }) },
      { label: "Install day", body: installTomorrowOwnerText({ startIso: INSTALL_ISO, installer: "Sample Insulation Co", phone: "0400 000 000" }) },
    ]) }),
  // Quote
  ENTRY({ id: "owner:O18", section: "owner", step: "quote", kind: "email", code: "O18", name: "Your quote is ready", when: "Quote released to the owner (office Send, or automatically when the Ready Check is complete)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 86", gate: { kind: "email" },
    source: { builder: "src/lib/owner-quote-email.core.ts", fn: "renderOwnerQuoteEmail", sender: "src/lib/quote-ready-notify.server.ts" }, design: "docs/templates/owner/O18-quote-ready.html",
    render: () => email(renderOwnerQuoteEmail(QUOTE)) }),
  ENTRY({ id: "owner:sms-quote_ready", section: "owner", step: "quote", kind: "text", code: "", name: "Your quote is ready (text)", when: "Quote released to the owner", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 87 (text B)", gate: { kind: "text", smsType: "quote_ready" },
    source: { builder: "src/lib/owner-quote-email.core.ts", fn: "ownerQuoteSms", sender: "src/lib/quote-ready-notify.server.ts" },
    render: () => text(ownerQuoteSms("Helen", `${JOB}?screen=quote`)) }),
  ENTRY({ id: "owner:O19", section: "owner", step: "quote", kind: "email", code: "O19", name: "Quote reminder", when: "3 days after the quote, and 2 days before the price expires", who: "Owner", approvalNote: "Jo 24 Oct 2026, decisions 88/89", gate: { kind: "email" },
    source: { builder: "src/lib/owner-quote-email.core.ts", fn: "renderQuoteReminderEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/owner/O19-quote-reminder.html",
    render: () => email(renderQuoteReminderEmail({ ...QUOTE, kind: "day3" })) }),
  ENTRY({ id: "owner:sms-quote_reminder", section: "owner", step: "quote", kind: "text", code: "", name: "Quote reminder (text)", when: "3 days after the quote, and 2 days before the price expires", who: "Owner", approvalNote: "Jo 24 Oct 2026, decisions 88/89", gate: { kind: "text", smsType: "quote_reminder" },
    source: { builder: "src/lib/approved-texts.core.ts", fn: "quoteReminderDay3Text", sender: "src/lib/approved-texts.server.ts" },
    render: () => texts([
      { label: "Day 3", body: quoteReminderDay3Text({ firstName: "Helen", rebate: 1850, link: `${JOB}?screen=quote` }) },
      { label: "2 days before expiry", body: quoteReminderExpiryText({ firstName: "Helen", rebate: 1850, heldUntilIso: "2026-11-07T12:59:59.999Z", link: `${JOB}?screen=quote` }) },
    ]) }),
  ENTRY({ id: "owner:O22", section: "owner", step: "quote", kind: "email", code: "O22", name: "You're in! (quote accepted)", when: "The owner accepts and pays the safety check; signed acceptance, receipt and the VEU factsheet (when on file) attached", who: "Owner", approvalNote: "Jo 24 Oct 2026", gate: { kind: "email" },
    source: { builder: "src/lib/acceptance-email.core.ts", fn: "renderYoureInEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/owner/O22-youre-in.html",
    render: () => email(renderYoureInEmail({ firstName: "Helen", rebate: 1850, totalIncGst: 2200, payment: { amount: 349, paidOn: "24 Oct 2026", cardLast4: "4242" }, installerName: "Sample Insulation Co", myJobUrl: JOB })) }),
  // Safety check
  ENTRY({ id: "owner:O26", section: "owner", step: "safety_check", kind: "email", code: "O26", name: "Pick a time for your safety check", when: "The electrician offers 3 safety check times", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 93", gate: { kind: "email" },
    source: { builder: "src/lib/safety-check-emails.core.ts", fn: "renderSafetyCheckTimesEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/owner/O26-safety-check-times.html",
    render: () => email(renderSafetyCheckTimesEmail({ firstName: "Helen", electricianName: "Spark Electrical", times: ["Thursday 5 November at 8:00am", "Friday 6 November at 12:30pm", "Monday 9 November at 7:30am"], myJobUrl: JOB, paid: 349 })) }),
  ENTRY({ id: "owner:safety-check-booked", section: "owner", step: "safety_check", kind: "email", code: "", name: "Safety check booked", when: "The owner picks a safety check time (or it changes)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 93", gate: { kind: "email" },
    source: { builder: "src/lib/safety-check-emails.core.ts", fn: "renderSafetyCheckBookedEmail", sender: "src/lib/approved-owner-emails.server.ts" },
    render: () => email(renderSafetyCheckBookedEmail({ firstName: "Helen", when: "Thursday 5 November at 8:00am", electricianName: "Spark Electrical", electricianPhone: "0400 111 222", address: SHORT_ADDRESS, changed: false, myJobUrl: JOB })) }),
  ENTRY({ id: "owner:sms-safety_check_booked_owner", section: "owner", step: "safety_check", kind: "text", code: "", name: "Safety check booked (text)", when: "The owner picks a safety check time", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 93 (text A)", gate: { kind: "text", smsType: "safety_check_booked_owner" },
    source: { builder: "src/lib/approved-texts.core.ts", fn: "piesaBookedOwnerText", sender: "src/lib/approved-texts.server.ts" },
    render: () => text(piesaBookedOwnerText({ startIso: PIESA_ISO, electrician: "Spark Electrical", phone: "0400 111 222", link: JOB })) }),
  ENTRY({ id: "owner:O71", section: "owner", step: "safety_check", kind: "email", code: "O71", name: "Please confirm your safety check", when: "After the electrician completes the PIESA; reminders days 1 and 3 (O71b)", who: "Owner", approvalNote: "Jo 25 Oct 2026, decisions 296/311", gate: { kind: "email" },
    source: { builder: "src/lib/piesa-owner-confirm-email.core.ts", fn: "renderPiesaOwnerConfirmEmail", sender: "src/lib/piesa-owner-confirm-send.server.ts" }, design: "docs/templates/owner/O71-piesa-confirm.html",
    render: () => email(renderPiesaOwnerConfirmEmail({ firstName: "Helen", assessmentDate: "5 November 2026", electricianLine: "Sam Spark (Spark Electrical Pty Ltd)", outcomeKind: "all_clear", confirmUrl: JOB, unsubscribeUrl: null, reminder: false })) }),
  ENTRY({ id: "owner:O71b", section: "owner", step: "safety_check", kind: "email", code: "O71b", name: "Safety check still needs your confirmation", when: "Days 1 and 3 after the request when not yet confirmed (day 5 → office)", who: "Owner", approvalNote: "Jo 25 Oct 2026, decisions 296/311", gate: { kind: "email" },
    source: { builder: "src/lib/piesa-owner-confirm-email.core.ts", fn: "renderPiesaOwnerConfirmEmail", sender: "src/lib/piesa-owner-confirm-send.server.ts" }, design: "docs/templates/owner/O71b-piesa-confirm-reminder.html",
    render: () => email(renderPiesaOwnerConfirmEmail({ firstName: "Helen", assessmentDate: "5 November 2026", electricianLine: "Sam Spark (Spark Electrical Pty Ltd)", outcomeKind: "all_clear", confirmUrl: JOB, unsubscribeUrl: null, reminder: true })) }),
  ENTRY({ id: "owner:sms-piesa_owner_confirm", section: "owner", step: "safety_check", kind: "text", code: "", name: "Confirm your safety check (text)", when: "With O71 and its day 1/3 reminders", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 311", gate: { kind: "text", smsType: "piesa_owner_confirm" },
    source: { builder: "src/lib/piesa-owner-confirm.core.ts", fn: "piesaOwnerConfirmRequestText", sender: "src/lib/piesa-owner-confirm-send.server.ts" },
    render: () => texts([{ label: "Request", body: piesaOwnerConfirmRequestText(JOB) }, { label: "Reminder (days 1 and 3)", body: piesaOwnerConfirmReminderText(JOB) }]) }),
  ENTRY({ id: "owner:O28", section: "owner", step: "safety_check", kind: "email", code: "O28", name: "Your safety check copy (PIESA)", when: "The signed PIESA is filed (at least 24 hours before the install)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 131", gate: { kind: "email" },
    source: { builder: "src/lib/piesa-delivery.core.ts", fn: "renderPiesaCopyEmail", sender: "src/lib/piesa-delivery.server.ts" }, design: "docs/templates/owner/O28-piesa-copy.html",
    render: () => email(renderPiesaCopyEmail({ recipient: "owner", firstName: "Helen", address: SHORT_ADDRESS, jobNumber: "HV-TEST", signatureDate: "2026-11-05", installStart: INSTALL_ISO, link: JOB, electrician: { name: "Spark Electrical", licence: "12345", rec: "67890" } })) }),
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
  ENTRY({ id: "owner:O29", section: "owner", step: "fixes", kind: "email", code: "O29", name: "Your electrical fixes quote", when: "The safety check finds repair work: fixes quote released (automatically when priced on the A3, decision 354)", who: "Owner", approvalNote: "Jo 24 Oct 2026", gate: { kind: "email" },
    source: { builder: "src/lib/rectification-quote-email.core.ts", fn: "renderFixesQuoteEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/owner/O29-fixes-quote.html",
    render: () => email(renderFixesQuoteEmail({ firstName: "Helen", electricianName: "Spark Electrical", checkedOn: "Thursday 5 November", found: ["4 old downlights that can't be covered by insulation", "One ceiling cable joint that isn't enclosed"], lines: [{ description: "Replace 4 downlights with IC-rated LEDs", detail: "4 × $120.00, supplied and installed", lineTotalIncGst: 480 }, { description: "Enclose cable joint in a junction box", detail: "Labour and parts", lineTotalIncGst: 200 }], totalIncGst: 680, expiresOn: "5 December", approveUrl: `${JOB}?screen=fixes` })) }),
  ENTRY({ id: "owner:fixes-confirm", section: "owner", step: "fixes", kind: "email", code: "", name: "Please confirm your electrical fixes", when: "The electrician completes the A4 fixes form; reminders days 1 and 3", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 330", gate: { kind: "email" },
    source: { builder: "src/lib/piesa-fixes-confirm-email.core.ts", fn: "renderPiesaFixesConfirmEmail", sender: "src/lib/piesa-fixes-confirm-send.server.ts" },
    render: () => email(renderPiesaFixesConfirmEmail({ firstName: "Helen", fixesDate: "9 November 2026", electricianLine: "Sam Spark (Spark Electrical Pty Ltd)", confirmUrl: JOB, unsubscribeUrl: UNSUB })) }),
  ENTRY({ id: "owner:sms-piesa_owner_fixes_confirm", section: "owner", step: "fixes", kind: "text", code: "", name: "Confirm your electrical fixes (text)", when: "With the fixes confirmation email and its reminders", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 330", gate: { kind: "text", smsType: "piesa_owner_fixes_confirm" },
    source: { builder: "src/lib/piesa-fixes-confirm.core.ts", fn: "piesaFixesConfirmText", sender: "src/lib/piesa-fixes-confirm-send.server.ts" },
    render: () => text(piesaFixesConfirmText(JOB)) }),
  // Install
  ENTRY({ id: "owner:O33", section: "owner", step: "install", kind: "email", code: "O33", name: "Pick your install day", when: "The installer offers 3 install days after clearance", who: "Owner", approvalNote: "Jo 24 Oct 2026", gate: { kind: "email" },
    source: { builder: "src/lib/install-days-email.core.ts", fn: "renderInstallDaysEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/owner/O33-install-days.html",
    render: () => email(renderInstallDaysEmail({ firstName: "Helen", installerName: "Sample Insulation Co", days: ["Wednesday 11 November at 7:30am", "Thursday 12 November at 12:30pm", "Monday 16 November at 7:30am"], myJobUrl: JOB, balanceIncGst: 1851, installBy: "4 December" })) }),
  ENTRY({ id: "owner:O35", section: "owner", step: "install", kind: "email", code: "O35", name: "Your install is booked", when: "Consent signed and the install deposit received", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 98", gate: { kind: "email" },
    source: { builder: "src/lib/install-booked-email.core.ts", fn: "renderInstallBookedEmail", sender: "src/lib/install-booked-email.server.ts" }, design: "docs/templates/owner/O35-install-booked.html",
    render: () => email(renderInstallBookedEmail({ firstName: "Helen", when: "Wednesday 11 November at 7:30am", address: SHORT_ADDRESS, installerName: "Sample Insulation Co", installerPhone: "0400 000 000", removal: true, myJobUrl: JOB, consentSigned: true, payment: { depositPaid: 185.1, cardLast4: null, balanceDue: 1665.9 } })) }),
  ENTRY({ id: "owner:O63", section: "owner", step: "install", kind: "email", code: "O63", name: "Your signed consent form", when: "The AP signs the ESC owner's consent (executed PDF attached)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 170", gate: { kind: "email" },
    source: { builder: "src/lib/consent-copy-email.core.ts", fn: "renderConsentCopyEmail", sender: "src/lib/consent-copy-email.server.ts" }, design: "docs/templates/owner/O63-consent-copy.html",
    render: () => email(renderConsentCopyEmail({ firstName: "Helen", installationDays: ["2026-11-11"], address: ADDRESS, templateVersion: ESC_CONSENT_TEMPLATE_VERSION, formText: consentSample(), sha256: "0".repeat(64), myJobUrl: JOB, attached: true })) }),
  ENTRY({ id: "owner:O42", section: "owner", step: "install", kind: "email", code: "O42", name: "Your install day has changed", when: "The agreed install day moves", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 135", gate: { kind: "email" },
    source: { builder: "src/lib/install-days-email.core.ts", fn: "renderInstallDayChangedEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/owner/O42-install-day-changed.html",
    render: () => email(renderInstallDayChangedEmail({ firstName: "Helen", installerName: "Sample Insulation Co", installerPhone: "0400 000 000", address: SHORT_ADDRESS, when: "Thursday 12 November at 7:30am", was: "Wednesday 11 November at 7:30am", myJobUrl: JOB })) }),
  ENTRY({ id: "owner:sms-install_moved", section: "owner", step: "install", kind: "text", code: "", name: "Your install has moved (text)", when: "The agreed install day moves", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 135", gate: { kind: "text", smsType: "install_moved" },
    source: { builder: "src/lib/approved-texts.core.ts", fn: "installMovedText", sender: "src/lib/approved-texts.server.ts" },
    render: () => text(installMovedText({ startIso: "2026-11-11T20:30:00Z", link: JOB })) }),
  ENTRY({ id: "owner:O64", section: "owner", step: "install", kind: "email", code: "O64", name: "Your install day was released", when: "The install deposit didn't arrive in time (48h or noon the day before)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 170", gate: { kind: "email" },
    source: { builder: "src/lib/deposit-release-notice.core.ts", fn: "renderDepositReleasedEmail", sender: "src/lib/deposit-release-notice.server.ts" }, design: "docs/templates/owner/O64-deposit-released.html",
    render: () => email(renderDepositReleasedEmail({ firstName: "Helen", day: "Wednesday 11 November", link: JOB, depositAmount: "$185.10", bankLines: bankDetailLines(HIV_BANK_DETAILS, "Home Insulation Victoria HV-TEST") })) }),
  ENTRY({ id: "owner:sms-deposit_release", section: "owner", step: "install", kind: "text", code: "", name: "Install day released (text)", when: "With O64", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 170", gate: { kind: "text", smsType: "deposit_release" },
    source: { builder: "src/lib/deposit-release-notice.core.ts", fn: "depositReleaseText", sender: "src/lib/deposit-release-notice.server.ts" },
    render: () => text(depositReleaseText({ firstName: "Helen", day: "Wednesday 11 November", link: JOB })) }),
  ENTRY({ id: "owner:O65", section: "owner", step: "install", kind: "email", code: "O65", name: "We couldn't get in today", when: "The installer reports no access on the install day", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 217", gate: { kind: "email" },
    source: { builder: "src/lib/install-no-access-notice.core.ts", fn: "renderInstallNoAccessEmail", sender: "src/lib/install-no-access-notice.server.ts" }, design: "docs/templates/owner/O65-install-no-access.html",
    render: () => email(renderInstallNoAccessEmail({ firstName: "Helen", installerName: "Sample Insulation Co", day: "Wednesday 11 November", newDays: [], installBy: "4 December", link: JOB })) }),
  ENTRY({ id: "owner:sms-install_no_access", section: "owner", step: "install", kind: "text", code: "", name: "We couldn't get in today (text)", when: "With O65", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 217", gate: { kind: "text", smsType: "install_no_access" },
    source: { builder: "src/lib/install-no-access-notice.core.ts", fn: "installNoAccessText", sender: "src/lib/install-no-access-notice.server.ts" },
    render: () => text(installNoAccessText({ firstName: "Helen", installerName: "Sample Insulation Co", newDays: [], link: JOB })) }),
  // Rebate
  ENTRY({ id: "owner:O44", section: "owner", step: "rebate", kind: "email", code: "O44", name: "All done! Sign your rebate form", when: "Install complete (day 0 of the rebate form asks)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 169", gate: { kind: "email" },
    source: { builder: "src/lib/completion-emails.core.ts", fn: "renderInstallCompleteEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/owner/O44-install-complete.html",
    render: () => email(renderInstallCompleteEmail({ firstName: "Helen", installer: REINSULATE, product: "Bradford Gold R5.0", areaM2: 137.6, rebate: 1850, balancePaid: true, signRebateFormUrl: `${JOB}?screen=done` })) }),
  ENTRY({ id: "owner:sms-veec_sign_request", section: "owner", step: "rebate", kind: "text", code: "", name: "Sign your rebate form (text)", when: "Install complete", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 166", gate: { kind: "text", smsType: "veec_sign_request" },
    source: { builder: "src/lib/veec-assignment-form.core.ts", fn: "veecSignRequestText", sender: "src/lib/veec-reminders.server.ts" },
    render: () => text(veecSignRequestText(1850, `${JOB}?screen=done`)) }),
  ENTRY({ id: "owner:O61", section: "owner", step: "rebate", kind: "email", code: "O61", name: "Your rebate form still needs your signature", when: "Days 1, 3 and 7 after the install while unsigned (day 10 → office)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decisions 168/169", gate: { kind: "email" },
    source: { builder: "src/lib/veec-emails.core.ts", fn: "renderVeecReminderEmail", sender: "src/lib/veec-reminders.server.ts" }, design: "docs/templates/owner/O61-veec-reminder.html",
    render: () => email(renderVeecReminderEmail({ firstName: "Helen", rebate: 1850, signUrl: `${JOB}?screen=done`, unsubscribeUrl: UNSUB })) }),
  ENTRY({ id: "owner:sms-veec_sign_reminder", section: "owner", step: "rebate", kind: "text", code: "", name: "Rebate form reminder (text)", when: "Days 1, 3 and 7 after the install while unsigned", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 168", gate: { kind: "text", smsType: "veec_sign_reminder" },
    source: { builder: "src/lib/veec-assignment-form.core.ts", fn: "veecSignReminderText", sender: "src/lib/veec-reminders.server.ts" },
    render: () => text(veecSignReminderText(1850, `${JOB}?screen=done`)) }),
  ENTRY({ id: "owner:O62", section: "owner", step: "rebate", kind: "email", code: "O62", name: "Here's your signed rebate form", when: "Within 10 business days of the owner signing (executed PDF attached)", who: "Owner", approvalNote: "Jo 24 Oct 2026", gate: { kind: "email" },
    source: { builder: "src/lib/veec-emails.core.ts", fn: "renderVeecCopyEmail", sender: "src/lib/veec-copy-email.server.ts" }, design: "docs/templates/owner/O62-veec-copy.html",
    render: () => email(renderVeecCopyEmail({ firstName: "Helen", jobNumber: "HV-TEST", signedAt: "2026-11-21T03:00:00.000Z", myJobUrl: `${JOB}?screen=done`, unsubscribeUrl: UNSUB })) }),
  // Paid
  ENTRY({ id: "owner:O47", section: "owner", step: "paid", kind: "email", code: "O47", name: "Your completion pack", when: "Install complete and the invoice paid (product warranty PDF attached)", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 276", gate: { kind: "email" },
    source: { builder: "src/lib/completion-emails.core.ts", fn: "renderCompletionPackEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/owner/O47-completion-pack.html",
    render: () => email(renderCompletionPackEmail({ firstName: "Helen", installer: REINSULATE, downloads: { certificateUrl: null, invoiceUrl: null, warrantiesUrl: `${JOB}?screen=done`, signedFormsUrl: `${JOB}?screen=done` }, installed: { description: "Ceiling insulation — Bradford Gold Ceiling Batt R5.0 — 137.6 m²", escModelCodes: ["467911"] } })) }),
  ENTRY({ id: "owner:O73", section: "owner", step: "paid", kind: "email", code: "O73", name: "Your insulation warranty", when: "A product warranty PDF that was missing from the completion pack is added later", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 375", gate: { kind: "email" },
    source: { builder: "src/lib/warranty-followup.core.ts", fn: "renderWarrantyFollowupEmail", sender: "src/lib/warranty-followup.server.ts" }, design: "docs/templates/owner/O73-warranty-followup.html",
    render: () => email(renderWarrantyFollowupEmail({ firstName: "Helen", products: ["Bradford Gold"], unsubscribeUrl: null })) }),
  ENTRY({ id: "owner:O51", section: "owner", step: "paid", kind: "email", code: "O51", name: "How's your home feeling? (review)", when: "A week after the install", who: "Owner", approvalNote: "Jo 24 Oct 2026, decision 335", gate: { kind: "email" },
    source: { builder: "src/lib/completion-emails.core.ts", fn: "renderReviewRequestEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/owner/O51-review.html",
    render: () => email(renderReviewRequestEmail({ firstName: "Helen", installer: REINSULATE, starUrl: (n) => `${JOB}?screen=review&stars=${n}`, googleReviewUrl: "https://g.page/r/TEST/review", referralUrl: "https://homeinsulationvictoria.com.au/homeowner?ref=TEST" })) }),
  // Any time
  ENTRY({ id: "owner:change-reply", section: "owner", step: "any", kind: "email", code: "", name: "Change or cancel reply", when: "A matched owner emails to change a visit day/time or cancel: ONE reply with their My job link", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 337", gate: { kind: "email" },
    source: { builder: "src/lib/email-change-reply.core.ts", fn: "renderChangeReplyEmail", sender: "src/lib/email-change-reply.server.ts" },
    render: () => email(renderChangeReplyEmail({ firstName: "Helen", visit: "install", link: `${JOB}?screen=book`, cancelNote: cancelNote(false), theirSubject: "Change of install day", unsubscribe: null })) }),
  ENTRY({ id: "owner:O69", section: "owner", step: "any", kind: "email", code: "O69", name: "Job cancelled", when: "The office cancels the job with the owner tick on", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 291", gate: { kind: "email" },
    source: { builder: "src/lib/cancel-notice.core.ts", fn: "renderOwnerCancelledEmail", sender: "src/lib/cancel-notice.server.ts" }, design: "docs/templates/owner/O69-job-cancelled.html",
    render: () => email(renderOwnerCancelledEmail({ firstName: "Helen", jobNumber: "HV-TEST", address: ADDRESS, officePhone: "03 9000 0000" })) }),
  // Decision 384 (Jo 25 Oct 2026): approved as drafted in decision 376.
  ENTRY({ id: "owner:O74", section: "owner", step: "any", kind: "email", code: "O74", name: "Your visit needs a new time", when: "The trade cancels a booked Ready Check, safety check or install day: owner chooses new times on My job", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 384 (drafted in decision 376)", gate: { kind: "email" },
    source: { builder: "src/lib/visit-new-times.core.ts", fn: "renderVisitNewTimesEmail", sender: "src/lib/visit-new-times.server.ts" }, design: "docs/templates/owner/O74-visit-new-times.html",
    render: () => email(renderVisitNewTimesEmail({ kind: "assessment", wasIso: PIESA_ISO, ownerPicks: true, link: `${JOB}?screen=book`, firstName: "Helen", unsubscribeUrl: null })) }),
  ENTRY({ id: "owner:O74b", section: "owner", step: "any", kind: "email", code: "O74b", name: "Your visit is moving (new times on the way)", when: "The trade cancels a booked visit and will offer the new times", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 384 (drafted in decision 376)", gate: { kind: "email" },
    source: { builder: "src/lib/visit-new-times.core.ts", fn: "renderVisitNewTimesEmail", sender: "src/lib/visit-new-times.server.ts" }, design: "docs/templates/owner/O74b-visit-new-times-on-the-way.html",
    render: () => email(renderVisitNewTimesEmail({ kind: "installation", wasIso: INSTALL_ISO, ownerPicks: false, link: `${JOB}?screen=book`, firstName: "Helen", unsubscribeUrl: null })) }),
  ENTRY({ id: "owner:sms-visit_new_times", section: "owner", step: "any", kind: "text", code: "", name: "Your visit needs a new time (text)", when: "With O74 / O74b", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 384 (drafted in decision 376)", gate: { kind: "text", smsType: "visit_new_times" },
    source: { builder: "src/lib/visit-new-times.core.ts", fn: "visitNewTimesText", sender: "src/lib/visit-new-times.server.ts" },
    render: () => texts([
      { label: "Owner picks new times", body: visitNewTimesText({ kind: "assessment", wasIso: PIESA_ISO, ownerPicks: true, link: `${JOB}?screen=book` }) },
      { label: "New times on the way", body: visitNewTimesText({ kind: "installation", wasIso: INSTALL_ISO, ownerPicks: false, link: `${JOB}?screen=book` }) },
    ]) }),
  ENTRY({ id: "owner:O75", section: "owner", step: "quote", kind: "email", code: "O75", name: "Your signed paperwork", when: "One email per signing sitting with the signed Gate B PDFs attached", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 384 (drafted in decision 376)", gate: { kind: "email" },
    source: { builder: "src/lib/paperwork-copy-email.core.ts", fn: "renderPaperworkCopyEmail", sender: "src/lib/paperwork-copy-email.server.ts" }, design: "docs/templates/owner/O75-signed-paperwork-copy.html",
    render: () => email(renderPaperworkCopyEmail({ firstName: "Helen", address: ADDRESS, titles: ["The agreement", "Payment", "Your rebate (VEEC assignment)"], attached: true, myJobUrl: JOB, unsubscribeUrl: null })) }),
  ENTRY({ id: "owner:signing-code", section: "owner", step: "any", kind: "email", code: "", name: "Your signing code (email)", when: "The owner asks for a 6-digit code to sign on My job", who: "Owner", approvalNote: "Jo (sign-in code wording)", gate: { kind: "always" },
    source: { builder: "src/lib/owner-code-delivery.core.ts", fn: "ownerCodeEmail", sender: "src/lib/owner-code-delivery.server.ts" },
    render: () => email({ subject: "Your signing code", html: ownerCodeEmail("123456").html }) }),
  ENTRY({ id: "owner:sms-owner_code", section: "owner", step: "any", kind: "text", code: "", name: "Your signing code (text)", when: "The owner asks for a 6-digit code to sign on My job", who: "Owner", approvalNote: "Jo (sign-in code wording)", gate: { kind: "text", smsType: "owner_code" },
    source: { builder: "src/lib/owner-code-delivery.core.ts", fn: "ownerCodeSmsBody", sender: "src/lib/owner-code-delivery.server.ts" },
    render: () => text(ownerCodeSmsBody("123456")) }),
  // My job pages (approved mock-ups the live page copies byte-for-byte; owner-pages.core.test proves the wording)
  ...([["P1", "enquiry", "Tell us about your insulation (questions page)", "The O2 questions link", "P1-questions-page.html"],
    ["P2", "quote", "View and accept your quote", "The O18 quote link (?screen=quote)", "P2-quote-accept-page.html"],
    ["P6", "safety_check", "Confirm your safety check", "The O71 link after the electrician completes the PIESA", "P6-piesa-confirm-page.html"],
    ["P3", "install", "Owner's consent form (ESC)", "After the install day is agreed, at least 24 hours before work", "P3-owner-consent-page.html"],
    ["P4", "rebate", "Sign your rebate form (VEEC assignment)", "The O44 / O61 link after the install", "P4-veec-sign-page.html"]] as const).map(([code, step, name, when, file]) =>
    ENTRY({ id: `owner:${code}`, section: "owner", step, kind: "page", code, name, when, who: "Owner (My job link)", approvalNote: "Jo 24 Oct 2026, decisions 125–130", gate: { kind: "always" },
      source: { builder: "src/lib/owner-pages.core.ts", fn: code, sender: "src/routes/my-job.$token.tsx" }, design: `docs/templates/owner/${file}`,
      render: () => ({ kind: "file", path: `docs/templates/owner/${file}`, as: "html", note: "Jo's approved page design. The live My job page uses this wording byte-for-byte (owner-pages.core.ts, tested by tests/owner-pages.core.test.ts)." }) })),
  // Owner paperwork (Gate B, current versions)
  ...GATE_DOCS.filter((d) => d.gate === "B" && !RETIRED_DOC_KEYS.has(d.key)).map((d) =>
    ENTRY({ id: `owner:paperwork:${d.key}`, section: "owner", step: "quote", kind: "paperwork", code: "", name: `Paperwork: ${d.title}`, when: d.signer === "office" ? "Gate B (before the install is booked) — the office records it" : "Gate B: signed or ticked by the owner on My job before the install is booked", who: d.signer === "office" ? "Office records (owner's landlord)" : "Owner", approvalNote: d.approvalNote ?? `Version ${d.version}: approval stored in Settings › Owner paperwork`, gate: { kind: "always" },
      source: { builder: "src/lib/owner-gates.core.ts", fn: "GATE_DOCS", sender: "src/lib/owner-gates.server.ts" }, paperworkKey: d.key,
      render: () => ({ kind: "doc", title: `${d.title} — ${d.version}`, body: `${d.key === "payment_terms" ? paymentTermsText(paymentTermsMoney({ quoteTotalCents: 220000, safetyCheckCents: 34900, installDepositCents: 18510, balanceCents: 166590 })) : fillTemplate(d.body, SAMPLE_VARS)}\n\n[ ] ${d.tick}`, note: "Sample values filled in. The tick label is what the owner presses." }) })),
  // Decision 389: Jo releases a saved spot → "It's your turn" to the owner (email + text, day-2 reminder). Approved by Jo 25 Oct 2026.
  ENTRY({ id: "owner:O77", section: "owner", step: "ready_check", kind: "email", code: "O77", name: "It's your turn — confirm your free Ready Check", when: "Jo presses Release on Jobs › Choose installer (and the day-2 reminder); the installer is offered the job only after the owner confirms", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 389", gate: { kind: "email" },
    source: { builder: "src/lib/spot-release-email.core.ts", fn: "renderSpotReleasedEmail", sender: "src/lib/spot-release.server.ts" }, design: "docs/templates/owner/O77-spot-released.html",
    render: () => email(renderSpotReleasedEmail({ firstName: "Helen", confirmUrl: `${JOB}?screen=turn`, unsubscribeUrl: UNSUB, reminder: false })) }),
  ENTRY({ id: "owner:sms-spot_released", section: "owner", step: "ready_check", kind: "text", code: "", name: "It's your turn (text)", when: "With O77 and its day-2 reminder", who: "Owner", approvalNote: "Jo 25 Oct 2026, decision 389", gate: { kind: "text", smsType: "spot_released" },
    source: { builder: "src/lib/spot-release.core.ts", fn: "spotReleasedText", sender: "src/lib/spot-release.server.ts" },
    render: () => texts([{ label: "Released", body: spotReleasedText(`${JOB}?screen=turn`) }, { label: "Day-2 reminder", body: spotReleasedText(`${JOB}?screen=turn`, true) }]) }),
];

/* ---------------------------------------------------------------- INSTALLER */

const INSTALLER: TemplateEntry[] = [
  ENTRY({ id: "installer:I53", section: "installer", step: "enquiry", kind: "email", code: "I53", name: "Application received", when: "An installer business submits its application", who: "Installer applicant", approvalNote: "Jo 24 Oct 2026, decision 136", gate: { kind: "email" },
    source: { builder: "src/lib/application-review.core.ts", fn: "renderApplicationReceivedEmail", sender: "src/lib/trade-messages.server.ts" }, design: "docs/templates/installer/I53-application-received.html",
    render: () => email(renderApplicationReceivedEmail({ contactName: "Sam", businessName: "Sample Insulation Co" })) }),
  ENTRY({ id: "installer:changes", section: "installer", step: "enquiry", kind: "email", code: "", name: "Application — send back for changes", when: "Office presses Send back (with a typed message)", who: "Installer or electrician applicant", approvalNote: "Jo 8 Oct 2026", gate: { kind: "email" },
    source: { builder: "src/lib/application-review.core.ts", fn: "changesEmail", sender: "src/lib/application-review.server.ts" },
    render: () => email(changesEmail({ contactName: "Sam Sample", message: "[The office's typed message appears here]", link: `${BASE}/installer-onboarding?resume=TEST`, test: false })) }),
  ENTRY({ id: "installer:decline", section: "installer", step: "enquiry", kind: "email", code: "", name: "Application — declined", when: "Office presses Decline", who: "Installer or electrician applicant", approvalNote: "Jo 8 Oct 2026", gate: { kind: "email" },
    source: { builder: "src/lib/application-review.core.ts", fn: "declineEmail", sender: "src/lib/application-review.server.ts" },
    render: () => email(declineEmail({ contactName: "Sam Sample", reason: null, test: false })) }),
  ENTRY({ id: "installer:I54", section: "installer", step: "enquiry", kind: "email", code: "I54", name: "Welcome aboard — set your password", when: "Office approves the application and sends the login link", who: "Installer (business owner)", approvalNote: "Jo 24 Oct 2026, decision 107", gate: { kind: "email" },
    source: { builder: "src/lib/partner-email.core.ts", fn: "partnerWelcomeEmail", sender: "src/lib/partner-activation.functions.ts" }, design: "docs/templates/installer/I54-welcome.html",
    render: () => email(partnerWelcomeEmail({ firstName: "Sam", businessName: "Sample Insulation Co", trade: "installer", email: "sam@example.com", link: `${BASE}/reset-password?token_hash=TEST&type=recovery&next=%2Ffield%2Fwelcome`, test: false })) }),
  ENTRY({ id: "installer:I60", section: "installer", step: "enquiry", kind: "email", code: "I60", name: "One quick step: the ESC privacy notice", when: "Each installer person, with reminders on days 3 and 7 until acknowledged", who: "Installer crew member", approvalNote: "Jo 24 Oct 2026, decision 147", gate: { kind: "email" },
    source: { builder: "src/lib/esc-collection-notice.core.ts", fn: "noticeLinkEmail", sender: "src/lib/esc-collection-notice-send.server.ts" }, design: "docs/templates/installer/I60-privacy-notice-link.html",
    render: () => { const n = noticeLinkEmail({ firstName: "Sam", businessName: "Sample Insulation Co", url: `${BASE}/notice/TEST`, reminder: false }); return email({ subject: n.subject, html: partnerEmailLayout({ subject: n.subject, heading: n.heading, blocks: n.blocks, test: false }).html }); } }),
  ENTRY({ id: "installer:sms-esc_notice_link", section: "installer", step: "enquiry", kind: "text", code: "", name: "ESC privacy notice link (text)", when: "With I60 and its reminders", who: "Installer crew member", approvalNote: "Jo 24 Oct 2026, decision 146", gate: { kind: "text", smsType: "esc_notice_link" },
    source: { builder: "src/lib/esc-collection-notice.core.ts", fn: "noticeLinkSmsBody", sender: "src/lib/esc-collection-notice-send.server.ts" },
    render: () => text(noticeLinkSmsBody("Sam", `${BASE}/notice/TEST`)) }),
  ENTRY({ id: "installer:I62", section: "installer", step: "enquiry", kind: "email", code: "I62", name: "Your copy of the ESC privacy notice", when: "The person ticks the notice", who: "Installer crew member", approvalNote: "Jo 24 Oct 2026, decision 170", gate: { kind: "email" },
    source: { builder: "src/lib/esc-collection-notice.core.ts", fn: "collectionNoticeEmail", sender: "src/lib/esc-collection-notice-send.server.ts" }, design: "docs/templates/installer/I62-notice-copy.html",
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
  ENTRY({ id: "installer:sms-usual_electrician_missing", section: "installer", step: "enquiry", kind: "text", code: "", name: "Add your usual electrician (text)", when: "A Ready Check names \"my usual electrician\" but My business has none", who: "Installer (business owner)", approvalNote: "Jo 24 Oct 2026, decisions 83/113", gate: { kind: "text", smsType: "usual_electrician_missing" },
    source: { builder: "src/lib/usual-electrician.core.ts", fn: "usualElectricianReminderBody", sender: "src/lib/usual-electrician-reminder.server.ts" },
    render: () => text(usualElectricianReminderBody("HV-TEST", `${BASE}/field/business`)) }),
  // Ready Check
  ENTRY({ id: "installer:job-offer", section: "installer", step: "ready_check", kind: "email", code: "", name: "New Ready Check job (offer email)", when: "The office (or the automatic offer) offers a lead to the installer", who: "Installer (business owner)", approvalNote: "Jo 24 Oct 2026, decision 76", gate: { kind: "email" },
    source: { builder: "src/lib/ready-check-offer-email.core.ts", fn: "renderReadyCheckOfferEmail", sender: "src/lib/ready-check-offer-text.server.ts" },
    render: () => email(renderReadyCheckOfferEmail({ installerFirstName: "Sam", suburb: "Glen Waverley", offerUrl: `${BASE}/field/offer/TEST`, areaM2: 137 })) }),
  ENTRY({ id: "installer:sms-job_offer", section: "installer", step: "ready_check", kind: "text", code: "", name: "New Ready Check job (text)", when: "With the offer email (after 8pm: texted at 7am)", who: "Installer (business owner)", approvalNote: "Jo 24 Oct 2026, decisions 76/154/361", gate: { kind: "text", smsType: "job_offer" },
    source: { builder: "src/lib/ready-check-times.core.ts", fn: "readyCheckOfferText", sender: "src/lib/ready-check-offer-text.server.ts" },
    render: () => text(readyCheckOfferText("Glen Waverley", `${BASE}/field/offer/TEST`, 137)) }),
  ENTRY({ id: "installer:sms-ready_check_days_suggested", section: "installer", step: "ready_check", kind: "text", code: "", name: "Owner suggested other days (text)", when: "The owner suggests other Ready Check days", who: "Installer (business owner)", approvalNote: "Jo 24 Oct 2026, decision 79", gate: { kind: "text", smsType: "ready_check_days_suggested" },
    source: { builder: "src/lib/installer-texts.core.ts", fn: "readyCheckDaysSuggestedText", sender: "src/lib/installer-texts.server.ts" },
    render: () => text(readyCheckDaysSuggestedText({ suburb: "Glen Waverley", jobNumber: "HV-TEST", link: FIELD })) }),
  ENTRY({ id: "installer:sms-ready_check_booked_installer", section: "installer", step: "ready_check", kind: "text", code: "", name: "Ready Check booked (text)", when: "The owner picks a Ready Check time", who: "Installer (business owner)", approvalNote: "Jo 24 Oct 2026, decision 82 (text A)", gate: { kind: "text", smsType: "ready_check_booked_installer" },
    source: { builder: "src/lib/installer-texts.core.ts", fn: "readyCheckBookedInstallerText", sender: "src/lib/installer-texts.server.ts" },
    render: () => text(readyCheckBookedInstallerText({ startIso: RC_ISO, address: SHORT_ADDRESS, jobNumber: "HV-TEST", link: FIELD })) }),
  ENTRY({ id: "installer:sms-ready_check_incomplete", section: "installer", step: "ready_check", kind: "text", code: "", name: "Ready Check form missing answers (text)", when: "The Mitti Ready Check is missing answers or photos", who: "Installer", approvalNote: "Jo 22 Oct 2026", gate: { kind: "text", smsType: "ready_check_incomplete" },
    source: { builder: "src/lib/ready-check-chase.core.ts", fn: "readyCheckIncompleteText", sender: "src/lib/ready-check-chase.server.ts" },
    render: () => text(readyCheckIncompleteText("HV-TEST", SHORT_ADDRESS, ["finish and submit the form", "who is doing the electrical safety check"])) }),
  ENTRY({ id: "installer:sms-boss_price_link", section: "installer", step: "quote", kind: "text", code: "", name: "Enter your price (text)", when: "A1 Ready Check marked Complete with no price yet", who: "Installer (business owner)", approvalNote: "Jo 25 Oct 2026, decision 288", gate: { kind: "text", smsType: "boss_price_link" },
    source: { builder: "src/lib/boss-price-link.core.ts", fn: "bossPriceLinkText", sender: "src/lib/boss-price-link.server.ts" },
    render: () => text(bossPriceLinkText({ jobNumber: "HV-TEST", street: "824 High Street Road", link: `${FIELD}#price` })) }),
  // Quote
  ENTRY({ id: "installer:I23", section: "installer", step: "quote", kind: "email", code: "I23", name: "Good news — the owner accepted", when: "The owner accepts the quote", who: "Installer", approvalNote: "Jo 24 Oct 2026", gate: { kind: "email" },
    source: { builder: "src/lib/installer-accepted-email.core.ts", fn: "renderInstallerAcceptedEmail", sender: "src/lib/installer-accepted-email.server.ts" }, design: "docs/templates/installer/I23-owner-accepted.html",
    render: () => email(renderInstallerAcceptedEmail(PARTNER_JOB)) }),
  ENTRY({ id: "installer:I24", section: "installer", step: "quote", kind: "email", code: "I24", name: "The owner declined the quote", when: "The owner declines the quote", who: "Installer", approvalNote: "Jo 24 Oct 2026", gate: { kind: "email" },
    source: { builder: "src/lib/installer-accepted-email.core.ts", fn: "renderInstallerDeclinedEmail", sender: "src/lib/installer-declined-email.server.ts" }, design: "docs/templates/installer/I24-owner-declined.html",
    render: () => email(renderInstallerDeclinedEmail({ ...PARTNER_JOB, reasonLabel: "Price too high", reasonNote: "We've decided to wait until next year." })) }),
  // Safety check
  // Decision 384 (Jo 25 Oct 2026): approved as drafted in decision 376.
  ENTRY({ id: "installer:I71", section: "installer", step: "safety_check", kind: "email", code: "I71", name: "Safety check booked (for your planning)", when: "The safety check is booked: the installer is told the date for planning only", who: "Installer", approvalNote: "Jo 25 Oct 2026, decision 384 (drafted in decision 376)", gate: { kind: "email" },
    source: { builder: "src/lib/installer-planning-notice.core.ts", fn: "renderInstallerPlanningEmail", sender: "src/lib/installer-planning-notice.server.ts" }, design: "docs/templates/installer/I71-installer-planning-notice.html",
    render: () => email(renderInstallerPlanningEmail({ jobNumber: "HV-TEST", address: SHORT_ADDRESS, piesaStartIso: PIESA_ISO, link: FIELD, ownerFirstName: "Helen" })) }),
  ENTRY({ id: "installer:sms-installer_planning_notice", section: "installer", step: "safety_check", kind: "text", code: "", name: "Safety check booked (for your planning) (text)", when: "With I71", who: "Installer", approvalNote: "Jo 25 Oct 2026, decision 384 (drafted in decision 376)", gate: { kind: "text", smsType: "installer_planning_notice" },
    source: { builder: "src/lib/installer-planning-notice.core.ts", fn: "installerPlanningText", sender: "src/lib/installer-planning-notice.server.ts" },
    render: () => text(installerPlanningText({ jobNumber: "HV-TEST", address: SHORT_ADDRESS, piesaStartIso: PIESA_ISO, link: FIELD })) }),
  ENTRY({ id: "installer:piesa-copy", section: "installer", step: "safety_check", kind: "email", code: "O28", name: "Safety check copy (installer)", when: "The signed PIESA is filed (at least 24 hours before the install)", who: "Installer", approvalNote: "Jo 24 Oct 2026, decision 131", gate: { kind: "email" },
    source: { builder: "src/lib/piesa-delivery.core.ts", fn: "renderPiesaCopyEmail", sender: "src/lib/piesa-delivery.server.ts" },
    render: () => email(renderPiesaCopyEmail({ recipient: "installer", firstName: "Sam", address: SHORT_ADDRESS, jobNumber: "HV-TEST", signatureDate: "2026-11-05", installStart: INSTALL_ISO, link: FIELD, electrician: { name: "Spark Electrical", licence: "12345", rec: "67890" } })) }),
  ENTRY({ id: "installer:I65", section: "installer", step: "safety_check", kind: "email", code: "I65", name: "Cleared for install — offer 3 days", when: "The safety check (and any fixes) are done", who: "Installer", approvalNote: "Jo 24 Oct 2026, decision 186", gate: { kind: "email" },
    source: { builder: "src/lib/install-clearance.core.ts", fn: "renderInstallClearanceEmail", sender: "src/lib/install-clearance.server.ts" }, design: "docs/templates/installer/I65-install-clearance.html",
    render: () => email(renderInstallClearanceEmail({ jobNumber: "HV-TEST", ownerFirstName: "Helen", fixesSignedOff: false, deadlineLabel: "4 December 2026", jobUrl: FIELD })) }),
  ENTRY({ id: "installer:sms-install_clearance", section: "installer", step: "safety_check", kind: "text", code: "", name: "Cleared for install (text)", when: "With I65", who: "Installer", approvalNote: "Jo 24 Oct 2026, decision 186", gate: { kind: "text", smsType: "install_clearance" },
    source: { builder: "src/lib/install-clearance.core.ts", fn: "installClearanceText", sender: "src/lib/install-clearance.server.ts" },
    render: () => text(installClearanceText({ jobNumber: "HV-TEST", deadlineLabel: "4 December 2026", link: FIELD })) }),
  ENTRY({ id: "installer:install-window", section: "installer", step: "safety_check", kind: "email", code: "", name: "Days left in the 30-day install window", when: "20 and 10 days left while no install day is booked", who: "Installer", approvalNote: "Jo 24 Oct 2026, decision 167", gate: { kind: "email" },
    source: { builder: "src/lib/thirty-day-rule.core.ts", fn: "installerInstallWindowEmail", sender: "src/lib/thirty-day-rule.server.ts" },
    render: () => email(installerInstallWindowEmail({ step: "reminder_10", deadline: "2026-12-04", daysLeft: 10, link: FIELD, jobNumber: "HV-TEST", firstName: "Sam", ownerSuburb: "Glen Waverley" })) }),
  ENTRY({ id: "installer:sms-install_window_reminder_installer", section: "installer", step: "safety_check", kind: "text", code: "", name: "Days left in the 30-day window (text)", when: "20 and 10 days left", who: "Installer", approvalNote: "Jo 24 Oct 2026, decision 167", gate: { kind: "text", smsType: "install_window_reminder_installer" },
    source: { builder: "src/lib/thirty-day-rule.core.ts", fn: "installerInstallWindowText", sender: "src/lib/thirty-day-rule.server.ts" },
    render: () => text(installerInstallWindowText({ step: "reminder_10", deadline: "2026-12-04", daysLeft: 10, link: FIELD, jobNumber: "HV-TEST", firstName: "Sam", ownerSuburb: "Glen Waverley" })) }),
  // Install
  ENTRY({ id: "installer:sms-install_tomorrow", section: "installer", step: "install", kind: "text", code: "", name: "Install tomorrow (text)", when: "The afternoon before the install (with safety plan links while unsigned)", who: "Lead installer", approvalNote: "Jo 24 Oct 2026, decision 99", gate: { kind: "text", smsType: "install_tomorrow" },
    source: { builder: "src/lib/installer-texts.core.ts", fn: "installTomorrowText", sender: "src/lib/installer-texts.server.ts" },
    render: () => text(installTomorrowText({ startIso: INSTALL_ISO, address: SHORT_ADDRESS, jobNumber: "HV-TEST", link: FIELD })) }),
  ENTRY({ id: "installer:sms-swms_sign_link", section: "installer", step: "install", kind: "text", code: "", name: "Sign the safety plan (text)", when: "Install booked, and the day before, to each crew member who hasn't signed the SWMS", who: "Each installer crew member", approvalNote: "Jo 25 Oct 2026, decisions 377/380", gate: { kind: "text", smsType: "swms_sign_link" },
    source: { builder: "src/lib/swms-sign-text.core.ts", fn: "swmsSignLinkText", sender: "src/lib/swms-sign-text.server.ts" },
    render: () => text(swmsSignLinkText({ address: SHORT_ADDRESS, startIso: INSTALL_ISO, link: `${FIELD}/safety-plan` })) }),
  ENTRY({ id: "installer:sms-daily_mitti", section: "installer", step: "install", kind: "text", code: "", name: "Good morning — today's Mitti links (6:30am)", when: "6:30am on a job day", who: "Installer / electrician", approvalNote: "Jo, decision 154", gate: { kind: "text", smsType: "daily_mitti" },
    source: { builder: "src/lib/daily-mitti-text.core.ts", fn: "dailyText", sender: "src/lib/daily-mitti-text.server.ts" },
    render: () => text(dailyText(DAY_JOBS, `${BASE}/field`)) }),
  ENTRY({ id: "installer:sms-daily_mitti_update", section: "installer", step: "install", kind: "text", code: "", name: "Today's jobs changed (text)", when: "A job is added, moved or cancelled after the 6:30am text", who: "Installer / electrician", approvalNote: "Jo, decision 154", gate: { kind: "text", smsType: "daily_mitti_update" },
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
    source: { builder: "src/lib/cancel-notice.core.ts", fn: "renderInstallerCancelledEmail", sender: "src/lib/cancel-notice.server.ts" }, design: "docs/templates/installer/I70-job-cancelled.html",
    render: () => email(renderInstallerCancelledEmail({ jobNumber: "HV-TEST", place: SHORT_ADDRESS, officePhone: "03 9000 0000" })) }),
];

/* ---------------------------------------------------------------- ELECTRICIAN */

const ELECTRICIAN: TemplateEntry[] = [
  ENTRY({ id: "electrician:invite", section: "electrician", step: "enquiry", kind: "email", code: "", name: "An installer invited you", when: "An installer names a new electrician who isn't on the portal yet", who: "Electrician", approvalNote: "Electrician invite wording (job-electrician.core)", gate: { kind: "email" },
    source: { builder: "src/lib/job-electrician.core.ts", fn: "electricianInviteEmail", sender: "src/lib/job-electrician-invite.server.ts" },
    render: () => email(electricianInviteLayout({ electricianName: "Sam Spark", installerName: "Sample Insulation Co", link: `${BASE}/electrician-onboarding?invite=TEST` })) }),
  ENTRY({ id: "electrician:E13", section: "electrician", step: "enquiry", kind: "email", code: "E13", name: "Welcome aboard — set your password", when: "Office approves the electrician's application", who: "Electrician", approvalNote: "Jo 24 Oct 2026, decision 107", gate: { kind: "email" },
    source: { builder: "src/lib/partner-email.core.ts", fn: "partnerWelcomeEmail", sender: "src/lib/partner-activation.functions.ts" }, design: "docs/templates/electrician/E13-welcome-email.html",
    render: () => email(partnerWelcomeEmail({ firstName: "Sam", businessName: "Spark Electrical", trade: "electrician", email: "sam@example.com", link: `${BASE}/reset-password?token_hash=TEST&type=recovery&next=%2Ffield%2Fwelcome`, test: false })) }),
  ENTRY({ id: "electrician:E1", section: "electrician", step: "safety_check", kind: "email", code: "E1", name: "New safety check job (offer email)", when: "A PIESA job is offered to the electrician", who: "Electrician", approvalNote: "Jo 24 Oct 2026, decision 93", gate: { kind: "email" },
    source: { builder: "src/lib/electrician-offer-email.core.ts", fn: "renderElectricianOfferEmail", sender: "src/lib/trade-messages.server.ts" }, design: "docs/templates/electrician/E1-piesa-offer-email.html",
    render: () => email(renderElectricianOfferEmail({ suburb: "Glen Waverley", rate: 220, areaM2: 137, ownerTimesOpen: false, offerUrl: `${BASE}/field/offer/TEST` })!) }),
  ENTRY({ id: "electrician:sms-piesa_offer", section: "electrician", step: "safety_check", kind: "text", code: "", name: "New safety check job (text)", when: "With E1", who: "Electrician", approvalNote: "Jo 24 Oct 2026, decision 93 (text B)", gate: { kind: "text", smsType: "piesa_offer" },
    source: { builder: "src/lib/approved-texts.core.ts", fn: "piesaOfferText", sender: "src/lib/trade-messages.server.ts" },
    render: () => text(piesaOfferText({ suburb: "Glen Waverley", jobNumber: "HV-TEST", pay: 220, link: `${BASE}/field/offer/TEST` })) }),
  // Decision 384 (Jo 25 Oct 2026): approved as drafted in decision 376.
  ENTRY({ id: "electrician:E14", section: "electrician", step: "safety_check", kind: "email", code: "E14", name: "Offer the owner your safety check times", when: "24 hours after the electrician accepted a safety check and offered no times", who: "Electrician", approvalNote: "Jo 25 Oct 2026, decision 384 (drafted in decision 376)", gate: { kind: "email" },
    source: { builder: "src/lib/piesa-times-reminder.core.ts", fn: "renderPiesaTimesReminderEmail", sender: "src/lib/piesa-times-reminder.server.ts" }, design: "docs/templates/electrician/E14-piesa-times-reminder.html",
    render: () => email(renderPiesaTimesReminderEmail({ jobNumber: "HV-TEST", address: SHORT_ADDRESS, link: FIELD, firstName: "Sam" })) }),
  ENTRY({ id: "electrician:sms-piesa_times_reminder", section: "electrician", step: "safety_check", kind: "text", code: "", name: "Offer the owner your safety check times (text)", when: "With E14", who: "Electrician", approvalNote: "Jo 25 Oct 2026, decision 384 (drafted in decision 376)", gate: { kind: "text", smsType: "piesa_times_reminder" },
    source: { builder: "src/lib/piesa-times-reminder.core.ts", fn: "piesaTimesReminderText", sender: "src/lib/piesa-times-reminder.server.ts" },
    render: () => text(piesaTimesReminderText({ jobNumber: "HV-TEST", address: SHORT_ADDRESS, link: FIELD })) }),
  ENTRY({ id: "electrician:piesa-copy", section: "electrician", step: "safety_check", kind: "email", code: "", name: "Your safety check for the property (PIESA copy)", when: "The official PIESA is filed (again after fixes)", who: "Electrician", approvalNote: "Jo 25 Oct 2026, decision 317", gate: { kind: "email" },
    source: { builder: "src/lib/electrician-piesa-copy.core.ts", fn: "renderElectricianPiesaEmail", sender: "src/lib/electrician-piesa-copy.server.ts" },
    render: () => email(renderElectricianPiesaEmail({ address: SHORT_ADDRESS, jobNumber: "HV-TEST", version: "initial" })) }),
  ENTRY({ id: "electrician:sms-fixes_times_link", section: "electrician", step: "fixes", kind: "text", code: "", name: "Pick times for the electrical fixes (text)", when: "The A3 says fixes are needed and no fixes times exist yet", who: "Electrician", approvalNote: "Jo 25 Oct 2026, decision 315", gate: { kind: "text", smsType: "fixes_times_link" },
    source: { builder: "src/lib/fixes-times.core.ts", fn: "fixesTimesLinkText", sender: "src/lib/fixes-times-link.server.ts" },
    render: () => text(fixesTimesLinkText({ address: SHORT_ADDRESS, link: FIELD })) }),
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
  ENTRY({ id: "compliance:swms", section: "compliance", step: "install", kind: "document", code: "", name: "Safety plan (SWMS)", when: "Built from job facts; each crew member signs on the job page before the install", who: "Installer crew (filed on the job)", approvalNote: "Jo 24–25 Oct 2026, decisions 262, 358, 364", gate: { kind: "always" },
    source: { builder: "src/lib/swms.core.ts", fn: "buildSwms", sender: "src/lib/swms-pdf.server.ts" },
    render: () => ({ kind: "files", items: [
      { label: "Signed SWMS sample (PDF)", path: "docs/templates/compliance/swms/swms-sample.pdf", note: `Made by scripts/render-swms-sample.ts. Prepared for ${SWMS_PREPARED_FOR}; ${SWMS_HAZARDS.length} standard hazards; signers tick "${SWMS_SIGN_STATEMENT}".` },
    ] }) }),
  ENTRY({ id: "compliance:esc-consent", section: "compliance", step: "install", kind: "document", code: "", name: "ESC Owner's Consent Form (Template v1)", when: "Signed by the owner on My job (P3), then the AP; copy emailed (O63)", who: "Owner, AP", approvalNote: "Decision 123 (0226)", gate: { kind: "always" },
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
  ENTRY({ id: "invoices:O45", section: "invoices", step: "paid", kind: "invoice", code: "O45", name: "Final invoice (balance due today)", when: "Install day: the tax invoice with the balance due, pay by bank transfer", who: "Owner", approvalNote: "Jo 24–25 Oct 2026, decisions 209, 334", gate: { kind: "email" },
    source: { builder: "src/lib/completion-emails.core.ts", fn: "renderFinalInvoiceEmail", sender: "src/lib/approved-owner-emails.server.ts" }, design: "docs/templates/invoices/O45-final-invoice.html",
    render: () => email(renderFinalInvoiceEmail({ firstName: "Helen", ownerName: "Helen Yang", address: ADDRESS, installer: REINSULATE, invoiceNumber: "HIV-TEST", invoiceDate: "11 November 2026", lines: [{ description: "Bradford Gold R5.0 ceiling batts, 137.6 m² supplied and installed", amount: 2752 }, { description: "Old insulation removed and taken away, 40 m²", amount: 600 }, { description: "Electrical safety check (PIESA)", amount: 349 }, { description: "Accredited Provider fee", amount: 349 }], totalIncGst: 4050, gst: 368.18, rebate: 1850, payments: [{ label: "safety check (24 Oct)", amount: 349 }, { label: "deposit (4 Nov)", amount: 185.1 }], balanceDue: 1665.9, bank: BANK, installed: { description: "Ceiling insulation — Bradford Gold Ceiling Batt R5.0 — 137.6 m²", escModelCodes: ["467911"] } })) }),
  ENTRY({ id: "invoices:xero", section: "invoices", step: "quote", kind: "invoice", code: "", name: "Xero invoice (one per job)", when: "Created at quote acceptance: every accepted quote line once, plus the VEEC incentive as a negative line", who: "Owner (via Xero)", approvalNote: "Decision 209 (Activity Guide v1.2 Table 4)", gate: { kind: "always" },
    source: { builder: "src/lib/xero.core.ts", fn: "buildInvoicePayload", sender: "src/lib/xero.server.ts" },
    render: () => {
      const p = buildInvoicePayload({ contactId: "TEST", jobNumber: "HV-TEST", dueDate: "2026-11-11", total: 2200, veecIncentive: 1850, tracking: { categoryName: "Business Unit", optionName: "Home Insulation Victoria" }, installationAddress: ADDRESS,
        items: [{ description: "Ceiling insulation — Bradford Gold Ceiling Batt R5.0 — 137.6 m² supplied and installed", quantity: 137.6, unit_price_inc_gst: 20, line_total_inc_gst: 2752 }, { description: "Old insulation removed and taken away", quantity: 40, unit_price_inc_gst: 15, line_total_inc_gst: 600 }, { description: "Electrical safety check (PIESA)", quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349 }, { description: "Accredited Provider fee", quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349 }] });
      const inv = p.Invoices[0]!;
      const aud = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return { kind: "table", title: `Reference ${inv.Reference} · amounts include GST · due ${inv.DueDate}`, columns: ["Description", "Qty", "Unit (inc GST)", "Amount"], rows: inv.LineItems.map((l) => [l.Description, String(l.Quantity), aud(l.UnitAmount), aud(l.Quantity * l.UnitAmount)]), note: "Business name, address and ABN come from the Xero invoice template. The owner's online invoice link is office-only." };
    } }),
];

/* ---------------------------------------------------------------- WAITING FOR JO */

const WAITING: TemplateEntry[] = [
  ENTRY({ id: "waiting:trade-invite", section: "waiting", step: "enquiry", kind: "email", code: "", name: "Trade sign-in invite", when: "Would go when the office gives an approved trade worker their own sign-in", who: "Installer / electrician worker", approval: "waiting", approvalNote: "TRADE_INVITE_EMAIL_APPROVED = false (trade-access.core.ts)", gate: { kind: "code_off", flag: "TRADE_INVITE_EMAIL_APPROVED" },
    source: { builder: "src/lib/trade-access.core.ts", fn: "renderTradeInviteEmail", sender: "src/lib/trade-access.functions.ts" },
    render: () => email(renderTradeInviteEmail({ firstName: "Sam", business: "Sample Insulation Co", setPasswordUrl: `${BASE}/reset-password?token_hash=TEST`, signInUrl: `${BASE}/auth` })) }),
  // Decision 386: one automatic reply per standard owner question (sent only once Jo approves the wording).
  ...ANSWER_TYPES.map((answer) => ENTRY({ id: `waiting:${ANSWER_CODES[answer].code}`, section: "waiting", step: "any", kind: "email", code: ANSWER_CODES[answer].code, name: `Automatic reply: ${ANSWER_CODES[answer].name}`,
    when: "A matched owner emails info@ with this standard question: ONE reply sent automatically (anything unusual stays a draft + Needs me row)", who: "Owner", approval: "waiting", approvalNote: "OWNER_EMAIL_AUTO_REPLY_APPROVED = false (decision 386)", gate: { kind: "code_off", flag: "OWNER_EMAIL_AUTO_REPLY_APPROVED" },
    source: { builder: "src/lib/owner-email-auto-reply.core.ts", fn: "renderOwnerAutoReplyEmail", sender: "src/lib/owner-email-auto-reply.server.ts" }, design: `docs/templates/drafts/${ANSWER_CODES[answer].file}`,
    render: () => email(renderOwnerAutoReplyEmail({ answer, facts: ANSWER_SAMPLES[answer].facts, theirSubject: ANSWER_SAMPLES[answer].theirSubject })) })),
];

/* ---------------------------------------------------------------- daily text sample */

const DAY_JOBS = [
  { jobId: "TEST-1", bookingId: "B1", start: "2026-11-10T21:00:00Z", end: null, street: "824 High Street Road", suburb: "Glen Waverley", link: `${BASE}/field/TEST-1`, status: "confirmed", kind: "installation" },
  { jobId: "TEST-2", bookingId: "B2", start: "2026-11-11T03:00:00Z", end: null, street: "12 Sample Street", suburb: "Mount Waverley", link: `${BASE}/field/TEST-2`, status: "confirmed", kind: "ready_check" },
];

/* ---------------------------------------------------------------- register */

export const TEMPLATE_ENTRIES: TemplateEntry[] = [...OWNER, ...INSTALLER, ...ELECTRICIAN, ...OFFICE, ...MITTI, ...COMPLIANCE, ...INVOICES, ...WAITING];

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

export function parseTemplateSearch(s: Record<string, unknown>): { cat: TemplateSection; t?: string } {
  const cat = TEMPLATE_SECTIONS.some((c) => c.key === s["cat"]) ? (s["cat"] as TemplateSection) : "owner";
  const t = typeof s["t"] === "string" && s["t"].length < 80 ? s["t"] : undefined;
  return { cat, ...(t ? { t } : {}) };
}

/** Text types with a named Settings switch (office-settings.core SWITCHES); every other type is `sms:<type>`. */
const NAMED_SMS_SWITCHES = new Set(["spot_saved", "install_no_access", "veec_sign_reminder"]);
/** Live switch states from Settings (getOfficeSwitches): key → on. */
export type SwitchStates = Record<string, boolean | null>;
export type StatusTone = "green" | "amber" | "rose" | "neutral";
/** Plain status for the page: live / waits for the customer messages switch / waits for its text switch / off. */
export function templateStatus(e: TemplateEntry, sw: SwitchStates | null): { label: string; tone: StatusTone } {
  if (e.approval === "waiting") return { label: "Off — waiting for Jo's approval", tone: "rose" };
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
  renderConsentBody: "Shown inside the ESC Owner's Consent document entry",
  renderJoEstimateEmail: "Internal step of renderJoOutcomeEmail",
  renderJoIneligibleEmail: "Internal step of renderJoOutcomeEmail",
  renderJobEmailPreview: "Office job-page preview of renderJoOutcomeEmail (same output)",
  renderOfficialDocx: "Server-side Word filler behind the official PIESA/PIISA entries",
  renderOfficialDocument: "Behind the official PIESA/PIISA entries",
  renderHeaderArt: "Image art for email headers, not a template",
  renderHeadingArt: "Image art for email headers, not a template",
  renderAmountArt: "Image art for email headers, not a template",
  renderEmailHeroPng: "Image art for email headers, not a template",
  renderErrorPage: "Browser error page, not a template",
  renderReloadPage: "Browser error page, not a template",
  testLoginEmail: "TEST partner login address helper",
  automaticLeadEmail: "Routing rule (which Jo template), not wording",
  partnerLoginEmail: "Retired: no live sender (the login link goes out as I54 / E13)",
  renderEstimateEmail: "Retired step-3 estimate email (P1-S77): no live sender",
  renderIneligibleOutcomeEmail: "Retired ineligible email (P1-S77): no live sender",
};

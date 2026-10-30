// Every message Jo approved on 24 Oct 2026 (docs/JO_DECISIONS_LOG.md) must have its code "approved" switch ON, or it
// would still be held once customer comms are switched on (decision 159). A flag going back to false fails loudly here.
// Approval ≠ delivery: every one of these still goes through sendGuardedOwnerEmail / sendOfficeEmail / sendRealSms behind
// customer_comms_enabled and the per-type switches (see the sender tests). Pure: nothing is sent.
import { describe, expect, test } from "bun:test";
import { ACCEPTANCE_EMAIL_APPROVED } from "../src/lib/acceptance-email.core";
import { APPLICATION_RECEIVED_EMAIL_APPROVED, APPLICATION_REVIEW_WORDING_APPROVED } from "../src/lib/application-review.core";
import { COMPLETION_EMAILS_APPROVED, INSTALL_COMPLETE_EMAIL_APPROVED } from "../src/lib/completion-emails.core";
import { COLLECTION_NOTICE_EMAIL_APPROVED, COLLECTION_NOTICE_SEND_APPROVED } from "../src/lib/esc-collection-notice.core";
import { INSTALL_BOOKED_EMAIL_APPROVED } from "../src/lib/install-booked-email.core";
import { INSTALL_DAYS_EMAIL_APPROVED } from "../src/lib/install-days-email.core";
import { INSTALLER_ACCEPTED_EMAIL_APPROVED, INSTALLER_DECLINED_EMAIL_APPROVED } from "../src/lib/installer-accepted-email.core";
import { READY_CHECK_BOOKED_EMAIL_APPROVED, READY_CHECK_BOOKED_TEXT_APPROVED } from "../src/lib/ready-check-booked-email.core";
import { READY_CHECK_TIMES_EMAIL_APPROVED } from "../src/lib/ready-check-times-email.core";
import { READY_CHECK_OFFER_EMAIL_APPROVED } from "../src/lib/ready-check-offer-email.core";
import { ELECTRICIAN_OFFER_EMAIL_APPROVED } from "../src/lib/electrician-offer-email.core";
import { OWNER_QUOTE_EMAIL_APPROVED, QUOTE_REMINDER_EMAIL_APPROVED, ownerQuoteSms } from "../src/lib/owner-quote-email.core";
import { FIXES_QUOTE_EMAIL_APPROVED } from "../src/lib/rectification-quote-email.core";
import { SAFETY_CHECK_EMAILS_APPROVED } from "../src/lib/safety-check-emails.core";
import { PIESA_COPY_EMAIL_APPROVED } from "../src/lib/piesa-delivery.core";
import { VEEC_SIGN_SMS_APPROVED } from "../src/lib/veec-assignment-form.core";
import { VEEC_COPY_EMAIL_APPROVED, VEEC_SIGN_EMAIL_APPROVED } from "../src/lib/veec-emails.core";
import { THIRTY_DAY_REMINDER_APPROVED } from "../src/lib/thirty-day-rule.core";
import { INSTALL_CLEARANCE_EMAIL_APPROVED } from "../src/lib/install-clearance.core";
import { CANCEL_NOTICE_EMAILS_APPROVED } from "../src/lib/cancel-notice.core";
import { NEW_SENDER_REPLY_APPROVED } from "../src/lib/new-sender-reply.core";
import { INSULATION_DETAILS_REAL_SEND_APPROVED, SAVE_SPOT_REAL_SEND_APPROVED } from "../src/lib/hot-leads.core";
import { LAUNCH_COPY_APPROVED } from "../src/lib/launch-campaign.core";
import { INSULATION_QUESTIONS_SEND_APPROVED } from "../src/lib/insulation-questions-campaign.core";
import { SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import { ADDRESS_REQUEST_EMAIL_APPROVED } from "../src/lib/address-request.core";
import { VISIT_NEW_TIMES_APPROVED } from "../src/lib/visit-new-times.core";
import { OWNER_PAPERWORK_COPY_APPROVED } from "../src/lib/paperwork-copy-email.core";
import { PIESA_TIMES_REMINDER_APPROVED } from "../src/lib/piesa-times-reminder.core";
import { INSTALLER_PLANNING_NOTICE_APPROVED } from "../src/lib/installer-planning-notice.core";
import { usualElectricianReminderBody } from "../src/lib/usual-electrician.core";

/** flag → decision number(s) in docs/JO_DECISIONS_LOG.md. */
const APPROVED_EMAIL_FLAGS: Record<string, { value: boolean; decisions: string }> = {
  LAUNCH_COPY_APPROVED: { value: LAUNCH_COPY_APPROVED, decisions: "66/67 (O1, O2)" },
  READY_CHECK_OFFER_EMAIL_APPROVED: { value: READY_CHECK_OFFER_EMAIL_APPROVED, decisions: "106/136/154 (our-lead offer email)" },
  ELECTRICIAN_OFFER_EMAIL_APPROVED: { value: ELECTRICIAN_OFFER_EMAIL_APPROVED, decisions: "93/326 (E1 electrician offer email)" },
  READY_CHECK_TIMES_EMAIL_APPROVED: { value: READY_CHECK_TIMES_EMAIL_APPROVED, decisions: "77 (O11)" },
  READY_CHECK_BOOKED_EMAIL_APPROVED: { value: READY_CHECK_BOOKED_EMAIL_APPROVED, decisions: "81 (O12)" },
  READY_CHECK_BOOKED_TEXT_APPROVED: { value: READY_CHECK_BOOKED_TEXT_APPROVED, decisions: "82 (owner booked text B)" },
  OWNER_QUOTE_EMAIL_APPROVED: { value: OWNER_QUOTE_EMAIL_APPROVED, decisions: "86 (O18)" },
  QUOTE_REMINDER_EMAIL_APPROVED: { value: QUOTE_REMINDER_EMAIL_APPROVED, decisions: "89/134 (O19)" },
  ACCEPTANCE_EMAIL_APPROVED: { value: ACCEPTANCE_EMAIL_APPROVED, decisions: "90 (O22)" },
  INSTALLER_ACCEPTED_EMAIL_APPROVED: { value: INSTALLER_ACCEPTED_EMAIL_APPROVED, decisions: "91 (I23)" },
  INSTALLER_DECLINED_EMAIL_APPROVED: { value: INSTALLER_DECLINED_EMAIL_APPROVED, decisions: "92/136 (I24)" },
  SAFETY_CHECK_EMAILS_APPROVED: { value: SAFETY_CHECK_EMAILS_APPROVED, decisions: "94 (O26 + booked)" },
  FIXES_QUOTE_EMAIL_APPROVED: { value: FIXES_QUOTE_EMAIL_APPROVED, decisions: "95 (O29)" },
  INSTALL_DAYS_EMAIL_APPROVED: { value: INSTALL_DAYS_EMAIL_APPROVED, decisions: "96/135 (O33, O42)" },
  INSTALL_BOOKED_EMAIL_APPROVED: { value: INSTALL_BOOKED_EMAIL_APPROVED, decisions: "98/151 (O35, O35b)" },
  INSTALL_COMPLETE_EMAIL_APPROVED: { value: INSTALL_COMPLETE_EMAIL_APPROVED, decisions: "101/169 (O44)" },
  COMPLETION_EMAILS_APPROVED: { value: COMPLETION_EMAILS_APPROVED, decisions: "133/103/105 (O45, O47, O51)" },
  PIESA_COPY_EMAIL_APPROVED: { value: PIESA_COPY_EMAIL_APPROVED, decisions: "131 (O28)" },
  APPLICATION_REVIEW_WORDING_APPROVED: { value: APPLICATION_REVIEW_WORDING_APPROVED, decisions: "8 Oct 2026 (send back / decline)" },
  APPLICATION_RECEIVED_EMAIL_APPROVED: { value: APPLICATION_RECEIVED_EMAIL_APPROVED, decisions: "136 (I53)" },
  COLLECTION_NOTICE_SEND_APPROVED: { value: COLLECTION_NOTICE_SEND_APPROVED, decisions: "146/147/154 (I60)" },
  COLLECTION_NOTICE_EMAIL_APPROVED: { value: COLLECTION_NOTICE_EMAIL_APPROVED, decisions: "170 (notice copy)" },
  VEEC_SIGN_EMAIL_APPROVED: { value: VEEC_SIGN_EMAIL_APPROVED, decisions: "169 (O61)" },
  VEEC_COPY_EMAIL_APPROVED: { value: VEEC_COPY_EMAIL_APPROVED, decisions: "169 (O62)" },
  VEEC_SIGN_SMS_APPROVED: { value: VEEC_SIGN_SMS_APPROVED, decisions: "166/168" },
  THIRTY_DAY_REMINDER_APPROVED: { value: THIRTY_DAY_REMINDER_APPROVED, decisions: "167/168" },
  INSTALL_CLEARANCE_EMAIL_APPROVED: { value: INSTALL_CLEARANCE_EMAIL_APPROVED, decisions: "186 (I65)" },
  CANCEL_NOTICE_EMAILS_APPROVED: { value: CANCEL_NOTICE_EMAILS_APPROVED, decisions: "291 (O69, I70 — Jo 25 Oct 2026)" },
  NEW_SENDER_REPLY_APPROVED: { value: NEW_SENDER_REPLY_APPROVED, decisions: "292 (O70 new-sender calculator reply — Jo 25 Oct 2026)" },
  VISIT_NEW_TIMES_APPROVED: { value: VISIT_NEW_TIMES_APPROVED, decisions: "384 (O74/O74b drafted in 376 — Jo 25 Oct 2026)" },
  OWNER_PAPERWORK_COPY_APPROVED: { value: OWNER_PAPERWORK_COPY_APPROVED, decisions: "384 (O75 drafted in 376 — Jo 25 Oct 2026)" },
  PIESA_TIMES_REMINDER_APPROVED: { value: PIESA_TIMES_REMINDER_APPROVED, decisions: "384 (E14 drafted in 376 — Jo 25 Oct 2026)" },
  INSTALLER_PLANNING_NOTICE_APPROVED: { value: INSTALLER_PLANNING_NOTICE_APPROVED, decisions: "384 (I71 drafted in 376 — Jo 25 Oct 2026)" },
};

/** SMS type → decision. */
const APPROVED_SMS_TYPES: Record<string, string> = {
  owner_code: "sign-in code (7 Oct)", quote_ready: "87 (B)",
  veec_sign_request: "166", veec_sign_reminder: "168", usual_electrician_missing: "83 (kept by 113)",
  ready_check_incomplete: "83 (missing answers)", job_offer: "76/154", daily_mitti: "83 (morning text)", daily_mitti_update: "83",
  esc_notice_link: "146/154", install_window_reminder: "99/167", install_window_reminder_installer: "99/167",
  install_clearance: "186",
  ready_check_days_suggested: "79 (A)", ready_check_booked_installer: "82 (installer booked, A)", install_tomorrow: "99 (installer day before)",
  team_member_invite: "251 (draft) / 252 (approved as written)",
  boss_price_link: "288 (boss price link; wording in boss-price-link.core.ts)",
  fixes_times_link: "315 (electrician fixes times link; wording in fixes-times.core.ts)",
  electrician_install_attendance: "327 (electrician at the start of the install; wording in install-attendance.core.ts)",
  electrician_cant_attend_installer: "327 (installer told the electrician can't make the day; wording in install-attendance.core.ts)",
  install_day_form_result: "328 (install day form result to the lead installer; wording in install-day-confirm.core.ts)",
  install_day_form_reminder: "328 (5pm install day form reminder; wording in install-day-confirm.core.ts)",
  ready_check_times_owner: "78 (A), wired by 326", ready_check_booked_owner: "82 (owner booked, B), wired by 326",
  visit_tomorrow_owner: "82/93/99 (owner day before), wired by 326", safety_check_booked_owner: "93 (owner booked, A), wired by 326",
  quote_reminder: "88/89, wired by 326", install_moved: "135, wired by 326", piesa_offer: "93 (electrician, B), wired by 326",
  swms_sign_link: "380 (crew safety plan link, drafted in 377)",
  visit_new_times: "384 (O74 text, drafted in 376)", piesa_times_reminder: "384 (E14 text, drafted in 376)", installer_planning_notice: "384 (I71 text, drafted in 376)",
};

describe("decision 388 (Jo 25 Oct 2026): pre-release Save my spot wording reworded spot-only and HELD until Jo approves", () => {
  test("O1/O2 send flag and the two texts approved by Jo 25 Oct; the questions invitation approved for the backlog (decision 393)", () => {
    expect({ SAVE_SPOT_REAL_SEND_APPROVED, INSULATION_DETAILS_REAL_SEND_APPROVED, INSULATION_QUESTIONS_SEND_APPROVED }).toEqual({ SAVE_SPOT_REAL_SEND_APPROVED: true, INSULATION_DETAILS_REAL_SEND_APPROVED: true, INSULATION_QUESTIONS_SEND_APPROVED: true }); // decision 393: Jo approved the 3-questions email for the backlog 25 Oct 2026
    expect([SMS_MESSAGE_TYPES.spot_saved.wordingApproved, SMS_MESSAGE_TYPES.save_spot_reminder.wordingApproved]).toEqual([true, true]);
  });
});

describe("approved message switches are on (Jo 24 Oct 2026)", () => {
  for (const [flag, { value, decisions }] of Object.entries(APPROVED_EMAIL_FLAGS)) {
    test(`${flag} (decision ${decisions})`, () => expect(value).toBe(true));
  }
  for (const [type, decision] of Object.entries(APPROVED_SMS_TYPES)) {
    test(`SMS type ${type} wording approved (decision ${decision})`, () => {
      expect(SMS_MESSAGE_TYPES[type as keyof typeof SMS_MESSAGE_TYPES].wordingApproved).toBe(true);
    });
  }
  test("every SMS type is approved (decision 388 texts approved 25 Oct): the decision 376 held moments were approved by decision 384, the decision 377 crew link by 380 (the Ready Check booking text was removed by decision 171) (the decision-296 PIESA-confirm text approved by decision 311)", () => {
    const off = Object.entries(SMS_MESSAGE_TYPES).filter(([, t]) => !t.wordingApproved).map(([k]) => k);
    // Decision 388 (25 Oct 2026): Jo approved the spot-only spot saved and save-spot reminder texts.
    // Decision 389 (25 Oct 2026): the "It's your turn" text is approved (Jo saw the O77 picture).
    // Jo approved the address request texts and email on 28 Oct 2026 (full address required).
    // A48 batch 2 Task 8 (30 Oct 2026): the installer's "an owner cancelled" run text is new DRAFT wording awaiting Jo.
    expect(off).toEqual(["run_slot_cancelled"]);
    expect(ADDRESS_REQUEST_EMAIL_APPROVED).toBe(true);
    expect("ready_check_booking" in SMS_MESSAGE_TYPES).toBe(false);
  });
  test("approved SMS bodies match the decisions log word for word (brand prefix added by the sender)", () => {
    expect(ownerQuoteSms("Helen", "https://x/j")).toBe("Your ceiling insulation quote is ready, Helen. See it here: https://x/j Reply STOP to opt out."); // decision 87, B
    expect(usualElectricianReminderBody("HV-3117", "https://x/b")).toBe("To send the quote for HV-3117, we need your usual electrician: name, licence number and price (inc GST). Add them once in My business: https://x/b"); // decision 83
  });
});

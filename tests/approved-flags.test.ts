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
import { OWNER_QUOTE_EMAIL_APPROVED, QUOTE_REMINDER_EMAIL_APPROVED, ownerQuoteSms } from "../src/lib/owner-quote-email.core";
import { PIESA_COPY_EMAIL_APPROVED } from "../src/lib/piesa-delivery.core";
import { VEEC_SIGN_SMS_APPROVED } from "../src/lib/veec-assignment-form.core";
import { VEEC_COPY_EMAIL_APPROVED } from "../src/lib/veec-emails.core";
import { THIRTY_DAY_REMINDER_APPROVED } from "../src/lib/thirty-day-rule.core";
import { CANCEL_NOTICE_EMAILS_APPROVED } from "../src/lib/cancel-notice.core";
import { NEW_SENDER_REPLY_APPROVED } from "../src/lib/new-sender-reply.core";
import { INSULATION_DETAILS_REAL_SEND_APPROVED, SAVE_SPOT_REAL_SEND_APPROVED } from "../src/lib/hot-leads.core";
import { LAUNCH_COPY_APPROVED } from "../src/lib/launch-campaign.core";
import { INSULATION_QUESTIONS_SEND_APPROVED } from "../src/lib/insulation-questions-campaign.core";
import { SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import { ADDRESS_REQUEST_EMAIL_APPROVED } from "../src/lib/address-request.core";
import { VISIT_NEW_TIMES_APPROVED } from "../src/lib/visit-new-times.core";

/** flag → decision number(s) in docs/JO_DECISIONS_LOG.md. */
const APPROVED_EMAIL_FLAGS: Record<string, { value: boolean; decisions: string }> = {
  LAUNCH_COPY_APPROVED: { value: LAUNCH_COPY_APPROVED, decisions: "66/67 (O1, O2)" },
  OWNER_QUOTE_EMAIL_APPROVED: { value: OWNER_QUOTE_EMAIL_APPROVED, decisions: "86 (O18)" },
  QUOTE_REMINDER_EMAIL_APPROVED: { value: QUOTE_REMINDER_EMAIL_APPROVED, decisions: "89/134 (O19)" },
  ACCEPTANCE_EMAIL_APPROVED: { value: ACCEPTANCE_EMAIL_APPROVED, decisions: "90 (O22)" },
  INSTALLER_ACCEPTED_EMAIL_APPROVED: { value: INSTALLER_ACCEPTED_EMAIL_APPROVED, decisions: "91 (I23)" },
  INSTALLER_DECLINED_EMAIL_APPROVED: { value: INSTALLER_DECLINED_EMAIL_APPROVED, decisions: "92/136 (I24)" },
  INSTALL_DAYS_EMAIL_APPROVED: { value: INSTALL_DAYS_EMAIL_APPROVED, decisions: "135 (O42)" },
  INSTALL_BOOKED_EMAIL_APPROVED: { value: INSTALL_BOOKED_EMAIL_APPROVED, decisions: "98/151 (O35)" },
  INSTALL_COMPLETE_EMAIL_APPROVED: { value: INSTALL_COMPLETE_EMAIL_APPROVED, decisions: "101/169 (O44)" },
  COMPLETION_EMAILS_APPROVED: { value: COMPLETION_EMAILS_APPROVED, decisions: "103/105 (O47, O51)" },
  PIESA_COPY_EMAIL_APPROVED: { value: PIESA_COPY_EMAIL_APPROVED, decisions: "131 (O28)" },
  APPLICATION_REVIEW_WORDING_APPROVED: { value: APPLICATION_REVIEW_WORDING_APPROVED, decisions: "8 Oct 2026 (send back / decline)" },
  APPLICATION_RECEIVED_EMAIL_APPROVED: { value: APPLICATION_RECEIVED_EMAIL_APPROVED, decisions: "136 (I53)" },
  COLLECTION_NOTICE_SEND_APPROVED: { value: COLLECTION_NOTICE_SEND_APPROVED, decisions: "146/147/154 (I60)" },
  COLLECTION_NOTICE_EMAIL_APPROVED: { value: COLLECTION_NOTICE_EMAIL_APPROVED, decisions: "170 (notice copy)" },
  VEEC_COPY_EMAIL_APPROVED: { value: VEEC_COPY_EMAIL_APPROVED, decisions: "169 (O62)" },
  VEEC_SIGN_SMS_APPROVED: { value: VEEC_SIGN_SMS_APPROVED, decisions: "166/168" },
  THIRTY_DAY_REMINDER_APPROVED: { value: THIRTY_DAY_REMINDER_APPROVED, decisions: "167/168" },
  CANCEL_NOTICE_EMAILS_APPROVED: { value: CANCEL_NOTICE_EMAILS_APPROVED, decisions: "291 (O69, I70 — Jo 25 Oct 2026)" },
  NEW_SENDER_REPLY_APPROVED: { value: NEW_SENDER_REPLY_APPROVED, decisions: "292 (O70 new-sender calculator reply — Jo 25 Oct 2026)" },
  VISIT_NEW_TIMES_APPROVED: { value: VISIT_NEW_TIMES_APPROVED, decisions: "384 (O74/O74b drafted in 376 — Jo 25 Oct 2026)" },
};

/** SMS type → decision. */
const APPROVED_SMS_TYPES: Record<string, string> = {
  owner_code: "sign-in code (7 Oct)", quote_ready: "87 (B)",
  veec_sign_request: "166", // veec_sign_reminder retired 2 Nov 2026 (Part 4 Task 14); usual_electrician_missing retired 2 Nov 2026 (Part 7 Task 8)
  ready_check_incomplete: "83 (missing answers)", daily_mitti: "83 (morning text)", daily_mitti_update: "83", // job_offer retired 2 Nov 2026 (Part 7 Task 9)
  esc_notice_link: "146/154", install_window_reminder: "99/167", install_window_reminder_installer: "99/167",
  install_tomorrow: "99 (installer day before) / #47", // ready_check_days_suggested + ready_check_booked_installer retired 2 Nov 2026 (Part 7 Task 9)
  team_member_invite: "251 (draft) / 252 (approved as written)",
  boss_price_link: "288 (boss price link; wording in boss-price-link.core.ts)",
  electrician_install_attendance: "327 (electrician at the start of the install; wording in install-attendance.core.ts)",
  electrician_cant_attend_installer: "327 (installer told the electrician can't make the day; wording in install-attendance.core.ts)",
  install_day_form_result: "328 (install day form result to the lead installer; wording in install-day-confirm.core.ts)",
  install_day_form_reminder: "328 (5pm install day form reminder; wording in install-day-confirm.core.ts)",
  visit_tomorrow_owner: "82/93/99 (owner day before), wired by 326",
  quote_reminder: "88/89, wired by 326", install_moved: "135, wired by 326",
  swms_sign_link: "380 (crew safety plan link, drafted in 377)",
  visit_new_times: "384 (O74 text, drafted in 376)",
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
    // Part 3 Task 16 + Part 4 Task 14 (Jo 2 Nov 2026): these are retired on purpose (label "Retired 2 Nov 2026 —"); nothing else is unapproved.
    // Part 3 Task 19 (Jo 2 Nov 2026, answer 24): the installer's own customer rental questions text is a DRAFT until Jo approves it.
    // Part 4 Tasks 15/16 (Jo 2 Nov 2026, answers 7/22): the access-person texts and the tenant notice are DRAFTS until Jo approves them.
    // Part 4 Task 10 (Jo 2 Nov 2026, touchpoint 53): the after-install reminder text is a DRAFT behind AFTER_INSTALL_REMINDERS_APPROVED.
    // Part 6 Task 2 / Task 7: the electrician job-link text and the upgrades-form nudge are DRAFTS until Jo approves them.
    // Part 7 Task 8/9 (Jo 2 Nov 2026): the usual-electrician text, the job offer and the Ready Check run / 79/82 installer texts are retired (label "Retired 2 Nov 2026 —").
    const DRAFTS = ["own_customer_rental_taps", "access_person_booked", "access_person_tomorrow", "tenant_notice", "after_install_reminder", "electrician_job_link", "upgrades_nudge"];
    expect(off.sort()).toEqual([
      "access_person_booked", "access_person_tomorrow", "after_install_reminder", "electrician_job_link", "fixes_times_link", "install_clearance", "installer_planning_notice", "job_offer",
      "own_customer_rental_taps", "piesa_offer", "piesa_owner_confirm", "piesa_owner_fixes_confirm", "piesa_times_reminder", "ready_check_booked_installer", "ready_check_booked_owner",
      "ready_check_days_suggested", "ready_check_times_owner", "run_offered", "run_slot_cancelled", "run_time", "run_time_reminder", "safety_check_booked_owner", "tenant_notice",
      "upgrades_nudge", "usual_electrician_missing", "veec_sign_reminder",
    ]);
    for (const k of off) expect({ k, retired: SMS_MESSAGE_TYPES[k as keyof typeof SMS_MESSAGE_TYPES].label.startsWith("Retired 2 Nov 2026 —") || DRAFTS.includes(k) }).toEqual({ k, retired: true });
    expect(ADDRESS_REQUEST_EMAIL_APPROVED).toBe(true);
    expect("ready_check_booking" in SMS_MESSAGE_TYPES).toBe(false);
  });
  test("approved SMS bodies match the decisions log word for word (brand prefix added by the sender)", () => {
    expect(ownerQuoteSms("Helen", "https://x/j")).toBe("Your ceiling insulation quote is ready, Helen. See it here: https://x/j Reply STOP to opt out."); // decision 87, B
  });
});

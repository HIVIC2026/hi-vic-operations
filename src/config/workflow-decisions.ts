// Machine-readable source of truth for Home Insulation Victoria workflow decisions.
// Human-readable version: docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md. Both override older prompts, comments,
// audit notes and stale labels. This file is for tests, scans and display only — business rules are
// still enforced server-side and in the database.

export const WORKFLOW_DECISIONS = {
  version: "2026-10-03",
  xeroReference: "Home Insulation Victoria <job>",
  brand: { name: "Home Insulation Victoria", retiredVisibleNames: ["HI VIC!", "HI VIC", "HIVIC"] },
  eligibility: {
    preliminaryLabels: [
      "Likely Eligible",
      "Needs Onsite Confirmation",
      "Does Not Appear Eligible",
      "Needs office review", // internal (office) only
    ],
    verifiedValues: ["pending", "eligible", "not_eligible", "needs_review"],
    rules: {
      ownerAnswersAreDeclaredUntilVerified: true,
      existingInsulationYesIsNeverAutoFail: true,
      r2ExactlyIsNotLessThanR2: true,
      missingOrConflictingEvidence: "needs_review",
    },
  },
  retiredWorkflow: [
    "PIESA before confirmed quote/payment",
    "Combined Ready Check + PIESA visit",
    "Installation booking before PIESA/Section C clearance",
    "Mitti directly moves job state without portal validation",
  ],
  payment: {
    retired: ["10%/5% minimum deposit", "3-instalment plan", "50% deposit gate", "AmountPaid >= 50% as the PIESA unlock rule", "total / 2", "deposit_pct: 0.5"],
    gateFlag: "payment_option_gate_enabled", // default OFF: PIESA + scheduling blocked "payment rule pending activation"; never falls back to 50%
    minimumNotExact: true, // paying more than 10%/5% counts; one cent short does not
    instalmentActiveRequires: ["office_approved_current_quote_plan", "owner_accepted_terms", "first_instalment_verified_in_xero", "payment_method_or_collection_recorded", "not_cancelled_failed_overdue_or_superseded"],
    piesaRequires: [
      "ready_check_complete",
      "verified_eligible",
      "current_confirmed_quote_approved",
      "approved_payment_option_verified",
    ],
    options: ["safety_check_paid", "paid_in_full"] as const,
    safetyCheck: { settingColumn: "safety_check_payment_inc_gst", defaultIncGst: 349, decided: "2026-10-07", balance: [] as string[], balanceNote: "Decision 365 (Jo 25 Oct 2026): no balance option — one payment statement of the paymentPlan() steps (safety check, fixes if approved, 10% to book, balance on install day)" },
    // Jo 26 Oct: flat 10% install deposit on the install price only (not the PIESA fee or fixes). 5% tier removed.
    deposit: { installPct: 10, base: "install_price_excluding_piesa_and_fixes" },
    noApprovedRule: "block_piesa_payment_rule_exception",
  },
  routes: {
    hiv_lead: {
      paymentRule: "hiv_confirmed_quote_rule",
      leadFee: "none",
      ownerPrice: "fixed_owner_prices_markup_is_owner_price_minus_installer_agreed_rate_inc_gst",
    },
    installer_supplied: {
      mittiReadyCheck: { hivFeeIncGst: 349, hivElectricianIncGst: 349, choices: ["Home Insulation Victoria electrician", "My usual electrician", "A different electrician"], priceBasis: "full_installer_plus_hiv_fee_plus_electrician_minus_veu", missingUsual: "hold_quote" },
      paymentRule: "not_assumed",
      leadFee: "none",
      marginOnInstallerPrice: "none",
      hivReceives: ["approved_ap_fee", "veec_spread"],
    },
  },
  directContact: {
    visits: ["ready_check", "piesa", "rectification", "installation"],
    reminderAfterHours: 24,
    officeAlertAfterHours: 48,
    bookedOnlyWhen: "time_recorded_and_confirmed_by_other_party_or_office",
    ownerNotice:
      "To arrange this visit, Home Insulation Victoria will share your name, phone number and email with the assigned trade for this job only.",
    tradeNotice:
      "Use these contact details only to arrange and complete this Home Insulation Victoria job. Do not use them for unrelated marketing or future work unless the owner separately agrees.",
  },
  piesaTiming: {
    windowDays: 30,
    clockStartsNoRectification: "initial_piesa_completed_and_signed",
    // Decision 316 (Jo 25 Oct 2026): the 30 days always run from the official PIESA, never the fixes (Section C).
    clockStartsWithRectification: "official_piesa_not_fixes",
    mustBe: "installation_commenced_within_window",
    status: "operational_rule_pending_written_confirmation",
  },
  partnerPeople: {
    // Decision 402 (Jo 26 Oct 2026): approving/activating a business approves its pending people whose certification is office-verified.
    autoApproveWithBusiness: {
      decision: 402,
      installer: "certification_status_verified_and_crew_cleared",
      electrician: "never_automatic_no_office_verified_person_certification",
      neverTouched: ["rejected", "removed", "already_approved"],
      eventSummary: "Worker approved automatically with the business (decision 402)",
    },
  },
  hardStops: [
    "missing_eligibility_evidence",
    "conflicting_eligibility_evidence",
    "existing_insulation_unknown_status",
    "no_trade_assigned",
    "payment_rule_missing",
    "payment_mismatch",
    "failed_message",
    "no_time_after_24h",
    "no_confirmed_booking_after_48h",
    "mitti_draft",
    "mitti_wrong_job",
    "mitti_wrong_form_version",
    "mitti_duplicate_or_amended",
    "piesa_rectification_required",
    "section_c_not_passed",
    "installation_timing_at_risk",
    "office_permission_failure",
    "illegal_transition",
  ],
} as const;

export type HardStopCode = (typeof WORKFLOW_DECISIONS.hardStops)[number];

/** Install deposit % (Jo 26 Oct): flat 10% at any price. */
export function depositPctFor(_totalIncGst: number): number {
  return WORKFLOW_DECISIONS.payment.deposit.installPct;
}

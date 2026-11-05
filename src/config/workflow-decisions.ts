// Machine-readable source of truth for Home Insulation Victoria workflow decisions.
// Human-readable version: docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md. Both override older prompts, comments,
// audit notes and stale labels. This file is for tests, scans and display only — business rules are
// still enforced server-side and in the database.

export const WORKFLOW_DECISIONS = {
  version: "2026-10-03",
  safetyCheckPricingCorrection: {
    decided: "2026-11-03T10:30:00+11:00",
    installerSource: "installer_active_price_list_no_markup_whole_fee_to_installer",
    websiteOwnerIncGst: 349, websiteElectricianPayoutIncGst: 275,
    preserveRecordedQuotesAndOffers: true,
  },
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
  // Part 7 Task 8 (Jo 2 Nov 2026): replaced by the 9am two-days-before "Confirm or change your Lead Installer by 5pm today" email
  // (and decisions 374/303 for the electrician); nothing sends these any more, old events/log rows are history.
  // Part 7 Task 9 (Jo 2 Nov 2026): under "installer calls and books" no job is offered to installers and nothing runs in batches
  // with owner-picked times (#35, #40–43, #47, #50); types kept in sms.core as retired history, old events/log rows are history.
  tradeMessages: { retired: [
    "2pm day-before Lead Installer email", "Pick the crew for tomorrow", "We need your usual electrician",
    "Confirm or change your Lead Installer by 5pm today", // Deep Part 5a (Jo 4–5 Nov 2026): replaced by the 3-day "Pick the Lead Installer" reminder + the 2-day red flag
    "You've got a run", "An owner cancelled their Ready Check in your run", "New Ready Check job offer (email + text)", "Installer job offer page",
    "The owner suggested other Ready Check days", "Booked: Ready Check (installer)",
  ] },
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
    // Part 4 Task 10 (Jo 2 Nov 2026): an unpaid balance never holds back a completion document. Warranty + instructions go with
    // the All done email, the signed rebate form copy goes within 10 business days of signing, PIESA/PIISA copies keep their own
    // timing; only the completion pack (the paid-in-full email) and installer pay for the installer's own customer wait for the balance.
    completionDocumentsWaitForBalance: false,
    // Part 4 Task 12 (Jo 2 Nov 2026, touchpoint 53): one reminder (email + text) on days 1, 3 and 7 after install day for whatever is
    // still undone (rebate form, balance); after day 7 no more owner messages, the job shows to the office as "Balance overdue".
    // Replaces the balance day-5 / due emails and the separate rebate-form reminders. The balance is due on install day; overdue clock stays BALANCE_DUE_DAYS.
    // Part 4 Task 13 (Jo 2 Nov 2026, answer 9, cl 27): faulty product / work notice. Office button only (Jo decides, same day), no automatic
    // trigger, no installer button; one email per note; compliance purpose, so Do not contact and Unsubscribe never block it.
    nonComplianceNotice: { purpose: "non_compliance_notice", trigger: "office_button", sameDay: true, flag: "NON_COMPLIANCE_NOTICE_APPROVED" },
    afterInstallReminders: { days: [1, 3, 7] as const, officeRowAfterDay: 7, officeRowLabel: "Balance overdue", flag: "AFTER_INSTALL_REMINDERS_APPROVED" },
    // Part 4 Task 14 (Jo 2 Nov 2026): the old after-acceptance messages and screens are gone — electrician PIESA offer (E1 + piesa_offer),
    // E14, O26, I71, fixes_times_link, the HIV fixes quote to owners (O29 + automatic send + office Send), the confirm-fixes
    // email/text/page, O71 + piesa_owner_confirm, the separate P3 consent step, I65/install_clearance + O33 (installer calls to book;
    // deposit paid before booking, no 48-hour hold), O45, the balance day-5/due emails and O61 + veec_sign_reminder. Retired text
    // types stay as "Retired 2 Nov 2026 —" with wordingApproved:false. A job mid-way through an old step keeps its old screen.
    oldAfterAcceptanceFlowRemoved: { on: "2026-11-02", keptForInFlight: ["fixes", "book"] as const, countScript: "scripts/old-flow-inflight-count.ts" },
    safetyCheck: { settingColumn: "safety_check_payment_inc_gst", defaultIncGst: 349, decided: "2026-10-07", balance: [] as string[], balanceNote: "Decision 365 (Jo 25 Oct 2026): no balance option — one payment statement of the paymentPlan() steps (safety check, 10% to book, balance on install day (Jo 2 Nov 2026); overdue after 7 days). Electrical upgrades are paid to the electrician directly (Customer Agreement v1.3 payment terms, version customer-agreement-1.3)" },
    // Jo 26 Oct: flat 10% install deposit on the install price only (not the PIESA fee or fixes). 5% tier removed.
    deposit: { installPct: 10, base: "install_price_excluding_piesa_and_fixes" },
    // Jo 2 Nov 2026 (answer 21): the deposit opens straight after the PIESA result, even with electrical upgrades still to come (piesa-result-route.core `depositOpenAfterPiesa`); replaces "fixes signed off BEFORE the deposit".
    // Part 4 fix wave C1: "after the result" means every stage from piesa_complete on — rectification_scheduling / rectification_booked /
    // electrical_variation_pending (where partner-billed in-house jobs auto-advance to) as well as installation_scheduling / installation_booked
    // (payments.core `INSTALL_DEPOSIT_DUE_STAGES`); the deposit request goes on ANY recorded PIESA result (pass or upgrades) and the sweep covers the same stages.
    opensAfter: "piesa_result",
    noApprovedRule: "block_piesa_payment_rule_exception",
    // Part 4 sign-off (Task 17, Jo 2 Nov 2026): the confirm-and-pay page (PIESA confirmation + ESC consent + deposit) opens straight after
    // the PIESA result, also with upgrades to come; the install is booked only after the deposit; the consent copy goes at signing; at
    // rentals the access person gets the booked + day-before texts and the tenant the cl 23 notice; All done carries warranty + instructions;
    // reminders days 1/3/7 then the office. In flight: same purpose + key per booking / invoice / job, one version of each message
    // (tests/new-flow-inflight-p4.test.ts); a job mid-way through a retired step keeps its old screen.
    part4: { confirmAndPay: { opens: "piesa_result", signsEscConsent: true, consentCopyAt: "signing", installBookedAfterDeposit: true }, rentals: { accessPersonTexts: ["booked", "day_before"] as const, tenantNotice: "install_booked" }, allDoneCarries: ["warranty", "instructions"] as const, inFlight: { rule: "same purpose + key, one version per message", test: "tests/new-flow-inflight-p4.test.ts" } },
  },
  routes: {
    hiv_lead: {
      paymentRule: "hiv_confirmed_quote_rule",
      leadFee: "none",
      ownerPrice: "fixed_owner_prices_markup_is_owner_price_minus_installer_agreed_rate_inc_gst",
    },
    installer_supplied: {
      mittiReadyCheck: { hivFeeIncGst: 349, hivElectricianIncGst: 349, choices: ["Home Insulation Victoria electrician", "My usual electrician", "A different electrician"], priceBasis: "full_installer_plus_hiv_fee_plus_electrician_minus_veu", missingUsual: "hold_quote" },
      // FEES (Jo 2 Nov 2026, CORRECTION; PIESA line re-ruled Jo 4 Nov 2026, final): EVERY job has TWO separate fees — the $349 AP fee
      // (Home Insulation Victoria) AND the PIESA (electrical safety check). Installers' own customers: owner price = installer price +
      // $349 AP fee + the installer's OWN PIESA rate (their onboarded rate-card PIESA line, inc GST — Deep $349, Rapid $275), minus rebate.
      // That same amount is paid through in full to whoever does the PIESA; Home Insulation Victoria keeps nothing on that line. No rate
      // set → the quote can't be sent (hold "Your PIESA price isn't set yet. Ask the office to add it, then send."), never a default $349. Supersedes the 2 Nov
      // "$349 whatever the rate" (OWN_CUSTOMER_PIESA_INC_GST, removed) and main 6f759d0 "$349 pass-through". Home Insulation Victoria
      // leads unchanged: owner $349, electrician their own rate, the gap stays ours (`own-customer-price.core`, `mitti-installer-quote.core`).
      // Quote + invoice lines in this order with these labels.
      ownCustomerFees: {
        decided: "2026-11-04",
        apFeeIncGst: 349,
        piesaIncGst: "installer's own onboarded PIESA rate (rate card PIESA line inc GST; e.g. Deep $349, Rapid $275)",
        piesaLineWhateverElectricianRate: false,
        noRateSet: "quote held — Your PIESA price isn't set yet. Ask the office to add it, then send. (never $349; office-managed rate card, controller 4 Nov 2026)",
        supersedes: ["302", "303", "2026-11-02 FEES $349 PIESA", "main 6f759d0 $349 pass-through"] as const,
        supersededScope: "own_customer_owner_price_only",
        lineLabels: ["Insulation", "Home Insulation Victoria fee", "Electrical safety check (PIESA)", "Rebate", "Your price"] as const,
      },
      // Jo 3 Nov 2026 22:58 (Part 10 Task 3): after an A1 Ready Check is Complete with no price the BUSINESS OWNER gets BOTH the
      // decision-288 text AND the "Enter your price" email (`enter-price-email.core`, sent by `boss-price-link.server`) — the plan's
      // "never both" is overridden. One claim per job covers the pair; the email is its own channel under it (held → recorded once,
      // retried while fresh, the text never resent). Subject + pronoun APPROVED by Jo 4 Nov 2026 14:05 (ENTER_PRICE_EMAIL_APPROVED flips at go-live).
      enterPriceEmail: {
        decided: "2026-11-03",
        channels: ["text", "email"] as const,
        bothNotEither: true,
        oneClaimPerJob: "boss_price_link_sent",
        emailKeySuffix: ":email",
        heldEvent: "enter_price_email_held",
        recipient: "businesses.email",
        maxAgeHours: 24,
        approvedFlag: "ENTER_PRICE_EMAIL_APPROVED",
        draftsForJo: ["subject", "pronoun them (mock says her)"] as const,
        quoteGoesOnlyAfterBossPrice: true,
      },
      // Part 10 Task 4 (Jo 3 Nov 2026): Boss OR Office enter the price (Part 5 seesPrices); "Send quote to owner" only while
      // OWN_CUSTOMER_SEND_ON_PRESS_ENABLED, through the one guarded auto-send (every check; holds come back as plain reasons).
      enterPriceStep: {
        decided: "2026-11-03",
        whoEnters: ["boss", "office"] as const,
        refusedServerSide: ["lead_installer", "crew", "electrician"] as const,
        sendOnPressFlag: "OWN_CUSTOMER_SEND_ON_PRESS_ENABLED",
        releaseOnlyThrough: "maybeAutoSendInstallerQuote",
        buttonWhenOff: "Save",
        buttonWhenOn: "Send quote to owner",
        note: "Your price stays editable until the quote is sent.",
      },
      // Part 10 Task 5: the own customer's quote email = Part 3's v4 email + approved rows by quote_items.code + the installer's
      // logo beside ours (OWN_CUSTOMER_COBRAND_APPROVED, one switch for email/page/invoice) + the VEU program box (Fix 1).
      ownCustomerQuoteEmail: {
        base: "O18 v4 (OWNER_QUOTE_EMAIL_V4_APPROVED)",
        approvedFlag: "OWN_CUSTOMER_COBRAND_APPROVED (one switch: email rows/VEU box, My job page, tax invoice)",
        cobrandFlag: "OWN_CUSTOMER_COBRAND_APPROVED",
        rowsFrom: "ownCustomerRows (quote_items.code)",
        rows: ["Insulation", "extras", "Home Insulation Victoria fee", "Electrical safety check (PIESA)", "Rebate", "Your price"] as const,
        installerLogo: "businessLogoUrl https only, else ours alone",
        veuBox: "owner-wording.core veuBoxMj (Fix 1) at the bottom",
        hivLeadsUnchanged: true,
      },
      // Part 10 Task 6: the My job quote page for an own customer — same switch, same rows, installer logo in the header.
      ownCustomerQuotePage: { cobrandFlag: "OWN_CUSTOMER_COBRAND_APPROVED", view: "ownCustomerQuoteView", header: "OwnerPageHeader partnerLogo", rows: "quote.ownRows (null = generic rows)" },
      // Part 10 Task 7: the tax invoice PDF for an own customer — same switch (plus PDF_LOOK_APPROVED.taxInvoice), approved rows by code, GST on the full price before the rebate.
      // Jo 4 Nov 2026 (final, replaces Part 10 Task 10's "$349 to the owner, rate to the electrician, we keep the gap"): on an
      // installer's own customer the owner pays the installer's own PIESA rate and that same amount is paid through in full to
      // whoever does the PIESA; Home Insulation Victoria keeps nothing on that line. Owner-facing words never show that anyone is
      // paid; installer-facing words never show Home Insulation Victoria's own $349 PIESA price. HIV leads unchanged.
      ownCustomerElectricianPay: {
        decided: "2026-11-04",
        ownerPiesaLine: "the installer business's own PIESA rate (rate card PIESA line inc GST)",
        paidThrough: "the same amount, in full, to whoever does the PIESA (safetyCheckPayeesFor: recorded quote line, else the rate card)",
        differenceKeptBy: "nobody — Home Insulation Victoria keeps nothing on an own-customer PIESA line",
        noRateSet: "held (IN_HOUSE_PIESA_HOLD_REASON / PIESA_PRICE_NOT_SET), never $349",
        payGate: "unchanged (Complete Mitti form + evidence; electricians never wait for the owner — decision 410)",
        hivLeadsUnchanged: "owner $349, electrician their own rate, Home Insulation Victoria keeps the gap",
      },
      ownCustomerTaxInvoice: { cobrandFlag: "OWN_CUSTOMER_COBRAND_APPROVED", pdfFlag: "PDF_LOOK_APPROVED.taxInvoice", rows: ["Insulation · product facts", "extras", "Home Insulation Victoria fee", "Electrical safety check (PIESA)", "Price before rebate", "Rebate", "Your price (incl. GST)"] as const, gst: "one eleventh of the price before the rebate (unchanged)" },
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
    // Part 9 Task 10 (Jo 2 Nov 2026, answer 21): the install can be booked before the upgrades day — a warning only
    // (allocation.core `installationCoordination` → UPGRADES_NOT_DONE_WARNING; the deposit blocker still runs first and
    // every other uncleared reason still refuses); the 30 days still run from the official PIESA date while the upgrades
    // are outstanding. The GO check (prestart.core `prestartFailures`) is where the missing Part C (electrical clearance
    // line) + certificate (main's Part 3 `certificate` fact, Jo 3 Nov 2026 — "not in yet" / "Check electrical certificate — …") stop the install. Installer pay for an install needs the latest GO check for
    // the booked start passed (trade-payout-gate.core NO_GO_FOR_INSTALL). No "deposit by 2pm the day before" rule.
    bookBeforeUpgrades: { booking: "warning_only", goCheckNeeds: ["part_c", "certificate"] as const, installerPayNeeds: "go_passed_for_booked_start" },
  },
  // Part 9 Task 11 (4 Nov 2026): before VEEC creation (robot planVeecCreation + office updateVeec, one rule in
  // veec-creation-gate.core) the product must be on the VEU Register on the creation day and the owner must have paid
  // $200+ incl GST on the installation invoice; a refund after creation raises veec_copayment_refunded (Needs me, call Jo).
  veecCreation: { productOnRegister: "install_day_and_creation_day", minCopaymentCents: 20000, refundAfterCreation: "veec_copayment_refunded_needs_office" },
  // Part 9 Task 12 (4 Nov 2026): complaints — acknowledge within 5 business days, aim to resolve within 20 (Melbourne
  // business days); office events only (complaints.core / complaints.functions), no automatic owner message.
  complaints: { ackBusinessDays: 5, resolveBusinessDays: 20, ownerMessage: "none_office_by_hand" },
  // Decision #30 (Jo 2 Nov 2026): quotes valid 30 days; quotes sent before the change keep 14 (quote-expiry.core).
  // Decisions #29/#33 (Jo 2 Nov 2026): the quote email v4 (owner-quote-email.core, quote-ready-notify.server).
  quoteReadyEmail: {
    approvedFlag: "OWNER_QUOTE_EMAIL_V4_APPROVED (false until Jo OKs the pictures; off = v3 unchanged)",
    sameSendAsBefore: "purpose quote_ready, key quote-ready-email:v1:{quote}",
    whatsChangedBox: "only_changed_rows_hidden_when_none",
    attachments: ["Customer Agreement + payment terms", "Statement of rights"],
    documentsMissing: "held_with_office_note_never_sent_without_them",
    onlyThirtyDayQuotes: true,
  },
  // Decisions #29/#33, Fix 3, lawyer Q8 (Jo 2 Nov 2026): the quote page (owner-pages.core P2, my-job.$token.tsx AcceptQuote).
  quotePage: {
    ticks: 2,
    typedNameRequired: true,
    escDeclarationsOnQuotePage: false,
    buttonLockedUntil: "both_ticks_and_typed_name",
    payLine: "$349 now (PIESA), 10% to book the install day, the rest on install day",
    whatsChangedBox: "only_changed_rows_hidden_when_none",
  },
  // Part 3 Task 12 (Jo 2 Nov 2026): the typed name is the owner's signature; the AP counter-signs at the same moment.
  acceptanceSignature: {
    counterSigner: "Chris Lowe, Director, DC Construction Solutions Pty Ltd (automatic, same moment as the owner)",
    event: "acceptance_countersigned",
    documentsByEmailConsent: "recorded from tick 1",
    noCountersignatureOnFile: "PDF uses the agreement signature's own name and time, never the current time",
  },
  // Part 3 Task 20: a job already in flight gets exactly ONE version (old or new) of each changed message.
  // Proved by tests/new-flow-inflight-p3.test.ts (every stage x every message, flags on and off).
  inFlightMessages: {
    rule: "same purpose and same idempotency key for the old and new version; the approval flag only picks the wording at send time",
    pastTheStep: "the old message was already sent under that key, so the new version is never sent as well",
    flagOffNewMessageWithNoOldWording: "nothing is sent (will call)",
    chase: "a gap list already texted is not emailed; a new gap list gets the email only",
    quotes: "a quote sent before QUOTE_30_DAY_FROM_ISO keeps its 14-day date; reminders are stamped once per quote",
  },
  // Part 7 Task 1 (Jo 2 Nov 2026): the SWMS says "Lead Installer" in full, hazard 9 and the downlight step are the approved
  // wording, people are labelled "(Lead Installer)" / "(Crew)". The hazard text is part of every plan's fingerprint, so the
  // new set sits behind SWMS_NOV2_WORDING_ON (swms.core) until Part 11 flips it on a day with no real install within 48 hours.
  swmsWording: {
    flag: "SWMS_NOV2_WORDING_ON (false until Part 11)",
    ruleWhenOn: "swms-portal-2026-11-02",
    ruleWhenOff: "swms-portal-2026-10-24 (plan text, rule and fingerprint byte-identical to the 24 Oct wording)",
    onSwitchOn: "every plan's fingerprint changes, so everyone signs the safety plan again (the existing crew sign-link reminder asks them)",
    switchOnOnlyWhen: "no real install within the next 48 hours",
    roleLabels: { lead: "Lead Installer", crew: "Crew" },
    onSiteLine: "The Lead Installer is on site for the whole install. (always under Compliance, whatever the rule)",
    pdfLook: "website look (swms-sample.pdf) with the Changes during the job box only behind PDF_LOOK_APPROVED.swms; off = the 25 Oct WorkSafe layout, byte-for-byte",
    signingPage: "/sp/<token>: house facts → 9 standard controls folded → Read the full safety plan (PDF) on tap only → tick → typed full name → Sign the safety plan; one server read; words of the plan's own rule",
    leadView: "the Lead Installer's own link only: who has signed, Sign on my phone (the crew member's own link on the Lead's phone; they type their own name, method lead_phone), Open install form (real A5 audit url or not-ready line)",
    installTomorrowText: {
      decision: "#47 (Jo 2 Nov 2026), replaces decision 99",
      wording: "Home Insulation Victoria: Install tomorrow {time}, {address} ({HV}). Safety plan: {link} Mitti form: {link}",
      to: "the picked Lead Installer's own mobile only — never the business owner's number, never other crew members' links",
      links: "safety plan = the Lead's own sign link (minted for the text); Mitti = the real A5 audit url, never guessed",
      held: ["no lead installer", "lead installer has no mobile", "install form not ready"],
      key: "install-tomorrow:v1:{job}:{booking}:{Melbourne date} (unchanged, one text per install day; a hold never claims it)",
    },
    // Deep Part 5a (Jo 4–5 Nov 2026, "Lead Installer lock / reminders / GO email") — replaces Part 7 Task 6's 9am "Confirm or
    // change your Lead Installer by 5pm today" email (retired 5 Nov 2026; its pure module deleted, the server file
    // keeps only the lock helpers). Applies to EVERY installer business, own customers and Home Insulation Victoria leads alike.
    leadInstallerLock: {
      lock: "the Lead Installer and the install day lock 2 days before the install START (the install's own time of day, Melbourne wall-clock, DST-safe; lead-installer-lock.core leadInstallerLock/leadInstallerLocked, re-exported by prestart.core; lockLabel 'Wed 11 Nov, 7:30am'); LEAD_LOCKED_MESSAGE = Locked — call Home Insulation Victoria to change the Lead Installer or the day; a completed install is never locked; every reader (assertLeadInstallerUnlocked, refuseLockedLeadChange, recordLeadChange, validateBooking install move) reads currentLockableInstallBooking and fails CLOSED on a read error",
      writers: ["saveCrewWithLead (different Lead refused; crew-only allowed)", "changeInHouseLeadInstaller", "inHouseBookVisit (moved start or other Lead on an existing install booking)", "allocateVisit kind install (fix I2)"],
      office: "the Home Insulation Victoria office keeps its own path after the lock: booking.server officeActor may move the install (install_moved_after_lock, ESC notice re-prepared, GO check re-runs); recordLeadChange → Update ESC flag + info@ email + prestart lock",
      crew: "crew stay changeable up to the start (not on the ESC notice); anyone newly added gets their SWMS text as now",
      reminder: "3 days before (same clock, 72h-ish: the install's time of day three calendar days earlier), no Lead Installer picked → ONE email to the partner's business office: subject 'Pick the Lead Installer for {address} on {date}', body 'Hi, {address} is booked for install on {date} but no Lead Installer is picked yet. Pick one on the job page in the portal by {lock date} so we can lodge it with the ESC. Jo' (lead-installer-reminder.core, key lead-reminder:v1:{job}:{Melbourne date}); DRAFT behind LEAD_INSTALLER_REMINDER_APPROVED=false — real offices held once (lead_installer_reminder_held), TEST → test-send; the claim (lead_installer_reminder_email) only after the sender reports sent",
      flag: "2 days before (the lock), still none → ONE no_lead_installer office event (needs_office) per job + install day → red top Needs me row 'No Lead Installer: {HV} install {date}' (office-needs.core rank 1, Open job → install), cleared by one no_lead_installer_cleared when a Lead Installer is picked",
      sweep: "lead-installer-reminder.server sweepLeadInstallerReminder on the 15-minute allocation tick, confirmed installation bookings within 4 days, Lead read through lead-installer-confirm.server leadInstallerLockState (same reader as the writers)",
      goEmail: "the GO / DON'T START email (prestart.server sweepPrestart → go-email.server, 2pm the day before + 6:30am on the day, keys go-email:v1:{job}:{start}:{slot}, DON'T START copied to info@) is the only day-before office email: every pre-start blocker is mapped to plain words in go-email.core GO_EMAIL_PLAIN / tradeSafeFailureLine; Jo's V2 wording ('{HV} {address} – GO for {date}' / '… – DON'T START {date}', crew names, 'Everything's in place: deposit paid, safety check clear, ESC notice lodged, safety plan signed', 'Fix these first', 'Call Home Insulation Victoria on 0477 511 901') is built in behind GO_EMAIL_V2_APPROVED=false; the approved 4 Nov frame sends until she approves it",
      replaces: "the 2pm day-before 'Tomorrow's installs — Lead Installer / Keep or change' office email (retired Part 7 Task 8) and the 9am 'Confirm or change your Lead Installer by 5pm today' email (retired 5 Nov 2026) — nothing retired sends again",
    },
    // Part 7 Task 7 (decision #26, Jo 2 Nov 2026).
    dailyJobsText: {
      to: "EVERY worker on today's install plan (Lead and crew, decision #26 workers only) who has NOT yet signed the safety plan for that install (Jo 3 Nov 23:08, Task 7b + fix I3; current plan fingerprint) — each on their own mobile with their own sign link (swmsUnsignedSigners → partner_workers mobile → workerOnlyTextRecipient + swmsSignLink); no fallback to the business owner's mobile",
      signed: "a worker who has signed gets nothing, nor the later update; a Ready Check (no SWMS) is never on this text",
      noWorker: "a signer with no staff row (typed-in name), a removed worker or one without a mobile is skipped: no text and no log row",
      piesa: "never on this text (electricians get their own link, Part 6)",
      key: "daily:{business}:{Melbourne date}:w:{worker} (unchanged)",
    },
  },
  quoteValidity: {
    validDays: 30,
    beforeChangeValidDays: 14,
    changeStartsAt: "QUOTE_30_DAY_FROM_ISO (null until the release commit sets it)",
    ownerReminders: ["3_days_after_sent", "2_days_before_expiry"],
    onExpiry: "job_closes_and_quote_expired_email_once",
    cancelReasons: ["Quote expired (30 days)", "Quote expired (14 days)"],
    emailWording: "Your quote is valid for 30 days, until {date}",
    reminderTextsKeep: "held until (decision 32, approved as is)",
  },
  // Installer screens (Jo 2 Nov 2026, approved mock-ups; new job flow part 5): one Next step box; no How it works tab.
  installerScreens: {
    by: "Jo 2 Nov 2026",
    jobPage: "one Next step box; no How it works tab",
    removed: ["/field/guide (redirects to /field)", "four-form in-house booking card (Rectification)", "installer guide words GUIDE_STEPS / GUIDE_WORDS", "TeamElectricianPicker"],
    kept: ["ReturnActions (Can't do this one / Owner cancelled) on the Job page", "electrician guide words until Part 6 removes them"],
    roles: ["boss", "office"],
    neverLogIn: ["lead", "crew", "electrician"],
  },
  partnerPeople: {
    // New job flow Part 6 Task 8 (Jo 2 Nov 2026): Electricians never log in; each job is one no-login link (/e/<token>).
    electricianLogin: { decided: "2026-11-02", rule: "Electricians never log in; each job is one no-login link", noLoginLine: "You don't need to sign in. Your jobs come to you by text.", inviteBlocked: "tradeAccessBlocker → NO_LOGIN_NEEDED", grantedRole: "installer only", sqlChanges: "none (existing logins and roles left as they are)" },
    // Decision 402 (Jo 26 Oct 2026): approving/activating a business approves its pending people whose certification is office-verified.
    autoApproveWithBusiness: {
      decision: 402,
      installer: "certification_status_verified_and_crew_cleared",
      electrician: "never_automatic_no_office_verified_person_certification",
      neverTouched: ["rejected", "removed", "already_approved"],
      eventSummary: "Worker approved automatically with the business (decision 402)",
    },
    leadCrew: {
      by: "Jo 27–29 Oct 2026",
      replaces: "Jo 28 Oct 2026 (null = Crew unless Mitti access; Lead → Crew deactivates Mitti)",
      installerRoles: ["lead", "crew"],
      nullReadsAs: "lead",
      mittiAutoInviteOnlyFor: "lead",
      installLeadOnlyFor: "lead",
      leadNoEmailUses: "business_office_email",
      changeableBy: ["office", "business_owner"],
      effect: "immediate",
      everyInstallerNeedsCii: true,
      readyCheckNeedsMittiLogin: true,
      crewSwitchKeepsMitti: true,
      officeInvitesMittiByHand: true,
    },
    // Jo 5 Nov 2026: REPLACES "workers the boss adds directly must sign the 6 worker declarations before being sent to jobs" (Jo 29 Oct).
    workerDeclarations: {
      by: "Jo 5 Nov 2026",
      replaces: "Jo 29 Oct 2026",
      required: false,
      addedOnTeamHeldBack: false,
      joinLink: "details only: name, mobile, email, date of birth, licence (electrician) or qualification and EEC certificate (installer); no promises to tick, no signature",
      completionLink: "certificate only, and only when one is needed (installer, not verified, none uploaded or last one rejected)",
      kept: ["CII certificate checks", "Lead Installer ESC registration", "ESC collection notice acknowledgement", "date of birth and mobile on file", "every other gate"],
      column: "partner_workers.declarations_due is ignored by app code (never read, never written). The live SQL (add_team_installer_with_identity, 0186, and pending add_team_person_with_identity) still sets it true on installer adds; a later SQL change should stop that or drop the column.",
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
  // Part 9 Task 6 (Jo 2 Nov 2026, "VEU and ESC timing rules"): the GO / DON'T START check (prestart.core GO_SLOTS).
  goCheck: {
    slots: ["2pm Melbourne the day before (day_before_2pm; also the lock time prestartRunAt)", "6:30am Melbourne on the install day (on_day_630am)"],
    sweep: "15-minute tick: dueGoSlot = the latest passed slot not yet recorded for that exact install start; a slot run always writes ONE pre_start_checks row (trigger = slot key), other triggers record only when the result changed",
    oldRows: "a check recorded by the old 12pm 'timer' trigger is kept as history; the 2pm slot still runs and writes its own row once",
    replaces: "the 12pm day-before check (PRESTART_HOUR 12)",
    // Part 9 Task 7: the email after each slot run (go-email.core / go-email.server).
    email: {
      to: "the installer business office email, by email only (no text to the Lead Installer); info@homeinsulationvictoria.com.au copies every DON'T START, never a GO",
      go: "{HV}: GO for tomorrow|today {8:00am} — All set for {address}, {day time}. Lead Installer: {name}. + Open the job",
      dontStart: "{HV}: DON'T START — {n} thing(s) missing — Don't start the install at {address} on {day time} until these are fixed: + the check's lines + We'll check again at 6:30am. (2pm run only) + Open the job",
      key: "go-email:v1:{job}:{start}:{slot} (+ :office for the info@ copy); one send per recipient",
      mustMove: "Jo 4 Nov 2026 14:40: lines classed must_move (classifyPrestartFailure: 24h rules already broken, PIISA/ESC timing, 30-day window, unknown lines — fail closed) → subject {HV}: DON'T START — the install must move; Don't start the install at {address} on {when}. + This can't be fixed in time — rebook the install for a later day and call the owner: + bullets, then Fix before 6:30am: + fixable bullets (only if any), no check-again line; all fixable → the n thing(s) missing email with Fix before 6:30am: bullets",
      wording: "APPROVED by Jo 4 Nov 2026 14:40; GO_EMAIL_APPROVED stays false until the coordinator flips it — real offices get nothing and nothing is recorded (awaiting approval); TEST job / TEST partner → test-send",
      senders: "installer office: sendOfficeEmail (master switch, trade pause, Idempotency-Key = key); info@: sendInHouseOfficeAlert; go_email_sent claimed only after a confirmed send, holds recorded once as go_email_held",
    },
  },
} as const;

export type HardStopCode = (typeof WORKFLOW_DECISIONS.hardStops)[number];

/** Install deposit % (Jo 26 Oct): flat 10% at any price. */
export function depositPctFor(_totalIncGst: number): number {
  return WORKFLOW_DECISIONS.payment.deposit.installPct;
}

/** New job flow Part 9 Task 8 (Jo 2 Nov 2026): insurance and licence are a HARD block until the office approves. */
export const INSURANCE_GATE_DECISIONS = {
  rule: "businessDocsBlocker (trade-expiry.core): public liability must be on file, office-VERIFIED, unexpired and $5m+ (amount typed by the office when approving, pending column business_credentials.amount_insured_aud); a newer upload waiting to be checked never lifts the block; a verified row with no expiry date or no amount blocks ('not recorded')",
  workersComp: "NOT collected at all (Jo 4 Nov 2026 21:08): no requirement, no insurance-page row, no reminder, no exemption column read",
  where: ["validateBooking — every booking kind (booking.server bookingComplianceGate)", "Add a job (onsite-ready-check.server, before any write)", "the Ready Check installer pick (readycheck-booking.server)", "pre-start facts (prestart.server businessDocsBlocker → prestartFailures 'Installer business: …')"],
  electrician: "validateBooking('assessment') also checks the booked electrician's licence + REC + expiry + office verification (electricianVerified) on every job, not only the in-house path; a business with no verified electrician can't book the safety check",
  failClosed: "a read error blocks (business-docs.server throws; prestart records the error line); the pending amount column missing = amount not recorded = blocked",
  reminders: "30 and 7 days before a document on file lapses (dueInsuranceReminder), once each, to the business's main email + a copy to info@homeinsulationvictoria.com.au (two sends, one key each, keys insurance-reminder:v1:…); electricians' licence reminders go the same way; DRAFT wording behind INSURANCE_REMINDER_APPROVED=false (real businesses held and recorded once, TEST partners → test-send)",
  unchanged: "installer certification, REC registration and the electrical licence business document keep the expiry-only rule (expiredBusinessDocsBlocker); REC allocation unchanged",
} as const;

/** New job flow Part 9 Task 9 (Jo 2 Nov 2026): required on file before working + the Lead Installer lock. */
export const REQUIRED_ON_FILE_DECISIONS = {
  rule: "requiredOnFileBlockers (worker-compliance.core): every person on a booking has a date of birth (kept privately, partner_worker_identity) and a mobile; the Lead Installer and crew an office-verified current CII/EEC (crewClearance); the electrician a verified licence + REC (electricianVerified); boss/office people need no certificate",
  where: "validateBooking for electrical and installation visits (people-on-file.server: the proposed or allocated electrician, the install's current Lead + saved crew; nobody allocated yet = nothing to check here) and offers; a read error refuses (fail closed). Jo 5 Nov: Ready Check is exempt from DOB, ESC registration, CII and White Card checks; any current Team attendee uses their Mitti login or the partner office login. Lead approval and install checks remain required.",
  wording: "Not on file yet: {name}: date of birth missing; {name}: mobile missing; {name}: CII/EEC certificate not verified by Home Insulation Victoria; {name}: electrical licence + REC not verified by Home Insulation Victoria.",
  lock: "Deep Part 5a (Jo 4–5 Nov 2026): leadInstallerLock(startIso) → reminderAt 3 days / lockAt 2 days before the install START, the install's own time of day, Melbourne wall-clock (DST-safe), lockLabel 'Wed 11 Nov, 7:30am'; leadInstallerLocked(startIso, now, { installCompleted }) false once the install is recorded complete; LEAD_LOCKED_MESSAGE = Locked — call Home Insulation Victoria to change the Lead Installer or the day; Parts 5 and 7 import, never re-implement",
} as const;

/** New job flow Part 9 Task 14 (Jo 2 Nov 2026, answers 18–19): real runs never reach the ESC. */
export const NO_ESC_DECISIONS = {
  marker: "jobs.external_refs.no_esc === true (no-esc.core noEscMarked); set once by the office (setNoEscMarker, event no_esc_marker_set), one-way, refused while a sent un-withdrawn ESC notice exists",
  refuses: "the Registry robot (noticeWork / veecWork skip, jobMode off), submitEscViaAdapter, recordEscSubmission, recordEscRegistryUpdate, recordRobotNotificationSubmitted, recordRobotNotificationUpdated, recordRobotVeecSubmitted, updateVeec to submitted/approved, veecCreationBlockers; sweepEscReminders skips marked jobs",
  gates: "the GO check and the PIISA timing rule drop only the ESC-notice lines (note 'No ESC (real-run job): ESC notice skipped' on the check); the 30-day PIESA rule, SWMS, Part C, certificate, deposit, insurance and every other gate still block",
  failClosed: "a marker read error throws → the recorder refuses, the sweep stops, the GO check is not recorded",
  unmarked: "byte-identical behaviour; no SQL",
} as const;

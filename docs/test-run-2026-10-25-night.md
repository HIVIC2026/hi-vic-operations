# Night test run — 25 October 2026

Plain-words summary for Jo. Branch `test-journeys-2026-10-25` (based on `installer-mitti-workflow`). Committed locally,
not pushed. Nothing touched the live database or sent a real message: every test ran on a private in-memory copy of the
database, and email, text, Stripe, Xero and Mitti were stand-ins.

## 1. The whole test suite

| | Files | Tests passing | Tests failing |
|---|---|---|---|
| Before tonight | 667 | 6,571 | 256 (82 files) |
| After tonight | 671 | 6,683 | 192 (69 files) |

What changed in the tests (no test was deleted or skipped, no safety check was removed):

- **Clock problems.** Four "quiet hours" tests failed whenever the suite ran after 8pm Melbourne. They now pin the clock to
  midday Melbourne.
- **Out-of-date test stand-ins.** Several hand-made database stand-ins did not understand newer database requests
  (`or`, `neq`, counts, link expiry). They were taught them; no expected result changed.
- **Rules that changed on purpose** (each with its decision): spot-saved / save-spot reminder texts are approved
  (decision 388 update); the dead "quote accepted" outbox row was removed (decision 376); a usual electrician who is not an
  onboarded REC holds the quote (decisions 303/369); six server functions were reviewed and recorded as safe.
- **Still failing, and why** — see section 5. They are mostly tests that check old wording or old file names after the
  24–25 Oct clean-up, plus a few that need a local Supabase that this machine doesn't have. I did not change those where
  the decisions log doesn't clearly say what the new rule is.

## 2. The two complete routes, start to finish

Both are new automated tests that drive the real portal code step by step and check what was saved after each step
(stage, history events, every email/text with its once-only key) and that the next step is refused if tried too early.

**A1 — the installer's own customer** (`tests/journey-a1-complete-route-db.test.ts`, 30 checks, all pass):
Add a job → A1 Ready Check in Mitti → boss enters the price → quote goes out (when the automatic send is switched on) →
owner signs the paperwork and accepts → $349 by card (Stripe) → automatic electrician offer → electrician offers 3 times →
owner ticks the 30-day box and picks one → A3 PIESA in Mitti (repair work needed, priced on the form) → Complete PIESA →
electrician gives fixes times → $600 + $100 fixes quote → owner confirms the PIESA and pays the fixes by card → owner
picks the fixes time → A4 Electrical fixes form → PIESA re-issued with Part C → installer offers 3 install days → owner
takes one → 10% deposit by bank transfer (Xero) → ESC consent, ESC notice, safety plan, PIESA copies → noon-before check
passes → A5 Install day form made once → installer fills it in → office checks the product labels → installation
recorded → completion documents and final invoice → balance paid → the trades' payouts are not held.

**A2 — our own lead** (`tests/journey-a2-complete-route-db.test.ts`, 12 checks, all pass):
Website enquiry → Save my spot (double tap = one spot) → Jo presses Release → owner gets "It's your turn" once → owner
confirms (double tap = once) → only the chosen installer is offered the Ready Check → installer offers 3 times → owner
picks one → A2 form made once → installer completes it → draft quote from the installer's rates, held → office presses
Send → owner signs and accepts → $349 by card → automatic electrician offer → PIESA booked → A3 says no repair work →
the electrician ticks "No electrical fixes required" and completes → owner confirms the PIESA → install day booked.
From there A2 runs the same code as A1 (deposit, install day, completion, payouts), which the A1 test proves.

## 3. Bugs found and fixed tonight

Each of these stopped a real job part-way through the route. All are fixed in code, with tests.

1. **"Complete PIESA" was refused forever on the new A3 form.** The A3 asks about mains/safety switches as one question
   and never filled the old "switchboard condition" and "RCDs present" fields, and the PIESA result and life support
   answer were never read. Now the A3's own "Is any electrical repair work needed…?" answer is the result (Yes = repair
   needed, No = pass) and life support is read. A pass still needs the electrician's own "No electrical fixes required"
   tick at Complete PIESA — it is never pre-ticked.
2. **The official PIESA was never filed** (decision 350 says it should be). Nothing created the first signed PIESA copy,
   so the fixes form could never re-issue it, owner/installer/electrician copies never went, and the install day form
   could never be signed off. Complete PIESA now files it from the A3 answers (or records why it is held).
3. **No installation could ever be recorded from the A5 Install day form.** The form's declaration tick ("Everything on
   this form is true and complete") was not mapped to the official PIISA declaration, so the official form always said
   "must be ticked".
4. **Jo's Release could never succeed** (and nor could the installer offer or the owner's time pick). They all need the
   job's "office offered booking" mark, and the button that set it was removed on 24 Oct. Release now records that mark
   for the job (the global on/off switch still applies).
5. **The office could never send an A2 quote** ("Electrician arrangement is not decided"). That choice only exists on the
   installer's own jobs; our leads always use our electrician. Owner consent is still required.
6. **Taking an install day before the owner confirmed the PIESA closed all 3 offered days** and sent the installer back
   to offer new ones. The confirmation is now checked first, so the days stay open.

## 4. Things found that need you (not changed)

- **Trade photo uploads on new jobs are refused** ("We don't have this property's location on file yet"). The location
  check needs the property's map position, which only the retired property lookup (4 Oct, "no remote lookups") wrote.
  Nothing writes it now and there is no office button to confirm it. Needs a decision: e.g. take the position from the
  address search, or an office "confirm location" step.
- **Install day form says "All filled in ✓ You can leave site"** while Installation complete is still locked for
  install-day photos the Ready Check left out (they are uploaded on the job page, not in Mitti). Wording/flow decision.
- **Pre-start check passed but completion then refused** for things that are really "before install" (PIESA copy given to
  owner and installer, owner's safety-check copy receipt, pre-install documents). In the test these were done before the
  day, but the pre-start check doesn't look at them, so a real job could start and only find out at the end.
- **Owner paperwork B wording is still DRAFT in code** (quote acceptance, VEEC consent, payment terms, landlord consent,
  tenancy, visit permission): real owners are refused until each is approved in Settings › Owner documents.
- **Automatic quote send is off** (`AUTO_QUOTE_SEND_ENABLED = false`, decision 159): A1 quotes wait on Quotes to check.
- **The A3 PIESA Mitti form is only made by the office "Create Mitti form" button** — not automatically when the PIESA
  is booked.
- **Choose installer / Release don't check the installer has an active rate card.** Without one the A2 Ready Check
  finishes, the job shows "measured estimate ready", and no quote can be made.
- **A repeat enquiry without the questionnaire answers wipes the owner's earlier insulation answer**, so Save my spot
  then waits for an office desk check.
- **Partner agreement versions:** the REC agreement went back from 2.6 to 2.5 in the 24 Oct reconcile; the installer
  agreement is at 1.20 with no decisions-log entry. Tests that expect the newer text fail until you confirm which is right.
- **Payouts (for the payouts work-stream):** the electrician's Money page showed only the Fixes row (no safety check row)
  and its amount was empty.
- **Install day form prefill** did not carry life support / solar from the PIESA on this route.
- **Warranty pack** names the quoted product (Bradford Gold) — fine here, but it does not use the office-confirmed actual
  product if they differ.

## 5. Still failing after tonight (not fixed, with the reason)

69 files, none of them new (every one also failed before tonight). Grouped by reason:

- **Test checks a function or file the 24 Oct office clean-up removed or moved** (stale test; the rule itself still
  holds): a3-a4-role-isolation-db, brief-e-silent-action-feedback, brief-x-piesa-stage-gate, field-job-one-call,
  status-label-unify, transfer-reconcile, install-clearance, security-review, mitti-identity-reuse, comms (its "no
  sender reachable" scan over-approximates through payments → fixes → Mitti; same result before tonight).
- **Test reads source code for an older exact line** (stale wording / file pin): address-complete (decision 281),
  engagement, enquiry-dispatch-link-renewal, p1-r1-s104, save-spot-delivery.core, spot-saved-messages,
  worker-cert-onboarding, intake-sequence, jo-answers-7oct, job-electrician-7oct, enquiry-search-postgrest-or,
  office-final-uat, postintake-health, owner-calculator, estimate, owner-email-triggers, ffs-field-access,
  ffs-minimum-results, measured-quote-accept (decision 366), network-timeout, operations-preview-loader,
  office-review-read, outlook-recovery, partner.core.
- **Wording changed by a decision but the decision doesn't spell out the exact new text** (needs Jo's word):
  save-spot and owner-job-route-terminal (decision 389 labels), pricing-cohort, s20r01, group-b-prehandoff,
  reviewed-insulation-routing, existing-insulation-send (decisions 388/392), esc-collection-notice (White Card),
  new-sender-reply, com09, review-practice-persistence, manual-communication (links/render), dummy-journey.
- **Partner agreement text/version** (see section 4): activity48-agreement-signing, installer-warranty-signing,
  rec-onboarding, installer-onboarding-pages, no-lead-fee.
- **Old hand-made test stand-ins missing newer database calls** (test harness, not the portal): bulk-import-confirm-*
  (4 files), bulk-import-lease-fence, enquiries-page-performance, enquiry-read-concurrency,
  office-enquiry-page-concurrency, office-page-id-only, quote-answer-db, payer-bypass-db, installer-payer-quote-db,
  ready-check-times-flow-db, enquiry-response-scope-practice-db.
- **Need a local Supabase / browser this machine doesn't have** (environment): brief-n-ready-check-success,
  brief-o-ready-check-delivery, register-interest-validation.

## 6. How to run these yourself

- Whole suite: `bun run test`
- The two routes: `bun test tests/journey-a1-complete-route-db.test.ts` and `bun test tests/journey-a2-complete-route-db.test.ts`
  (add `JOURNEY_DEBUG=1` in front to see each step's saved history).

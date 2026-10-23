# Installer E2E repairs — preview only, 23 October 2026

## Outcome

The portal portion was exercised with actual signed-in TEST installer and TEST Office accounts on localhost. No publication, invitations, real-owner sends, settings changes, or Spot saved recipient-list changes.

The complete Mitti-login-to-new-form journey is **BLOCKED**, not passed: New Ready Check opens the configured A1 launch URL and reaches Mitti's login screen. The TEST installer has no confirmed linked Mitti account; no invitation was sent. Deep's real account is linked to the existing Mitti user and the business is marked invited.

Office needs to confirm or establish Mitti membership for the TEST sign-in email `deep-test@hivic.test`, link its actual Mitti user to that TEST profile/business, and provide an authenticated TEST Mitti session for the browser walkthrough. No account was substituted for Deep.

## Actual screens and results

1. **Installer home:** New Ready Check is visible. TEST access notice is factual. Action needed contains the picked-up incomplete practice job. Existing entered spelling was restored from the TEST form and new pickup preserves it.
2. **Pickup:** One new incomplete TEST A1 audit was created through the Mitti API, using the marked TEST Reinsulate business override because the API author is the service user, not the installer. Actual pickup created **HV-3134** automatically as `qa_test`, at `ready_check_scheduled`, with Needs finishing. A second pickup returned no jobs. This proves TEST business classification and pickup, not native onscreen form creation.
3. **HV-3129 quote:** The form electrician appeared as A different electrician / TEST Sparky / TEST-REC-1 / $400 inc GST. Legacy fee-awareness and electrician-not-decided holds disappeared. Current contact permission stayed mandatory; an explicitly synthetic TEST-only consent fixture was prepared under Jo's authorised TEST-send request after the practice database check, never represented as real homeowner consent.
4. **Installer approval:** The whole quote appeared ($4,200 installer + $400 electrician + $349 AP fee − $1,120 rebate = $3,829). Tapping Quote is ready to send persisted installer identity/time and changed the next step to Waiting on office: checking your quote.
5. **Form changes:** Changed only the TEST form installer price from $4,200 to $4,201 and synced that TEST job. Approval was cancelled and the installer screen returned to You: check the quote. New total $3,830. Installer reapproved it onscreen.
6. **Office practice list:** Show practice jobs displayed HV-3129 under Ready for you. Check & send opened all three lines, rebate and total. Office pressed Send quote once. TEST email was accepted by the email provider at **06:27:23.777 UTC** and TEST SMS by the SMS provider at **06:27:24.269 UTC**, exclusively to the authorised TEST inbox/mobile. Records read back as `resend_test` and `twilio_test`, delivery_status `sent`. Provider acceptance is verified; inbox receipt was not inspected.
7. **Installer after send:** Reloaded HV-3129 shows Waiting on owner: to accept the quote. No repeated quote question, obsolete Ready Check task, or 50% timeline is shown on the Mitti-linked job.
8. **Missing information:** HV-3134 sits under Action needed. Its job page has the same clear next step. Office Waiting on installer is collapsed initially; after opening it, What's missing displays ceiling area, insulation product, price, owner mobile, owner email, contact permission in a popup, not a red list below the row.

## Evidence

Screenshots are in this directory, named `rerun-01` through `rerun-12`. Phone checks use 390×844, Office desktop 1280×1800. Inspected screenshots confirm approval, Office Ready for you, draft review, cancelled approval, installer after-send, Mitti login and missing-info popup. Phone document overflow was false and no installer page exceptions were observed.

## Checks

- 47 focused quote/electrician/approval/stage/payment/practice checks passed.
- 3 TEST notification-routing checks passed, including missing permission and unmarked-business refusal.
- 39 pickup/installer/closed-sync regressions passed.
- 6 explicit office-send isolation checks passed separately.
- Practice database fixture persistence passed before hosted TEST preparation.
- Latest preview build reports OK.

No owner acceptance, payment, invoice, installation booking, real Mitti invitation, or native TEST-installer form creation is claimed. Office Adjust is covered by existing fingerprint tests, not a new onscreen Adjust walkthrough.
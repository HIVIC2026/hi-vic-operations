# Installer "Owner accepted" email — send after the safety check is paid

Date: 28 Oct 2026 · Asked for by Jo

## Problem
When an owner accepts the quote, the portal straight away emails the installer:
"[Owner] has accepted the quote … and has paid for the electrical safety check."
But at that moment nothing has been paid. Seen on HV-3385 (Andrew Tammersild): invoice shows $0 paid.

Cause: the email is sent in the "quote accepted" step (`invoiceAfterAcceptance` in `src/lib/portal.functions.ts`),
before any payment.

## Decision (Jo, 28 Oct 2026)
- Send the installer email only once the $349 safety check is actually paid.
- Wording of the email stays exactly as it is.
- No waiver case — HIV never waives the safety check.

## Change
1. Stop sending the email when the quote is accepted (remove the call in `invoiceAfterAcceptance`).
2. Send it from the spot that already runs when the safety check payment comes in
   (`afterPaymentsChanged` in `src/lib/payments.server.ts`, next to the owner's "You're in!" email),
   using the accepted quote on that invoice.
3. The email keeps its "send once per quote" check, so it never goes twice.

Nothing else changes: same email, same recipient, same test-job rules.

## Already-sent emails
Jobs where the email already went out early (e.g. HV-3385) won't get a second one when the owner pays.

## Testing
- Owner accepts, nothing paid → no installer email.
- Safety check paid → installer email goes once.
- Payment synced again → no second email.

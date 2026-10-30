# Batch 3a — expired quotes, card deposit, old wording (design)

Date: 29 Oct 2026 · Owner: Jo · Branch `fix/batch3a-quotes-deposit` (on batch 2). Nothing goes live until Jo says so.
Later parts: 3b separate fixes / repeat-check invoices; 3c fresh Mitti form per safety check.

## In plain words

| # | Today | After |
|---|---|---|
| 1 | A quote not accepted in 14 days just sits there | On day 14 the job closes. The owner gets one email (below). The installer gets the normal cancel email |
| 2 | — | The email's "Send me a new quote" button reopens the same job. **Our leads:** a new quote is prepared at today's rates, same measurements, and lands on Quotes to check for you to press Send. **Installer leads:** the installer's job page asks them for a new price; once entered it's prepared and you press Send |
| 3 | The 10% deposit is bank transfer only | Card, bank transfer or PayID. Balance stays bank transfer or PayID. No card fee |
| 4 | Old wording in the owner's acceptance record, two Xero notes, and the office invoice panel | Matches today's payment steps |

**Owner email (approved 29 Oct)** — subject "Your quote has expired". "Hi {name}, your insulation quote for {address} has now expired. If you'd still like to go ahead, tap below and we'll prepare a new quote at today's prices." Button "Send me a new quote". "Cheers, the Home Insulation Victoria team".
**Page after tapping (approved):** "Thanks — we're preparing your new quote and will email it to you."
**Deposit wording (approved):** "bank transfer or PayID" → "card, bank transfer or PayID" wherever owners are told how to pay the 10% deposit.

## Technical detail

**1 Close on expiry.** `sweepQuoteExpiry` (quote-expiry.server.ts): after a quote is marked expired, if the job has no other issued/accepted installation quote, call `cancelJobFully(job, "Quote expired (14 days)", null, { tell: { owner: false, installer: true } })` and send the expired email once (key `quote-expired:v1:<quoteId>`) through `sendGuardedOwnerEmail` (TEST → test-send), behind a new `QUOTE_EXPIRED_EMAIL_APPROVED = true` flag. Template `docs/templates/mjml/owner_O78.mjml` via `mjEmail`, registered in the template hub. The 8pm rule for emails follows the existing owner-email pattern.

**2 "Send me a new quote".** Owner My job link `?screen=newquote` (owner's own secure token). Server fn `requestNewQuote(token)`: one claim per expired quote (`new_quote_requested` event, key = quote id); allowed only when the job is cancelled with reason "Quote expired (14 days)" and was not reopened since. Then reopen to the quote stage (`measured_estimate_ready`, not via `reopenStageFor`), re-activate the installer assignment ended by that cancel, and:
- our leads (`hivic_sourced`): `generateInstallerQuotes` at today's rates with the existing measurement, forced to a held draft (never auto-issued) → Quotes to check → office Send. If the installer isn't active any more → Needs me row "New quote asked for — choose installer".
- installer leads: nothing priced automatically; the installer's existing "Your price" card/status line asks for the price; once entered, the normal installer-quote path prepares it → office Send.
- Guard: the rebuild must NOT fold an accepted fixes quote into the new install quote (quotes.server.ts ~84-89) — only lines from the measurement.
- Page shows the approved thanks line; a second tap shows the same line and does nothing.

**3 Card for the deposit.** `paymentMethodsFor("install_deposit")` → card + bank; `STRIPE_CARD_STEPS` adds `install_deposit`; Stripe Checkout amount = the deposit due now. Every owner-facing deposit line changes "bank transfer or PayID" → "card, bank transfer or PayID" (owner-gates Gate B statement, payments.core pay lines, my-job pay card, install-booked email, approved-texts, deposit-release notice, owner-pages, email-reply). The Gate B statement is a signed document — bump its version (old signatures stay as history). **Jo must approve the new version in Settings › Owner documents before real owners can sign** (existing rule, decision 365).

**4 Wording.** portal.functions.ts ~808 acceptance record → "Owner accepted {option} ({total} inc GST): safety check paid at acceptance; electrical fixes in full if needed; 10% install deposit to book the install; balance on installation day." xero.server.ts ~156, ~209, ~357 and panels.tsx ~477/490/509 → today's steps (office only).

## Testing
Test-first per item; existing quote-expiry, payments, stripe, owner-gates, my-job tests; decision-388 scan unaffected (post-release); full suite vs baseline; tsc; retired scan.

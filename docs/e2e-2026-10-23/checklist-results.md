# Ready Check → quote phone checklist — 23 Oct 2026

**Overall: FAIL — not yet flawless.** Preview-only code, TEST Reinsulate account, 390 × 844 phone screens. No publication, invitations, global setting changes or real-owner sends. Hosted fixture changes were confined to qa_test jobs and proved on PGlite first.

| # | Result | Observed evidence |
|---|---|---|
| 1 | FAIL / blocked | New Ready Check opens the A1 launch URL, but lands at Mitti login. TEST membership/session is unconfirmed; no actual installer-created form demonstrated. |
| 2 | PASS, API fixture only | Earlier manual pickup created HV-3134 under the TEST business as qa_test; repeat pickup created no duplicate. Not a replacement for item 1. |
| 3 | PASS for checked TEST job | One next-step line, form electrician TEST Sparky, $400, Bradford Gold R5, 120 m² and entered owner/address casing preserved; retired intake/50% controls absent. |
| 4 | PASS for incomplete TEST job | HV-3134 popup lists ceiling area, product, price, mobile, email and permission; button targets its exact audit. Partial failed form writes were not treated as completed answers. |
| 5 | FAIL / incomplete coverage | Whole quote and approval work: $4,201.25 + $349 + $400 − $1,120 = $3,830.25, exact cents. Removal and difficult-access native choice writes were rejected by Mitti, so those combinations are not proven onscreen in this run; pure rule tests are not an E2E substitute. |
| 6 | PASS | After approval: “Waiting on office: checking your quote”; after explicit send: “Waiting on owner: to accept the quote”. |
| 7 | PASS | Changed TEST form price from $4,201 to $4,201.25, synced, and saw “You: check the quote” plus fresh $3,830.25 quote; no send. |
| 8 | PASS | Office changed rebate to $1,050 with required reason; installer saw “You: office changed the quote — please check” and reapproved. |
| 9 | PASS | Practice mode: approved TEST quote under Ready for you; Waiting on installer (1) collapsed; wrapped rows, no red lists. |
| 10 | PASS to provider acceptance | Same adjusted quote: $4,950 subtotal − $1,050 = $3,900. Explicit Send clicked onscreen; email and SMS recorded sent through TEST senders at 06:42:55 UTC, to the allowlisted TEST owner only. |
| 11 | PASS | Synthetic TEST site-condition hold: Held popup shows reason and Send quote is disabled. Hold subsequently cleared with an audit event. |
| 12 | PASS for exercised flows | Approval, adjustment, reapproval, hold and form sync did not send; only explicit Office Send invoked TEST notification. Focused isolated tests verify timers do not send and guards cannot be bypassed. |
| 13 | FAIL / receipt unverified | TEST notifications contain $3,900 and the secure My job quote link. The same link opens in preview and matches $3,900 with no phone overflow. Actual email inbox/SMS receipt is not accessible; the published-domain link was not certified against unpublished code. Provider acceptance is not receipt. |

## Evidence

Screenshots named `check-01-*` through `check-13-*` in this folder cover home/Mitti login, missing items, whole quote, both waiting states, Adjust, form change, Office rows/send, held popup/disabled button, and owner quote. Browser checks recorded zero page errors and no quote-page horizontal overflow.

## Remaining blockers

- A confirmed, authenticated TEST Mitti installer account is needed for one-tap native form creation and removal/access answer saves. Do not invite or use Deep's real account as a substitute.
- Actual TEST inbox and SMS receipt must be confirmed separately; no receipt is inferred from the sent record.
- Current TEST HV-3129 ends with the new $3,830.25 draft, unapproved/unsent, after the form-change test. The earlier $3,900 TEST send stays in permanent history. No real quote or owner was altered.

The owner payment schedule shown during verification still follows existing configured payment rules; these were not changed as part of the quote checklist.
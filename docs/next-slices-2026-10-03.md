# Next slices (planned, not built) — 3 Oct 2026

Both slices: practice database first, switches stay OFF, no live sends, no publish. Rules stay in pure `*.core.ts`, written by office-only server functions with an audit trail.

## Slice A — Record verified eligibility after the Ready Check
Why: PIESA needs "verified eligible", and nothing records it yet.
- Office-only card on the job page that appears once the Ready Check is complete. It shows Gate 1 (as declared), the Ready Check facts (measured area, existing insulation, R-value, removal) and any flags.
- Three outcomes: Verified eligible / Not eligible (reason required) / Needs office review (note required). Records who and when, plus the facts it was based on. A newer Ready Check or new measurement makes the result stale.
- Storage: a new add-only `eligibility_verifications` table (history kept, one current row). Office can write; the owner can read their own outcome only. Gate 1 records are never overwritten.
- `piesaRequestFacts` reads the current verification. Missing or stale → blocker "Verified eligibility not recorded".
- Tests: each outcome, stale after re-measure, required reasons, access (office/owner/trade/stranger), PIESA blocked→unblocked.

## Slice B — Instalment plans and owner acceptance
Why: the gate already needs all four plan conditions, but there is no way to record them.
- Office: propose a 3-instalment plan for the current quote/invoice (amounts and due dates, totalling the invoice inc GST), then approve it. Approval alone never clears the gate.
- Owner: plain plan terms on their job page, then "Accept plan" (records time, IP and terms version). Terms wording needs Jo's approval first; it is never invented.
- Office records the first instalment as verified in Xero (manual reference, no Xero writes), plus the payment method or collection arrangement.
- Plan states: proposed → approved → accepted → active. It can also be cancelled, failed, overdue or superseded. A new quote version supersedes the plan automatically.
- Tests: each condition missing on its own, one cent short on the first instalment, overdue/superseded clear nothing, access rules, PIESA unlock end-to-end.
- Blocker before build: Jo-approved owner plan terms wording.

## Release notes — instalment-plan UI slice published 3 Oct 2026

- Published: office instalment-plan card + owner secure-page plan acceptance card. `payment_option_gate_enabled` stays OFF; PIESA, rectification and installation scheduling remain blocked; all outbound sending switches OFF.
- Resolved access/UI defect: the office instalment-plan card briefly rendered for non-staff signed-in users on the office job page in preview. Server/database actions were already protected (admin-only checks); the UI now renders the card only for office staff. Verified post-publish on TEST job HV-1003.
- Same deploy: certificate upload fix (dotted file names, iPhone HEIC photos, missing file type) and removal of automatic certificate reading — installers/electricians now type insurer, policy number, cover and expiry themselves.

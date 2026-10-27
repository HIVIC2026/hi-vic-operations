# Audit scenarios and coverage

Starting catalogue for step 2 of the audit. **Covered by** names the tool that proves it today; **gap** means nothing does yet. Update this table when a gap closes. Coverage as of 27 Oct 2026.

## Main journey

| ID | Scenario | Expected outcome | Covered by |
| --- | --- | --- | --- |
| J1 | Website enquiry arrives | One job in Enquiries, automatic response sent once, offered a chance to save a spot; no call task and no questions asked | journey `s1_calculator`/`s2_owner_links`; webhook signature rules (portal-qa probes) |
| J2 | Owner saves a spot, office releases it | Spot saved, release step recorded, installer offered | journey `s3_office_offer` |
| J3 | Ready Check booked and done | Time confirmed by both sides (sharing contacts alone never books), Mitti Ready Check on the right job | journey `s4_ready_check`; `readyCheckBookingOutcome` |
| J4 | Eligibility and quote | Verified eligible; confirmed quote from current rates; held only for the reasons in the rules | journey `s4_ready_check`; quote rule tests |
| J5 | Owner accepts and pays the safety check | Quote version approved and paid before any PIESA request | journey `s5_owner_accept`; payment-gate tests |
| J6 | PIESA booked, done, owner confirms | Electrician offered 3 times; installer told; A3 Mitti form made; owner confirms by link | journey `s6_electrician` |
| J7 | Install booked inside 30 days, done, final Mitti | Installer offers days in the window; 10% to book; final evidence on the right job | journey `s7_install` |
| J8 | Final check and payouts | One Final check screen, Approve only when all pass, by a person; installers paid 7 days after AP approval (own customers: and the owner's payment in full); electricians within 7 days of the office pressing Approve form on their completed Mitti form, never waiting for the owner | journey `s8_ap_payout`; installer B6 |

## Difficult cases

| ID | Scenario | Expected outcome | Covered by |
| --- | --- | --- | --- |
| D1 | Ready Check shows not eligible / needs review | Verified value recorded; no confirmed quote; owner told once (or one held/blocked row with the reason) | `bun run journey -- --branch not-eligible`. 27 Oct 03:08: all 6 checks pass |
| D2 | PIESA needs fixes | Fixes quote auto-sent only when A3 complete and all checks pass, else held with reason; A4 form; Section C before install unlocks | `bun run journey -- --branch piesa-fixes` (invoices in Xero Demo Company only; Mitti simulated, real Mitti refused). 27 Oct 03:09: all 8 checks pass |
| D3 | Missing or wrong Mitti evidence (draft, wrong job, wrong version, duplicate) | Hard stop in Needs me; job state does not move | Mitti rule tests (partial); **gap** end to end |
| D4 | Card payment fails or is reversed | No stage change; owner can retry; Xero total goes down on reversal | Stripe/Xero rule tests (partial); **gap** end to end |
| D5 | 30-day window lapses | 20- and 10-day reminders; repeat PIESA charged to whoever caused it | thirty-day rule tests (partial); **gap** end to end |
| D6 | Trade document expires | Needs me row from 30 days before expiry; lapsed cover blocks work | **gap** |
| D7 | Duplicate submission (same address, double click, webhook replay) | One job, one email, one event | duplicate-address test; installer C7/C11/C14 |
| D8 | Upload interrupted | Nothing half-saved; retry works | **gap** |
| D9 | No time agreed in 24h / no confirmed booking in 48h | Reminder, then hard stop | **gap** |

## Roles and access

| ID | Scenario | Expected outcome | Covered by |
| --- | --- | --- | --- |
| R1 | Each role signs in and lands on its own home | Office, installer owner and staff, electrician, owner | portal-qa setup + screens |
| R2 | Installer staff refused rates, bank, agreement, Money | Refused by the server, not just hidden | installer B4 |
| R3 | Installer sees address only after accepting | Hidden on offers | installer B5 |
| R4 | Owner or electrician opens another job's link or id | Refused | **gap** (a3-a4 role isolation DB test only) |
| R5 | Electrician never sees the customer's $349 | Only "Your agreed rate" | allocation rule tests; **gap** on screen |
| R6 | Signed-out visitor on any signed-in page | Sent to sign-in, remembers where | cloud sweep 26 Oct |

## Connected systems and automations

| ID | Scenario | Expected outcome | Covered by |
| --- | --- | --- | --- |
| C1 | Mitti answer reaches the right job | Audit id matched to job; wrong job is a hard stop | Mitti rule tests; **gap** live |
| C2 | Xero invoice and payments match the portal | Same total; no double count of Stripe and Xero | Xero rule tests; **gap** on a TEST job |
| C3 | Email delivery failures visible | Failed or uncertain sends show in Needs me | portal-qa live email log |
| C4 | Each automation step fires exactly once | One email, one task, one stage change per event | **gap** |
| C5 | Automations refuse unsigned calls | 401/403 | portal-qa probes; cloud sweep 26 Oct |

## Speed and phones

| ID | Scenario | Expected outcome | Covered by |
| --- | --- | --- | --- |
| S1 | Every screen at 390px and 1280px | No errors, no sideways scroll, no retired wording | portal-qa screens |
| S2 | Time to usable screen per page | Recorded each run; slow pages listed | **gap** (one-off speed audit 25 Oct) |

# Quick taps: owner's OK to share details won't save — spec (Jo approved 2 Nov 2026)

## Problem
When an owner taps "Yes, let's go" on the quick-taps screen, the portal saves their answers, then tries to record
their OK to share name and number with the installer (`trade_contact_share`) with `method: "link_code"`.
The database rule `owner_gate_signatures_check` says a `link_code` signature must carry a verified code
(channel, destination, code id). Quick taps never sends a code, so every insert is rejected. Seen live on
HV-2730 (Wayne Wilson): 1 answer, 11 failed saves (`quick_taps_share_not_recorded`), 2 Nov 2026 19:09–19:14.

## What changes
1. New signing method `quick_tap_link` = "owner tapped their own texted link, no code". The database allows it only
   for `doc_key = 'trade_contact_share'`.
2. Quick taps signs `trade_contact_share` with `quick_tap_link`. `signGateDoc` refuses `quick_tap_link` for any other
   document or without a quick-taps batch id.
3. Owners who already said yes (consent_share true, outcome pass) but have no saved OK get it saved once from their
   recorded answer, by a one-off repair run with Jo's OK before it touches the live database. Today: HV-2730 only.

## What stays the same
Text message, questions, thanks screen. The installer still hears nothing until Jo taps Send. Every code sign-in
(`link_code`) still needs its code.

## Checks
TEST/practice database: a `quick_tap_link` OK for `trade_contact_share` saves; `quick_tap_link` for any other
document is refused; `link_code` with no code is still refused.

## Delivery
Pull request on GitHub; merged by Jo's coordinating chat. Database change applied to live only after Jo says yes.

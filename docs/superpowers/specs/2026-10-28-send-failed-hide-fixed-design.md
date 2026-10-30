# Send failed list: hide failures that later went through

Date: 28 Oct 2026. Approved design by Jo.

## Problem
The Send failed list shows every failed email or text from the last 7 days, even when the same message
was sent again later and worked. Example: on 23 Oct, six Save my spot emails (HV-3127 Watkinson,
HV-3131, HV-3132, HV-3133, HV-3135, HV-3152) were held, then sent OK about 3 hours later. Three owners
have since saved their spot, but all six still show as "Send failed".

## Rule
A failure is hidden when the same job later has a successful send of the same kind:
- Email: same job and same `purpose` in `customer_email_sends`, created after the failure, status `sent`.
- Text: same job and same `message_type` in `sms_messages`, created after the failure, status `delivered`.
  A `sent` text does not count, because it may still fail to reach the phone.

Everything else stays the same: failures with no later success still show, with the same wording and order.
Nothing is resent.

## Changes
- `src/lib/send-failed.core.ts`: `sendFailedRows` also takes the successful sends and drops any failure that
  has a later success of the same job and kind.
- `src/lib/office-needs.server.ts`: also load `sent` emails and `delivered` texts from the last 7 days
  (job, kind and time only) and pass them in.

## Tests (`tests/send-failed.test.ts`)
- A failed email followed by a sent email of the same purpose: hidden (Watkinson case).
- A sent email of a different purpose: still shown.
- A sent email before the failure: still shown.
- A failed text followed by a delivered text of the same type: hidden.
- A failed text followed by only a `sent` text: still shown.
- Existing tests keep passing.

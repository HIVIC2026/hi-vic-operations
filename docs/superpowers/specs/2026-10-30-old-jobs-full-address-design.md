# Older jobs with no street: ask the owner, and block the Ready Check until it's fixed

Date: 30 Oct 2026 · Asked for by Jo · Found on HV-3542

## Why

The 28 Oct full-address fix (`2026-10-28-full-address-required-design.md`, PR #55) only covers enquiries created
after it went live. Jobs already in the portal with no street were left alone. HV-3542 ("Brighton VIC 3186") was
then released, offered to an installer and booked for a Ready Check on 29 Oct. Releasing a spot, offering a Ready
Check and booking one don't check for a street. On 30 Oct about 20 live jobs had no street number (e.g. HV-3199
"Greenwood St", HV-3182 "Park Ave, Glen Huntly VIC 3163"), some at "ready to schedule".

HV-3542 itself was fixed by hand on 30 Oct (11 Albert St) and needs nothing more.

## Jo's decisions (30 Oct 2026)

1. **Ask the owners of older jobs too.** Website (`base44`) and email (`email`) enquiries on HIV leads with no
   street get the same address request as new ones, whenever they were created. Same approved email and text, same
   address page, one reminder 24 hours later, then nothing more.
2. **Block until fixed.** Any job with no street (any source or channel) can't have its spot released, a Ready Check
   offered to an installer, or a Ready Check booked. Each of those is refused with "Waiting for the owner's full
   address", and the office sees that reason.
3. **Carry on.** Once the owner picks their address, the job carries on by itself, the same as for new enquiries.

"No street" means the same as before: `parseStreet(address_line) === null` (`address-complete.core.ts`).

## Changes

**Ask the owners: `address-request.core.ts`**
- `addressRequestOpen` no longer needs `createdAt >= goLiveAt`. `goLiveAt` stays as the on/off switch (null = off).
  The rest is unchanged: `base44`/`email` source, `hivic_sourced`, not "does not appear eligible", no street, not
  answered.
- Cancelled, deleted or archived jobs are never asked. Add that check if the sweep doesn't already skip them.
- All the existing send rules apply: no texts 8pm to 7am (they go at 7am), the customer emails master switch,
  opt-outs/STOP, and TEST jobs only going to the test address. Never more than one request and one reminder per job.
- The 15-minute sweep sends at most 5 address requests per tick, so the first run doesn't send 20 at once.

**Block: one shared check**
- New pure helper `noStreetBlock(addressLine): string | null` in `address-request.core.ts`. It returns
  `ADDRESS_REQUEST_BLOCK_REASON` when there's no street.
- It's used in `releaseSpot` and `sweepSpotReleases` (`spot-release.server.ts`), in `officePickReadyCheckInstaller`
  and the automatic Ready Check offer path (`ready-check-times.server.ts`), and in `confirmBooking` for `kind =
  "ready_check"` (`booking.server.ts`). Putting it in `confirmBooking` covers the owner, installer and office booking
  paths.
- The office override booking is blocked too. The office fixes the address on the job page first.
- Jobs already booked aren't undone. The block only stops new releases, offers and bookings.

## Not changing

- Owner wording and the address page (already approved 28 Oct).
- Installer "Add a job" (already needs a picked address).
- Jobs past the Ready Check.

## Tests

- `addressRequestOpen`: an old (pre-28 Oct) `base44` no-street HIV lead is open. A cancelled or deleted one isn't.
  Feature off means nothing is open.
- `noStreetBlock`: "Brighton VIC 3186" and "Greenwood St" are blocked. "11 Albert St, Brighton VIC 3186" and
  "Unit 14/26-30 Willansby Ave" pass.
- `releaseSpot`, `officePickReadyCheckInstaller` and `confirmBooking` (ready_check) each refuse a no-street job
  with the reason and write nothing.
- The sweep sends at most 5 per tick and never twice.
- Full test run and typecheck pass.

## Delivery

Branch `old-jobs-full-address`, its own pull request. Not merged by this chat.

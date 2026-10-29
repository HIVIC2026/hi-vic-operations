# Plan: older no-street jobs (HV-3542 follow-up)

Spec: `docs/superpowers/specs/2026-10-30-old-jobs-full-address-design.md` (approved by Jo, 30 Oct 2026)
Branch: `old-jobs-full-address` · Pull request only, not merged here. Each task is test-first, then committed.

## Task 1: rules (pure), `src/lib/address-request.core.ts`
- Tests: an old `base44` no-street HIV lead is open. Cancelled, deleted or archived is not open. Feature off means
  not open. The existing cases still pass (update the one that expected old jobs to be skipped).
- Remove the `createdAt >= goLiveAt` check. Add `closed` (cancelled, deleted or archived) to the facts and return
  false when it's set.
- Add `noStreetBlock(addressLine)`, tested on "Brighton VIC 3186", "Greenwood St", "11 Albert St, Brighton VIC 3186"
  and "Unit 14/26-30 Willansby Ave, Brighton VIC 3186".

## Task 2: sweep, `src/lib/address-request.server.ts`
- Fill in `closed` from the job. Cap at 5 sends per tick.
- Test (PGlite): with 7 open jobs the first tick sends 5, the next tick sends 2, and a third tick sends nothing.

## Task 3: block release and offers
- In `releaseSpot`, `sweepSpotReleases`, `officePickReadyCheckInstaller` and the automatic offer sweep, read the
  property address. If `noStreetBlock` returns a reason, throw `WorkflowError(reason)` or, in a sweep, skip the job
  with that reason.
- Tests: a no-street job is refused or skipped, and no offer or event is written.

## Task 4: block booking, `confirmBooking` (`booking.server.ts`)
- For `kind === "ready_check"`, refuse when `noStreetBlock` returns a reason. This covers the owner, installer and
  office override paths.
- Test: the booking is refused with the reason and no booking row is written. A PIESA booking isn't affected.

## Task 5: check everything
- Full `bun run test` and `bunx tsc --noEmit` (note any failures that were already there before this work).
- Push and open the pull request with a plain summary that includes the "sends to about 20 owners" warning. Stop
  there.

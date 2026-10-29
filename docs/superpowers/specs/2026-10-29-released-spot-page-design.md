# Owner page after a spot is released — design

## Problem
Job HV-3542 (Cheryl): spot released 5:25pm, installer offered Ready Check times 8:24pm. Until she booked a time at 8:30pm her My job page still said she was waiting: "Thousands of Victorians have registered… We'll be in touch when your spot is released", "Nothing else to do until your spot is released", progress stuck on "Spot released" (not ticked), "Step 1 of 6".

Cause: `isSpotSavedStage` (src/lib/owner-myjob.core.ts) keeps the spot-saved page until a Ready Check is booked. It never looks at whether the spot was released.

## Fix (only this, nothing extra)
Once the job has a `spot_released` event, the spot-saved page (`SpotSavedHome`) changes as follows:
1. Hide the yellow "Thousands of Victorians have registered…" box.
2. Paperwork-done card: drop the line "Nothing else to do until your spot is released."
3. Progress list: "Spot released" gets a tick; "Your quote" becomes the current step.
4. Top line: "Step 2 of 6" instead of "Step 1 of 6".
5. Under the ticked "Spot released", hide its sub line ("…We'll be in touch when your spot is released.") — Jo, 29 Oct.

Unchanged: the headline, the "Choose your Ready Check time" box, numbers, everything after a time is booked.

## How
- `owner-myjob.server.ts`: add `released: boolean` to `spotSaved` (true when a `spot_released` workflow event exists for the job).
- `my-job.$token.tsx` `SpotSavedHome`: use `released` for points 1–4.

## Testing
- Unit test: page view for a saved, not-released job is unchanged; for a released job, points 1–4 hold.
- Check on a TEST job after release, before a time is booked.

# Make "Save my spot" show "saved" straight away (HV-3663)

## What happened to Pene's save (from the live job history)

| Time (UTC) | What | Gap |
|---|---|---|
| 08:58:25.03 | Spot saved and job moved stage | (tap to here not recorded) |
| 08:58:27.32 | Confirmation email and text prepared | 2.3 s |
| 08:58:36.12 | Email and text both sent | 8.8 s |
| 08:58:36.77 | "Confirmation completed" recorded | 0.6 s |

Yes, your guess is right. The save itself was finished at 08:58:25, but the owner's page only gets its answer after the code also prepares and sends the confirmation email and text. Pene waited about **11.7 seconds after her spot was already saved**. Nothing else stood out as slow: preparing the messages took 2.3 s and sending them took 8.8 s, all inside the same request.

Not checked: the time from her tap to 08:58:25 (the live logs only keep the last hour, and that request isn't in them). If you want, I can measure a TEST save once the fix is in.

## The fix (smallest change)

In the one place a real owner saves a spot, keep the save exactly as it is, then hand the confirmation step to "after the reply" (waitUntil). The page shows "saved" as soon as the save is stored.

- The confirmation function itself is not changed. All its guards stay the same: once per job, consent, opt-out/STOP, the 8pm text cut-off, the switches, and the 24-hour limit.
- If the background step is cut short, the recovery sweep that already runs on the regular tick sends it later, once, through the same guarded sender.
- TEST jobs behave exactly as now.
- No wording, look, switch or database change. Nothing gets sent while building or testing.

## Checks before Jo publishes

- A new test proves the save answers before the confirmation finishes, and the confirmation still runs exactly once.
- A test proves a second tap still never sends twice.
- Run the existing Save my spot and recovery tests.
- Jo publishes when she's happy. I won't publish.

## Technical details

- `src/lib/launch-campaign.server.ts`, `saveCampaignSpot`: both `await queueSpotSavedConfirmations(...)` calls (the replay path and the new-save path) change to `runAfterResponse(() => queueSpotSavedConfirmations(...))` from `background.server.ts`. With `"queue_only"` (no waitUntil), the existing `sweepSpotSavedConfirmations` is the fallback.
- `queueSpotSavedConfirmations` and `spot-saved-send.server.ts` stay as they are.

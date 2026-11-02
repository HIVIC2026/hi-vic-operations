# Quick taps "thanks" screen: the installer will call (2 Nov 2026)

## Why
Since 1 Nov the installer rings the owner and books the Ready Check. The thanks screen an owner sees after
tapping "Yes, let's go" on the quick taps still says "We'll text you your time soon", which is now wrong.

## What Jo approved (2 Nov 2026)
- The pass screen says: **"Thanks! {installer name} will call you soon to book your free Ready Check."**
- `{installer name}` = `installer_name` on the area batch the owner answered (the installer Jo sent that batch for).
- No name on the batch → **"Thanks! Your installer will call you soon to book your free Ready Check."**

## What does NOT change
- The quick taps text, its reminder, the questions and their order.
- Decline screens and decline emails (no hatch, flat roof, last 5 years, no thanks).
- The installer is still NOT told when the owner says yes. The job waits in Choose installer › Ready to send
  until Jo taps Send to installer (already how it works; no code change).

## Design
- `quick-taps.core.ts`: the `done` view carries `installer: string | null` for a pass. Add
  `quickTapsPassLine(installer)` returning the two lines above (installer name trimmed; blank → fallback).
  The old `QUICK_TAPS_COPY.outcome.pass` text is replaced by the fallback line so nothing shows "text you your time".
- `quick-taps.server.ts`: `viewOf` reads `installer_name` from the batch-sent event of the answered batch and puts
  it on the pass `done` view (also returned by `saveQuickTaps`).
- `my-job.$token.tsx`: the done screen shows `quickTapsPassLine(view.installer)` for a pass; after Save it uses
  the view the server returned (so the name shows straight away), not a locally built one.

## Testing
- Unit: `quickTapsPassLine("RAPID INSULATION")` → named line; `null`/blank → fallback line.
- Unit/server: a pass on a batch sent for an installer returns its name on the `done` view.
- Existing quick taps tests stay green; decline outcomes unchanged.

## Delivery
One pull request; not merged from this chat (the coordinating chat merges).

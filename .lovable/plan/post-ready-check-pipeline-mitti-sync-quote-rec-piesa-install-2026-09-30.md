# Post-Ready-Check pipeline: Mitti sync → quote → REC → PIESA → install → sign-off

Goal: after the installer's Ready Check Mitti report syncs, the office works from a clear queue of "confirm and send" actions. Each step has a manual button now and an auto switch for later. Every auto switch starts **off**, and all customer or trade messages still respect the existing comms lock.

## The flow

```text
Ready Check Mitti report syncs
  -> 1. Measured quote calculated automatically (draft)
  -> 2. Office "Quotes to send" list -> Confirm & send to owner      [manual now, auto later]
  -> 3. Owner accepts (existing signing + VEEC assignment)
  -> 4. Office "Send to REC" -> REC gets the request in the app      [manual now, auto later]
  -> 5. REC accepts -> owner and REC see each other's contact details
       -> they agree a time in the app (existing appointment proposals)
  -> 6. Portal shows "Electrician booked - <date/time>" automatically
       -> PIESA Mitti form pre-filled and sent to the REC
  -> 7. REC submits Mitti -> PIESA uploads to the Job File, pass/fail recorded
       -> Pass: office sees "Ready for install - book me"
       -> Fail: rectification / variation path (existing reconciliation)
  -> 8. Office "Send to installer" (the installer who did the measure-up)  [manual now, auto later]
       -> installer and owner book in the app -> "Installation booked"
       -> installation Mitti form pre-filled and sent to the installer
  -> 9. Installer submits -> evidence uploads -> AP final sign-off queue
```

## What gets built

1. **Auto quote on sync.** When a Ready Check Mitti sync completes, the measured quote is built automatically from the stored measurement and the current rate card. It stays a **draft**. If anything is unpriced ("other" items, a missing rate), it is flagged "needs office pricing" and never guessed.
2. **Office action queues** on the admin Pipeline, one list each: Quotes to send, Send to REC, Ready for install – book me, Send to installer, Final sign-off. Each row shows the job, owner, amount or date, any blockers, and one main button.
3. **REC request.** A REC gets a request inside the portal and accepts or declines it. Accepting shares contact details both ways, recorded as consented and audited, and opens the existing appointment proposal screen.
4. **Booking → Mitti hand-off.** Confirming a booking sets the stage label with the date and time, then creates the right pre-filled Mitti audit (PIESA for the REC, installation for the installer) using stored details. It is sent only if Mitti and comms are enabled; otherwise the office sees a "Send Mitti form" button.
5. **PIESA return.** The REC's submitted Mitti PIESA is saved into the private Job File. Pass or fail comes only from the explicit PIESA result field, never inferred. A pass moves the job to "Ready for install"; a fail opens rectification.
6. **Installer return → sign-off.** The installer's Mitti submission fills the evidence requirements. When evidence is complete, the job joins the AP review queue for your final sign-off.
7. **Auto switches.** Admin settings get one switch per step (send quote, send to REC, send to installer, send Mitti forms). All start off, and each change is audited.
8. **Notifications to the REC and installer.** Each request appears in their portal right away. Email/SMS is sent only when comms are enabled.

## Activity 48 AP compliance timeline (built in as hard gates)

Each gate is a timed requirement the job cannot pass without. It shows on the job page and in the office queues with a countdown and a red warning when it is close or overdue.

| When | Requirement | Gate behaviour |
|---|---|---|
| Quote acceptance | Owner signs Customer Acceptance, the conditional VEEC rights assignment to us, and the required consumer declarations | Invoice, deposit and REC request stay locked until all are signed |
| Before any booking | 50% deposit paid (Xero) or audited override | Blocks REC and installer scheduling |
| After booking, at least 24h before install | Reg 23A consent from owner | Blocks "Ready to install" |
| At least 24h before install | ESC notified of the upcoming installation (notice sent and recorded with a reference) | Blocks installation start; bookings under 24h ahead are rejected |
| At least 24h before install | PIESA copy given to the owner and the installer | Blocks "Ready to install" |
| Within 30 days of PIESA | Installation completed | After day 30 the job is blocked until the PIESA is redone |
| After install | Installer declaration, evidence photos/files, final facts on the VEEC assignment, installer then AP sign | Blocks AP review |
| AP review | All evidence verified, assignment effective | Only then "Ready for VEEC" |
| Lodgement | VEEC lodgement recorded (quantity, reference, date), within the ESC lodgement window | Tracked with a deadline warning |

- Most of these checks already exist in the portal. This work **connects them to the new flow**, adds countdowns to the office queues, and adds a **Compliance timeline** panel to each job.
- **Before building, first step:** check this list line by line against the current official Activity 48 specification and ESC guidelines. That covers exact wording, the notification timing and method, lodgement windows, record-keeping periods, and any documents missing from the list. Anything I can't confirm from an official source is marked "needs your confirmation", never guessed.
- Rules live in one place, and time limits are settings, so they can change without a rebuild.

## Safety kept

- Existing guards stay in charge: the 50% deposit, the 30-day PIESA window, 24h booking lead time, READY TO INSTALL, and evidence checks.
- Nothing is sent while the comms lock is off. The office still sees a "would send" record.
- Mitti never completes assessments or passes compliance by itself; the portal's own checks decide.
- No new prices or official wording are invented.

## Technical details

- Hook into the Mitti sync completion in `mitti.server.ts`, then call a new `buildMeasuredQuoteDraft` (pure, in the quote core) and store it as a draft quote.
- Add a new `workflow_settings` columns `auto_send_quote`, `auto_send_rec`, `auto_send_installer`, `auto_send_mitti` (default false). Config changes are logged to `admin_config_events`.
- Office queues are derived views/server functions over stages plus quote, booking and assessment state; no new source of truth.
- REC request reuses `job_assignments` plus an accept step; contact sharing is recorded in the audit log.
- `confirmBooking` post-step creates the Mitti audit through `mitti.server.ts` using the existing template IDs in `workflow_settings`. It is blocked if no template is configured.
- PIESA import extends the existing PIESA records and reconciliation; the file goes to `job-files` via `documents`.
- Auto-progression stays only in `autoAdvanceJob`. The new send steps are separate audited actions, gated by the switches and the comms lock.
- Tests cover each step's manual and auto paths, lock-off behaviour, and a fail-closed check when the result is missing or ambiguous.

## Open items to confirm during build

- The exact Mitti template IDs for the REC PIESA form and the installer form.
- The field in the REC's Mitti form that holds the official PIESA pass/fail result.
- Whether REC and owner contact details can be shared automatically once the REC accepts, or need owner consent first.

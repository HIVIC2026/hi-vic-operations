# Daily full journey test — design (updated 31 Oct)

Date: 31 Oct 2026 · Owner: Jo · Status: waiting for Jo's approval
Replaces: `2026-10-29-daily-full-journey-test-design.md` (PR #77, closed, never merged)

## What Jo wants

Every morning, a TEST job goes through every process in the portal as every person — owner, installer boss, Lead, Crew, electrician and office — and Jo's 6am report says what broke. Jo does no testing by hand.

## What already exists (don't rebuild)

- `bun run journey` (`scripts/journey.ts`, `src/lib/journey.server.ts`): a fresh TEST job through 10 steps, screens at 390px and 1280px, result saved in `journey_runs`, TEST data archived.
- **It now passes.** 31 Oct 2026, 4:08pm Sydney: 10 of 10 steps passed in about 4 minutes (first full pass was 30 Oct). Mitti forms and the ESC Registry are simulated.
- `bun run journey --screens`: the same walk through the real pages as each TEST person.
- **22 side paths** via `--branch` (not 23 as the old spec said):
  - Older two: `not-eligible`, `piesa-fixes`
  - 8 hard cases: `p1-not-eligible`, `p2-piesa-fixes`, `p3-payment`, `p4-documents`, `p5-install-window`, `p6-booking-timing`, `p7-mitti-form`, `p8-other-link`
  - 12 money and safety blocks: `m8-quote-payment`, `m10-deposit`, `m11-fixes-payment`, `m22-payout-form`, `m23-electrician-payout`, `m24-installer-payout`, `m9-piesa-prereqs`, `m7-quote-release`, `m42-comms-lock`, `m43-consent`, `m158-repeat-piesa`, `m158-owner-pays`
- `journey_runs` already has `path`, `run_group` and `status` columns (migration 0178, live). Nothing fills them yet.
- TEST safety: TEST jobs use the Stripe test key, the Xero Demo Company, the Mitti simulator and TEST trades only. Owner emails go to Jo's test inbox; texts only through the test sender to Jo's numbers. Real Mitti calls are refused, and step 10 checks nothing left the allowlist.
- The TEST office login can only open a fixed list of pages and actions (`src/lib/qa-office-policy.core.ts`): Needs me, Enquiries, the Jobs pages, one job, Money payouts, Choose installer and the Test Centre.
- Deleting a TEST job can now be undone (Settings › Deleted). The test archives its jobs; it doesn't delete them.

## The problem today

- It only runs when someone asks Lovable. Nothing runs it every morning.
- Side path results aren't saved, so nobody knows when they last passed.
- Some side paths use old rules:
  - `piesa-fixes` still types a name and ticks "over 18", and expects fixes on the install invoice.
  - `m42-comms-lock` expects customer messages to be off. They're on now.
- Several processes aren't tested at all (list B below).

## Part 1 — what the morning run covers

### A. Bring existing paths up to Jo's current rules

The main path (steps 1–10) passes today. All 22 side paths must match the rules as of 31 Oct:
- Owner accepts with two ticks and "Accept and pay $349". No typed name, no over-18 tick. Install consent is signed when the install day is booked; the rebate (VEEC) form comes after install.
- Payment order: $349 before the safety check → fixes paid in full before the fixes day is confirmed → 10% deposit before the install day is booked → balance on install day.
- Fixes and repeat safety checks each get their own Xero invoice. The install invoice keeps the $349 PIESA and $349 AP fee.
- Payment statement wording (version `steps-2026-10-29b`): "My install invoice is {total} inc GST, and there is no card fee." and fixes "on their own invoice".
- Installer "Owner accepted" email only after the $349 is paid.
- Price label "Your estimated quote based on what you've told us"; "You pay about" never appears. No calculator link and no HIV phone number in owner emails.
- 30-day install clock runs from the safety check date, even when fixes are needed.
- Electrician with a missing or expired licence can't be approved (no override).
- R6.0 is $33/m². No PIISA training asked for.
- Safety check offers go one electrician at a time, nearest first, 24 hours each. The installer's own electrician goes first, on HIV leads too.
- Save my spot tapped twice → one spot, one message (the duplicate guard).
- Office screens use the new Jobs pages: Our jobs, Installer jobs, Closed jobs. "Added by installers" is now "Installer jobs".

### B. New paths to add

Already partly covered by a side path → only the missing checks are added.

1. **Installer's own job.** Covered: installer pay waits until the owner has paid in full (`m24`). Missing: Add a job required fields; door-knocked/cold-called refused; another installer's open address refused; installer picks the Ready Check time and types the price; electrician choice (own at agreed rate, or HIV's $349); the job shows in Installer jobs; one-way "use HIV's electrician" switch.
2. **Crew and Lead.** All missing: one picker on the Job page; Lead only from the Team list; Crew can do Ready Checks but not be install Lead; "Who's on the crew today?"; SWMS signed on the Lead's phone and re-signed when house facts change.
3. **Electrician offers.** All missing: one at a time, nearest first, 24 hours each, back to the office after 2 misses, installer's own electrician first.
4. **Quote expiry.** All missing: 14 days not accepted → job closed, installer cancel email, one "Your quote has expired" email with "Send me a new quote", re-price, office presses Send.
5. **Emails tab.** All missing: owner email lands in Emails; reply from info@ (TEST: Jo's test inbox); shows Sent/Delivered/Bounced/Not sent; filed on the job; no-job email gets the homeowner-page reply. AI replies stay drafts while auto-send is off.
6. **Opt out.** Covered: consent withdrawn blocks contact (`m43`). Missing: unsubscribe or STOP → job cancelled "Opted out (unsubscribed)".
7. **Trade sign-ups.** Covered: expired trade papers (`p4`). Missing: missing insurance or licence blocks approval; welcome email "We'll invite you to Mitti"; worker signs the 6 declarations before jobs.
8. **Timing rules.** Covered: 30-day lapse (`p5`), Ready Check 24h/48h (`p6`). Missing: Save my spot 24-hour reminder; automatic texts held 8pm–7am, skipped if no longer true; 2pm-day-before crew email.
9. **Money edge cases.** Covered: repeat safety check and who pays (`m158-*`), payment gates (`m8`, `m10`, `m11`), reversed payment (`p3`). Missing: no cancel on My job after $349; $100 fixes markup on HIV jobs only; card plus same-amount Xero payment counts once.
10. **Owner messages.** Covered: quote more than 15% off the estimate is held (`m7`). Missing: sign-in code text; time-change request gets the right rebooking link; "if needed: up to" removal line.
11. **Area batches (Activity 48 batch 2, new since 29 Oct).** All missing: suggested batch; office taps Send; owner quick taps; day 2 reminder, day 3 close; office taps Send to installer; installer run page; owner confirms a time.

Each path: fresh TEST job, screens of each person at 390px and 1280px, pass/fail per check, TEST data archived after. Time rules use the test clock, not real waiting. A rule not built yet shows as "not built yet", not "broken".

## Part 2 — how it runs and what Jo sees

- **New scheduled task "HIV 4:30am journey test"** (about 4:30am Sydney — set to 4:13am so it's done before the 6am report starts at 5:54am): asks Lovable to run the main journey and every path, TEST only, waits for it, and checks one `journey_runs` row per path was saved.
- **Safety:** TEST jobs only. Nothing goes to a real person, no real money, no real Xero books, no real Mitti. The test never changes any switch or setting, including "Pause all trade messages" (`trade_messages_paused`, on now) and AI auto-send (off). It never touches the DEMO jobs HV-3600 and HV-3601 or any real job.
- **6am report** (the existing scheduled task "HIV 6am portal check", runs 5:54am Sydney): adds a "Test run" part — "All paths passed", or for each failure: which person, which step, what went wrong in plain words, and the fix to send Lovable. No run → "Test didn't run" and why if known.
- **No automatic fixes.** Fixes go through Jo's normal plan-and-approve process.
- **Keeping it current:** any change to a portal rule updates its test in the same pull request (rule added to `AGENTS.md`).

## Not included

- No new test mode — the existing TEST safety is used.
- No changes to real jobs, switches or how the portal works for real customers.

## Done when

- The full run (main path + all paths) passes, or shows only "not built yet", on the test copy and on the live portal's TEST jobs.
- The morning task runs on its own 3 mornings in a row and the 6am report shows the result each day.
- Merged through the coordinating chat only.

## Questions for Jo

1. The TEST office login can't open the Emails tab, Settings or trade sign-ups. For those paths, check the saved records only? Or let the TEST office open those pages (a portal change)?
2. "Pause all trade messages" is on. While it's on, should held trade texts count as a pass ("held, paused")? The test won't touch the switch.
3. `m42-comms-lock` was written when customer messages were off. Drop it, or change it to check that a TEST job still can't reach a real person?
4. Your 6am report still looks for "Added by installers". That list is now "Installer jobs". Fix that line too?

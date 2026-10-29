# Daily full journey test — design

Date: 29 Oct 2026 · Owner: Jo · Status: waiting for Jo's approval

## What Jo wants

Every morning, a TEST job goes through every process in the portal as every person — owner, installer boss, Lead, Crew, electrician and office — and Jo's 6am report says what broke. Jo does no testing by hand.

## What already exists (don't rebuild)

- `bun run journey` (`scripts/journey.ts`, `src/lib/journey.server.ts`): walks a fresh qa_test job through 10 steps, takes screens at 390px and 1280px, stores the result in `journey_runs`, archives the TEST data.
- 23 side paths via `--branch` (`src/lib/journey-branches.server.ts`: p1–p8, m7–m158).
- TEST safety is already in place: qa_test jobs use the Stripe test key, the Xero Demo Company, the Mitti simulator, TEST trades only; owner emails go to Jo's test inbox; texts only through the test sender to Jo's numbers; the run refuses any real Mitti call and checks nothing left the allowlist.

## The problem today

- It only runs when someone asks Lovable to run it. Last run: 27 Oct 2026.
- It has never passed end to end. Last failures were at step 7 (install booking/consent/deposit), largely because Jo's rules changed after it was written.
- It only covers HIV website leads. Several processes are not tested at all.

## Part 1 — what the morning run covers

### A. Bring existing paths up to Jo's current rules

Main path (steps 1–10) and all 23 side paths must match the rules as of 29 Oct 2026, including:
- Owner accepts by ticking and tapping Accept (no name, no over-18 tick); no rebate forms signed at acceptance. Install consent signed when the install day is booked; rebate (VEEC) form after install.
- Payment order: $349 before the safety check → all fixes paid before the fixes day is confirmed → 10% deposit (card, bank transfer or PayID) before the install date is booked → balance on install day (bank transfer/PayID).
- Fixes and repeat safety checks each get their own Xero invoice ("Home Insulation Victoria HV-1234 fixes"). Install invoice keeps the $349 PIESA and $349 AP fee.
- Installer "Owner accepted" email only after the $349 is paid.
- Price label "Your estimated quote based on what you've told us"; "You pay about" never appears.
- 30-day install clock runs from the safety check date, even when fixes are needed.

### B. New paths to add

1. **Installer's own job:** Add a job (name, mobile, email, address required); door-knocked/cold-called lead blocked; another installer's open address refused; installer picks the Ready Check day/time; installer types the price; electrician chosen at Add a job (own onboarded electrician at agreed rate, or HIV's $349); job shows in "Added by installers"; installer pay waits until the owner has paid in full; installer's one-way "use HIV's electrician ($349)" switch on a not-onboarded electrician.
2. **Crew and Lead:** boss picks crew and Lead in one picker on the Job page; Lead must come from the Team list; only Leads can be install Lead; Crew can do Ready Checks; Today's job shows "Who's on the crew today?".
3. **Electrician offers:** one electrician at a time, nearest first, 24 hours each, back to the office after 2 misses; on installers' own jobs their chosen electrician first.
4. **Quote expiry:** quote not accepted in 14 days → job closes, installer gets the normal cancel email, owner gets one "Your quote has expired" email with "Send me a new quote"; re-price (HIV re-prices on HIV leads, installer on installer leads); office presses Send.
5. **Emails tab:** owner email lands in Emails; reply goes from info@ (TEST: to Jo's test inbox), shows Sent/Delivered/Bounced/Not sent, is filed on the job and leaves the Emails tab; email from someone with no job gets the homeowner-page reply.
6. **Opt out:** owner unsubscribes or texts STOP → job cancelled "Opted out (unsubscribed)".
7. **Trade sign-ups:** installer and electrician onboarding; missing insurance or missing/expired electrical licence blocks approval; welcome email on approval with "We'll invite you to Mitti"; worker added by the boss signs the 6 worker declarations before being sent to jobs.
8. **Timing rules:** Save my spot 24-hour reminder text (name, total cost, rebate, link saves the spot); automatic texts held 8pm–7am go at 7am, skipped if no longer true; 2pm-day-before email to the installer's office when no crew is picked; 30-day clock and lapse needs a fresh Mitti form.
9. **Money edge cases:** owner can't cancel from My job after paying $349; reopened job that reached the electrical stage needs a new PIESA and the owner pays again only if a check was actually done (or the earlier payment was refunded); $100 markup on fixes only on HIV website jobs; card payment plus same-amount Xero payment with no Stripe number counts once.
10. **Owner messages:** sign-in code text; time-change request gets the right PIESA or install rebooking link; "if needed: up to" removal line when existing insulation is reported; quote more than 15% off the estimate is held for the office, not auto-sent.

Each path: fresh qa_test job, screens of each affected person at 390px and 1280px, pass/fail per check, TEST data archived after. Time-based rules use the test clock, not real waiting.

## Part 2 — how it runs and what Jo sees

- **Scheduled task "HIV 4:30am journey test"** (about 4:30am Sydney, every day): sends one message to the Lovable agent to run the main journey and every path, TEST only, then waits for it and records the run in `journey_runs` (one row per path).
- **Safety:** each path stops itself if anything would reach a real person, a real payment, real Xero books or real Mitti (existing guards). The scheduled task never changes settings, switches or real jobs.
- **6am report** (existing "HIV 6am portal check"): reads today's `journey_runs` and adds a "Test run" section — "All paths passed", or for each failure: which person, which step, what went wrong in plain words, and the fix to send Lovable. If no run happened today, it says "Test didn't run" and why if known.
- **No automatic fixes.** Fixes go through Jo's normal plan-and-approve process.
- **Keeping it current:** any change to a portal rule updates the matching test in the same pull request. Add this rule to the root `AGENTS.md`.

## Not included

- No new test mode — the existing qa_test safety is used.
- No changes to real jobs, live switches or how the portal behaves for real customers.

## Done when

- The full run (main path + all paths) passes on the test copy and on the live portal's TEST jobs.
- The 4:30am task runs on its own for 3 mornings in a row and the 6am report shows the result each day.
- Merged through the coordinating chat only, as with other portal work.

# Full-journey test (repeatable, TEST data only)

## What Jo gets
- One command that runs the whole customer → office → installer → owner → electrician → install → AP → payout journey in a real browser, at phone (390px) and desktop (1280px) width.
- A screenshot folder and a pass/fail report for each of the 10 steps, after every run.
- A clear **"DON'T PUBLISH"** result, listing what broke, if any step fails.
- "Daily check: passed / failed (step N)" on office Today.
- Proof it's stable: three runs in a row, each reported.

## Two limits that change how this works (please confirm)
1. **The daily check can't drive a browser on the live site.** The site's server can't open a browser. So the daily check runs the same journey through the portal's own server steps, with the same checks and the same safety rules, but without screenshots. The browser version with screenshots runs from here, when you ask for it and before every publish.
2. **"Before every publish" is something I do, not a lock on the button.** Lovable has no hook that stops the Publish button. Whenever you ask me to publish, I run the journey first, and I won't publish while it shows DON'T PUBLISH. Office Today also shows the latest result, so a failed check is visible to anyone who publishes.

## The journey (each step = one pass/fail line)
1. **Public calculator:** TEST address, 120 m², no insulation, register. Check the price uses whole VEECs ($30/m², $349 PIESA, $349 AP fee, $70 per whole VEEC, $200 minimum).
2. **Owner email links:** Save my spot, then a double tap; the owner calculator; My job. Check the stage is "Spot saved" and there is still one job.
3. **Office:** the job appears in Hot leads / Spot saved, then gets offered to the TEST installer.
4. **TEST installer:** takes the Ready Check offer and does the Ready Check. The Mitti form is simulated where no template is set. The quote is created with the correct maths.
5. **Owner:** accepts the quote and does the paperwork with the 6-digit code. The code is read from the test record, never sent to a real phone.
6. **TEST electrician:** takes the safety check offer and completes it. Run A: all clear. Run B: fixes needed, then the fixes are completed. The certificate is uploaded.
7. **Installer:** books the install. Bookings outside the PIESA 30-day window are refused and the check confirms that. Then the install day and evidence upload.
8. **Office:** AP sign-off. The payout shows "Coming", due 7 days later. Payment is simulated; no money moves.
9. **Who can see what (checked throughout):**
   - The electrician never sees prices.
   - A removed worker and a reassigned trade can't see owner details.
   - A worker can't see Money.
10. **Nothing sent outside the allowlist:** every message the run queued or sent goes only to Jo's allowlist or stays queued.

## Safety rules
- Every run makes fresh data marked TEST (Test Centre jobs, `@hivic-test.example` trade accounts, an owner on Jo's allowlist). The run checks that before every step and stops if anything looks real.
- The run never reads, edits or offers real jobs or real partners.
- **Clean-up after each run:**
  - Test jobs are archived the Test Centre way, so they stay out of the pipeline and history isn't deleted.
  - Throwaway sign-ins are switched off.
  - Uploaded test files are removed.
- Real sending stays off. Nothing is published.

## Technical section
- `e2e/journey/` — Playwright (Python) runner: `bun run journey` (wraps `python3 e2e/journey/run.py --widths 390,1280`). Output goes to `/mnt/documents/journey/<timestamp>/`: `report.md`, `report.json` and step screenshots.
- `src/lib/journey.core.ts` — pure step list, expected maths and the visibility rules, shared by the browser runner and the server runner. Tested with `bun test`.
- `src/lib/journey.server.ts` — server-side runner (same steps, using the existing guarded functions, `source='qa_test'`), plus seeding and clean-up through the existing Test Centre archive.
- `src/routes/api/public/hooks/daily-journey.ts` — POST protected by a new server-only secret `JOURNEY_CRON_SECRET` (generated, never shown). Runs the server journey and stores the result. Schedule: one daily call (once a day; low cost).
- New table `journey_runs` (admin-only read; id, started/finished, mode browser|server, passed, failing_step, steps jsonb). Proven on the practice database first with an undo file.
- Browser runs also write to `journey_runs`, so Today shows the latest result of either kind.
- Office Today card: "Daily check: passed / failed — step N: reason", linking to the run.
- TEST sign-in uses the existing `/qa-access` magic-link route for TEST accounts only.
- `AGENTS.md`: one rule — release readiness = the latest journey run passed; the runner touches only `qa_test` and TEST-marked records.

## Not included
- Real phone SMS (Twilio still blocked), real Xero calls and real Mitti forms; these are simulated and labelled as simulated in the report.

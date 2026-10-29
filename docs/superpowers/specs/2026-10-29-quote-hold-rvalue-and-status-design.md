# Installer job path: Ready Check to quote — 17 fixes

Date: 29 Oct 2026. Scope approved by Jo in chat (all 17). This spec is for her sign-off.

Found while checking why HV-3519's quote never went out. Covers the path: Add a job → Mitti Ready Check →
Complete → installer price → quote drafted / held / sent → what the office and installer see.

One rule runs through all of it: **when something is wrong or unclear, hold for the office and say why.**
Never complete, quote or send on a guess.

## A. Ready Check form → Complete

1. **Failed Ready Check never quotes.** If the outcome is "No – Ready Check failed", the job does not complete and
   no quote is drafted or sent. What happens depends on the fail reason (Jo, 29 Oct):

   | Fail reason | Job | Owner email (HIV leads only) |
   |---|---|---|
   | Existing insulation is R2.0 or above | Cancelled · Not eligible | "Not eligible" (O6) |
   | Ceiling or roof built or replaced in the last 5 years | Cancelled · Not eligible | "Not eligible" (O6) |
   | No safe access to the ceiling | Cancelled · No safe access | "Not eligible" (O6) |
   | Homeowner does not want to proceed | Cancelled · Owner declined | "Job cancelled" (O69) |
   | Homeowner has not agreed to be contacted / Other | Held for the office with the installer's note | none |

   - O6 reason lines, for Jo to approve at build:
     "At the Ready Check, the installer found the insulation already in your ceiling is R2.0 or above." /
     "…found your ceiling or roof was built or replaced in the last 5 years." /
     "…found there's no safe way into your ceiling space."
   - Each email is sent once per job through the existing guarded senders and per-job keys; the 8pm rule applies.
   - On an installer's own customer, no HIV email: the installer tells the owner (Jo's earlier rule).
   - Cancels go through the existing guarded full cancel (releases any bookings; nothing is charged).
   - `mitti-complete.core.ts` `completionPlan` returns hold or cancel by fail reason.
2. **Bad area or access answers hold the job.** A missing or invalid area size, or an access answer the portal
   can't read, holds the job with the reason listed. The job never completes on an old area.
   These do NOT hold (Jo, 29 Oct):
   - R-values that differ between areas, when every area is below R2.0 (the lowest is recorded).
   - Mixed insulation types (batts + loose fill): removal is $15/m² for both.
   - Hazard ticked with no photo: the photo is already required in Mitti.
   - Pass the area/access issues from `parseAudit` into `completionPlan`; hold on those only.
3. **"Not sure" is removed from the form.** "What is required for the existing insulation?" offers only Remove or
   Top up; the installer onsite decides. (Jo, 29 Oct: real problems like asbestos or vermin go in the "any issues?"
   question with a photo.) Older forms that already say "Not sure" are held for the office, never turned into
   "no removal".
   - `ready-check-lean.core.ts:129` `EXISTING_ACTION_OPTIONS`, `mitti-forms.core.ts:147`; update the live Mitti form.
   - `mitti-complete.core.ts:27` / `mitti.core.ts:440`: no automatic "no removal" when any area says "Not sure".
4. **Before video needs the video, and can be caught up at install.** Only the "Slow 360° video" question counts
   as the before video. The overview photo no longer counts, and a photo in the video question doesn't either.
   A missing before video does NOT hold the quote (Jo, 29 Oct). Instead, the install-day Mitti form gets a
   "Before video of this area (film before you start)" question at the top, only for areas missing one, and it
   must be filmed before work starts (timing checked like the ruler photos). The install still can't complete
   without a before video for every area.
   - `mitti.core.ts:450`, `ready-check-lean.core.ts:100`, `responseValue` (`mitti.core.ts:86`).
   - Install-day form builder (`mitti-forms.core.ts`) and `install-evidence.core.ts:434` (accept the install-day
     before video, filmed before work start).
5. **Edits after Complete are checked again.** If the installer edits a completed form, the eligibility check runs
   again (e.g. a change to "Above R2.0" or "No safe access" holds the job), and answers filled at Complete
   (like "no removal") are kept, not wiped.
   - `mitti-completed-refresh.core.ts:13`; run eligibility before the "already" return in `completionPlan`.
6. **Cleared answers are cleared.** When an update comes from Mitti, all six measure fields are written, blanks
   included, so old values (e.g. a removal m² after switching to "Top up") don't stay.
   - `scope.core.ts:132` `planMeasurementUpdate`, Mitti path only.
7. **"Under-insulated" on older forms counts as insulation present.**
   - `mitti.core.ts:438/470/476`: match the normalised text ("under insulated").
8. **"Below R2.0" counts as an R-value answer.** When every insulated area says "Below R2.0", the R-value is
   answered. No number is made up; `existing_r_value` stays empty.
   - `scope.core.ts` `missingMeasureFields` takes the areas (`zones`); callers pass `zones`.

## B. Electrician and price

9. **One electrician choice.** The job's electrician field matches the choice made at Add a job
   (installer's own → `installer_own`, HIV's → `hivic_organise`). Every screen and price reads the same answer.
   - `job-electrician.server.ts` `recordJobElectricianChoice` sets the job field; `add-job-flow.tsx:74`.
10. **"Use HIV's electrician ($349)" button.** On the installer's job page, while the quote is held because their
   electrician isn't onboarded, the installer's boss (only the boss — it shows a rate) sees a one-way button. Pressing it switches to HIV's electrician
   ($349), records the choice, and redrafts the quote straight away. (Decision 28 Oct.)
   - `job-electrician.server.ts` `switchJobToHivic`, `job-intake.tsx:162`.
11. **Price saved on the job.** When the boss enters the price, it is also saved on the job (price and what's
   included), so every screen shows it.
   - `installer-price-set.server.ts:77`.
12. **Price-link text retried if blocked.** The "enter your price" text only counts as sent once it actually sent.
   If blocked (e.g. after 8pm), it is tried again later. Still only one text per job.
   - `boss-price-link.server.ts:37`.

## C. What people see

13. **No "Owner to accept quote" before a quote is sent.** The job stays at "Ready Check complete" until the owner's
   quote is actually sent; only then does it move to the quote stage.
   - `mitti-complete.server.ts:54-61`: stop the early move; the send step already moves it
     (`office-quote-review.server.ts:59`, auto-send).
   - Data fix: HV-3117 and HV-3497 (no quote sent) go back to "Ready Check complete". Nothing is sent.
14. **Held means held.** When a quote is held, the job's next step reads `Quote on hold · <reason>` and the office
   Quote card reads `Held · <reason>`, even if no quote was drafted. "Quote being prepared" is never written over it.
   The history line "quote drafted for office check" becomes "Ready Check basics in".
   - `ready-check-basics.server.ts:48/55-61`, `office-job-page.server.ts:107`, `installer-quote.server.ts:124`,
     `auto-quote-send.server.ts:66`.
15. **Installer sees why.** The installer's job card shows the hold in plain words, e.g.
   "Quote on hold · your electrician Bright spark needs to finish signing up with HIV".
   - `installer-quote-status.server.ts:82`: fall back to the latest hold event when there's no quote.
16. **Office "Quote held" item clears** once a quote is drafted or sent (today nothing clears it).
   - `ready-check-chase.core.ts:71`: add `installer_quote_drafted` (and sent events) to the clear list.
17. **No repeated history lines.** The electrician and product "recorded" lines are saved once per change, not every
   sync (HV-3519 has about 20 of each).
   - `insulation-product.server.ts:22`, `usual-electrician.server.ts:52`: compare with keys sorted at every level.

## Not in scope
- No change to prices, the $349 amounts, eligibility rules or who can do what.
- No messages to owners from these fixes, except the cancel emails in fix 1. Held jobs stay held until their reason is sorted.
- HV-3519, HV-3497 (Silver Spirit Investments), HV-3117 and HV-3193 (Reinsulate) stay on hold until their
  electrician onboards or the installer presses the new button.

## Tests
One or more tests per fix, in the existing test files for each area, plus:
- HV-3519's real form answers: completes (R-value answered), then held only for "electrician not onboarded",
  with the right wording for office and installer.
- Each fail reason in the fix 1 table: right job result and email on an HIV lead; same result with no email on an installer's own customer; email never sent twice.
- Other failed outcome, "Not sure" (old form), invalid area, edit to "Above R2.0" after Complete: each held, nothing sent.
- Photo-only before video: quote still goes; install-day form asks for that area's before video only; a video filmed after work start doesn't count.
- Differing R-values all below R2.0, and mixed insulation types: not held.
- Button pressed: choice recorded once, quote redrafted, hold clears.
- Blocked price-link text: retried later, never sent twice.
- Existing tests keep passing. Then a test-job run in the Lovable sandbox (`bun run journey`, `bun run portal-qa`)
  before publishing.

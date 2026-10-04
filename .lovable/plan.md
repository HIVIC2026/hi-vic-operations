# Portal audit against Operating Model v2 (read-only)

Nothing was changed. Checks used: code reading, the whole test suite run one file at a time, and read-only database queries.

## 1. End-to-end walk

**Office-sourced job (from the website)**
1. Enquiry from Base44, then the Gate 1 result: works. It lands in New Enquiry, and the early check is information only.
2. Estimate, then Ready Check request with 3 to 5 owner times: works. It's built into the estimate page, and the "price seen" rule applies only when an estimate exists.
3. Ready Check offers (top 3, 4 business hours), first tap books: works. The trade's "None of these work, arrange a time" button is the fallback, as agreed.
4. Measure-up and PIESA times, then electrician matching and booking: works. Price never counts.
5. **Pass branch:** quote (expires after 14 days, nudges on day 3 and day 10), then acceptance, then the payment gate, then install days: works. The payment gate is off, so this step stays blocked. That is correct while it's off.
6. **Rectification branch:** windows, then office review, then owner approves and picks a time: works. Nudges at 24h and day 3, needs-attention on day 5. A cancellation goes to the office, which you accepted.
7. Expected install week (office note), install days, 30-day clock, ESC task, noon pre-start check, install evidence: works.
8. AP queue approval, one job at a time, then VEEC submitted, then Complete only when Approved: works. No path approves automatically.

**Installer-supplied job**
- Intake, preferred electrician offered first (only on these jobs), and matching: works.
- **Dead end:** at payment these jobs show "Commercial setup required" until the commercial model for that installer is set. This is intended, but no installer-supplied job can reach booking yet.
- **Not clear:** whether these jobs still need a Ready Check when the installer has already supplied a measure-up. The code allows both. Jo should confirm.

## 2. Mismatches with the decisions
1. **Weekly capacity (jobs)** still blocks matching ("Partner is at capacity"). It also shows in business settings and is filled from onboarding. To be removed.
2. **Property managers** still appear: a Property Managers tab (the default on the office Partners page), a property manager enquiry type, and a property manager role in the role list. These conflict with "no property managers".
3. **Estimate page wording** still says "An installer from our panel will contact you to arrange a time". It should say the owner picks times.
4. **Aerial area:** aerial and solar footprint figures (tier E) are left out of the estimate price range. This conflicts with the earlier decision to use aerial for screening and the price range, but never as evidence. Aerial is correctly never used as evidence.
5. **Auto-progression and Xero:** the automatic progression code now links, through the visit-change code, to the Xero file. The link is only for clearing the install due date, and sending stays behind its switch, but it breaks the rule that auto-progression never touches Xero. Two tests catch this.

No old 50% deposit rule, no automatic approval, and no "accept then arrange" default were found.

## 3. Gaps (in the model, not built)
- **The office to-do list no longer shows submitted trade onboarding applications** (a test also flags this). The office may not notice new applications. Needs a check.
- **Rectification cancellation** goes to the office instead of offering new times (accepted for now).
- **Trade payouts:** blocked until Xero is connected (agreed).
- **Approved wording** for messages (reminders, new times, brief) doesn't exist yet. Everything is queued without approved text.

## 4. Tests (126 files, one at a time)
121 files passed fully. 5 files have 9 failures:
- `comms`: 2 failures. **Real.** This is the Xero link from mismatch 5.
- `onboarding-security`: 1 failure. **Probably real.** The to-do list no longer filters or shows submitted applications (see Gaps).
- `customer-quote-system`: 2 failures. **Out of date.** They check older quote and email layout markers. Jo's approved likely email is still the same.
- `estimate`: 1 failure. **Out of date.** The office job page layout changed on 2 Oct (known).
- `http-abort`: 1 failure. **Out of date wording.** The protection is still there, written differently. Needs a test update only.

## 5. Risks when switches go on
- **349 live website jobs** are waiting at "Ready Check ready to schedule". None have owner times or offers. When sending goes on, these owners need a message asking them to pick times, or they will sit there. This needs a decision before launch.
- **Sending on:** every queued message has no approved wording. Sending stays off until each wording is approved.
- **Payment gate on:** deposit levels (10% / 5%) are still waiting on legal advice. Installer-supplied jobs stay blocked until each installer's commercial model is set.
- **Xero due dates:** install-date changes only mark "update needed" until the Xero date-update switch is on. Check this before connecting Xero.
- **Certifications and PIESA rates:** with none recorded, every new offer goes to needs-attention.

## 6. Fix list (smallest safe steps, in order)
1. Remove **Weekly capacity (jobs)**: hide the field, ignore it on save, stop the "at capacity" block in matching, and stop copying it from onboarding. Keep the column.
2. Cut the auto-progression link to Xero: move the "clear install due date" flag into a non-Xero module. The two `comms` tests pass again.
3. Restore submitted trade applications (test ones excluded) to the office to-do list, after confirming they're missing.
4. Fix the estimate-page sentence to the owner-picks-times wording.
5. Remove property managers from the office Partners page and partner intake, and hide the role from role assignment. Keep the data.
6. Update the 3 out-of-date tests (`customer-quote-system`, `estimate`, `http-abort`).
7. Jo to decide:
   - Aerial in the price range: yes or no?
   - Do installer-supplied jobs with a supplied measure-up still need a Ready Check?
   - How should the 349 waiting jobs be asked to pick times at launch?
8. Later, blocked on Jo: approved message wording, the commercial model per installer, deposit levels and legal advice, then the switches.

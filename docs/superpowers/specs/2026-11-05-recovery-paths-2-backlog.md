# Recovery paths, part 2: findings waiting for their own design

Jo, 5 Nov 2026: these go in a second plan after the 20-step recovery plan. Each one still needs a design, spec and plan approved by Jo before any build.

1. **PIESA electrician + time change (installer portal, current booking form).** The form saves the new electrician first, then the time. If the time save fails, electrician B ends up on the old appointment and the installer only sees "Time could not be saved". Assigning can also send the electrician's job-link text and move the Mitti PIESA form. Reviewer's fix: save the person and time together, and only send the text / move the form once both are confirmed. Traced in code, and tested with a simulated booking failure. No live job checked yet.

## New requests from Jo (5 Nov 2026, 5:09pm, from Deep's feedback). These are new features: brainstorm → spec → plan first
2. **Installer sees quote sent + follow-ups.** The installer can see when his quote goes to the customer, plus the follow-ups and everything after.
3. **Discount on Deep's jobs.** Deep wants to offer the owner a discount. Brainstorm in progress.
4. **Change electrician easily from the job.** The installer allocates one, then picks another. This overlaps finding 1 (electrician + time saved together).
5. **Staff must not see Deep's price.** Deep thinks his staff can see the price he enters. Check where staff could see it.

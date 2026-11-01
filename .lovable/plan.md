# HV-3682: why no PIESA offer went out (read-only findings)

1. **Allocation tick at 17:45 / 18:00:** I couldn't confirm it. I'm not allowed to read the timer history, and the server log has no lines at all for the last hour. That's expected here: when a job isn't ready, the tick skips it quietly ("job_not_ready") and logs nothing. No offer or hand-back event was written for HV-3682.

2. **Automatic offer decision:** it stops before looking at any electricians, with the reason **job_not_ready**. The job is still at "quote accepted", so the tick first checks whether it can move into the PIESA stage. That check fails (see 3), so no candidates are ranked and nothing is sent.
   Candidates for postcode 3141 (none were actually ranked). I didn't work out distances, so I can't give km:
   - Tom Lowe Electrical Services: eligible. Covers 3141, licence/REC OK, 1 approved worker, not paused, PIESA rate on file.
   - All Powered Electrical: not eligible. No current licence/REC on file.
   - Western Suburbs Electrical: not eligible. No current licence/REC on file.
   - Spark Right Electrical: not eligible. Not an approved, active REC.
   - ORLANDO POWERED: not eligible. Not accepting new jobs.

3. **Blockers:**
   - The PIESA request check is clear (nothing blocking there).
   - The check for moving into the PIESA stage fails on **Owner paperwork B**:
     - "Customer agreement + consumer rights was signed on DRAFT wording — real jobs need Jo-approved wording."
     - "The agreement not signed yet."
     - "Your rebate (VEEC assignment) not signed yet."
     - "Payment not signed yet."
   - Likely cause (not confirmed): today's new payment wording version was never marked approved. The rule is that it doesn't approve itself.

4. **Tom Lowe Electrical:** yes on both. Tom is an approved worker, and the business is offerable for 3141 with no blocker. Nothing is wrong with the electrician.

5. **Smallest safe fix (to describe only, not done):**
   - First confirm which wording version the owner signed and whether that version is approved.
   - Then Jo picks one:
     - (a) Approve the current owner paperwork wording through the normal admin approval, then have the owner sign the remaining Paperwork B items.
     - (b) Treat this as a live test only and use an admin override with a reason, which leaves a permanent audit entry.
   - After that, the next 15-minute tick would offer the job to Tom Lowe Electrical automatically.
   - No code change is needed. Office could also use "Choose electrician", but the same paperwork check would still block it.

No changes were made.

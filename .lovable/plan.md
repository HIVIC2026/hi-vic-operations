# Send Save my spot to the new matching leads

## What happens
1. Sign in with the approved TEST office account and load the existing likely-eligible list. Only read the list at this step.
2. Pick only the leads that have **not** had a Save my spot email yet and that match Jo's locked rule (8 Oct):
   - no insulation
   - passes the eligibility check
   - ceiling size entered
3. Leave out dummy/test addresses, anyone without a usable estimate, anyone already sent, and anyone with unclear details. List each excluded lead and the reason.
4. Show the count, then send using the existing approved email and the existing guarded send button, in batches of up to 10. The existing duplicate protection makes sure no one gets it twice.
5. Report back: how many were sent, how many failed and why, and how many were left out and why.

## Not included
- No change to the email wording, the template or any settings.
- No 150 m² "no ceiling size" emails. Those leads are left out.
- Nothing is published.

## Technical notes
- Read: `getHotLeads({ list: "likely" })`. Send: `sendHotLeadsBatch({ jobIds })` (admin only, at most 10 per call). Both go through the existing sending switch and the existing send records.
- If real sending is switched off (`realSendingOn = false`), stop and report it. The switch is not turned on.

# Step 4: Job becomes Complete only when the VEEC is Approved

## 1. What changes
- A job moves to **Complete** only when the office sets its VEEC to **Approved** (registered).
- **Submitted** or **Registry query**: the job stays in "Ready for VEEC". No stage change.
- **Rejected**: the job stays open in "Ready for VEEC" and appears on the "Needs Home Insulation Victoria" list as "VEEC rejected". The list already shows rejected VEECs, so I'll check that rather than build it again.
- Nothing else changes: the step 3 query, draft, reply-sent and overdue features, and all switches, stay as they are.

## 2. Existing parts it touches
- The office "Save VEEC" action: one line changes, so only Approved finishes the job. The message becomes "VEEC registered – job complete".
- The office job page's VEEC card: the "Submitted" hint changes to say the job stays open until Approved, if a hint is shown there.
- Tests: new ones check that Submitted, Query and Rejected keep the job open, Approved completes it, and Rejected appears on the needs-attention list.
- No database change or migration.

## 3. Jobs already marked Complete after a Submitted VEEC
- The live database has only one: **HV-1001**, a TEST job (Test Centre). No real job is affected.
- I won't change it. If you want it, I can move HV-1001 back to "Ready for VEEC" as a separate step, with an audit note, and only after you say yes.
- Jobs already Complete stay Complete. If one of them is later set to Approved, nothing changes.

## 4. How to undo
- Restore Submitted in that one line (or roll back to this version in History). There is no database change, so nothing else needs undoing.

## Checks after building (preview only, no publish)
Focused VEEC tests, typecheck, wording scan, build.

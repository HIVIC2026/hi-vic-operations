# Job Timeline and "Who has the ball": plan

## Goal
Anyone who opens any job can see, in seconds:
1. **Who the job is waiting on right now:** Owner, Electrician, Installer or HI VIC, shown as one big coloured badge, plus a plain sentence ("Waiting on Sparky Co to confirm a PIESA date. Asked 2 Oct 9:14am").
2. **The one thing to do next:** a real button (Book Ready Check, Record deposit, Send PIESA copy, Open quote…) that goes straight to the right screen. If the job is with someone else, it offers "Nudge" or "Reassign" instead.
3. **Exactly what has happened:** a clean, dated timeline showing what, when (date and time) and who. For example: "Electrician proposed Tue 6 Oct 8am (2 Oct 9:14am) → Owner accepted (2 Oct 11:02am) → Locked in for Tue 6 Oct 8am → PIESA form prefilled and created → Now waiting on electrician to do the onsite PIESA. Results due 6 Oct 5pm."
4. **Anything late is flagged red** with how late it is, for example "PIESA results 2 days overdue" or "Install date passed with no completion recorded". Late items also go to the To action tab.

## What the worker sees on a job

```text
+--------------------------------------------------------------+
| WITH: ELECTRICIAN  (blue)          Due 6 Oct 5:00pm          |
| Waiting on Sparky Co to submit PIESA results + rectification |
| quote from today's visit.            [Nudge]  [Open PIESA]   |
+--------------------------------------------------------------+
| Gate strip (existing, colours kept)                          |
+--------------------------------------------------------------+
| TIMELINE                         filter: All | Talk | Forms  |
| ● 6 Oct 8:02am  Electrician checked in onsite  - J. Smith    |
| ● 2 Oct 11:02am Owner accepted Tue 6 Oct 8am - locked in     |
|   "Morning suits, dog will be inside" - owner                |
| ● 2 Oct 9:14am  Electrician proposed Tue 6 Oct 8am           |
| ● 1 Oct 4:40pm  PIESA form prefilled and created - system    |
| ...                                                          |
+--------------------------------------------------------------+
```

- The timeline brings together everything the portal already records into one list: stage moves, date proposals and replies, bookings, messages between owner and trades (contact-masked), forms prepared, signed and sent, uploads, payments and approvals.
- Every entry shows the date and time, the person's name and role, and a short plain description. Messages show the words actually said.
- Filters: All, Conversations, Bookings, Forms and documents, Payments.
- Owners see a simpler version with no internal notes. Installers and electricians see only what they're allowed to see today.

## "Who has the ball" rules (one shared rule, never per screen)
Each waiting state has an owner, a sentence and a due time:
- Owner: accept quote, pay deposit, pick a date, sign forms.
- Electrician: reply to the job offer, propose PIESA dates, attend, submit PIESA results **and the rectification quote**, do the rectification.
- Installer: Ready Check or measure-up, confirm the install date, attend, submit PIISA and evidence.
- HI VIC: eligibility review, raise the deposit request, approve the measure-up, AP review, lodge VEECs.
- "Arranging a date": when proposals are going back and forth, the badge reads "Owner and Electrician arranging a date", with the last message from each side.

## Due times and overdue flags
Default timings, all editable on the settings page:
- Trade replies to a date request: warning at 24h, exception at 48h (existing rule).
- PIESA results **and rectification quote**: by 11:59pm on the assessment day.
- Rectification done: by the booked date.
- PIISA and install evidence: by 11:59pm on the install day.
- Owner signing or payment: reminder at 3 days, flag at 7.
- Install date passed with no completion: flagged the next morning.
- PIESA 30-day window: existing rule, shown on the timeline.

## Rectification quote on assessment day
- The electrician's PIESA submission in the portal can't be finished until they either enter the rectification items and prices or tick "No rectification required". This must happen on the assessment day.
- Add clear wording to the electrician onboarding step and the REC agreement: "PIESA results and any rectification quote must be submitted through the HI VIC portal on the day of the assessment." This will be a new agreement version. Electricians who signed the old version keep it on record and are asked to re-accept the new version.
- The installer agreement gets the matching rule for PIISA and evidence on install day.

## Build order
1. Shared "waiting on" rule with tests covering every stage and branch.
2. Timeline data from the existing records, with name, role and time for every entry, and permissions checked per role.
3. New top-of-job panel (with badge, sentence, due time and action button) and the timeline, on the admin, trade and owner job views.
4. Due times, overdue flags and To action entries.
5. Rectification-quote requirement in the PIESA flow, plus the new onboarding and agreement wording.
6. Browser run-through on a test job, from enquiry to install.

## Stays locked
Nothing sends automatically. "Nudge" only prepares a message for staff to review while communications are locked. No official wording is invented: the agreement additions are plain operational clauses for your approval before the new version goes live.

## Technical details
- `waiting.core.ts`: pure `waitingOn(job, facts)` returns `{party, sentence, dueAt, overdue, action:{label, tab|route}}`. It is built on `nextStep()` so there is still only one source of truth, and a mismatch test covers every stage.
- `timeline.functions.ts`: an auth-scoped server function that merges `workflow_events`, `appointment_proposals`, `bookings`, `messages`/`job_communications` (masked), `documents`, `evidence_files`, `invoices` and signature records into `{at, actor{name, role}, kind, title, detail, visibility}`. Owner and trade projections drop internal rows.
- Due-time settings go in `workflow_settings` (migration with columns and defaults). Overdue items come from the same rule into `todo.functions.ts`.
- PIESA completion guard in `stageEntryBlockers`: a rectification decision is required (items priced or explicit none) before `piesa_complete`.
- Agreement text versions bump in `rec-agreement.text.ts` and the installer agreement text. The existing signed-version guard handles re-acceptance.

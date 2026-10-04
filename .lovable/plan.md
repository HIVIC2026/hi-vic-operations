# Step 3 — VEEC Registry query and rejected statuses

## What's there today
- A VEEC lodgement can be: Not submitted, Submitted, Approved or Rejected. "Rejected" already exists and needs a note.
- There is no "Registry query" status yet. The office "needs attention" queue already looks for query and rejected lodgements, so it will pick them up as soon as the status exists.
- Saved today: 453 not submitted and 1 submitted. None are approved or rejected.

## 1. What I would add
**One new status: "Registry query"**
- Can be set from Submitted, the same as Approved or Rejected.
- The office must record what the Registry asked and the date it arrived.
- From a query, the job can go to Submitted (reply sent), Approved or Rejected.

**Draft reply (AI)**
- A "Draft reply" button on the job's VEEC section. The AI writes a draft from the query text and the job's own records (measurements, evidence list, dates).
- The draft is shown for the AP to edit. It is never sent automatically. The portal can't send anything to the Registry, so the AP sends the reply in the Registry's own system, then taps "Mark reply sent" with the date.
- Every draft, edit and "reply sent" is kept in the job history.

**Timer check (uses the step 2 timer)**
- A query with no reply recorded after 3 days is raised in "Needs Home Insulation Victoria" as overdue.
- Rejected lodgements always show there, as they already do.

**On screen**
- The office VEEC section gets the new status, a query box, a draft reply panel and "Mark reply sent".
- Owners and trades see nothing new.

**New fields** (added to the existing VEEC lodgement record, all empty to begin with): query text, query received date, draft reply, reply sent date, who sent it.

## 2. Which existing parts it touches
- The VEEC status list and its allowed changes. The only change is adding "Registry query".
- The office job page's VEEC section.
- The office "needs attention" queue (adds the 3-day overdue label).
- The step 2 timer (adds the 3-day check).

## 3. Nothing removed or renamed
- Not submitted, Submitted, Approved and Rejected stay exactly as they are, with the same meaning and rules.
- No fields are removed or renamed, and the 454 saved lodgements are untouched.
- No sending, Xero, Mitti or payment changes. Nothing is published.

## 4. How to undo
- Turn off the new status and hide the new section on screen. The new fields can stay empty without affecting anything.
- If no job is ever set to "Registry query", the database change can be fully reversed.

## One question for you (not part of this step)
Today, recording a lodgement as Submitted moves the job straight to Complete. The operating model says a job only completes once it's registered. I've left this alone. Tell me if you want it changed as a separate step.

## Technical details
- Additive migration: drop and recreate `veec_lodgements_status_check` with `'query'` added. Add nullable columns `query_text`, `query_received_at`, `reply_draft`, `reply_sent_at`, `reply_sent_by`. Proved on PGlite first, with a rollback file in `docs/pending-migrations/`.
- `veec.core.ts`: add `query` to `VeecStatus` and `ALLOWED` (submitted→query; query→submitted/approved/rejected). Query requires `query_text` (5 or more characters) and a received date. New pure `queryOverdue(receivedAt, replySentAt, now)` with a 3-day threshold.
- `updateVeec` zod enum gets `query`. New admin-only `draftVeecReply` server function using the Lovable AI Gateway; it returns a draft only and is logged. New `markVeecReplySent`, also admin-only and audited.
- Exception queue label "Registry query unanswered 3+ days". The timer's job is only to make sure the queue view is current; no new cron.
- Tests: status transitions, required fields, overdue threshold, admin-only access, and that the draft never changes status.

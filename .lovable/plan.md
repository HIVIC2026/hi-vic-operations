# Step 8: Rectification (Operating Model v2)

## What exists today
- When the PIESA needs rectification, the system lists the items, drafts a rectification quote, and the job moves to "awaiting owner rectification approval".
- The office must review the draft before it can be sent. Items with no agreed rate block sending and show on the needs-attention list.
- The owner approves or declines the quote on their page. Approving records the scope only, with no payment; the lines are folded into the final installation quote. Declining shows on the needs-attention list.
- The rectification visit is then arranged the old way: offer to an electrician, contact details shared, propose and confirm a time, with the 24h reminder and 48h flag.
- The 14-day expiry and the day 3 / day 10 nudges already apply to installation quotes only. Rectification quotes have no timing today.
- The electrician does not give estimated hours or times when submitting the PIESA.

## What changes
1. **Electrician, at PIESA submit (only when rectification is needed):** two short extra questions:
   - estimated hours (number, required)
   - 3–5 windows they can do the work (morning 8–12 or afternoon 12–4, Melbourne time)
   The day rules are the same as the owner's PIESA times (business days, from 2 business days ahead, within 21 days). They aren't asked again later.
2. **Office review:** unchanged. The office sees the hours and the windows next to the draft.
3. **Owner, in one step:** approve the quote and pick one of the electrician's windows. Two permanent records are created: the existing approval record and a separate confirmed booking for that window. Both are saved together or not at all.
4. **"None of these work":** the owner approves the quote and taps this instead. Contact details are shared for the rectification visit only. The old propose/confirm path runs with the 24h reminder and 48h flag.
5. **Rectification quote timing (no 14-day expiry):**
   - The send time is recorded when the office sends the quote.
   - Owner nudges are queued (not sent) at 24 hours and on day 3.
   - On day 5 with no response, the job joins the needs-attention list as "Rectification quote unanswered — 30-day clock at risk".
   - The quote never expires automatically. The existing 15-minute timer runs these checks.
6. **Owner declines:** unchanged. Hard stop and needs-attention.
- A window whose start time has passed can't be picked. If all windows have passed, the owner only sees "None of these work".

## Parts touched
- The electrician's PIESA submit form and the server step that drafts the rectification quote.
- The office rectification review card, which shows the hours and windows.
- The owner's quote panel and the server step for owner approval.
- The quote timing check in the 15-minute timer, extended to rectification quotes with their own rules.
- The needs-attention list (one new entry).
- Tests.

## Database change (practice database first, then apply)
Additive only:
- Rectification estimated hours on the quote.
- Electrician windows saved as time options, reusing the existing appointment times table and tagged "rectification".
- Three empty dates on quotes: 24h nudge, day-3 nudge, day-5 flagged.
- One locked database step that approves and books in one go, so two taps can't double-book.

It will be proven on a practice database first: existing rows unchanged, approve + book is all-or-nothing, a second pick is refused, and undo is clean. It is applied to the real database only after that passes.

## Effect on existing jobs and records
- Only TEST jobs are at rectification today: one at "rectification required" and one at "rectification scheduling", plus 2 accepted rectification quotes. None are real.
- They keep the old path. With no electrician windows, the owner simply sees the normal approve and "None of these work" options.
- No backfill. No records changed. Sending stays off.

## Undo
Roll back to the previous version in History. The new fields can stay empty and unused. Without electrician windows, everything falls back to today's flow.

## Question
- Should the owner's pick also require the window to be at least 24 hours away (like other bookings), or is any future window fine?

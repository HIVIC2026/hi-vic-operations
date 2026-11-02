# Quick taps: email as well as text, and who lets the installer in (2 Nov 2026)

## Why
- Owners only get the "confirm a few quick details" message (and its day-2 reminder) by text. Some owners don't
  see texts, so Jo wants the same message by email too.
- The installer (e.g. Rapid) rings to book the Ready Check, but doesn't know if a tenant will be the one at the
  home. Jo wants that asked in the quick taps.

## What Jo approved (2 Nov 2026)

### Part 1: email + text
- When Jo presses **Send** (Jobs › Choose installer, single job or suggested batch), each owner gets the quick
  taps **text and email at the same time**, both with the same quick taps link.
- If the owner hasn't answered after 2 days, the existing reminder text **and a reminder email** go.
- Email wording (Jo approved, verbatim):
  - First email: subject **"It's almost time for your free Ready Check"**. Body: **"Hi {first name}, great news -
    it's almost time for your free Ready Check! Please confirm a few quick details for your quote."** Then a
    **Confirm my details** button (the quick taps link). Signed **Home Insulation Victoria**.
  - Reminder email: subject **"Just a reminder - confirm your details"**. Body: **"Hi {first name}, just a
    reminder - please confirm a few quick details so we can book your free Ready Check."** Same button, same sign-off.
  - No first name → "Hi there," (same as the quick taps decline emails).
- No email on file → text only (the Send still works).
- Unsubscribed / suppressed / bounced-suppressed → no email (the existing guarded owner email sender decides).
- Email and text are independent: if one fails, the other still goes, and the batch is still sent.
- Nothing goes 8pm–7am: Send is already refused in quiet hours; the reminder email goes on the same sweep tick as
  the reminder text (which already waits for 7am).
- After Send, Choose installer shows the result of the text **and** the email for each job.
- TEST jobs: email goes only to the TEST inbox (existing test-send path), like the TEST text.
- Both emails are added to the Template hub as approved, with the wording above.

### Part 2: who will be at the home
- New quick taps question, asked after "Was your home built, or its ceiling replaced, in the last 5 years?" and
  before "Yes, let's go":
  **"Who will be at the home to let the installer in?"** — **Me** / **My tenant**.
- **My tenant** → asks for the tenant's **name** and **mobile** (both required; mobile must be a valid Australian
  mobile). No tenant email.
- The answer never makes a job fail — it's only for access.
- The installer sees the answer on the job (where they see the owner's name and mobile): "At the home: owner", or
  "At the home: tenant — {name}, {mobile}". The office sees the same on the job page.
- The portal never texts or emails the tenant.
- Owners who answered the quick taps before this change aren't asked again (no answer shown = not asked).

## What does NOT change
- The quick taps text and reminder text wording; the other questions, their order and the decline rules.
- The 14-day no-answer close, the day-3 close, and the rule that Rapid isn't told until Jo sends the job on.
- Automatic emails keep their current sender (not Outlook).

## Design
- `quick-taps-email.core.ts` (new, pure): `renderQuickTapsEmail({ firstName, link, unsubscribeUrl, reminder, test })`
  built like `spot-release-email.core.ts` (MJML kit, unsubscribe footer, plain-text copy).
- `area-batch.server.ts`: new `emailOwner(h, batchId, link, businessId, actorId, step)` next to `textOwner`.
  Real jobs → `sendGuardedOwnerEmail` with purpose `quick_taps:{step}` and key `quick-taps-email:v1:{batch}:{job}:{step}`
  (once only per batch + job + step). TEST → `sendTestEmail`. `sendBatch` calls text and email for each home
  (each in its own try/catch) and returns both results; the day-2 sweep does the same for the reminder.
- `SendBatchResult.texts[]` gains `email: { status, detail }`; `choose-installer.tsx` shows it beside the text result.
- `quick-taps.core.ts`: `QuickTapAnswers.access?: { who: "owner" } | { who: "tenant"; name: string; mobile: string }`;
  new step `access` after `five_years` in `nextTapStep`; copy in `QUICK_TAPS_COPY.access`; `tapOutcome` ignores it.
- `quick-taps.server.ts`: validates and saves `access` with the other answers on the `quick_taps_answered` event.
- Installer + office job views read the latest `quick_taps_answered` access answer and show the line above.
- `my-job.$token.tsx`: the access screen (two big buttons; tenant → name + mobile fields, Next disabled until both are
  valid, with the reason shown).
- Template hub: two new approved owner email templates (quick taps, quick taps reminder).

## Testing
- Unit: renderer — subject, greeting with/without first name, button link, reminder variant, unsubscribe link.
- Unit: `nextTapStep` puts `access` after `five_years`; tenant needs name + valid mobile; `tapOutcome` unchanged by
  the access answer.
- Server: Send emails + texts each home; no email on file → text only, still sent; email failure doesn't stop the
  text or the batch; opted-out owner gets no email; email is once only per batch + step; TEST goes to test inbox.
- Sweep: the day-2 reminder sends the reminder email with the reminder text, never twice.
- Existing quick taps and area batch tests stay green.

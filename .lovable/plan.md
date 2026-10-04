# Step 5: Quote expiry and owner nudges

## 1. What I would add or change
- **Record when a quote is sent.** Right now quotes don't store a "sent" date. I'd add a new empty "sent at" date, filled in when the office (or installer) sends a quote. The 14-day count starts from that date.
- **Expiry after 14 days.** If a sent quote isn't accepted within 14 days, the 15-minute timer marks it "Expired". It doesn't change the job stage, doesn't add it to the Needs Home Insulation Victoria list, and doesn't contact anyone.
- **Expired quotes can't be accepted.** The owner's accept button is replaced with "This quote has expired — please contact us for an updated quote." The server also refuses it, so an old link can't get round this.
- **Nudges on day 3 and day 10.** The timer queues an owner reminder on day 3 and on day 10, using the existing reminder queue. Sending stays off, so they're only queued, like the other reminders. Each nudge happens once per quote. No nudge goes out if the quote has been accepted, declined, replaced or has expired, or if the owner has opted out or not given contact consent.
- **Nudge wording.** Short plain text that I'd draft. You or Jo approve it before sending is ever switched on.

## 2. Existing parts it touches
- The 15-minute timer: adds one more check next to the offer and reminder checks.
- The "send quote" actions (office and installer): they also save the sent date.
- Quote acceptance: adds a "not expired" check.
- The owner quote page: shows the expired message.
- The office job page: shows "Expired on (date)" on the quote.
- The existing reminder queue, consent rules and opt-out rules: reused, not changed.
- Database: one addition only. It adds an "Expired" quote status plus new empty columns for the sent date and nudge dates. Nothing is renamed or deleted. I'd test it on a practice database first.

## 3. Quotes already sent and older than 14 days
- There are none right now. There are 3 sent quotes, all on TEST jobs and all under 14 days old.
- Existing quotes have no sent date, so the timer leaves them alone: they won't expire and won't get nudges. I won't backfill dates or change any existing record unless you ask.

## 4. Fresh quote after expiry
- Yes. The office uses the existing "new quote version" action on the job page to create and send a new version. That starts a fresh 14 days with new day-3 and day-10 nudges.
- The expired quote stays in the history as Expired. The owner never sees an automatic replacement; the office decides.

## 5. How to undo it
- Remove the expiry check from the timer and restore the acceptance check, or roll back to this version in History.
- The new columns and status can stay unused without harming anything. Any quote that was marked Expired can be set back to Sent by the office if needed.

## After building (preview only, no publish)
- Focused tests: day 3 and day 10 nudges once each; no nudge after accept, decline or expiry; expiry at 14 days; expired quotes refused; no stage change; nothing added to the needs-attention list.
- Then typecheck, wording scan and build. TEST jobs only, sending stays off, nothing else changes.

## Questions to confirm
- Does "14 days" mean 14 full days, so a quote sent on the 1st expires at the end of the 15th? I'd assume yes.
- Does this cover installation quotes only, or rectification quotes too? I'd assume both.

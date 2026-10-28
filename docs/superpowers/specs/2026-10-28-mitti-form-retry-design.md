# Mitti form retry and alert — spec

Date: 28 Oct 2026 · Status: approved by Jo 28 Oct 2026 (install-day lock added after approval, at her choice)
Portal: Home Insulation Victoria (Lovable project fb35adfe…)

## In plain words

When Mitti fails to make a form, the portal waits 2 minutes, checks Mitti for a form, and tries again if there isn't one. It does this twice. If it still fails, it emails info@. It never makes two forms for one job.

## Why

On 28 Oct, HV-3519's Ready Check form failed because Mitti sent back an error (500). The portal correctly didn't retry blindly, but the flag only showed in the office list. Nobody saw it until Chris emailed.

## What Jo decided

- Covers **all Mitti forms**: Ready Check, PIESA, electrical fixes and install-day forms.
- Install-day forms get the same one-at-a-time safety lock the other forms already have (they don't have it today), so they can never be made twice. Their existing hourly resend stays, but now goes through the lock. (Jo, 28 Oct)
- Waits **2 minutes**, then checks and retries. Does this **twice**.
- If both retries fail: **email to info@**. No text.
- Only for failures from go-live onwards. Old flags are left as they are.

## How it works

1. **A form attempt fails with an unclear result.** Mitti errors, a timeout, or a lost reply: the current "uncertain" result. The job is flagged as now, and nothing else happens at that moment.
2. **A new background check runs every minute.** It uses the same cron pattern as the existing Mitti pull and Outlook sync. It picks up any uncertain attempt that is 2 or more minutes old and hasn't used up its 2 retries.
3. **The check looks in Mitti first.** It searches Mitti for a form made since the failed attempt with the same template, the same assigned trade and this job.
   - **Found one form:** link it to the job (the same as the existing "link form" step). Record it and clear the flag. Done.
   - **Found more than one, or can't tell:** don't create anything. Email info@ straight away.
   - **Found none:** close the old attempt as "nothing created" and try once more through the existing creation code and its one-at-a-time claim guard.
4. **If retry 1 fails,** wait 2 more minutes and repeat step 3 (retry 2).
5. **If retry 2 fails,** email info@ once. The job stays flagged in the portal.

**Errors a retry won't fix** skip the retries and email info@ straight away. These are errors where Mitti clearly made nothing, for example "trade not found in Mitti" or "template missing fields".

## The email to info@

- **Subject:** Mitti form not made: HV-#### (Ready Check / PIESA / Install day)
- **Body:** job number and address, form type, trade name and email, booking time if booked, the error, and a link to the job in the portal.
- One email per failed form, never repeated.
- Sent any time of day. It goes to the office, not an owner.

## Safety rules

- Always check Mitti before every retry. Never create without that check.
- Use the existing claim guard, so only one creation can run at a time per job and form.
- Nothing goes to owners or trades. Trades just see the form appear in Mitti.
- Test jobs (qa_test) stay on the test Mitti account, as now. They never touch real Mitti users.
- Every step is logged on the job's history (retry started, form found and linked, retry made the form, gave up and emailed).

## Testing (before going live)

On test jobs only, with a fake Mitti:
1. Mitti fails, then the retry works: one form, flag cleared, no email.
2. Mitti actually made the form but the reply was lost: the form is found and linked, nothing new is made.
3. Both retries fail: exactly one email to the test address, job still flagged.
4. "Trade not found" error: no retries, email straight away.
5. Two checks running at the same moment: still only one form.
6. Each form type (Ready Check, PIESA, install day) goes through case 1.

## Not included

- No texts, no owner messages, no changes to the "Needs me" screen.
- No retrying of old flagged jobs from before go-live.
- No change to how forms are made when Mitti works normally.

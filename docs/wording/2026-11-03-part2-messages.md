# Part 2 messages for Jo to approve (installer's own job: electrician calls and books)

Nothing here is live. Every message is held until you approve it, one at a time. Placeholders in {braces} are filled in by the portal.
Branch: `part2-electrician-calls-and-books`. Wording below is copied exactly from the code.

Office emails go to the installer's office address, and the portal adds an "Open the job" button under the text when a job link is given. Texts go to electricians only (never installer offices).

---

## 1. Electrician's link text

- Code: `electricianLinkText` in `src/lib/electrician-link.core.ts` (sent from `src/lib/own-job-piesa-notices.server.ts`)
- Channel: text
- Goes to: the installer's chosen electrician, once their job is handed over (and again for a new electrician after a swap). It carries their no-login link.
- Approval flag: SMS type `own_job_piesa_link` has `wordingApproved: false` in `src/lib/sms.core.ts`

```
{installer} job: safety check (PIESA) to book at {address}. Call the owner, then book it here: {url}
```

## 2. Office "to book"

- Code: `officeToBookEmail` in `src/lib/electrician-link.core.ts`
- Channel: email
- Goes to: the installer's office, when the job is handed over (not sent if the installer's "who books" setting is electrician only)
- Approval flag: `OWN_JOB_PIESA_TO_BOOK_EMAIL_APPROVED = false`

Subject:
```
Safety check to book for {address}
```
Body (one line is chosen by the installer's "who books" setting):
```
The owner has paid. {line}
Job page: {jobUrl}
```
Where {line} is one of:
- Office books: `Please call the owner and book it within 2 business days.`
- Electrician books: `We've sent {electrician} a link to call the owner and book it within 2 business days.`
- Either: `We've sent {electrician} a link too. Whoever books first, within 2 business days.`

## 3. Office "not booked yet"

- Code: `officeNotBookedEmail` in `src/lib/electrician-link.core.ts` (sent from `src/lib/own-job-piesa.server.ts`)
- Channel: email
- Goes to: the installer's office, once, if 2 business days pass after the hand-over and the safety check is still not booked. The electrician's link keeps working.
- Approval flag: `OWN_JOB_PIESA_NOT_BOOKED_EMAIL_APPROVED = false`

Subject:
```
Not booked yet — book it or pick another electrician
```
Body:
```
The safety check (PIESA) at {address} isn't booked yet.
Book it on the job page, or pick another electrician: {jobUrl}
```

## 4. Office "can't do this one"

- Code: `officeCantDoEmail` in `src/lib/electrician-link.core.ts` (sent from `src/lib/electrician-link.server.ts`, `linkCantDo`)
- Channel: email
- Goes to: the installer's office, when the electrician taps "Can't do this one" on their link
- Approval flag: `OWN_JOB_PIESA_CANT_DO_EMAIL_APPROVED = false`
- {reason} is "Too busy", "Owner not answering", or the electrician's own note if they chose "Other"

Subject:
```
{electrician} can't do the safety check for {address}
```
Body:
```
Reason: {reason}.
Pick another electrician or book it yourselves on the job page: {jobUrl}
```

## 5. Old electrician, swap email

- Code: `oldElectricianEmail` in `src/lib/electrician-swap.core.ts` (sent from `src/lib/electrician-swap.server.ts`)
- Channel: email
- Goes to: the electrician who was taken off the job, once, when the installer changes the electrician
- Approval flag: `OWN_JOB_SWAP_OLD_ELECTRICIAN_EMAIL_APPROVED = false`

Subject:
```
You're no longer on {address}
```
Body:
```
The installer has picked another electrician for the safety check (PIESA) at {address}. You don't need to do anything. Your link no longer works.
```

## 6. Office Needs lines (Needs me list, shown to the Home Insulation Victoria office)

These are not emails or texts. They are lines on the office Needs list. Code: `src/lib/office-needs.core.ts`. They have no approval flag (office-only, internal), listed so you can check the words.

| When | Exact line | Button |
|---|---|---|
| Electrician tapped "Can't do this one" (`own_job_piesa_handed_back`) | `Electrician can't do this one: {reason}` | Open job |
| A swap couldn't move the Mitti safety check form (`own_job_swap_form_not_moved`) | `Move the Mitti safety check form to {electrician}` | Open job |
| Paid job not handed to an electrician (`own_job_piesa_held`) | `Safety check (PIESA) not handed to the electrician: {reason}` | Open job |

{reason} for the third line is one of (`src/lib/own-job-piesa.core.ts`):
- `No electrician chosen for this job`
- `Electrician has no portal profile`
- `Electrician hasn't finished signing up`

## 7. Owner message when a swap cancels a booked safety check

NOT BUILT — wording needed. Draft for Jo.

- Code: none yet. Today a swap cancels the booked safety check and tells the owner nothing (`src/lib/electrician-swap.server.ts` header: "Nothing is sent to the owner: no approved wording exists for it yet").
- Channel: email (suggested; a text would also work)
- Goes to: the owner, when the installer changes the electrician and a safety check had already been booked
- Approval flag: none yet. It would need its own held flag, off until you approve.

Subject:
```
Your safety check needs a new time
```
Body:
```
Hi {first name},

Your installer has changed the electrician for your safety check (PIESA) at {address}, so the time we booked is cancelled.

Your new electrician will call you soon to book a new time. You don't need to do anything.

Cheers,
the Home Insulation Victoria team
```

---

Not new in Part 2, so not listed above: the owner's booking confirmation (sent after the electrician books) reuses the existing in-house booking notice (`notifyOwnerBooked`), and the electrician's page at `/e/{token}` is on-screen words, not a message.

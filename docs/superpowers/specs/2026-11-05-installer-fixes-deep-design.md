# Installer portal fixes (Deep / Reinsulate feedback)

Date: 5 Nov 2026 · Design agreed with Jo in chat · Status: waiting for Jo to approve this spec

## In plain words

Deep's portal is confusing and missing things he needs. This fixes, in order:

1. **Photos:** Mitti Ready Check photos get copied into the portal and show on the job for you and Deep. His 6 lost sets come back too.
2. **No Ready Check dates:** nobody has to enter a Ready Check date. No "Book the Ready Check" card and no red "overdue".
3. **His own jobs skip Mitti:** on Add a job he types m², removal, product and price (photos optional) and presses **Send quote**. It goes to you to check. Then he sees when it's sent, the follow-ups, and when the owner accepts.
4. **Discount:** after a quote is sent, Deep can add a $ discount. The new quote goes to you to check, then to the owner.
5. **Electricians:** he can pick and change the electrician on a job easily, from any electrician linked to his business.
6. **Staff never see his price.**
7. Two bugs: the electrician name check, and the Ready Check people picker.

**Today, done by Jo by hand (no code):** un-archive the 6 old Mitti forms (HV-1538, 3066, 3116, 3117, 3118, 3119), and read Deep's 30 Oct email.

---

## 1. Mitti photos sync

- On each 15-minute Mitti pull, every photo on a job's Ready Check form(s) is downloaded once into storage (`job-files/<jobId>/mitti-photos/<auditId>/<photoId>.<ext>`) and recorded as a `documents` row (`kind = 'mitti_photo'`, title = the Mitti question/section label). Same-photo re-runs are skipped by `(audit id, photo id)`.
- Forms counted: the current linked form **and** any form listed in that job's `mitti_form_replaced` events (the archived originals). This is how the 6 lost sets come back once Jo un-archives them. If an archived form can't be read, that job gets one office row: "Old Mitti form for HV-xxxx is archived – un-archive it so its photos can be copied".
- Shown on the job page as a "Ready Check photos" gallery (tap to enlarge) for the office and for the installer business owner (the person who logs in for that installer, e.g. Deep). Never to crew links, never to the owner.
- A photo download failure goes on the still-to-finish list (recovery plan) and retries. It never blocks the rest of the sync.

## 2. No Ready Check dates (all installers, all jobs)

- Remove the "Book the Ready Check" step, Ready Check booking deadlines and "overdue" for Ready Checks. No "You're booked" text or email for Ready Checks.
- Job card wording: **"Do the Ready Check"**. On HIV leads it adds an **"Open Mitti form"** button (that job's form link).
- HIV leads: the Mitti Ready Check form is made as soon as the office gives the lead to the installer (no booking needed).
- If the Ready Check isn't done within **10 business days** of the installer getting the job, the job comes back to the office.
- The Ready Check counts as done when the Mitti form is Complete (HIV leads) or when the installer presses Send quote (his own jobs, part 3).
- Existing jobs: the 23 Reinsulate jobs (and any others waiting on a Ready Check date) drop the "book" step straight away. The 10-day clock starts from the release date, not backdated.

## 3. Installer's own jobs: Send quote from Add a job (no Mitti needed)

- Add a job (and the job page for an existing own job that has no quote yet) gets the Ready Check facts: **ceiling area (m²), removal (yes/no + m²), product, his price**, plus **optional photos**. The electrician choice stays as it is.
- **Send quote** button: checks the fields, builds the owner quote from his price (same quote layout as today) and puts it in **Quotes to check**. Nothing goes to the owner until Jo presses Send.
- Mitti stays available for his own jobs, but it's optional. If he does use it, the Mitti answers and photos still flow in as now.
- HIV leads keep using Mitti (unchanged apart from part 2).
- The installer sees a **quote timeline** on the job: "Sent for checking", "Sent to owner {date}", each reminder (email and text) with its date, "Owner opened", "Accepted" / "Declined" / "Expired". He gets an email when it's sent to the owner and when the owner accepts.

## 4. Discount after the quote is sent

- On a sent, not-yet-accepted own-job quote, Deep sees **"Give a discount"**: one $ amount plus an optional note to the office.
- **Send updated quote** makes a new version with a line "Discount −$X" under his price. It goes to Quotes to check. When Jo sends it, it replaces the old quote for the owner. The 30-day validity restarts from the new send date, and the owner gets the normal quote email.
- Limits: the discount can't be more than his own price, and the owner's rebate rules (minimum $200 owner payment) still apply. If the discount breaks them, it says so before sending.
- Not on HIV leads.

## 5. Electricians

- Every electrician picker for an installer lists: his Team electricians **plus** every onboarded electrician linked to his business (e.g. Peter Orlando at ORLANDO POWERED for Reinsulate). This follows Jo's 2 Nov rule ("any electrician onboarded with HIV and connected to them").
- On the job page, **"Change electrician"** is always shown until the safety check (PIESA) is done, not only on a booked PIESA. Changing it saves the person and any time together, and only then sends the electrician's job-link text and moves the Mitti PIESA form. (Fixes part-2 backlog item 1.)
- Bug: the "usual electrician changed" hold compares **licence number**, not the display name (HV-3193 held because "ORLANDO POWERED" ≠ "Peter orlando", same licence A63151).

## 6. Staff never see the installer's price

- Remove the "Total quoted price" question from the portal-made Mitti Ready Check forms (new forms), and stop reading it. The price comes only from the portal (part 3) or the rate card.
- No message to crew / Lead / signer phones includes a price.
- Price shows only to the installer business owner's login and the office.

## 7. Ready Check people picker bug

- Choosing who does a Ready Check lists everyone on the installer's Team, not install-day rules (only 2 of Deep's 6 showed). `in-house-booking.server.ts:39`.

## Testing

Each part gets tests that fail on today's code first:
- photo copy + skip on re-run
- archived-form recovery
- no Ready Check booking prompts
- 10-business-day return
- Send quote → Quotes to check, not to the owner
- quote timeline events
- discount version + limits
- picker lists linked electricians
- licence-based hold
- no price on staff forms/texts
- full Team in the Ready Check picker

Then a walk-through as a TEST installer using the TEST office login. Nothing touches the live database without Jo's yes.

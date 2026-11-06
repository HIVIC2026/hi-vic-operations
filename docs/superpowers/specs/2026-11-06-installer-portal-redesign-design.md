# Installer portal redesign: design spec (6 Nov 2026)

Status: DRAFT for Jo's review. Every installer-facing word below was approved by Jo on 6 Nov 2026. The source is `docs/superpowers/handoffs/2026-11-06-installer-portal-redesign-handoff.md`. A word marked *(draft)* has not been approved.
Mock-ups: `docs/superpowers/mockups/2026-11-06-installer-portal/`. Audit page: https://claude.ai/artifact/4N9YDro7BhDLS3gTGmad4C. ChatGPT audit triage: handoff, "ChatGPT audit" section.

## 1. Goal

All installer bosses (on a phone) and their office staff (on a computer) use one simple portal. Every job shows **one Next step**. That step either says what they must do or says who we're waiting on. The portal covers all three job types:

1. **Own customer**: they measure, set their own price, and we send the quote.
2. **Our lead from photos**: they measure from the owner's photos (a desktop job). We quote from Home Insulation Victoria's prices and pay them their agreed rates.
3. **Our lead with a Ready Check**: they visit and fill in the Mitti Ready Check. After that it runs the same as 2.

From "Quote with the owner" onward, the words are the same on every journey. Only the payment step at the end differs.

## 2. Out of scope / must not change

- Domain guards and workflow rules (`AGENTS.md`, `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`, `src/config/workflow-decisions.ts`). This redesign changes screens, words and the decisions listed in §6. Nothing else changes.
- The $349 fee, PIESA fee handling, the 50% deposit and the quote validity rules all stay as they are today.
- Mitti forms and question wording stay as they are.
- Office screens are out of scope (they're a separate handoff).
- No live SQL, no sends, no publish without Jo's explicit yes. Each screen gets its own pull request, and Jo merges.

## 3. Screens (approved mock-ups)

Look: `docs/templates/installer/portal/M7-business.html` tokens (#22376B ink, #5A6785 sub, #3C51C4 blue, #07BF61 green, #E4E9F5 lines, #F7F8FC bg, Outfit headings, Figtree body). Built from `src/components/portal/kit.tsx` + `.portal-theme` tokens.

**Colours (decision):** green = done/confirmed, **amber = reminder / to do**, red = stop or don't start only. Every chip says its state in words too.

### 3.1 My work (`mw-*.png`)
- Table on a computer, cards on a phone. Header: "Good morning, {Business} crew!" plus counts. Tabs: **Your turn** (the default; only jobs where they must act, most urgent first, overdue in red) and **All jobs** (includes waiting, booked and finished jobs, plus filters for cancelled and closed). There's a search box and a "+ Add a job" button.
- Each card shows: a source chip (Your customer / Our lead) · owner name · `HV-3821 · 12 Smith St, Melton` (`cardAddress`, PR #184) · the Next step title as a green tag · its due line (only when there's a real deadline) · one button. There's no Mitti form reference on cards.
- Our lead with a Ready Check: the card says "Do the Ready Check" · "New job" · button "Open the job" *(draft)*.

### 3.2 Job page (`s4b-*.png`)
- **Header:** source chip, job number, owner name, full address, Call and Email buttons.
- **Progress:** 6 dots: **Measure** · Quote · PIESA · Deposit · Install · Paid ("Measure" replaces "Ready Check" on all jobs).
- **Next step box:** full width, green left bar. It has a short title, 1–2 lines of text, status chips, and a "What happens from here ›" link that opens the long version. On a computer, the fields and the big green button sit beside the text; on a phone they're stacked.
- **Below the box:** two columns on a computer, stacked on a phone. Left: **Job details** (install m² · areas, removal, existing insulation, product brand + R value, roof/access, notes) and **Money**. Right: **Photos & videos** (+ Add photos; shows Ready Check, A5, PIESA and uploaded photos), **What the owner's been told**, **Paperwork**.

### 3.3 Add a job (`aj-*.png`)
- One form: owner, address, contact, how they measured, and product (brand + R value). If they pick floor plan or aerial, the upload is **required**. The required tick "owner agreed to Home Insulation Victoria contacting them" stays.
- **New:** a **Save for now** button. It needs only the owner, contact and address, and saves a draft they can finish later. The full checks run only on Send. A draft shows in My work as "Measure and quote".
- Pressing Send twice returns the same job (no duplicate job or quote).

### 3.4 My business (`mb-*-3.png`)
- Six roomy tiles with icons and chips, and no sub-lines: **Team · Electricians · Details** (includes who books safety checks, and whether they take our leads) · **Rates** (read only, inc GST, "To change these, call or email Home Insulation Victoria"; no request button) · **Documents** (insurance and agreement merged, uploads, expiry) · **Bank** (no "pending" word).
- **New:** a bank detail change needs Home Insulation Victoria's office to OK it before any pay goes there. Until then, pay goes to the old account.
- The How it works guide is removed.

## 4. Next step boxes: approved words

Example people and dates (real 2026 weekdays): owner Jo (own customer) / Helen (our leads), HV-3821. Quote sent Fri 6 Nov, valid until Sun 6 Dec. PIESA Thu 12 Nov 9:00am with James Spark. Install by Sat 12 Dec. Install Wed 25 Nov 8:00am, Lead and crew picked by Mon 23 Nov. The portal always fills in real names, dates and amounts. Use the owner's name, never "her" or "she".

### Journey 1: own customer (no deadlines on their own jobs)
1. **Measure and quote.** "Measure up on site, then add the sqm, what's in the ceiling, product, access, photos and your price here, or do the Ready Check in Mitti (the form's already there under HV-3821). Press Send for quote and we take it from there." Button: **Measure and quote**.
2. **Quote being prepared.** "We put the quote together with your price, the PIESA fee and our $349 fee, less the owner's rebate, and send it to the owner. You'll get an email when it goes out. Nothing for you to do."
3. **Quote with the owner.** "Sent Fri 6 Nov · valid until Sun 6 Dec. We touch base with Jo on day 3 and 2 days before it expires. You'll hear from us the moment Jo accepts or declines." Button: See the quote. Links: Offer a discount · Change my price. We check any discount before the owner sees it.
4. **"Jo said yes. Book the PIESA."** "Call Jo, agree a day and time, and book it here. The PIESA fee is already paid." Fields: Electrician (Main pre-selected from their approved list, changeable) · Day · Arrival. Button: **Book**. *What happens from here:* "We'll give you the green light to proceed to the PIESA. Call the owner and book the day and time, and please don't forget to book it here. The owner gets a confirmation. Your electrician is chosen from the approved people in your list. They do the PIESA and you both get the results. Any electrical upgrades are quoted and invoiced to the owner directly by you."
5. **PIESA booked.** "PIESA booked · Thu 12 Nov, 9:00am · James Spark. The owner's been told. Nothing for you to do." Links: Change time · Change electrician. *What happens from here:* "The PIESA form appears in your electrician's Mitti. They do the check on the day. The result comes back here, the owner gets their copy, and you get yours. Any electrical upgrades are quoted and invoiced to the owner directly by you."
6. **PIESA done. We're collecting the deposit.** "All clear. We've sent Jo the result and asked Jo to pay the deposit. Nothing for you to do." *What happens from here:* "We touch base with Jo on day 3 and day 7. We'll email you the moment it's paid so you can book the install."
   - *If upgrades are needed:* "Upgrades needed. Quote and invoice the owner directly, then upload the Certificate of Electrical Safety here when they're done." Button: Upload certificate. The certificate is an **amber reminder and never blocks booking**. The existing GO / DON'T START rule (3 Nov) still sends DON'T START until the certificate is in and checked.
7. **"Jo's deposit is in. Book the install by Sat 12 Dec."** "Call Jo, agree a day and time, and book it here. The install must happen by Sat 12 Dec (30 days from the PIESA). You pick who's going later." Fields: **Day · Arrival only**. Button: **Book the install**. Chips: Deposit paid ✓ · Certificate of Electrical Safety not uploaded yet · Upload (amber). *What happens from here:* "2 days before, the day and your Lead are locked and we notify the ESC. Your Lead and each crew member get a text with the safety plan to sign as soon as you pick them, and again the afternoon before if they haven't signed. Your Lead also gets the Mitti install form."
   - **Hard block:** days after the install-by date can't be picked. Message: "After Sat 12 Dec a new PIESA is needed. Call Home Insulation Victoria." The install-by date is 30 days from the official PIESA date (existing `thirtyDayEnd`).
8. **Install booked.** "Wed 25 Nov, 8:00am. Install by Sat 12 Dec. Pick your Lead Installer and crew by Mon 23 Nov (2 days before)." Pick one **Lead Installer**; **tick any number of crew**. Button: **Save who's going**. Link: Change the day. Only approved people (ESC-registered Leads; anyone with current CII) can be picked.
   - If nobody is picked by 2 days before, the installer office gets one email.
   - Once people are picked, each gets a safety plan chip: signed ✓ / not signed · **Remind** (re-sends that person's sign link, at most once an hour per person). Chips: Consent signed ✓ · Deposit paid ✓ · Certificate (amber if missing).
   - On the day, the button becomes **Today's job**. *What happens from here:* "The afternoon before, you get a GO or DON'T START email. Your Lead signs the safety plan and does the install form in Mitti. The owner pays the balance on install day."
9. **Install done · Wed 25 Nov.** "Jo pays the balance on install day." Chips: Install form ✓ · Rebate form signed ✓ · Balance not paid yet · Certificate uploaded ✓. *What happens from here:* "If Jo hasn't paid, we touch base on days 1, 3 and 7. Once Jo's paid in full, this job moves to Done."
10. **Paid:** "Paid ✓ {date} · {amount}". The installer is paid **7 calendar days after the owner pays in full**.

### Journey 2: our lead from photos (no price entered; installers never see our price)
1. **Quote from the owner's photos.** "Have a look at Helen's photos and videos, add the sqm, what's in the ceiling, product and access, then press Send. We'll do the quote and send it to Helen. You're paid your agreed rates for the job. We'd love it within 2 business days." Button: **Measure from photos**. Link: **Can't quote this one**. It asks for a reason (Photos not good enough / Too far / Too busy / Other), then the job goes back to our office. *What happens from here:* "We put the quote together and send it to Helen. You'll get an email when it goes. You're paid your agreed rates 7 days after we approve the install paperwork."
2. **Quote being prepared.** "We're putting the quote together and sending it to Helen. You'll get an email when it goes. Nothing for you to do."
3. **Quote with the owner.** "Sent Fri 6 Nov · valid until Sun 6 Dec. We touch base with Helen on day 3 and 2 days before it expires. You'll hear from us the moment Helen accepts or declines." No buttons or links.
4–8. Same as journey 1, with Helen as the owner. No booking deadline is shown (Jo: no).
9. **Install done · Wed 25 Nov.** "We check the install paperwork, then pay you your agreed rates 7 days after we approve it." (7 **calendar** days.)
10. **Paid:** "Paid ✓ {date} · {amount}".

### Journey 3: our lead with a Ready Check
1. **Do the Ready Check.** "Call Helen, pop out and do the Ready Check in Mitti (form's under HV-3821). We'd love it within 5 business days." Button *(draft)*: Open the Mitti form. Link: **Can't do this one** (same reasons as journey 2). There's no date to book and no price to enter. *What happens from here:* "Once the Mitti form's done, we put the quote together from what you found and send it to Helen. You're paid your agreed rates 7 days after we approve the install paperwork."
2 onward: same as journey 2.

### Boxes on every journey
- **Owner declined:** "Jo said no. This job is closed. Nothing for you to do."
- **Quote expired:** "Quote expired. We've asked Jo if they'd like a new one. Nothing for you to do."
- **Cancelled:** "This job's been cancelled ({reason}). We've told Jo. Please cancel anything you've booked on your end, like your electrician and crew."
- **On hold:** "On hold · {reason}. We'll let you know the moment it's back on. Nothing for you to do."
- **Couldn't get in:** Today's job has a **Couldn't get in** button. The box then says: "Couldn't get in on {day}. Call Jo, agree a new day and book it here. Install by {30-day date}." Day + Arrival + Book. The office gets a flag.
- **Part installed:** "Part installed. Tell us what's left and book a day to finish it." What's left + Day + Arrival + Book. The office gets a flag. There's no paperwork approval or pay until the job is finished.
- **Electrician must attend install day** (when the PIESA says so): the job page shows who and when. GO / DON'T START sends DON'T START if they aren't booked.

## 5. Messages
- **GO email (afternoon before):** add one line, "Your Lead still does the PIISA onsite before starting." No other changes.
- **Safety plan texts:** go to each Lead and crew member as soon as they're picked, and again the afternoon before if unsigned. Nothing is sent before people are picked.
- **Lead and crew not picked:** one email to the installer office 2 days before the install.
- Existing chase timings stay: quote day 3 and 2 days before expiry; deposit day 3 and 7; balance days 1, 3 and 7.

## 6. Rule changes in this redesign (Jo, 6 Nov)
1. Booking the install takes Day + Arrival only. Lead and crew are picked later (installers pick on Fridays for the next week), and crew can be any number of people.
2. An install day after the 30-day date can't be picked (hard block).
3. **Change the day after the lock** (2 days before): the installer can still change it, and the portal re-notifies ESC automatically. The existing `lockedLine` ("Email us to move this install") is replaced. The new date must still meet ESC's minimum notice; if it doesn't, the earliest allowed day is shown.
4. Installer pay: our leads, 7 calendar days after we approve the install paperwork. Own customers, 7 calendar days after the owner pays in full.
5. Portal vs Mitti measurements: the newest one wins, and the office is flagged to check both.
6. Bank detail changes need the office's OK first.
7. Amber reminders; red only for stop.
8. The first progress dot becomes "Measure".

## 7. Build rules (from the audit, no new features)
- Home Insulation Victoria's price on our leads is hidden everywhere: screens, server responses, files, email logs and exports. On our leads, installers see status words, their agreed rates and their pay only.
- No double sends: Send, Book, Save who's going, Pay and Give each create one record, even on a double tap or a retry.
- Never show success until the server confirms the save (speed step 2 rule). Keep typed values if a save fails, and offer Retry.
- Phone widths 320–430px, 200% zoom and long names stay readable with no sideways scrolling. Touch targets are big.
- Lead and crew pickers only list people who are approved for the install date.

## 8. Code map
- `src/lib/next-step-box.core.ts`: box kinds, titles and text. Add kinds: `pick_crew`, `owner_declined`, `quote_expired`, `cancelled`, `on_hold`, `no_access`, `part_installed`, `electrician_attend`. Remove `book_ready_check` and `ready_check_booked`, and replace them with `do_ready_check`.
- `src/lib/my-work.core.ts` (cards, PR #184), `src/routes/_authenticated/field.$jobId.tsx` (job page), `src/lib/installer-job-sections.core.ts`, `src/lib/business-screen.core.ts` (rows → 6 tiles), `src/lib/installer-electricians.core.ts` (Main electrician pre-pick), `src/lib/in-house-booking.core.ts` (install booking without people, multi-crew), `src/lib/certificate-chase.core.ts` (`thirtyDayEnd` for the hard block).
- Run `bun scripts/scan-retired-terms.ts` first. Run tests one file at a time. Each screen gets its own pull request.

## 9. Order of build (each its own pull request)
1. Next step box words and kinds (pure core + tests).
2. Job page layout.
3. My work.
4. Book the install (day + arrival, hard block) + Save who's going (Lead + multi-crew) + office email 2 days before.
5. Change the day after lock with ESC re-notice.
6. Problem-job boxes (declined, expired, cancelled, on hold, couldn't get in, part installed, electrician attends).
7. Add a job: Save for now.
8. My business tiles + bank change OK.
9. Pay timing (7 calendar days, own customers after paid in full) + GO email line + amber chips.

## 10. Checks before Jo sees it
Per pull request: unit tests for each box kind and word; a TEST-job screen walk (`bun run portal-qa`, journey `--screens`) on phone and computer widths; a check that our lead's price never appears in the installer's responses; screenshots sent to Jo. Nothing goes live until Jo says go.

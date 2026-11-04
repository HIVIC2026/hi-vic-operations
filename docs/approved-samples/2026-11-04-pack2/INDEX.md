# Pack 2 — Jo's approval pictures: EVERY screen a real job goes through (A1 own customer + A2 HIV lead)

Made 4 Nov 2026 from branch new-job-flow-joined (HEAD fb6ba265). **These are the REAL portal pages** (vite dev, the joined build) opened in a phone-sized browser (390×844, 2×, full page) against a local copy of the database: the two complete-route journeys (tests/journey-a1-complete-route-db.test.ts, tests/journey-a2-complete-route-db.test.ts) drove each job step by step through the real server modules on an in-process PGlite database, and a small local Supabase stand-in (PostgREST + Auth + Storage over HTTP, `_build/fake-supabase.ts`) let the running portal read and write the same rows. Mitti, Resend, Twilio, Xero and Stripe were the journey's fakes (nothing sent; the live Supabase was never touched; nothing in src changed). Both journeys passed in full under the screenshots: A1 28/28, A2 16/16 (A2 with its Ready Check changed to KEEP the old insulation, so the kept-insulation line shows).

What the pictures are: `NN-role-screen-stage.png` (phone, full page) + `NN-….txt` (the page's visible wording). Messages the two runs generated are in `messages/` (26 emails + 11 texts for A1, 9 + 3 for A2, plain text).

Two things to know when reading them:
- A1 (items 1–102) was shot with the approval flags as they are in code (OFF where Jo hasn't approved). A2 (items 103–172) was shot with every `*_APPROVED = false` flag served as ON to the running portal (dev transform only, src untouched) so the flag-gated screens show their NEW wording — e.g. the rental taps. The flag column says which flag gates what.
- The owner's buttons (Sign and pay, Pay, confirm, pick a time/day) were pressed by the journey's server calls, not by a finger on the screen, so the state after each press is real but the tap itself isn't in the picture; the code gate was walked on screen where it appears.


## LOOKS WRONG (read this first)

Things that looked wrong to me (the person taking the pictures), most important first. "Picture" = the file number. I read every page's wording and looked at the main screens; I did not eyeball all 172 pictures pixel by pixel.

1. **Owner never sees a Ready Check window to confirm (A2, pictures 126/127).** After the installer picked the run day (journey step 3, "the owner gets a window; the owner confirms"), My job home only says "You're all set, Harriet. We'll email you when there's a next step." — no window card, no confirm button; `?screen=book` shows the same. No "your Ready Check window" email or text went out either (messages/a2-*). The journey confirmed it through the server function, so a real owner on this build has no way to do that step on screen.
2. **Owner's "Electrician" row says "Your electrician" instead of the person's name (A1, pictures 53/54/59/61–63).** ONE LAST STEP › STEP 1 shows "Electrician: Your electrician" on the installer's own job, although Will Casdorff was chosen at Add a job and did the check. A2 (HIV electrician) names "Eddie A2 Electrician" correctly (156).
3. **Price card says the electrician isn't saved (A1, pictures 23/24/25).** "Electrician: My usual electrician (not saved yet — add them under My business)" — but Will Casdorff (Team electrician) was picked at Add a job (decision 289: shown read-only here). Wrong label and it sends the boss to the removed My business › electricians page.
4. **Kept-insulation line says "Your installer" instead of the installer's name (A2, pictures 136/137/139/140).** Approved paragraph (list 58) is "Your old insulation stays. {Installer} checked it…"; on the quote page it reads "Your installer checked it" although the business (TEST Journey A2 Insulation) is on the job. Check the quote email variant too (messages/a2-email-05).
5. **My job home never shows a booked day (A1 40/46/71, A2 108/129/153/167).** After the $349 is paid, after the safety check is booked, after the install is booked, the home screen is just "You're all set. We'll email you when there's a next step." The owner can't see their booked Ready Check / safety check / install day or who's coming anywhere on My job — only in the email.
6. **"Spot saved" before the spot is saved (A2, pictures 103/104).** The Save my spot card is headed "Spot saved. Your $1,520 rebate is waiting." while the button still says "See my estimate and save my spot" (spot not saved yet). Also the rebate figure differs from the Spot saved email sent a moment later ($1,710 for 130 m² after the repeat enquiry, vs $1,520 on screen).
7. **Two identical "Spot saved" emails on a double tap (messages/a2-email-02 and -03).** Same subject, same body, same recipient, from the journey's "double tap = one spot" step — one spot was saved but two emails went.
8. **`?screen=piesa` is a blank page while the owner should pick a time (A2, picture 152).** Only "HV-3300" renders. The home screen (151) shows the pick-a-time flow behind the code gate correctly; the direct screen link is empty.
9. **Office job page "Waiting for…" line: raw ISO dates and a mangled word (pictures 47, 84, 132).** "Waiting for the electrician: pIESA booked · Booked 2026-11-09." and "Waiting for the installer: ready Check started · Booked 2026-11-05." — "pIESA" / "ready Check" (first letter lower-cased by code), and dates as 2026-11-09 instead of "Mon 9 Nov" everywhere else.
10. **"$349.00 per flat" on Your rates (picture 06).** The unit reads as "per flat" (raw unit code) — should say something like "flat fee".
11. **Old "My electricians" page still opens at its address (picture 08).** Jo ruled it REMOVED (approval list item 74) and the hub no longer links to it, but /field/business/electricians still renders "My electricians — Add an electrician".
12. **Office-internal red box on the owner's quote page when the office hasn't loaded the templates (A1, pictures 29/31/35).** "Customer agreement is not ready: add the current VEU consumer information and consumer rights. ESC owner consent is not ready: add the current ESC information-sharing consent form." — internal instructions shown to the owner. Only happens before the office one-off setup (a fresh database), but the wording is office-facing.
13. **`?screen=turn` says the link has closed while the owner's turn is live (A2, picture 111).** It's the old one-by-one Release landing; the new flow opens ?screen=taps. Any old "It's your turn" link in an inbox would read as closed.
14. **Booking form shows mm/dd/yyyy date boxes (pictures 19/41/64).** The Day box reads "mm/dd/yyyy" — that's the browser's native date box in the headless browser (locale), most likely dd/mm/yyyy on Jo's phone; worth a glance on a real phone.
15. **Small:** rebate form screen footer starts with a stray "·" ("· Official form ESC-Activity48-VEEC-Assignment-v1.1-20261001", picture 92); A2 electrician-login pictures 147 and 148 are the same screen twice (a re-run); the office job page "4 · PIESA — Offer: Not sent yet" on an in-house job where no offer exists (84).


## Could not reach / not in this pack
- The installer's run page (/field/run/…) stayed on 'Loading…' in this local set-up (items 125, 128) and the run did not appear on My work (124): the journey's own read of the run passed, so this is most likely my local PostgREST stand-in, not proven a portal fault — treat as NOT SHOWN, re-check on the real preview.
- Worker job page /w/… : no /w/ link was texted in either run (ELECTRICIAN_LINK_TEXT_APPROVED off; crew links are minted at booking but only the Lead's /sp/ link is texted), so no /w/ screen.
- Electrician 'upload certificate': the /e/ link has no upload step — the certificate arrives with the A4 form (Part C), so there is no such screen.
- 'Rental taps' for an installer's own customer (OWN_CUSTOMER_RENTAL_TAPS_APPROVED, text-driven) — not on a screen in A1 (flags off in that run).
- Owner 'Sign and pay' verified-code state and the exact moment of acceptance: the code gate is shown (35, 140, 151) but the final press was the journey's.
- Office Needs me / Money are shown at each stage but not every office sub-page (Partners, Settings, Users).


## Items (in the order Jo meets them), batches of 5


### Batch 1 — items 01–05

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 01 | 01-installer-my-work-empty.png | installer | A1 | before any job | Redesigned My work (Part 5): greeting, Your turn / All jobs pills, search, one card per job with the next action button. Live today: old job list. | none (Part 5 screens, no flag) | — |
| 02 | 02-installer-add-a-job-blank.png | installer | A1 | Add a job — empty | Part 5 T7 one-screen Add a job: 'How did you get this customer?' (door-knock / cold call refused), owner card, electrician for the PIESA from the Team, consent tick naming HIV + the business. | none | DRAFT (approval list 7/35): 'Choose the electrician'; address helper 'Start typing, then pick the address from the list.' |
| 03 | 03-installer-add-a-job-errors.png | installer | A1 | Add a job — nothing filled, errors | Decision 237 error state: red borders, one line per field, summary banner. | none | error lines (plan wording) |
| 04 | 04-installer-add-a-job-filled.png | installer | A1 | Add a job — filled, before Add | Filled form before Add. Address list shows the local stub addresses ('Example Street, Testville') because the address search has no network here — not a portal defect. | none | — |
| 05 | 05-installer-my-business.png | installer | A1 | My business hub | Part 5 T9 My business hub: Needs you (bank details), Team summary with DOB tick, Electricians (own PIESA price), Insurance, Business details, Your rates, Bank, Agreement + ESC notice. | none | DRAFT (list 13): Team sub-line '{n} people · all have date of birth + mobile ✓', 'no logo yet', 'Not signed yet' |

### Batch 2 — items 06–10

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 06 | 06-installer-my-business-your-rates.png | installer | A1 | Your rates | Your rates page: the business's own agreed PIESA rate ($349 = its rate card, ex GST 317.27). 'per flat' is the raw unit label. | none | — |
| 07 | 07-installer-my-business-who-books.png | installer | A1 | Electrician / who books the safety check | Part 5 T9: 'Who books the safety check and the upgrades day?' (Our office / Our electrician / Either). Pending SQL installer-business-settings.sql. | none (pending SQL) | DRAFT (list 13): the question + 'Add an electrician on the Team page' |
| 08 | 08-installer-my-business-electricians.png | installer | A1 | Electricians list | OLD 'My electricians' page — Jo 4 Nov 19:35 ruled it REMOVED (list 74). The hub no longer links to it but the address /field/business/electricians still opens. | — | old page |
| 09 | 09-installer-team.png | installer | A1 | Team | Part 5 T10 Team: roles Office / Lead Installer / Crew / Electrician with help lines, date of birth (kept privately for ESC registration), mobile. | none (pending SQL installer-worker-identity-dob.sql) | DRAFT (list 15/20): role help lines, 'Date of birth', 'Kept privately for ESC registration…', 'Add to team' |
| 10 | 10-installer-my-business-details.png | installer | A1 | Business details (logo) | Business details + logo upload for co-branded quotes. | OWN_CUSTOMER_COBRAND_APPROVED (logo use on quotes) — upload box itself unflagged | DRAFT (list 13): 'Upload your logo (for co-branded quotes)', 'PNG or JPEG, up to 2 MB…' |

### Batch 3 — items 11–15

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 11 | 11-installer-my-business-insurance.png | installer | A1 | Insurance | Insurance and licences page (Part 9 T8: public liability amount insured, verified by the office). | none | — |
| 12 | 12-installer-money-empty.png | installer | A1 | Money, no jobs yet | Part 5 T8 Money: Coming to you / Paid this month, pay-rule line V2. | NO_FORM_NO_PAY_V2_APPROVED (ON) | APPROVED: 'Paid 7 days after we approve the finished Mitti form. Your own customers: once they've paid in full.' DRAFT (list 9): 'Paid 7 days after we approve the PIESA form' |
| 13 | 13-installer-team-add-worker-blank.png | installer | A1 | Team — add a worker, empty | Part 5 T10 Team: roles Office / Lead Installer / Crew / Electrician with help lines, date of birth (kept privately for ESC registration), mobile. | none (pending SQL installer-worker-identity-dob.sql) | DRAFT (list 15/20): role help lines, 'Date of birth', 'Kept privately for ESC registration…', 'Add to team' |
| 14 | 14-installer-team-add-worker-filled.png | installer | A1 | Team — add a worker, filled (DOB), before Save | Part 5 T10 Team: roles Office / Lead Installer / Crew / Electrician with help lines, date of birth (kept privately for ESC registration), mobile. | none (pending SQL installer-worker-identity-dob.sql) | DRAFT (list 15/20): role help lines, 'Date of birth', 'Kept privately for ESC registration…', 'Add to team' |
| 15 | 15-office-needs-me-empty.png | office | A1 | Needs me, no jobs | Office Needs me (phase 3 office redesign): Today / This week / Watch, 'Include TEST jobs'. | none | DRAFT office rows per list 41/45/48/49/54 when they occur |

### Batch 4 — items 16–20

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 16 | 16-office-templates-hub.png | office | — | Templates hub | Templates hub (every email/text/PDF with sample data; pack 1 pictures were built from here). | none | — |
| 17 | 17-office-money-empty.png | office | — | Money / Payouts, nothing yet | Office Money / Payouts. | none | DRAFT (list 33): 'No PIESA rate set — ask the office' when it occurs |
| 18 | 18-installer-my-work-new-job.png | installer | A1 | job added — Book the Ready Check | Redesigned My work (Part 5): greeting, Your turn / All jobs pills, search, one card per job with the next action button. Live today: old job list. | none (Part 5 screens, no flag) | — |
| 19 | 19-installer-job-just-added.png | installer | A1 | job page straight after Add a job (Next step box: Book the Ready Check) | Job page straight after Add a job: approved line 'Next: call {first} and book the Ready Check on the job.' + Next step box 'Book the Ready Check' with day/arrival/who's going (fix wave minor 15). | none | — |
| 20 | 20-installer-job-book-ready-check-filled.png | installer | A1 | Book the Ready Check — day, time and person chosen (not saved) | Job page straight after Add a job: approved line 'Next: call {first} and book the Ready Check on the job.' + Next step box 'Book the Ready Check' with day/arrival/who's going (fix wave minor 15). | none | — |

### Batch 5 — items 21–25

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 21 | 21-office-needs-me-new-own-job.png | office | A1 | Needs me after an installer's own job is added | Office Needs me (phase 3 office redesign): Today / This week / Watch, 'Include TEST jobs'. | none | DRAFT office rows per list 41/45/48/49/54 when they occur |
| 22 | 22-office-job-new.png | office | A1 | office job page — new own-customer job | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 23 | 23-installer-job-ready-check-done-enter-price.png | installer | A1 | Ready Check complete — price card asks the boss for the price | Part 10 price card 'Enter your price': Ready Check facts, insulation product, your price, what's included, notes; quote goes out by itself once checks pass. The text to the boss carries the #price link. | ENTER_PRICE_EMAIL_APPROVED (the email that goes with the text) — the card is unflagged | DRAFT (list 26): 'We add the $349 Home Insulation Victoria fee and your PIESA price…'; 'Your price stays editable until the quote is sent.' |
| 24 | 24-installer-price-link-from-text.png | installer | A1 | the boss's price link (from the text) | Part 10 price card 'Enter your price': Ready Check facts, insulation product, your price, what's included, notes; quote goes out by itself once checks pass. The text to the boss carries the #price link. | ENTER_PRICE_EMAIL_APPROVED (the email that goes with the text) — the card is unflagged | DRAFT (list 26): 'We add the $349 Home Insulation Victoria fee and your PIESA price…'; 'Your price stays editable until the quote is sent.' |
| 25 | 25-installer-price-card-typed.png | installer | A1 | price card with $2,500 typed, before Save | Part 10 price card 'Enter your price': Ready Check facts, insulation product, your price, what's included, notes; quote goes out by itself once checks pass. The text to the boss carries the #price link. | ENTER_PRICE_EMAIL_APPROVED (the email that goes with the text) — the card is unflagged | DRAFT (list 26): 'We add the $349 Home Insulation Victoria fee and your PIESA price…'; 'Your price stays editable until the quote is sent.' |

### Batch 6 — items 26–30

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 26 | 26-office-job-ready-check-done-no-price.png | office | A1 | office job page — Ready Check done, waiting on the boss's price | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 27 | 27-installer-job-price-in-quote-waiting.png | installer | A1 | price saved — quote drafted, waiting on Quotes to check (auto send off) | After Save: quote drafted, held for the office (AUTO_QUOTE_SEND_ENABLED=false for the first weeks). | none | DRAFT (list 23): 'Quote being prepared' / 'Home Insulation Victoria is checking the quote.' |
| 28 | 28-office-job-quote-held.png | office | A1 | office job page — quote drafted and held | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 29 | 29-owner-my-job-quote-ready.png | owner | A1 | My job home — your quote is ready | Owner quote page (O18 v4 look on screen): Your rebate, Your price, lines incl. 'Electrical safety check (PIESA) $349' at the installer's own rate (Jo 4 Nov), 'Not included: electrical upgrades…', two ticks + typed name, how you pay, 30-day line. | OWNER_QUOTE_EMAIL_V4_APPROVED (email); screen unflagged | — |
| 30 | 30-owner-my-job-quote.png | owner | A1 | link from the quote email (?screen=quote) | Owner quote page (O18 v4 look on screen): Your rebate, Your price, lines incl. 'Electrical safety check (PIESA) $349' at the installer's own rate (Jo 4 Nov), 'Not included: electrical upgrades…', two ticks + typed name, how you pay, 30-day line. | OWNER_QUOTE_EMAIL_V4_APPROVED (email); screen unflagged | — |

### Batch 7 — items 31–35

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 31 | 31-owner-quote-page.png | owner | A1 | quote page (?screen=quote) | Owner quote page (O18 v4 look on screen): Your rebate, Your price, lines incl. 'Electrical safety check (PIESA) $349' at the installer's own rate (Jo 4 Nov), 'Not included: electrical upgrades…', two ticks + typed name, how you pay, 30-day line. | OWNER_QUOTE_EMAIL_V4_APPROVED (email); screen unflagged | — |
| 32 | 32-installer-job-quote-sent.png | installer | A1 | quote sent to the owner | — | none | — |
| 33 | 33-installer-my-work-quote-sent.png | installer | A1 | My work — waiting on the owner | Redesigned My work (Part 5): greeting, Your turn / All jobs pills, search, one card per job with the next action button. Live today: old job list. | none (Part 5 screens, no flag) | — |
| 34 | 34-office-job-quote-sent.png | office | A1 | office job page — quote sent | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 35 | 35-owner-sign-and-pay-code-gate.png | owner | A1 | Sign and pay — the code gate (TEST shows the code on screen) | Sign and pay = the quote page's SAY YES block; pressing the button opens the 6-digit code gate (TEST jobs show the code on screen). | none | — |

### Batch 8 — items 36–40

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 36 | 36-owner-my-job-accepted.png | owner | A1 | My job home after accepting — pay the $349 safety check | After accepting: PAYMENT card — PIESA $349 by card (Stripe) or bank transfer with BSB/reference. | none | — |
| 37 | 37-owner-pay-349.png | owner | A1 | Pay page — the $349 safety check (PIESA) by card | After accepting: PAYMENT card — PIESA $349 by card (Stripe) or bank transfer with BSB/reference. | none | — |
| 38 | 38-installer-job-accepted-awaiting-349.png | installer | A1 | owner accepted — waiting on the $349 before the safety check can be booked | Next step 'Book the PIESA' for the Team electrician (Part 6 in-house booking) — refused until the $349 is paid (payment gate). | none | DRAFT (list 7): 'Choose the electrician' |
| 39 | 39-office-job-accepted.png | office | A1 | office job page — accepted, invoice raised | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 40 | 40-owner-my-job-349-paid.png | owner | A1 | My job home — $349 paid, the installer books the safety check | 'You're all set' resting screen between steps (no dates shown — see LOOKS WRONG). | none | — |

### Batch 9 — items 41–45

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 41 | 41-installer-job-book-safety-check.png | installer | A1 | Next step: book the safety check (PIESA) for the Team electrician | Next step 'Book the PIESA' for the Team electrician (Part 6 in-house booking) — refused until the $349 is paid (payment gate). | none | DRAFT (list 7): 'Choose the electrician' |
| 42 | 42-installer-job-book-safety-check-filled.png | installer | A1 | book the safety check — filled, not saved | Next step 'Book the PIESA' for the Team electrician (Part 6 in-house booking) — refused until the $349 is paid (payment gate). | none | DRAFT (list 7): 'Choose the electrician' |
| 43 | 43-installer-my-work-book-piesa.png | installer | A1 | My work — book the safety check | Redesigned My work (Part 5): greeting, Your turn / All jobs pills, search, one card per job with the next action button. Live today: old job list. | none (Part 5 screens, no flag) | — |
| 44 | 44-office-job-349-paid.png | office | A1 | office job page — $349 paid | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 45 | 45-installer-job-piesa-booked.png | installer | A1 | safety check booked | Safety check booked by the installer office; A3 form made for the electrician. | none | — |

### Batch 10 — items 46–50

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 46 | 46-owner-my-job-piesa-booked.png | owner | A1 | My job home — you're booked for the safety check | 'You're all set' resting screen between steps (no dates shown — see LOOKS WRONG). | none | — |
| 47 | 47-office-job-piesa-booked.png | office | A1 | office job page — PIESA booked | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 48 | 48-electrician-link-piesa-day.png | electrician | A1 | /e/ link — booked safety check day, owner contact, Open safety check form | Part 6 no-login /e/ link: booked day, owner contact, 'Open safety check form', 'Change the time' / 'Save the new time', 'Can't do this one' → 'Why not? A few words is fine.' + 'Send the job back'. | ELECTRICIAN_LINK_TEXT_APPROVED (the text carrying the link; off) | DRAFT (list 24): 'Change the time', 'Save the new time'; 'Why not? A few words is fine.' |
| 49 | 49-electrician-link-change-time.png | electrician | A1 | /e/ link — change the time | Part 6 no-login /e/ link: booked day, owner contact, 'Open safety check form', 'Change the time' / 'Save the new time', 'Can't do this one' → 'Why not? A few words is fine.' + 'Send the job back'. | ELECTRICIAN_LINK_TEXT_APPROVED (the text carrying the link; off) | DRAFT (list 24): 'Change the time', 'Save the new time'; 'Why not? A few words is fine.' |
| 50 | 50-electrician-link-cant-do.png | electrician | A1 | /e/ link — can't do this one | Part 6 no-login /e/ link: booked day, owner contact, 'Open safety check form', 'Change the time' / 'Save the new time', 'Can't do this one' → 'Why not? A few words is fine.' + 'Send the job back'. | ELECTRICIAN_LINK_TEXT_APPROVED (the text carrying the link; off) | DRAFT (list 24): 'Change the time', 'Save the new time'; 'Why not? A few words is fine.' |

### Batch 11 — items 51–55

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 51 | 51-office-job-a3-synced-piesa-done.png | office | A1 | office job page — signed A3 synced, PIESA completed by itself | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 52 | 52-electrician-link-upgrades-when.png | electrician | A1 | /e/ link — result: upgrades needed; when are you doing the upgrades? | /e/ link after an upgrades-needed result: the electrician enters the upgrades day (who-books 'either'); then 'Upgrades day' with 'Open upgrades form'. The certificate lands through the A4 form — there is no upload button on the link. | none | DRAFT (list 8): installer/office upgrades lines when overdue |
| 53 | 53-owner-my-job-upgrades-needed.png | owner | A1 | My job home — safety check done, electrical upgrades needed | ONE LAST STEP page (Part 4): STEP 1 confirm the safety check (result + 30-day/void line), STEP 2 the ESC consent form (four ticks), one typed name signs both, STEP 3 pay the 10% deposit; afterwards 'Your deposit is paid'. | none | — |
| 54 | 54-owner-piesa-confirm-upgrades.png | owner | A1 | Confirm the safety check (upgrades needed) | ONE LAST STEP page (Part 4): STEP 1 confirm the safety check (result + 30-day/void line), STEP 2 the ESC consent form (four ticks), one typed name signs both, STEP 3 pay the 10% deposit; afterwards 'Your deposit is paid'. | none | — |
| 55 | 55-installer-job-upgrades-needed.png | installer | A1 | safety check done — upgrades needed, electrician books the upgrades day | Installer job page while upgrades are pending: electrician books the upgrades directly (partner-billed, decisions 34/36). | none | — |

### Batch 12 — items 56–60

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 56 | 56-office-job-upgrades-needed.png | office | A1 | office job page — upgrades needed | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 57 | 57-electrician-link-upgrades-day-booked.png | electrician | A1 | /e/ link — upgrades day booked; A4 form; certificate upload | /e/ link after an upgrades-needed result: the electrician enters the upgrades day (who-books 'either'); then 'Upgrades day' with 'Open upgrades form'. The certificate lands through the A4 form — there is no upload button on the link. | none | DRAFT (list 8): installer/office upgrades lines when overdue |
| 58 | 58-electrician-link-upgrades-change-day.png | electrician | A1 | /e/ link — change the upgrades day | — | none | — |
| 59 | 59-owner-my-job-upgrades-day-booked.png | owner | A1 | My job home — upgrades day booked, confirm the safety check and pay the deposit | ONE LAST STEP page (Part 4): STEP 1 confirm the safety check (result + 30-day/void line), STEP 2 the ESC consent form (four ticks), one typed name signs both, STEP 3 pay the 10% deposit; afterwards 'Your deposit is paid'. | none | — |
| 60 | 60-installer-job-upgrades-day-booked.png | installer | A1 | upgrades day booked | Installer job page while upgrades are pending: electrician books the upgrades directly (partner-billed, decisions 34/36). | none | — |

### Batch 13 — items 61–65

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 61 | 61-owner-my-job-piesa-confirmed-deposit-due.png | owner | A1 | My job home — safety check confirmed, 10% deposit due | ONE LAST STEP page (Part 4): STEP 1 confirm the safety check (result + 30-day/void line), STEP 2 the ESC consent form (four ticks), one typed name signs both, STEP 3 pay the 10% deposit; afterwards 'Your deposit is paid'. | none | — |
| 62 | 62-owner-deposit-page.png | owner | A1 | Deposit page — 10% to book your install day | ONE LAST STEP page (Part 4): STEP 1 confirm the safety check (result + 30-day/void line), STEP 2 the ESC consent form (four ticks), one typed name signs both, STEP 3 pay the 10% deposit; afterwards 'Your deposit is paid'. | none | — |
| 63 | 63-owner-my-job-deposit-paid.png | owner | A1 | My job home — deposit paid, installer books the install day | ONE LAST STEP page (Part 4): STEP 1 confirm the safety check (result + 30-day/void line), STEP 2 the ESC consent form (four ticks), one typed name signs both, STEP 3 pay the 10% deposit; afterwards 'Your deposit is paid'. | none | — |
| 64 | 64-installer-job-deposit-paid-book-install.png | installer | A1 | deposit paid — book the install day with a Lead Installer | Next step: book the install day with a Lead Installer (Part 7) — allowed before the upgrades day (Part 9 T10) with the approved warning. | none | 'Electrical upgrades aren't done yet…' (list 42, approved) |
| 65 | 65-installer-job-book-install-filled.png | installer | A1 | book the install day — filled, not saved | Next step: book the install day with a Lead Installer (Part 7) — allowed before the upgrades day (Part 9 T10) with the approved warning. | none | 'Electrical upgrades aren't done yet…' (list 42, approved) |

### Batch 14 — items 66–70

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 66 | 66-installer-my-work-book-install.png | installer | A1 | My work — book the install | Redesigned My work (Part 5): greeting, Your turn / All jobs pills, search, one card per job with the next action button. Live today: old job list. | none (Part 5 screens, no flag) | — |
| 67 | 67-office-job-deposit-paid.png | office | A1 | office job page — deposit paid | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 68 | 68-office-money-deposit-paid.png | office | A1 | Money — $349 and deposit in | Office Money / Payouts. | none | DRAFT (list 33): 'No PIESA rate set — ask the office' when it occurs |
| 69 | 69-installer-job-install-booked.png | installer | A1 | install booked with Lead Installer Ivy | Install booked box: 'Safety plan signed n of m', 'Lead Installer locks {Ddd D Mmm, 5pm}', Change time / Change Lead Installer, consent + deposit ticks, 'Today's job', pay rule V2, 'Check my form now'. | NO_FORM_NO_PAY_V2_APPROVED (ON); LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED (the 9am email) | APPROVED pay block; DRAFT (list 10): 'Your crew', 'Signed: n of total' |
| 70 | 70-installer-install-day-view-before.png | installer | A1 | install-day view before the day | Part 7 install-day view (/field/day): crew, safety plan, Mitti form, GO status. | none | DRAFT (list 10): 'Your crew', 'Signed', 'Opening…', 'Install form not ready yet' |

### Batch 15 — items 71–75

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 71 | 71-owner-my-job-install-booked.png | owner | A1 | My job home — you're booked for your install | 'You're all set' resting screen between steps (no dates shown — see LOOKS WRONG). | none | — |
| 72 | 72-worker-swms-sign-link.png | worker (Lead) | A1 | /sp/ safety plan sign link, unsigned | Part 7 /sp/ no-login safety plan (SWMS) sign link for the Lead / crew; after signing the line shows signed. | SWMS_NOV2_WORDING_ON (the Part 7 T1 supervision wording) | DRAFT (list 6) if SWMS_NOV2_WORDING_ON |
| 73 | 73-office-job-install-booked.png | office | A1 | office job page — install booked (installation section, ESC card, GO check) | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 74 | 74-office-needs-me-install-booked.png | office | A1 | Needs me — ESC notice to record | Office Needs me (phase 3 office redesign): Today / This week / Watch, 'Include TEST jobs'. | none | DRAFT office rows per list 41/45/48/49/54 when they occur |
| 75 | 75-electrician-link-all-done.png | electrician | A1 | /e/ link — upgrades done, certificate on file: All done | /e/ link 'All done — Nothing more to do on this job.' | none | — |

### Batch 16 — items 76–80

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 76 | 76-owner-my-job-clear-to-install.png | owner | A1 | My job home — you're clear to install | ONE LAST STEP page (Part 4): STEP 1 confirm the safety check (result + 30-day/void line), STEP 2 the ESC consent form (four ticks), one typed name signs both, STEP 3 pay the 10% deposit; afterwards 'Your deposit is paid'. | none | — |
| 77 | 77-owner-clear-to-install-screen.png | owner | A1 | clear-to-install screen (?screen=clear) | ONE LAST STEP page (Part 4): STEP 1 confirm the safety check (result + 30-day/void line), STEP 2 the ESC consent form (four ticks), one typed name signs both, STEP 3 pay the 10% deposit; afterwards 'Your deposit is paid'. | none | — |
| 78 | 78-installer-job-clear-to-install.png | installer | A1 | upgrades done — clear to install, install day booked | Install booked box: 'Safety plan signed n of m', 'Lead Installer locks {Ddd D Mmm, 5pm}', Change time / Change Lead Installer, consent + deposit ticks, 'Today's job', pay rule V2, 'Check my form now'. | NO_FORM_NO_PAY_V2_APPROVED (ON); LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED (the 9am email) | APPROVED pay block; DRAFT (list 10): 'Your crew', 'Signed: n of total' |
| 79 | 79-office-job-clear-to-install.png | office | A1 | office job page — PIESA re-issued as a pass, clear to install | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 80 | 80-installer-lead-installer-confirm.png | installer | A1 | Lead Installer confirm (the link in the 9am email) | Install booked box: 'Safety plan signed n of m', 'Lead Installer locks {Ddd D Mmm, 5pm}', Change time / Change Lead Installer, consent + deposit ticks, 'Today's job', pay rule V2, 'Check my form now'. | NO_FORM_NO_PAY_V2_APPROVED (ON); LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED (the 9am email) | APPROVED pay block; DRAFT (list 10): 'Your crew', 'Signed: n of total' |

### Batch 17 — items 81–85

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 81 | 81-installer-job-lead-locked.png | installer | A1 | two days before — Lead Installer locked at 5pm | Install booked box: 'Safety plan signed n of m', 'Lead Installer locks {Ddd D Mmm, 5pm}', Change time / Change Lead Installer, consent + deposit ticks, 'Today's job', pay rule V2, 'Check my form now'. | NO_FORM_NO_PAY_V2_APPROVED (ON); LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED (the 9am email) | APPROVED pay block; DRAFT (list 10): 'Your crew', 'Signed: n of total' |
| 82 | 82-worker-swms-sign-link-signed.png | worker (Lead) | A1 | /sp/ safety plan link after the Lead signed | Part 7 /sp/ no-login safety plan (SWMS) sign link for the Lead / crew; after signing the line shows signed. | SWMS_NOV2_WORDING_ON (the Part 7 T1 supervision wording) | DRAFT (list 6) if SWMS_NOV2_WORDING_ON |
| 83 | 83-installer-install-day-view-morning.png | installer | A1 | install-day view, morning of the install (safety plan signed) | Part 7 install-day view (/field/day): crew, safety plan, Mitti form, GO status. | none | DRAFT (list 10): 'Your crew', 'Signed', 'Opening…', 'Install form not ready yet' |
| 84 | 84-office-job-esc-notice-go-check.png | office | A1 | office job page — ESC notice recorded (withdraw card), 2pm GO check passed | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 85 | 85-office-needs-me-day-before-install.png | office | A1 | Needs me — day before the install | Office Needs me (phase 3 office redesign): Today / This week / Watch, 'Include TEST jobs'. | none | DRAFT office rows per list 41/45/48/49/54 when they occur |

### Batch 18 — items 86–90

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 86 | 86-installer-install-day-view-go.png | installer | A1 | install-day view — GO, Install tomorrow text sent | Part 7 install-day view (/field/day): crew, safety plan, Mitti form, GO status. | none | DRAFT (list 10): 'Your crew', 'Signed', 'Opening…', 'Install form not ready yet' |
| 87 | 87-installer-job-day-before-install.png | installer | A1 | job page the day before the install | Install booked box: 'Safety plan signed n of m', 'Lead Installer locks {Ddd D Mmm, 5pm}', Change time / Change Lead Installer, consent + deposit ticks, 'Today's job', pay rule V2, 'Check my form now'. | NO_FORM_NO_PAY_V2_APPROVED (ON); LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED (the 9am email) | APPROVED pay block; DRAFT (list 10): 'Your crew', 'Signed: n of total' |
| 88 | 88-installer-job-installed.png | installer | A1 | installation recorded from the A5 | Installation recorded from the A5 (ruler photos per area, product labels reviewed by the office). | none | — |
| 89 | 89-installer-install-day-view-done.png | installer | A1 | install-day view after the install was recorded | Part 7 install-day view (/field/day): crew, safety plan, Mitti form, GO status. | none | DRAFT (list 10): 'Your crew', 'Signed', 'Opening…', 'Install form not ready yet' |
| 90 | 90-office-job-installed.png | office | A1 | office job page — installation recorded (labels reviewed) | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |

### Batch 19 — items 91–95

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 91 | 91-owner-my-job-all-done.png | owner | A1 | My job home — All done: sign the rebate form, pay the balance | All done (Part 4/8): sign the rebate form Section 4 on the link (over 18 + Section 2 ticks), pay the balance; All done screen. | ALL_DONE_V2_APPROVED / AFTER_INSTALL_REMINDERS_APPROVED (the emails) | — |
| 92 | 92-owner-rebate-form-section-4.png | owner | A1 | rebate form (VEEC) Section 4 signing screen | All done (Part 4/8): sign the rebate form Section 4 on the link (over 18 + Section 2 ticks), pay the balance; All done screen. | ALL_DONE_V2_APPROVED / AFTER_INSTALL_REMINDERS_APPROVED (the emails) | — |
| 93 | 93-owner-balance-page.png | owner | A1 | balance page — the rest on install day | All done (Part 4/8): sign the rebate form Section 4 on the link (over 18 + Section 2 ticks), pay the balance; All done screen. | ALL_DONE_V2_APPROVED / AFTER_INSTALL_REMINDERS_APPROVED (the emails) | — |
| 94 | 94-owner-my-job-rebate-signed.png | owner | A1 | My job home — rebate form signed, balance owing | All done (Part 4/8): sign the rebate form Section 4 on the link (over 18 + Section 2 ticks), pay the balance; All done screen. | ALL_DONE_V2_APPROVED / AFTER_INSTALL_REMINDERS_APPROVED (the emails) | — |
| 95 | 95-owner-all-done-screen.png | owner | A1 | All done screen (?screen=done) | All done (Part 4/8): sign the rebate form Section 4 on the link (over 18 + Section 2 ticks), pay the balance; All done screen. | ALL_DONE_V2_APPROVED / AFTER_INSTALL_REMINDERS_APPROVED (the emails) | — |

### Batch 20 — items 96–100

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 96 | 96-installer-money.png | installer | A1 | Money — install + PIESA rows | Part 5 T8 Money: Coming to you / Paid this month, pay-rule line V2. | NO_FORM_NO_PAY_V2_APPROVED (ON) | APPROVED: 'Paid 7 days after we approve the finished Mitti form. Your own customers: once they've paid in full.' DRAFT (list 9): 'Paid 7 days after we approve the PIESA form' |
| 97 | 97-installer-money-job.png | installer | A1 | Money — this job | Part 5 T8 Money: Coming to you / Paid this month, pay-rule line V2. | NO_FORM_NO_PAY_V2_APPROVED (ON) | APPROVED: 'Paid 7 days after we approve the finished Mitti form. Your own customers: once they've paid in full.' DRAFT (list 9): 'Paid 7 days after we approve the PIESA form' |
| 98 | 98-installer-job-done.png | installer | A1 | job page — done | Money for this job: PIESA pay row at the installer's own rate; install row appears once the owner has paid in full. | NO_FORM_NO_PAY_V2_APPROVED (ON) | — |
| 99 | 99-installer-my-work-done.png | installer | A1 | My work — job done | Redesigned My work (Part 5): greeting, Your turn / All jobs pills, search, one card per job with the next action button. Live today: old job list. | none (Part 5 screens, no flag) | — |
| 100 | 100-office-money-payouts.png | office | A1 | Money / Payouts after the install | Office Money / Payouts. | none | DRAFT (list 33): 'No PIESA rate set — ask the office' when it occurs |

### Batch 21 — items 101–105

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 101 | 101-office-job-done.png | office | A1 | office job page — all done, VEEC ready | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 102 | 102-office-needs-me-done.png | office | A1 | Needs me after the job | Office Needs me (phase 3 office redesign): Today / This week / Watch, 'Include TEST jobs'. | none | DRAFT office rows per list 41/45/48/49/54 when they occur |
| 103 | 103-a2-owner-my-job-save-my-spot.png | owner | A2 | My job home after the website enquiry — Save my spot | Decision 388 Save my spot card on My job (HIV lead). | none (O1 email HELD by decision 388) | — |
| 104 | 104-a2-owner-save-my-spot-screen.png | owner | A2 | Save my spot screen (?screen=spot) | Decision 388 Save my spot card on My job (HIV lead). | none (O1 email HELD by decision 388) | — |
| 105 | 105-a2-office-needs-me-enquiry.png | office | A2 | Needs me — new website enquiry | Office Needs me (phase 3 office redesign): Today / This week / Watch, 'Include TEST jobs'. | none | DRAFT office rows per list 41/45/48/49/54 when they occur |

### Batch 22 — items 106–110

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 106 | 106-a2-office-enquiries.png | office | A2 | Enquiries | Office Enquiries list / job page for a website lead. | none | — |
| 107 | 107-a2-office-job-enquiry.png | office | A2 | office job page — website lead before Save my spot | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 108 | 108-a2-owner-my-job-spot-saved.png | owner | A2 | My job home — spot saved | 'You're all set' resting screen between steps (no dates shown — see LOOKS WRONG). | none | — |
| 109 | 109-a2-office-area-batches.png | office | A2 | Area batches — one spot saved, ready to Send to an installer | A48 batch 2 Area batches page: Send to owners, answers, day-3 close, 'Send to installer'. | none | — |
| 110 | 110-a2-owner-my-job-its-your-turn.png | owner | A2 | My job home — It's your turn | It's your turn: the owner lands on the quick taps (name + address confirm first). | IT_IS_YOUR_TURN_V2_APPROVED (the email/text that opens it) | — |

### Batch 23 — items 111–115

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 111 | 111-a2-owner-its-your-turn-screen.png | owner | A2 | It's your turn landing (?screen=turn) | ?screen=turn is the OLD one-by-one Release landing — it now says the link has closed (area batches use ?screen=taps). | — | — |
| 112 | 112-a2-owner-quick-taps-1.png | owner | A2 | quick taps — first screen | It's your turn: the owner lands on the quick taps (name + address confirm first). | IT_IS_YOUR_TURN_V2_APPROVED (the email/text that opens it) | — |
| 113 | 113-a2-owner-quick-taps-hatch.png | owner | A2 | quick taps — manhole / hatch question | Quick taps questions (hatch, roof, last 5 years). | none | — |
| 114 | 114-a2-owner-quick-taps-roof.png | owner | A2 | quick taps — roof question | Quick taps questions (hatch, roof, last 5 years). | none | — |
| 115 | 115-a2-owner-quick-taps-five-years.png | owner | A2 | quick taps — built / ceiling replaced in the last 5 years | Quick taps questions (hatch, roof, last 5 years). | none | — |

### Batch 24 — items 116–120

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 116 | 116-a2-owner-quick-taps-rental-lives.png | owner | A2 | quick taps — 'Do you live there or is it rented?' (RENTAL_TAPS_APPROVED forced ON in this run) | Rental questions group (Part 4/5 Task 19): 'Do you live there or is it rented?' then tenant name/mobile/email, who lets us in. Shown only because RENTAL_TAPS_APPROVED was forced ON for this run. | RENTAL_TAPS_APPROVED (off today) — see list 27 decision for Jo | DRAFT (list): every label except 'Do you live there or is it rented?' / 'I live there' / 'It's rented' |
| 117 | 117-a2-owner-quick-taps-rental-tenant.png | owner | A2 | quick taps — rental: tenant details (DRAFT wording) | Rental questions group (Part 4/5 Task 19): 'Do you live there or is it rented?' then tenant name/mobile/email, who lets us in. Shown only because RENTAL_TAPS_APPROVED was forced ON for this run. | RENTAL_TAPS_APPROVED (off today) — see list 27 decision for Jo | DRAFT (list): every label except 'Do you live there or is it rented?' / 'I live there' / 'It's rented' |
| 118 | 118-a2-owner-quick-taps-rental-tenant-filled.png | owner | A2 | quick taps — rental: tenant details typed (not sent) | Rental questions group (Part 4/5 Task 19): 'Do you live there or is it rented?' then tenant name/mobile/email, who lets us in. Shown only because RENTAL_TAPS_APPROVED was forced ON for this run. | RENTAL_TAPS_APPROVED (off today) — see list 27 decision for Jo | DRAFT (list): every label except 'Do you live there or is it rented?' / 'I live there' / 'It's rented' |
| 119 | 119-a2-installer-my-work-not-yet.png | installer | A2 | My work — the batch was sent to owners, installer not contacted yet | Redesigned My work (Part 5): greeting, Your turn / All jobs pills, search, one card per job with the next action button. Live today: old job list. | none (Part 5 screens, no flag) | — |
| 120 | 120-a2-owner-my-job-taps-done.png | owner | A2 | My job home — quick taps answered, waiting for the installer's day | After the taps: waiting for the installer's day. | none | — |

### Batch 25 — items 121–125

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 121 | 121-a2-office-area-batch-answers.png | office | A2 | Area batches — the owner said yes | A48 batch 2 Area batches page: Send to owners, answers, day-3 close, 'Send to installer'. | none | — |
| 122 | 122-a2-office-area-batch-ready-to-send.png | office | A2 | Area batches — closed, Send to installer | A48 batch 2 Area batches page: Send to owners, answers, day-3 close, 'Send to installer'. | none | — |
| 123 | 123-a2-office-needs-me-batch-closed.png | office | A2 | Needs me — batch closed, send to installer | Office Needs me (phase 3 office redesign): Today / This week / Watch, 'Include TEST jobs'. | none | DRAFT office rows per list 41/45/48/49/54 when they occur |
| 124 | 124-a2-installer-my-work-run-offered.png | installer | A2 | My work — a run of Ready Checks to pick a day for | Redesigned My work (Part 5): greeting, Your turn / All jobs pills, search, one card per job with the next action button. Live today: old job list. | none (Part 5 screens, no flag) | — |
| 125 | 125-a2-installer-run-pick-day.png | installer | A2 | run page — pick the day (Portal books) | Part 7 Task 9 run page (Portal books): the installer picks the run day; nobody texted. | none | — |

### Batch 26 — items 126–130

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 126 | 126-a2-owner-my-job-confirm-window.png | owner | A2 | My job home — your Ready Check window, confirm | Owner confirms their Ready Check window after the installer picked the day — see LOOKS WRONG. | none | — |
| 127 | 127-a2-owner-confirm-window-screen.png | owner | A2 | confirm the Ready Check window (?screen=book) | Owner confirms their Ready Check window after the installer picked the day — see LOOKS WRONG. | none | — |
| 128 | 128-a2-installer-run-day-chosen.png | installer | A2 | run page — day chosen, owners confirming | Part 7 Task 9 run page (Portal books): the installer picks the run day; nobody texted. | none | — |
| 129 | 129-a2-owner-my-job-ready-check-booked.png | owner | A2 | My job home — Ready Check booked | 'You're all set' resting screen between steps (no dates shown — see LOOKS WRONG). | none | — |
| 130 | 130-a2-installer-job-ready-check-booked.png | installer | A2 | job page — Ready Check booked (HIV lead) | HIV-lead job page: 'Home Insulation Victoria lead' chip; after Complete: 'Quote being prepared — Home Insulation Victoria is checking the quote.' (no price card on a lead). | none | DRAFT (list 23): 'Quote being prepared', 'Home Insulation Victoria is checking the quote.' |

### Batch 27 — items 131–135

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 131 | 131-a2-installer-my-work-ready-check-booked.png | installer | A2 | My work — Ready Check day | Redesigned My work (Part 5): greeting, Your turn / All jobs pills, search, one card per job with the next action button. Live today: old job list. | none (Part 5 screens, no flag) | — |
| 132 | 132-a2-office-job-ready-check-booked.png | office | A2 | office job page — Ready Check booked | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 133 | 133-a2-installer-job-ready-check-done.png | installer | A2 | job page — Ready Check done, HIV prices it (no price card on a lead) | HIV-lead job page: 'Home Insulation Victoria lead' chip; after Complete: 'Quote being prepared — Home Insulation Victoria is checking the quote.' (no price card on a lead). | none | DRAFT (list 23): 'Quote being prepared', 'Home Insulation Victoria is checking the quote.' |
| 134 | 134-a2-office-job-quote-to-check.png | office | A2 | office job page — draft quote held for the office (old insulation kept) | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 135 | 135-a2-office-needs-me-quote-to-check.png | office | A2 | Needs me — quote to check | Office Needs me (phase 3 office redesign): Today / This week / Watch, 'Include TEST jobs'. | none | DRAFT office rows per list 41/45/48/49/54 when they occur |

### Batch 28 — items 136–140

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 136 | 136-a2-owner-my-job-quote-ready.png | owner | A2 | My job home — your quote is ready (kept insulation) | Owner quote page (O18 v4 look on screen): Your rebate, Your price, lines incl. 'Electrical safety check (PIESA) $349' at the installer's own rate (Jo 4 Nov), 'Not included: electrical upgrades…', two ticks + typed name, how you pay, 30-day line. | OWNER_QUOTE_EMAIL_V4_APPROVED (email); screen unflagged | — |
| 137 | 137-a2-owner-quote-page-kept-insulation.png | owner | A2 | quote page — with the 'Your old insulation stays' line | Owner quote page (O18 v4 look on screen): Your rebate, Your price, lines incl. 'Electrical safety check (PIESA) $349' at the installer's own rate (Jo 4 Nov), 'Not included: electrical upgrades…', two ticks + typed name, how you pay, 30-day line. | OWNER_QUOTE_EMAIL_V4_APPROVED (email); screen unflagged | — |
| 138 | 138-a2-office-job-quote-sent.png | office | A2 | office job page — quote sent | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 139 | 139-a2-owner-sign-and-pay-filled.png | owner | A2 | Sign and pay — both ticks + name typed (templates loaded, kept-insulation line) | Sign and pay = the quote page's SAY YES block; pressing the button opens the 6-digit code gate (TEST jobs show the code on screen). | none | — |
| 140 | 140-a2-owner-sign-and-pay-code-gate.png | owner | A2 | Sign and pay — the code gate | Sign and pay = the quote page's SAY YES block; pressing the button opens the 6-digit code gate (TEST jobs show the code on screen). | none | — |

### Batch 29 — items 141–145

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 141 | 141-a2-owner-my-job-accepted-pay-349.png | owner | A2 | My job home — accepted, pay $349 | After accepting: PAYMENT card — PIESA $349 by card (Stripe) or bank transfer with BSB/reference. | none | — |
| 142 | 142-a2-owner-pay-349.png | owner | A2 | pay page — $349 safety check | After accepting: PAYMENT card — PIESA $349 by card (Stripe) or bank transfer with BSB/reference. | none | — |
| 143 | 143-a2-installer-job-accepted.png | installer | A2 | job page — owner accepted (HIV lead) | Next step 'Book the PIESA' for the Team electrician (Part 6 in-house booking) — refused until the $349 is paid (payment gate). | none | DRAFT (list 7): 'Choose the electrician' |
| 144 | 144-a2-office-job-accepted.png | office | A2 | office job page — accepted | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 145 | 145-a2-owner-my-job-349-paid.png | owner | A2 | My job home — $349 paid, electrician to come | 'You're all set' resting screen between steps (no dates shown — see LOOKS WRONG). | none | — |

### Batch 30 — items 146–150

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 146 | 146-a2-office-job-349-paid.png | office | A2 | office job page — $349 paid, electrician offer | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 147 | 147-a2-electrician-login-my-work.png | electrician (REC login) | A2 | REC electrician's My work — offer accepted, times sent | A REC electrician's old login now sees 'You don't need to sign in. Your jobs come to you by text.' (Part 6: electricians never log in). | none | 'You don't need to sign in…' (NO_LOGIN_NEEDED) |
| 148 | 148-a2-electrician-login-my-work.png | electrician (REC login) | A2 | REC electrician's My work — offer accepted, times sent | A REC electrician's old login now sees 'You don't need to sign in. Your jobs come to you by text.' (Part 6: electricians never log in). | none | 'You don't need to sign in…' (NO_LOGIN_NEEDED) |
| 149 | 149-a2-electrician-offer-page.png | electrician (REC login) | A2 | the PIESA offer page | A REC electrician's old login now sees 'You don't need to sign in. Your jobs come to you by text.' (Part 6: electricians never log in). | none | 'You don't need to sign in…' (NO_LOGIN_NEEDED) |
| 150 | 150-a2-electrician-job-page.png | electrician (REC login) | A2 | electrician's job page | A REC electrician's old login now sees 'You don't need to sign in. Your jobs come to you by text.' (Part 6: electricians never log in). | none | 'You don't need to sign in…' (NO_LOGIN_NEEDED) |

### Batch 31 — items 151–155

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 151 | 151-a2-owner-my-job-pick-piesa-time.png | owner | A2 | My job home — pick a safety check time | Owner picks one of the HIV electrician's 3 times with the 30-day tick — behind the code gate ('Let's check it's you'). | none | — |
| 152 | 152-a2-owner-pick-piesa-time-screen.png | owner | A2 | pick one of the electrician's 3 times + the 30-day tick (?screen=piesa) | Owner picks one of the HIV electrician's 3 times with the 30-day tick — behind the code gate ('Let's check it's you'). | none | — |
| 153 | 153-a2-owner-my-job-piesa-booked.png | owner | A2 | My job home — safety check booked | 'You're all set' resting screen between steps (no dates shown — see LOOKS WRONG). | none | — |
| 154 | 154-a2-electrician-job-piesa-booked.png | electrician (REC login) | A2 | electrician's job page — PIESA booked | A REC electrician's old login now sees 'You don't need to sign in. Your jobs come to you by text.' (Part 6: electricians never log in). | none | 'You don't need to sign in…' (NO_LOGIN_NEEDED) |
| 155 | 155-a2-office-job-piesa-booked.png | office | A2 | office job page — PIESA booked | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |

### Batch 32 — items 156–160

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 156 | 156-a2-owner-my-job-piesa-pass.png | owner | A2 | My job home — safety check passed, confirm + deposit | ONE LAST STEP page (Part 4): STEP 1 confirm the safety check (result + 30-day/void line), STEP 2 the ESC consent form (four ticks), one typed name signs both, STEP 3 pay the 10% deposit; afterwards 'Your deposit is paid'. | none | — |
| 157 | 157-a2-owner-piesa-confirm-pass.png | owner | A2 | confirm the safety check (all clear) | ONE LAST STEP page (Part 4): STEP 1 confirm the safety check (result + 30-day/void line), STEP 2 the ESC consent form (four ticks), one typed name signs both, STEP 3 pay the 10% deposit; afterwards 'Your deposit is paid'. | none | — |
| 158 | 158-a2-electrician-job-piesa-done.png | electrician (REC login) | A2 | electrician's job page — PIESA complete | A REC electrician's old login now sees 'You don't need to sign in. Your jobs come to you by text.' (Part 6: electricians never log in). | none | 'You don't need to sign in…' (NO_LOGIN_NEEDED) |
| 159 | 159-a2-installer-job-piesa-pass.png | installer | A2 | job page — safety check passed | HIV-lead counterparts of the A1 screens. | none | — |
| 160 | 160-a2-office-job-piesa-pass.png | office | A2 | office job page — PIESA pass | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |

### Batch 33 — items 161–165

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 161 | 161-a2-owner-my-job-deposit-paid.png | owner | A2 | My job home — deposit paid | ONE LAST STEP page (Part 4): STEP 1 confirm the safety check (result + 30-day/void line), STEP 2 the ESC consent form (four ticks), one typed name signs both, STEP 3 pay the 10% deposit; afterwards 'Your deposit is paid'. | none | — |
| 162 | 162-a2-installer-job-offer-install-days.png | installer | A2 | job page — offer 3 install days | HIV lead: the installer offers 3 install days (decision 296/325) once the deposit is paid. | INSTALL_DAYS_EMAIL_APPROVED (ON) | — |
| 163 | 163-a2-installer-job-install-days-offered.png | installer | A2 | job page — 3 install days offered | HIV lead: the installer offers 3 install days (decision 296/325) once the deposit is paid. | INSTALL_DAYS_EMAIL_APPROVED (ON) | — |
| 164 | 164-a2-owner-my-job-confirm-piesa-first.png | owner | A2 | My job home — confirm the safety check before picking a day | ONE LAST STEP page (Part 4): STEP 1 confirm the safety check (result + 30-day/void line), STEP 2 the ESC consent form (four ticks), one typed name signs both, STEP 3 pay the 10% deposit; afterwards 'Your deposit is paid'. | none | — |
| 165 | 165-a2-owner-my-job-pick-install-day.png | owner | A2 | My job home — pick your install day | ONE LAST STEP page (Part 4): STEP 1 confirm the safety check (result + 30-day/void line), STEP 2 the ESC consent form (four ticks), one typed name signs both, STEP 3 pay the 10% deposit; afterwards 'Your deposit is paid'. | none | — |

### Batch 34 — items 166–170

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 166 | 166-a2-owner-pick-install-day-screen.png | owner | A2 | pick one of the 3 install days (?screen=book) | ONE LAST STEP page (Part 4): STEP 1 confirm the safety check (result + 30-day/void line), STEP 2 the ESC consent form (four ticks), one typed name signs both, STEP 3 pay the 10% deposit; afterwards 'Your deposit is paid'. | none | — |
| 167 | 167-a2-owner-my-job-install-booked.png | owner | A2 | My job home — install booked | 'You're all set' resting screen between steps (no dates shown — see LOOKS WRONG). | none | — |
| 168 | 168-a2-installer-job-install-booked.png | installer | A2 | job page — install booked | Install booked box: 'Safety plan signed n of m', 'Lead Installer locks {Ddd D Mmm, 5pm}', Change time / Change Lead Installer, consent + deposit ticks, 'Today's job', pay rule V2, 'Check my form now'. | NO_FORM_NO_PAY_V2_APPROVED (ON); LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED (the 9am email) | APPROVED pay block; DRAFT (list 10): 'Your crew', 'Signed: n of total' |
| 169 | 169-a2-installer-my-work-install-booked.png | installer | A2 | My work — install day | Redesigned My work (Part 5): greeting, Your turn / All jobs pills, search, one card per job with the next action button. Live today: old job list. | none (Part 5 screens, no flag) | — |
| 170 | 170-a2-installer-money.png | installer | A2 | Money — HIV lead job | Part 5 T8 Money: Coming to you / Paid this month, pay-rule line V2. | NO_FORM_NO_PAY_V2_APPROVED (ON) | APPROVED: 'Paid 7 days after we approve the finished Mitti form. Your own customers: once they've paid in full.' DRAFT (list 9): 'Paid 7 days after we approve the PIESA form' |

### Batch 35 — items 171–172

| # | Picture | Who | Job | Stage | What's new vs today's live portal | Flag | DRAFT wording visible |
|---|---|---|---|---|---|---|---|
| 171 | 171-a2-office-job-install-booked.png | office | A2 | office job page — install booked | Office job page (phase 3 compact page): sections 1 Enquiry … 6 Final check, Money, Contact history, File. | none | see LOOKS WRONG (ISO dates, 'pIESA') |
| 172 | 172-a2-office-money.png | office | A2 | Money — HIV lead | Office Money / Payouts. | none | DRAFT (list 33): 'No PIESA rate set — ask the office' when it occurs |

## Messages generated in the runs
See `messages/` — `a1-email-NN-<subject>.txt`, `a1-text-NN.txt`, `a2-…`. These are the same builders pack 1 pictured; they are here so the screens can be read next to what the person was sent at that moment.


## How it was built (so it can be re-run)
`_build/journey-a1.shots.test.ts` / `journey-a2.shots.test.ts` = the two journey tests with a pause after every step (`_build/fake-supabase.ts` serves the PGlite rows as Supabase over HTTP on :54321 and gates the steps); `_build/vite-env.sh` + `_build/vite.shots.config.ts` + `_build/vite-preload.mjs` run the real portal on :8080 against it with the providers forwarded to the journey's fakes; `_build/plan-*.mjs` are the screenshot plans (`_build/go.sh plan-a1-p0.mjs` …). Nothing in src changed; nothing was sent; the live database was never touched.

# Jo's decisions – running log

Newest first. Each line is settled; anything still open is under "Open".

## 24 Oct 2026 (tap answers)

**Deep checks and tests**
1. Install days: once the safety check is cleared, the **installer offers 3 days** inside the 30. The owner picks one or suggests other days, and they go back and forth until one is agreed. **The office is never involved.** The 30-day clock and the days left show clearly to both.
2. Safety net: **one** office alert if no day is agreed with 10 days left in the 30.
3. Test run: one TEST job and TEST Mitti Ready Check, filled in and Completed, then deleted. Approved.
4. Jo taps the Mitti form button on HV-3066 (phone and computer) herself.
5. Quote price holds (insulation $15–30/m², removal $5–15/m², access fee over $500) apply **only to our leads (A2)**. On the installer's own jobs (A1) he charges what he wants. Only our AP fee and the electrician fees must be right.
6. HV-3164 "Test-Deep": delete (soft delete).
7. Remove the old installer quote-approval code and the "Waiting on installer" UI.

**Go-live and Deep's email**

8. Go live once the tests pass **and Jo has seen the screens** (confirm on the day).
9. Missing surnames (HV-3118, 3119, 3139, 3144) and the unit number (HV-3146) are asked for in Deep's email.

**Payments (all by Stripe card, fee absorbed)**

10. Jo has a Stripe account.
11. HIV absorbs the card fee; the owner pays clean amounts.
12. **Accept + pay $349 in one step, switched on straight away** (Jo chose not to wait for the lawyer).
13. Install payments: **10% deposit of what's left on the invoice (after the $349)**, due when the owner books the install date (corrected by Jo, 24 Oct), the remainder on install day, and **always an option to pay the full amount now**.
14a. Unpaid agreed install day (owner suggested it, installer accepted it) is held 48 hours for the 10% deposit, then released and the installer is told.
14. Electrical fixes: the office checks the fixes quote before it goes. The owner then **approves, pays in full and picks one of the electrician's times in one step**. If none of the times suit, the owner and the electrician go back and forth. The office is not involved.

**Templates (after Deep)**

15. Review format: one review page, a card per email or text (phone preview, who, when, auto or pressed), one at a time.
16. When messages switch back on: **cancel all** held and queued messages (4 held first replies HV-3166–3169, about 70 reminder texts) and start fresh.
17. The 2 owners who got the draft existing-insulation line: leave it.
18. Draft the AP forms schedule (which form, to whom, when, how) and review it with the templates.

**Earlier on 24 Oct (already built on the branch)**
- Installer gets an email when the owner accepts.
- "Not eligible – close" records the decision and sends the approved T7.
- Owner quote email v3 approved.
- Owners can decline a quote.
- First weeks: quotes are prepared on Complete and the office presses Send.

## Open
- Lawyer: owner-terms wording for "whoever's move pays for a new safety check" (unfair contract terms).
- Lawyer: cooling-off for unsolicited sales (no payment in 10 business days?) and the domestic building deposit limits (10% under $20k, 5% at $20k or more), since $349 plus 10% of the total can be more than 10% of the price.

## 24 Oct 2026 (later)
19. Reschedule a booked install day: either side taps "Change day", and it's the same back-and-forth (the installer offers 3 new days inside the 30). No office.
20. Testing setup: put the branch on the Lovable test copy (not published) for the screen review and the TEST run. Messages stay off and quotes wait for office Send.
21. **Many installers, not just Deep.** Everything is built for every installer. The Deep email becomes a standard "How it works" guide: emailed to each installer when approved, and kept as a help page in their portal. Deep's job list is a one-off extra for him.
22. To check: whether Mitti can invite a new installer automatically on approval (today it's a manual office step).
23. 30 days after the safety check runs out with nothing booked: **whoever's move it was pays for the new safety check**. The installer's share comes out of their payout; the owner pays $349 again. **No exceptions** (storm, illness and so on are still whoever's move). It goes in the installer agreement and the owner's acceptance terms (lawyer to check the owner wording), plus a plain line on the install-day screens.
24. Reminders to whoever's move it is at **20 and 10 days left** (wording reviewed in the template review).

## Our leads in the installer portal (24 Oct 2026)
25. On our leads the installer sees **quote status only** (sent / accepted / declined) and their own pay. Never the owner's price or our margin.
26. Our-lead owner price comes from **our fixed price list** (R5/R6/R7 per m²). The installer is paid their agreed rates. (Corrects my earlier wording.)
27. Electrician on our leads: most installers have one in house. Their **saved usual electrician does the safety check by default** and is paid our standard electrician rate; the owner still pays us $349. If none is saved, we arrange one.
28. Keep the visit-day tick on our leads ("I will not discuss pricing with the owner").
29. The Ready Check visit on our leads is **free** (as the agreement says). The installer is paid for the install.
30. Installer pay on our leads: **keep the agreement**. Paid within 7 days of our approval; owner payment is not a condition. (Jo first chose "+ owner paid in full", then kept the signed agreement.)
31. The office keeps installers' own jobs separate: "New from installers" and the installer summary stay their-own-jobs only.
32. Apply 0224 live: installers can't read the owner's price on our leads (database).
33. Keep the "Not drafted yet" section on Quotes to check.
34. **Add a job = basics only**: owner's full name, address picked from the list, mobile, email, and the "owner agreed to be contacted" tick. Everything else (visit, measurements, existing insulation, removal, price, product, electrician) is answered in the Mitti Ready Check form. Bulk upload uses the same basics.
35. HV-3151 moved onto the Ready Check path (live, at Jo's request). Its Mitti form follows within 24 hours (retry wait after the earlier failure).
36. **Installer job page: simple layout.**
    - Owner, address, and Call / Text / Directions.
    - One "What's next" line (whose move it is) with one button, e.g. Open Mitti form.
    - Short "still missing in your Mitti form" list.
    - Quote status ("See the owner's quote" on their own jobs only).
    - Install days at that stage.
    - Messages.
    - Removed: the old intake "Measurements and quote" card and "Add or update details", the owner eligibility questions link, and the long blocker lists before the install stage.
37. Evidence and paperwork lists show **only from the install stage** (install day booked onwards), as a checklist.
38. Remove the "What's happened" history from the installer's job page.
39. Staff job links ("Create job link") go behind a "More" button.
40. Ready-made messages must match the new install-day flow (wording to be refined in the template review).
41. **Installer portal look: Style A, calm and light.** White background, thin divider lines, small soft text (Inter, 15–19 px, weight 400–600), one blue button per screen and no big bold type. Each screen says one thing first ("Next: …") with one button. Mock-ups: https://claude.ai/artifact/DE3FdfTaYmnNkQ9kMyFd1e
42. **No spreadsheet upload for installers.** They add jobs one at a time with a picked address. Bulk import is for the office only: a new installer sends us their list, and the office imports it and checks every address.
43. **Install days include a time.** For each offered day the installer **selects an arrival time**, and the owner sees that exact time (e.g. "Tue 27 Oct at 7:30am"). No window. (Jo corrected 24 Oct.)
44. New owner email **"Your install is booked"**, sent once a day and time are agreed. It covers: when, installer, address; before the day (sign the install consent 24 hours before, pay the 10% or the full amount); on the day (an adult home, clear the hatch area, parking, pets); what happens (before and after photos for the VEU, a few hours, balance due on the day); Change day link. A draft is in the chat; the wording is finalised in the template review.
45. Install-booked email: on removal jobs, add a line about extra dust and a longer day.
46. Install-booked email includes the installer's phone number.
47. **Installer mock-up screens 1–7 approved**: build them in Style A (mock-ups at the link in 41; source in the session scratchpad mock/project/*.dc.html).

**Working rule (Jo):** ask every question as tap-boxes, always.
48. Each installer job shows a small quiet grey label under the address: **"Your customer"** (their own job) or **"Home Insulation Victoria lead"** (our lead). It appears on the My work list and the job page.

## How our leads reach installers (24 Oct 2026)
49. **The office picks the installer** for each of our leads, on the job in the office screen. A "Choose installer" list shows nearby approved installers with their area and rates; tapping one sends the offer to that installer only. There is no automatic batch offering.
50. The installer is told by **text and in the app**. Text (wording in the template review): "New job offer near [suburb] – tap to see times", with a link straight to the offer.
51. An offer stays open **24 hours**. If the installer says "Not for me" or doesn't answer, it **goes back to the office** (one alert on the job) to pick another installer.
52. **Our-lead Ready Check: the installer offers the times.**
    1. The office picks the installer, who gets a text.
    2. The installer accepts by offering the owner **3 Ready Check times (day and time)** within 24 hours.
    3. The owner picks one (booked) or suggests other days, back and forth like install days.
    No answer or "Not for me" goes back to the office.
53. **Remove the owner's "pick Ready Check times" step** from Save my spot. The owner waits for the installer's times (a link by email or text; wording in the template review).
54. **Installer's own customers: they arrange the Ready Check visit directly with the owner. Nothing is entered in the portal.** They open the Mitti form when they are there. Any "book Ready Check time" step is hidden on their own jobs.

## Template review – batch 1, owner first messages (24 Oct 2026)
55. O3, O1, O2 and O2b say **"estimate"**, not "quote". "Quote" is kept for the real quote after the Ready Check.
56. O1, O2, O2b, O10 and O17: the Ready Check line becomes **"When an installer is free near you, they'll offer you times for your free Ready Check."**
57. O2 draft line **approved**: "You told us there is some existing insulation in your ceiling. Your free Ready Check checks what's there and confirms whether you qualify before anything goes ahead."
58. O17 Spot saved text: **add "Reply STOP to opt out."**
59. O3 and O10: Jo wants changes (details to follow).
60. **Master touchpoint list** (62 items: enquiry → Ready Check → quote → PIESA → install → after install and aftercare → trades). Saved as docs/TOUCHPOINTS_MASTER.html. Each item gets reviewed one at a time, wording and design. Style direction for owner emails: premium, value-first, built around **"we bring the right people together so you get the rebate"** (Save my spot redesign v3).
61. Our-lead Ready Check times:
    - The owner taps a time with the **secure link only** (no 6-digit code).
    - The installer's 3 times must be on **3 different days**.
    - Times up to **21 days ahead, 7am–5pm**.
62. New-offer texts to installers are **held overnight (8pm–7am) and sent at 7am**. The 24-hour clock starts when the text is sent.
63. When an offer closes after 24 hours with no answer, only the office is alerted; the installer is not texted.
64. When the installer's Ready Check times are ready, the owner gets an **email and a text** (wording in the template review).
65. First email structure: **one Save my spot email** (no insulation / some / thin or patchy, with small wording changes; "may qualify" and removal shown first when there's some insulation), plus a **separate "check your ceiling" email for "not sure"**. All in the new design.

66. **Save my spot email approved (24 Oct).** Short version: heading "you could save $1,610 on ceiling insulation"; intro "To claim it, you need a certified installer, a licensed electrician and an accredited provider. We bring them all together and organise the whole job for you."; old-template price box (green "You save", big "You pay after the rebate", full price crossed out, "Based on what you told us" + calculator link); "Save your spot, it's free" explainer + button; "What's included" (free Ready Check, licensed electrician safety check, R5.0 batts AS/NZS 4859.1, EEC CII installer to AS 3999, we handle the rebate as AP A003654); "Not included, only if needed" (removal, access fee, electrical fixes, bigger ceiling). Jo confirmed for every job: R5.0 AS/NZS 4859.1 batts, EEC CII installers, licensed electrician check. Approved design: `docs/templates/approved/O1-save-my-spot.html`.
67. **Save my spot, "some insulation" version approved (24 Oct).** Same as decision 66 with: heading "you may qualify for $1,610 off ceiling insulation"; below-R2.0 line in the intro; "potential rebate / cost if eligible" labels; a "Your existing insulation" card ("Good news: it may be able to stay." ✓ If it can stay $0 · + If some needs removing $15/m² incl. GST, only where needed, up to [area × $15] for their ceiling); "if it's already R2.0 or above, we'll let you know". Design: `docs/templates/approved/O2-save-my-spot-some-insulation.html`.
68. **"Check your ceiling" (photos/video) email retired (24 Oct).** Owners who said "not sure" get the approved "some insulation" Save my spot email (decision 67) and answer the 3 insulation questions on the Save my spot page. Replaces the separate "not sure" email in decision 65.
69. **Insulation questions email approved (24 Oct).** For "some insulation" and "not sure" owners: the decision-67 email with the save section "Save your spot: answer 3 quick questions" (type, thickness, when built; tap only), button "Answer & save my spot", and the optional safe photos/video line. Design: `docs/templates/approved/O2-save-my-spot-questions.html`.
70. **Spot saved email approved (24 Oct).** "Smart move, Helen. Your spot is saved." + green "Your $1,610 rebate is waiting."; demand line; two-figure price box (VEU rebate / You pay about); "What happens next" 3 steps (installer offers times → tap a time or suggest days → free Ready Check then exact price); See my job button; the same "What's included" and "Not included, only if needed" boxes as Save my spot (plus the existing-insulation card for those owners); friend card. Design: `docs/templates/approved/O10-spot-saved.html`.
71. **Spot saved text approved (24 Oct), version A:** "Home Insulation Victoria: Spot saved, {FirstName}! Your {rebate} rebate is waiting. When a certified installer is free near {Suburb}, we'll text you their times for your free Ready Check. Your job: {link} Reply STOP to opt out."
72. **Save my spot reminder text approved (24 Oct), version C:** "Home Insulation Victoria: Hi {FirstName}, installers are booking up. Save your free spot to keep your {rebate} rebate and get Ready Check times when one is free near you: {link} Reply STOP to opt out."
73. **Not eligible email approved (24 Oct).** Heading "{FirstName}, your ceiling insulation result"; "We'd rather tell you now than waste your time."; "Why" box with the reason; "Something doesn't look right?" + Review my result button; friend card. Design: `docs/templates/approved/O6-not-eligible.html`.
74. **Not in your area yet email approved (24 Oct).** Replaces the "service availability update": "{FirstName}, we're not in {Suburb} just yet"; could qualify, no checked installer + electrician covering {Suburb Postcode} yet, "we won't rush it"; "What happens now" (details kept, we'll email when one covers your area, no payment/obligation); friend card. Design: `docs/templates/approved/O7-not-in-area.html`.
75. **No email to installers' own customers when the installer adds the job (24 Oct).** Touchpoint 8 dropped. Their first message from us is the quote.
76. **Job offer text to installers approved (24 Oct), version A:** "Home Insulation Victoria: New Ready Check job near {Suburb} (about {area} m²). Offer the owner 3 times within 24 hours to take it: {link}"
77. **"Pick a time for your free Ready Check" email approved (24 Oct, our leads).** Heading "{FirstName}, pick a time for your free Ready Check"; "a certified installer near {Suburb} is ready for you"; the 3 offered times as tap buttons (day + time); "None suit? Suggest other days"; "At your Ready Check" line; two-figure price box; What's included / Not included boxes. Design: `docs/templates/approved/O11-ready-check-times.html`.
78. **Ready Check times text to owner approved (24 Oct), A:** "Home Insulation Victoria: Hi {FirstName}, good news! A certified installer near {Suburb} has offered 3 times for your free Ready Check. Tap to pick one: {link} Reply STOP to opt out."
79. **Owner-suggested-days text to installer approved (24 Oct), A:** "Home Insulation Victoria: The owner at {Suburb} ({HV-number}) suggested other days for their Ready Check. Tap to pick one and set a time: {link}"
80. **Ready Check "Change time", both sides (24 Oct, our leads).** Owner (job page) or installer (job screen) can change a booked Ready Check, like install days. Owner change → back to the installer to offer new times. Installer change → installer sets a new day + time. Either way the owner gets an updated "You're booked" email + text. The "You're booked" email is our leads only (installers' own jobs have no portal booking).
81. **"You're booked" Ready Check email approved (24 Oct, our leads).** Green date/time card with address and installer name + phone; "Before they arrive" (ceiling hatch clear, pets away, questions); "Need a different time? Tap Change time… or call or text {Installer}"; See my job; price box; included / not included. Design: `docs/templates/approved/O12-ready-check-booked.html`.
82. **Ready Check texts approved (24 Oct, our leads):**
    - Owner booked (B): "Home Insulation Victoria: Booked! Your free Ready Check is {Day Date}, {time}. Installer: {Installer} {phone}. Details: {link}"
    - Owner day before (B): "Home Insulation Victoria: See you tomorrow at {time} for your free Ready Check ({Installer}, {phone})."
    - Installer booked (A): "Home Insulation Victoria: Booked: Ready Check {Day Date} {time}, {address} ({HV-number}). Owner details on the job: {link}"
83. **Installer texts approved (24 Oct):**
    - Morning (6:30am): "Home Insulation Victoria: Good morning! Your jobs today: 1) {time}, {short address}: {Mitti link} 2) … Tap a link to open its Mitti form." (falls back to the My work link when too long)
    - Missing answers: "Home Insulation Victoria: Nearly there! {HV} ({address}) still needs: {items}. Add them in Mitti and we'll prepare the owner's quote."
    - Usual electrician missing: "Home Insulation Victoria: To send the quote for {HV}, we need your usual electrician: name, licence number and price (inc GST). Add them once in My business: {link}"
84. **3 questions page approved (24 Oct).** Opens straight on the questions (no price box first): "ALMOST THERE, {NAME}" / "Answer 3 quick questions to save your spot" / "Just tap. It takes under a minute. Your {rebate} rebate is waiting."; "Question N of 3" tap buttons (decades in 2 columns); optional photos/video; Save my free spot stays locked until all 3 are answered, with a hint naming the unanswered question; "No longer interested" link. Design: `docs/templates/approved/P1-questions-page.html`.
85. **Questions email + page only for old enquiries (24 Oct).** The website has asked type, thickness and when built since 23 Oct, so new enquiries go straight to the right Save my spot email (no insulation, or some insulation with the removal card). Only owners who enquired before 23 Oct get the questions email (decision 69) and page (decision 84), via the "Tell us about your insulation" campaign.
86. **Quote email approved (24 Oct).** Short: "Hi {Name}, your quote is ready." / "You save {rebate} on ceiling insulation"; price box (green rebate, big price, full price crossed out, address, "Measured at your Ready Check"); View and accept button; "Your quote" itemised breakdown (product m² × rate with standards and installer, removal m² × $15, electrical safety check (PIESA), Accredited Provider fee, full price, VEU rebate, You pay); "Not included: electrical fixes…"; one-line Next; held-until line. Design: `docs/templates/approved/O18-quote-ready.html`.
87. **Quote ready text approved (24 Oct), B:** "Home Insulation Victoria: Your ceiling insulation quote is ready, {FirstName}. See it here: {link} Reply STOP to opt out."
88. **Quote reminders (24 Oct):** a short email + text 3 days after the quote is sent, and again 2 days before the price expires, only if not accepted or declined.
89. **Quote reminder wording approved (24 Oct):**
    - 3-day text (B): "Home Insulation Victoria: Hi {FirstName}, your quote with {rebate} off is waiting: {link} Reply STOP to opt out."
    - Expiry text (A): "Home Insulation Victoria: Hi {FirstName}, your quote price is held until {Day Date}. Accept by then to keep your {rebate} rebate price: {link} Reply STOP to opt out."
    - Reminder emails: the quote email's price box + button with a reminder line at the top; no breakdown.
90. **"You're in!" acceptance + $349 receipt email approved (24 Oct).** Payment received card (amount, date, card, Paid, remaining balance with the 10% / install-day split); next steps (electrician offers times; separate quote only if fixes needed; installer offers 3 install days within 30 days of the safety check); See my job; signed acceptance + receipt attached. Design: `docs/templates/approved/O22-youre-in.html`.
91. **Installer "Owner accepted" email approved (24 Oct).** "Good news, {InstallerFirst}. {OwnerFirst} accepted!"; accepted + paid the safety check; next steps (electrician offers times, nothing for you; offer 3 install days once cleared; install within 30 days, portal shows days left); Open the job. Design: `docs/templates/approved/I23-owner-accepted.html`.
92. **Owner declined → short installer email + office alert (24 Oct).** "{OwnerFirst} declined the quote for {address} ({HV}). Reason: {reason}. Nothing more to do; the job is closed." Same look as the accepted email.
93. **Safety check (PIESA) texts approved (24 Oct):**
    - To electrician (B): "Home Insulation Victoria: New PIESA job near {Suburb} ({HV}), {pay}. Offer the owner 3 times within 24 hours: {link}"
    - Owner booked (A): "Home Insulation Victoria: Booked! Your electrical safety check is {Day Date}, {time} with {Electrician} ({phone}). Details: {link}"
    - Owner day before: "Home Insulation Victoria: See you tomorrow at {time} for your electrical safety check ({Electrician}, {phone})."
94. **Safety check times email approved (24 Oct).** "{FirstName}, pick a time for your electrical safety check"; "{Electrician}, a licensed electrician, has offered these times"; 3 time buttons; Suggest other days; "At your safety check" (switchboard, ceiling wiring, downlights; already paid $349; fixes quoted separately first). The safety check booked email mirrors the Ready Check "You're booked" email (decision 81) with the electrician's name/phone and "make sure they can reach your switchboard and ceiling hatch". Design: `docs/templates/approved/O26-safety-check-times.html`.
95. **Electrical fixes quote email approved (24 Oct).** "{FirstName}, your safety check found something to fix first"; plain explanation; amber "What they found" list; itemised "Your fixes quote" with total incl. GST; "Checked by our office… Paid in full when you approve… Certificate of Electrical Safety… book your install day"; Approve and pay button. Design: `docs/templates/approved/O29-fixes-quote.html`.
96. **"Pick your install day" email approved (24 Oct).** "{FirstName}, pick your install day"; safety check clear, {Installer} offered these days; 3 day+time buttons; Suggest other days; "Lock in your day": 10% deposit (held 48 hours), rest on install day or pay in full now, install-by date (30 days after the safety check). Design: `docs/templates/approved/O33-install-days.html`.
97. **Install consent: sign to book (24 Oct).** When the owner taps an install day: sign the install consent (Reg 23A), then pay the 10% deposit, then it's booked. No signature = no booking, so nothing to chase. (To build with the Stripe deposit step.) "Pick your install day" email updated to say so.
98. **"Your install is booked" email approved (24 Oct).** "Consent signed and deposit received ✓"; day + arrival card with installer and phone; "⚡ Your power will be off" box (charge devices, fridge, medical equipment, working from home); "On the day" checklist (adult 18+, clear the hatch and path, move cars, pets away, removal dust line when removal is included); what happens + balance due on the day; Change day. Design: `docs/templates/approved/O35-install-booked.html`.
99. **Install-week and 30-day texts approved (24 Oct):**
    - Owner day before: "Home Insulation Victoria: See you tomorrow at {time} for your insulation install ({Installer}, {phone}). Reminder: power will be off while they work in the ceiling."
    - Installer day before: "Home Insulation Victoria: Install tomorrow {time}, {address} ({HV}). Job + forms: {link}"
    - 30-day window (20 and 10 days left, to whoever's move): "Home Insulation Victoria: {HV} has {N} days left to install (by {Day Date}). It's your move: {offer days / pick a day}: {link}"
100. **VEEC assignment (rebate) form signed at quote acceptance (Jo, 24 Oct).** Jo's reason: the quote doesn't change after the Ready Check. The owner signs the acceptance, the install consent terms and the VEEC assignment form together when they accept. The install date and final evidence are added after install, and the owner gets the completed form within 10 business days. Flagged to Jo: `assignment.core.ts` currently only allows signing after install (old early-signed records "may need a second signature"), so this needs a code change and a check against the current ESC assignment-form instructions before go-live. "You're in" now says the rebate form is attached; "All done" shows "Rebate form: Signed ✓".
101. **"All done!" install complete email approved (24 Oct).** "All done, {FirstName}. Enjoy a warmer home!"; summary card (installed product/m², rebate, rebate form signed ✓, balance paid ✓); what you'll get (completion pack; completed rebate form within 10 business days); "Something not right? Just reply". Design: `docs/templates/approved/O44-install-complete.html`.
102. **Warranties and contacts (Jo, 24 Oct):** workmanship warranty is **1 year, given by the installer**; the **5-year warranty is the product** (manufacturer's). After install, owners contact the **installer first**, then us if it isn't sorted. Fixed "5-year workmanship" in the "All done" email and the touchpoint list.
103. **Completion pack email approved (24 Oct).** "Your completion pack, {FirstName}"; downloads: Certificate of Completion, tax invoice, warranties (1-year installer workmanship · 5-year product), signed forms; "Something not right?" installer first → us → ESC; care tips (don't squash batts; tradies put it back; new downlights must be IC-rated). Design: `docs/templates/approved/O47-completion-pack.html`.
104. **Certificate of Completion approved (24 Oct)** as our own branded extra (not a VEU requirement). Owner, address, install date, product, R-value, m², removal, installer (EEC CII, AS 3999), safety check, rebate applied, warranties, AP number. Design: `docs/templates/approved/C49-certificate.html`. Next: check the ESC's current required owner documents and tax-invoice wording.
105. **Review request email approved (24 Oct), a week after install.** "{FirstName}, how's your home feeling?"; tap-a-star; Google review button; "Know someone with a cold house?" refer a friend; installer-first contact line. Design: `docs/templates/approved/O51-review.html`.
106. **Our-lead job offers reach installers by text + email + app (24 Oct).** Adds an offer email alongside the approved offer text (decision 76) and the in-app item.
107. **Installer welcome email approved (24 Oct), short:** "Welcome aboard, {First}. You're approved!"; 3 benefits (jobs sent to you + add your own; your price never marked up, only our $349 AP fee; quotes/electrician/compliance/rebate handled); Set your password; "New to how we work? Read the 2-minute guide" link to a portal guide page. Design: `docs/templates/approved/I54-welcome.html`.
108. **VEEC form stays "sign at acceptance" (Jo, 24 Oct), risk acknowledged.** Research (search extracts only; ESC sites blocked from this environment) indicated the VEU Specifications say an assignment "must not take effect before the prescribed activity has been undertaken", the current form has an installation-date field and completed-work declarations, and an older ESC form said the consumer "cannot sign before the installation date", so early-signed forms could be rejected. Jo chose to keep signing at acceptance. Recommended follow-up: confirm with ESC (veu@esc.vic.gov.au, 03 9032 1310) before go-live. Other findings: records kept 6 years after VEECs are created; the tax invoice names the AP (not the installer) and shows the price before the incentive, the incentive and the amount paid; PIESA copy to the owner ≥24h before install; ESC notification 24h–5 days before install; no text found for a "Reg 23A" 24h owner-consent rule (check the Ceiling Insulation Amendment Regulations 2026 directly).
109. **Installer pay timing (Jo, 24 Oct):** installer's own customers (A1) = paid when the owner pays the final balance; our leads (A2) = 7 days after AP approval (unchanged).
110. **Installer's own customers: optional Ready Check time on the job (24 Oct).** The installer still arranges the visit directly, but can enter the day and time on the job so it appears in the 6:30am text. No time entered = no reminder for that job (told to Deep). Build: simple date/time field on A1 jobs, feeds the daily text.
111. **Promised to Deep, to build before go-live:** PIESA sent automatically to installer and owner ≥24h before install; our-lead offer email alongside the text.
112. **No "form ready" text (Jo, 24 Oct).** Installers get Mitti links only from the 6:30am text (jobs with a day in the portal) and on our-lead offers. Never a text per form created.
113. **No "what to add" text when a quote is held (Jo, 24 Oct).** The installer may add the missing details later; the quote simply waits. Keep the existing Mitti-incomplete and usual-electrician texts unchanged.
114. **Install-day Mitti form by text the morning of (Jo, 24 Oct).** Checked: install bookings already appear in the 6:30am text, but (a) the link pointed at the PIESA audit, not the installer's PIISA/install form, and (b) the PIISA Mitti form was only created by an office button. Building: daily text links the PIISA audit for installation bookings; PIISA audit auto-created on the tick the day before install once the pre-start check passes.
115. **Add a job must match the email to Deep (24 Oct).** Found: decision 25 (basics only) was never built; Add a job still asks "on site now / later" and "later" requires the visit date, and the Mitti form is only created once a booking exists. Building now: Add a job = name, picked address, mobile, email, permission tick; Mitti form created straight away without a booking; visit day + time optional, entered later on the job (decision 110); 6:30am text lists only jobs with a day. Plus an end-to-end PGlite test that follows the email's steps 1–6 for an installer's own job.

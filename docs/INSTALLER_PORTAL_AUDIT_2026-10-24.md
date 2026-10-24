# Installer portal audit — is it "100% current"?

**Branch audited:** `origin/installer-mitti-workflow` at commit `2f50dd5` ("Log decision 185", 24 Oct 2026). Read-only; nothing was changed.
**Yardstick:** `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`, `docs/JO_DECISIONS_LOG.md` (decisions 1–185), `AGENTS.md`, `src/lib/AGENTS.md`.
**Written for:** Jo. Plain words in Parts 1–3; file paths only in the appendix.

**Legend:** **KEEP** = matches a current decision (cited). **REMOVE** = belongs to a retired rule or isn't needed (reason cited). **UNSURE** = one question for Jo. **MISSING** = the current process needs it on this screen and it isn't there.

---

## Part 1 — Screen-by-screen inventory

### Screen 0 · The frame around every screen (header, menu, bottom tabs)

**Purpose:** Logo, the person's initials, and the menu: My work · Add a job · Money · My business. Staff see only My work.

| Element | Verdict | Why |
|---|---|---|
| Logo + initials circle with "Sign out" | KEEP | Approved trade frame. |
| "TEST account — practice jobs only" pill | KEEP | Test Centre / TEST accounts rule. |
| Menu: **My work** (everyone) | KEEP | Decision 36/41: one place for the installer's jobs. |
| Menu: **Add a job** (installer business owner only) | KEEP | Decision 34 (basics-only add). |
| Menu: **Money** (business owner only) | KEEP | Decision 25, 30, 109 (own pay only). |
| Menu: **My business** (business owner only) | KEEP | Decisions 27, 130, 157, 161. |
| Code comment still calls the tabs "Upload jobs, Money, My business" | REMOVE (comment only) | Decision 42: no spreadsheet upload for installers. |
| **MISSING:** a "How it works" / guide link in the menu or on My business. | — | Decision 21 and 107: the guide is "kept as a help page in their portal", but today it is reachable only from the one-off Welcome screen and the welcome email. |
| **MISSING:** Style A look (white, thin dividers, small soft Inter text, one blue button per screen, no big bold type). | — | Decisions 41 and 47 (mock-ups 1–7 approved). The screens still use large display headings, rounded tinted cards (mint/pink/navy) and green action buttons. |

---

### Screen 1 · My work (`/field`)

**Purpose:** The installer's home: job offers, what needs them, what's booked, and their jobs in three tabs.

| Element | Verdict | Why |
|---|---|---|
| "Hello {first name}" + "N jobs booked this week" | KEEP | Approved trade greeting. |
| **Add a job** button (business owner) | KEEP | Decision 34. |
| Top panel "N new job offers · Ready Check in {suburb} · Closes in …" + **View offer** | KEEP | Decisions 49–51 (office picks one installer, 24-hour offer, app item). |
| "More offers" list | KEEP | Harmless; normally one offer at a time now that the office picks. |
| "Coming up" list of booked visits with a day tile showing **time windows like "8–10am"** | REMOVE the window wording | Decision 43: every offered day has an exact arrival time, "no window". The tile turns an 8:00 arrival into "8–10am". Show the exact time instead. |
| Jobs tabs: **Action needed / In progress / Done** with counts | KEEP | Decision 36/41 (one "Next:" line per job, calm list). |
| Job card: job number · owner name, address, one plain "what's next / whose move" line | KEEP | Decision 36, 48. |
| Job card label **"Installer customer · {business}"** / **"Home Insulation Victoria customer"** | REMOVE wording, replace | Decision 48 fixed the words: a small quiet grey **"Your customer"** or **"Home Insulation Victoria lead"**. The current badge says something else and repeats the installer's own business name back to him. |
| "Upcoming visit" chip on In progress cards | KEEP | Fine. |
| Done tab: job number · suburb · "Job complete / Cancelled", read-only summaries for ended jobs | KEEP | Approved; no owner data on finished jobs. |
| "This month: N installs done · $X" (business owner) | KEEP | Money summary, own pay only. |
| Hidden logic: a job with **no Mitti form** lands in "Needs you" as **"Quoted? answer needed"** or **"Site check? answer needed"** | REMOVE | Those two questions belong to the retired 4-step Add a job (decisions 34, 115, 185). Every installer job now gets its Mitti form automatically; the only "needs you" before the form is "your form is being set up". |
| Hidden logic: job line reads "Needs finishing: price, owner mobile… on the Mitti form" → shown as "You: add … in Mitti" | KEEP | Ready Check basics rule (AGENTS.md; Quotes to check "Not drafted yet"). |
| Hidden logic: installer offers of kind "installer" (old install offers) are still counted as offers | REMOVE | Only Ready Check offers exist for installers now (decisions 49–52); the offer page would label such an offer as a PIESA. |
| Hidden data: the old "site check / quoted price" fact pills are still computed per job (shown only on the electrician list today) | REMOVE | Retired intake facts (decision 34/185). |
| **MISSING:** nothing major. The screen already matches "one line, one button". | | |

---

### Screen 2 · Job offer (`/field/offer/{offer}`)

**Purpose:** An our-lead Ready Check offer: see the job, accept it by offering the owner three times, or say "Not for me".

| Element | Verdict | Why |
|---|---|---|
| "New job" pill + "Closes in …" countdown | KEEP | Decision 51 (24 hours), 62 (clock starts when the text goes). |
| "Ready Check in {suburb}" + "About N km away" | KEEP | Decision 50. |
| Tiles: "~N m² · Owner's estimate / From aerial photo" and "Insulation there now: None/Some/Not sure" | KEEP | Useful, no owner price. |
| **"~$X rough install value"** (installer's own rate × area) + note "Your pay is set by your agreed rates and the area measured…" | UNSURE | Decision 25 allows showing the installer their own pay, never the owner price. Question for Jo: do you want a rough dollar figure on the offer, or just "paid at your agreed rates"? |
| **"Offer the owner 3 times"** picker (3 different days, arrival time each) + **Accept and send these times** | KEEP | Decisions 52, 61 (3 different days, up to 21 days ahead, 7am–5pm). |
| **Not for me** | KEEP | Decision 51. |
| "This offer is only for you and stays open 24 hours. The address shows once you accept." | KEEP | Decisions 49, 51. |
| After accepting: "You've taken this job. The owner picks one of your times." + the times card | KEEP | Decision 52. |
| Closed state: **"This job has been taken — Another trade accepted it first."** | REMOVE wording | Decision 49: there is no race; the office picks one installer. If it closed, say "This offer has closed" (timed out / taken back by the office). |
| Page description text (browser tab/share): **"The first trade to accept gets the job. Choose one of the owner's times to accept."** | REMOVE | Old batch-offer and owner-picks-times model (decisions 49, 52, 53). |
| Electrician half of the same page (PIESA offer: "Pick a time to accept", "Suggest another time", "your rate for this job") | Not installer-facing | Shared file; installers never see it. Left for the electrician audit. |
| "Open the job page" after booking goes to the **day page**, not the job page | UNSURE | Question for Jo: after accepting, should the button land on the job page (owner, Call/Text, What's next) rather than "Today's job"? |
| **MISSING:** the "Your customer / HIV lead" label isn't needed here (always a lead) — nothing missing. | | |

---

### Screen 3 · Job page (`/field/{job}`) — the most cluttered screen

**Purpose:** Everything about one job: owner, what's next, Ready Check form, quote status, install days, messages.

**Top of the page**

| Element | Verdict | Why |
|---|---|---|
| ← My work; street + suburb heading; owner name | KEEP | Decision 36. |
| Source badge "Installer customer · {business}" / "Home Insulation Victoria customer" | REMOVE wording → "Your customer" / "Home Insulation Victoria lead" | Decision 48. |
| "Next step" panel: one line (quote status line / "You: add … in Mitti" / status) | KEEP | Decision 36 ("one What's next line, whose move it is"). |
| Same panel when the Mitti form isn't linked yet: "Your Ready Check form is being set up in Mitti. It appears within about 15 minutes." | KEEP | Decisions 115, 163. |
| Same panel using the **old stage phrases** when no Mitti form and no quote: "Book the Ready Check with the owner", "Do the Ready Check and fill in the form", "Book the install with the owner", "Install and add the photos", "Add the missing install photos" | REMOVE/reword | Mixed vintage. "Book the install with the owner" and "Add the missing install photos" assume the old portal booking and portal photo uploads; install days are now the offer-3-days flow (decision 1) and photos live in the Mitti install form (decisions 114, 118). |
| "N days left · Install must start by {date}" in the panel | KEEP | Decisions 1, 137 (30-day clock on the installer's screen). |
| "Life support at this property" note | KEEP | Safety. |
| **Call / Text / Directions** buttons | KEEP | Decision 36; direct-contact model. |

**Cards below**

| Element | Verdict | Why |
|---|---|---|
| **Owner quote card**: status line (prepared → "press Complete in Mitti" / held → "office checking" / sent / accepted / declined) and **See the owner's quote** (own jobs only, read-only, no approve button) | KEEP | Decisions 7, 25, 36; installer approval retired 24 Oct. |
| Inside the quote card: text "The office is checking the quote and will send it to the owner" | KEEP for now | Decision 42 ("first weeks the office presses Send"). Note: once `AUTO_QUOTE_SEND_ENABLED` is on (decision 159) this sentence becomes wrong; it should read "sent automatically when every check passes". |
| "Electrician: Home Insulation Victoria electrician / My usual electrician · name · licence · $ / To be arranged" | KEEP | Decisions 27, 157 (read from the Mitti form). |
| **"What happens next — We'll tell you when something needs you"** blocker list (install stage only) | KEEP, but reword lines | Decision 36 limits blockers to the install stage. The generic lines "Waiting for the quote to be approved" and "Waiting for the owner's paperwork" are old words; "Waiting for the owner's install consent / deposit" is what actually happens now (decision 97). |
| **Ready Check form** card: "What's missing" (missing answers + stops) and **Mitti form** button | KEEP | Decisions 36 ("short still-missing list"), basics rule. |
| **Ready Check form** card for own jobs before the form exists: long paragraph "…please don't start a new form in Mitti. If it isn't here within an hour, the office will sort it out." | REMOVE (duplicate) | The same message is already the "Next step" line above. Two notices for one fact; keep the short one. |
| **Who's doing this · Ready Check / Install** allocation picker (business owner) | KEEP | Decision 161. |
| **Ready Check time** card on our leads (whose move it is, owner's suggested days, offer 3 new times, **Change time**) | KEEP | Decisions 52, 80. |
| **"Ready Check day and time (optional)"** on own jobs | KEEP | Decision 110/116. UNSURE: once a time is saved the card still shows an empty picker; it should show the saved time with a "Change" link. |
| **"Choose the electrician"** panel (My preferred electrician / Another HIV electrician / Nominate an electrician / HIV organise one) shown after the quote is accepted when no electrician is named | REMOVE | Retired "who arranges the electrician" step from the old intake (decisions 27, 157, 185). The electrician is answered in the Mitti form; the office arranges the PIESA ("nothing for you" in the Owner accepted email, decision 91). |
| **Legacy "Ready Check form" (Mitti-only) card** that appears when the job is in an old "measure-up" scope with no linked form; and **"Your Ready Check — Status: … Home Insulation Victoria will follow up"** with measurement rows | REMOVE | Measure-up variants retired (source of truth: "measure-up & eligibility check" is a retired name; stage 8 Jo 22 Oct: Mitti is the only Ready Check form). |
| **"Site summary"** (area, removal, access, downlights, hazards) | UNSURE | Useful facts, but decision 36's simple layout doesn't list it. Question: keep a two-line "Measured: N m², removal N m²" under the quote card, or drop it? |
| **"Installation booking — Waiting for the owner's payment. Booking opens once paid."** | REMOVE | Old pay-before-booking rule (7 Oct). Now: installer offers days once cleared, the 10% is paid when the owner books (decisions 13, 14a, 97). |
| **Install day** card: offer 3 days with arrival times → owner picks or suggests → book one with a time → **Change day**; "Install must be on or before {date} · N days left"; red **30-day clock** box | KEEP | Decisions 1, 2, 19, 43, 137. |
| The red 30-day clock box text on the **installer's** screen says "**Your** install must happen… as soon as **the installer** offers times" | REMOVE wording → installer version | Decision 23/137 wanted "a plain line on the install-day screens" for installers too; the current box is the owner's sentence. Needs: "Install within 30 days of the safety check (by {date}) or a new check is needed; whoever's move it was pays for it." |
| **"Scope"** line ("Install ceiling insulation to N m²…") | UNSURE | Same question as Site summary. |
| **Evidence** list with upload buttons (install stage onward) | UNSURE | Decision 37 says "evidence and paperwork lists show only from the install stage, as a checklist". Question: is this a read-only checklist mirroring the Mitti install form, or do installers still upload photos here? (Decisions 114/118 put photos in the Mitti install form.) |
| **"Installation complete"** one-tap button | UNSURE | The guide (decision 145) says "Press Complete in Mitti". Question: does the portal button stay as a backup, or does Mitti Complete alone mark the install done? |
| **"Rebate form (your part)"** — Section 3 Part B typed-name signature | KEEP | Decision 119 (lead installer signs Part B after the install), 125. |
| **"Submit for Home Insulation Victoria review"** button + "If anything is still missing, you'll see exactly which item when you submit" | REMOVE | No decision asks the installer to "submit"; the office checks the photos ("We'll check the photos and sign it off"). Mitti Complete + Part B is the installer's last step (decisions 118, 145). |
| **Booked-visit card**: "Booked Ready Check · {time}", **I've arrived**, **Open Ready Check form**, **Owner not home**, **I can't make it** (cancel with a reason; "counts against your reliability; the owner will be asked for new times") | REMOVE "I can't make it"; UNSURE the rest | Rescheduling now goes through **Change time** (decision 80) and **Change day** (decision 19), which already exist on this page — two competing ways to move a visit. Question for Jo: keep "I've arrived" / "Owner not home" as light visit records, or rely on the day page's "Couldn't get in?" only? |
| **"Contact details for this visit"** card: owner contact again + "Agree a time directly, then record it in the portal. It is booked only once the other party (or Home Insulation Victoria) confirms it." | REMOVE | Owner contact is already at the top (Call/Text). The sentence describes the retired "record the time, other party confirms" model; times are now tap-to-book (decisions 52, 1). Keep only the one-line trade privacy notice ("Use these contact details only to arrange and complete this job…") if wanted. |
| **Messages**: "All contact happens here in the portal — no phone numbers or emails are shared. Home Insulation Victoria can see this conversation." + quick replies ("I've proposed some times in the portal", "I'm on my way"…) | KEEP the card, REMOVE the first sentence | Decision 36 lists Messages. The sentence contradicts the Call/Text buttons above it and the direct-contact rule (source of truth: "portal-only chat as required model" is retired). |
| **More → Staff job links** ("Create job link", 30-day private links, "Nothing is texted or emailed automatically yet") | UNSURE | Decision 39 put these behind More. Since decision 161 (allocate a staff member, Mitti form re-assigned, 6:30am text to them), question: are per-job links still needed, or does allocation replace them? |
| Hidden dead weight: four old intake cards are still imported and an old "intake progress" read still runs on every job open ("Measurements and quote", "Add or update details", installer facts, intake progress) | REMOVE | Decision 36 removed them from the screen; the code and the extra server call remain. |
| **MISSING:** the install-day Mitti form link on the job page once a day is booked (today only in the 6:30am text and the day page) — decision 114/36 ("one button, e.g. Open Mitti form"). | | |
| **MISSING:** on our leads, "your pay for this job" (agreed rates × measured area) — decision 25 ("their own pay"). Today the figure appears only in Money after completion. | | |
| **MISSING:** a clear "Ready Check booked: {day, time}" line on own jobs after the optional time is saved (decision 110). | | |

---

### Screen 4 · Today's job / day page (`/field/day/{job}`)

**Purpose:** The visit itself: before-you-start checks, open the Mitti form, see the result.

| Element | Verdict | Why |
|---|---|---|
| Header pill "Today · **8–10am**" (two-hour window) | REMOVE window wording | Decision 43 (exact arrival time). |
| "Ready Check · {surname}" / "Install · {surname}", address, **Directions**, **Call owner** | KEEP | Direct contact. |
| "Ready when you are" with the right sentence per job type (own job: "Measure, photos and your quote all go in there"; our lead: "we price the owner's quote from your agreed rates"; install: "PIISA, photos and bag labels") | KEEP | Decisions 26, 34, 118. |
| **Couldn't get in?** (No one home / Couldn't reach the manhole / Not safe / Something else) → "Thanks. The office will rebook it… offer it back to you first" | KEEP the reasons; UNSURE the outcome text | Approved reasons. But decisions 52/54 say the installer rebooks directly (own job) or offers new times (our lead) — not "the office will rebook". Question: after "couldn't get in", should the installer simply be asked to offer 3 new times (lead) or enter a new time (own job)? |
| **Who's on the install?** crew picker (lead installer + up to 3, EEC/CII numbers, "Enter installer details") | KEEP, but UNSURE about overlap | Decision 153 (CII-cleared crews). Overlaps with "Who's doing this" on the job page (decision 161). Question: is "Who's doing this" the allocation (one person, gets the form/text) and this the full crew list for the PIISA? If so both stay; the page should say so. |
| "I will not discuss pricing with the home owner" tick before an our-lead Ready Check | KEEP | Decision 28. |
| "Sharp photos and videos" tips card; **Phone check (0/3)** ticks (location on, battery, form open); iPhone/Android location steps; **Start Ready Check / Start install** button | KEEP | Approved 5 Oct; decision 178 (geotagged photos). Could be shorter in Style A. |
| After Start: "Over to your onsite form" + **Open form in Mitti** + "What comes back here" | KEEP | Mitti is the only form. |
| "Your form is being set up" + **Get my Ready Check form** (own jobs) | KEEP | Decision 163 (retry path). |
| Results: "Quote's in. Done and dusted. We'll send the owner your quote…", "Not eligible this time", "That's a wrap", "Nearly there. N photos missing" | KEEP | Plain, current. ("Fixes found… priced from your rates" is the electrician's result.) |
| **MISSING:** nothing essential; this page is close to current. | | |

---

### Screen 5 · Add a job (`/partner/import`)

**Purpose:** Add the installer's own customer: name, picked address, mobile, email, permission tick; optional visit day and time.

| Element | Verdict | Why |
|---|---|---|
| Two steps: **Customer → Review & save** | KEEP | Decisions 34, 115, 185. |
| Address picked from the list ("✓ Address found"), owner's full name, mobile, email, contact-permission tick | KEEP | Decision 34, 42 ("picked address"). |
| "Enter the details perfectly and in full — they carry onto the quote and all the paperwork" | KEEP | Decision 115 (matches the email to Deep). |
| Review summary with Edit | KEEP | |
| **Ready Check visit day and time (optional)** | KEEP | Decision 116. |
| "What happens next: your form is being set up in Mitti… press Complete only when it's fully finished — that sends the owner's quote" | KEEP | Decisions 115, 42. |
| **Add job** / Back / Cancel; typed details kept on the phone when the signal drops | KEEP | |
| Saved screen: "Job saved — your Ready Check form is ready" + **Open Mitti form** / "Go to the job" | KEEP | Decision 115. |
| **"Upload multiple jobs"** link (hidden by a switch) | REMOVE the code | Decision 42: bulk import is office-only. |
| Hidden leftovers: "Who organises the job… HIV manages / I'll manage it myself" summary text still in the Add-a-job rules file | REMOVE | Decision 185. |
| **Old 4-step Add a job preview page** (`/installer-preview`, no login) and its intake components | REMOVE | Decision 185 says it was removed; it is still on the branch. |
| Old links `/partner/add` → redirect here | KEEP | Bookmarks. |
| **Bulk upload page** (`/partner/bulk-import`) — installers are locked out by the switch; the page still carries old intake fields ("Site check for all", "My electrician", "Already installed — history only", "Second contact") | REMOVE from the installer area | Decision 42: office-only; move it under Office and strip the retired questions when the office version is reviewed. |

---

### Screen 6 · Money (`/field/money`)

**Purpose:** The installer's own pay: awaiting approval, approved (due in 7 days), paid.

| Element | Verdict | Why |
|---|---|---|
| Tiles: "Approved · to be paid $X · Next payment {date}", "This month", "All time" | KEEP | Decision 25 (own pay). |
| Tabs **Awaiting approval / Approved / Paid** with per-job rows | KEEP | Decisions 30, 109. |
| Row detail: Business, Work, Amount inc GST, Status, Approved, Expected pay date, Bank account ending | KEEP | |
| Footnote: "Payment is confirmed once the office approves the job paperwork **and the owner has paid in full**" | KEEP for own customers, wrong for our leads | Decision 109: own customers = when the owner pays the balance; our leads = 7 days after approval, "owner payment is not a condition" (decision 30). The sentence should change by job type. |
| Ready Check visits never appear as pay rows | KEEP | Decision 29 (free visit). |
| "Download statements" CSV | KEEP | |
| "Invoice the owner directly" section | Not installer-facing | Electrician own-billing; never produced for installer accounts. |
| **MISSING:** what the installer will earn on an our-lead job **before** completion (agreed rates × measured area) — decision 25. | | |

---

### Screen 7 · My business (`/field/business`) and its pages

**Purpose:** The business file: taking jobs, details, rates, bank, insurance, agreement, team, usual electrician, ESC privacy notice.

| Element | Verdict | Why |
|---|---|---|
| "Approved partner" pill; **Taking new jobs** switch | KEEP | Offers only go to businesses taking jobs. |
| "Grow your business": **Add team members** | KEEP | Decision 161. |
| "Grow your business": **Upload multiple jobs** (switched off) | REMOVE the code | Decision 42. |
| Expiry alert "Your public liability runs out in N days… Upload" | KEEP | |
| **Business details** page: name, legal name, ABN, phone, email, address, where you work, usual days, lead time; "Ask us to change something" | KEEP; UNSURE "Usual days" / "Lead time" | Question: are usual days and lead time still used for anything now that installers offer their own times? |
| **My usual electrician** (name, licence, price inc GST) on Business details | KEEP | Decisions 27, 157, 173. Better placed as its own row on the My business list so it is found (the "usual electrician missing" text sends people to "My business"). |
| **Your rates** (list + "Request a rate change") | KEEP | Decisions 26, 30. |
| **Bank details** | KEEP | |
| **Insurance & licences** (list, View, upload renewed) | KEEP | |
| **Your agreement** (version, signer, date, View the PDF) | KEEP | Decision 171 (installer agreement = AP contract). |
| **Team**: name, role, "Has a login", CII status, **Send login invite**, certificate link | KEEP | Decisions 153, 161. |
| **ESC privacy notice** row ("N to acknowledge" / "Acknowledged") and page (notice verbatim, one tick per person, boss sends links) | KEEP | Decisions 122, 130, 146, 147. |
| **Sign out** | KEEP | |
| **MISSING on Team:** each staff member's **mobile** and **Mitti login** — decision 161 says the business owner allocates to "any staff member listed under My business (name, mobile, Mitti login)". Today the list shows name/role/login/CII only. | | |
| **MISSING:** a **guide** link ("How every job works"). | | |

### Screen 7b · Your staff (`/partner/workers`)

| Element | Verdict | Why |
|---|---|---|
| Invite by link; add manually; edit/remove; status; certificate link | KEEP | Decision 153. |
| Text "our office must approve them before they can access assigned jobs" | KEEP | Approval still gates logins (decision 153). |
| `?sample=1` demo mode with a fake "Sample Electrical" business | REMOVE | Demo-only leftover on a live screen. |

---

### Screen 8 · Installer guide (`/field/guide`)

**Purpose:** The approved two-minute "How it works" page.

| Element | Verdict | Why |
|---|---|---|
| Five steps (The job starts: own customer vs our lead · Ready Check in Mitti, Complete sends the quote · Electrical safety check arranged by us · Install day from the 6:30am text, photo list · Sign off: Complete in Mitti then sign Part B) | KEEP | Decision 145, G55 approved. |
| 30-day rule box; "photos live at the property"; "Getting paid: your customers when the owner pays the balance; our leads 7 days after approval; we never mark up your price" | KEEP | Decisions 23, 109. |
| **MISSING:** no way to reach it from the menu or My business (see Screen 0). | | |
| UNSURE: the guide doesn't mention the staff allocation step or the ESC privacy notice. Question: add one line each? | | |

### Screen 9 · Welcome (`/field/welcome`, `/field/setup` redirects here)

| Element | Verdict | Why |
|---|---|---|
| "You're approved · {business} is ready to take Ready Checks and installs"; "everything from your application is already loaded"; **Go to my work**; **How every job works** | KEEP | Jo's rule: never re-enter onboarding; decision 107. |
| Hidden: old five-step "quick setup" checklist rules still exist in code (details, rates, bank, job alerts, team) | REMOVE | Setup checklist retired ("No setup checklist — approved, then straight to My work"). |

### Screen 10 · ESC privacy notice link (`/notice/{token}`, no login)

| Element | Verdict | Why |
|---|---|---|
| Logo, "Privacy notice for your installers", personal intro, notice verbatim, one tick, typed full name, **Save acknowledgements**, "a copy has been emailed", expired-link message | KEEP | Decisions 130, 146, 147, 170 (P5 approved as built, decision 183). |

---

## Part 2 — Installer-facing texts and emails these screens rely on

| Message | Where it comes from | Verdict |
|---|---|---|
| **Job offer text** "New Ready Check job near {Suburb} (about {area} m²). Offer the owner 3 times within 24 hours…" | Offer flow | KEEP — decision 76/154 wording, approved. |
| **Job offer email** (same sentence + "See the offer" button) | Offer flow | KEEP — decisions 106, 136, 154. |
| **Owner accepted** email ("Good news… electrician offers times, nothing for you; offer 3 install days once cleared; 30 days") | Quote acceptance | KEEP — decision 91. |
| **Owner declined** email | Quote decline | KEEP — decisions 92, 136. |
| **Welcome / You're approved** email with password link and guide link | Approval | KEEP — decision 107. |
| **We've got your application** email | Application | KEEP — decision 136. |
| **Privacy notice link** text + email, reminders, **copy of the notice** email | ESC notice | KEEP — decisions 146, 147, 170. |
| **30-day window** texts and emails to the installer at 20 and 10 days | Install days | KEEP — decisions 158, 167, 168. |
| **Usual electrician missing** text ("To send the quote for {HV}, we need your usual electrician… Add them once in My business") | Held quote | KEEP — decision 83. |
| **6:30am jobs text** | Daily text | **MISMATCH** — code sends "HIV: Your jobs today – … Tap each link to open its form in Mitti." marked DRAFT 7 Oct. Decision 83 approved "Home Insulation Victoria: Good morning! Your jobs today: 1) {time}, {short address}: {Mitti link} …". "HIV" is also a retired visible name. |
| **Missing answers** text ("Nearly there! {HV} still needs: {items}. Add them in Mitti…") | Held quote | **NOT FOUND** in code (decision 83 approved, decision 113 said keep it). |
| **Owner suggested other days** text to installer (Ready Check) | Ready Check times | **NOT FOUND** (decision 79). |
| **Installer booked** text ("Booked: Ready Check {Day} {time}, {address}… Owner details on the job") | Ready Check times | **NOT FOUND** (decision 82). |
| **Install tomorrow** text to installer | Install day | **NOT FOUND** (decision 99). |
| Messages quick replies ("I've proposed some times in the portal", "I'm on my way"…) | Job page | KEEP; harmless. |
| Owner "You're booked" / "Pick a time" / install-booked emails that name the installer and phone | Owner side | KEEP — decisions 44–46, 77, 81, 98 (not installer-facing, but they carry the installer's name and phone from My business). |

---

## Part 3 — Prioritised summary

### The 10 biggest removals (do these first)

1. **"Choose the electrician" panel on the job page** (My preferred / Another HIV electrician / Nominate / HIV organise). The electrician is answered in the Mitti form and the office arranges the PIESA (decisions 27, 157, 185). This is the last live piece of the retired "who arranges" intake.
2. **"Submit for Home Insulation Victoria review" button** after the install. The installer presses Complete in Mitti and signs Part B; the office checks the photos. No decision asks for a submit step.
3. **"Installation booking — Waiting for the owner's payment. Booking opens once paid."** Old pay-before-booking rule. Now the installer offers days once cleared and the owner pays the 10% when they book (decisions 13, 14a, 97).
4. **The old "measure-up" Ready Check cards** ("Open form in Mitti" under the legacy measure scope, "Your Ready Check — Status … Home Insulation Victoria will follow up"). Mitti is the only Ready Check form; the "What's missing" card already covers it.
5. **"I can't make it" / cancel-with-reason on the booked-visit card**, plus the "Contact details for this visit — agree a time, then record it, booked once the other party confirms" card. Both describe the retired record-and-confirm booking model; Change time (decision 80) and Change day (decision 19) already exist on the same page.
6. **Two-hour time windows ("8–10am") on My work, the day page and the accepted-offer screen.** Decision 43: exact arrival times, no window.
7. **"Another trade accepted it first / The first trade to accept gets the job"** wording on the offer page. The office now picks one installer (decision 49).
8. **Hidden "Quoted? / Site check? answer needed" tasks** and the old site-check/price fact pills behind My work. They come from the retired 4-step Add a job (decisions 34, 185) and can wrongly put a job in "Needs you".
9. **The old Add-a-job preview page (`/installer-preview`) and its intake components, the "Upload multiple jobs" links and switch, the "who organises" summary text, and the old quick-setup checklist rules.** Decisions 42, 185; the preview page was recorded as removed but is still on the branch.
10. **Messages card sentence "All contact happens here in the portal — no phone numbers or emails are shared"** and the **owner-worded 30-day clock box** on the installer's screen. Both say the wrong thing to an installer who has Call/Text buttons and is the one offering days.

Also quick wins: the source badge words → "Your customer" / "Home Insulation Victoria lead" (decision 48); drop the duplicate "form on its way" paragraph; remove the unused intake code and the extra "intake progress" server call on every job open; remove the `?sample=1` demo mode on Your staff; fix the Money footnote for our leads (decision 30).

### The 5 biggest gaps (things the current process needs that aren't there)

1. **Style A has not been applied to the installer screens** (decisions 41, 47: white, thin lines, small Inter text, one blue button, "Next: …" first). The screens still use the older bold, tinted-card look. Jo asked to see the screens before go-live (decision 8).
2. **Four approved installer texts are not built**: the "Nearly there, {HV} still needs…" missing-answers text (83), the "owner suggested other days" text (79), the "Booked: Ready Check…" text (82) and the "Install tomorrow" text (99); and the 6:30am text still uses the 7 Oct draft wording with the retired "HIV" name instead of the approved "Good morning!" version (83).
3. **Team page lacks mobile and Mitti login per staff member** (decision 161 names all three), and "My usual electrician" is buried inside Business details although the held-quote text tells installers to "add them in My business".
4. **No guide link in the portal menu or My business** (decisions 21, 107: a help page kept in their portal). It is reachable only from the one-off Welcome screen.
5. **Our-lead pay is invisible until the job is finished.** Decision 25: installers see "quote status only and their own pay". The job page should carry one line "Your pay: $X (your rates × N m²)" once measured; Money shows it only after completion.

Smaller gaps: an **Open Mitti install form** button on the job page once a day is booked (decision 114); a "Ready Check booked: {day, time}" line (with Change) on own jobs after the optional time is saved (decision 110); the quote-card sentence should flip to "sent automatically when every check passes" once `AUTO_QUOTE_SEND_ENABLED` is on (decision 159).

### Questions only Jo can answer (the UNSURE list)

1. Offer page: show a rough dollar figure (your rate × estimated m²), or just "paid at your agreed rates"?
2. Job page: keep a short "Measured: N m² · removal N m²" line, or no measurement facts at all?
3. Evidence at the install stage: a read-only checklist of what Mitti has received, or can installers still upload photos in the portal?
4. "Installation complete" button: keep as a backup to Mitti Complete, or let Mitti alone mark it done?
5. "I've arrived" / "Owner not home" on the booked-visit card: keep as light records, or rely on "Couldn't get in?" on the day page?
6. "Who's doing this" (one allocated person) and "Who's on the install?" (full crew for the PIISA): both stay, with the difference explained?
7. Staff job links behind "More": still wanted now that allocation re-assigns the Mitti form and texts the person?
8. After "Couldn't get in?" on a lead: should the installer be asked straight away to offer 3 new times (no office), as decisions 52/54 imply?
9. Business details "Usual days" and "Lead time": still used for anything?
10. After accepting an offer, land on the job page rather than "Today's job"?

### Proposed simplified installer portal (in order)

1. **My work** — greeting; one job offer panel (if any); Coming up (exact times); Jobs: Action needed / In progress / Done, one "Next:" line per job, quiet "Your customer" / "Home Insulation Victoria lead" label; This month (owner).
2. **Job offer** — Ready Check near {suburb}, area and insulation tiles, "paid at your agreed rates", pick 3 days + times, Accept and send / Not for me, 24-hour note.
3. **Job page** — street + suburb, owner, label; **Next:** one line, one button (Open Mitti form / Offer install days / Sign Part B…); Call · Text · Directions; Quote status (+ See the owner's quote on own jobs; "Your pay" on leads); Ready Check: what's still missing in Mitti; Ready Check time (lead: times back-and-forth + Change time; own job: optional day/time + Change); Who's doing this (owner only); Electrician (from the form); Install days (offer 3 / owner's days / booked + Change day) with the installer-worded 30-day line; from install day booked: checklist + Part B signature; Messages.
4. **Today's job (day page)** — exact time, Directions, Call owner; pricing tick (leads); Couldn't get in?; crew (install day); the 3 phone checks; Start → Open form in Mitti; result.
5. **Add a job** — Customer (picked address, name, mobile, email, permission) → Review & save (optional visit day + time) → saved, Open Mitti form.
6. **Money** — Approved to be paid / This month / All time; Awaiting approval · Approved · Paid; per-job detail; statement download; footnote by job type.
7. **My business** — Taking new jobs; Business details; My usual electrician (own row); Your rates; Bank; Insurance & licences; Your agreement; Team (name, mobile, Mitti login, CII, invite) → Your staff; ESC privacy notice; How it works (guide); Sign out.
8. **How it works (guide)** — the approved five steps, 30-day rule, getting paid.
9. **Welcome** (first sign-in only) and **ESC notice link** (no login) — unchanged.

Gone from the installer's world: electrician choice, submit for review, pay-before-booking notices, measure-up cards, cancel-visit-with-reason, contact-release card, bulk upload, the preview page, time windows, "first to accept" wording, intake Q&A tasks.

---

## Appendix — where each screen lives (technical)

All paths are under the repository root as extracted from `origin/installer-mitti-workflow`.

**Frame / navigation**
- `src/components/trade/TradeShell.tsx` (header, bottom tabs, `useTradeItems`, avatar sign-out, TEST pill)
- `src/routes/_authenticated/field.tsx`, `src/routes/_authenticated/partner.tsx`, `src/lib/route-guards.ts` (`partnerPathAllowed`)

**My work**
- `src/routes/_authenticated/field.index.tsx` (`MyWork`, `InstallerJobs`)
- Data: `src/lib/trade-view.server.ts` (`tradeHome`), `src/lib/work-places.core.ts` ("Quoted?/Site check? answer needed"), `src/lib/trade-work.core.ts` (old stage task table), `src/lib/installer-progress.core.ts` (`INSTALLER_TABS`, `installerTab`, `doneReason`; the long retired-intake `nextAction` block), `src/lib/installer-quote-status.core.ts` (quote lines), `src/lib/trade-view.core.ts` (`dayTile` windows, `jobCardLine`, `needsFinishingTask`, `SETUP_STEPS`)
- Badge: `src/components/portal/badges.tsx` (`SourceBadge`); facts pills: `src/components/portal/installer-job-facts.tsx`

**Job offer**
- `src/routes/_authenticated/field.offer.$offerId.tsx`
- `src/components/portal/ready-check-times-installer.tsx` (`ReadyCheckTimesForm`, `InstallerReadyCheckTimesCard`)
- Data/rules: `src/lib/trade-view.server.ts` (`tradeOffer`, `tradeOfferReadyCheckTimes`, `tradeOfferReply`), `src/lib/ready-check-times.core.ts`, `src/lib/trade-view.core.ts` (`roughInstallValue`, `roughValueNote`, `goneIn`)

**Job page**
- `src/routes/_authenticated/field.$jobId.tsx` (`FieldJob`, `A1ReadyCheckTimeCard`, `MittiOnly`, `InstallerFlow`; electrician flow in the same file)
- Cards: `src/components/trade/OwnerQuoteCard.tsx`, `src/components/trade/MittiMissingInfo.tsx`, `src/components/trade/new-ready-check.tsx` (`ReadyCheckInMitti`, unused `NewReadyCheckButton`), `src/components/trade/visit-allocation.tsx` (`WhosDoingThis`), `src/components/portal/install-days.tsx` (`InstallerInstallDays`), `src/components/portal/partner.tsx` (`ElectricianChoicePanel` — remove), `src/components/portal/visit-changes.tsx` (`TradeVisitCard`), `src/components/portal/allocation.tsx` (`VisitContactsCard`), `src/components/portal/panels.tsx` (`BlockersPanel`, `EvidencePanel`, `MessagesPanel`), `src/components/portal/workers.tsx` (`WorkerLinksPanel`), `src/components/portal/assignment.tsx` (`InstallerFinalDeclaration`), `src/components/portal/requirements.tsx` (`MeasurementDetails`), `src/components/portal/mitti.tsx` (`MittiCard`), `src/components/portal/kit.tsx` (`NowPanel`), `src/components/owner/OwnerPageKit.tsx` (`ThirtyDayClock`), `src/components/trade/one-tap-action.tsx`
- Unused imports still in the route: `src/components/trade/intake-details-editor.tsx` (`MyIntakeDetailsCard`), `src/components/trade/job-intake.tsx` (`JobElectricianCard`), `src/components/trade/intake-progress.tsx` (`InstallerProgressCard`), `src/components/portal/installer-job-facts.tsx` (`PartnerInstallerFactsCard`); plus the `getMyIntakeProgress` query (`src/lib/installer-quote.functions.ts`)
- Data: `src/lib/mitti-job-presentation.server.ts`, `src/lib/trade-view.server.ts` (`tradeSetReadyCheckTime`), `src/lib/portal-presentation.core.ts` (`tradeBlockerLines`), `src/lib/messaging.core.ts` (`QUICK_ACTIONS`), `src/lib/owner-pages.core.ts` (`THIRTY_DAY_CLOCK`, `P5`), `src/lib/nextstep.core.ts`, `src/lib/job-wording.ts` (trade stage phrases)

**Day page**
- `src/routes/_authenticated/field.day.$jobId.tsx` (`DayPage`, `Result`, `PrepareForm`)
- `src/components/trade/TradePrestart.tsx`, `src/components/trade/PiisaCrewPicker.tsx`, `src/components/portal/MittiFormLink.tsx`
- Data: `src/lib/trade-view.server.ts` (`tradeDay`, `tradeCouldntGetIn`, `confirmHivicReadyCheckPricing`), `src/lib/trade-view.core.ts` (`PRESTART_CHECKS`, `COULDNT_GET_IN`, `couldntGetInMessage`), `src/lib/owner-confirm.core.ts` (`HIVIC_READY_CHECK_PRICING_TICK`), `src/lib/piisa-a3.core.ts`

**Add a job**
- `src/routes/_authenticated/partner.import.tsx`, `src/components/trade/add-job-flow.tsx`, `src/components/trade/customer-fields.tsx`, `src/lib/add-job-flow.core.ts` (contains retired `organiseSummary`), `src/lib/onsite-ready-check.*`, `src/lib/job-electrician.core.ts` (permission wording)
- Redirects: `src/routes/_authenticated/partner.add.tsx`, `partner.index.tsx`, `partner.payments.tsx`, `partner.profile.tsx`
- Retired / to remove: `src/routes/installer-preview.tsx`, `src/components/trade/installer-intake-flow.tsx`, `src/components/trade/intake-preview-adapter.ts`, `src/components/trade/intake-quote-fields.tsx`, `src/components/trade/ffs-progress.tsx`, `src/lib/bulk-upload-switch.core.ts` (`INSTALLER_BULK_UPLOAD_ENABLED`), installer-side links to `src/routes/_authenticated/partner.bulk-import.tsx`

**Money**
- `src/routes/_authenticated/field.money.tsx`; data `src/lib/trade-view.server.ts` (`tradeMoney`, `tradeMoneyRows`), `src/lib/trade-view.core.ts` (`payState`, `payPill`)

**My business**
- `src/routes/_authenticated/field.business.tsx`, `field.business_.details.tsx`, `field.business_.rates.tsx`, `field.business_.bank.tsx`, `field.business_.insurance.tsx`, `field.business_.agreement.tsx`, `field.business_.team.tsx`, `field.business_.esc-notice.tsx`
- `src/components/trade/business-pages.tsx` (`BizPage`, `Rows`, `AskToChange`), `src/components/trade/usual-electrician.tsx`, `src/components/portal/esc-notice-page.tsx`, `src/components/portal/worker-compliance.tsx`
- Data: `src/lib/trade-view.server.ts` (`tradeBusiness`, `tradeBusinessFile`, `tradeSaveUsualElectrician`, `tradeChangeRequest`), `src/lib/esc-collection-notice.*`, `src/lib/worker-compliance.core.ts`
- Your staff: `src/routes/_authenticated/partner.workers.tsx`, `src/components/portal/workers.tsx`, `src/components/portal/worker-invites.tsx`

**Guide / Welcome / Notice**
- `src/routes/_authenticated/field.guide.tsx` (approved copy: `docs/templates/approved/G55-installer-guide.html`)
- `src/routes/_authenticated/field.welcome.tsx`, `src/routes/_authenticated/field.setup.tsx`
- `src/routes/notice.$token.tsx` (approved: `docs/templates/approved/P5-installer-privacy-notice.html`)

**Installer texts and emails**
- Offer text/email: `src/lib/ready-check-times.core.ts` (`readyCheckOfferText`), `src/lib/ready-check-offer-email.core.ts`
- Accepted/declined: `src/lib/installer-accepted-email.core.ts`, `src/lib/installer-declined-email.server.ts` (approved: `docs/templates/approved/I23-owner-accepted.html`, `I24-owner-declined.html`)
- Welcome / application received: `src/lib/partner-email.core.ts`, `src/lib/application-review.core.ts` (`I54-welcome.html`, `I53-application-received.html`)
- Privacy notice: `src/lib/esc-collection-notice.core.ts` (`I60-privacy-notice-link.html`, `I62-notice-copy.html`)
- 30-day: `src/lib/thirty-day-rule.core.ts`
- Usual electrician text: `src/lib/usual-electrician.core.ts`
- 6:30am text (draft wording, "HIV:" prefix): `src/lib/daily-mitti-text.core.ts` (`DAILY_TEXT_WORDING_VERSION = "DRAFT-2026-10-07"`)
- Not found anywhere in `src/`: the approved missing-answers text (83), owner-suggested-days text to installer (79), installer booked text (82), install-tomorrow installer text (99)

**Retired-term scanner:** `scripts/scan-retired-terms.ts` (does not yet catch "HIV:" as a visible name, two-hour windows, "first trade to accept", or the "who organises" wording).

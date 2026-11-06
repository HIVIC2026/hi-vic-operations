# Installer portal redesign: design spec (v2, 6 Nov 2026)

Status: for Jo's review. Every screen and every word below was approved by Jo on 6 Nov 2026 on the design canvas.
Canvas (the source of truth for the look): https://claude.ai/artifact/J4b2MUfmHFMkD1FeUFwYsF. A copy of its source is in `docs/superpowers/mockups/2026-11-06-installer-portal/canvas/`.
Decision log: `docs/superpowers/handoffs/2026-11-06-installer-portal-redesign-handoff.md`. Where this spec and the log disagree, **this spec wins** (v2 replaces v1's screens, layouts and step 7/8 wording).

## 1. Goal

Every installer boss and office (on a phone or a computer) always knows the one thing to do next on every job. Nothing gets lost or frozen. Every page is fast.

No installer is using the current installer portal, so the new pages **replace** the old installer pages directly. There's no parallel run and no per-installer switch. Nothing goes live to real installers until Jo says go (§10).

## 2. Must not change

- Domain guards and workflow rules: `AGENTS.md`, `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`, `src/config/workflow-decisions.ts`. This work changes screens and the rules listed in §7 only.
- The $349 fee, PIESA fees, the 50% deposit, 30-day quote validity and the chase timings.
- Mitti forms. Office screens are out of scope.
- No live SQL, sends or publish without Jo's explicit yes. Each part is its own pull request, and Jo merges.

## 3. Look (all pages)

- Home Insulation Victoria website look: Open Sans; navy #22376B text; grey #5B6785 secondary; blue #3C51C4 links and selected; green #07BF61 main buttons and done; light #F5F7FB background; lines #E3E8F2. White cards with a 16px radius. Large fields (16px text, 48px+ tall). Touch targets 44px or more.
- Colours mean one thing each: **green** = your turn or done; **grey** = waiting on someone else; **amber** #8A4B00 on #FEF3E2 = reminder or something missing; **red** #B42318 on #FDECEA = stop / don't start / cancelled. Every coloured state also says what it is in words.
- **Computer:** left menu (logo, + Add a job, Action items with a count, Calendar, Jobs, Money, My business; business and user name at the bottom).
- **Phone:** top bar (logo, + Add a job) and a bottom menu with the same five items.
- Short, plain words. Owners are called by name, never "her" or "she". Never "HIV": always "Home Insulation Victoria" or "us"/"we".

## 4. Screens

### 4.1 Action items (home)
- "Good morning, {first name}" · "{n} jobs need you today." · search (name, address or HV number).
- **Fix before work starts** (red box): jobs where something would stop the install, e.g. "Book an electrician for install day" + the install date chip + a red button.
- **Your turn:** each row is led by the bold action ("Pick the Lead and crew", "Sam said yes. Book the PIESA.", "Measure and quote"), then the address, then owner · HV · Your customer / Our lead, with one green button. A date chip appears only for a real deadline.
- **Waiting on someone else:** folded by default, with a count. When opened, each job shows "Waiting on {James (electrician) / Home Insulation Victoria / owner name}".
- **This week:** bookings by day, colour-coded like the Calendar, linking to the Calendar.
- Tapping a row opens the Job page.

### 4.2 Job page
- **Header:** source tag (Your customer / Our lead), HV number, address, owner name and mobile, Call and Email buttons.
- **Progress:** 6 steps: Measure · Quote · PIESA · Deposit · Install · Paid.
- **Next step box:** a chip (Your turn / Nothing for you to do / Don't start / Cancelled / Closed / On hold / Done), a title, 1–2 lines of text, status chips, a "What happens from here" fold-out, and on the right the fields and one big button. The border is green when it's their turn, grey when waiting, and red for stop or cancelled.
- **Booking fields (every booking):** Day · Arrival · **Put it in the calendar?** Yes/No · **How long** (shown only if Yes: 1 hour, 2 hours, Half day, Full day, 2 days). **Change the day / Change time** opens the same fields in the box with **Save changes**. Saving moves it on the Calendar and tells the owner, and ESC when needed.
- **Tabs below:** Job details · What {owner}'s been told · Paperwork · Photos. Job details shows only what's known. At the measure stage it shows the date given or added, the contact OK and "Not measured yet" / "From the photos" / "From your Ready Check", and never the owner's own size guess. Once measured: install area and spaces, what's up there now, **removal**, product, access, price (own customers) or "Your agreed rates" (our leads), and when they get paid.

### 4.3 Calendar
- **Computer:** a week grid (Mon–Fri, 7am–3pm) with ‹ › week arrows, person filters (Everyone, then each person) and **+ Add a Ready Check**. Each booking is a block whose length is its How long. It shows type and start–finish time, place, who, and any flag (red "Don't start…", amber "Raj to sign safety plan", "Pick Lead and crew"). Colours: Install green, PIESA blue, Ready Check orange.
- **Phone:** a day-by-day list (today marked, "Nothing booked" on empty days), with person filters that scroll sideways.
- **Tap a booking:** Day, Arrival, How long, the rule line, **Save changes**, Open the job. Saving moves the booking at once and confirms: "Saved: {day}, {start} – {finish}. The job and the owner are updated." Rule lines:
  - Install: "Must happen by {30-day date}. We tell ESC and the owner about any change."
  - PIESA: "The owner gets a new booking text and email."
  - Ready Check: "Just for your diary. The owner isn't messaged."
- **Still to book:** jobs ready to book, each with a button.
- Who can change bookings: the boss and office logins only (Leads and crew never log in).

### 4.4 Jobs
- Search filters as you type (name, address, HV).
- Tabs with counts: **Open · Your customers · Our leads · Done · Closed**.
- Each row: address; owner · HV · source; where it's at plus the key date; one tag (Fix first / Your turn / Waiting / Done / Closed).
- When the search finds nothing: "No jobs match. Try a different name, address or HV number."

### 4.5 Add a job (own customers)
- **Owner:** name, mobile, email, property address, and the required tick "{Name} agreed to Home Insulation Victoria contacting them".
- **Ceiling:**
  - How did you measure: On site / Floor plan / Aerial photo. Floor plan or aerial needs an upload, and Send is greyed out until it's done.
  - **Ceiling spaces:** starts with "Main house" + m²; "+ Add another ceiling space"; total m² worked out automatically.
  - What's up there now: Nothing / Old, staying / Old, removing. Removing shows a removal m² field.
- **Product and access:** the product picker (§4.8). Access is **Easy or Difficult**. Difficult adds the installer's difficult access fee.
- **Price:** **Use my rates** (shown as sums: install m² × the chosen product's rate + removal m² × removal rate + difficult fee) or **Type my own price**. It starts on the installer's default (§4.9 Rates). Photos are optional.
- **Quote summary** (beside the form on a computer, under it on a phone): owner, address, install, removal, product, access, price, and a live **Before you can send** checklist. **Send for quote** is green only when everything's ticked. "We check it, then send {name} the quote." **Save for now** saves a draft (owner, contact and address only); full checks run on Send. Sending twice gives the same job.

### 4.6 Our leads: the first step on the Job page
- **From photos:** "Quote from {name}'s photos". How did you measure (Aerial photo / Floor plan / On site), with the upload required for aerial or plan (Send greyed until uploaded), then install m², removal m², product, access, **Send**, and "Can't quote this one" (pick a reason: photos not good enough / too far / too busy / other; it goes back to our office). No price is entered: we quote from Home Insulation Victoria's prices and pay the installer their agreed rates.
- **With a Ready Check:** "Do the Ready Check". Call the owner and do it in Mitti under the HV number, "We'd love it within 5 business days". Button: Open the Mitti form, plus "Can't do this one". No date to book.
- Installers **never** see Home Insulation Victoria's price on our leads, anywhere (§8).

### 4.7 Steps and approved words
Each step keeps the v1 words approved on 6 Nov (handoff log, journeys 1–3), with these canvas changes:
- **Book the PIESA:** "{name} said yes. Book the PIESA." Fields: Electrician (Main pre-selected, changeable), Day, Arrival, calendar/How long. Button: Book.
- **Book the install:** "{name}'s deposit is in. Book the install by {30-day date}." Day, Arrival, calendar/How long. Days after the 30-day date can't be picked ("After {date} a new PIESA is needed. Call Home Insulation Victoria."). Lead and crew are picked later.
- **Pick the Lead and crew by {2 days before}:** one Lead Installer (approved, ESC-registered only), tick any number of approved crew, then **Save who's going**. If they aren't picked by 2 days before, the installer office gets one email.
- **Install booked:** a safety plan chip per person (signed ✓ / not signed · Remind, at most once an hour per person). Links: Change the day · Change who's going · Couldn't get in. GO email line added: "Your Lead still does the PIISA onsite before starting."
- **Paid:** "Paid · {date} · {amount}". Sent to account ending {last 4}.
- **Problem boxes** (replace the normal box when they apply):
  - Owner said no / Quote expired: grey, "Nothing for you to do".
  - **Cancelled** (red): "Please cancel anything you've booked on your end, like your electrician and crew."
  - **On hold:** "We'll let you know the moment it's back on."
  - **Couldn't get in:** rebook with Day, Arrival and calendar fields; our office is told.
  - **Part installed:** What's left, then rebook; our office is told; no paperwork approval or pay until finished.
  - **Electrician needed on install day** (red, Don't start): book the electrician.

### 4.8 Product picker (Add a job, quote from photos)
Every ESC-approved product for new jobs (Bradford Gold, Earthwool, Pink Batts; no ECOWOOL), from `ESC_APPROVED_PRODUCTS`. **★ Your favourites** come first (A–Z), then all other approved products A–Z by brand and R-value. Products under R5.0 stay available for topping up. The existing Activity 48 minimum check (`ACTIVITY_48_MIN_R`) still applies to the total installed R-value.

### 4.9 My business
- **Hub:** one list (Team · Business details · Rates · Products · Documents · Bank). Each line shows its state, amber when something needs fixing.
- **Team:** "{n} people · {n} need something" + Add a person. Three boxes: **Lead Installers · Crew · Electricians**. Each person shows **Approved ✓** or **Missing: {what}**, with Boss and Main tags.
  - **Person panel:** a Missing box with an Upload or Add button per item; for installers a Lead Installer / Crew switch with what each means; for electricians **Make main** (picked first when booking a PIESA); then details (CII, ESC registered, date of birth "On file" only, Mitti; or licence, REC, public liability), Edit details, Remove from team.
  - **Add a person:** name, mobile, role, and "We'll need…" (Lead: CII, date of birth for ESC, email for Mitti; Crew: CII; Electrician: licence, REC, public liability).
- **Business details:** business name, ABN, office phone and email ("Owners get this phone and email, never a worker's"), logo (shows on quotes for their own customers), **Who books the PIESA?** (Your office / Your electrician / Either), **Take our leads?** (Yes/No; open jobs carry on).
- **Rates:** show only, "To change these, call or email Home Insulation Victoria".
  - **Pricing your own jobs** default: Use my rates / Type my own price.
  - **Install, per product:** every approved product, with a switch between Your customers and Our leads.
  - **Other rates:** removal per m², difficult access per job, PIESA. All inc GST, with the effective date.
- **Products:** every approved product A–Z. Tap to star as a favourite.
- **Documents:** public liability ($5m or more) with expiry and Upload; the partner agreement. People's certificates live on Team. "If anything runs out, new jobs stop until our office approves the new one."
- **Bank:** shows the account name, masked BSB and the last 4 digits. Change bank details → new account → **Send for checking** → "Our office is checking your new account. We keep paying into account ending {last 4} until it's done."

### 4.10 Money
- **Top:** Coming to you (total, number of payments) · Next payment (amount, date) · Paid this month.
- **Coming to you,** grouped with each group's rule:
  - **Due soon:** date set.
  - **Paperwork being checked:** installs on our leads are paid 7 calendar days after we approve the install paperwork; PIESAs once we approve the safety check form.
  - **Waiting on the owner:** own customers are paid 7 calendar days after the owner pays in full.
  - Rows show address, Install or PIESA, amount and date or status, and open the job.
- **Paid tab:** date, jobs, amount, Remittance.
- Shows the bank line with a link to change it.
- Visible to the boss, and to office staff only if the boss turns it on (2 Nov rule).

### 4.11 Pages added after review (canvas, 6 Nov; awaiting Jo's OK)
- **Electrician's job link** (no login, phone, one link per job): for {electrician} · {business}; address, owner, Call, Directions. Shows only the next step: Book the PIESA (when the electrician books) → PIESA booked (Open the Mitti form; Change time · Can't do this one) → Pick the upgrades day (if upgrades are on another day; they quote and invoice the owner directly) → Upload the Certificate of Electrical Safety (install can be booked, can't start until it's in) → All done. Footer: the installer office's phone.
- **Safety plan signing** (no login, text link): for {person} · {business} crew; address and install day; **This house** (auto-filled from the Ready Check and PIESA); **Every job** (the approved SWMS wording, unchanged, "Read the full safety plan"); tick "I've read the safety plan and will follow it" → Sign (greyed until ticked) → "Signed. Thanks, {name}. {Lead} can see you've signed." Lead view: who's signed, with "Sign on my phone" for a crew member whose phone is dead.
- **Today's job** (boss/office, install day): GO or DON'T START banner (time checked, and the PIISA line); address, time, Call, Directions; who's going with safety plan status; job details (install m² and spaces, product, removal, watch-outs); **Open the Mitti install form**; "Something not right?" → Couldn't get in · Only part done today; balance due today.
- **Sign in and setup:** email → "Email me a sign-in link" (no password; stays signed in on that phone). First time: "Welcome, {name}. {n} things to set up before your first job" (Business details, Documents, Team, Bank, Products, each ticked when done; "I'll finish later"). Empty home: "No jobs yet. Add your own customer, or we'll email you when we give you one of our leads." + Add a job, and "{n} setup steps left".
- **Uploads** (photos, plans, aerials, certificates, insurance): Take a photo / Choose files; each file shows progress; uploads keep going if they leave the page; with no signal: "Your photos are saved on this phone and will upload when you're back online. Nothing is lost." Failed files show "Didn't upload" + Retry.
- **Team › Office staff:** a fourth group. An office person signs in with their email. **Can see Money** On/Off (only the boss can change it; default Off).

### 4.12 Office screens (Home Insulation Victoria side)
The office job page and To do list must show the new installer states and flags: on hold (reason), couldn't get in, part installed (what's left), measurements don't match (portal vs Mitti, newest shown, both viewable), electrician needed on install day, can't quote / can't do this one (reason, job back to the office to give to someone else), bank change to approve (approve / reject, with old and new last 4 digits), and diary-only Ready Checks (shown, no owner message). Office pages are otherwise unchanged.

### 4.13 Owner pages and messages
- Owner "You're booked" and the new "Your booking has moved" / "New install day" messages (§5 #1–4), each drafted and shown to Jo one at a time.
- Owner quote page and email: removal line, difficult access fee line, per-product price; installer logo only for their own customers; "Your quote is valid for 30 days, until {date}"; never "about"; never reveal that our leads are priced differently.

## 5. Messages, templates and touchpoints
Every new or changed message is drafted, shown to Jo **one at a time**, and approved before it's built (her rule). Each one sounds like Home Insulation Victoria: informative, clear, plain, using the installer office's phone and email and never a worker's. Messages to installer offices go by email only (never text). Automatic messages keep the 8pm–7am hold.

| # | Touchpoint | Who gets it | When | New or changed |
|---|---|---|---|---|
| 1 | You're booked (PIESA) | Owner, text + email | PIESA booked | Changed: shows the finish time when the booking is in the calendar |
| 2 | You're booked (install) | Owner, text + email | Install booked | Changed: as above |
| 3 | Your booking has moved | Owner, text + email | PIESA or install day/time changed (from the job or the Calendar) | **New** |
| 4 | New install day (couldn't get in / finishing off) | Owner, text + email | Rebooked after Couldn't get in or Part installed | **New** |
| 5 | ESC install notice update | ESC (robot) | Install day changed after the lock, keeping ESC's minimum notice | Changed: now also from the Calendar |
| 6 | Pick your Lead and crew | Installer office, email | 2 days before the install if not picked | **New** (replaces the 2pm day-before email) |
| 7 | Safety plan to sign | Lead and each crew member, text link | When they're picked; again the afternoon before if unsigned | Changed: sent on picking, not on booking |
| 8 | Safety plan reminder | That person, text link | Remind tapped (at most once an hour each) | Same |
| 9 | GO / DON'T START | Installer office, email (DON'T START copied to info@) | Afternoon before + 6:30am | Changed: GO adds "Your Lead still does the PIISA onsite before starting."; new DON'T START reason "electrician needed on install day" |
| 10 | Quote sent / owner said no / quote expired / job cancelled / on hold | Installer office, email | When it happens | Changed: words match the new boxes; cancelled asks them to cancel their electrician and crew |
| 11 | Can't quote this one / can't do this one | Our office (info@) | Installer declines, with reason | Changed: our-lead photo and Ready Check jobs |
| 12 | Couldn't get in / part installed / measurements don't match / electrician needed | Our office (Needs me + info@) | When it happens | **New** office flags |
| 13 | Bank change to approve | Our office | Installer sends new bank details | **New** |
| 14 | Bank details updated | Installer office, email | Office approves the change | **New** |
| 15 | Owner quote (email + page + PDF) | Owner | Quote sent | Changed: removal line, difficult access fee line, per-product price; installer logo only on their own customers; never "about" |
| 16 | Ready Check diary visit | Nobody | Installer adds a Ready Check to the calendar | **New: sends nothing**; a test proves no owner message goes |

**How we know they work:**
- Every template has a test that fills it with a real TEST job and checks the rules: right person, right job details, office phone (not a worker's), names in normal case, no "HIV", no "about", no percentages for the deposit, no price on our leads to installers.
- The nightly journey catches **every message sent** to the TEST inbox and checks each touchpoint fired once, at the right time, to the right person, and nothing went to a real person. Missing, extra or doubled messages fail the run.
- New messages stay held until Jo approves their wording and says switch them on.

## 6. New things the portal stores
- Booking: `in_calendar` (yes/no) and `duration` per booking (install, PIESA, Ready Check, rebooks).
- Diary-only Ready Check visits: no owner messages.
- Per-installer product favourites.
- Per-installer, per-product install rates for own customers and for our leads (effective-dated, read only to installers), plus removal, difficult access and PIESA rates. Accepted quotes keep the rates they were made with.
- Per-installer pricing default (Use my rates / Type my own price).
- Measurement method + plan/aerial upload on our-lead photo quotes. Removal m² on all quotes.
- Job draft state ("Save for now") from Add a job.
- Problem states: on hold (with reason), couldn't get in, part installed (what's left), electrician needed on install day.
- A pending bank change waiting for office approval.
- All SQL goes in `docs/pending-migrations/`, is proven on PGlite, and is only run live with Jo's yes.

## 7. Rule changes in this redesign (Jo, 6 Nov)
1. Booking the install asks Day + Arrival (+ calendar). Lead and crew are picked later, with any number of crew.
2. No install day after the 30-day date (hard block).
3. The installer can change a booking after the lock; the portal re-notifies ESC.
4. Pay: our leads 7 calendar days after paperwork approval; own customers 7 calendar days after the owner pays in full; PIESAs once the safety check form is approved.
5. Portal vs Mitti measurements: the newest wins and the office is flagged.
6. Bank changes need the office's OK first.
7. Amber for reminders, red only for stop.
8. The first progress step is "Measure".
9. Access is Easy or Difficult only, with a per-installer difficult access fee.
10. Each installer has a rate per product and a pricing default.
11. Our-lead photo quotes need a measurement method and an upload, like own leads.
12. Every booking has "Put it in the calendar?" and a How long; bookings can be moved and edited from the Calendar or the job.

## 8. Reliable, fast, never loses information (build rules)
- **Speed:** every screen gets its data in one database trip (speed step 2), and shows the last copy instantly while fresh data loads. Targets are measured on a mid-range phone on 4G: each screen readable in **under 2 seconds**, and every tap answered within 0.1 seconds. Buttons that change money, bookings or sends (Send, Book, Save changes, Save who's going, Pay, Give) wait for the real save.
- **No freezing:** no screen does more than one heavy load. Long lists page in. A failed load shows a clear message and a Retry button, never a blank page or an endless spinner.
- **Never loses information:** long forms save a draft as you type, and Save for now is offered too. It never says "Saved" until the server confirms. If a save fails, what was typed stays and Retry appears. Double taps and retries create one record.
- **Price privacy:** Home Insulation Victoria's price on our leads never appears in installer screens, server responses, files, email logs or exports. There are tests for this.
- **Access:** an installer only ever sees their own business's jobs and people. There are tests for URL and API access across businesses.

## 9. How it's checked (pages and functions)
- Every part: tests first, then code. A separate reviewer checks it against this spec and the canvas. Then the design-review skill. Then phone and computer screenshots to Jo.
- **Nightly automatic journey** (existing TEST job, `bun run portal-qa` / `journey --screens`): all three job types from start to Paid, plus every problem box, as boss, office, Lead, crew and electrician, at phone (390px) and computer (1280px) widths. It also runs:
  - double tap
  - lost connection mid-save
  - failed upload
  - Mitti and portal measurements on the same job
  - a booking moved after the lock
  - the price-privacy check
  - the cross-business access check
  - Results go in the 6am report. Gaps are reported as NOT RUN, never PASS.
- **Speed check:** load times per screen are recorded against the §8 targets. Any page over target is fixed before go-live.

## 10. Build order and go-live
Each step is its own pull request, merged by Jo:
1. Shared look and layout (menu, top bar, colours, fields, buttons).
2. Action items.
3. Job page and the Next step box, all steps and problem boxes.
4. Bookings: calendar fields, How long, change/move, the 30-day block, Lead and crew pick, the 2-day office email, ESC re-notice.
5. Calendar (computer and phone).
6. Jobs.
7. Add a job, including drafts, products, favourites and per-product pricing.
8. Our-lead first steps (photo quote with measurement and upload; Ready Check).
9. My business: Team (incl. office staff + Can see Money), Business details, Rates, Products, Documents, Bank (with office approval).
10. Money.
10a. No-login pages: electrician job link, safety plan signing. Today's job. Sign in + setup + empty states. Uploads (offline-safe).
10b. Office screens: new states and flags (§4.12). Owner pages and messages (§4.13), each message approved by Jo first.
11. Speed pass and reliability pass (§8), then the full nightly journey green.

**Go-live:** first Tom's test businesses. Then, when Jo says go, real installers (she'll pick who goes first).

## 11. Code map (starting points)
- `src/routes/_authenticated/field.tsx` (installer shell), `field.index.tsx` (home), `field.$jobId.tsx` (job), `field.money.tsx`, `field.business*.tsx` (My business pages).
- `src/lib/next-step-box.core.ts` (box kinds and words), `my-work.core.ts` (home list), `installer-job-sections.core.ts`, `business-screen.core.ts`, `team-screen.core.ts`, `installer-electricians.core.ts` (Main electrician), `in-house-booking.core.ts` (bookings), `certificate-chase.core.ts` (`thirtyDayEnd`), `esc-approved-products.core.ts` (products, R5.0 minimum), `photo-quote.core.ts`, `safety-check-price.core.ts`.
- Look: `src/styles.css` (`.portal-theme`) and `src/components/portal/kit.tsx`.
- Before workflow work: `bun scripts/scan-retired-terms.ts`. Read `src/AGENTS.md` and `src/lib/AGENTS.md` first.

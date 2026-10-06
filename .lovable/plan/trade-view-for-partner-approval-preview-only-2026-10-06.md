# Trade view for partner approval (preview only)

Goal: Jo signs in as a TEST electrician and a TEST installer on her phone and sees every screen a newly approved partner will see, each with real TEST data on it. Nothing goes to real partners, all sending switches stay off, nothing is published.

## What already exists (to be restyled, not rebuilt)
- Electrician offer page (first-tap booking, "It's yours!", "Too slow"), On the day page, My work, a basic Quick setup checklist.
- Installer Ready Check offer card and install-day offer inside My work.
- Business profile, team invite, payouts screens (office-style, not the approved trade tabs).

## What gets built

### 1. First login + quick setup (both trades)
- "You're approved" welcome card with the business name and logo.
- Sign-in: mobile + password, or a text code (text code shows "coming soon" until Twilio is verified; email code works now).
- Setup checklist saved to the database (not just the phone): Check your details, Rates & area, Bank details, Job alerts, Mitti setup, Team (optional).
- "You're all set" + "How it works" (electrician and installer versions).

### 2. Electrician screens (Jo's approved specs)
- Job offer: navy card, "Fresh job" + "Gone in {time}" pills, "Safety check in {suburb}", distance ("About N km away" until Google Maps is connected), own rate "in your pocket", 2-hour time tiles, "Can't make these" / "Not for me", Locked in card with Directions / Call owner / Calendar.
- My work: greeting + weekly count, navy "up for grabs" strip, "Your move" (green-bordered), "Coming up", "This month" mint strip.
- On the day: navy "Today · {window}" card, shared Before you start section, "⚡ Start check" → "Over to Mitti" → All clear / {N} fixes found.
- Money and My business (shared tabs, below).

### 3. Installer screens
- Ready Check offer: "~{m²} m²" with area source label, insulation tile, "~$X rough install value" from the installer's own rate, no-guarantee line, same first-tap flow.
- Ready Check day: same day pattern, "⚡ Start Ready Check", "Couldn't get in?" with four reasons → office Needs me item, re-offer to this installer first; Quoted / Not eligible outcomes.
- Install day: "Install today", "⚡ Start install", "That's a wrap" / "Nearly there, {N} photos missing".
- My work: installer version, four tabs (Work, Add job, Money, My business).

### 4. Shared pieces
- Before you start section on all three day pages (Sharp photos card, Phone check 3 ticks remembered per job, iPhone/Android location steps, Start button grey until all 3 ticked).
- Money tab: green "Landing in your account {date}" card, This month / All time tiles, Jobs list with Coming / Being checked / Paid pills, Download statements. Own pay only, from payout records.
- My business tab: Taking new jobs switch (pauses offers), expiry alert within 30 days, Paperwork list with pills, Where you work, The team + Add someone, footer Bank details · Your agreement · Sign out.
- Mobile-first at 390px, logo on every header, same fonts and colours as the owner pages.
- Installers never see the office's electrician list (checked on every installer screen and server call).

### 5. TEST logins for Jo
- TEST electrician: "Jo Test Electrical" (already exists) signed in as jolowexo+elec@hotmail.com, mobile +61477511901.
- TEST installer: new "Jo Test Insulation" signed in as jolowexo+install@hotmail.com, same mobile. Both marked TEST everywhere.
- Hotmail delivers "+" addresses to jolowexo@hotmail.com, so both logins reach Jo's normal inbox. Jo sets each password from a reset email.
- TEST jobs (source qa_test) in every stage, so every screen has something on it: an open offer, a booked visit today, a booked visit later, a "Your move" item, all clear / fixes / quoted / not eligible / missing-photos outcomes, and paid / being checked / coming payouts.

## Checks before reporting
- Each screen screenshotted at 390px as both TEST logins.
- Installer login cannot open the electrician list or any electrician-only page.
- Focused tests: own-rate maths, area-source wording, no-guarantee copy, first-tap race, Before you start gating, Money pills, Taking new jobs pause.
- No message sent to anyone except Jo's allowlist; real partners untouched.

## Assumptions to confirm
- Two "+" email addresses for the two TEST logins (one person cannot hold both trade roles cleanly on one login).
- Text-code sign-in waits for Twilio verification; password and email code work now.
- "Download statements" shows a simple PDF/CSV of the jobs list for now.

## Technical notes
- Restyle existing `/field` routes; add `/field/welcome`, `/field/money`, `/field/business`; shared `TradeDayPrestart`, `TradeOfferCard`, `TradeMoney`, `TradeBusiness` components.
- Setup checklist state moves to a small table (proved on the practice database first, then applied).
- "Taking new jobs" uses an existing business flag if present; otherwise a new column, proved on the practice database first.
- Presentation derivations in pure `*.core.ts` with tests; workflow rules unchanged.

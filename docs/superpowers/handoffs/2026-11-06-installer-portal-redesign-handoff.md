# Handoff: installer portal redesign (6 Nov 2026)

Written so a fresh chat can pick this up without Jo repeating herself.
Jo (owner, Home Insulation Victoria) works from her phone; ask every question in a box (AskUserQuestion), short plain words, and if she says "Can't see", re-send the text with SendUserMessage then re-ask.

## Where we are

Superpowers brainstorm of the whole installer journey is almost done. Four screens are mocked up and **approved**. Jo is dictating the "what happens when" words per step, one journey at a time. Journey 1 (own customer) is approved through step 8; step 9/Paid is drafted and awaiting her OK.

**Next action:** send her the step 7/8/9 mock-up (`docs/superpowers/mockups/2026-11-06-installer-portal/s789.png`) and ask in a box: "Certificate as a reminder, never a block. Step 9 and Paid approved?" Then dictate journey 2 and 3 (below), then write the spec, self-review it, get Jo's review, then `superpowers:writing-plans`, then a subagent-driven, reviewed build.

Spec path to create: `docs/superpowers/specs/2026-11-06-installer-portal-redesign-design.md`.

## Who it's for

All installer bosses (phone) **and** their office staff (desktop). Jo: "it's measure and quote and desktop mostly", "they do measure and quote off our photos!!! Desktop!!!" Not just Deep/Reinsulate.

## Approved layouts (mock-ups in `docs/superpowers/mockups/2026-11-06-installer-portal/`)

Palette/fonts from `docs/templates/installer/portal/M7-business.html` (#22376B ink, #5A6785 sub, #3C51C4 blue, #07BF61 green, #E4E9F5 lines, #F7F8FC bg, Outfit headings / Figtree body).

1. **My work** (`mw-*.png`): table on desktop, cards on phone. Only jobs where they must do something. Card/row shows: job number · full street address (PR #184 adds `cardAddress(street, suburb)` → "HV-3821 · 12 Smith St, Melton"), owner name, green tag = the one next action, due. No Mitti form reference on cards.
2. **Job page** (`s4b-*.png`, the final layout): header (Your customer / Our lead chip, job no., owner name, full address, Call + Email buttons) → 6-dot progress (Ready Check · Quote · PIESA · Deposit · Install · Paid) → **full-width Next step box** (green left bar, short title + 1–2 line text, status chips, "What happens from here ›" link that opens the long version, booking fields + big green button beside the text on desktop, stacked on phone) → two columns on desktop / stacked on phone: **Job details** (install m² · areas, removal, existing insulation, product brand + R value, roof/access, notes) and **Money** on the left; **Photos & videos** (+ Add photos; shows Ready Check / A5 / PIESA / uploaded, all four), **What the owner's been told**, **Paperwork** on the right. Jo rejected: narrow left column, empty right column, long text in the box.
3. **Add a job** (`aj-*.png`): one form. Owner, address, contact, how they measured. If they choose floor plan or aerial, the upload of it is **mandatory**. Product (brand + R value) is on the measure-and-quote form. Then Save → job shows in My work as "Measure and quote".
4. **My business** (`mb-*-3.png`): six spacious tiles with icons/chips, no sublines: Team · Electricians · Details (incl. who books safety checks, takes HIV leads) · Rates (show only, inc GST, "To change these, call or email Home Insulation Victoria" — **no request-a-rate-change**) · Documents (Insurance + Agreement merged, uploads, expiry) · Bank (no "pending" word).

## Rules Jo set

- Three wording tracks: (1) own customer, (2) our lead from photos (installer measures and quotes from our photos, desktop), (3) our lead with Ready Check. Same words from "Waiting for the owner" onward.
- No deadlines on their own jobs (drop "due by" on own-customer steps).
- Never "10% deposit" or any percentage — say "your deposit".
- "electrician", not "usual electrician".
- They pick the electrician **when they book the PIESA** (Main electrician pre-selected from their approved list, changeable). Jo repeated this on 6 Nov 11:16.
- Certificate of Electrical Safety: a **reminder chip + Upload link, never a block**. "It can move to install without COES!!"
- Remind link next to each unsigned safety-plan name: re-sends that person's sign-link text, max once an hour per person.
- Crew get their own safety-plan text on booking and again the afternoon before if unsigned.
- Owner quotes valid 30 days; we touch base day 3 and 2 days before expiry. Deposit chase day 3 and 7. Balance chase days 1, 3, 7.
- Installers ring or email HIV for rate changes; no request button.
- Don't add unasked features. Never apply SQL live or send emails/texts without Jo's explicit yes. Claude may push branches/PRs; Jo merges (ask in a box).

## Journey 1 — own customer — APPROVED words (steps 1–8)

**Step 1 – Measure and quote** (box title). Text: "Measure up on site, then add the sqm, what's in the ceiling, product, access, photos and your price here, or do the Ready Check in Mitti (the form's already there under HV-3821). Press Send for quote and we take it from there." Button: **Measure and quote**.

**Step 2 – Quote being prepared.** "We put the quote together with your price, the PIESA fee and our $349 fee, less the owner's rebate, and send it to the owner. You'll get an email when it goes out. Nothing for you to do." No button.

**Step 3 – Quote with the owner.** "Sent Thu 6 Nov · valid until Sat 6 Dec. We touch base with Jo on day 3 and 2 days before it expires. You'll hear from us the moment she accepts or declines." Button: See the quote. Links: Offer a discount · Change my price.

**Step 4 – Owner accepted. Book the PIESA.** Box title "Jo said yes. Book the PIESA." Short text: "Call Jo, agree a day and time, and book it here. The PIESA fee is already paid." Fields in the box: Electrician (Main pre-selected) · Day · Arrival. Button: Book. *What happens from here:* "We'll give you the green light to proceed to the PIESA. Call the owner and book the day and time, and please don't forget to book it here. The owner gets a confirmation. Your electrician is chosen from the approved people in your list. They do the PIESA and you both get the results. Any electrical upgrades are quoted and invoiced to the owner directly by you."

**Step 5 – PIESA booked.** "PIESA booked · Wed 12 Nov, 9:00am · James Spark. The owner's been told. Nothing for you to do." Links: Change time · Change electrician. *What happens from here:* "The PIESA form appears in your electrician's Mitti. They do the check on the day. The result comes back here, the owner gets their copy, and you get yours. Any electrical upgrades are quoted and invoiced to the owner directly by you."

**Step 6 – PIESA done. We're collecting the deposit.** "All clear. We've sent Jo the result and asked her to pay her deposit. Nothing for you to do." *What happens from here:* "We touch base with Jo on day 3 and day 7. We'll email you the moment it's paid so you can book the install." If upgrades are needed the box says instead: "Upgrades needed. Quote and invoice the owner directly, then upload the Certificate of Electrical Safety here when they're done." Button: Upload certificate. (Reminder only — never blocks.)

**Step 7 – Deposit paid. Book the install.** "Jo's deposit is in. Call her, agree a day, pick who's going, and book it here. Install by Fri 12 Dec (30 days from the PIESA)." Chips: Deposit paid ✓ · Certificate not uploaded yet · Upload. Fields: Lead Installer · Crew · Day · Arrival. Button: Book the install. *What happens from here:* "We notify the ESC the day before, then the date's locked. Your Lead and each crew member get a text with the safety plan to sign, straight away and again the afternoon before if they haven't. Your Lead also gets the Mitti install form."

**Step 8 – Install booked.** "Install booked · Fri 21 Nov, 8:00am · Lead: Deep · Crew: Raj. Install by Fri 12 Dec." Chips: Consent signed ✓ · Deposit paid ✓ · Safety plan per person (signed ✓ / "not signed · Remind") · Certificate not uploaded · Upload. Button: Today's job (on the day). Links: Change the day · Change who's going. *What happens from here:* "The afternoon before, you get a GO or DON'T START email. Your Lead signs the safety plan and does the install form in Mitti. The owner pays the balance on install day."

**Step 9 – Install done** (DRAFT, awaiting Jo). "Install done · Fri 21 Nov. Jo pays the balance on install day. You're paid once she's paid in full." Chips: Install form ✓ · Rebate form signed ✓ · Balance not paid yet · Certificate uploaded ✓. *What happens from here:* "If Jo hasn't paid, we touch base on days 1, 3 and 7. The moment she's paid in full, we pay you and this job moves to Done."

**Paid** (DRAFT): "Paid ✓ Mon 24 Nov · $2,500.00."

### 6 Nov 11:30 — steps 7–9 REDONE and APPROVED (replace the step 7/8/9/Paid text above)

- Lead and crew are picked on Fridays for the next week, so **booking the install asks for Day + Arrival only**. Crew can be any number of people (tick boxes).
- **Step 7 – title:** "Jo's deposit is in. Book the install by Fri 12 Dec." Text: "Call Jo, agree a day and time, and book it here. The install must happen by Fri 12 Dec (30 days from the PIESA). You pick who's going later." Fields: Day · Arrival. Button: Book the install.
- **Days after the install-by date can't be picked (hard block).** Message: after Fri 12 Dec a new PIESA is needed, call Home Insulation Victoria.
- **Step 8 – Install booked:** "Fri 21 Nov, 8:00am. Install by Fri 12 Dec. Pick your Lead Installer and crew by Wed 19 Nov (2 days before)." Pick one Lead Installer, tick any number of crew. Button: Save who's going. Link: Change the day. If they aren't picked, the installer office is emailed 2 days before the install.
- **Step 9 – Install done · Fri 21 Nov:** "Jo pays the balance on install day." (no "you're paid" line). What happens from here: "If Jo hasn't paid, we touch base on days 1, 3 and 7. Once she's paid in full, this job moves to Done."
- Mock-up updated: `s789.png`. The Paid box wasn't discussed again.

**Next:** journey 2 step 1.

## Journeys 2 and 3 — still to dictate

Today's words on our-lead jobs (for Jo to redo, one step at a time):
- Journey 2 (our lead from photos): Step 1 today = "Quote from photos — Look at the owner's photos, fill this in and send it. Due by Mon 10 Nov." Jo said "No" to that; she hadn't yet said whether it's the words, the deadline, or the step.
- Journey 3 (our lead with Ready Check): Book the Ready Check ("Give Helen a call and agree a day, then add it here. Book by…") → Ready Check booked ("Fill in the Mitti form on the day") → Enter your price → Quote being prepared → Waiting for the owner to decide → Book the PIESA → PIESA booked → Waiting for the deposit → Book the install → Install booked → Install done ("Your $1,920 is paid 7 days after we approve the install paperwork").
Our-lead jobs end differently: installer is paid 7 days after HIV approves the install paperwork, not when the owner pays.

## Code pointers

- `src/lib/next-step-box.core.ts` (box kinds/titles/text), `src/routes/_authenticated/field.$jobId.tsx` (job page folds), `src/lib/installer-job-sections.core.ts`, `src/lib/business-screen.core.ts` (7 rows → 6 tiles), `src/lib/my-work.core.ts` (cards; PR #184 open, clean, waiting on Jo's merge), `src/lib/installer-electricians.core.ts` (`readMainElectrician`, `defaultPick`), `src/lib/in-house-booking.core.ts`.
- Related specs: `docs/superpowers/specs/2026-11-05-photo-quote-installers-design.md`, `2026-11-05-fifty-percent-deposit-design.md`.
- Repo habits: see `AGENTS.md`; bun tests one file at a time; tsc with `NODE_OPTIONS=--max-old-space-size=4500`; PRs via `gh api` REST; Lovable sync branches merged with a merge commit, never squash.

## Also outstanding (not this redesign)

- Ask Jo to merge PR #184.
- Remind Jo: Publish → Update in Lovable after merges.
- Paused: recovery plan Tasks 7–20 on branch `spec/recovery-paths`.

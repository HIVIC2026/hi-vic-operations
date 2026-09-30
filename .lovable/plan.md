# Installer onboarding: the two ways we work together + name-first

## 1. Ask their name first, then use it everywhere
- New first screen (before "Have these handy"): "What's your name?" (first + last) and mobile/email.
- Saved straight away; every later screen greets them by first name ("Nice one, Sam — next, your insurance").
- Contact step no longer re-asks their name (pre-filled, editable).
- Signing screen pre-fills their name.
- Team-up invites: when someone is invited (electrician by an installer, or an installer by another installer/electrician), the invite already carries their name and who invited them. Their first screen reads "Hi Sam — Jo from ABC Insulation has picked you as their preferred electrician." They only confirm the name, never retype it.
- Same name-first step added to electrician onboarding.

## 2. New "How we work with you" section (two clear options)
Shown as two side-by-side coloured cards in onboarding, repeated in the installer portal as a help page, and summarised in the agreement.

### Option 1 — You bring the customer
Step by step, in plain words:
1. You submit the job in the portal: owner name, address, contact, your quote, and any measurements and photos you already have.
2. If your measure-up and photos are complete, nothing is repeated. If they're partial, you only capture what's missing. If you have none, you do the free Ready Check yourself using our app.
3. We contact the owner — and why: as the Accredited Person, the law makes us responsible for the owner's eligibility, consent, the electrical safety check and the VEEC assignment. We must hear it from the owner directly; we can't take it second-hand.
4. Electrical safety check (PIESA): your electrician at your agreed onboarding price, or ours at $349 inc GST.
5. We send one co-branded quote (your branding plus ours) showing your price, the check, our AP fee and the VEU discount. The owner e-signs it.
6. We invoice the owner and chase payment, including the 50% deposit. You don't chase money.
7. You install, submit photos and your installer declaration the same day. We do the AP review and lodge the VEECs.
8. You get paid your quoted price. No referral fee on your own customers.
- Your routine sales contact with the owner (follow-ups, scope, reviews) stays with you; we handle the formal compliance contact and tell you when we've been in touch.

### Option 2 — We bring the customer to you
1. We pre-qualify every lead through our website and Gate 1 eligibility checks, so you don't get time-wasters.
2. You get the job offer in your portal; accept or decline.
3. You do the free Ready Check (measure-up and photos) using our app.
4. We handle the owner, the safety check, the quote, invoicing and payment chasing.
5. **$220 lead fee — only if the owner accepts the quote.** If the owner doesn't accept, you pay nothing. No fee on ineligible or cancelled leads.
6. You install and submit evidence on the day; we review and lodge.

### Our app: get it right on the day
Pitch at the top of both options: our app walks you through every photo and reading needed, in order, so each job is complete on the day — no revisits, no lost VEECs.

### Flexible on electricians — saved preferences
- Bring your own electrician (once they're onboarded), or use ours.
- Your preference is saved on your account: "Always use my electrician (name)", "Always use the Home Insulation Victoria electrician list", or "Ask me each job". Jobs follow it automatically; staff can change it.
- Price: your electrician at their agreed onboarding price, or ours at $349 inc GST.

### Payment terms (both options)
One co-branded invoice to the owner; 50% deposit before any work is scheduled; balance due on install day. We chase payment. You're paid your quoted price after the balance clears (exact payout timing to confirm).

### How we all talk: through the portal only
- All contact with owners, electricians and our team happens in the job's messages in the portal: no phone calls, no outside texts. That way everyone can see where the job is up to, and it's our audit record.
- Booking dates are proposed and accepted in the portal ("Electrician proposed Tue 10am → owner accepted → locked in").
- Owner contact details stay masked; the portal is the channel.
- Explained in onboarding and added to the agreement (new version, re-sign).

### 24-hour rule on our leads
- When we give you a lead, you must message the owner in the portal within 24 hours.
- At 24 hours with no contact, the owner is offered a choice in their portal: keep waiting, or choose a different installer (or electrician, if the electrician is the one not responding).
- If the owner switches, the job moves to the new installer with its full history; nothing is re-entered and no lead fee applies to the first installer.
- Staff see it in To action at the same time. Nothing is sent automatically until communications are switched on for launch.

### "What we do as your Accredited Person" list
A plain checklist so they see the workload: eligibility checks, owner consent and permission, safety-check coordination, official forms (PIESA/PIISA) filled and signed, 24-hour notices, quote and invoice, deposit and balance chasing, evidence review, VEEC creation and lodgement, 6-year record keeping, audits.

### "Why the $349" box
The $349 inc GST covers both the pre-install electrical safety check (PIESA) and our Accredited Person work: eligibility, owner consent, official forms, 24-hour notices, quote and invoice, payment chasing, evidence review, VEEC creation and lodgement, 6-year records and audits. The box explains why each is legally required and that the owner pays it on the co-branded invoice, not the installer. (If the installer brings their own electrician, how their price and our fee combine is shown in decision 1.)

### Common questions (FAQ)
- I already agreed a price with the owner — what happens?
- I have photos and measurements already — how do I send them?
- Who talks to the owner, and when?
- Who sends the quote? Who chases payment?
- The owner turns out ineligible — what happens to my time/fees?
- When is the $220 lead fee charged, and when isn't it?
- I have my own electrician / work with another installer — how do we team up?

## 3. Agreement wording
The installer agreement is a signed legal document. Any change to it gets a new version number and existing signers are asked to re-sign. Option 1/Option 2 summary goes into the new version only after you approve the wording.

## Decisions still needed (I won't guess these)
1. Decided: $349 covers both the safety check and our AP fee. Still to confirm: is it one $349 total, or $349 each? And if the installer uses their own electrician, does the owner pay their electrician's price plus our AP fee?
2. Decided: if the installer already agreed a price with the owner, our fees go on top (owner sees installer price + our fees, less VEU discount). The FAQ says so plainly, so installers tell owners up front.
3. Decided: on referred jobs the installer quotes after doing the Ready Check.
4. Decided: the $220 lead fee is deducted from the installer's payout. (Still to confirm: inc or ex GST.)
5. Decided: the installer is paid once the owner's invoice is paid in full.
6. Answered from the regulator's rules (see "What the rules say" below).

## Technical details
- Add `step 0` "about you" to `installer-onboarding.tsx` and `electrician-onboarding.tsx`; store in existing onboarding data (`primary_contact_name`, email, mobile); greeting helper uses first name.
- Invites pass invitee name + inviter name/business from `electrician_nominations` into the prefilled start.
- New shared content module `src/lib/partner-howitworks.ts` feeding onboarding cards, portal help page and FAQ, so wording lives in one place.
- Agreement change = version bump of `installer-agreement.text.ts` + re-sign flag.
- Fees read from settings (never hard-coded).
- Upload sorting: server function sends each image/PDF (private signed URL) to the Lovable AI image-reading model; returns suggested evidence category, confidence, extracted values and quality issues; saved as suggestions against evidence requirements; staff verify via the existing evidence status flow.
- Per-requirement settings: capture stage (before quote / before install start / after install) and whether it blocks — admin-approved only.
- "Before you start" gate added to the field install screen and the central stage-entry guard.
- Roadmap gets these three tasks at build start.

## Partial evidence (installer has some, not all)
Example: ceiling-space photos but none of the existing insulation.

**Installer:** drops everything into one upload box — photos, videos, PDFs, measure-up sheets, quotes. No sorting.

**Portal automatically:**
1. Reads each file and works out which requirement it fills (ceiling space before, existing insulation/R-value, manhole access, measurement sheet, downlights/clearances), pulling out measurements and R-values where readable.
2. Shows each match as "suggested" with confidence; only counts once staff tick it.
3. Flags blurry, wrong-room, undated or duplicate photos with a plain reason ("Can't see insulation depth — retake with a tape measure in shot").

**Everyone sees "What we have / What's missing":**
- Have: Ceiling space before (6 photos) — checked
- Missing: Existing insulation close-up with depth — how we'll get it: installer takes it on install day, before starting
- Missing: Ceiling area confirmed — how we'll get it: Ready Check, or the electrician at the PIESA visit
Each item shows who gets it, when, and whether it blocks the next step.

**Missing items go onto the install-day Mitti form automatically:**
- For each job, the system works out what's still missing and adds exactly those questions/photos to that job's install-day Mitti form, marked mandatory ("Before you start: photo of existing insulation with tape measure showing depth").
- The installer can't submit the "before" section, or start the install, until they're done. Answers sync back, fill the requirement, and feed the official PIISA automatically.
- The installer sees one plain list on the job: "Already have ✓ / You'll capture on install day / Needed before we can quote".

**Is capturing it on install day allowed? Two groups:**
- **Can be captured on install day, before work starts** (time-stamped, before any insulation goes in): typically "before" ceiling-space photos, access/manhole, product labels, clearances. To be confirmed item by item against the Activity 48 pack.
- **Must be known before the quote**: anything that decides eligibility or price — existing insulation presence/R-value, ceiling area, removal needed, electrical safety check result. If missing, the installer gets it before quoting (their own visit, or the Ready Check), never on install day. If install-day findings contradict what was quoted (e.g. insulation found), the install stops and the job goes to review.

### What the rules say (Essential Services Commission, Activity 48)
| Item | When it can be captured | Source |
|---|---|---|
| Installer safety form (PIISA) | Install day, **before any insulation work starts**: lead installer signs | ESC ceiling insulation activity page |
| Electrical safety form (PIESA) | Before any work, **no earlier than 30 days** before install. Not on install day by the installer | ESC ceiling insulation activity page |
| Geotagged photo of cables at the switchboard | Taken by the electrician at the PIESA visit (installs from 21 Aug 2026) | ESC update, 30 Jul 2026 |
| Pre-installation video/photos of the ceiling space | Before work starts, so install day before starting is OK | ESC update, 30 Jul 2026 (pre- and post-install video) |
| Upgrade area (diagram/floor plan) | Before quote, because it sets price and VEECs | ESC update, 30 Jul 2026 |
| Existing insulation / average R-value (must be under R2.0) | **Before quote**, because it decides eligibility | ESC ceiling insulation activity page |
| Downlights/luminaires affecting eligibility | **Before quote**, because it decides eligibility | ESC ceiling insulation activity page |
| Install notification to ESC | Our job: 24 hours to 5 days before install | VEU Registry update, 14 Apr 2026 |
| Post-installation video/photos | Straight after install, same day | ESC update, 30 Jul 2026 |

So yes: before-install photos/video and the installer safety form can be added to the install-day Mitti form, captured before work starts. Anything that decides eligibility or price, plus the electrician's form and switchboard photo, must be done before quoting/booking. Before switching this on, I'll check the exact wording against the full Obligations and Program Guide (record-keeping annexure).

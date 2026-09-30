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
Explains exactly what the $349 electrical check covers and why it's required before install.

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
1. The $349 — only the electrical safety check, or also the AP fee? What AP fee amount do installers see?
2. Installer already agreed a price with the owner: our fees added on top (less VEU discount), or must their price include them?
3. Referred jobs: installer quotes after the Ready Check, or we price from their rate card?
4. $220 lead fee: deducted from the installer's payout, or invoiced separately? Inc or ex GST?
5. When is the installer paid (e.g. within X days of balance clearing)?
6. Which evidence items may be captured on install day before starting, versus needed before the quote? I'll list each for you to tick.

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

**"Before you start" on install day:** allowed items appear as a phone checklist; the install can't be marked started until each is uploaded (time-stamped camera). Anything that could change eligibility, quote or price is marked "Needed before quote" and never left to install day.

**Which items can wait:** a setting per requirement, set by you from the Activity 48 pack — nothing is marked "can wait" until you approve it (added as decision 6).

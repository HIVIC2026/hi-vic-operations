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
2. If your measure-up and photos are complete, we don't repeat them. If they're partial, we only ask for what's missing. If you have none, we do a free Ready Check.
3. We contact the owner — and why: as the Accredited Person, the law makes us responsible for the owner's eligibility, consent, the electrical safety check and the VEEC assignment. We must hear it from the owner directly; we can't take it second-hand.
4. Electrical safety check (PIESA): your electrician at your agreed onboarding price, or ours at $349 inc GST.
5. We send one co-branded quote (your branding plus ours) showing your price, the check, our AP fee and the VEU discount. The owner e-signs it.
6. We invoice the owner and chase payment, including the 50% deposit. You don't chase money.
7. You install, submit photos and your installer declaration the same day. We do the AP review and lodge the VEECs.
8. You get paid your quoted price. No referral fee on your own customers.
- Your routine sales contact with the owner (follow-ups, scope, reviews) stays with you; we handle the formal compliance contact and tell you when we've been in touch.

### Option 2 — We refer the customer to you
1. The enquiry comes through our website; we do eligibility and the Ready Check.
2. You get a job offer in your portal; you accept or decline.
3. We handle the owner, the check, the quote, invoicing and payment chasing.
4. You install and submit evidence; we review and lodge.
5. Referral fee applies (amount and rules below).

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
- When does a referral fee not apply?
- I have my own electrician / work with another installer — how do we team up?

## 3. Agreement wording
The installer agreement is a signed legal document. Any change to it gets a new version number and existing signers are asked to re-sign. Option 1/Option 2 summary goes into the new version only after you approve the wording.

## Decisions I need from you before building (I won't guess these)
1. Referral fee: who pays whom, and how much? (Saved notes say $220 — please confirm it's the installer paying us on referred jobs.)
2. When doesn't it apply? (e.g. ineligible, owner declines, cancelled, owner was already the installer's customer.)
3. The $349 — is it only the electrical safety check, or also the AP fee? What is the AP fee amount installers should see?
4. Installer already agreed a price with the owner: do we add our fees on top (owner sees a higher total, less the VEU discount) or must the installer's price already include them?
5. Referred jobs: does the installer quote, or do we price from their rate card?

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

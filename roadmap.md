# Roadmap

## Now
- [x] Prevent cancelled preview page requests from surfacing an AbortError and blanking the screen
- [x] Complete authorized REC refinements: fix save/navigation races; verified AU/VIC addresses; exact service/availability/rates copy; staff links; assigned-REC standard/custom rates; agreement v2.3 source reconciliation and official $5m insurance override; terminology sweep; focused tests, provider/browser checks, viewable screenshots and audit
- [x] Finish REC onboarding polish: shared trade copy, isolated no-write samples, legacy draft resume, retry state, focused verification
- [x] Audit and refine REC business onboarding, worker invitations and worker join screens; fix activation validation ordering
- [x] Delete obsolete old-brand email templates and old calculator code; preserve approved current templates and customer calculator
- [x] Point customer email calculator links to the built calculator at the customer-domain home address
- [x] Retire viewed and seven-day estimate reminders; suppress legacy queued rows; clarify free measure-up visit copy and verify previews
- [x] Boss signs up business; workers join via personal invite link (/join)
- [ ] Installer agreement audit: payment timing contradiction (step 2/cl.27 vs cl.17); free Ready Check mandatory (remove step 8 "No"); customer-contact rule for installer-supplied customers vs cl.28; "your customer, your price" vs HIV pricing; PIESA booking/payment order; separate EEC Certified Insulation Installer certification from training


## In progress (approved plan: installer onboarding overhaul)
- [ ] Name-first step on installer + electrician onboarding; greet by first name throughout; invites prefill invitee name + inviter business
- [ ] Shared "How we work with you" content module (Option 1 own customer / Option 2 our lead), portal help page, FAQ
- [ ] "Why the $349" box (covers safety check + AP work; confirm one $349 total vs each)
- [ ] Saved electrician preference per installer (own / HIV list / ask each job)
- [ ] Partial evidence: one upload box, AI-suggested requirement matching, staff verify, have/missing list
- [ ] Install-day "Before you start" checklist auto-built from missing allowed items; feeds Mitti/PIISA
- [ ] Per-requirement capture-stage settings (before quote / before install start / after install) per ESC table; verify against full Obligations & Program Guide annexure before enabling
- [x] Shared gate timeline for staff/installer/electrician with countdowns (PIESA 30-day validity, ESC notification 24h–5d, PIESA copy 24h, same-day rectification quote)
- [ ] 24-hour rule on our leads: owner offered choice of different installer/electrician after 24h no contact
- [ ] Installer agreement new version with Option 1/2 + portal-only communication wording; re-sign flag
- [ ] Referred jobs: owner quoted at our set customer price; installer paid agreed onboarding rate; $220 lead fee deducted from payout only when owner accepts; installer paid once owner invoice fully paid

## Decisions locked this session
- $349 = both safety check + AP fee (confirm one total vs each)
- Pre-agreed installer price: our fees on top (owner sees less VEU discount)
- Our leads: set customer price; installer paid agreed rate; margin internal only
- $220 lead fee: only when owner accepts; deducted from payout; never on ineligible/declined/cancelled
- Installer paid once owner invoice paid in full
- Portal-only communication; 24h no-contact rule on our leads

## Still open from before
- [x] Electrician team-up worker path (under someone else's REC: name + licence + host REC only; no ABN, insurance, rates or bank — head company owns those)
- [ ] Chase service areas from 6 installers; partner/postcode coverage follow-ups
- [ ] Mitti form IDs from user — now FOUR: A1 (installer-sourced, with quoted price), A2 (our leads, no pricing), B (PIESA), C (PIISA); briefs in Mitti_template_briefs_v4.md
- [ ] Browser-verify owner/electrician/installer job views as those roles
- [ ] Confirm: $349 one total vs each; $220 inc/ex GST; own-electrician price + AP fee combination
- [x] Public client calculator page (light one-screen, live cost, no sign-in) — built; needs publishing to give clients the permanent link
- [x] Calculator: fix the bottom of the page — footer split into two short lines, pink tint removed, sticky bar tightened
- [x] Calculator: question labels and hints darkened for readability
- [x] Calculator: "What this includes" panel — Ready Check $0 and its value, electrical safety assessment + PIESA, EEC-certified installer, Home Insulation Victoria as Accredited Person
- [x] Calculator: "Register my interest" lead capture (name, mobile, email, address) stored with consent — no messages sent, no job created



- [x] Ready Check: replace Class 1/2 jargon with prefilled Property type; portal derives class
- [x] Ready Check: insulation type multi-select (batts AND loose fill) + remove/top-up + measurement method provenance
- [x] Ready Check: removed duplicated job-level totals — portal computes from per-area answers
- [ ] Ready Check: per-room insulation type multi-select (batts AND loose fill) + remove-vs-top-up choice instead of bare removal yes/no
- [x] Full audit of Mitti Form A (Ready Check) vs portal/quoting/ESC needs; corrected paste-ready brief v3 delivered
- [x] Ready Check two variants: A1 installer-sourced with quoted-price section (lines/total/includes/agreed), A2 evidence-only; portal picks by job channel; validateQuotedPrice fails closed on mismatches
- [ ] Refine partner onboarding screens (walk as installer/electrician, fix gaps)
- [ ] Redesign all customer-facing email templates (brand, HIV wording)
- [ ] Onboarding invite email explaining what we do
- [ ] Multiple full dummy job run-throughs (6 scenarios)
- [ ] Verify automations (To action, next-step rule, overdue flags)
- [ ] Email sending domain setup
- [ ] Xero invoice design + preflight approval
- [ ] Owner portal walkthrough
- [ ] Mobile check on trade screens
- [ ] Final security/RLS pass
- [x] Connect Mitti A1 template_01ee0428be6d4435b34d8b738935f099 + validate
- [ ] Mitti forms: send with a direct open link + clear assignment so the person is notified (not clunky)
- [ ] Email domain setup for homeinsulationvictoria.com.au (blocker: user DNS records) — then scaffold app email templates and wire the installer "Ready Check ready" notification email

- [x] Company profile + worker job links (company lists workers, office approves, per-job magic link with form, timeline and owner messages)
- [ ] Worker link: photo/evidence upload directly on the link page (today photos go through the Mitti form)
- [ ] Worker link: send by text/email automatically once communications are switched on

## Public calculator (client-facing)
- [x] Heading font and colour changed; more blue and green
- [x] Insulation question options as clear labelled boxes
- [x] Register form: full name, mobile, email only; address carried down from the calculator
- [x] Heading font: Space Grotesk and Syne both rejected — now Outfit 800, the portal's own heading font
- [x] Property question = full address with type-ahead autofill (not postcode)
- [x] Darkened remaining light grey text (placeholders, hints, suffixes, footer)
- [x] Button wording "Demand is high — register your interest" (AP-safe: no rebate promise, no fake deadline)
- [x] Address search returns Victorian properties only — no state guessing, so Canberra/NSW rows can never appear as VIC
- [x] Give clients the permanent link — live and public at https://hi-vic-operations.lovable.app/calculator (no sign-in)
- [x] Portal menu "Customer calculator" was opening the old test page — now opens the new calculator
- [x] Calculator: removal note ($10-$15/m² of area requiring removal, installer advises at Ready Check), demand-high badge + green register button, includes order Ready Check → PIESA → install → AP
- [x] Calculator flow: existing-insulation note moved under its answer, VEU discount made prominent, footer simplified, old test calculator deleted
- [x] Calculator phone usability: show live price before supporting details, shorten prompts, and verify answer-to-result flow at phone and desktop sizes
- [x] Blank-screen recovery: a page load that drops part-way now shows "This page needs a refresh" with a working refresh action
- [x] Calculator visual refinement — calm redesign applied (v1 direction), urgency copy added
- [x] Audit installer onboarding — copy fixes (payment details, capacity labels, measure-up note)
- [x] Fix $220 lead-fee contradiction per Jo: OUR leads only; agreement clause corrected, INST version bumped to 1.6 (prior signers must re-sign)
- [x] Test mode (?test=1, no mandatory fields) on electrician onboarding to match installer — for dummy run-throughs
- [x] Electrician onboarding: removed add-electrician + how-we-work steps; services step = "receive referrals" ticks; competitive-pricing note added; install-day rate verified conditional on tick

- [ ] Customer web address (estimate.homeinsulationvictoria.com.au): bare address opens the calculator only; staff sign-in moves to /home; hide the "Edit with Lovable" badge so nothing says Lovable on customer pages

- [x] Confirm public portal access boundaries and provide the published app URL.
- [x] Align REC clauses 4, 5, 12, 24, 26 and 27; increment agreement version and reconciliation.
- [x] Complete remaining REC UI/save checks and no-write address-proxy proof.
- [x] Save viewable 1280/390 REC screenshots as embedded JSON and run focused verification.

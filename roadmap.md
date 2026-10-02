# Roadmap

## Now
- [x] Restore-point check guide for applying 0071–0073 (report only)
- [x] Launch fixes in test copy (booking atomic, licence guard, Ready Check order proof); pricing questions shown verbatim
- [x] Migrations 0071, 0072, 0073 applied to live with checks
- [x] 0074 staged in throwaway database with undo script tested; live apply waiting on Jo
- [x] C01–C04 recorded and enforced in code (unpublished): two separate $349 lines; installer's own price passes through with no markup plus our two set fees; no lead fee; AP fee changeable only by Jo; Ready Check sheet for installers not yet on site; unsupplied items carried to the PIISA
- [ ] AP fee after quote acceptance stays locked for everyone including Jo — confirm with her whether a post-acceptance change should exist (would need customer reconfirmation rules)
- [ ] Old electrician-visit path: waiting on Jo's decision (Ready Check not guaranteed before PIESA on it)
- [x] Official PIESA/PIISA forms Parts 1–4: correct both forms, printed-rule checks, template records, re-run comparison (keep blocked until Jo approves + source URLs confirmed)
- [x] Signed-copy storage (0075 staged + throwaway-tested), PIISA wired into central gate, rules A/B fail-closed
- [ ] Live: apply 0075 + create private bucket + publish code — awaiting Jo go-ahead and form approval
- [x] C03 (no lead fee) in test copy; awaiting Jo wording approval before publish —: full search report with classification, remove from every active surface (onboarding, agreements as new versions, rate cards, payouts, quotes, invoices, emails, help, tests), side-by-side before/after wording, proofs; nothing live until Jo approves wording
- [ ] Launch-fix app code re-test on a rebuilt merged copy (test copy was cleared)
- [x] Provide safe no-write onboarding links for an external AI audit
- [x] Prevent cancelled preview page requests from surfacing an AbortError and blanking the screen
- [x] Complete authorized REC refinements: fix save/navigation races; verified AU/VIC addresses; exact service/availability/rates copy; staff links; assigned-REC standard/custom rates; agreement v2.3 source reconciliation and official $5m insurance override; terminology sweep; focused tests, provider/browser checks, viewable screenshots and audit
- [x] Finish REC onboarding polish: shared trade copy, isolated no-write samples, legacy draft resume, retry state, focused verification
- [x] Audit and refine REC business onboarding, worker invitations and worker join screens; fix activation validation ordering
- [x] Delete obsolete old-brand email templates and old calculator code; preserve approved current templates and customer calculator
- [x] Point customer email calculator links to the built calculator at the customer-domain home address
- [x] Retire viewed and seven-day estimate reminders; suppress legacy queued rows; clarify free measure-up visit copy and verify previews
- [x] Boss signs up business; workers join via personal invite link (/join)
- [x] Installer agreement audit: payment timing, free Ready Check, customer contact, customer/supplier pricing, assessment timing, and separate installer certification clarified in v1.8


## In progress (approved plan: installer onboarding overhaul)
- [ ] Name-first step on installer + electrician onboarding; greet by first name throughout; invites prefill invitee name + inviter business
- [ ] Shared "How we work with you" content module (Option 1 own customer / Option 2 our lead), portal help page, FAQ
- [x] "Why the $349" box: two separate $349 inc GST owner charges; REC receives agreed supplier rate
- [ ] Saved electrician preference per installer (own / HIV list / ask each job)
- [ ] Partial evidence: one upload box, AI-suggested requirement matching, staff verify, have/missing list
- [ ] Install-day "Before you start" checklist auto-built from missing allowed items; feeds Mitti/PIISA
- [ ] Per-requirement capture-stage settings (before quote / before install start / after install) per ESC table; verify against full Obligations & Program Guide annexure before enabling
- [x] Shared gate timeline for staff/installer/electrician with countdowns (PIESA 30-day validity, ESC notification 24h–5d, PIESA copy 24h, same-day rectification quote)
- [ ] 24-hour rule on our leads: owner offered choice of different installer/electrician after 24h no contact
- [x] Installer agreement v1.8 with Option 1/2, official assessment/timing rules, payment trigger, portal communication and re-sign versioning
- [x] Our leads: owner quoted at our set customer price; installer paid agreed onboarding rate; $220 inc GST lead fee deducted only after installation and paperwork approval

## Decisions locked this session
- Two separate owner charges: $349 inc GST electrical assessment + $349 inc GST Accredited Person fee
- Pre-agreed installer price: our fees on top (owner sees less VEU discount)
- Our leads: set customer price; installer paid agreed rate; margin internal only
- $220 inc GST lead fee: Home Insulation Victoria leads only; deducted from installer payout after installation and paperwork approval; never installer-owned customers
- Approved electrician is paid the agreed supplier rate; owner still pays the standard $349 electrical assessment fee
- Portal-only communication; 24h no-contact rule on our leads

## Still open from before
- [x] Electrician team-up worker path (under someone else's REC: name + licence + host REC only; no ABN, insurance, rates or bank — head company owns those)
- [ ] Chase service areas from 6 installers; partner/postcode coverage follow-ups
- [ ] Mitti form IDs from user — now FOUR: A1 (installer-sourced, with quoted price), A2 (our leads, no pricing), B (PIESA), C (PIISA); briefs in Mitti_template_briefs_v4.md
- [ ] Browser-verify owner/electrician/installer job views as those roles
- [x] Confirmed: two separate $349 charges; $220 inc GST; own electrician paid agreed supplier rate while owner charges remain standard
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
- [x] Calculator: no removal amount before inspection; note says existing insulation may or may not require separately priced removal; demand-high badge retained
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
- [x] C03 no-lead-fee wording approved in principle; exact before/after delivered; C03 removed from commercial blockers (C01, C02, C04 unchanged)
- [x] Hazard → verified rectification wiring (test copy; staged 0077, throwaway-tested)
- [x] Conductivity answer vs HI VIC supporting photo separated; provenance download date UNKNOWN
- [x] 0074 merged against current code in throwaway copy and retested
- [ ] Apply 0075 storage + private file store live — waiting on Jo's approval and restore-point confirmation
- [ ] Apply 0077 / 0074 live, publish app code — waiting on Jo's approval, form approvals, source URL/date, conductivity/hazard official confirmation, C01/C02/C04

- [x] Read-only live readiness check: REC/installer onboarding, worker invites, job links, commercial wording (PASS/FAIL/NOT LIVE with URLs + evidence)

- [x] Narrow installer onboarding release published 2026-10-02 (INST-1.9, no lead-fee wording); unpublished work restored and verified against 81429ac0

- [ ] Onboarding insurance certificate: details not read properly (Jo 2026-10-02) — investigate after security fixes 1-3
- [ ] Security findings 1-3 (start limits, staff test links, verified insurance uploads) — preview only, 0079 staged
- [ ] Address autocomplete: suggestion list stays visible under the field after selecting (Jo 2026-10-02)

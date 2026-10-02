# Launch readiness — the exact remaining list

## Goal
Everything left before the portal is 100% ready for launch, grouped so we can work through it in order. Each item names what I do and what needs you.

## 1. Communications with owners and trades
- **Message portal** — owner and trade messaging already lives in the job (Correspondence); verify every message type renders and records correctly, with portal-only communication enforced.
- **Customer email redesign** — all templates in the Home Insulation Victoria brand, plain language, one clear button each.
- **Email sending domain** — customer emails can't send until DNS records for homeinsulationvictoria.com.au are added. I'll give you the exact records; once in, I verify and wire the templates.
- **Worker job links by text/email** — sent automatically once communications are switched on.
- Nothing sends externally until live communications are switched on with your approval.

## 2. Automation of the platform
- Verify the agreed safe set against live data: To action tab, automatic stage/next-step text, overdue flags (PIESA 30-day, 24h/48h trade response, owner reminders).
- 24-hour rule on our leads: owner offered a different installer/electrician after 24h no contact.
- Anything that emails or writes externally stays behind the launch lock until you say go — the 15 external-action controls stay OFF.

## 3. Xero
- **Xero invoice design + preflight** — I design the actual invoice layout (co-branded, all quote lines, VEU discount, Inclusive GST, Home Insulation Victoria business unit) and show it to you for approval before the first real one is created.
- **Connection check** — confirm the Xero connection is linked and pointed at the right organisation; the 50% deposit gate stays Xero-verified (AmountPaid ≥ 50% or audited override only).

## 4. Onboarding
- **Insurance certificate reading** — onboarding uploads aren't being read properly; investigate and fix.
- **Address autocomplete** — suggestion list stays visible after selecting; fix.
- **Electrician 'application received' screen** — stronger wording with green ticks for what happens next.
- **Onboarding invite email** — explains who we are, what we do as the Accredited Person, and what they're signing up for.
- **Whole-portal test login** — clarify who it's for and what they must see (admin-level access for an outsider is barred by the locked rule).

## 5. Waiting on your approval to publish (work is done, preview-verified)
- **Installer pricing acknowledgement (INST-1.10)** — installer-brought jobs: no lead fee, no margin, only the $349 AP fee.
- **Compact staff portal redesign** — audit fixes complete and verified in preview.
- **Signed-copy storage (0075) and hazard→rectification wiring (0077/0074)** — staged and throwaway-tested.

## 6. Needs something from you (blockers I can't clear)
- **Mitti forms A2, B, C** — A1 is connected and validated; the other three need building from the briefs in Files, then I connect and validate each.
- **Official PIESA/PIISA form approval** — filling stays blocked until you approve the mapping and confirm source URLs.
- **Two open decisions**: AP fee changes after quote acceptance (currently locked for everyone), and the old electrician-visit path (Ready Check not guaranteed before PIESA on it).
- **Customer web address polish** — bare address opens the calculator only, staff sign-in at /home, no Lovable badge on customer pages.

## 7. Final verification pass (before go-live)
- Full dummy job run-throughs of the six scenarios (website enquiry, installer-brings-customer complete/partial, our-lead with 24-hour rule, rectification path, overdue/exception paths).
- Owner portal walkthrough exactly as an owner sees it; mobile check on every trade screen.
- Final security/RLS pass and refreshed security scan.
- Post-publish live checks (onboarding start, rate limits, test links, insurance quarantine, 15 controls OFF, no external actions).

## Go-live gate
Launch only when: sections 1–6 are cleared, all dummy run-throughs pass, Mitti forms connected, emails approved by you, Xero invoice approved, tests/build/security green. Then you say "go" and live communications switch on.

## Boundaries
- Locked Step 1 (Base44 handoff), Gate 1 rules, pricing and payment guards stay untouched.
- Nothing publishes, sends, charges, or applies to live without your explicit approval on that item.
- Test jobs stay flagged qa_test, excluded from live totals.

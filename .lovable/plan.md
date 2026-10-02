# Launch readiness — the exact remaining list

## Goal
Everything left before the portal is 100% ready for launch, grouped so we can work through it in order. Each item names what I do and what needs you.

## 1. Waiting on your approval to publish (work is done, preview-verified)
- **Installer pricing acknowledgement (INST-1.10)** — reworded tick-box: installer-brought jobs have no lead fee and no margin, only the $349 AP fee. Ready to publish on your word.
- **Compact staff portal redesign** — the audit fixes (list, job workspace, Gate 1 evidence, action targets) are complete and verified in preview. Ready to publish on your word.
- **Signed-copy storage (0075) and hazard→rectification wiring (0077/0074)** — staged and throwaway-tested; need your go-ahead to apply live and publish.

## 2. Needs something from you (blockers I can't clear)
- **Email sending domain** — customer emails can't send until DNS records for homeinsulationvictoria.com.au are added. I'll give you the exact records; once they're in, I verify and wire the templates.
- **Mitti forms A2, B, C** — A1 is connected and validated; the other three need to be built from the briefs in Files, then I connect and validate each.
- **Official PIESA/PIISA form approval** — filling stays blocked until you approve the mapping and confirm source URLs.
- **Xero invoice design** — I design the invoice layout (co-branded, all lines, VEU discount) and show it to you for approval before the first real one is created.
- **Two open decisions**: AP fee changes after quote acceptance (currently locked for everyone), and the old electrician-visit path (Ready Check not guaranteed before PIESA on it).

## 3. Finishing work I can do now (preview-only until you approve)
- **Insurance certificate reading** — onboarding uploads aren't being read properly; investigate and fix.
- **Address autocomplete** — suggestion list stays visible after selecting; fix.
- **Electrician 'application received' screen** — stronger wording with green ticks for what happens next.
- **Customer web address polish** — bare address opens the calculator only, staff sign-in at /home, no Lovable badge on customer pages.
- **Customer email redesign** — all templates in the Home Insulation Victoria brand, plain language, one clear button each. Nothing sends until live comms are switched on.
- **Worker job links** — photo/evidence upload directly on the link page.

## 4. Final verification pass (before go-live)
- Full dummy job run-throughs of the six scenarios (website enquiry, installer-brings-customer complete/partial, our-lead with 24-hour rule, rectification path, overdue/exception paths).
- Owner portal walkthrough exactly as an owner sees it.
- Mobile check on every trade screen.
- Final security/RLS pass and refreshed security scan.
- Post-publish live checks list (onboarding start, rate limits, test links, insurance quarantine, 15 controls OFF, no external actions).

## Go-live gate
Launch only when: sections 1–3 are cleared, all dummy run-throughs pass, Mitti forms connected, emails approved by you, tests/build/security green. Then you say "go" and live communications switch on.

## Boundaries
- Locked Step 1 (Base44 handoff), Gate 1 rules, pricing and payment guards stay untouched.
- Nothing publishes, sends, charges, or applies to live without your explicit approval on that item.
- Test jobs stay flagged qa_test, excluded from live totals.

# Roadmap (preview only, nothing sent, no publish, no real jobs)

## Current priority — campaign v12 picture (Jo, 6 Oct)
- [x] Recover exact approved v10 HTML; capture Sarah at 700px / scale 2 with Google Fonts blocked, Arial → Liberation Sans; crop after estimate disclaimer, footer excluded. PNG 338,861 bytes (331 KB), 1280×2492; picture visually checked.
- [ ] Upload picture to PUBLIC storage and send ONE v12 TEST to Jo on HV-1609 using existing safeguards. BLOCKED: workspace rejects public buckets (`public_buckets_blocked`); owner/admin must enable public buckets in workspace Settings → Privacy & Security. No email sent, no renderer changes, no publish; await Jo's verdict after eventual send.

## Previous campaign v9
- [x] Identify the exact Jo onboarding email and other onboarding subjects.
- [x] Reuse its renderer for Group A, Group B and hot leads, preserving approved subject/preview and fresh estimate breakdown.
- [x] Show onboarding/new email side by side at 390px with web fonts blocked before one Jo-only TEST send; HV-1609, Resend 01a112b7-00e5-7096-9142-49789371b318; no publish.
- [x] v9 rebuilt on installer invitation template; Jo-only test 01a112bc-d116-77f7-8f73-6bf307f85511.

## Review fixes before Deep publish (6 Oct)
- [x] Melbourne today everywhere + test
- [x] Public sign-up off; owner auto-link needs verified email code
- [x] Sample partners suspended/inactive (nothing deleted)
- [x] Rate offer: code signing, 14-day expiry, new link; partner pages calculator look
- [x] No double sends (sent-unknown, Resend idempotency key)
- [x] xlsx 0.20.3; bulk reading re-run
- [x] Unused fonts removed
- [ ] Screenshots of office counter-offer panel (needs office sign-in approval)

## Next
- [ ] Partner applications (Jo, 7 Oct; after automation settings): office view shows EVERY onboarding question + answer grouped by step (all of rec_onboarding_applications.data), bank masked to last 3, blanks "Not answered", Print / PDF; jobs-per-week (installer + electrician) and installers/crews (installer) for NEW applicants; existing show "Not asked (onboarded before this question)" — NO "One more question" task / no contact to onboarded partners incl. Deep (per earlier change; awaiting confirmation since resend asked for it); verify on Deep 52760973 + screenshot; send nothing.
- [ ] Move real owner/partner emails from the Base44 delivery bridge to Resend (Lovable sends); keep sending OFF.
- [ ] Card payments: Jo to choose provider (built-in Stripe recommended; existing Stripe account possible) — set up via Lovable editor chat.
- [ ] Automation settings (Jo, 7 Oct; after payment rule): partner-pair coverage (approved REC + approved installer by onboarding address+travel distance), auto Ready Check offer, waiting-list auto move-up in save order; $30/m² customer setting, installer paid onboarding rate, blank min/max range + disable its check, owner prices per m² inc GST as settings (R5 $30, R6 $32, R7 $35, top-up R5 $30, removal batts/loose fill $15) used in every estimate/quote/email; installer paid own agreed rate per matching item; Needs me if ANY agreed rate ≥ matching owner price; all five in audit; measurement_variance_tolerance_pct=15 → Needs me, no auto revised quote, standard NOT approved; lead fee $0; quote accuracy audit (TEST + 66 hot leads, mismatch table, pre-send recalculation guard → Needs me, report QUOTES 100% CORRECT); answer Stripe + email-provider questions. No auto-send switched on.
- [ ] v10: send Jo-approved Save my spot HTML byte-for-byte (only 4 links swapped) to Jo only; then WAIT for her verdict before any renderer change.
- [x] Payment rule (Jo, 7 Oct) built in preview. Open: Step B + office screenshots need an office sign-in (no account matches Jo's Lovable email).
- [ ] Partner applications change (Jo): add jobs-per-week + installers/crews questions for NEW applicants only; existing show "Not asked (onboarded before this question)"; NO "One more question" task, NO message/email/prompt to any onboarded partner (incl. Deep). Original task details (umsg_01m49bt9cremz8ktxk7td21q9a) need re-reading.
- [ ] Partner go-live path (Jo, 7 Oct; after partner applications): login for primary contact on approval (business_members owner/admin; same email as worker allowed, e.g. info@reinsulate.com.au); workers only via The team invite; INSTALLER welcome email+SMS on electrician template, both DRAFT, button to published set-password then /field/setup; one test "[TEST – installer welcome]" to jolowexo@hotmail.com via TEST partner; office switch "Send partner welcome messages" default OFF, otherwise "ready to send" + manual send, never auto for earlier approvals; approve card: "Accept rates and activate partner" only approval, rename/hide old approved button, blocker checklist; confirm /field in published build; list + office steps for pre-offer needs (coverage, worker approval, PIISA). Screenshots: approve card, draft email, post-password partner view.

1. [x] Owner paperwork gates A–D: no-login signing via secure link + 6-digit SMS/email code (quote acceptance, visit-time picks, all owner signatures)
1b. [x] Owner paperwork gates A–D for every journey (gate rules, signing card, Paperwork strip, Needs me, settings page, scenario F). Waiting on Jo: final wording, cooling-off rules, landlord consent design, Mitti PIESA mapping.
2. [x] Mist background behind house + headline on owner screens (check with a non-cancelled TEST job)
3. [ ] Electrician screens: offer, My work, On the day, Money, My business
4. [ ] Installer screens (offer, Ready Check day, Install day, My work) + shared before-you-start section
5. [x] Campaign email/landing: save-spot only, Group B jump-the-queue (built; re-verify)
6. [ ] Bulk upload: restyle (done), complete jobs, two journeys, electrician choice/privacy
7. [x] Clean old notes + docs/STATUS.md (keep current)
8. [ ] Test scenarios A–F incl. bulk scenario E

Blocked on Jo: Xero Demo Company reconnect, Mitti template IDs, wording approvals.

- [x] Trade view for partner approval (Jo, 6 Oct) — plan in .lovable/plan.md awaiting approval.

- [x] Connect GitHub REST connector (Jo, 6 Oct): "Joannah's GitHub API" linked to project (gateway-backed, `GITHUB_API_KEY`, scopes read:user + repo). App calls go through https://connector-gateway.lovable.dev/github/... from server code only.
- [x] HV-1554 (Jo approved, 6 Oct): end TEST Alpha job assignment — active=false, end_reason "Test business removed from real job (Jo, 6 Oct)", log in job history. Nothing else on the job. (Already inactive since 5 Oct TEST audit cleanup; reason updated + workflow_events row added.)
- [x] Gate B box 4 (Jo, 6 Oct): NO cooling-off. Approve "doesn't apply" line "You can ask us questions or change your mind before your safety check is booked." (approver "Jo Lowe — lawyer sign-off 6 Oct 2026"). Plain "Cancel my job" on My job only until safety check booked. Preview only.
- [x] Group A email EXACT per Jo 5:17pm (v4 approved); send one "[TEST v4 – APPROVED]" to Jo only; Group B same structure, not sent.
- [x] Email font stacks (Jo 6 Oct): campaign A/B + spot-saved use Outfit/Figtree fallback stacks inline everywhere; one "[TEST v5 – FONTS]" Group A to Jo only.

- [x] v7 phone-first email art (Jo, 6 Oct): header drawn at 354px phone width, card headings as images, side-by-side check, one "[TEST v7]" Group A to Jo only.

## Security/correctness review (Jo approved, 6 Oct) — one at a time, tests after each
- [x] 1 Test account passwords random; TEST businesses marked test; report TEST Alpha non-test job
- [x] 2 Bulk import never reuses owners; exact email match
- [x] 3 Bulk import installed/quoted rows start safe
- [x] 4 Bulk import boss/office check on server
- [x] 5 PIESA/AP fee from settings
- [x] 6 One discount calculation; no legacy per-m² credit; no cap
- [x] 7 Melbourne-time deadlines + holidays
- [x] 8 Atomic owner code attempts
- [ ] Tidy done: staged-migrations archived, /qa-access same-site, existingPortalKeys paged, quote AP-fee override. Open: separate file-signing secret (needs new secret), calculator-interest rate limit + video upload limits (DB change), allocation-tick review, retired Owner Authority/simulateReadyCheckPayment removal, b64 copies, split portal.functions.ts, docs/pending-migrations archive

## Second review (Jo, 6 Oct) — in order, tests after each
- [ ] A (bucket type limits NOT applied — SQL ready in docs/pending-migrations/review-A-*; rest done) Upload file types: bucket allow-lists, signature checks, safe file serving, CSP sandbox, report unsafe stored files
- [x] B Accepted offer contact details need active assignment
- [x] C Trades never read customer quote prices
- [x] D Trade access: Money boss-only, workers own jobs, removal deactivates membership
- [x] E Couldn't get in via guarded transition
- [x] F adjustQuote whole-VEEC discount + $200 minimum + audited override
- [x] G Melbourne dates in DB (PIESA view) and veec.core.ts
- [x] H Owner code-request limit atomic
- [x] I Trade invites obey comms switch; VEEC value separation confirmed

## Full-journey fixes (Jo, 7 Oct)
- [x] Quote line shows real version + inc-GST price (hidden if either unknown); test added
- [x] Offer pairing guard (TEST job ↔ TEST partner only) before every offer insert; tests both ways
- [x] Archived journey practice jobs HV-1647–1662; TEST Alpha/Delta restored; journey now restores them each run
- [x] Steps 5–8 built; fixed owner payment-choice bug
- [ ] Step 5 blocked: no code moves a job from "Measured estimate ready" to "Measured quote accepted" when the owner accepts — needs Jo's decision (ties to booking-order plan)
- [ ] Later: daily check + Today card

- [x] Strict new-installer test (A application/approval, B installer views owner+staff, C uploads/add one job), 3 runs, report + screenshots in Files installer-test

- [~] Trade pages to approved design: shared look done (menu, colours, fonts, cards, buttons, fields). Next: page-by-page layouts (address-only job titles, side "What happens next" panel, extra states).
- [ ] Ready Check for installer-supplied customers: owner paperwork A has no signing path — waiting on Jo
- [x] Design v2 zip: identical to the approved design already applied (no changes)

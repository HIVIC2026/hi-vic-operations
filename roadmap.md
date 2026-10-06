# Roadmap (preview only, nothing sent, no publish, no real jobs)

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

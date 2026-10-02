# Staff job workspace + job list — presentation-only redesign

Base SHA: f49e7060dc9e83974ce0d56a142b355e6a0581f8 (re-read before editing).

## Changed files
- `src/routes/_authenticated/admin.jobs.$jobId.tsx` — new hierarchy; 12 tabs replaced by collapsible record groups. All panels/handlers unchanged.
- `src/routes/_authenticated/admin.index.tsx` — card grid → scannable list (StaffJobRow); duplicated "Key" chip strip removed (meanings now card tooltips; breakdown sentence kept); smaller heading; 2-col counters on mobile.
- `src/components/portal/job-workspace.tsx` (new) — JobIdentity, NextActionBand, EligibilityGlance, PhaseStrip, RecordDisclosure, TAB_TO_GROUP.
- `src/components/portal/StaffJobRow.tsx` (new) — admin-only row; JobCard untouched (field/owner unchanged).
- `src/components/portal/panels.tsx` — EvidencePanel optional `excludeGates` prop (default behaviour unchanged).
- `src/components/portal/intelligence.tsx` — one button row `flex-wrap` (390px overflow fix).
No src/lib, DB, RLS, auth, pricing, agreement or integration changes.

## Control-location inventory (old → new)
| Old location | New location |
|---|---|
| JobFileHeader (address, job no, owner/phone/email, readiness, PIESA/ESC/deposit warnings) | JobIdentity (top); same `jobfile-header` query |
| Owner contact consent (inside Eligibility › Intake) | JobIdentity consent line (`intake_summary` query) + "View evidence" → Enquiry |
| WhoHasTheBall + JobFileHeader "Next action" (duplicates) | One NextActionBand (`job-waiting`); CTA → group via TAB_TO_GROUP, scroll + focus |
| BlockersPanel | Unchanged, under next action |
| Gate1 six checks | EligibilityGlance (requirement / assessment / basis); declared pass shown "Met on owner's declaration", never verified; full Gate1EvidencePanel in Enquiry |
| Safety flags | EligibilityGlance (always visible) |
| JobJourney | PhaseStrip (buildJourney) + full JobJourney on "Show workflow details" |
| ClearTimeline (top-of-page feed) | Correspondence & history |
| Badge row (stage/payment/urgency/source/life support/review) | Compact badge row; life support + review in identity |
| Overview: status summary, JobSource, JobCoverage, Assignments, AdminPartnerPanel, HoldControls, RetentionCard | People, source & exceptions |
| Overview: RequirementCards (duplicate) | Ready Check only |
| Overview: "All bookings" (duplicates) | Each booking panel once: assessment→Ready Check, rectification→PIESA, installation→Installation |
| Eligibility tab | Enquiry |
| Authority tab (AdminAssignmentPanel, consent docs) | Quote › Electronic signing |
| PIESA tab (window, records, rectification, booking, docs) | PIESA |
| Ready Check tab | Ready Check |
| Quote & deposit tab | Quote |
| Installation tab | Installation |
| Evidence tab | AP review & VEECs (non-installation gates; installation evidence once, in Installation) |
| VEEC tab | AP review & VEECs |
| Messages tab | Correspondence & history |
| History tab (JobTimeline, raw TimelinePanel) | Correspondence & history |
| Documents tab (AllDocuments, ExportJobPack) | Correspondence & history › All documents |

Legacy tab → group: overview→people, eligibility→enquiry, assessment→ready_check, quotes/authority→quote, piesa→piesa, installation→installation, evidence/veec→ap_veec, messages/documents/history→history.

Groups mount on first open and stay mounted when collapsed (form state preserved; no duplicate mounted mutation forms).

## Job list
Search, source/phase filters, filter chips + Clear, tab views, work-view counters, accurate breakdown, active split link, intake health, comms lock notice, new enquiry, select-all/per-row selection, bulk dialog — all unchanged logic. Row shows property/job/owner, nextStep label + Gate 1 label (same precedence as JobCard), next action/waiting on, coverage, comms status, stuck reasons, last activity.

## Verification
- `tsgo --noEmit` clean; `vite build` OK.
- Focused: nextstep, journey.core, guards, admin-pipeline-visibility, admin-record-reliability, jobfile, scheduling, messaging, comms, comms-status, no-lead-fee, gate1-card, gate1-evidence, estimate, postintake-health, waiting.core — 147 pass / 0 fail.
- Full `bun test ./tests/` — 959 pass / 3 fail (same pre-existing failures).
- Browser (Playwright, 1280 + 390) on QA test job HV-1011 (source qa_test), read-only: next-action CTA opened Quote group and focused its heading; all 8 groups opened with content; typed draft survived collapse/reopen; keyboard Enter toggles groups; no horizontal overflow at 390 (after wrap fix); list search chip/Clear, row checkboxes, bulk dialog opens and Escape cancels without confirm; Back navigation OK; no page errors. No forms submitted.

## Limitations
- Browser checks used the real signed-in session and a QA job, not mocks. Opening the list page runs its existing automatic sweep/auto-advance (same as any staff visit); my request filter did not intercept it.
- Error/empty states verified by code review only (existing retry/alert paths retained), not forced in browser.
- Integrations (Xero, Mitti, messaging) not exercised.

## Final presentation correction (2 Oct 2026)
- JobIdentity: owner, phone and email are separate fields; no truncation (break-words / break-all). Verified on QA job HV-1128 at 390px and 1280px.
- EligibilityGlance: raw source paths replaced by display-only labels (properties.* -> Property record / Property research, jobs.* -> Job record, base44 -> Homeowner enquiry, base44.property_research -> Website property research); anything else reads "Recorded source — view evidence". Basis labels and rules unchanged; full source strings remain in Full Gate 1 evidence. Limitation: on HV-1128 every glance row uses the fallback, because its rule sources are not in the mapped list.
- Screenshots: portal-workspace-desktop.json / portal-workspace-mobile.json now show only the QA job detail page (HV-1128). The job list was not opened again. The counter grid (grid-cols-2 sm:grid-cols-4 lg:grid-cols-7, admin.index.tsx line 148) was checked in the code only.
- Tests: bun test ./tests/ gives 959 pass and 3 fail. The 3 failures predate this work: the 2 "presentation lock" tests in tests/customer-quote-system.test.ts (estimate.tsx / estimate-email.ts) and the "appointment SLA & reassignment" test in tests/pilot.test.ts:121. No tests/ or src/lib files changed since base f49e7060. Typecheck clean. Nothing published.

## Portal brief fixes (2 Oct 2026)
- The list now prioritises In progress, Needs review, and Exceptions; all non-test, finalised, cancelled, and QA records remain available from a secondary selector. Exceptions shows separate Ineligible and On hold counts.
- `visibleJobs` is the sole post-phase list for rows, select-all, and empty-state behavior.
- Required-review status suppresses stale eligibility; row identity and next action wrap in full.
- Gate 1 rows show stored owner answers separately from assessment/reason and basis/provenance. Missing answers remain unknown and raw source values remain in full evidence.
- Consent, deposit, signing, evidence, messages, history, and documents have precise non-mutating focus targets. AP review links to the existing installation-evidence instance. Draft-a-nudge behavior is unchanged.
- Duplicate top status summary and duplicate visible timeline were removed; controls, files, exports, and raw history remain reachable.
- Verification: `tsgo --noEmit`; 16 focused tests pass; preview build OK. Visual evidence uses an isolated local source-derived harness with synthetic data and all network requests blocked, not authenticated `/admin`.

## Final isolated component verification
- Real portal components were rendered with synthetic QA-only responses and all non-local network blocked: `StaffJobRow`, `EligibilityGlance`, `RecordDisclosure`, `IntakeSummary`, and `PaymentsPanel`.
- Runtime checks cover status precedence, phase-empty/clear/select-all, delayed deposit focus, non-Base44 consent focus, mobile-collapse to desktop filters, and disclosure draft retention.
- The surrounding fixture is not the authenticated route or full shell; this deliberately avoids the route's automatic sweep/advance effects. No live admin page, data, or mutation was used.

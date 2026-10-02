# Portal brief audit — fixes implemented 2 Oct 2026

## Implementation result
- **List density fixed:** primary work views are compact controls; terminal, all non-test, and QA records sit in a secondary selector. Routine intake health is disclosed, while communications lock and critical warnings remain visible. “All non-test records” accurately includes complete/cancelled records. The Exceptions view reports separate Ineligible and On hold counts without changing classification.
- **Filtering fixed:** one phase-filtered `visibleJobs` collection now drives rows, select-all, and the empty state. A no-match state offers Clear filters.
- **Status precedence fixed:** the authoritative next step remains first; required review remains visible behind terminal/hold precedence; stale and duplicate outcome pills are suppressed. Full address, owner, and next-action text wraps.
- **Gate 1 glance fixed:** every row now separates the stored owner answer, assessment/reason, and basis/provenance. Missing answers are explicit; property state is not presented as an owner answer; declarations remain unverified. Every row links to intake or full evidence, where raw source strings remain available.
- **Navigation fixed:** consent, deposit request, signing, Gate 1, correspondence, documents, and evidence use precise focus/scroll targets after opening the disclosure. Deposit targeting waits for delayed payment data, prefers the actual admin control, falls back safely, and cancels stale requests. Non-Base44 jobs now have an honest read-only consent evidence panel. Installer-owned evidence-outstanding remains “Draft a nudge” to correspondence. AP review now has a direct link to the single installation-evidence panel.
- **Repetition reduced:** duplicate stage/payment summary bands were removed. The readable timeline is primary; detailed and raw audit history remain under one disclosure.

## Verification
- `tsgo --noEmit`: pass.
- Focused tests: 17 pass, 0 fail (`portal-presentation`, `admin-pipeline-visibility`, `waiting.core`).
- Preview build signal: build OK.
- Isolated browser checks passed for review plus stale outcome, duplicate ineligible, phase with no matches plus clear/select-all, delayed deposit data focusing the exact admin control, non-Base44 consent, mobile-filter collapse followed by desktop resize, and draft preservation across disclosure collapse/reopen.
- Captures: `portal-brief-audit-admin-desktop.json` and `portal-brief-audit-admin-mobile.json`; each contains complete list and active-detail PNG bytes plus viewport metadata.
- **Exact visual limitation:** the captures render the real `StaffJobRow`, `EligibilityGlance`, `RecordDisclosure`, `IntakeSummary`, and `PaymentsPanel` components with synthetic QA-only query responses. The surrounding list/detail fixture is local test JSX, not the authenticated route or full `AppShell`; that avoids its sweep/advance effects. All non-local network was blocked. No authenticated `/admin` navigation, live data access, or mutation occurred.

## Prior audit record

No screenshots were taken. The live /admin page always runs sweepAuthorities + autoAdvancePipeline on load
(admin.index.tsx:80-87), and every list read is a server call. A safe mocked harness would need hand-built
server-function responses, so it was not attempted. No live navigation was made and no app files were changed.
`portal-brief-audit-admin-{desktop,mobile}.json` were deliberately NOT created. The only screen evidence on
record is the earlier QA capture (`portal-workspace-desktop.json` / `portal-workspace-mobile.json`, QA job
HV-1128); everything below is traced from source, not freshly verified on screen.

### Findings before implementation (severity-ranked)
1. MEDIUM: The list header is dense. Before the first job row there are a header, a counts line, 7 count
   cards, a split line, a warning banner, a pre-launch notice, an intake-health strip, a filter bar and a
   select-all row (admin.index.tsx:139-180). On mobile the count cards render as a two-column, four-row grid.
   Pixel measurements were not taken; "below the fold" claims are not made. Source-confirmed density only.
2. MEDIUM (confirmed source case): Status-pill precedence is not fully correct. StaffJobRow.tsx:12 tests
   `reviewRequired && step.label !== "Review required"`; when nextStep already returns "Review required" the
   condition is false and the ternary falls through to the old eligibility_outcome pill. Repro input:
   stage="eligibility_review", eligibility_review_required=true, eligibility_outcome="likely_eligible" →
   two badges, "Review required" + "Likely eligible". This is a confirmed source-level case, not a duplicate
   review label.
3. MEDIUM: CTA deep navigation is confirmed generally but jump targets are overly broad. "View
   consent/evidence" opens the Enquiry group at its top (Gate 1 / estimate / form before IntakeSummary);
   "Record deposit request" opens the Quote group at its top before PaymentsPanel; the authority CTA maps to
   the Quote group top, before the electronic signing block (admin.jobs.$jobId.tsx:107-109). These work but
   land at the group top with no scroll to the relevant sub-section. Not a proven wrong signing CTA.
4. MEDIUM: AP review excludes installation evidence and has no direct jump to it (admin.jobs.$jobId.tsx:125),
   so a complete AP review requires manually opening another group. Usability gap, partial. (The earlier
   claimed "evidence-outstanding CTA is misrouted" is withdrawn: waiting.core.ts:120 overrides the TAB
   mapping for installer-owned stages — the actual button is "Draft a nudge" → messages/history, so the
   conditional TAB mapping alone does not prove that bug.)
5. MEDIUM: Information is repeated on the job page. The badges row (job-workspace.tsx:71-73) repeats stage,
   payment and PIESA urgency already shown in the identity warnings and phase strip. The People "Status
   summary" (lines 76-84) repeats payment, PIESA and trades again. BlockersPanel adds a second status band
   next to Next action.
6. MEDIUM: List rows cut off address and owner (StaffJobRow.tsx:20-21), and next action is limited to 2
   lines (line 25). There is no title or expanded view, so full text is only on the job page.
7. MEDIUM: Phase-filter empty state is a real source-confirmed issue. Displayed rows apply phase filtering at
   admin.index.tsx:208, but line 211 checks `filtered.length` BEFORE phase filtering. With pre-phase rows > 0
   and zero matching phase rows, the list renders blank with no "No records in this view." message. Existing
   issue, not necessarily introduced by the redesign.
8. LOW: List tab labels are misleading. "All live enquiries" (groups.all) includes all non-QA records
   including complete/cancelled; "Ineligible / hold" conflates eligibility outcome and workflow hold.
   Retained work is visually as prominent as active work.
9. LOW: EligibilityGlance does not separate the actual owner answer from the assessment and basis. Its
   columns are Requirement / Assessment / Evidence basis (job-workspace.tsx:150); the actual owner answer
   and r.reason are not rendered. The declared vs verified distinctions are preserved and good, but the row
   is PARTIAL/FAIL against the approved checklist. Unmapped source text repeats the fallback "Recorded
   source — view evidence" and is not a clickable per-row link.
10. LOW: The phase filter is disabled outside "In progress" (admin.index.tsx:162), but the phase value is
    kept when switching tab via URL, because only card clicks reset it. The "Filters on" chip mitigates.
11. LOW: The terminal-job action { label "Open history", tab "overview" } maps to People, not History
    (waiting.core.ts:100). The button is hidden for terminal jobs (job-workspace.tsx:98), so latent only.

### Brief matrix before implementation
| Item | Result |
|---|---|
| List: identity / outcome / one next action per row | PASS |
| List: calm, little chrome before first row | FAIL (source-confirmed density; not measured on screen) |
| Job identity + separate phone/email + consent | PASS |
| One accurate eligibility outcome | PARTIAL (confirmed double-badge case, finding 2) |
| One next action + actor + deadline | PASS |
| Checklist separates owner answer vs assessment + basis | PARTIAL/FAIL (columns are Requirement/Assessment/Evidence basis; owner answer and reason not rendered; declared vs verified basis preserved) |
| Compact workflow | PARTIAL (badge row duplicates) |
| Seven expandable Job records | PASS (+ extra "People" group) |
| Every original control reachable | PASS (code mapping; not runtime-tested in this audit) |
| CTA lands at right control | PARTIAL (overly broad jump targets; AP review lacks evidence jump) |
| Blockers visible | PASS |
| No duplicated instructions | PARTIAL |
| Disclosure state accessible (aria-expanded/controls/region) | PASS |
| Desktop + phone usability | PARTIAL — not visually verified in this audit |

### Original audit limitations
Source-only audit. No fresh screenshots, no live navigation, no runtime test runs. Action handlers and
guards were verified as preserved by code mapping, not by exercising them. The earlier QA screenshots
(HV-1128) remain the only on-screen evidence.

# Portal brief audit (read-only, source-only) — HEAD 0dce1f40

No screenshots were taken. The live /admin page always runs sweepAuthorities + autoAdvancePipeline on load
(admin.index.tsx:80-87), and every list read is a server call. A safe mocked harness would need hand-built
server-function responses, so it was not attempted. No live navigation was made and no app files were changed.
`portal-brief-audit-admin-{desktop,mobile}.json` were deliberately NOT created.

## Findings (severity-ranked)
1. HIGH: The evidence CTA goes to the wrong group. waiting.core.ts:62 maps evidence_outstanding → "evidence", and job-workspace.tsx:27 maps that to ap_veec. That group excludes install evidence (admin.jobs.$jobId.tsx:125), but install evidence is exactly what this stage is waiting on (waiting.core.ts:90). The real controls are under Installation (line 121).
2. HIGH: The list header is dense. Before the first job row there are a header, a counts line, 7 count cards, a split line, a warning banner, a pre-launch notice, an intake-health strip, a filter bar and a select-all row (admin.index.tsx:139-180). Estimated from the code: about 450-500px of 1000 on desktop and about 700-780px of 844 on mobile, where the cards stack as 4 rows of 2. On a phone the first row is effectively below the fold. FAIL on "calm scannable list".
3. MEDIUM: The authority/signing CTA maps to "quote" (job-workspace.tsx:26). It opens the Quote group at the top, but electronic signing sits below the quotes, invoice, payments and documents panels (admin.jobs.$jobId.tsx:107-109). It works but lands deep, with no scroll to that sub-section.
4. MEDIUM: Information is repeated on the job page. The badges row (lines 71-73) repeats stage, payment and PIESA urgency already shown in the identity warnings and phase strip. The People "Status summary" (lines 76-84) repeats payment, PIESA and trades again. BlockersPanel adds a second status band next to Next action.
5. MEDIUM: List rows cut off address and owner (StaffJobRow.tsx:20-21), and next action is limited to 2 lines (line 25). There is no title or expanded view, so full text is only on the job page.
6. LOW: Source labels. Unmapped evidence sources all read "Recorded source — view evidence" (job-workspace.tsx:125). That is honest but not informative, and the earlier QA job showed it on every row.
7. LOW: The phase filter is disabled outside "In progress" (admin.index.tsx:162), but the phase value is kept when switching tab via URL, because only card clicks reset it. The empty state is a generic "No records in this view." (line 211) and doesn't name the active phase filter. The "Filters on" chip does mitigate this.
8. LOW: The terminal-job action { label "Open history", tab "overview" } maps to People, not History (waiting.core.ts:100). The button is hidden for terminal jobs (job-workspace.tsx:98), so this is latent only.
9. INFO: Status-pill precedence is sound. nextStep checks hold → review → ineligible (nextstep.core.ts:20-25), and the eligibility pill skips "Review required" when it would repeat (StaffJobRow.tsx:12).

## Brief matrix
| Item | Result |
|---|---|
| List: identity / outcome / one next action per row | PASS |
| List: calm, little chrome before first row | FAIL |
| Job identity + separate phone/email + consent | PASS |
| One accurate eligibility outcome | PASS |
| One next action + actor + deadline | PASS |
| Checklist separates owner answer vs assessment + basis | PASS (source wording weak) |
| Compact workflow | PARTIAL (badge row duplicates) |
| Seven expandable Job records | PASS (+ extra "People" group) |
| Every original control reachable | PASS (code mapping) |
| CTA lands at right control | PARTIAL (evidence wrong, signing deep) |
| Blockers visible | PASS |
| No duplicated instructions | PARTIAL |
| Disclosure state accessible (aria-expanded/controls/region) | PASS |
| Desktop + phone usability | PARTIAL (mobile list header) — not visually verified |

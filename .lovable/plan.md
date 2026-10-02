# Staff portal audit fixes

## Scope
Update only the authenticated staff admin list and job workspace presentation. Preserve all existing server functions, workflow rules, stored data, permissions, routes, forms, integrations, customer/field pages, emails, calculator, and onboarding. Keep the release preview-only.

## Implementation
1. **Make the admin list primary**
   - Replace the seven equally prominent tiles with compact primary views/counts and a secondary retained-records control for all, completed, cancelled, and test records.
   - Correct labels so “all” includes terminal records and “ineligible” is visibly distinct from “on hold,” without changing classification.
   - Keep search, source, phase, interests, create, selection, and bulk actions; condense filters behind a mobile disclosure.
   - Keep urgent warnings visible and place routine intake health inside a disclosure.

2. **Unify list filtering and selection**
   - Derive one phase-filtered `visibleJobs` collection and use it for rows, select-all, and empty-state behavior.
   - Keep filter semantics unchanged and ensure the empty state offers a usable filter reset when no rows match.

3. **Correct row status and mobile readability**
   - Give required-review status precedence over stale eligibility outcomes and prevent duplicate badges.
   - Preserve the authoritative next action, coverage, communications, and stuck indicators.
   - Wrap full address, owner, and next-action text instead of silently truncating it.

4. **Show honest Gate 1 answers and evidence**
   - Combine the existing intake summary with Gate 1 evidence so each check shows the owner’s actual answer, system/onsite assessment, reason, basis, and a readable provenance label.
   - Treat missing answers as unknown, never infer an owner answer from pass/fail, and never label property records as owner declarations.
   - Keep the previous-upgrade wording generic unless the stored answer is more specific.
   - Add working links to the relevant intake/evidence location while preserving the full raw source in the audit view.

5. **Add precise, non-mutating navigation targets**
   - Open the correct disclosure, then scroll and focus the exact consent, deposit-request, signing, message, eligibility, or evidence control after lazy content mounts.
   - Preserve the installer-owned `evidence_outstanding` action as “Draft a nudge” to messages.
   - Add a direct AP-review jump to installation evidence without duplicating that form.
   - Keep disclosure children mounted after first opening so draft state survives collapse and navigation.

6. **Reduce repetition on job detail**
   - Remove repeated top status summaries while retaining source, urgency, blockers, assigned people, operational controls, and all records.
   - Keep one readable primary timeline and retain detailed/raw history under disclosures.

7. **Document and verify**
   - Update the audit and workspace review notes with implemented behavior and exact limitations.
   - Add focused tests for review precedence, phase-empty/select-all consistency, answer/unknown mapping, exact action targeting, and mounted draft preservation where practical.
   - Run the focused tests and TypeScript check; rely on the preview build signal for build verification.
   - Use only an isolated local mocked/component harness with blocked mutation requests for 1280px and 390px checks. Capture list and active-detail PNG evidence as compact base64 JSON files under `design-review/`. Do not access authenticated live `/admin`.

## Technical notes
- Extract small pure display/filter/target helpers where that enables focused tests; no business-rule helpers will be changed.
- Existing action handlers and server calls remain attached to their current controls; navigation only opens, scrolls, and focuses.
- No publishing, database changes, live record access, sweeps, or communications.

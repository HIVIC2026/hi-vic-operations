# W1 — A1 Enquiry / Templates  (branch `w1-enquiry-templates`, worktree `wt-w1-enquiry`)
**Priority: TONIGHT (with W2).**
### Global rules (ALL W1–W4)
- **Donor source (ONLY):** `/Users/jet.zhang/CopilotWorkspace/Loveable/HIVic_Phase1_Delivery/hi-vic-operations-phase1`  — baseline = GitHub `main` `ac6e8908`.
- Work ONLY inside your own worktree. Never edit another workstream's physical directory.
- **Base already prepared by W0:** `src/lib/schema-compat.core.ts` is present on your branch (from commit `2df6ddc8`). Import it; do NOT edit it.
- **Port selectively** (patch/add). Do NOT `cp` whole files over GitHub's newer versions.
- **Preserve all GitHub-only work:** `src/lib/activity48-agreement-schedule.text.ts`, `tests/no-size-save-journey.test.ts`, and all existing tests/QA scripts. Never delete them.
- Run relevant local checks (typecheck/tests) on **isolated Supabase only**.
- Commit to YOUR branch only. **Do NOT push, merge, deploy, run migrations, enable notifications, send real email/SMS, or call live Mitti/Xero.**
- Report: modified file list + test results + blockers. Then STOP.
- Shared files: only **W2** edits `workflow.server.ts`; only **W4** edits `verified-eligibility.server.ts`. Request cross-file changes via W0.
- Migration **0149 is staged only** under `docs/pending-migrations/` — never apply it.

### Files you OWN (edit only these)
- `src/lib/enquiry.core.ts` (two-sided — review the 5 differing lines; keep 0202 fallback)
- `src/routes/api/public/enquiry.ts` (two-sided)
- `src/lib/template-catalog.ts` (two-sided)
- `src/lib/estimate-email.ts` (two-sided)
### Scope
- Port A1 replay-protection / enquiry intake from donor into the two enquiry files.
- Reconcile template selection for Save-My-Spot / more-info / ineligible / indicative-estimate — **selection logic only, NO live send**.
- Make GitHub's `tests/no-size-save-journey.test.ts` pass (no-size path). Do NOT touch `workflow.server.ts`.

# W2 — A2 Ready Check / Quote / Acceptance / Office  (branch `w2-lifecycle-office`, worktree `wt-w2-lifecycle`)
**Priority: TONIGHT (with W1).**
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
- A-only (add): `src/lib/owner-quote-visibility.core.ts`, `src/lib/office-quote-status.core.ts`, `src/components/portal/reason-dialog.tsx`
- Two-sided (port): `src/lib/ready-check-draft.server.ts`, `.core.ts`, `.functions.ts`, `src/lib/owner-myjob.server.ts` (review 3 lines), `src/lib/quotes.server.ts`
- **SHARED — you are SOLE owner:** `src/lib/workflow.server.ts`
### Scope
- Ready-check submit/reopen/blockers; owner quote visibility; office quote status; reason dialog.
- Land guarded transitions in `workflow.server.ts`; **publish the function signatures W3/W4 import** and keep them stable. Do NOT change `verified-eligibility.server.ts`'s interface (that's W4) — coordinate via W0.

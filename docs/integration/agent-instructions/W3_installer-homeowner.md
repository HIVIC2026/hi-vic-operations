# W3 — A3 Installer / Homeowner  (branch `w3-installer-homeowner`, worktree `wt-w3-installer`)
**Priority: TOMORROW.** Rebase on W2's `workflow.server.ts` before finalising.
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
- A-only (add): `src/lib/mitti-create.server.ts`, `src/lib/mitti-create-claim.core.ts`, `src/components/trade/one-tap-action.tsx`
- Two-sided (port): `src/lib/installer-ready-check.server.ts`, `src/lib/mitti.server.ts`
- Two-sided (CAREFUL): `src/lib/installer-onboarding.core.ts` — **preserve GitHub's Activity-48 / warranty additions**; line-level reconcile, no overwrite.
### Scope
- Installer ready-check (Mitti-on-booking T3), one-tap actions, homeowner flow.
- **Keep Mitti fully isolated — NO real external calls; no runs against a shared DB.** Do NOT edit `workflow.server.ts` (request via W0).

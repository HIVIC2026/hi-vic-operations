# Phase 1 · Round 2 · R4 — Execution Record: P1-R2-R4-S12-FINAL

**Step:** P1-R2-R4-S12-FINAL — Finalise & commit the Profile RLS security migration to GitHub
**Agent:** R4 — QA / Security
**Date:** 13 Oct 2026 (UTC)
**Branch:** `phase1/r2-qa-security`

---

## 1. GitHub baseline verified (actual, not assumed)
- Fetched `origin` and read the real remote HEAD.
- **`origin/main` = `c04641e879b7c8733134b073e680473541d62fac`** (matches the reported SHA).
- Previous R4 baseline `b2970e4f5fb5683953d2786d83dcff73b9915cfb` **is an ancestor** of `origin/main`; main advanced by **17 commits** (QA artifacts, owner-calculator, enquiry/email feature code). **None** touch `0203*`, `docs/pending-migrations/`, the migration journal, or the RLS test.

## 2. Migration files verified
| File | Status |
|---|---|
| `docs/pending-migrations/0203_profiles_least_privilege.sql` | present, inspected |
| `docs/pending-migrations/0203_profiles_least_privilege.rollback.sql` | present, inspected |
| `tests/profiles-least-privilege-db.test.ts` | present, 5 cases |
| `docs/phase1/round2/R4-QA-Security-deliverable.md` | present |

Migration content checks: number `0203`; creates `get_my_profile()` (SECURITY DEFINER, own-row); restricts normal users to own row (`self_read_own: id = auth.uid()`); admin preserved (`admin_all`/`is_admin()`); service-role bypass preserved; `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`; valid rollback restoring original `self_read`; no unrelated schema changes (only one policy + one function).

## 3. Migration numbering verified (against advanced main)
- `drizzle/migrations/meta/_journal.json` on `origin/main`: 149 entries, last idx 148, tag `0148_job_soft_delete_claims`.
- `APPLIED_MANUALLY.md`: `0149` and `0202` applied out-of-band, intentionally not journalled; pending files occupy up to `0202`.
- `origin/main` contains **no `0203`** file. => **`0203` remains conflict-free. No renumbering performed.**

## 4. Integration
- Committed the 4 deliverables first, then `git merge --no-edit origin/main`.
- **Merge result: clean, zero conflicts.** All 4 R4 deliverables intact; `origin/main` is now an ancestor of HEAD. No reset/clean/force used. Three untracked local planning notes (S10/S11/S12) left untracked and untouched.

## 5. Tests actually executed + results
- **Focused Profile RLS migration tests (post-merge):** `tests/profiles-least-privilege-db.test.ts` → **5 pass / 0 fail**.
  1. own profile readable; 2. other users' sensitive fields NOT browser-readable; 3. admin preserved; 4. service-role preserved; 5. rollback restores prior permissions (shared-job visibility returns); migration applies cleanly in isolated PGlite DB; job visibility not unintentionally broken.
- Full suite **not** rerun (no concrete change warranted it; merged commits don't touch RLS/profiles).

## 6. Pre-existing failures (preserved, not modified)
- The previously identified **22 failures** across owner-communication / Save-My-Spot / Group-B declaration-routing are **not R4-owned** and their business logic was **not** modified.
- They were **not rerun** in this step, so **no new claim** is made about them (not claimed fixed). Reproduction evidence remains in `R4-QA-Security-deliverable.md`.

## 7. Git delivery
- Commit: **`cfb62c96d0ac7d5bdb76852e8a305752d37f4032`** — `security: add profiles least-privilege RLS migration`.
- Merge commit integrating main: **`1edc99fc03b29fc8240c5a8b439774455f7093a3`**.
- Branch: `phase1/r2-qa-security` pushed to `origin` (non-force). Did **not** merge to `main`.

## 8. Live-environment safety confirmations
- Production database **not** modified (no migration executed against prod; `0203` is STAGED only).
- Production **email settings unchanged** (no email/automation config touched).
- **Lovable not published / not deployed.**
- No production data changed; no customer emails sent; environment not relocked/reset.

> Note: committing the SQL to GitHub does **not** activate RLS in production. The migration is staged and still requires explicit owner-approved application to take effect.

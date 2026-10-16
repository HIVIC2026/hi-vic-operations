# P1-CLOUD-S74 — DEF-07 Investigation, Remediation & Verification

**Step:** P1-CLOUD-S74-DEF07-INVESTIGATION-REMEDIATION-AND-VERIFICATION-01
**Executor:** Cloud (performed as R2 — Database & Security; verification + isolated local fix)
**Date:** 2026-10-16 AEDT
**Branch / worktree:** `cloud/p1-s74-def07-remediation` @ `wt-p1-s74-def07` (isolated; created from, and does **not** modify, `integration/p1-rc1-s67`)
**Base SHA:** `61dc22140d110588a93753fa3de1fc6bfeebf885` (S67 integration HEAD)

## 1. Existing S66 status → NOT_STARTED
Searched every ref: **no** `S66`/`DEF07` branch, worktree, report, or commit (`git log --all --grep`, branch list).
`53b44d4d`-style electrician work is S64, not S66. So there was **no prior fix to reuse** — remediation done here.
`integration/p1-rc1-s67` was inspected read-only only; **not checked out, reset, or modified**.

## 2. Defect + reproduction (isolated, synthetic; shared DB NOT touched)
Historical affected local test record (documented in the S65 report):
`official_form_signed_copies.id = 82000000-0000-4000-8000-0000000002a1`, `job c2000000-…02a1`, form key `piesa`,
stored `snapshot = {}` (md5 `99914b932bd37a50b983c5e7c90ae93b` = md5 of `{}`), "remained unchanged … before and after."

**Root cause:** `src/lib/official-forms.core.ts:592`
```ts
answersFromDocument = (doc) => Object.fromEntries(doc.filter((d) => d.value != null).map((d) => [d.id, d.value]));
```
Call sites (6) read a blindly-cast DB record as `record.snapshot.document`:
`piisa-workflow.core.ts:50,69,90`, `piisa-prestart.server.ts:32`, `official-forms.server.ts:128,150,213`.
A `{}` snapshot yields `document === undefined` → **`undefined is not an object (evaluating 'doc.filter')`**
(reproduced exactly, deterministically, in isolation — see §7 evidence).

**Secondary crash on the same compliance path (found while testing):** `snapshotProblems()` did
`OFFICIAL_TEMPLATES[snap.key].mappingVersion` with `snap.key === undefined` for a `{}` record → a second
unhandled exception. Because a malformed record can reach validity checking, this is in DEF07's scope
("malformed snapshots must not cause an unhandled exception"; "invalid snapshots must not satisfy
compliance"). Both are now guarded fail-closed.

**Production-like reachability:** not limited to the fixture — any row whose `snapshot` JSON lacks a valid
`document`/`key` (partial write, migration artifact, corruption) would crash the PIESA/PIISA evaluation and any
UI/server read. So the fix is a real application-defensiveness fix, not just fixture cleanup.

## 3. Fix implementation (smallest safe, pure, fail-closed)
`src/lib/official-forms.core.ts` — two pure changes, **no behavior change for valid snapshots**:
1. `answersFromDocument`: only map well-formed rows (`Array.isArray(doc)` and per-row `d && typeof d === "object"
   && d.id != null && d.value != null`); a missing/null/non-array document returns `{}` instead of throwing.
   Empty answers → `evaluatePiesa/evaluatePiisa` see every required answer missing → **fail closed** (40 `REQ:*`
   blockers for `{}`; never a valid signed form).
2. `snapshotProblems`: guard null/non-object snapshot and unknown/absent form key → returns "missing or
   malformed" / "unknown official form" problems (invalid) rather than throwing.
No validation was weakened; no signed content fabricated; no gate bypassed; valid round-trip preserved.

## 4. Files changed
- `src/lib/official-forms.core.ts` — hardened `answersFromDocument` + `snapshotProblems` (fail-closed guards).
- `tests/def07-malformed-signed-snapshot.test.ts` — NEW regression suite T01–T10 (isolated synthetic; no DB/network).

## 5. Local fixture disposition (§7) — shared DB untouched
The `82000000-…02a1` record lives in the **shared local test database**, not in a git seed (SQL grep found no
seed file). Per boundaries, this task **did not read from or write to the shared local DB** and did not reset it.
Recommended, reversible owner-approval plan (NOT executed here):
- Option A (preferred): replace with a **genuinely valid synthetic TEST** signed PIESA fixture built by
  `buildSignedSnapshot` for a clearly `qa_test`/TEST job (never a real person's statutory signature), so the
  fixture exercises the happy path.
- Option B: quarantine/delete the invalid row and its job linkage if it is only a stale test artifact.
Either way: no fabricated signing evidence for a real person; single-transaction, backup/PITR first,
reversible, coordinated with the DB owner.

## 6. Security / compliance impact
- **No new communications behavior** (DEF07 is pure evaluation/validity; no send path touched).
- **Statutory gates preserved and hardened:** an invalid snapshot now yields blockers (fails closed) and is
  independently flagged invalid, so it cannot satisfy PIESA/PIISA compliance or progress a job — the opposite
  of the pre-fix crash (which was a DoS/exception, not a false-compliance).
- **No PII/secrets exposed:** malformed input returns an empty object instead of throwing a stack into logs/UI.

## 7. Verification (this execution; not reused from history)
- Repro + fix proof: running T01–T10 against the **unfixed** code → T02/T03/T04/T05/T06 fail with
  `undefined is not an object (evaluating 'doc.filter')` (the DEF07 signature); with the fix → **10 pass / 0 fail**.
  Deterministic `bun -e` check: `answersFromDocument(undefined)` OLD throws; FIXED returns `{}`; id-less/`null` rows skipped.
- **DEF07 focused:** 10/10 pass. **PIESA/PIISA + official + auth regression:** all pass (no failures in any
  piesa/piisa/official/auth file).
- **TypeScript** `bunx tsc --noEmit`: **PASS**. **Build** `bun run build`: **PASS**.
- **Full isolated suite:** **335 files · 3198 pass · 3 fail** (baseline was 334/3188/3 → +1 file, +10 pass).
  The 3 failures are **only** the pre-existing `tests/s20r01-automatic-enquiry-emails.test.ts` (outdated vs the
  COM04 runtime guard — reported separately, **not modified** under this task, per §10).

## 8. Integration instructions (for R1 — Cloud does NOT integrate into S67)
- Fix is self-contained and cherry-pickable: `official-forms.core.ts` guard + `tests/def07-*.test.ts`.
- **No schema/migration** changes; no interaction with COM04/COM08/COM09/S65/S64/S69/S70 code paths beyond the
  shared pure core. Compatible with S64 electrician flow (independent) and Mitti-linked PIESA (unchanged).
- Recommended: R1 cherry-picks `FIX_COMMIT_SHA` into `integration/p1-rc1-s67` during controlled integration,
  then re-runs the PIESA/official tests + s20r01 triage. Owner-approve the shared-DB fixture repair (§5) separately.

## 9. Remaining blockers
1. Shared-DB malformed fixture `82000000-…02a1` needs owner-approved reversible repair (not executed here).
2. The 3 s20r01 email tests remain red (pre-existing, unrelated to DEF07; separate test-only fix, needs auth).
3. Real browser/PIESA UAT not executed (needs an isolated loopback stack; not in this task's scope).

## 10. Verdict
`DEF07_REMEDIATION_COMPLETE` (local fix + regression verified; fail-closed preserved; shared/prod data untouched).
Fix commit SHA recorded below and handed to R1 for controlled integration. No production writes / migrations /
deploy / push / merge.

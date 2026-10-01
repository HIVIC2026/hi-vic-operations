# Parity: bring the launch-control patch into the current app

## What I confirmed (read-only)
- The archive opens. It contains launch-control.patch (65 file diffs), README.txt and PATCH_MANIFEST.json.
- The base is d5a7f52, and HEAD is 49 commits newer (075dfa6, 2026-10-01 13:24 UTC).
- 4 patched files were also changed after d5a7f52. These need a manual merge: public-calculator.tsx, register-interest.tsx, coverage.functions.ts, installer-invoice.functions.ts.
- Migrations 0071–0073 have not been applied. The last migration in the repo is 0070.

## Steps
1. **Gap report:** list every commit since d5a7f52 with its hash, time and files, and record the 4 overlaps.
2. **Dry-run manifest:** list each file's path, change, lines added/removed and the fix it belongs to. Split code changes from migrations, flag locked files, and confirm the patch leaves Gate 1, pricing, payment guards and audit history untouched. Stop and report if anything is unexpected.
3. **Migrations in a draft copy:** create an isolated draft and apply 0071, 0072 and 0073 one at a time there, never on live. Report each result, its grants and RLS changes, and whether it can be undone. Verify the new launch tables default OFF, the service-role write grants are revoked, and mode changes only go through the audited function. Stop if any migration fails.
4. **Code in the draft:** apply the 61 files with no conflicts as-is. Merge the 4 overlapping files by hand so the newer work stays, and note each merge.
5. **Checks on the merged tree:** run the full test suite (baseline 835 pass / 3 known fails), the stage-gate, external-boundary and PostgreSQL tests, the typecheck and the build. Treat any new failure as a stop.
6. **Protected items:** check the hashes of the 11 locked files and confirm Gate 1 is unchanged. Confirm no accepted quotes, signed records or audit rows changed, there are zero network calls, and all 15 controls are OFF.
7. **The seven fixes:** for each one, name the live file and the test that proves it.
8. **Report:** write HANDOVER.md entries for any new issues (listed, not fixed), then give a parity verdict of CLEAN or NOT CLEAN.

## Limits
- Draft only. Nothing goes live until you accept the draft. No publishing, sending, charging or enabling automation.
- The patch is applied file by file, because the patch tool is blocked here.
